/**
 * MCP manager: owns the configured servers (`Settings.mcpServers`, auth in the secret store under
 * `mcp-auth-<id>`), connects lazily (first use, and again after a worker restart), caches each
 * server's tool list (TTL, `notifications/tools/list_changed`, explicit refresh), tracks status
 * for the settings UI, and is the single `ToolSource` (`id: 'mcp'`) exposing every server's tools
 * as `mcp__<server>__<tool>`.
 *
 * No timers and no persistent connections: everything happens inside calls, so the worker can be
 * killed at any time. One failing server never breaks the others.
 */
import type { SecretStore } from '../background/secrets';
import { isOAuthClientId, type SettingsStore } from '../background/settings';
import { LOCAL_HTTP_HOSTS, MCP_SERVER_NAME_PATTERN, mcpAuthSecretName } from '../shared/defaults';
import { createLogger } from '../shared/logger';
import type { RpcHandlers } from '../shared/protocol';
import {
  CcError,
  toErrorInfo,
  type ErrorInfo,
  type McpConnectionState,
  type McpServerAuth,
  type McpServerConfig,
  type McpServerInput,
  type McpServerStatus,
  type McpTestResult,
  type TabContext,
  type ToolArgs,
  type ToolCallContext,
  type ToolResult,
  type ToolSource,
  type ToolSpec,
} from '../shared/types';
import {
  McpClient,
  McpError,
  RPC_ERRORS,
  raceAbort,
  toToolResult,
  type McpClientInfo,
  type McpInitializeResult,
  type McpToolDescriptor,
} from './client';
import type { McpOAuth, McpSignInOptions } from './auth';

const log = createLogger('mcp');

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export interface McpManagerDeps {
  settings: Pick<SettingsStore, 'get' | 'update'>;
  secrets: Pick<SecretStore, 'get' | 'set' | 'has' | 'delete'>;
  /** Injectable for tests. Default global `fetch`. */
  fetch?: typeof fetch;
  /** Clock (tests). Default `Date.now`. */
  now?: () => number;
  /** Server id generator. Default `crypto.randomUUID`. */
  newId?: () => string;
  /** Sent to servers as `clientInfo`. Default: `carbon-commander` + manifest version. */
  clientInfo?: McpClientInfo;
  /** Tool list freshness when the server gives no `ttlMs` (legacy servers). Default 5 min. */
  toolsTtlMs?: number;
  /** After a failed connect, automatic retries (from `listTools`) wait this long. Default 30 s. */
  retryBackoffMs?: number;
  /** Bound on one server's contribution to `listTools` (the agent should not stall). Default 15 s. */
  listTimeoutMs?: number;
  /** Bound on connecting servers for `list()` (settings UI). Default 8 s. */
  statusTimeoutMs?: number;
  /** Passed to every client. */
  requestTimeoutMs?: number;
  toolCallTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** OAuth sign-in (`auth.ts`). Used for servers without a stored token / headers. */
  oauth?: McpOAuth;
}

export interface McpManager extends ToolSource {
  /** Status of every configured server (connects enabled ones not tried yet, bounded). */
  list(): Promise<McpServerStatus[]>;
  /** Validate, store (auth encrypted), connect when enabled. Connection errors show in the status. */
  add(server: McpServerInput, auth?: McpServerAuth): Promise<McpServerStatus>;
  /** `auth`: undefined = keep, null = remove, object = replace. Reconnects the server. */
  update(id: string, patch: Partial<McpServerInput>, auth?: McpServerAuth | null): Promise<McpServerStatus>;
  /** Disconnect (best-effort session DELETE), remove the config and its secret. */
  remove(id: string): Promise<void>;
  /** initialize + tools/list on a saved (`id`) or unsaved server. Never throws for connection errors. */
  test(target: { id: string } | { server: McpServerInput; auth?: McpServerAuth; authFrom?: string }): Promise<McpTestResult>;
  /** Drop cached tool lists (one server or all) and re-fetch; returns the statuses. */
  refresh(id?: string): Promise<McpServerStatus[]>;
  /** Close every connection (best-effort). The manager stays usable (reconnects lazily). */
  closeAll(): Promise<void>;
  /** Interactive OAuth sign-in (settings UI only, as confirmed by the user), then reconnect. Throws with the reason. */
  signIn(id: string, options: McpSignInOptions): Promise<McpServerStatus>;
  /** Revoke + delete the server's OAuth tokens. */
  signOut(id: string): Promise<McpServerStatus>;
}

/** The `mcp.*` RPC methods. */
export type McpRpcMethod = 'mcp.list' | 'mcp.add' | 'mcp.update' | 'mcp.remove' | 'mcp.test' | 'mcp.signIn' | 'mcp.signOut';

/**
 * RPC handlers for `mcp.*`, validating the (untrusted) wire params before calling the manager.
 * Register with `registerRpcHandlers({ ...createMcpRpcHandlers(mcp), ... })`.
 */
export function createMcpRpcHandlers(manager: McpManager): Pick<RpcHandlers, McpRpcMethod> {
  return {
    'mcp.list': async () => manager.list(),
    'mcp.add': async (params) => {
      const p = requireRecord(params, 'params');
      return manager.add(p.server as McpServerInput, optionalAuth(p.auth));
    },
    'mcp.update': async (params) => {
      const p = requireRecord(params, 'params');
      if (typeof p.id !== 'string') throw new CcError('invalid', 'Missing server id');
      const patch = p.patch === undefined ? {} : requireRecord(p.patch, 'patch');
      const auth = p.auth === null ? null : optionalAuth(p.auth);
      return manager.update(p.id, patch, auth);
    },
    'mcp.remove': async (params) => {
      const p = requireRecord(params, 'params');
      if (typeof p.id !== 'string') throw new CcError('invalid', 'Missing server id');
      return manager.remove(p.id);
    },
    'mcp.test': async (params) => {
      const p = requireRecord(params, 'params');
      if (typeof p.id === 'string') return manager.test({ id: p.id });
      const server = requireRecord(p.server, 'server') as unknown as McpServerInput;
      const auth = optionalAuth(p.auth);
      if (p.authFrom !== undefined && typeof p.authFrom !== 'string') throw new CcError('invalid', 'Invalid authFrom');
      return manager.test({ server, ...(auth ? { auth } : {}), ...(typeof p.authFrom === 'string' ? { authFrom: p.authFrom } : {}) });
    },
    'mcp.signIn': async (params) => {
      const p = requireRecord(params, 'params');
      if (typeof p.id !== 'string') throw new CcError('invalid', 'Missing server id');
      const c = requireRecord(p.confirm, 'confirm');
      if (typeof c.authorizationHost !== 'string' || c.authorizationHost === '' || c.authorizationHost.length > 300) {
        throw new CcError('invalid', 'Missing sign-in host');
      }
      if (!Array.isArray(c.scopes) || c.scopes.length > 100 || !c.scopes.every((s) => typeof s === 'string' && s.length <= 200)) {
        throw new CcError('invalid', 'Invalid scopes');
      }
      return manager.signIn(p.id, { stepUp: p.stepUp === true, confirm: { authorizationHost: c.authorizationHost, scopes: c.scopes as string[] } });
    },
    'mcp.signOut': async (params) => {
      const p = requireRecord(params, 'params');
      if (typeof p.id !== 'string') throw new CcError('invalid', 'Missing server id');
      return manager.signOut(p.id);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Validation (exported for tests and the UI)
// ---------------------------------------------------------------------------------------------


/**
 * MCP endpoint URL rule: `https:`, or `http:` only for localhost / 127.0.0.1 / [::1]. No
 * credentials in the URL. Returns the normalised URL (fragment removed).
 */
export function validateMcpUrl(url: unknown): string {
  if (typeof url !== 'string' || url.trim() === '' || url.length > 2048) {
    throw new CcError('invalid', 'Enter the MCP server URL');
  }
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new CcError('invalid', 'The MCP server URL is not a valid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new CcError('invalid', 'The MCP server URL must start with https://');
  }
  if (u.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(u.hostname)) {
    throw new CcError('invalid', 'Use https:// for MCP servers (plain http:// is only allowed for localhost)');
  }
  if (u.username || u.password) {
    throw new CcError('invalid', 'Do not put credentials in the URL; use a bearer token or a custom header');
  }
  u.hash = '';
  return u.href;
}

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
const HEADER_VALUE_RE = /^[\t\x20-\x7e]*$/;
const RESERVED_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'last-event-id',
  'mcp-method',
  'mcp-name',
  'mcp-protocol-version',
  'mcp-session-id',
  'origin',
  'transfer-encoding',
]);
const MAX_AUTH_HEADERS = 32;
const MAX_SECRET_VALUE = 8192;

/** Validate + normalise auth. Returns undefined when there is nothing to store. */
export function validateMcpAuth(auth: unknown): McpServerAuth | undefined {
  if (auth === undefined || auth === null) return undefined;
  if (!isRecord(auth)) throw new CcError('invalid', 'Invalid MCP auth');
  const out: McpServerAuth = {};
  if (auth.bearerToken !== undefined) {
    if (typeof auth.bearerToken !== 'string') throw new CcError('invalid', 'The bearer token must be text');
    let token = auth.bearerToken.trim();
    if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '');
    if (token.length > MAX_SECRET_VALUE || !/^[\x21-\x7e]*$/.test(token)) {
      throw new CcError('invalid', 'The bearer token contains invalid characters or is too long');
    }
    if (token !== '') out.bearerToken = token;
  }
  if (auth.headers !== undefined) {
    if (!isRecord(auth.headers)) throw new CcError('invalid', 'Custom headers must be name -> value');
    const entries = Object.entries(auth.headers);
    if (entries.length > MAX_AUTH_HEADERS) throw new CcError('invalid', `At most ${MAX_AUTH_HEADERS} custom headers`);
    const headers: Record<string, string> = {};
    const seen = new Set<string>();
    for (const [rawName, rawValue] of entries) {
      const name = rawName.trim();
      const lower = name.toLowerCase();
      if (!HEADER_NAME_RE.test(name)) throw new CcError('invalid', `Invalid header name "${name.slice(0, 64)}"`);
      if (RESERVED_HEADERS.has(lower) || lower.startsWith('mcp-param-') || lower.startsWith('sec-') || lower.startsWith('proxy-')) {
        throw new CcError('invalid', `The header "${name}" is set by the client and cannot be overridden`);
      }
      if (lower === 'authorization' && out.bearerToken) {
        throw new CcError('invalid', 'Use either a bearer token or a custom Authorization header, not both');
      }
      if (seen.has(lower)) throw new CcError('invalid', `Duplicate header "${name}"`);
      if (typeof rawValue !== 'string') throw new CcError('invalid', `The value of "${name}" must be text`);
      const value = rawValue.trim();
      if (value.length > MAX_SECRET_VALUE || !HEADER_VALUE_RE.test(value)) {
        throw new CcError('invalid', `The value of "${name}" contains invalid characters or is too long`);
      }
      seen.add(lower);
      headers[name] = value;
    }
    if (Object.keys(headers).length > 0) out.headers = headers;
  }
  return out.bearerToken === undefined && out.headers === undefined ? undefined : out;
}

/** Validate a server input against the other configured servers (name unique, case-insensitive). */
export function validateMcpServerInput(
  input: unknown,
  others: readonly McpServerConfig[],
): McpServerInput {
  if (!isRecord(input)) throw new CcError('invalid', 'Invalid MCP server');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!MCP_SERVER_NAME_PATTERN.test(name)) {
    throw new CcError('invalid', 'Server name: 1-32 characters, letters, digits, "_" or "-"');
  }
  if (others.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new CcError('invalid', `A server named "${name}" already exists`);
  }
  const url = validateMcpUrl(input.url);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new CcError('invalid', 'Invalid "enabled"');
  if (input.trustReadOnlyHints !== undefined && typeof input.trustReadOnlyHints !== 'boolean') {
    throw new CcError('invalid', 'Invalid "trustReadOnlyHints"');
  }
  const out: McpServerInput = { name, url, enabled: input.enabled !== false };
  if (input.trustReadOnlyHints === true) out.trustReadOnlyHints = true;
  if (input.oauthClientId !== undefined && input.oauthClientId !== '') {
    const clientId = typeof input.oauthClientId === 'string' ? input.oauthClientId.trim() : input.oauthClientId;
    if (!isOAuthClientId(clientId)) throw new CcError('invalid', 'OAuth client ID: printable characters without spaces, at most 512');
    out.oauthClientId = clientId;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tool naming (exported for tests)
// ---------------------------------------------------------------------------------------------

const MAX_TOOL_NAME = 64;

/** FNV-1a 32-bit, 8 hex chars. Deterministic so names survive a worker restart. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function sanitizeNamePart(text: string): string {
  const s = text.replace(/[^a-zA-Z0-9_-]/g, '_');
  return s === '' ? '_' : s;
}

/**
 * Exposed name `mcp__<server>__<tool>`, sanitised to `TOOL_NAME_PATTERN` and <= 64 chars. Long
 * names are cut and suffixed with a hash of the original tool name; a name already in `taken`
 * (case-insensitive, e.g. `a.b` vs `a_b`) gets the hash suffix, then a counter. Adds the result to
 * `taken`.
 */
export function exposedToolName(server: string, tool: string, taken: Set<string>): string {
  const base = `mcp__${sanitizeNamePart(server)}__${sanitizeNamePart(tool)}`;
  const hashed = (extra = ''): string => {
    const suffix = `_${shortHash(tool)}${extra}`;
    return `${base.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`;
  };
  let name = base.length <= MAX_TOOL_NAME ? base : hashed();
  if (taken.has(name.toLowerCase())) name = hashed();
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = hashed(`_${n}`);
  taken.add(name.toLowerCase());
  return name;
}

// ---------------------------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------------------------

interface Runtime {
  config: McpServerConfig;
  /** Validation error for a stored config that breaks current rules (e.g. http:// remote). */
  configError?: ErrorInfo;
  client: McpClient | null;
  clientPromise: Promise<McpClient> | null;
  state: McpConnectionState;
  error?: ErrorInfo;
  info?: McpInitializeResult;
  tools?: McpToolDescriptor[];
  freshUntil: number;
  /** `notifications/tools/list_changed` seen. */
  stale: boolean;
  failedAt?: number;
  loading: Promise<McpToolDescriptor[]> | null;
  disposed: boolean;
}

interface IndexEntry {
  serverId: string;
  tool: McpToolDescriptor;
}

const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 60 * 60_000;

export function createMcpManager(deps: McpManagerDeps): McpManager {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const defaultTtl = deps.toolsTtlMs ?? 5 * 60_000;
  const backoff = deps.retryBackoffMs ?? 30_000;
  const listTimeout = deps.listTimeoutMs ?? 15_000;
  const statusTimeout = deps.statusTimeoutMs ?? 8_000;
  const clientInfo = deps.clientInfo ?? { name: 'carbon-commander', version: manifestVersion() };

  const runtimes = new Map<string, Runtime>();
  /** exposed name -> server tool, rebuilt by every `listTools`. */
  let index = new Map<string, IndexEntry>();

  // --- runtimes ------------------------------------------------------------------------------

  function newRuntime(config: McpServerConfig): Runtime {
    const rt: Runtime = {
      config,
      client: null,
      clientPromise: null,
      state: config.enabled ? 'disconnected' : 'disabled',
      freshUntil: 0,
      stale: false,
      loading: null,
      disposed: false,
    };
    try {
      validateMcpUrl(config.url);
    } catch (err) {
      rt.configError = toErrorInfo(err);
    }
    return rt;
  }

  function dispose(rt: Runtime): void {
    rt.disposed = true;
    const client = rt.client;
    rt.client = null;
    rt.clientPromise = null;
    if (client) void client.close();
  }

  /** Sync runtimes with the stored config (cheap: settings are cached by the store). */
  async function sync(): Promise<Runtime[]> {
    const { mcpServers } = await deps.settings.get();
    const ids = new Set<string>();
    const out: Runtime[] = [];
    for (const config of mcpServers) {
      ids.add(config.id);
      let rt = runtimes.get(config.id);
      if (rt && (rt.config.url !== config.url || rt.config.enabled !== config.enabled)) {
        dispose(rt);
        rt = undefined;
      }
      if (!rt) {
        rt = newRuntime(config);
        runtimes.set(config.id, rt);
      } else {
        rt.config = config;
      }
      out.push(rt);
    }
    for (const [id, rt] of runtimes) {
      if (!ids.has(id)) {
        dispose(rt);
        runtimes.delete(id);
      }
    }
    return out;
  }

  function resetRuntime(id: string): void {
    const rt = runtimes.get(id);
    if (!rt) return;
    dispose(rt);
    runtimes.delete(id);
  }

  async function loadAuth(id: string): Promise<McpServerAuth | undefined> {
    const raw = await deps.secrets.get(mcpAuthSecretName(id));
    if (raw === null) return undefined;
    try {
      return validateMcpAuth(JSON.parse(raw));
    } catch {
      log.warn('Stored MCP auth is unreadable for server', id);
      return undefined;
    }
  }

  function makeClient(
    url: string,
    auth: McpServerAuth | undefined,
    onToolsChanged?: () => void,
    oauthFor?: McpServerConfig,
  ): McpClient {
    // OAuth only for saved servers without a token / headers of their own.
    const authHooks = !auth && oauthFor && deps.oauth ? deps.oauth.hooks(oauthFor) : undefined;
    return new McpClient({
      url,
      ...(auth ? { auth } : {}),
      ...(authHooks ? { authHooks } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      clientInfo,
      ...(deps.requestTimeoutMs !== undefined ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      ...(deps.toolCallTimeoutMs !== undefined ? { toolCallTimeoutMs: deps.toolCallTimeoutMs } : {}),
      ...(deps.connectTimeoutMs !== undefined ? { connectTimeoutMs: deps.connectTimeoutMs } : {}),
      onNotification: (method) => {
        if (method === 'notifications/tools/list_changed') onToolsChanged?.();
      },
    });
  }

  function getClient(rt: Runtime): Promise<McpClient> {
    if (rt.client) return Promise.resolve(rt.client);
    rt.clientPromise ??= loadAuth(rt.config.id).then(
      (auth) => {
        const client = makeClient(
          rt.config.url,
          auth,
          () => {
            rt.stale = true;
          },
          rt.config,
        );
        if (!rt.disposed) rt.client = client;
        rt.clientPromise = null;
        return client;
      },
      (err: unknown) => {
        rt.clientPromise = null;
        throw err;
      },
    );
    return rt.clientPromise;
  }

  /**
   * Tool-list freshness from the server's `ttlMs`. Per 2026-07-28, `0` (the official SDK's
   * default) means "stale immediately": we still reuse a list for `MIN_TTL_MS` so every agent step
   * does not refetch it. No hint at all (legacy servers never send one): `defaultTtl`.
   */
  function ttlFor(serverTtl: number | undefined): number {
    if (serverTtl === undefined || !Number.isFinite(serverTtl)) return defaultTtl;
    return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, serverTtl));
  }

  /**
   * Fresh tool list for a server: connects if needed. With `force`, ignores the cache and the
   * failure backoff. On a failed refresh, a previous list is served (stale) and the error kept.
   */
  function ensureTools(rt: Runtime, force = false): Promise<McpToolDescriptor[]> {
    if (rt.configError) return Promise.reject(new CcError(rt.configError.code, rt.configError.message));
    const t = now();
    if (!force && rt.tools && !rt.stale && t < rt.freshUntil) return Promise.resolve(rt.tools);
    if (!force && rt.failedAt !== undefined && t - rt.failedAt < backoff) {
      if (rt.tools) return Promise.resolve(rt.tools);
      const e = rt.error ?? { code: 'unknown', message: 'Connection failed' };
      return Promise.reject(new CcError(e.code, e.message, e.status === undefined ? undefined : { status: e.status }));
    }
    if (rt.loading) return rt.loading;
    const load = (async (): Promise<McpToolDescriptor[]> => {
      if (!rt.info) rt.state = 'connecting';
      try {
        const client = await getClient(rt);
        rt.info = await client.connect();
        rt.stale = false;
        const list = await client.listTools();
        rt.tools = list.tools;
        rt.freshUntil = now() + ttlFor(list.ttlMs);
        rt.state = 'connected';
        delete rt.error;
        delete rt.failedAt;
        if (list.truncated) log.warn(`MCP server "${rt.config.name}" has too many tools; the list was truncated`);
        return list.tools;
      } catch (err) {
        rt.state = 'error';
        rt.error = toErrorInfo(err);
        rt.failedAt = now();
        if (!(err instanceof McpError && (err.status === 401 || err.status === 403))) delete rt.info;
        // Waiting for the user to sign in is not a failure worth a warning.
        if (err instanceof McpError && err.auth === 'sign-in') log.info(`MCP server "${rt.config.name}": sign-in required`);
        else log.warn(`MCP server "${rt.config.name}" failed:`, rt.error.message);
        if (rt.tools) return rt.tools;
        throw err;
      } finally {
        rt.loading = null;
      }
    })();
    rt.loading = load;
    return load;
  }

  async function status(rt: Runtime): Promise<McpServerStatus> {
    const out: McpServerStatus = {
      ...rt.config,
      hasAuth: await deps.secrets.has(mcpAuthSecretName(rt.config.id)),
      state: rt.config.enabled ? (rt.configError ? 'error' : rt.state) : 'disabled',
    };
    if (deps.oauth && !out.hasAuth && !rt.configError) {
      const oauth = await deps.oauth.status(rt.config).catch(() => undefined);
      if (oauth) out.oauth = oauth;
    }
    const error = rt.configError ?? rt.error;
    if (error && rt.config.enabled) out.error = error;
    if (rt.tools && rt.config.enabled) out.toolCount = rt.tools.length;
    if (rt.info && rt.config.enabled) {
      out.serverInfo = rt.info.serverInfo;
      out.protocolVersion = rt.info.protocolVersion;
    }
    return out;
  }

  async function statuses(rts: Runtime[], connect: 'auto' | 'force'): Promise<McpServerStatus[]> {
    const targets = rts.filter(
      (rt) => rt.config.enabled && !rt.configError && (connect === 'force' || rt.state === 'disconnected'),
    );
    if (targets.length > 0) {
      await Promise.all(
        targets.map((rt) => withTimeout(ensureTools(rt, connect === 'force'), statusTimeout).catch(() => undefined)),
      );
    }
    return Promise.all(rts.map(status));
  }

  async function statusById(id: string, connect: boolean): Promise<McpServerStatus> {
    const rts = await sync();
    const rt = rts.find((r) => r.config.id === id);
    if (!rt) throw new CcError('invalid', 'Unknown MCP server');
    if (connect && rt.config.enabled && !rt.configError) {
      await withTimeout(ensureTools(rt, true), statusTimeout).catch(() => undefined);
    }
    return status(rt);
  }

  // --- ToolSource ----------------------------------------------------------------------------

  async function listTools(_tab?: TabContext): Promise<ToolSpec[]> {
    const rts = (await sync()).filter((rt) => rt.config.enabled && !rt.configError);
    const lists = await Promise.all(
      rts.map((rt) =>
        withTimeout(ensureTools(rt), listTimeout).then(
          (tools) => ({ rt, tools }),
          () => ({ rt, tools: rt.tools ?? [] }),
        ),
      ),
    );
    const taken = new Set<string>();
    const next = new Map<string, IndexEntry>();
    const specs: ToolSpec[] = [];
    for (const { rt, tools } of lists) {
      for (const tool of tools) {
        const name = exposedToolName(rt.config.name, tool.name, taken);
        next.set(name, { serverId: rt.config.id, tool });
        specs.push({
          name,
          description: tool.description || tool.title || tool.annotations?.title || `${tool.name} (MCP server ${rt.config.name})`,
          parameters: tool.inputSchema,
          // The hint is the server's claim: only honoured when the user trusts this server's hints.
          mutates: !(rt.config.trustReadOnlyHints === true && tool.annotations?.readOnlyHint === true),
          sourceLabel: `MCP: ${rt.config.name}`,
        });
      }
    }
    index = next;
    return specs;
  }

  async function callTool(name: string, args: ToolArgs, ctx: ToolCallContext): Promise<ToolResult> {
    let entry = index.get(name);
    if (!entry) {
      // e.g. a worker restart between the model seeing the tools and calling one.
      await listTools(ctx.tab);
      entry = index.get(name);
    }
    if (!entry) {
      return { ok: false, content: `Unknown MCP tool "${name}". The server may be offline or no longer offer it.` };
    }
    const rt = runtimes.get(entry.serverId);
    if (!rt || !rt.config.enabled) return { ok: false, content: `The MCP server for "${name}" is not enabled.` };
    const serverName = rt.config.name;

    let tool = entry.tool;
    for (let attempt = 0; ; attempt++) {
      try {
        const client = await raceAbort(getClient(rt), ctx.signal);
        const result = await client.callTool(tool.name, args, { signal: ctx.signal, tool });
        rt.info = client.initializeResult ?? rt.info;
        rt.state = 'connected';
        delete rt.error;
        delete rt.failedAt;
        return toToolResult(result);
      } catch (err) {
        if (ctx.signal.aborted || (err instanceof CcError && err.code === 'aborted')) {
          throw err instanceof CcError ? err : new CcError('aborted', 'Aborted', { cause: err });
        }
        const rpc = err instanceof McpError ? err.rpc : undefined;
        if (rpc?.code === RPC_ERRORS.headerMismatch && attempt === 0) {
          // The tool's schema (x-mcp-header) changed: refresh and retry once.
          const tools = await ensureTools(rt, true).catch(() => undefined);
          const fresh = tools?.find((t) => t.name === tool.name);
          if (fresh) {
            tool = fresh;
            continue;
          }
        }
        if (rpc && (rpc.code === RPC_ERRORS.methodNotFound || rpc.code === RPC_ERRORS.invalidParams)) {
          rt.freshUntil = 0; // the tool may have changed; refetch next time
        }
        if (!rpc) {
          rt.state = 'error';
          rt.error = toErrorInfo(err);
        }
        if (err instanceof McpError && err.auth === 'sign-in') {
          rt.failedAt = now();
          return {
            ok: false,
            content:
              `MCP server "${serverName}" requires sign-in. Tell the user to open Settings → MCP and click "Sign in" ` +
              `next to "${serverName}". Do not retry this tool until they have.`,
          };
        }
        if (err instanceof McpError && err.auth === 'scope') {
          return {
            ok: false,
            content:
              `MCP server "${serverName}" needs more permissions for this tool. Tell the user to open Settings → MCP ` +
              `and click "Sign in again" next to "${serverName}".`,
          };
        }
        const info = toErrorInfo(err);
        return { ok: false, content: `MCP server "${serverName}": ${info.message}` };
      }
    }
  }

  // --- CRUD ----------------------------------------------------------------------------------

  async function storeAuth(id: string, auth: McpServerAuth | undefined): Promise<void> {
    if (auth) await deps.secrets.set(mcpAuthSecretName(id), JSON.stringify(auth));
    else await deps.secrets.delete(mcpAuthSecretName(id));
  }

  async function add(server: McpServerInput, auth?: McpServerAuth): Promise<McpServerStatus> {
    const current = (await deps.settings.get()).mcpServers;
    const input = validateMcpServerInput(server, current);
    const cleanAuth = validateMcpAuth(auth);
    const id = newId();
    if (cleanAuth) await storeAuth(id, cleanAuth);
    try {
      await deps.settings.update((s) => {
        if (s.mcpServers.some((m) => m.name.toLowerCase() === input.name.toLowerCase())) {
          throw new CcError('invalid', `A server named "${input.name}" already exists`);
        }
        return { ...s, mcpServers: [...s.mcpServers, { id, ...input }] };
      });
    } catch (err) {
      if (cleanAuth) await deps.secrets.delete(mcpAuthSecretName(id)).catch(() => undefined);
      throw err;
    }
    return statusById(id, input.enabled);
  }

  async function update(
    id: string,
    patch: Partial<McpServerInput>,
    auth?: McpServerAuth | null,
  ): Promise<McpServerStatus> {
    const current = (await deps.settings.get()).mcpServers;
    const existing = current.find((s) => s.id === id);
    if (!existing) throw new CcError('invalid', 'Unknown MCP server');
    if (!isRecord(patch)) throw new CcError('invalid', 'Invalid patch');
    const merged = {
      name: patch.name ?? existing.name,
      url: patch.url ?? existing.url,
      enabled: patch.enabled ?? existing.enabled,
      trustReadOnlyHints: patch.trustReadOnlyHints ?? existing.trustReadOnlyHints ?? false,
      oauthClientId: patch.oauthClientId ?? existing.oauthClientId,
    };
    const input = validateMcpServerInput(
      merged,
      current.filter((s) => s.id !== id),
    );
    const cleanAuth = auth === undefined || auth === null ? undefined : validateMcpAuth(auth);
    // A new URL or client id invalidates the OAuth grant: revoke it first (best effort, while the
    // record still matches the old URL).
    const rebind = input.url !== existing.url || (input.oauthClientId ?? '') !== (existing.oauthClientId ?? '');
    if (rebind && deps.oauth) await withTimeout(deps.oauth.signOut(existing), 6_000).catch(() => undefined);
    await deps.settings.update((s) => ({
      ...s,
      mcpServers: s.mcpServers.map((m) => (m.id === id ? { id, ...input } : m)),
    }));
    if (auth !== undefined) await storeAuth(id, cleanAuth);
    // OAuth tokens are bound to the server URL (audience) and the client id: start over.
    if (rebind && deps.oauth) await deps.oauth.forget(id);
    resetRuntime(id); // reconnect with the new config / auth
    return statusById(id, input.enabled);
  }

  async function remove(id: string): Promise<void> {
    const current = (await deps.settings.get()).mcpServers;
    if (!current.some((s) => s.id === id)) throw new CcError('invalid', 'Unknown MCP server');
    const config = current.find((s) => s.id === id);
    if (deps.oauth && config) {
      // Best effort: revoke the tokens before forgetting them.
      await withTimeout(deps.oauth.signOut(config), 6_000).catch(() => undefined);
    }
    resetRuntime(id);
    await deps.settings.update((s) => ({ ...s, mcpServers: s.mcpServers.filter((m) => m.id !== id) }));
    await deps.secrets.delete(mcpAuthSecretName(id));
    if (deps.oauth) await deps.oauth.forget(id);
  }

  async function test(
    target: { id: string } | { server: McpServerInput; auth?: McpServerAuth; authFrom?: string },
  ): Promise<McpTestResult> {
    let url: string;
    let auth: McpServerAuth | undefined;
    let saved: McpServerConfig | undefined;
    if (!isRecord(target)) throw new CcError('invalid', 'Invalid test target');
    if ('id' in target && typeof target.id === 'string') {
      const config = (await deps.settings.get()).mcpServers.find((s) => s.id === target.id);
      if (!config) throw new CcError('invalid', 'Unknown MCP server');
      try {
        url = validateMcpUrl(config.url);
      } catch (err) {
        return { ok: false, error: toErrorInfo(err) };
      }
      auth = await loadAuth(config.id);
      saved = config;
    } else if ('server' in target && isRecord(target.server)) {
      url = validateMcpUrl(target.server.url);
      auth = validateMcpAuth(target.auth);
      if (!auth && 'authFrom' in target && typeof target.authFrom === 'string') {
        if (!(await deps.settings.get()).mcpServers.some((s) => s.id === target.authFrom)) {
          throw new CcError('invalid', 'Unknown MCP server');
        }
        auth = await loadAuth(target.authFrom);
      }
    } else {
      throw new CcError('invalid', 'Invalid test target');
    }
    const client = makeClient(url, auth, undefined, saved);
    try {
      const info = await client.connect();
      const list = await client.listTools();
      return {
        ok: true,
        serverInfo: info.serverInfo,
        protocolVersion: info.protocolVersion,
        tools: list.tools.map((t) => ({ name: t.name, description: t.description })),
      };
    } catch (err) {
      return { ok: false, error: toErrorInfo(err) };
    } finally {
      void client.close();
    }
  }

  async function refresh(id?: string): Promise<McpServerStatus[]> {
    const rts = await sync();
    const chosen = id === undefined ? rts : rts.filter((rt) => rt.config.id === id);
    if (id !== undefined && chosen.length === 0) throw new CcError('invalid', 'Unknown MCP server');
    for (const rt of chosen) {
      rt.freshUntil = 0;
      delete rt.failedAt;
    }
    await statuses(chosen, 'force');
    return Promise.all(rts.map(status));
  }

  async function closeAll(): Promise<void> {
    for (const rt of runtimes.values()) dispose(rt);
    runtimes.clear();
    index = new Map();
  }

  async function configById(id: string): Promise<McpServerConfig> {
    const config = (await deps.settings.get()).mcpServers.find((s) => s.id === id);
    if (!config) throw new CcError('invalid', 'Unknown MCP server');
    return config;
  }

  async function signIn(id: string, options: McpSignInOptions): Promise<McpServerStatus> {
    if (!deps.oauth) throw new CcError('not-implemented', 'OAuth sign-in is not available');
    const config = await configById(id);
    if (await deps.secrets.has(mcpAuthSecretName(id))) {
      throw new CcError('invalid', 'This server uses a saved token / headers. Remove them (Edit) to sign in with OAuth instead.');
    }
    validateMcpUrl(config.url);
    await deps.oauth.signIn(config, options);
    resetRuntime(id); // reconnect with the new token
    return statusById(id, config.enabled);
  }

  async function signOut(id: string): Promise<McpServerStatus> {
    if (!deps.oauth) throw new CcError('not-implemented', 'OAuth sign-in is not available');
    const config = await configById(id);
    await deps.oauth.signOut(config);
    resetRuntime(id);
    return statusById(id, false);
  }

  return {
    id: 'mcp',
    label: 'MCP',
    listTools,
    callTool,
    list: async () => statuses(await sync(), 'auto'),
    add,
    update,
    remove,
    test,
    refresh,
    closeAll,
    signIn,
    signOut,
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new CcError('invalid', `Missing or invalid ${what}`);
  return value;
}

function optionalAuth(value: unknown): McpServerAuth | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new CcError('invalid', 'Invalid auth');
  return value;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CcError('network', `Timed out after ${Math.round(ms / 1000)} s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function manifestVersion(): string {
  try {
    const g = globalThis as { chrome?: { runtime?: { getManifest?: () => { version?: string } } } };
    return g.chrome?.runtime?.getManifest?.().version ?? '0';
  } catch {
    return '0';
  }
}
