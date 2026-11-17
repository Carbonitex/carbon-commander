/**
 * MCP server discovery on visited sites ("quick add").
 *
 * When a tab finishes loading an `https:` page (or a local `http:` one), the site's origin is
 * checked once (per browser session, then again after a day) for an advertised MCP server:
 *
 * 1. `GET /.well-known/ai-catalog.json`: an AI Catalog (the domain-level discovery of MCP server
 *    cards, SEP-2127 and its extension repository `modelcontextprotocol/experimental-ext-server-card`,
 *    `docs/discovery.md`). Entries of type `application/mcp-server-card+json` carry the card inline
 *    (`data`) or its `url`. A card `url` on the page's own origin is fetched; one on another host
 *    is never fetched (that would tell a third party which site was visited): when it is at the
 *    reserved location `<streamable-http-url>/server-card`, the endpoint is that URL without the
 *    suffix, listed as a different host and not probed. Both card shapes in use are read:
 *    `{ name, title, remotes: [{ type: 'streamable-http', url }] }` and the older
 *    `{ serverInfo, transport: { type: 'streamable-http', endpoint } }`.
 *    Listed with `source: 'catalog'`.
 * 2. Only when the catalog is absent, unauthorised or names no MCP server card:
 *    `GET /.well-known/mcp/server-card.json`, the earlier proposal's well-known card (still served
 *    by some sites), same card shapes; listed with `source: 'server-card'`.
 * 3. `GET /.well-known/oauth-protected-resource` (RFC 9728, in parallel with 1): a protected
 *    resource on the same origin, kept only when a probe confirms it behaves like an MCP endpoint.
 *
 * Requests per checked origin: at most three well-known GETs (catalog, protected resource
 * metadata, legacy card), plus at most two same-origin cards named by the catalog, plus one probe
 * per same-origin endpoint found (at most three).
 *
 * The probe is one unauthenticated JSON-RPC `server/discover` POST (creates no session) to an
 * endpoint on the page's own origin: a JSON-RPC answer means "MCP, no sign-in"; a 401 with a
 * Bearer challenge naming its `resource_metadata` means "sign-in required". Like every extension
 * POST, it carries `Origin: chrome-extension://<id>`, and its `clientInfo` names this extension:
 * a site that advertises an MCP server learns that the extension is installed.
 *
 * Not used: HTTP `Link` headers (`rel="describedby"`) need the `webRequest` permission and would
 * wake the worker on every response; `<link>` elements have no MCP convention yet; RFC 9727
 * `api-catalog` has no MCP relation and would cost another request on every site.
 *
 * Privacy / safety: requests go only to the origin of the page being visited, never with cookies
 * or credentials, never following redirects, with short timeouts, small size caps and at most two
 * sites at a time; never for incognito tabs; only when the setting is on. Everything read is
 * untrusted: endpoints must pass the MCP URL rules, names are cleaned and capped (and only used as
 * the server's config name when they match its host, so a card cannot name itself after another
 * service), an endpoint on another host is shown as such (and not probed), a private / loopback
 * endpoint is dropped unless the page is on a private / loopback host itself, and at most
 * `maxNewPerHour` new servers are listed per hour (a site cycling through many subdomains cannot
 * push real entries out of the list). Nothing is ever added automatically.
 */
import type { SettingsStore } from '../background/settings';
import type { StorageAreaLike } from '../background/storage-area';
import { LOCAL_HTTP_HOSTS, MCP_SERVER_NAME_PATTERN, STORAGE_KEYS } from '../shared/defaults';
import { createLogger } from '../shared/logger';
import type { RpcHandlers } from '../shared/protocol';
import { CcError, type DiscoveredMcpServer, type McpServerStatus, type Settings } from '../shared/types';
import { blockedHostReason } from '../tools/net';
import { MODERN_PROTOCOL_VERSIONS } from './client';
import type { McpManager } from './manager';
import { validateMcpUrl } from './manager';
import { bearerChallenge, parseProtectedResourceMetadata } from './oauth';

const log = createLogger('mcp-discovery');

export const DISCOVERY_LIMITS = {
  maxDocumentBytes: 64 * 1024,
  timeoutMs: 5_000,
  /** Sites probed at the same time. */
  concurrency: 2,
  /** Sites waiting; more are dropped (they are tried again on the next visit). */
  maxQueue: 16,
  /** A checked site is not checked again for this long. */
  recheckMs: 24 * 3600_000,
  maxServers: 50,
  maxDismissed: 200,
  /** Checked-site entries kept (session storage). */
  maxCheckedOrigins: 1_000,
  /** Discovered servers not seen again for this long are dropped. */
  maxAgeMs: 30 * 24 * 3600_000,
  /** New entries listed per hour (more wait for a later visit). */
  maxNewPerHour: 10,
  /** Catalog entries looked at, and MCP server cards used, per site. */
  maxCatalogEntries: 32,
  maxCardsPerSite: 2,
  maxNameChars: 64,
  maxDescriptionChars: 300,
} as const;

export const AI_CATALOG_PATH = '/.well-known/ai-catalog.json';
/** The earlier proposal's well-known server card (still served by some sites): a fallback. */
export const LEGACY_SERVER_CARD_PATH = '/.well-known/mcp/server-card.json';
export const SERVER_CARD_TYPE = 'application/mcp-server-card+json';
/** The location MCP reserves for a server's card: `<streamable-http-url>/server-card`. */
const RESERVED_CARD_SUFFIX = '/server-card';
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

export interface McpDiscoveryDeps {
  settings: Pick<SettingsStore, 'get'>;
  /** Discovered servers (survive restarts). Default `chrome.storage.local`. */
  local?: StorageAreaLike;
  /** Checked origins (cleared with the browser session). Default `chrome.storage.session`. */
  session?: StorageAreaLike;
  fetch?: typeof fetch;
  now?: () => number;
  clientInfo?: { name: string; version: string };
}

export interface McpDiscovery {
  /** A tab finished loading `url` (fire and forget; checks the setting, the cache and the rules). */
  onNavigation(url: string, info?: { incognito?: boolean }): void;
  /** Same, but waits for the result (tests). Returns what was found on that site (may be cached). */
  check(url: string, info?: { incognito?: boolean }): Promise<DiscoveredMcpServer[]>;
  /** Every discovered, not dismissed server, with `addedServerId` when configured. */
  list(): Promise<DiscoveredMcpServer[]>;
  /** Discovered servers on the page's site that are neither added nor dismissed. */
  forPage(url: string): Promise<DiscoveredMcpServer[]>;
  get(key: string): Promise<DiscoveredMcpServer | undefined>;
  dismiss(key: string): Promise<void>;
  /** Forget everything (servers, dismissals, checked sites). */
  clear(): Promise<void>;
}

interface StoredState {
  v: 1;
  servers: DiscoveredMcpServer[];
  dismissed: string[];
}

// ---------------------------------------------------------------------------------------------
// Parsing (exported for tests)
// ---------------------------------------------------------------------------------------------

export interface ServerCardInfo {
  endpoint: string;
  name?: string;
  description?: string;
  version?: string;
}

/**
 * Read a server card. Returns null when it has no usable Streamable HTTP endpoint. The endpoint
 * may be relative to the card's URL; it must pass the MCP URL rules.
 */
export function parseServerCard(json: unknown, cardUrl: string): ServerCardInfo | null {
  if (!isRecord(json)) return null;
  let raw: unknown;
  const transport = json.transport;
  if (isRecord(transport) && isStreamableType(transport.type)) raw = transport.endpoint ?? transport.url;
  if (raw === undefined && Array.isArray(json.remotes)) {
    const remote = json.remotes.slice(0, 10).find((r): r is Record<string, unknown> => isRecord(r) && isStreamableType(r.type));
    raw = remote?.url;
  }
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let endpoint: string;
  try {
    endpoint = validateMcpUrl(new URL(raw, cardUrl).href);
  } catch {
    return null;
  }
  const info = isRecord(json.serverInfo) ? json.serverInfo : {};
  const out: ServerCardInfo = { endpoint };
  const name = firstString(json.title, info.title, json.name, info.name);
  if (name) {
    const clean = sanitizeDisplayText(name, DISCOVERY_LIMITS.maxNameChars);
    if (clean) out.name = clean;
  }
  const description = firstString(json.description, info.description);
  if (description) {
    const clean = sanitizeDisplayText(description, DISCOVERY_LIMITS.maxDescriptionChars);
    if (clean) out.description = clean;
  }
  const version = firstString(json.version, info.version);
  if (version) out.version = sanitizeDisplayText(version, 40);
  return out;
}

/** An MCP server card entry of an AI Catalog: the card inline, or where to get it. */
export type CatalogCardRef = { data: unknown; url?: undefined; name?: string } | { url: string; data?: undefined; name?: string };

/**
 * The MCP server card entries of an AI Catalog (`{ specVersion, entries: [{ identifier, type,
 * url | data, displayName? }] }`), at most `maxCardsPerSite`, `url`s resolved against the
 * catalog's URL. Entries of other types (registries, agents) are ignored.
 */
export function parseAiCatalog(json: unknown, catalogUrl: string): CatalogCardRef[] {
  if (!isRecord(json) || !Array.isArray(json.entries)) return [];
  const out: CatalogCardRef[] = [];
  for (const entry of json.entries.slice(0, DISCOVERY_LIMITS.maxCatalogEntries) as unknown[]) {
    if (out.length >= DISCOVERY_LIMITS.maxCardsPerSite) break;
    if (!isRecord(entry) || entry.type !== SERVER_CARD_TYPE) continue;
    const display = typeof entry.displayName === 'string' ? sanitizeDisplayText(entry.displayName, DISCOVERY_LIMITS.maxNameChars) : '';
    const named = display ? { name: display } : {};
    if (isRecord(entry.data)) {
      out.push({ data: entry.data, ...named });
    } else if (typeof entry.url === 'string' && entry.url.length <= 2048) {
      try {
        const u = new URL(entry.url, catalogUrl);
        if (u.protocol === 'https:' || u.protocol === 'http:') out.push({ url: u.href, ...named });
      } catch {
        // not a URL
      }
    }
  }
  return out;
}

/** The endpoint a card URL at the reserved location belongs to (`…/mcp/server-card` -> `…/mcp`), or null. */
export function endpointFromCardUrl(cardUrl: string): string | null {
  try {
    const u = new URL(cardUrl);
    if (u.search !== '' || u.hash !== '' || !u.pathname.endsWith(RESERVED_CARD_SUFFIX)) return null;
    u.pathname = u.pathname.slice(0, -RESERVED_CARD_SUFFIX.length) || '/';
    return validateMcpUrl(u.href);
  } catch {
    return null;
  }
}

function isStreamableType(type: unknown): boolean {
  return type === 'streamable-http' || type === 'streamableHttp' || type === 'http';
}

/** Control, invisible and bidirectional-control characters removed, whitespace collapsed, length capped. */
export function sanitizeDisplayText(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex -- removing control characters from untrusted text
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

const GENERIC_NAME_WORDS = new Set(['mcp', 'server', 'servers', 'remote', 'official', 'api', 'tools', 'the']);

/**
 * A valid `McpServerConfig.name` (used in tool names, `mcp__<name>__…`) for a discovered server.
 * The site's display name is used only when it matches the endpoint's host (letters and digits of
 * the name appear in the host): a card on `evil.example` calling itself "GitHub" gets `evil`, not
 * `github`. Otherwise the host gives the name.
 */
export function suggestServerName(name: string | undefined, host: string): string {
  const fromName = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents: "ü" -> "u"
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
    .replace(/-$/, '');
  // Generic words ("GitHub MCP Server") do not have to appear in the host; the rest does.
  const core = fromName
    .split('-')
    .filter((w) => !GENERIC_NAME_WORDS.has(w))
    .join('');
  const host36 = host.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (MCP_SERVER_NAME_PATTERN.test(fromName) && core !== '' && host36.includes(core)) return fromName;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host.replace(/\./g, '-');
  const labels = host.replace(/^www\./, '').split('.');
  const fromHost = (labels.length > 1 ? labels.slice(0, -1).join('-') : (labels[0] ?? ''))
    .replace(/[^a-z0-9_-]+/gi, '-')
    .slice(0, 32)
    .replace(/^-|-$/g, '');
  return MCP_SERVER_NAME_PATTERN.test(fromHost) ? fromHost.toLowerCase() : 'mcp';
}

/** A name not used by any configured server (case-insensitive), `name`, `name-2`, ... */
export function uniqueServerName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, 23)}-${Date.now().toString(36).slice(-8)}`;
}

/**
 * The origin to check for a page URL, or null when the page must not be probed: not http(s);
 * plain `http:` other than localhost (a card fetched in clear text could be tampered with).
 */
export function discoveryOrigin(pageUrl: string): URL | null {
  let u: URL;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  if (u.protocol === 'https:') return u;
  if (u.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(u.hostname)) return u;
  return null;
}

/** Normalised comparison key for endpoint URLs (trailing slash ignored). */
export function endpointKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.search === '' ? u.href.replace(/\/+$/, '') : u.href;
  } catch {
    return url;
  }
}

export interface ProbeResult {
  /** `yes`: answered JSON-RPC; `auth`: 401 with a Bearer challenge; `no`: something else. */
  mcp: 'yes' | 'auth' | 'no';
  /**
   * From the probe alone. A `server/discover` result does not prove the tools are open: modern
   * servers may answer discovery anonymously and protect everything else, so the site's protected
   * resource metadata naming the endpoint overrides `none` (see `probeSite`).
   */
  auth: 'none' | 'oauth' | 'unknown';
  /** The 401 named its RFC 9728 metadata. */
  resourceMetadata?: string;
  /** `serverInfo.title` / `name` from a `server/discover` result (cleaned). */
  serverName?: string;
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export function createMcpDiscovery(deps: McpDiscoveryDeps): McpDiscovery {
  const now = deps.now ?? (() => Date.now());
  const local = deps.local ?? chrome.storage.local;
  const session = deps.session ?? chrome.storage.session;
  const doFetch = deps.fetch ? (u: string, i: RequestInit) => (deps.fetch as typeof fetch)(u, i) : (u: string, i: RequestInit) => globalThis.fetch(u, i);
  const clientInfo = deps.clientInfo ?? { name: 'carbon-commander', version: '0' };

  const inFlight = new Map<string, Promise<DiscoveredMcpServer[]>>();
  const queue: (() => void)[] = [];
  let running = 0;
  let writes: Promise<unknown> = Promise.resolve();

  // --- storage -------------------------------------------------------------------------------

  async function readState(): Promise<StoredState> {
    const got = await local.get(STORAGE_KEYS.mcpDiscovered);
    const v = got[STORAGE_KEYS.mcpDiscovered];
    if (!isRecord(v) || v.v !== 1 || !Array.isArray(v.servers) || !Array.isArray(v.dismissed)) return { v: 1, servers: [], dismissed: [] };
    return {
      v: 1,
      servers: v.servers.filter(isStoredServer).slice(0, DISCOVERY_LIMITS.maxServers),
      dismissed: v.dismissed.filter((d): d is string => typeof d === 'string').slice(-DISCOVERY_LIMITS.maxDismissed),
    };
  }

  /** Serialised read-modify-write. */
  function mutate(fn: (s: StoredState) => StoredState): Promise<void> {
    const run = writes.then(async () => {
      const next = fn(await readState());
      const cutoff = now() - DISCOVERY_LIMITS.maxAgeMs;
      next.servers = next.servers
        .filter((s) => s.lastSeenAt >= cutoff)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .slice(0, DISCOVERY_LIMITS.maxServers);
      next.dismissed = [...new Set(next.dismissed)].slice(-DISCOVERY_LIMITS.maxDismissed);
      await local.set({ [STORAGE_KEYS.mcpDiscovered]: next });
    });
    writes = run.catch(() => undefined);
    return run;
  }

  async function checkedAt(origin: string): Promise<number | undefined> {
    const got = await session.get(STORAGE_KEYS.mcpDiscoveryChecked).catch((): Record<string, unknown> => ({}));
    const map = got[STORAGE_KEYS.mcpDiscoveryChecked];
    const at = isRecord(map) ? map[origin] : undefined;
    return typeof at === 'number' ? at : undefined;
  }

  function markChecked(origin: string): Promise<void> {
    const run = writes.then(async () => {
      const got = await session.get(STORAGE_KEYS.mcpDiscoveryChecked).catch((): Record<string, unknown> => ({}));
      const map = isRecord(got[STORAGE_KEYS.mcpDiscoveryChecked]) ? { ...(got[STORAGE_KEYS.mcpDiscoveryChecked] as Record<string, number>) } : {};
      map[origin] = now();
      const entries = Object.entries(map);
      const pruned =
        entries.length > DISCOVERY_LIMITS.maxCheckedOrigins
          ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, DISCOVERY_LIMITS.maxCheckedOrigins))
          : map;
      await session.set({ [STORAGE_KEYS.mcpDiscoveryChecked]: pruned });
    });
    writes = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  function unmarkChecked(origin: string): Promise<void> {
    const run = writes.then(async () => {
      const got = await session.get(STORAGE_KEYS.mcpDiscoveryChecked).catch((): Record<string, unknown> => ({}));
      const map = got[STORAGE_KEYS.mcpDiscoveryChecked];
      if (!isRecord(map) || !(origin in map)) return;
      const next = { ...(map as Record<string, number>) };
      delete next[origin];
      await session.set({ [STORAGE_KEYS.mcpDiscoveryChecked]: next });
    });
    writes = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  // --- network -------------------------------------------------------------------------------

  async function request(url: string, init: RequestInit): Promise<Response | null> {
    try {
      const res = await doFetch(url, {
        ...init,
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(DISCOVERY_LIMITS.timeoutMs),
      });
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        void res.body?.cancel().catch(() => undefined);
        return null;
      }
      return res;
    } catch {
      return null;
    }
  }

  async function getJson(url: string, accept = 'application/json'): Promise<unknown> {
    const res = await request(url, { method: 'GET', headers: { Accept: accept } });
    if (!res) return undefined;
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (res.status !== 200 || !type.includes('json')) {
      void res.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const text = await readCapped(res, DISCOVERY_LIMITS.maxDocumentBytes);
    if (text === null) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  /** One unauthenticated `server/discover` (no cookies, no credentials). */
  async function probe(endpoint: string): Promise<ProbeResult> {
    const version = MODERN_PROTOCOL_VERSIONS[0] as string;
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': version,
          'io.modelcontextprotocol/clientInfo': clientInfo,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    const res = await request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': version,
        'Mcp-Method': 'server/discover',
      },
      body: JSON.stringify(body),
    });
    if (!res) return { mcp: 'no', auth: 'unknown' };
    return classifyProbe(res);
  }

  // --- probing a site ------------------------------------------------------------------------

  async function probeSite(page: URL): Promise<DiscoveredMcpServer[]> {
    const origin = page.origin;
    const pagePrivate = blockedHostReason(page) !== null;
    const catalogUrl = `${origin}${AI_CATALOG_PATH}`;
    const [catalogJson, prmJson] = await Promise.all([
      getJson(catalogUrl, 'application/ai-catalog+json, application/json'),
      getJson(`${origin}${PROTECTED_RESOURCE_PATH}`),
    ]);
    const t = now();
    const found: DiscoveredMcpServer[] = [];

    let prmResource: string | undefined;
    let prmIssuer: string | undefined;
    if (prmJson !== undefined && isRecord(prmJson) && typeof prmJson.resource === 'string') {
      try {
        const resource = validateMcpUrl(prmJson.resource);
        const prm = parseProtectedResourceMetadata(prmJson, resource, `${origin}${PROTECTED_RESOURCE_PATH}`);
        if (new URL(resource).origin === origin) {
          prmResource = resource;
          prmIssuer = prm.authorizationServers[0];
        }
      } catch {
        // not usable
      }
    }

    const make = (endpoint: string, source: DiscoveredMcpServer['source'], name: string | undefined, result: ProbeResult | null, extra: Partial<DiscoveredMcpServer>): DiscoveredMcpServer => {
      const u = new URL(endpoint);
      const display = name ?? u.host;
      const entry: DiscoveredMcpServer = {
        key: endpointKey(endpoint),
        endpoint,
        endpointHost: u.host,
        name: display,
        suggestedName: suggestServerName(name, u.hostname),
        foundOn: origin,
        sameOrigin: u.origin === origin,
        source,
        auth: result?.auth ?? 'unknown',
        discoveredAt: t,
        lastSeenAt: t,
        ...extra,
      };
      return entry;
    };
    /** A private / loopback endpoint advertised by a public site is dropped. */
    const acceptable = (endpoint: string): boolean => {
      if (blockedHostReason(new URL(endpoint)) !== null && !pagePrivate) {
        log.debug('Ignoring an MCP server that a public site places at a private address');
        return false;
      }
      return !found.some((f) => f.key === endpointKey(endpoint));
    };

    // Cards: the AI catalog's first; the legacy well-known card only when the catalog is absent,
    // unauthorised or names no MCP server.
    const cards: { card: ServerCardInfo; source: DiscoveredMcpServer['source']; name?: string | undefined }[] = [];
    const refs = catalogJson === undefined ? [] : parseAiCatalog(catalogJson, catalogUrl);
    for (const ref of refs) {
      if (ref.url === undefined) {
        const card = parseServerCard(ref.data, catalogUrl);
        if (card) cards.push({ card, source: 'catalog', name: ref.name });
      } else if (new URL(ref.url).origin === origin) {
        const json = await getJson(ref.url, `${SERVER_CARD_TYPE}, application/json`);
        const card = json === undefined ? null : parseServerCard(json, ref.url);
        if (card) cards.push({ card, source: 'catalog', name: ref.name });
      } else {
        // A card on another host is not fetched (privacy); its reserved location names the endpoint.
        const endpoint = endpointFromCardUrl(ref.url);
        if (endpoint && acceptable(endpoint)) found.push(make(endpoint, 'catalog', ref.name, null, {}));
      }
    }
    if (refs.length === 0) {
      const legacyUrl = `${origin}${LEGACY_SERVER_CARD_PATH}`;
      const json = await getJson(legacyUrl);
      const card = json === undefined ? null : parseServerCard(json, legacyUrl);
      if (card) cards.push({ card, source: 'server-card' });
    }

    for (const { card, source, name } of cards) {
      if (!acceptable(card.endpoint)) continue;
      const sameOrigin = new URL(card.endpoint).origin === origin;
      const result = sameOrigin ? await probe(card.endpoint) : null;
      const extra: Partial<DiscoveredMcpServer> = {};
      if (card.description) extra.description = card.description;
      if (card.version) extra.version = card.version;
      const protectedByPrm = !!prmResource && endpointKey(prmResource) === endpointKey(card.endpoint);
      if (protectedByPrm && prmIssuer) extra.authorizationServer = prmIssuer;
      // The site declares the endpoint a protected resource (RFC 9728): sign-in needed.
      if (protectedByPrm && result?.mcp !== 'no') extra.auth = 'oauth';
      found.push(make(card.endpoint, source, card.name ?? name ?? result?.serverName, result, extra));
    }

    if (prmResource && !found.some((f) => f.key === endpointKey(prmResource))) {
      const result = await probe(prmResource);
      if (result.mcp === 'yes' || (result.mcp === 'auth' && result.resourceMetadata)) {
        // An MCP endpoint the site declares a protected resource: it needs OAuth, even when it
        // answers `server/discover` anonymously.
        const extra: Partial<DiscoveredMcpServer> = { auth: 'oauth' };
        if (prmIssuer) extra.authorizationServer = prmIssuer;
        found.push(make(prmResource, 'protected-resource', result.serverName, result, extra));
      }
    }
    return found;
  }

  function schedule<T>(job: () => Promise<T>): Promise<T> | null {
    if (running >= DISCOVERY_LIMITS.concurrency && queue.length >= DISCOVERY_LIMITS.maxQueue) return null;
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        running++;
        job()
          .then(resolve, reject)
          .finally(() => {
            running--;
            queue.shift()?.();
          });
      };
      if (running < DISCOVERY_LIMITS.concurrency) start();
      else queue.push(start);
    });
  }

  async function check(url: string, info: { incognito?: boolean } = {}): Promise<DiscoveredMcpServer[]> {
    if (info.incognito) return [];
    const page = discoveryOrigin(url);
    if (!page) return [];
    const settings: Settings = await deps.settings.get();
    if (!settings.mcpDiscovery) return [];
    const origin = page.origin;
    const existing = inFlight.get(origin);
    if (existing) return existing;
    const at = await checkedAt(origin);
    if (at !== undefined && now() - at < DISCOVERY_LIMITS.recheckMs) {
      return (await readState()).servers.filter((s) => s.foundOn === origin);
    }
    const job = schedule(async () => {
      await markChecked(origin);
      const found = await probeSite(page);
      let deferred = 0;
      if (found.length > 0) {
        await mutate((s) => {
          const servers = [...s.servers];
          // New entries per hour are capped, so a site cycling through subdomains cannot flood
          // the list (and push the real entries out); the rest waits for a later visit.
          let recent = servers.filter((x) => x.discoveredAt > now() - 3600_000).length;
          for (const f of found) {
            const i = servers.findIndex((x) => x.key === f.key);
            if (i >= 0) {
              servers[i] = { ...f, discoveredAt: (servers[i] as DiscoveredMcpServer).discoveredAt };
            } else if (recent < DISCOVERY_LIMITS.maxNewPerHour) {
              servers.push(f);
              recent++;
            } else {
              deferred++;
            }
          }
          return { ...s, servers };
        });
        if (deferred > 0) await unmarkChecked(origin);
        log.debug(`Found ${found.length} MCP server(s) on ${origin}${deferred > 0 ? ` (${deferred} deferred: too many new ones this hour)` : ''}`);
      }
      return deferred > 0 ? found.slice(0, found.length - deferred) : found;
    });
    if (!job) return [];
    const tracked = job.finally(() => inFlight.delete(origin));
    inFlight.set(origin, tracked);
    return tracked;
  }

  async function withAdded(servers: DiscoveredMcpServer[]): Promise<DiscoveredMcpServer[]> {
    const configured = (await deps.settings.get()).mcpServers;
    return servers.map((s) => {
      const match = configured.find((c) => endpointKey(c.url) === s.key);
      return match ? { ...s, addedServerId: match.id } : { ...s };
    });
  }

  return {
    onNavigation(url, info) {
      check(url, info).catch((err: unknown) => log.debug('MCP discovery failed', err));
    },
    check,
    async list() {
      const s = await readState();
      const dismissed = new Set(s.dismissed);
      return withAdded(s.servers.filter((x) => !dismissed.has(x.key)));
    },
    async forPage(url) {
      const page = discoveryOrigin(url);
      if (!page) return [];
      const s = await readState();
      const dismissed = new Set(s.dismissed);
      const all = await withAdded(s.servers.filter((x) => x.foundOn === page.origin && !dismissed.has(x.key)));
      return all.filter((x) => x.addedServerId === undefined);
    },
    async get(key) {
      return (await readState()).servers.find((s) => s.key === key);
    },
    dismiss(key) {
      return mutate((s) => ({ ...s, dismissed: [...s.dismissed, key] }));
    },
    async clear() {
      await mutate(() => ({ v: 1, servers: [], dismissed: [] }));
      await session.remove(STORAGE_KEYS.mcpDiscoveryChecked).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------------------------

export type DiscoveryRpcMethod =
  | 'mcp.discovered.list'
  | 'mcp.discovered.forTab'
  | 'mcp.discovered.add'
  | 'mcp.discovered.dismiss'
  | 'mcp.discovered.clear';

export function createDiscoveryRpcHandlers(deps: {
  discovery: McpDiscovery;
  manager: Pick<McpManager, 'add'>;
  settings: Pick<SettingsStore, 'get'>;
  /** URL of the target tab (the sender's tab by default). */
  tabUrl(tabId: number | undefined, sender: chrome.runtime.MessageSender): Promise<string>;
}): Pick<RpcHandlers, DiscoveryRpcMethod> {
  const key = (params: unknown): string => {
    const k = isRecord(params) ? params.key : undefined;
    if (typeof k !== 'string' || k.length > 2048) throw new CcError('invalid', 'Missing key');
    return k;
  };
  return {
    'mcp.discovered.list': () => deps.discovery.list(),
    'mcp.discovered.forTab': async (params, sender) => {
      const raw = isRecord(params) ? params.tabId : undefined;
      if (raw !== undefined && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0)) throw new CcError('invalid', 'Invalid tabId');
      const url = await deps.tabUrl(raw, sender).catch(() => '');
      return url ? deps.discovery.forPage(url) : [];
    },
    'mcp.discovered.add': async (params): Promise<McpServerStatus> => {
      const entry = await deps.discovery.get(key(params));
      if (!entry) throw new CcError('invalid', 'This discovered server is no longer listed');
      const url = validateMcpUrl(entry.endpoint);
      const configured = (await deps.settings.get()).mcpServers;
      if (configured.some((c) => endpointKey(c.url) === endpointKey(url))) throw new CcError('invalid', 'This server is already added');
      const name = uniqueServerName(MCP_SERVER_NAME_PATTERN.test(entry.suggestedName) ? entry.suggestedName : 'mcp', configured.map((c) => c.name));
      return deps.manager.add({ name, url, enabled: true });
    },
    'mcp.discovered.dismiss': (params) => deps.discovery.dismiss(key(params)),
    'mcp.discovered.clear': () => deps.discovery.clear(),
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Classify the answer to the unauthenticated probe. Exported for tests. */
export async function classifyProbe(res: Response): Promise<ProbeResult> {
  if (res.status === 401) {
    void res.body?.cancel().catch(() => undefined);
    const challenge = bearerChallenge(res.headers.get('www-authenticate'));
    if (!challenge) return { mcp: 'no', auth: 'unknown' };
    return challenge.resourceMetadata ? { mcp: 'auth', auth: 'oauth', resourceMetadata: challenge.resourceMetadata } : { mcp: 'auth', auth: 'oauth' };
  }
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('text/event-stream')) {
    void res.body?.cancel().catch(() => undefined);
    return res.ok ? { mcp: 'yes', auth: 'none' } : { mcp: 'no', auth: 'unknown' };
  }
  if (type.includes('json')) {
    const text = await readCapped(res, DISCOVERY_LIMITS.maxDocumentBytes);
    try {
      const parsed: unknown = text === null ? undefined : JSON.parse(text);
      const messages = Array.isArray(parsed) ? parsed.slice(0, 5) : [parsed];
      const answer = messages.find((m): m is Record<string, unknown> => isRecord(m) && m.jsonrpc === '2.0' && ('result' in m || 'error' in m));
      if (answer) {
        // Answered without asking for credentials (an error too: legacy servers reject
        // `server/discover`). Servers that open only discovery publish protected resource metadata
        // for the endpoint, which `probeSite` applies on top.
        const out: ProbeResult = { mcp: 'yes', auth: res.status === 403 ? 'unknown' : 'none' };
        const name = isRecord(answer.result) ? discoverName(answer.result) : undefined;
        if (name) out.serverName = name;
        return out;
      }
    } catch {
      // not JSON
    }
    return { mcp: 'no', auth: 'unknown' };
  }
  void res.body?.cancel().catch(() => undefined);
  return { mcp: 'no', auth: 'unknown' };
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Display name from a `server/discover` result (`_meta` serverInfo, or a top-level serverInfo). */
function discoverName(result: Record<string, unknown>): string | undefined {
  const meta = isRecord(result._meta) ? result._meta : {};
  const info = isRecord(meta['io.modelcontextprotocol/serverInfo']) ? meta['io.modelcontextprotocol/serverInfo'] : isRecord(result.serverInfo) ? result.serverInfo : {};
  const name = firstString(info.title, info.name);
  const clean = name ? sanitizeDisplayText(name, DISCOVERY_LIMITS.maxNameChars) : '';
  return clean || undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) if (typeof v === 'string' && v.trim() !== '') return v;
  return undefined;
}

function isStoredServer(v: unknown): v is DiscoveredMcpServer {
  return (
    isRecord(v) &&
    typeof v.key === 'string' &&
    typeof v.endpoint === 'string' &&
    typeof v.name === 'string' &&
    typeof v.suggestedName === 'string' &&
    typeof v.foundOn === 'string' &&
    typeof v.lastSeenAt === 'number' &&
    typeof v.discoveredAt === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
