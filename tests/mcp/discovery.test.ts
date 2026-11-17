import { describe, expect, it } from 'vitest';
import { createSettingsStore } from '../../src/background/settings';
import {
  DISCOVERY_LIMITS,
  classifyProbe,
  createDiscoveryRpcHandlers,
  createMcpDiscovery,
  discoveryOrigin,
  endpointFromCardUrl,
  parseAiCatalog,
  parseServerCard,
  sanitizeDisplayText,
  suggestServerName,
  uniqueServerName,
} from '../../src/mcp/discovery';
import type { McpManager } from '../../src/mcp/manager';
import { STORAGE_KEYS } from '../../src/shared/defaults';
import { dispatchRpc } from '../../src/shared/protocol';
import type { McpServerInput } from '../../src/shared/types';
import { createFakeStorageArea } from '../helpers/fake-storage';

// ---------------------------------------------------------------------------------------------
// Fixtures modelled on the two shapes seen in the wild (example host names)
// ---------------------------------------------------------------------------------------------

/** An AI Catalog with one MCP server card entry (inline `data`, or a `url`). */
const catalog = (entry: Record<string, unknown>): Record<string, unknown> => ({
  specVersion: '1.0',
  entries: [
    { identifier: 'urn:air:example.org:registry:x', type: 'application/ai-registry+json', url: 'https://registry.example.org/' },
    { identifier: 'urn:air:example.org:mcp:x', type: 'application/mcp-server-card+json', ...entry },
  ],
});

/** A wiki with a server card (anonymous MCP endpoint) and RFC 9728 metadata for its REST API. */
const CARD_SITE = 'https://wiki.example.org';
const CARD = {
  serverInfo: { name: 'ExampleWiki', version: '2.4.0' },
  transport: { type: 'streamable-http', endpoint: `${CARD_SITE}/mcp` },
  capabilities: { tools: {} },
};
const CARD_SITE_PRM = {
  resource: `${CARD_SITE}/wiki`,
  authorization_servers: [CARD_SITE],
  scopes_supported: ['wiki.read'],
  bearer_methods_supported: ['header'],
};

/** A site with only protected resource metadata; `POST /mcp` answers 401 with a challenge. */
const PRM_SITE = 'https://toolbox.example.net';
const PRM_SITE_PRM = {
  resource: `${PRM_SITE}/mcp`,
  authorization_servers: [PRM_SITE],
  scopes_supported: ['read', 'write', 'tools', 'admin'],
  bearer_methods_supported: ['header'],
  resource_indicators_supported: true,
};

const json = (body: unknown, status = 200, type = 'application/json'): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
const html = (status = 404): Response => new Response('Not Found', { status, headers: { 'Content-Type': 'text/html' } });

interface Seen {
  method: string;
  url: string;
  credentials?: RequestCredentials | undefined;
  redirect?: RequestRedirect | undefined;
  cookie?: string | null;
  authorization?: string | null;
}

function siteFetch(extra: Record<string, (r: Request) => Response> = {}) {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const r = new Request(input, init);
    seen.push({ method: r.method, url: r.url, credentials: init?.credentials, redirect: init?.redirect, cookie: r.headers.get('cookie'), authorization: r.headers.get('authorization') });
    const key = `${r.method} ${r.url}`;
    const custom = extra[key];
    if (custom) return custom(r);
    switch (key) {
      case `GET ${CARD_SITE}/.well-known/ai-catalog.json`:
        return json(catalog({ url: '/mcp/server-card' }), 200, 'application/ai-catalog+json; charset=utf-8');
      case `GET ${CARD_SITE}/mcp/server-card`:
        return json(CARD, 200, 'application/mcp-server-card+json');
      case `GET ${CARD_SITE}/.well-known/oauth-protected-resource`:
        return json(CARD_SITE_PRM);
      case `POST ${CARD_SITE}/mcp`:
        return json({ jsonrpc: '2.0', id: 1, result: { resultType: 'complete', supportedVersions: ['2025-06-18'] } });
      case `POST ${CARD_SITE}/wiki`:
        return html(405);
      case `GET ${PRM_SITE}/.well-known/oauth-protected-resource`:
        return json(PRM_SITE_PRM, 200, 'application/json; charset=utf-8');
      case `POST ${PRM_SITE}/mcp`:
        // Like the real site: modern discovery is public, everything else needs a token.
        return json({
          jsonrpc: '2.0',
          id: 1,
          result: { resultType: 'complete', supportedVersions: ['2026-07-28'], _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'toolbox-mcp', version: '1.0.0' } } },
        });
      case `POST ${PRM_SITE}/legacy-401`:
        return new Response('{"error":"unauthorized"}', {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="mcp", resource_metadata="${PRM_SITE}/.well-known/oauth-protected-resource"`,
          },
        });
      default:
        return html();
    }
  };
  return { fetchFn, seen };
}

function setup(extra: Record<string, (r: Request) => Response> = {}) {
  const { fetchFn, seen } = siteFetch(extra);
  const settings = createSettingsStore(createFakeStorageArea());
  const local = createFakeStorageArea();
  const session = createFakeStorageArea();
  let clock = 10_000_000;
  const discovery = createMcpDiscovery({ settings, local, session, fetch: fetchFn, now: () => clock });
  return { discovery, settings, local, session, seen, advance: (ms: number) => (clock += ms) };
}

// ---------------------------------------------------------------------------------------------

describe('parsing', () => {
  it('reads both server card shapes', () => {
    expect(parseServerCard(CARD, `${CARD_SITE}/.well-known/mcp/server-card.json`)).toEqual({ endpoint: `${CARD_SITE}/mcp`, name: 'ExampleWiki', version: '2.4.0' });
    const remotes = {
      $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      name: 'org.example/tools',
      title: 'Example Tools',
      description: 'Does things',
      version: '1.0.0',
      remotes: [{ type: 'sse', url: 'https://x.example.org/sse' }, { type: 'streamable-http', url: '/mcp' }],
    };
    expect(parseServerCard(remotes, 'https://x.example.org/.well-known/mcp/server-card.json')).toEqual({
      endpoint: 'https://x.example.org/mcp',
      name: 'Example Tools',
      description: 'Does things',
      version: '1.0.0',
    });
  });

  it('rejects cards without a usable endpoint', () => {
    const url = `${CARD_SITE}/.well-known/mcp/server-card.json`;
    expect(parseServerCard({ transport: { type: 'stdio', command: 'x' } }, url)).toBeNull();
    expect(parseServerCard({ transport: { type: 'streamable-http', endpoint: 'http://wiki.example.org/mcp' } }, url)).toBeNull(); // plain http
    expect(parseServerCard({ transport: { type: 'streamable-http', endpoint: 'javascript:alert(1)' } }, url)).toBeNull();
    expect(parseServerCard({ transport: { type: 'streamable-http', endpoint: 'https://u:p@wiki.example.org/mcp' } }, url)).toBeNull();
    expect(parseServerCard('nope', url)).toBeNull();
  });

  it('sanitises names (control, bidi, length) and derives valid server names', () => {
    expect(sanitizeDisplayText('Evil‮gnp.exe\u0000  name', 64)).toBe('Evil gnp.exe name');
    expect(sanitizeDisplayText('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
    const card = parseServerCard({ serverInfo: { name: `A\nB${'c'.repeat(200)}` }, transport: { type: 'streamable-http', endpoint: '/mcp' } }, `${CARD_SITE}/x`);
    expect(card?.name?.length).toBe(DISCOVERY_LIMITS.maxNameChars);
    // The site's name only when it matches the host; else the host.
    expect(suggestServerName('Wiki', 'wiki.example.org')).toBe('wiki');
    expect(suggestServerName('ExampleWiki', 'wiki.example.org')).toBe('wiki-example');
    expect(suggestServerName('Ünïcode Tööls!', 'unicodetools.example.org')).toBe('unicode-tools');
    expect(suggestServerName('Ünïcode Tööls!', 'x.example.org')).toBe('x-example');
    expect(suggestServerName('GitHub', 'api.githubcopilot.com')).toBe('github');
    expect(suggestServerName('GitHub MCP Server', 'api.githubcopilot.com')).toBe('github-mcp-server');
    expect(suggestServerName('GitHub MCP Server', 'mcp.evil.example')).toBe('mcp-evil');
    expect(suggestServerName('GitHub', 'mcp.evil-tools.example')).toBe('mcp-evil-tools');
    expect(sanitizeDisplayText('Git\u2060Hub\u061c', 64)).toBe('Git Hub');
    expect(suggestServerName(undefined, 'toolbox.example.net')).toBe('toolbox-example');
    expect(suggestServerName('???', 'localhost')).toBe('localhost');
    expect(uniqueServerName('wiki', ['Wiki', 'wiki-2'])).toBe('wiki-3');
  });

  it('only probes https pages (and local http)', () => {
    expect(discoveryOrigin('https://a.example.org/x')?.origin).toBe('https://a.example.org');
    expect(discoveryOrigin('http://a.example.org/x')).toBeNull();
    expect(discoveryOrigin('http://127.0.0.1:8080/')?.origin).toBe('http://127.0.0.1:8080');
    expect(discoveryOrigin('chrome://settings')).toBeNull();
    expect(discoveryOrigin('file:///tmp/x.html')).toBeNull();
  });

  it('classifies probe answers', async () => {
    expect(await classifyProbe(json({ jsonrpc: '2.0', id: 1, result: {} }))).toEqual({ mcp: 'yes', auth: 'none' });
    // An error answer (e.g. a legacy server rejecting server/discover) is MCP that did not ask for credentials.
    expect(await classifyProbe(json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'x' } }, 400))).toEqual({ mcp: 'yes', auth: 'none' });
    expect(await classifyProbe(json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'x' } }, 403))).toEqual({ mcp: 'yes', auth: 'unknown' });
    expect(
      await classifyProbe(json({ jsonrpc: '2.0', id: 1, result: { _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'srv\u202e', title: 'Nice Server' } } } })),
    ).toEqual({ mcp: 'yes', auth: 'none', serverName: 'Nice Server' });
    expect(await classifyProbe(new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://a.example/.well-known/oauth-protected-resource"' } }))).toMatchObject({ mcp: 'auth', auth: 'oauth' });
    expect(await classifyProbe(new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="x"' } }))).toEqual({ mcp: 'no', auth: 'unknown' });
    expect(await classifyProbe(html(200))).toEqual({ mcp: 'no', auth: 'unknown' });
    expect(await classifyProbe(json({ ok: true }))).toEqual({ mcp: 'no', auth: 'unknown' });
    expect(await classifyProbe(new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))).toEqual({ mcp: 'yes', auth: 'none' });
  });
});

describe('discovery service', () => {
  it('finds the server-card site (anonymous) and ignores its non-MCP protected resource', async () => {
    const t = setup();
    const found = await t.discovery.check(`${CARD_SITE}/wiki/Some_Page`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      key: `${CARD_SITE}/mcp`,
      endpoint: `${CARD_SITE}/mcp`,
      endpointHost: 'wiki.example.org',
      name: 'ExampleWiki',
      suggestedName: 'wiki-example',
      version: '2.4.0',
      foundOn: CARD_SITE,
      sameOrigin: true,
      source: 'catalog',
      auth: 'none',
    });
    // Requests: two discovery GETs, the same-origin card the catalog names, the card endpoint
    // probe, the PRM resource probe; nothing else.
    expect(t.seen.map((s) => `${s.method} ${s.url}`).sort()).toEqual(
      [
        `GET ${CARD_SITE}/.well-known/ai-catalog.json`,
        `GET ${CARD_SITE}/.well-known/oauth-protected-resource`,
        `GET ${CARD_SITE}/mcp/server-card`,
        `POST ${CARD_SITE}/mcp`,
        `POST ${CARD_SITE}/wiki`,
      ].sort(),
    );
    // Never with cookies or credentials, never following redirects.
    expect(t.seen.every((s) => s.credentials === 'omit' && s.redirect === 'manual' && !s.cookie && !s.authorization)).toBe(true);
    expect((await t.discovery.list()).map((s) => s.key)).toEqual([`${CARD_SITE}/mcp`]);
  });

  it('finds the protected-resource-only site and marks it as needing sign-in (discovery answered anonymously)', async () => {
    const t = setup();
    const found = await t.discovery.check(`${PRM_SITE}/`);
    expect(found).toEqual([
      expect.objectContaining({
        endpoint: `${PRM_SITE}/mcp`,
        name: 'toolbox-mcp',
        suggestedName: 'toolbox-mcp',
        source: 'protected-resource',
        auth: 'oauth',
        authorizationServer: PRM_SITE,
        sameOrigin: true,
      }),
    ]);
    expect(t.seen.filter((s) => s.method === 'POST')).toHaveLength(1);
  });

  it('a protected resource that answers the probe with 401 + resource_metadata is listed too', async () => {
    const t = setup({
      [`GET https://api.example.net/.well-known/oauth-protected-resource`]: () => json({ resource: 'https://api.example.net/mcp', authorization_servers: ['https://login.example.net'] }),
      [`POST https://api.example.net/mcp`]: () =>
        new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://api.example.net/.well-known/oauth-protected-resource"' } }),
      [`GET https://plain.example.net/.well-known/oauth-protected-resource`]: () => json({ resource: 'https://plain.example.net/api', authorization_servers: ['https://login.example.net'] }),
      [`POST https://plain.example.net/api`]: () => new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="api"' } }),
    });
    expect(await t.discovery.check('https://api.example.net/')).toEqual([
      expect.objectContaining({ endpoint: 'https://api.example.net/mcp', name: 'api.example.net', auth: 'oauth', authorizationServer: 'https://login.example.net' }),
    ]);
    // A plain OAuth API (no RFC 9728 challenge, no JSON-RPC) is not taken for an MCP server.
    expect(await t.discovery.check('https://plain.example.net/')).toEqual([]);
  });

  it('caches per site (positive and negative) and re-checks after the TTL', async () => {
    const t = setup();
    await t.discovery.check(`${CARD_SITE}/a`);
    await t.discovery.check(`${CARD_SITE}/b`);
    await t.discovery.check('https://nothing.example.com/');
    await t.discovery.check('https://nothing.example.com/other');
    const count = (host: string): number => t.seen.filter((s) => s.url.includes(host)).length;
    expect(count('wiki.example.org')).toBe(5);
    expect(count('nothing.example.com')).toBe(3); // catalog, metadata, legacy card
    t.advance(DISCOVERY_LIMITS.recheckMs + 1);
    await t.discovery.check('https://nothing.example.com/');
    expect(count('nothing.example.com')).toBe(6);
    // The checked-site cache lives in session storage (gone with the browser session).
    expect(Object.keys(t.session.data.get(STORAGE_KEYS.mcpDiscoveryChecked) as object)).toEqual(
      expect.arrayContaining([CARD_SITE, 'https://nothing.example.com']),
    );
  });

  it('respects the setting, incognito and the page rules', async () => {
    const t = setup();
    expect(await t.discovery.check(`${CARD_SITE}/`, { incognito: true })).toEqual([]);
    expect(await t.discovery.check('http://wiki.example.org/')).toEqual([]);
    await t.settings.set({ mcpDiscovery: false });
    expect(await t.discovery.check(`${CARD_SITE}/`)).toEqual([]);
    expect(t.seen).toEqual([]);
  });

  it('drops private endpoints named by public sites, and does not contact other hosts (cards or endpoints)', async () => {
    const t = setup({
      [`GET https://public.example.com/.well-known/ai-catalog.json`]: () =>
        json(catalog({ data: { serverInfo: { name: 'Sneaky' }, transport: { type: 'streamable-http', endpoint: 'http://127.0.0.1:9000/mcp' } } })),
      [`GET https://other.example.com/.well-known/ai-catalog.json`]: () =>
        json(catalog({ data: { serverInfo: { name: 'Elsewhere' }, transport: { type: 'streamable-http', endpoint: 'https://api.example.net/mcp' } } })),
      // Like github.com: the catalog points at a card on another host (its reserved location).
      [`GET https://code.example.com/.well-known/ai-catalog.json`]: () =>
        json({
          specVersion: '1.0',
          entries: [
            { identifier: 'urn:air:code.example.com:mcp:a', type: 'application/mcp-server-card+json', url: 'https://api.codecloud.example/mcp/server-card', displayName: 'Code\u202eCloud' },
            { identifier: 'urn:air:code.example.com:mcp:b', type: 'application/mcp-server-card+json', url: 'https://cards.example.net/card.json' },
          ],
        }),
    });
    expect(await t.discovery.check('https://public.example.com/')).toEqual([]);
    const found = await t.discovery.check('https://other.example.com/');
    expect(found).toEqual([expect.objectContaining({ endpoint: 'https://api.example.net/mcp', sameOrigin: false, auth: 'unknown', foundOn: 'https://other.example.com' })]);
    const code = await t.discovery.check('https://code.example.com/');
    expect(code).toEqual([
      expect.objectContaining({ endpoint: 'https://api.codecloud.example/mcp', source: 'catalog', name: 'Code Cloud', suggestedName: 'code-cloud', sameOrigin: false, auth: 'unknown' }),
    ]);
    // Only the visited sites themselves were contacted.
    expect(t.seen.every((s) => ['public.example.com', 'other.example.com', 'code.example.com'].includes(new URL(s.url).host))).toBe(true);
  });

  it('falls back to the legacy /.well-known/mcp/server-card.json when the catalog answers 401', async () => {
    const site = 'https://legacy.example.org';
    const t = setup({
      [`GET ${site}/.well-known/ai-catalog.json`]: () => json({ error: 'invalid_token' }, 401),
      [`GET ${site}/.well-known/oauth-protected-resource`]: () => json({ resource: `${site}/api`, authorization_servers: [site] }),
      [`GET ${site}/.well-known/mcp/server-card.json`]: () =>
        json({ serverInfo: { name: 'Legacy Wiki', version: '1.2' }, transport: { type: 'streamable-http', endpoint: `${site}/mcp` }, capabilities: { tools: {} } }),
      [`POST ${site}/mcp`]: () => json({ jsonrpc: '2.0', id: 1, result: {} }),
      [`POST ${site}/api`]: () => html(405),
    });
    expect(await t.discovery.check(`${site}/wiki`)).toEqual([
      expect.objectContaining({ endpoint: `${site}/mcp`, source: 'server-card', name: 'Legacy Wiki', suggestedName: 'legacy-example', auth: 'none', version: '1.2' }),
    ]);
    expect(t.seen.every((s) => s.credentials === 'omit' && s.redirect === 'manual')).toBe(true);
    // The server.json-style shape is read there too.
    const u = setup({
      [`GET https://x.example.org/.well-known/mcp/server-card.json`]: () => json({ name: 'org.example/x', title: 'X', remotes: [{ type: 'streamable-http', url: '/mcp' }] }),
    });
    expect(await u.discovery.check('https://x.example.org/')).toEqual([expect.objectContaining({ endpoint: 'https://x.example.org/mcp', source: 'server-card' })]);
  });

  it('with an MCP entry in the catalog the legacy card is not requested', async () => {
    const t = setup();
    await t.discovery.check(`${CARD_SITE}/`);
    expect(t.seen.some((s) => s.url.endsWith('/.well-known/mcp/server-card.json'))).toBe(false);
  });

  it('with neither catalog nor card, the protected-resource path still works', async () => {
    const t = setup();
    expect(await t.discovery.check(`${PRM_SITE}/`)).toEqual([expect.objectContaining({ endpoint: `${PRM_SITE}/mcp`, source: 'protected-resource', auth: 'oauth' })]);
    expect(t.seen.map((s) => `${s.method} ${new URL(s.url).pathname}`).sort()).toEqual(
      ['GET /.well-known/ai-catalog.json', 'GET /.well-known/mcp/server-card.json', 'GET /.well-known/oauth-protected-resource', 'POST /mcp'].sort(),
    );
  });

  it('a card calling itself after another service keeps the name for display, not for tool names', async () => {
    const t = setup({
      [`GET https://tools.evil-site.example/.well-known/ai-catalog.json`]: () =>
        json(catalog({ data: { name: 'com.github/github', title: 'GitHub', remotes: [{ type: 'streamable-http', url: '/mcp' }] } })),
      [`POST https://tools.evil-site.example/mcp`]: () => json({ jsonrpc: '2.0', id: 1, result: {} }),
    });
    expect(await t.discovery.check('https://tools.evil-site.example/')).toEqual([
      expect.objectContaining({ name: 'GitHub', suggestedName: 'tools-evil-site', endpointHost: 'tools.evil-site.example' }),
    ]);
  });

  it('reads AI catalogs: card entries only, inline or by URL, bounded; the reserved card location names the endpoint', () => {
    const url = 'https://a.example.org/.well-known/ai-catalog.json';
    expect(parseAiCatalog(catalog({ url: '/x/server-card' }), url)).toEqual([{ url: 'https://a.example.org/x/server-card' }]);
    expect(parseAiCatalog(catalog({ data: { name: 'n' }, displayName: 'Nice' }), url)).toEqual([{ data: { name: 'n' }, name: 'Nice' }]);
    expect(parseAiCatalog({ entries: [{ type: 'application/mcp-server-card+json', url: 'javascript:alert(1)' }] }, url)).toEqual([]);
    const many = { entries: Array.from({ length: 50 }, (_, i) => ({ type: 'application/mcp-server-card+json', url: `/c${i}/server-card` })) };
    expect(parseAiCatalog(many, url)).toHaveLength(DISCOVERY_LIMITS.maxCardsPerSite);
    expect(parseAiCatalog('nope', url)).toEqual([]);
    expect(endpointFromCardUrl('https://api.example.com/mcp/server-card')).toBe('https://api.example.com/mcp');
    expect(endpointFromCardUrl('https://api.example.com/card.json')).toBeNull();
    expect(endpointFromCardUrl('http://api.example.com/mcp/server-card')).toBeNull(); // plain http
  });

  it('lists at most maxNewPerHour new servers per hour (a site cycling through subdomains cannot flood the list)', async () => {
    const extra: Record<string, (r: Request) => Response> = {};
    const n = DISCOVERY_LIMITS.maxNewPerHour + 5;
    for (let i = 0; i < n; i++) {
      extra[`GET https://x${i}.flood.example/.well-known/ai-catalog.json`] = () =>
        json(catalog({ data: { title: `X${i}`, remotes: [{ type: 'streamable-http', url: `https://x${i}.flood.example/mcp` }] } }));
    }
    const t = setup(extra);
    await t.discovery.check(`${CARD_SITE}/`); // a real entry first
    for (let i = 0; i < n; i++) await t.discovery.check(`https://x${i}.flood.example/`);
    const listed = await t.discovery.list();
    expect(listed).toHaveLength(DISCOVERY_LIMITS.maxNewPerHour);
    expect(listed.some((s) => s.foundOn === CARD_SITE)).toBe(true);
    // The deferred sites are tried again on a later visit, after the hour.
    t.advance(3600_000 + 1);
    await t.discovery.check(`https://x${n - 1}.flood.example/`);
    expect((await t.discovery.list()).some((s) => s.name === `X${n - 1}`)).toBe(true);
  });

  it('a local page may advertise a local server', async () => {
    const t = setup({
      [`GET http://127.0.0.1:8080/.well-known/ai-catalog.json`]: () => json(catalog({ data: { serverInfo: { name: 'Local' }, transport: { type: 'streamable-http', endpoint: '/mcp' } } })),
      [`POST http://127.0.0.1:8080/mcp`]: () => json({ jsonrpc: '2.0', id: 1, result: {} }),
    });
    expect(await t.discovery.check('http://127.0.0.1:8080/')).toEqual([expect.objectContaining({ endpoint: 'http://127.0.0.1:8080/mcp', auth: 'none' })]);
  });

  it('dismiss, already-added, forPage and clear', async () => {
    const t = setup();
    await t.discovery.check(`${CARD_SITE}/`);
    await t.discovery.check(`${PRM_SITE}/`);
    expect((await t.discovery.forPage(`${PRM_SITE}/x`)).map((s) => s.endpoint)).toEqual([`${PRM_SITE}/mcp`]);
    await t.settings.update((s) => ({ ...s, mcpServers: [{ id: 'm1', name: 'toolbox', url: `${PRM_SITE}/mcp/`, enabled: true }] }));
    expect(await t.discovery.forPage(`${PRM_SITE}/x`)).toEqual([]);
    expect((await t.discovery.list()).find((s) => s.endpoint === `${PRM_SITE}/mcp`)?.addedServerId).toBe('m1');
    await t.discovery.dismiss(`${CARD_SITE}/mcp`);
    expect((await t.discovery.list()).map((s) => s.endpoint)).toEqual([`${PRM_SITE}/mcp`]);
    expect(await t.discovery.forPage(`${CARD_SITE}/`)).toEqual([]);
    await t.discovery.clear();
    expect(await t.discovery.list()).toEqual([]);
    expect(t.session.data.has(STORAGE_KEYS.mcpDiscoveryChecked)).toBe(false);
  });

  it('keeps the stored list bounded and survives a restart', async () => {
    const extra: Record<string, (r: Request) => Response> = {};
    for (let i = 0; i < DISCOVERY_LIMITS.maxServers + 5; i++) {
      extra[`GET https://s${i}.example.com/.well-known/ai-catalog.json`] = () =>
        json(catalog({ data: { serverInfo: { name: `S${i}` }, transport: { type: 'streamable-http', endpoint: `https://s${i}.example.com/mcp` } } }));
    }
    const t = setup(extra);
    for (let i = 0; i < DISCOVERY_LIMITS.maxServers + 5; i++) {
      t.advance(3600_000 / DISCOVERY_LIMITS.maxNewPerHour + 1); // within the hourly cap
      await t.discovery.check(`https://s${i}.example.com/`);
    }
    const list = await t.discovery.list();
    expect(list).toHaveLength(DISCOVERY_LIMITS.maxServers);
    expect(list[0]?.name).toBe(`S${DISCOVERY_LIMITS.maxServers + 4}`); // newest first
    const again = createMcpDiscovery({ settings: t.settings, local: t.local, session: t.session, fetch: async () => html() });
    expect(await again.list()).toHaveLength(DISCOVERY_LIMITS.maxServers);
  });

  it('bounds concurrency and deduplicates a site checked twice at once', async () => {
    let active = 0;
    let peak = 0;
    const settings = createSettingsStore(createFakeStorageArea());
    const discovery = createMcpDiscovery({
      settings,
      local: createFakeStorageArea(),
      session: createFakeStorageArea(),
      fetch: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return html();
      },
    });
    await Promise.all([...Array.from({ length: 6 }, (_, i) => discovery.check(`https://p${i}.example.com/`)), discovery.check('https://p0.example.com/again')]);
    expect(peak).toBeLessThanOrEqual(DISCOVERY_LIMITS.concurrency * 2); // two GETs per site at most
  });

  it('ignores oversized and non-JSON documents', async () => {
    const t = setup({
      [`GET https://big.example.com/.well-known/ai-catalog.json`]: () =>
        json(catalog({ data: { pad: 'x'.repeat(70_000), transport: { type: 'streamable-http', endpoint: '/mcp' } } })),
      [`GET https://spa.example.com/.well-known/ai-catalog.json`]: () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }),
    });
    expect(await t.discovery.check('https://big.example.com/')).toEqual([]);
    expect(await t.discovery.check('https://spa.example.com/')).toEqual([]);
  });
});

describe('discovery RPCs', () => {
  it('adds a discovered server with a unique derived name; validates params', async () => {
    const t = setup();
    await t.discovery.check(`${CARD_SITE}/`);
    await t.settings.update((s) => ({ ...s, mcpServers: [{ id: 'x', name: 'wiki-example', url: 'https://elsewhere.example.com/mcp', enabled: true }] }));
    const added: McpServerInput[] = [];
    const manager: Pick<McpManager, 'add'> = {
      add: async (server) => {
        added.push(server);
        return { ...server, id: 'new', hasAuth: false, state: 'connected' };
      },
    };
    const rpc = createDiscoveryRpcHandlers({ discovery: t.discovery, manager, settings: t.settings, tabUrl: async () => `${CARD_SITE}/page` });
    const sender = {} as chrome.runtime.MessageSender;
    expect(await dispatchRpc(rpc, { rpc: 'mcp.discovered.forTab', params: {} }, sender)).toMatchObject({ ok: true, result: [{ name: 'ExampleWiki' }] });
    expect(await dispatchRpc(rpc, { rpc: 'mcp.discovered.add', params: { key: `${CARD_SITE}/mcp` } }, sender)).toMatchObject({ ok: true });
    expect(added).toEqual([{ name: 'wiki-example-2', url: `${CARD_SITE}/mcp`, enabled: true }]);
    expect(await dispatchRpc(rpc, { rpc: 'mcp.discovered.add', params: { key: 'https://unknown.example.com/mcp' } }, sender)).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(await dispatchRpc(rpc, { rpc: 'mcp.discovered.dismiss', params: {} }, sender)).toMatchObject({ ok: false });
    expect(await dispatchRpc(rpc, { rpc: 'mcp.discovered.forTab', params: { tabId: -1 } }, sender)).toMatchObject({ ok: false });
  });
});
