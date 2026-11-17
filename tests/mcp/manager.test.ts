import { describe, expect, it } from 'vitest';
import { createMemoryBackend, createSecretStore } from '../../src/background/secrets';
import { createSettingsStore } from '../../src/background/settings';
import {
  createMcpManager,
  createMcpRpcHandlers,
  exposedToolName,
  validateMcpAuth,
  validateMcpUrl,
  type McpManagerDeps,
} from '../../src/mcp/manager';
import { TOOL_NAME_PATTERN, mcpAuthSecretName } from '../../src/shared/defaults';
import type { TabContext, ToolCallContext } from '../../src/shared/types';
import { createFakeStorageArea } from '../helpers/fake-storage';
import { createMockMcpServer, type MockMcpOptions, type MockMcpServer, type MockTool } from '../helpers/mock-mcp-server';

const TAB: TabContext = { tabId: 1, windowId: 1, url: 'https://example.com/', title: 'Example' };
const ctx = (signal = new AbortController().signal): ToolCallContext => ({ tab: TAB, signal, toolCallId: 'call-1' });
const sender = {} as chrome.runtime.MessageSender;

/** Routes requests by host to mock servers; unknown hosts fail like an unreachable server. */
function router(servers: Record<string, MockMcpServer>): typeof fetch {
  return (input, init) => {
    const host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).host;
    const server = servers[host];
    if (!server) return Promise.reject(new TypeError('Failed to fetch'));
    return server.fetch(input, init);
  };
}

function setup(servers: Record<string, MockMcpOptions> = { 'a.test': {} }, extra: Partial<McpManagerDeps> = {}) {
  const mocks = Object.fromEntries(Object.entries(servers).map(([host, o]) => [host, createMockMcpServer(o)]));
  const settings = createSettingsStore(createFakeStorageArea());
  const secrets = createSecretStore({ backend: createMemoryBackend(), legacy: createFakeStorageArea() });
  let ids = 0;
  let clock = 1_000_000;
  const deps: McpManagerDeps = {
    settings,
    secrets,
    fetch: router(mocks),
    newId: () => `id${++ids}`,
    now: () => clock,
    ...extra,
  };
  const manager = createMcpManager(deps);
  return {
    manager,
    mocks,
    settings,
    secrets,
    deps,
    advance: (ms: number) => (clock += ms),
    count: (host: string, method: string) => mocks[host]?.requests.filter((r) => r.rpcMethod === method).length ?? 0,
  };
}

describe('validation', () => {
  it('accepts https and local http only', () => {
    expect(validateMcpUrl('https://mcp.example.com/mcp#x')).toBe('https://mcp.example.com/mcp');
    expect(validateMcpUrl('http://localhost:3000/mcp')).toBe('http://localhost:3000/mcp');
    expect(validateMcpUrl('http://127.0.0.1:3000/mcp')).toBe('http://127.0.0.1:3000/mcp');
    expect(validateMcpUrl('http://[::1]:3000/mcp')).toBe('http://[::1]:3000/mcp');
    expect(() => validateMcpUrl('http://mcp.example.com/mcp')).toThrow(/https/);
    expect(() => validateMcpUrl('ftp://x')).toThrow();
    expect(() => validateMcpUrl('https://user:pw@x.test/mcp')).toThrow(/credentials/);
    expect(() => validateMcpUrl('not a url')).toThrow();
  });

  it('validates auth headers and tokens', () => {
    expect(validateMcpAuth({ bearerToken: '  Bearer abc ' })).toEqual({ bearerToken: 'abc' });
    expect(validateMcpAuth({ bearerToken: '', headers: {} })).toBeUndefined();
    expect(validateMcpAuth({ headers: { 'X-Api-Key': 'k' } })).toEqual({ headers: { 'X-Api-Key': 'k' } });
    expect(() => validateMcpAuth({ headers: { 'Mcp-Session-Id': 'x' } })).toThrow(/cannot be overridden/);
    expect(() => validateMcpAuth({ headers: { 'X-A': 'a\nb' } })).toThrow(/invalid characters/);
    expect(() => validateMcpAuth({ headers: { 'bad name': 'a' } })).toThrow(/Invalid header name/);
    expect(() => validateMcpAuth({ bearerToken: 't', headers: { Authorization: 'x' } })).toThrow(/either/);
  });
});

describe('exposedToolName', () => {
  it('prefixes, sanitises, caps at 64 and resolves collisions deterministically', () => {
    const taken = new Set<string>();
    expect(exposedToolName('github', 'search', taken)).toBe('mcp__github__search');
    const dotted = exposedToolName('github', 'a.b', taken);
    const underscored = exposedToolName('github', 'a_b', taken);
    expect(dotted).toBe('mcp__github__a_b');
    expect(underscored).not.toBe(dotted);
    expect(underscored).toMatch(TOOL_NAME_PATTERN);

    const long = 'x'.repeat(200);
    const name = exposedToolName('github', long, taken);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(TOOL_NAME_PATTERN);
    expect(exposedToolName('github', long, new Set())).toBe(name); // stable across restarts

    const t2 = new Set<string>();
    const n1 = exposedToolName('s', 'Tool', t2);
    const n2 = exposedToolName('s', 'tool', t2);
    expect(n1.toLowerCase()).not.toBe(n2.toLowerCase());
    expect(exposedToolName('s', 'ünïcode tool!', new Set())).toBe('mcp__s___n_code_tool_');
  });
});

describe('McpManager', () => {
  it('adds a server, stores auth encrypted, connects and reports status', async () => {
    const { manager, secrets, settings } = setup({ 'a.test': { token: 'tok' } });
    const status = await manager.add(
      { name: 'alpha', url: 'https://a.test/mcp', enabled: true },
      { bearerToken: 'tok' },
    );
    expect(status).toMatchObject({
      id: 'id1',
      name: 'alpha',
      hasAuth: true,
      state: 'connected',
      toolCount: 2,
      protocolVersion: '2026-07-28',
      serverInfo: { name: 'mock-mcp', version: '1.0.0' },
    });
    expect(JSON.parse((await secrets.get(mcpAuthSecretName('id1'))) ?? '{}')).toEqual({ bearerToken: 'tok' });
    expect((await settings.get()).mcpServers).toEqual([
      { id: 'id1', name: 'alpha', url: 'https://a.test/mcp', enabled: true },
    ]);
    await expect(manager.add({ name: 'ALPHA', url: 'https://a.test/mcp', enabled: true })).rejects.toThrow(
      /already exists/,
    );
    await expect(manager.add({ name: 'b', url: 'http://a.test/mcp', enabled: true })).rejects.toThrow(/https/);
  });

  it('exposes tools as mcp__<server>__<tool> (all mutating, labelled by server), and calls them', async () => {
    const { manager } = setup();
    await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true });
    const specs = await manager.listTools(TAB);
    // readOnlyHint is the server's unverified claim: ignored unless the user trusts this server.
    expect(specs.map((s) => [s.name, s.mutates, s.sourceLabel])).toEqual([
      ['mcp__alpha__echo', true, 'MCP: alpha'],
      ['mcp__alpha__add', true, 'MCP: alpha'],
    ]);
    expect(specs[1]?.parameters).toMatchObject({ type: 'object', required: ['a', 'b'] });
    expect(await manager.callTool('mcp__alpha__add', { a: 4, b: 5 }, ctx())).toEqual({
      ok: true,
      content: '9',
      data: { sum: 9 },
    });
    expect(await manager.callTool('mcp__alpha__nope', {}, ctx())).toMatchObject({ ok: false });
  });

  it('honours readOnlyHint only for servers with trustReadOnlyHints', async () => {
    const { manager, settings } = setup();
    const added = await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true, trustReadOnlyHints: true });
    expect(added.trustReadOnlyHints).toBe(true);
    expect((await manager.listTools(TAB)).map((s) => [s.name, s.mutates])).toEqual([
      ['mcp__alpha__echo', false],
      ['mcp__alpha__add', true],
    ]);
    await manager.update(added.id, { trustReadOnlyHints: false });
    expect((await settings.get()).mcpServers[0]?.trustReadOnlyHints).toBeUndefined();
    expect((await manager.listTools(TAB)).every((s) => s.mutates === true)).toBe(true);
  });

  it('tests edited, unsaved values with the stored auth of a saved server (authFrom)', async () => {
    const { manager } = setup({ 'a.test': { token: 'sekret' }, 'b.test': { token: 'sekret' } });
    const saved = await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true }, { bearerToken: 'sekret' });
    expect(saved.state).toBe('connected');
    const edited = { name: 'alpha', url: 'https://b.test/mcp', enabled: true };
    expect((await manager.test({ server: edited })).ok).toBe(false);
    expect((await manager.test({ server: edited, authFrom: saved.id })).ok).toBe(true);
    await expect(manager.test({ server: edited, authFrom: 'nope' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('resolves tool names after a worker restart without an explicit listTools', async () => {
    const first = setup();
    await first.manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true });
    // A fresh manager over the same stores = the worker was restarted.
    const restarted = createMcpManager(first.deps);
    const result = await restarted.callTool('mcp__alpha__echo', { text: 'again' }, ctx());
    expect(result).toEqual({ ok: true, content: 'again' });
  });

  it('isolates a failing server', async () => {
    const { manager } = setup({ 'a.test': {} });
    await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true });
    const down = await manager.add({ name: 'down', url: 'https://down.test/mcp', enabled: true });
    expect(down.state).toBe('error');
    expect(down.error?.code).toBe('network');

    const specs = await manager.listTools(TAB);
    expect(specs.map((s) => s.name)).toEqual(['mcp__alpha__echo', 'mcp__alpha__add']);
    const statuses = await manager.list();
    expect(statuses.map((s) => [s.name, s.state])).toEqual([
      ['alpha', 'connected'],
      ['down', 'error'],
    ]);
  });

  it('caches tool lists, honours the TTL, list_changed and explicit refresh', async () => {
    const changed = { emit: false };
    const { manager, mocks, count, advance } = setup({
      'a.test': {
        era: 'legacy',
        responseMode: 'sse',
        beforeResponse: (method) =>
          method === 'tools/call' && changed.emit ? [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }] : [],
      },
    });
    await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true });
    await manager.listTools(TAB);
    await manager.listTools(TAB);
    expect(count('a.test', 'tools/list')).toBe(1);

    advance(5 * 60_000 + 1);
    await manager.listTools(TAB);
    expect(count('a.test', 'tools/list')).toBe(2);

    const extra: MockTool = { name: 'extra', inputSchema: { type: 'object' }, handler: () => ({ content: [] }) };
    mocks['a.test']?.tools.push(extra);
    changed.emit = true;
    await manager.callTool('mcp__alpha__echo', { text: 'x' }, ctx());
    const specs = await manager.listTools(TAB);
    expect(count('a.test', 'tools/list')).toBe(3);
    expect(specs.map((s) => s.name)).toContain('mcp__alpha__extra');

    await manager.refresh();
    expect(count('a.test', 'tools/list')).toBe(4);
  });

  it('treats ttlMs 0 (stale immediately, the SDK default) as the 30 s minimum, not as "no hint"', async () => {
    const { manager, count, advance } = setup({ 'a.test': { era: 'modern', ttlMs: 0 } });
    await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true });
    expect(count('a.test', 'tools/list')).toBe(1);
    await manager.listTools(TAB);
    expect(count('a.test', 'tools/list')).toBe(1); // reused within 30 s
    advance(30_001);
    await manager.listTools(TAB);
    expect(count('a.test', 'tools/list')).toBe(2); // not 5 minutes
  });

  it('backs off after a failure instead of retrying on every listTools', async () => {
    let attempts = 0;
    const failing: typeof fetch = () => {
      attempts++;
      return Promise.reject(new TypeError('Failed to fetch'));
    };
    const { manager, advance } = setup({}, { fetch: failing });
    await manager.add({ name: 'down', url: 'https://down.test/mcp', enabled: true });
    const afterAdd = attempts;
    expect(afterAdd).toBeGreaterThan(0);
    expect(await manager.listTools(TAB)).toEqual([]);
    await manager.listTools(TAB);
    expect(attempts).toBe(afterAdd);
    advance(30_001);
    await manager.listTools(TAB);
    expect(attempts).toBeGreaterThan(afterAdd);
  });

  it('updates (auth keep / replace / remove) and removes servers with their secrets', async () => {
    const { manager, secrets, settings } = setup({ 'a.test': { token: 'new' } });
    const added = await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true }, { bearerToken: 'old' });
    expect(added.state).toBe('error');
    expect(added.error?.message).toMatch(/rejected the credentials/);

    const fixed = await manager.update(added.id, {}, { bearerToken: 'new' });
    expect(fixed.state).toBe('connected');

    const renamed = await manager.update(added.id, { name: 'beta' });
    expect(renamed).toMatchObject({ name: 'beta', hasAuth: true, state: 'connected' });
    expect((await manager.listTools(TAB))[0]?.name).toBe('mcp__beta__echo');

    const disabled = await manager.update(added.id, { enabled: false });
    expect(disabled.state).toBe('disabled');
    expect(await manager.listTools(TAB)).toEqual([]);

    const noAuth = await manager.update(added.id, { enabled: true }, null);
    expect(noAuth.hasAuth).toBe(false);
    expect(noAuth.error?.message).toMatch(/^This server requires sign-in \(OAuth\)\. Save it, then click "Sign in"/);

    await manager.remove(added.id);
    expect((await settings.get()).mcpServers).toEqual([]);
    expect(await secrets.has(mcpAuthSecretName(added.id))).toBe(false);
    await expect(manager.remove(added.id)).rejects.toThrow(/Unknown/);
  });

  it('tests saved and unsaved servers without throwing on connection errors', async () => {
    const { manager } = setup({ 'a.test': { era: 'legacy' } });
    const ok = await manager.test({ server: { name: 'x', url: 'https://a.test/mcp', enabled: true } });
    expect(ok).toMatchObject({ ok: true, protocolVersion: '2025-11-25', serverInfo: { name: 'mock-mcp' } });
    expect(ok.tools?.map((t) => t.name)).toEqual(['echo', 'add']);

    const bad = await manager.test({ server: { name: 'x', url: 'https://nowhere.test/mcp', enabled: true } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'network' } });

    const saved = await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: false });
    expect(saved.state).toBe('disabled');
    expect((await manager.test({ id: saved.id })).ok).toBe(true);
  });

  it('rethrows aborts from callTool', async () => {
    const never: MockTool = {
      name: 'never',
      inputSchema: { type: 'object' },
      handler: (_a, { signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('x')))),
    };
    const { manager } = setup({ 'a.test': { tools: [never] } });
    await manager.add({ name: 'alpha', url: 'https://a.test/mcp', enabled: true });
    const ac = new AbortController();
    const pending = manager.callTool('mcp__alpha__never', {}, ctx(ac.signal));
    setTimeout(() => ac.abort(), 10);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('createMcpRpcHandlers', () => {
  it('validates wire params and delegates to the manager', async () => {
    const { manager } = setup();
    const rpc = createMcpRpcHandlers(manager);
    const added = await rpc['mcp.add'](
      { server: { name: 'alpha', url: 'https://a.test/mcp', enabled: true }, auth: { headers: { 'X-Key': 'v' } } },
      sender,
    );
    expect(added.hasAuth).toBe(true);
    expect((await rpc['mcp.list'](undefined, sender)).map((s) => s.name)).toEqual(['alpha']);
    expect((await rpc['mcp.update']({ id: added.id, patch: { name: 'beta' } }, sender)).name).toBe('beta');
    expect((await rpc['mcp.test']({ id: added.id }, sender)).ok).toBe(true);
    await rpc['mcp.remove']({ id: added.id }, sender);
    expect(await rpc['mcp.list'](undefined, sender)).toEqual([]);

    const bad = rpc as unknown as Record<string, (p: unknown, s: unknown) => Promise<unknown>>;
    await expect(bad['mcp.add']?.(null, sender)).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad['mcp.update']?.({ patch: {} }, sender)).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad['mcp.add']?.({ server: { name: 'x y', url: 'https://a.test' } }, sender)).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(bad['mcp.add']?.({ server: { name: 'x', url: 'https://a.test' }, auth: 'tok' }, sender)).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});
