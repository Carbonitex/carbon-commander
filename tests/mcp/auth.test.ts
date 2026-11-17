import { describe, expect, it, vi } from 'vitest';
import { createMemoryBackend, createSecretStore } from '../../src/background/secrets';
import { createSettingsStore } from '../../src/background/settings';
import { createMcpOAuth, type McpOAuthDeps, type McpSignInOptions } from '../../src/mcp/auth';
import { createMcpManager, createMcpRpcHandlers, type McpManager } from '../../src/mcp/manager';
import { STORAGE_KEYS, mcpOAuthSecretName } from '../../src/shared/defaults';
import { dispatchRpc } from '../../src/shared/protocol';
import type { McpServerConfig, McpSignInPlan, TabContext, ToolCallContext } from '../../src/shared/types';
import { createFakeStorageArea } from '../helpers/fake-storage';
import { createMockMcpServer, defaultMockTools } from '../helpers/mock-mcp-server';
import { createMockOAuthServer, type MockOAuthOptions } from '../helpers/mock-oauth-server';

const MCP_URL = 'https://mcp.example.com/mcp';
const ISSUER = 'https://auth.example.com';
const REDIRECT = 'https://abcdefghijklmnop.chromiumapp.org/mcp-oauth';
const TAB: TabContext = { tabId: 1, windowId: 1, url: 'https://example.com/', title: 'Example' };
const ctx = (): ToolCallContext => ({ tab: TAB, signal: new AbortController().signal, toolCallId: 'c1' });

function setup(asOptions: Partial<MockOAuthOptions> = {}, oauthDeps: Partial<McpOAuthDeps> = {}) {
  const as = createMockOAuthServer({ issuer: ISSUER, resource: MCP_URL, scopesSupported: ['read', 'write'], ...asOptions });
  const tools = defaultMockTools();
  tools.push({
    name: 'delete_all',
    description: 'Needs the admin scope',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({ content: [{ type: 'text', text: 'deleted' }] }),
  });
  const mcp = createMockMcpServer({ authorize: as.authorize, tools });
  const requests: string[] = [];
  /** Answers to matching requests are held until released (the server already acted on them). */
  const holds: { match: (path: string, body: string) => boolean; until: Promise<void> }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.host}${url.pathname}`);
    const body = typeof init?.body === 'string' ? init.body : '';
    const response = url.href === MCP_URL ? await mcp.handle(request) : ((await as.handle(request)) ?? new Response('Not found', { status: 404 }));
    for (const h of holds) if (h.match(url.pathname, body)) await h.until;
    return response;
  };
  const settings = createSettingsStore(createFakeStorageArea());
  const backend = createMemoryBackend();
  const secrets = createSecretStore({ backend, legacy: createFakeStorageArea() });
  const session = createFakeStorageArea();
  let clock = 1_000_000;
  const launches: string[] = [];
  const deps: McpOAuthDeps = {
    secrets,
    fetch: fetchFn,
    now: () => clock,
    session,
    redirectUri: () => REDIRECT,
    keepAlive: () => () => undefined,
    launchWebAuthFlow: async (url) => {
      launches.push(url);
      return as.approve(url);
    },
    ...oauthDeps,
  };
  const oauth = createMcpOAuth(deps);
  let ids = 0;
  const manager = createMcpManager({ settings, secrets, fetch: fetchFn, oauth, newId: () => `s${++ids}`, now: () => clock, retryBackoffMs: 0 });
  return {
    as,
    mcp,
    manager,
    oauth,
    settings,
    secrets,
    backend,
    session,
    deps,
    launches,
    requests,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
    /** Hold matching requests; returns the release function. */
    hold(match: (path: string, body: string) => boolean): () => void {
      let release = (): void => undefined;
      holds.push({ match, until: new Promise<void>((r) => (release = r)) });
      return () => release();
    },
  };
}

/** What the settings UI sends: the plan in the server's status, as shown (or with `pick`ed scopes). */
async function confirmed(
  manager: Pick<McpManager, 'list'>,
  id: string,
  options: { stepUp?: boolean; pick?: (plan: McpSignInPlan) => string[] } = {},
): Promise<McpSignInOptions> {
  const plan = (await manager.list()).find((s) => s.id === id)?.oauth?.plan;
  if (!plan) throw new Error('no sign-in plan in the status');
  return {
    ...(options.stepUp ? { stepUp: true } : {}),
    confirm: { authorizationHost: plan.authorizationHost, scopes: options.pick ? options.pick(plan) : plan.selected },
  };
}

describe('MCP OAuth', () => {
  it('a signed-out server reports "sign-in required" with its authorization server, and never opens a window by itself', async () => {
    const t = setup();
    const status = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    expect(status.state).toBe('error');
    expect(status.oauth).toMatchObject({ state: 'required', issuer: ISSUER });
    // The agent: no tools, and a direct call is told to ask the user (no interactive flow).
    expect(await t.manager.listTools(TAB)).toEqual([]);
    expect(t.launches).toEqual([]);
    // Only read-only discovery GETs reached the authorization server.
    expect(t.as.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(t.as.clients.size).toBe(0);
  });

  it('signs in (DCR, PKCE, resource, state, iss), stores tokens encrypted, and calls tools with the token', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    const status = await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    expect(status.state).toBe('connected');
    expect(status.oauth).toMatchObject({ state: 'signed-in', issuer: ISSUER, clientSource: 'dynamic', canRefresh: true, scope: 'read write' });
    expect(status.oauth?.expiresAt).toBe(t.now() + 3600_000);
    expect(t.launches).toHaveLength(1);
    const auth = new URL(t.launches[0] as string);
    expect(auth.searchParams.get('resource')).toBe(MCP_URL);
    expect(auth.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(auth.searchParams.get('scope')).toBe('read write'); // from the challenge
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');

    const specs = await t.manager.listTools(TAB);
    expect(specs.map((s) => s.name)).toContain('mcp__oa__add');
    const result = await t.manager.callTool('mcp__oa__add', { a: 2, b: 3 }, ctx());
    expect(result).toMatchObject({ ok: true, content: '5' });

    // No token in any RPC result, nor in the secret store in clear text.
    const rpc = createMcpRpcHandlers(t.manager);
    const listed = await dispatchRpc(rpc, { rpc: 'mcp.list', params: undefined }, {});
    const token = [...t.as.accessTokens.keys()][0] as string;
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify([...t.backend.values.values()].map((v) => Array.from(v.ct)))).not.toContain(token);
    // ... but it is in the encrypted record.
    expect(await t.secrets.get(mcpOAuthSecretName(added.id))).toContain(token);
    // The token only went to the MCP server (the AS saw the code / refresh token, not the bearer).
    const bearerTo = t.mcp.requests.filter((r) => r.headers.authorization === `Bearer ${token}`);
    expect(bearerTo.length).toBeGreaterThan(0);
  });

  it('reuses the dynamic registration on the next sign-in; a manual client id skips registration', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.signOut(added.id);
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    expect(t.as.requests.filter((r) => r.path === '/oauth/register')).toHaveLength(1);

    const m = setup({ registration: false });
    const s = await m.manager.add({ name: 'manual', url: MCP_URL, enabled: true });
    await expect(m.manager.signIn(s.id, await confirmed(m.manager, s.id))).rejects.toThrow(/does not allow automatic client registration.*redirect URI https:\/\/abcdefghijklmnop/);
    expect((await m.manager.list())[0]?.oauth).toMatchObject({ state: 'failed' });
    m.as.clients.set('my-client', { redirectUris: [REDIRECT], name: 'manual' });
    await m.manager.update(s.id, { oauthClientId: 'my-client' });
    const ok = await m.manager.signIn(s.id, await confirmed(m.manager, s.id));
    expect(ok.oauth).toMatchObject({ state: 'signed-in', clientSource: 'manual' });
    expect(new URL(m.launches.at(-1) as string).searchParams.get('client_id')).toBe('my-client');
  });

  it('refreshes proactively near expiry', async () => {
    const t = setup({ accessTokenTtlS: 120 });
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    const before = t.as.requests.filter((r) => r.form?.grant_type === 'refresh_token').length;
    t.advance(90_000); // within the 60 s skew
    await t.manager.listTools(TAB);
    const r = await t.manager.callTool('mcp__oa__echo', { text: 'hi' }, ctx());
    expect(r).toMatchObject({ ok: true, content: 'hi' });
    expect(t.as.requests.filter((x) => x.form?.grant_type === 'refresh_token').length).toBe(before + 1);
  });

  it('refreshes reactively on 401 once, shared by concurrent requests (single-flight), then retries', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.listTools(TAB);
    t.as.expireAccessTokens(); // the server now rejects the token although we think it is valid
    const results = await Promise.all([1, 2, 3].map((n) => t.manager.callTool('mcp__oa__echo', { text: `n${n}` }, ctx())));
    expect(results.map((r) => r.content)).toEqual(['n1', 'n2', 'n3']);
    expect(t.as.requests.filter((r) => r.form?.grant_type === 'refresh_token')).toHaveLength(1);
  });

  it('a revoked grant ends in "sign-in required", and the tool result tells the model to ask the user', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.listTools(TAB);
    t.as.revokeAll();
    const r = await t.manager.callTool('mcp__oa__echo', { text: 'x' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/requires sign-in.*Settings → MCP.*Do not retry/);
    expect(t.launches).toHaveLength(1); // the first, user-started sign-in only
    const status = (await t.manager.list())[0];
    expect(status?.oauth).toMatchObject({ state: 'required', error: 'The sign-in expired or was revoked; sign in again.' });
  });

  it('step-up: insufficient_scope is reported, and signing in again asks for the union of scopes', async () => {
    const t = setup({ scopesSupported: ['read', 'write'], toolScopes: { delete_all: 'admin' } });
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.listTools(TAB);
    const r = await t.manager.callTool('mcp__oa__delete_all', {}, ctx());
    expect(r).toMatchObject({ ok: false });
    expect(r.content).toMatch(/needs more permissions.*Sign in again/);
    expect((await t.manager.list())[0]?.oauth).toMatchObject({ state: 'insufficient-scope', requiredScope: 'admin' });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id, { stepUp: true }));
    expect(new URL(t.launches.at(-1) as string).searchParams.get('scope')).toBe('read write admin');
    const again = await t.manager.callTool('mcp__oa__delete_all', {}, ctx());
    expect(again).toMatchObject({ ok: true, content: 'deleted' });
  });

  it('sign out revokes both tokens and deletes them', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    const access = [...t.as.accessTokens.keys()][0];
    const refresh = [...t.as.refreshTokens.keys()][0];
    const status = await t.manager.signOut(added.id);
    expect(t.as.revoked).toEqual([refresh, access]);
    expect(status.oauth?.state).toBe('required');
    expect(await t.secrets.get(mcpOAuthSecretName(added.id))).not.toContain(access as string);
    // Removing the server forgets the record entirely.
    await t.manager.remove(added.id);
    expect(await t.secrets.get(mcpOAuthSecretName(added.id))).toBeNull();
  });

  it('an interrupted sign-in (worker stopped mid-flow) is reported and can be retried', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    // The window never comes back (the worker dies while it is open).
    const hanging = createMcpOAuth({ ...t.deps, launchWebAuthFlow: () => new Promise<string>(() => undefined) });
    const config = (await t.settings.get()).mcpServers[0];
    if (!config) throw new Error('no config');
    void hanging.signIn(config, { confirm: { authorizationHost: 'auth.example.com', scopes: ['read', 'write'] } });
    await vi.waitFor(async () => {
      expect((await t.session.get(STORAGE_KEYS.mcpOAuthPending))[STORAGE_KEYS.mcpOAuthPending]).toBeDefined();
    });
    expect(await hanging.status(config)).toMatchObject({ state: 'in-progress' });
    // A new worker (fresh instances, same storage).
    const oauth2 = createMcpOAuth(t.deps);
    const manager2 = createMcpManager({ settings: t.settings, secrets: t.secrets, fetch: t.deps.fetch, oauth: oauth2 });
    const s = (await manager2.list())[0];
    expect(s?.oauth).toMatchObject({ state: 'interrupted' });
    expect(s?.oauth?.error).toMatch(/interrupted/);
    const ok = await manager2.signIn(added.id, await confirmed(manager2, added.id));
    expect(ok.oauth?.state).toBe('signed-in');
    expect((await t.session.get(STORAGE_KEYS.mcpOAuthPending))[STORAGE_KEYS.mcpOAuthPending]).toEqual({});
  });

  it('rejects a forged or mixed-up response and reports a cancelled window', async () => {
    const forged = setup({}, {});
    forged.deps.launchWebAuthFlow = async (url) => {
      const back = new URL(await forged.as.approve(url));
      back.searchParams.set('state', 'attacker');
      return back.href;
    };
    const oauthForged = createMcpOAuth(forged.deps);
    const m1 = createMcpManager({ settings: forged.settings, secrets: forged.secrets, fetch: forged.deps.fetch, oauth: oauthForged, newId: () => 'x1' });
    const a = await m1.add({ name: 'oa', url: MCP_URL, enabled: true });
    await expect(m1.signIn(a.id, await confirmed(m1, a.id))).rejects.toThrow(/state mismatch/);

    const mixed = setup();
    mixed.deps.launchWebAuthFlow = async (url) => {
      const back = new URL(await mixed.as.approve(url));
      back.searchParams.set('iss', 'https://evil.example.com');
      return back.href;
    };
    const m2 = createMcpManager({ settings: mixed.settings, secrets: mixed.secrets, fetch: mixed.deps.fetch, oauth: createMcpOAuth(mixed.deps), newId: () => 'x2' });
    const b = await m2.add({ name: 'oa', url: MCP_URL, enabled: true });
    await expect(m2.signIn(b.id, await confirmed(m2, b.id))).rejects.toThrow(/issuer mismatch/);
    expect(mixed.as.requests.some((r) => r.path === '/oauth/token')).toBe(false);

    const cancelled = setup({}, { launchWebAuthFlow: () => Promise.reject(new Error('The user did not approve access.')) });
    const c = await cancelled.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await expect(cancelled.manager.signIn(c.id, await confirmed(cancelled.manager, c.id))).rejects.toThrow(/cancelled/);
    expect((await cancelled.manager.list())[0]?.oauth).toMatchObject({ state: 'failed', error: 'Sign-in was cancelled (the window was closed).' });
  });

  it('a server with a saved token keeps using it and gets no OAuth state; changing the URL forgets the tokens', async () => {
    const t = setup();
    const s = await t.manager.add({ name: 'tok', url: MCP_URL, enabled: true }, { bearerToken: 'static' });
    expect(s.oauth).toBeUndefined();
    await expect(t.manager.signIn(s.id, { confirm: { authorizationHost: 'auth.example.com', scopes: [] } })).rejects.toThrow(/saved token/);

    const u = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(u.id, await confirmed(t.manager, u.id));
    expect(await t.secrets.get(mcpOAuthSecretName(u.id))).not.toBeNull();
    await t.manager.update(u.id, { url: 'https://mcp.example.com/mcp2' });
    expect(await t.secrets.get(mcpOAuthSecretName(u.id))).toBeNull();
  });

  it('a server whose discovery is public but whose tools need a token ends at "sign-in required"', async () => {
    const t = setup();
    const authorize = t.mcp.options.authorize;
    t.mcp.options.authorize = (req) => (req.rpcMethod === 'server/discover' ? null : (authorize?.(req) ?? null));
    const status = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    expect(status.oauth).toMatchObject({ state: 'required', issuer: ISSUER });
    expect(t.launches).toEqual([]);
    const signedIn = await t.manager.signIn(status.id, await confirmed(t.manager, status.id));
    expect(signedIn).toMatchObject({ state: 'connected', toolCount: 3 });
  });

  it('before any window: the plan names the sign-in host and the scopes (challenge first, else scopes_supported, else none); a scope left out stays out', async () => {
    const t = setup({ scopesSupported: ['read', 'write', 'admin'], challengeScope: null });
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    expect(added.oauth?.plan).toEqual({
      authorizationHost: 'auth.example.com',
      issuer: ISSUER,
      serverHost: 'mcp.example.com',
      crossSite: false,
      scopeSource: 'resource-metadata',
      scopes: ['read', 'write', 'admin'],
      selected: ['read', 'write', 'admin'],
      required: [],
    });
    expect(t.launches).toEqual([]);
    expect(t.as.requests.every((r) => r.method === 'GET')).toBe(true); // read-only until the click
    // The user unchecks "admin": only read + write are requested, and that is remembered.
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id, { pick: (p) => p.scopes.filter((x) => x !== 'admin') }));
    expect(new URL(t.launches[0] as string).searchParams.get('scope')).toBe('read write');
    await t.manager.signOut(added.id);
    expect((await t.manager.list())[0]?.oauth?.plan).toMatchObject({ scopes: ['read', 'write', 'admin'], selected: ['read', 'write'] });

    const c = setup({ scopesSupported: ['read', 'write', 'admin'], challengeScope: 'read' });
    expect((await c.manager.add({ name: 'oa', url: MCP_URL, enabled: true })).oauth?.plan).toMatchObject({ scopeSource: 'challenge', scopes: ['read'] });

    const n = setup({ scopesSupported: [], challengeScope: null });
    const none = await n.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    expect(none.oauth?.plan).toMatchObject({ scopeSource: 'none', scopes: [], selected: [] });
    await n.manager.signIn(none.id, await confirmed(n.manager, none.id));
    expect(new URL(n.launches[0] as string).searchParams.has('scope')).toBe(false);
  });

  it('a sign-in page on another site is called out; a sign-in host that changed after it was shown is refused (no window)', async () => {
    const t = setup({ authorizationEndpoint: 'https://login.other-site.test/oauth/authorize' });
    t.deps.launchWebAuthFlow = async (url) => {
      t.launches.push(url);
      return t.as.approve(url.replace(/^https:\/\/[^/]+\/(?:oauth\/)?authorize/, `${ISSUER}/oauth/authorize`));
    };
    const oauth = createMcpOAuth(t.deps);
    const manager = createMcpManager({ settings: t.settings, secrets: t.secrets, fetch: t.deps.fetch, oauth, newId: () => 'x', now: t.now });
    const added = await manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    expect(added.oauth?.plan).toMatchObject({ authorizationHost: 'login.other-site.test', serverHost: 'mcp.example.com', crossSite: true });
    const shown = await confirmed(manager, added.id);

    // The server's metadata now sends the user elsewhere: refused before anything is opened.
    t.as.options.authorizationEndpoint = 'https://accounts.evil.test/authorize';
    await expect(manager.signIn(added.id, shown)).rejects.toThrow(/now on accounts\.evil\.test, not on login\.other-site\.test/);
    expect(t.launches).toEqual([]);
    expect(t.as.clients.size).toBe(0); // not even a registration
    // The status now shows the new host; signing in after seeing it goes there.
    expect((await manager.list())[0]?.oauth?.plan?.authorizationHost).toBe('accounts.evil.test');
    expect((await manager.signIn(added.id, await confirmed(manager, added.id))).oauth?.state).toBe('signed-in');
    expect(new URL(t.launches[0] as string).host).toBe('accounts.evil.test');
  });

  it('refuses scopes that are not offered, an empty selection, and leaving out the scope a step-up is for', async () => {
    const t = setup({ toolScopes: { delete_all: 'admin' } });
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    const host = 'auth.example.com';
    await expect(t.manager.signIn(added.id, { confirm: { authorizationHost: host, scopes: ['read', 'superuser'] } })).rejects.toThrow(/No longer offered: superuser/);
    await expect(t.manager.signIn(added.id, { confirm: { authorizationHost: host, scopes: [] } })).rejects.toThrow(/at least one scope/);
    expect(t.launches).toEqual([]);
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.listTools(TAB);
    await t.manager.callTool('mcp__oa__delete_all', {}, ctx());
    const plan = (await t.manager.list())[0]?.oauth?.plan;
    expect(plan).toMatchObject({ scopeSource: 'step-up', scopes: ['read', 'write', 'admin'], required: ['admin'] });
    await expect(t.manager.signIn(added.id, { stepUp: true, confirm: { authorizationHost: host, scopes: ['read', 'write'] } })).rejects.toThrow(/needs admin/);
    expect(t.launches).toHaveLength(1);
    // Dropping a previously granted scope in a step-up is the user's choice.
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id, { stepUp: true, pick: () => ['read', 'admin'] }));
    expect(new URL(t.launches.at(-1) as string).searchParams.get('scope')).toBe('read admin');
  });

  it('a refresh that finishes after sign-out does not bring the tokens back', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.listTools(TAB);
    t.as.expireAccessTokens();
    const release = t.hold((path, body) => path === '/oauth/token' && body.includes('grant_type=refresh_token'));
    const tokenCalls = (): number => t.requests.filter((r) => r.endsWith('/oauth/token')).length;
    const before = tokenCalls();
    const call = t.manager.callTool('mcp__oa__echo', { text: 'x' }, ctx());
    await vi.waitFor(() => expect(tokenCalls()).toBe(before + 1)); // the refresh is on its way
    await t.manager.signOut(added.id);
    release();
    const result = await call;
    expect(result.ok).toBe(false);
    const record = JSON.parse((await t.secrets.get(mcpOAuthSecretName(added.id))) ?? '{}') as { tokens?: unknown };
    expect(record.tokens).toBeUndefined();
    expect((await t.manager.list())[0]?.oauth?.state).toBe('required');
  });

  it('a refresh that finishes after a new sign-in does not overwrite the new tokens', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.listTools(TAB);
    t.as.expireAccessTokens();
    const release = t.hold((path, body) => path === '/oauth/token' && body.includes('grant_type=refresh_token'));
    const tokenCalls = (): number => t.requests.filter((r) => r.endsWith('/oauth/token')).length;
    const before = tokenCalls();
    const call = t.manager.callTool('mcp__oa__echo', { text: 'late' }, ctx());
    await vi.waitFor(() => expect(tokenCalls()).toBe(before + 1));
    const stored = async (): Promise<string | undefined> =>
      (JSON.parse((await t.secrets.get(mcpOAuthSecretName(added.id))) ?? '{}') as { tokens?: { accessToken: string } }).tokens?.accessToken;
    await t.oauth.signIn((await t.settings.get()).mcpServers[0] as McpServerConfig, {
      confirm: { authorizationHost: 'auth.example.com', scopes: ['read', 'write'] },
    });
    const fresh = await stored();
    release();
    expect(await call).toMatchObject({ ok: true, content: 'late' }); // retried with the new token
    expect(await stored()).toBe(fresh);
  });

  it('a registration the authorization server no longer knows is dropped; the next sign-in registers again', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    await t.manager.listTools(TAB);
    t.as.clients.clear(); // e.g. unused dynamic clients are deleted after a while
    t.as.expireAccessTokens();
    const r = await t.manager.callTool('mcp__oa__echo', { text: 'x' }, ctx());
    expect(r.content).toMatch(/requires sign-in/);
    const ok = await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    expect(ok.oauth?.state).toBe('signed-in');
    expect(t.as.requests.filter((x) => x.path === '/oauth/register')).toHaveLength(2);
  });

  it('changing the URL revokes the old tokens before forgetting them', async () => {
    const t = setup();
    const added = await t.manager.add({ name: 'oa', url: MCP_URL, enabled: true });
    await t.manager.signIn(added.id, await confirmed(t.manager, added.id));
    const access = [...t.as.accessTokens.keys()][0];
    const refresh = [...t.as.refreshTokens.keys()][0];
    await t.manager.update(added.id, { url: 'https://mcp.example.com/other' });
    expect(t.as.revoked).toEqual([refresh, access]);
    expect(await t.secrets.get(mcpOAuthSecretName(added.id))).toBeNull();
  });

  it('the RPCs validate params', async () => {
    const t = setup();
    const rpc = createMcpRpcHandlers(t.manager);
    const sender = {} as chrome.runtime.MessageSender;
    expect(await dispatchRpc(rpc, { rpc: 'mcp.signIn', params: {} }, sender)).toMatchObject({ ok: false, error: { code: 'invalid' } });
    // A sign-in is only started with what the user confirmed.
    expect(await dispatchRpc(rpc, { rpc: 'mcp.signIn', params: { id: 'x' } }, sender)).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(await dispatchRpc(rpc, { rpc: 'mcp.signIn', params: { id: 'x', confirm: { authorizationHost: 'a', scopes: [1] as unknown as string[] } } }, sender)).toMatchObject({
      ok: false,
      error: { message: 'Invalid scopes' },
    });
    expect(await dispatchRpc(rpc, { rpc: 'mcp.signOut', params: { id: 'nope' } }, sender)).toMatchObject({ ok: false, error: { message: 'Unknown MCP server' } });
  });
});
