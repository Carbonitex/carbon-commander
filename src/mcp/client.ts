/**
 * Model Context Protocol client for the **Streamable HTTP** transport, written for an MV3 service
 * worker: `fetch` only, no Node APIs, no timers that outlive a request, and every piece of state
 * can be lost at any time (the next call simply reconnects).
 *
 * Dual-era, per the MCP specification revision **2026-07-28**
 * (https://modelcontextprotocol.io/specification/2026-07-28):
 *
 * - **Modern** (2026-07-28): stateless. Every request carries `_meta.io.modelcontextprotocol/*`
 *   (protocol version, client info, client capabilities) mirrored into the `MCP-Protocol-Version`,
 *   `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` headers. No `initialize`, no session, no `ping`
 *   (removed in this revision). Cancellation is closing the response stream (aborting the fetch).
 *   Streams are not resumable: a response stream that breaks before the answer is re-issued as a
 *   new request (new id), as the revision requires. `connect()` probes with `server/discover`.
 * - **Legacy** (2025-11-25, 2025-06-18, 2025-03-26): `initialize` + `notifications/initialized`,
 *   `MCP-Protocol-Version` on later requests, `Mcp-Session-Id` (re-initialised once on 404),
 *   server->client requests on SSE streams (answered `ping` / method-not-found), resumable SSE
 *   streams via `GET` + `Last-Event-ID`, `notifications/cancelled`, session `DELETE` on close.
 *
 * Era detection follows the spec's "Backward Compatibility" rules: try `server/discover`; a
 * recognised modern error (-32020/-32021/-32022) means a modern server, anything else (4xx without
 * such a body, other JSON-RPC errors, silence) falls back to `initialize`.
 *
 * OAuth: the client attaches the bearer token the `authHooks` give it (see `auth.ts`), and on a
 * 401 asks them once for a fresh token (refresh) before failing with a "sign in" error. Out of
 * scope: the deprecated HTTP+SSE transport (hinted at in the error), `subscriptions/listen`, multi
 * round-trip input requests (reported as tool errors).
 *
 * Everything the server sends is untrusted: shapes are validated and sizes are capped.
 */
import { parseSse, SseTooLarge } from '../llm/sse';
import { createLogger } from '../shared/logger';
import {
  CcError,
  type ErrorCode,
  type JsonSchemaObject,
  type McpServerAuth,
  type McpServerInfo,
  type ToolImage,
  type ToolResult,
} from '../shared/types';

const log = createLogger('mcp');

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Modern (stateless) revisions this client speaks, preferred first. */
export const MODERN_PROTOCOL_VERSIONS: readonly string[] = ['2026-07-28'];
/** Legacy (`initialize`-based) Streamable HTTP revisions this client speaks, preferred first. */
export const LEGACY_PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26'];
/**
 * Also accepted when a server answers `initialize` with it: `2024-11-05` defined the old HTTP+SSE
 * transport, but servers built on SDKs of that time often serve the same JSON-RPC messages over a
 * Streamable HTTP endpoint and negotiate down to it. Never offered by this client.
 */
export const ACCEPTED_LEGACY_VERSIONS: readonly string[] = [...LEGACY_PROTOCOL_VERSIONS, '2024-11-05'];

export type McpEra = 'modern' | 'legacy';

/** JSON-RPC error codes the client interprets. */
export const RPC_ERRORS = {
  methodNotFound: -32601,
  invalidParams: -32602,
  headerMismatch: -32020,
  missingClientCapability: -32021,
  unsupportedProtocolVersion: -32022,
} as const;

const MODERN_ERROR_CODES: ReadonlySet<number> = new Set([
  RPC_ERRORS.headerMismatch,
  RPC_ERRORS.missingClientCapability,
  RPC_ERRORS.unsupportedProtocolVersion,
]);

/** Caps applied to everything a server returns. */
export const MCP_LIMITS = {
  /** Bytes read from one HTTP response (JSON body or the whole SSE stream). */
  maxResponseBytes: 16 * 1024 * 1024,
  maxToolsPerServer: 256,
  maxToolListPages: 32,
  maxToolNameLength: 256,
  maxDescriptionChars: 2_000,
  maxTitleChars: 200,
  /** `JSON.stringify(inputSchema).length`; larger tools are dropped. */
  maxSchemaChars: 64 * 1024,
  /** Characters of tool result text given to the model. */
  maxResultChars: 60_000,
  maxImages: 8,
  maxImageBase64Chars: 8 * 1024 * 1024,
  /** Characters of server-provided error messages surfaced to the user / model. */
  maxErrorChars: 500,
  /** Legacy: `GET` + `Last-Event-ID` resumptions of one response stream. */
  maxStreamResumes: 3,
  /**
   * Legacy: the server's SSE `retry` (ms before resuming) is respected up to this bound (the spec
   * gives none; the request timeout still applies on top).
   */
  maxResumeDelayMs: 30_000,
  /** Modern: a response stream that broke before answering is re-issued this many times. */
  maxReissues: 1,
} as const;

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
/** Legacy servers may stay silent on `server/discover`: do not wait the full connect timeout. */
const DISCOVER_TIMEOUT_MS = 10_000;
const NOTIFY_TIMEOUT_MS = 10_000;

const ACCEPT = 'application/json, text/event-stream';

// ---------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------

export interface McpClientInfo {
  name: string;
  version: string;
}

export interface McpClientOptions {
  /** Streamable HTTP endpoint. Validate it before (see `validateMcpUrl` in the manager). */
  url: string;
  auth?: McpServerAuth;
  /** Injectable for tests. Default global `fetch`. */
  fetch?: typeof fetch;
  clientInfo?: McpClientInfo;
  /** Default 60 s. */
  requestTimeoutMs?: number;
  /** Default 120 s. */
  toolCallTimeoutMs?: number;
  /** Bound on `connect()` (era detection + handshake). Default 20 s. */
  connectTimeoutMs?: number;
  /** Era to try first (e.g. remembered from an earlier connection). Default: detect. */
  era?: McpEra;
  /** Server notifications seen on any response stream (e.g. `notifications/tools/list_changed`). */
  onNotification?: (method: string, params: Record<string, unknown> | undefined) => void;
  /** OAuth: where the bearer token comes from (ignored when `auth` has a token or headers). */
  authHooks?: McpAuthHooks;
}

/**
 * OAuth integration (implemented by `auth.ts`). The token only ever goes to `McpClientOptions.url`.
 */
export interface McpAuthHooks {
  /** Current access token (refreshed first when it is about to expire), or null when signed out. */
  accessToken(): Promise<string | null>;
  /**
   * The server answered 401. Resolve true to retry the request once (a fresh token is available,
   * e.g. after a refresh); false to fail with a "sign in" error. Never starts an interactive sign-in.
   */
  onUnauthorized(info: { wwwAuthenticate: string | null; usedToken: string | null }): Promise<boolean>;
  /** The server answered 403 `insufficient_scope` (step-up needed). */
  onInsufficientScope?(info: { wwwAuthenticate: string | null }): void;
}

/** Header mirroring for a tool argument (`x-mcp-header`): value at `path` -> `Mcp-Param-<header>`. */
export interface McpHeaderParam {
  path: string[];
  header: string;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A validated tool from `tools/list`. */
export interface McpToolDescriptor {
  name: string;
  title?: string;
  /** Cleaned and capped; may be empty. */
  description: string;
  inputSchema: JsonSchemaObject;
  annotations?: McpToolAnnotations;
  /** Present when the schema uses `x-mcp-header`. */
  headerParams?: McpHeaderParam[];
}

export interface McpToolList {
  tools: McpToolDescriptor[];
  /** Smallest `ttlMs` hint of the pages (modern servers), if any. */
  ttlMs?: number;
  /** The list was cut at `MCP_LIMITS.maxToolsPerServer` / `maxToolListPages`. */
  truncated: boolean;
}

export interface McpInitializeResult {
  era: McpEra;
  protocolVersion: string;
  serverInfo: McpServerInfo;
  capabilities: Record<string, unknown>;
  instructions?: string;
}

export interface McpCallResult {
  /** `complete` unless the server asked for interactive input (`input_required`). */
  resultType: 'complete' | 'input_required';
  content: unknown[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpCallOptions {
  signal?: AbortSignal;
  /** Default `toolCallTimeoutMs`. */
  timeoutMs?: number;
  /** The descriptor from `listTools`, used for `x-mcp-header` mirroring. */
  tool?: McpToolDescriptor;
}

/** A JSON-RPC error object received from the server (message already cleaned / capped). */
export interface RpcErrorInfo {
  code: number;
  message: string;
  data?: unknown;
}

/** Error thrown by the client. `rpc` is set when the server answered with a JSON-RPC error. */
export class McpError extends CcError {
  readonly rpc: RpcErrorInfo | undefined;
  /** The request timed out (code `network`). */
  readonly timeout: boolean;
  /** OAuth: `sign-in` = the server wants a (new) sign-in; `scope` = it wants more scopes. */
  readonly auth: 'sign-in' | 'scope' | undefined;
  constructor(
    code: ErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown; rpc?: RpcErrorInfo; timeout?: boolean; auth?: 'sign-in' | 'scope' },
  ) {
    super(code, message, options);
    this.name = 'McpError';
    this.rpc = options?.rpc;
    this.timeout = options?.timeout === true;
    this.auth = options?.auth;
  }
}

// ---------------------------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------------------------

type JsonRpcId = string | number;

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

/** 404 on a request that carried a session id: the legacy session expired. */
class SessionExpired extends Error {}

/** Modern era: the response stream ended or failed before the answer arrived. */
class StreamBroken extends Error {}

interface ExchangeOptions {
  signal: AbortSignal | undefined;
  timeoutMs: number;
  /** Extra protocol headers (`Mcp-Name`, `Mcp-Param-*`). */
  headers?: Record<string, string>;
  /** Phase of the request (affects headers and cancellation). */
  phase: 'discover' | 'initialize' | 'normal';
  /** Protocol version to declare (modern requests / discover). */
  version?: string;
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

export class McpClient {
  private readonly doFetch: (input: string, init: RequestInit) => Promise<Response>;
  private readonly clientInfo: McpClientInfo;
  private era: McpEra | undefined;
  private protocolVersion: string | undefined;
  private sessionId: string | undefined;
  private info: McpInitializeResult | undefined;
  private connecting: Promise<McpInitializeResult> | undefined;
  private nextId = 1;

  constructor(readonly options: McpClientOptions) {
    const injected = options.fetch;
    // Never call the native fetch as a method of another object ("Illegal invocation").
    this.doFetch = injected ? (input, init) => injected(input, init) : (input, init) => globalThis.fetch(input, init);
    this.clientInfo = options.clientInfo ?? { name: 'carbon-commander', version: '0' };
    this.era = options.era;
  }

  /** Result of the last successful `connect()`, if still connected. */
  get initializeResult(): McpInitializeResult | undefined {
    return this.info;
  }

  /** Legacy session id, if the server assigned one (exposed for tests / diagnostics). */
  get session(): string | undefined {
    return this.sessionId;
  }

  /**
   * Detect the era and complete the handshake (idempotent; concurrent calls share one attempt).
   * Throws `McpError` / `CcError` (`http` 401/403 for auth, `network`, `invalid`, `aborted`).
   */
  connect(signal?: AbortSignal): Promise<McpInitializeResult> {
    if (this.info) return Promise.resolve(this.info);
    this.connecting ??= this.doConnect().finally(() => {
      this.connecting = undefined;
    });
    return raceAbort(this.connecting, signal);
  }

  /** All tools (follows `nextCursor`), validated and capped. */
  async listTools(signal?: AbortSignal): Promise<McpToolList> {
    const tools: McpToolDescriptor[] = [];
    const names = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let ttlMs: number | undefined;
    let truncated = false;

    for (let page = 0; ; page++) {
      if (page >= MCP_LIMITS.maxToolListPages) {
        truncated = true;
        log.warn('tools/list: too many pages, stopping at', page);
        break;
      }
      const result = await this.request('tools/list', cursor === undefined ? {} : { cursor }, { signal });
      assertComplete(result, 'tools/list');
      if (!Array.isArray(result.tools)) throw invalidResponse('tools/list result has no "tools" array');
      for (const raw of result.tools) {
        if (tools.length >= MCP_LIMITS.maxToolsPerServer) {
          truncated = true;
          break;
        }
        const tool = parseToolDescriptor(raw);
        if (!tool || names.has(tool.name)) continue;
        names.add(tool.name);
        tools.push(tool);
      }
      if (typeof result.ttlMs === 'number' && Number.isFinite(result.ttlMs)) {
        const ttl = Math.max(0, result.ttlMs);
        ttlMs = ttlMs === undefined ? ttl : Math.min(ttlMs, ttl);
      }
      const next = result.nextCursor;
      if (truncated || typeof next !== 'string' || next === '') break;
      if (seenCursors.has(next)) {
        log.warn('tools/list: server repeated a cursor, stopping');
        break;
      }
      seenCursors.add(next);
      cursor = next;
    }
    return ttlMs === undefined ? { tools, truncated } : { tools, ttlMs, truncated };
  }

  /**
   * `tools/call`. A tool-level failure comes back as `isError: true` (not thrown); protocol
   * errors (unknown tool, bad params) throw `McpError` with `rpc` set.
   */
  async callTool(name: string, args: Record<string, unknown>, options: McpCallOptions = {}): Promise<McpCallResult> {
    await this.connect(options.signal);
    const headers: Record<string, string> = {};
    if (this.era === 'modern' && options.tool?.headerParams) {
      for (const p of options.tool.headerParams) {
        const value = headerParamValue(args, p.path);
        if (value !== undefined) headers[`Mcp-Param-${p.header}`] = encodeHeaderValue(value);
      }
    }
    const result = await this.request(
      'tools/call',
      { name, arguments: args },
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? this.options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
        headers,
      },
    );
    return parseCallResult(result);
  }

  /**
   * Liveness check. Legacy servers answer `ping`; the modern revision removed `ping`, so modern
   * servers are asked `server/discover` (cheap, side-effect free).
   */
  async ping(signal?: AbortSignal): Promise<void> {
    await this.connect(signal);
    if (this.era === 'modern') await this.request('server/discover', {}, { signal });
    else await this.request('ping', {}, { signal });
  }

  /**
   * Forget the connection. For a legacy session, best-effort `DELETE` (not awaited beyond a short
   * timeout; 405 is fine). The client can be used again afterwards (it reconnects lazily).
   */
  async close(): Promise<void> {
    const { sessionId, protocolVersion } = this;
    this.reset();
    if (sessionId === undefined) return;
    try {
      const { headers } = await this.baseHeaders();
      headers.set('Mcp-Session-Id', sessionId);
      if (protocolVersion) headers.set('MCP-Protocol-Version', protocolVersion);
      const res = await this.doFetch(this.options.url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
      });
      void res.body?.cancel().catch(() => undefined);
    } catch {
      // best effort
    }
  }

  // -------------------------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------------------------

  private reset(): void {
    this.info = undefined;
    this.sessionId = undefined;
    this.protocolVersion = undefined;
  }

  private async doConnect(): Promise<McpInitializeResult> {
    const deadline = AbortSignal.timeout(this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    if (this.era !== 'legacy') {
      const modern = await this.tryModern(deadline);
      if (modern) return modern;
    }
    return this.initializeLegacy(deadline);
  }

  /** `server/discover`. Returns null when the server is not a modern one (fall back to legacy). */
  private async tryModern(deadline: AbortSignal): Promise<McpInitializeResult | null> {
    let version = MODERN_PROTOCOL_VERSIONS[0] as string;
    const tried = new Set<string>();
    for (;;) {
      tried.add(version);
      let result: Record<string, unknown>;
      try {
        result = await this.exchange('server/discover', {}, {
          signal: deadline,
          timeoutMs: DISCOVER_TIMEOUT_MS,
          phase: 'discover',
          version,
        });
      } catch (err) {
        if (deadline.aborted) throw timeoutError('connect', this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
        if (!(err instanceof McpError)) throw err;
        if (err.status === 401 || err.status === 403) throw err;
        const rpc = err.rpc;
        if (rpc?.code === RPC_ERRORS.unsupportedProtocolVersion) {
          const supported = stringArray(isRecord(rpc.data) ? rpc.data.supported : undefined);
          const modern = MODERN_PROTOCOL_VERSIONS.find((v) => supported.includes(v) && !tried.has(v));
          if (modern) {
            version = modern;
            continue;
          }
          if (supported.some((v) => LEGACY_PROTOCOL_VERSIONS.includes(v))) return null;
          throw new McpError(
            'invalid',
            `No protocol version in common with the server (server supports: ${supported.join(', ') || 'unknown'}; ` +
              `this client: ${[...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS].join(', ')})`,
            { rpc },
          );
        }
        if (rpc && MODERN_ERROR_CODES.has(rpc.code)) throw err;
        // 4xx without a recognised modern error, other JSON-RPC errors, timeouts, odd bodies:
        // a legacy server (or a broken one; `initialize` will tell).
        if (err.code === 'network' && err.status === undefined && !err.timeout) throw err;
        log.debug('server/discover failed, falling back to initialize:', err.message);
        return null;
      }
      assertComplete(result, 'server/discover');
      const supported = stringArray(result.supportedVersions);
      if (supported.length > 0 && !supported.includes(version)) {
        const modern = MODERN_PROTOCOL_VERSIONS.find((v) => supported.includes(v) && !tried.has(v));
        if (modern) {
          version = modern;
          continue;
        }
        // A server that answers discovery but only lists legacy revisions we speak: use those.
        if (supported.some((v) => LEGACY_PROTOCOL_VERSIONS.includes(v))) return null;
        throw new McpError(
          'invalid',
          `No protocol version in common with the server (server supports: ${supported.join(', ')}; ` +
            `this client: ${[...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS].join(', ')})`,
        );
      }
      const meta = isRecord(result._meta) ? result._meta : {};
      this.era = 'modern';
      this.protocolVersion = version;
      this.info = {
        era: 'modern',
        protocolVersion: version,
        serverInfo: parseServerInfo(meta['io.modelcontextprotocol/serverInfo'] ?? result.serverInfo),
        capabilities: isRecord(result.capabilities) ? result.capabilities : {},
        ...optionalText('instructions', result.instructions, MCP_LIMITS.maxDescriptionChars),
      };
      return this.info;
    }
  }

  private async initializeLegacy(deadline: AbortSignal): Promise<McpInitializeResult> {
    this.era = 'legacy';
    this.reset();
    let result: Record<string, unknown>;
    try {
      result = await this.exchange(
        'initialize',
        {
          protocolVersion: LEGACY_PROTOCOL_VERSIONS[0],
          capabilities: {},
          clientInfo: this.clientInfo,
        },
        { signal: deadline, timeoutMs: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS, phase: 'initialize' },
      );
    } catch (err) {
      if (deadline.aborted) throw timeoutError('initialize', this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      if (err instanceof McpError && !err.rpc && (err.status === 400 || err.status === 404 || err.status === 405)) {
        throw new McpError(
          'http',
          `${err.message}. This URL does not accept MCP Streamable HTTP requests: check the endpoint path ` +
            `(often ".../mcp"). Servers that only speak the deprecated HTTP+SSE transport are not supported.`,
          { status: err.status, cause: err },
        );
      }
      throw err;
    }
    const version = result.protocolVersion;
    if (typeof version !== 'string' || !ACCEPTED_LEGACY_VERSIONS.includes(version)) {
      void this.close();
      throw new McpError(
        'invalid',
        `The server chose MCP protocol version "${describeValue(version)}", which this client does not support ` +
          `(supported: ${[...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS].join(', ')})`,
      );
    }
    this.protocolVersion = version;
    await this.notify('notifications/initialized', undefined);
    this.info = {
      era: 'legacy',
      protocolVersion: version,
      serverInfo: parseServerInfo(result.serverInfo),
      capabilities: isRecord(result.capabilities) ? result.capabilities : {},
      ...optionalText('instructions', result.instructions, MCP_LIMITS.maxDescriptionChars),
    };
    return this.info;
  }

  // -------------------------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------------------------

  /** A post-connect request, with one transparent reconnect on session expiry / version change. */
  private async request(
    method: string,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal | undefined; timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    let reissues = 0;
    for (let attempt = 0; ; attempt++) {
      await this.connect(options.signal);
      try {
        return await this.exchange(method, params, {
          signal: options.signal,
          timeoutMs,
          phase: 'normal',
          ...(options.headers ? { headers: options.headers } : {}),
        });
      } catch (err) {
        if (err instanceof StreamBroken) {
          // 2026-07-28: a broken response stream loses the request; re-issue it with a new id.
          if (reissues++ < MCP_LIMITS.maxReissues) {
            log.info(`MCP response stream for "${method}" broke; re-issuing the request`);
            attempt--;
            continue;
          }
          throw invalidResponse('the server closed the response stream without answering');
        }
        if (attempt === 0 && err instanceof SessionExpired) {
          log.info('MCP session expired, re-initialising');
          this.reset();
          continue;
        }
        if (err instanceof SessionExpired) {
          throw new McpError('http', 'The MCP server keeps rejecting the session (404)', { status: 404 });
        }
        if (attempt === 0 && err instanceof McpError && err.rpc?.code === RPC_ERRORS.unsupportedProtocolVersion) {
          log.info('MCP server no longer accepts the protocol version, reconnecting');
          this.reset();
          this.era = undefined;
          continue;
        }
        throw err;
      }
    }
  }

  /** One JSON-RPC request -> response over one POST (plus legacy stream resumption). */
  private async exchange(
    method: string,
    params: Record<string, unknown>,
    options: ExchangeOptions,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const modern = options.phase === 'discover' || (options.phase === 'normal' && this.era === 'modern');
    const version = options.version ?? this.protocolVersion;
    const body: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params: modern && version ? withMeta(params, version, this.clientInfo) : params,
    };
    const sentSession = options.phase === 'normal' ? this.sessionId : undefined;
    const setHeaders = (headers: Headers): void => {
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', ACCEPT);
      if (options.phase !== 'initialize' && version) headers.set('MCP-Protocol-Version', version);
      if (modern) {
        headers.set('Mcp-Method', method);
        const name = params.name ?? params.uri;
        if (typeof name === 'string' && (method === 'tools/call' || method === 'resources/read' || method === 'prompts/get')) {
          headers.set('Mcp-Name', encodeHeaderValue(name));
        }
      }
      if (sentSession !== undefined) headers.set('Mcp-Session-Id', sentSession);
      for (const [k, v] of Object.entries(options.headers ?? {})) headers.set(k, v);
    };

    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    /** Throws the abort / timeout error when the signal fired; otherwise returns. */
    const throwIfAborted = (err: unknown): void => {
      if (options.signal?.aborted) {
        this.cancelLegacy(id, options.phase, 'Aborted by the user');
        throw new CcError('aborted', 'Aborted', { cause: err });
      }
      if (timeout.aborted) {
        this.cancelLegacy(id, options.phase, 'Timed out');
        throw timeoutError(method, options.timeoutMs);
      }
    };

    let res: Response;
    try {
      res = await this.send('POST', setHeaders, JSON.stringify(body), signal);
    } catch (err) {
      throwIfAborted(err);
      if (err instanceof CcError) throw err;
      throw new McpError('network', `Could not reach the MCP server: ${errorText(err)}`, { cause: err });
    }
    if (isRedirect(res)) throw redirectError();

    if (options.phase === 'initialize') {
      const sid = res.headers.get('mcp-session-id');
      if (sid !== null && sid !== '') {
        if (!/^[\x21-\x7e]{1,1024}$/.test(sid)) {
          void res.body?.cancel().catch(() => undefined);
          throw invalidResponse('the server sent an invalid Mcp-Session-Id');
        }
        this.sessionId = sid;
      }
    }

    try {
      if (!res.ok) {
        if (res.status === 404 && sentSession !== undefined) {
          void res.body?.cancel().catch(() => undefined);
          throw new SessionExpired();
        }
        throw await this.httpError(res, signal);
      }
      const response = await this.readResponse(res, id, signal);
      if (response.error !== undefined) throw rpcError(response.error);
      if (!isRecord(response.result)) throw invalidResponse(`${method}: "result" is not an object`);
      return response.result;
    } catch (err) {
      if (err instanceof SessionExpired || err instanceof McpError) throw err;
      throwIfAborted(err);
      if (err instanceof StreamBroken) throw err;
      throw err instanceof CcError ? err : new McpError('network', `MCP request failed: ${errorText(err)}`, { cause: err });
    }
  }

  /** POST a notification or a response to a server request (expects 202). */
  private async notify(method: string, params: Record<string, unknown> | undefined): Promise<void> {
    await this.postRaw(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
  }

  private async postRaw(message: JsonRpcMessage): Promise<void> {
    const { protocolVersion, sessionId } = this;
    const setHeaders = (headers: Headers): void => {
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', ACCEPT);
      if (protocolVersion) headers.set('MCP-Protocol-Version', protocolVersion);
      if (sessionId !== undefined) headers.set('Mcp-Session-Id', sessionId);
    };
    let res: Response;
    try {
      res = await this.send('POST', setHeaders, JSON.stringify(message), AbortSignal.timeout(NOTIFY_TIMEOUT_MS));
    } catch (err) {
      if (err instanceof CcError) throw err;
      throw new McpError('network', `Could not reach the MCP server: ${errorText(err)}`, { cause: err });
    }
    if (isRedirect(res)) throw redirectError();
    if (!res.ok && (res.status === 401 || res.status === 403)) throw await this.httpError(res);
    void res.body?.cancel().catch(() => undefined);
    if (!res.ok) {
      throw new McpError('http', `The MCP server rejected "${message.method ?? 'response'}" (HTTP ${res.status})`, {
        status: res.status,
      });
    }
  }

  /** Legacy servers expect an explicit `notifications/cancelled` (modern: closing the stream is enough). */
  private cancelLegacy(id: JsonRpcId, phase: ExchangeOptions['phase'], reason: string): void {
    if (this.era !== 'legacy' || phase !== 'normal' || !this.info) return;
    this.notify('notifications/cancelled', { requestId: id, reason }).catch(() => undefined);
  }

  /** Static auth headers, or the OAuth access token from the hooks. `token` is the bearer sent. */
  private async baseHeaders(): Promise<{ headers: Headers; token: string | null }> {
    const headers = new Headers();
    for (const [k, v] of Object.entries(this.options.auth?.headers ?? {})) headers.set(k, v);
    let token: string | null = this.options.auth?.bearerToken ?? null;
    const hooks = this.useOAuth() ? this.options.authHooks : undefined;
    if (!token && hooks) token = await hooks.accessToken().catch(() => null);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return { headers, token };
  }

  /** OAuth hooks apply only when no static credentials are configured. */
  private useOAuth(): boolean {
    return !!this.options.authHooks && !this.hasCredentials();
  }

  /**
   * One HTTP request to the endpoint with the auth headers. A 401 is offered to the OAuth hooks
   * once: when they have a fresh token (refresh), the request is sent again with it.
   */
  private async send(
    method: 'POST' | 'GET',
    setHeaders: (h: Headers) => void,
    body: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const hooks = this.useOAuth() ? this.options.authHooks : undefined;
    for (let attempt = 0; ; attempt++) {
      const { headers, token } = await this.baseHeaders();
      setHeaders(headers);
      const res = await this.doFetch(this.options.url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal,
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
      });
      if (res.status === 401 && attempt === 0 && hooks) {
        const retry = await hooks
          .onUnauthorized({ wwwAuthenticate: res.headers.get('www-authenticate'), usedToken: token })
          .catch(() => false);
        if (retry) {
          void res.body?.cancel().catch(() => undefined);
          continue;
        }
      }
      return res;
    }
  }

  private hasCredentials(): boolean {
    const auth = this.options.auth;
    return !!auth && (!!auth.bearerToken || Object.keys(auth.headers ?? {}).length > 0);
  }

  private async httpError(res: Response, signal?: AbortSignal): Promise<McpError> {
    const status = res.status;
    let rpc: RpcErrorInfo | undefined;
    try {
      const text = await readTextCapped(res, 64 * 1024, signal);
      const parsed: unknown = text.trim() === '' ? undefined : JSON.parse(text);
      if (isRecord(parsed) && parsed.error !== undefined) rpc = parseRpcError(parsed.error);
    } catch {
      // not JSON-RPC
    }
    if (status === 401 && this.useOAuth()) {
      return new McpError('http', 'This MCP server requires sign-in. Open Settings → MCP and click "Sign in" for it.', {
        status,
        auth: 'sign-in',
        ...(rpc ? { rpc } : {}),
      });
    }
    if (status === 401) {
      const www = res.headers.get('www-authenticate') ?? '';
      const oauth = /resource_metadata|bearer/i.test(www) || www === '';
      const message = this.hasCredentials()
        ? 'The MCP server rejected the credentials (HTTP 401). Check the token / headers.' +
          (oauth ? ' If this server uses OAuth sign-in instead, remove the saved token / headers (Edit) and sign in.' : '')
        : oauth
          ? 'This server requires sign-in (OAuth). Save it, then click "Sign in" for it in Settings → MCP (or enter a token it accepts).'
          : 'This server requires credentials (HTTP 401); enter a token or headers it accepts.';
      return new McpError('http', message, { status, ...(rpc ? { rpc } : {}) });
    }
    if (status === 403) {
      const www = res.headers.get('www-authenticate');
      const scope = /insufficient_scope/i.test(www ?? '');
      const hooks = this.useOAuth() ? this.options.authHooks : undefined;
      if (scope && hooks) {
        hooks.onInsufficientScope?.({ wwwAuthenticate: www });
        return new McpError(
          'http',
          'The MCP server needs more permissions than the sign-in granted. Open Settings → MCP and click "Sign in again" for it.',
          { status, auth: 'scope', ...(rpc ? { rpc } : {}) },
        );
      }
      return new McpError(
        'http',
        scope
          ? 'The MCP server refused the request: the token lacks the required scope (HTTP 403).'
          : 'The MCP server refused the request (HTTP 403). Check the token / headers; some servers also reject ' +
              'requests from browser extensions (Origin check).',
        { status, ...(rpc ? { rpc } : {}) },
      );
    }
    const detail = rpc ? `: ${rpc.message}` : '';
    return new McpError('http', `The MCP server returned HTTP ${status}${detail}`, { status, ...(rpc ? { rpc } : {}) });
  }

  // -------------------------------------------------------------------------------------------
  // Responses
  // -------------------------------------------------------------------------------------------

  private async readResponse(res: Response, id: JsonRpcId, signal: AbortSignal): Promise<JsonRpcMessage> {
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('text/event-stream')) return this.readSse(res, id, signal);
    if (res.status === 202 || res.status === 204) throw invalidResponse('the server accepted the request without answering it');
    if (type.includes('json') || type === '') {
      const text = await readTextCapped(res, MCP_LIMITS.maxResponseBytes, signal);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw invalidResponse('the response is not valid JSON');
      }
      const found = this.handleIncoming(parsed, id);
      if (!found) throw invalidResponse('the response does not answer the request');
      return found;
    }
    void res.body?.cancel().catch(() => undefined);
    throw invalidResponse(`unexpected Content-Type "${cleanText(type, 80)}"`);
  }

  private async readSse(res: Response, id: JsonRpcId, signal: AbortSignal): Promise<JsonRpcMessage> {
    const modern = this.era === 'modern';
    let body: ReadableStream<Uint8Array> | null = res.body;
    let lastEventId: string | undefined;
    let retryMs: number | undefined;
    let budget = MCP_LIMITS.maxResponseBytes;
    for (let resume = 0; ; resume++) {
      if (!body) throw invalidResponse('empty event stream');
      const limited = limitStream(body, budget, (used) => (budget -= used));
      let answer: JsonRpcMessage | null = null;
      try {
        for await (const ev of parseSse(limited, signal)) {
          if (ev.id !== undefined) lastEventId = ev.id;
          if (ev.retry !== undefined) retryMs = ev.retry;
          if (ev.event !== 'message') continue;
          const data = ev.data.trim();
          if (data === '') continue; // priming event
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            log.warn('Ignoring a non-JSON SSE event from the MCP server');
            continue;
          }
          answer = this.handleIncoming(parsed, id);
          if (answer) break;
        }
      } catch (err) {
        if (err instanceof StreamTooLarge || err instanceof SseTooLarge) throw invalidResponse('the response stream is too large');
        // A network failure mid-stream (not our abort / timeout) is a broken stream.
        if (modern && !signal.aborted) throw new StreamBroken('stream failed', { cause: err });
        throw err;
      }
      if (answer) {
        // The parser released its reader on break: close the stream (the response is complete).
        void limited.cancel().catch(() => undefined);
        return answer;
      }
      // The stream ended without our response. Modern: not resumable, the caller re-issues the
      // request. Legacy servers may close the connection and let the client resume with GET +
      // Last-Event-ID after the `retry` delay they announced (respected, up to a bound).
      if (modern) throw new StreamBroken('stream ended');
      if (this.era !== 'legacy' || lastEventId === undefined || resume >= MCP_LIMITS.maxStreamResumes) {
        throw invalidResponse('the server closed the response stream without answering');
      }
      await sleep(Math.min(retryMs ?? 500, MCP_LIMITS.maxResumeDelayMs), signal);
      body = await this.resumeStream(lastEventId, signal);
    }
  }

  private async resumeStream(lastEventId: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
    const { protocolVersion, sessionId } = this;
    const res = await this.send(
      'GET',
      (headers) => {
        headers.set('Accept', 'text/event-stream');
        headers.set('Last-Event-ID', lastEventId);
        if (protocolVersion) headers.set('MCP-Protocol-Version', protocolVersion);
        if (sessionId !== undefined) headers.set('Mcp-Session-Id', sessionId);
      },
      undefined,
      signal,
    );
    if (isRedirect(res)) throw redirectError();
    if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
      void res.body?.cancel().catch(() => undefined);
      throw invalidResponse(`could not resume the response stream (HTTP ${res.status})`);
    }
    return res.body;
  }

  /**
   * Handle one parsed JSON value from the server (a message or, for 2025-03-26 servers, a batch).
   * Returns our response when found; dispatches notifications; answers legacy server requests.
   */
  private handleIncoming(value: unknown, id: JsonRpcId): JsonRpcMessage | null {
    const messages = Array.isArray(value) ? value.slice(0, 1000) : [value];
    let found: JsonRpcMessage | null = null;
    for (const m of messages) {
      if (!isRecord(m) || m.jsonrpc !== '2.0') continue;
      const msg = m as unknown as JsonRpcMessage;
      if (typeof msg.method === 'string') {
        if (msg.id === undefined || msg.id === null) this.dispatchNotification(msg);
        else this.answerServerRequest(msg);
        continue;
      }
      if ((msg.id === id || String(msg.id) === String(id)) && (msg.result !== undefined || msg.error !== undefined)) {
        found ??= msg;
      }
    }
    // A lone error without a usable id (e.g. a parse error) answers the request too.
    if (!found && !Array.isArray(value) && isRecord(value) && value.jsonrpc === '2.0' && value.error !== undefined) {
      if (value.id === null || value.id === undefined) found = value as unknown as JsonRpcMessage;
    }
    return found;
  }

  private dispatchNotification(msg: JsonRpcMessage): void {
    const method = msg.method as string;
    if (method.length > 200) return;
    try {
      this.options.onNotification?.(method, isRecord(msg.params) ? msg.params : undefined);
    } catch (err) {
      log.warn('MCP notification handler failed', err);
    }
  }

  /**
   * Legacy servers may send requests on a response stream. This client declares no capabilities,
   * so it answers `ping` and rejects everything else with method-not-found. Modern servers must
   * not send requests: ignored.
   */
  private answerServerRequest(msg: JsonRpcMessage): void {
    if (this.era !== 'legacy') return;
    const id = msg.id;
    if (typeof id !== 'string' && typeof id !== 'number') return;
    const reply: JsonRpcMessage =
      msg.method === 'ping'
        ? { jsonrpc: '2.0', id, result: {} }
        : { jsonrpc: '2.0', id, error: { code: RPC_ERRORS.methodNotFound, message: 'Method not found' } };
    this.postRaw(reply).catch((err: unknown) => log.debug('Could not answer a server request', err));
  }
}

// ---------------------------------------------------------------------------------------------
// Result mapping (exported for the manager and tests)
// ---------------------------------------------------------------------------------------------

/**
 * Map an MCP tool result to the agent's `ToolResult`: text blocks joined, images to `images`,
 * resource links / embedded resources as text, `structuredContent` as `data` (and as the text
 * when there is no text block), `isError` -> `ok: false`. Text is capped with a truncation marker.
 */
export function toToolResult(result: McpCallResult): ToolResult {
  if (result.resultType === 'input_required') {
    return {
      ok: false,
      content:
        'The MCP tool asked for interactive input (for example a form or a sign-in), which Carbon Commander does not support yet.',
    };
  }
  const parts: string[] = [];
  const images: ToolImage[] = [];
  let hasText = false;
  for (const block of result.content) {
    if (!isRecord(block)) continue;
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string') {
          parts.push(block.text);
          hasText = true;
        }
        break;
      case 'image': {
        const mime = typeof block.mimeType === 'string' ? block.mimeType.toLowerCase() : '';
        const data = typeof block.data === 'string' ? block.data : '';
        if (/^image\/[a-z0-9.+-]{1,40}$/.test(mime) && isBase64(data) && images.length < MCP_LIMITS.maxImages) {
          images.push({ mime, base64: data });
          parts.push(`[image ${images.length}: ${mime}]`);
        } else {
          parts.push('[image omitted: invalid, too large or too many]');
        }
        break;
      }
      case 'audio':
        parts.push(`[audio omitted${typeof block.mimeType === 'string' ? `: ${cleanText(block.mimeType, 60)}` : ''}]`);
        break;
      case 'resource_link':
        parts.push(describeResourceLink(block));
        break;
      case 'resource':
        parts.push(describeEmbeddedResource(block.resource));
        break;
      default:
        parts.push(`[unsupported content type: ${describeValue(block.type)}]`);
    }
  }
  let content = parts.join('\n');
  const structured = result.structuredContent;
  if (!hasText && structured !== undefined) {
    const json = safeJson(structured);
    content = content ? `${content}\n${json}` : json;
  }
  if (content === '') content = result.isError ? 'The tool reported an error without details.' : '(no output)';
  const out: ToolResult = { ok: result.isError !== true, content: truncate(content, MCP_LIMITS.maxResultChars) };
  if (structured !== undefined) out.data = structured;
  if (images.length > 0) out.images = images;
  return out;
}

function describeResourceLink(block: Record<string, unknown>): string {
  const uri = typeof block.uri === 'string' ? cleanText(block.uri, 2000) : '?';
  const name = typeof block.name === 'string' ? cleanText(block.name, 200) : '';
  const mime = typeof block.mimeType === 'string' ? ` (${cleanText(block.mimeType, 80)})` : '';
  const desc = typeof block.description === 'string' ? ` - ${cleanText(block.description, 500)}` : '';
  return `[resource link] ${name ? `${name}: ` : ''}${uri}${mime}${desc}`;
}

function describeEmbeddedResource(resource: unknown): string {
  if (!isRecord(resource)) return '[resource omitted: invalid]';
  const uri = typeof resource.uri === 'string' ? cleanText(resource.uri, 2000) : '?';
  const mime = typeof resource.mimeType === 'string' ? ` (${cleanText(resource.mimeType, 80)})` : '';
  if (typeof resource.text === 'string') return `[resource ${uri}${mime}]\n${resource.text}`;
  if (typeof resource.blob === 'string') {
    return `[binary resource ${uri}${mime}, ~${Math.floor((resource.blob.length * 3) / 4)} bytes omitted]`;
  }
  return `[resource ${uri}${mime}: no content]`;
}

function parseCallResult(result: Record<string, unknown>): McpCallResult {
  const type = result.resultType;
  if (type === 'input_required') return { resultType: 'input_required', content: [] };
  if (type !== undefined && type !== 'complete') {
    throw invalidResponse(`tools/call returned an unknown resultType "${describeValue(type)}"`);
  }
  if (result.content !== undefined && !Array.isArray(result.content)) {
    throw invalidResponse('tools/call result "content" is not an array');
  }
  const out: McpCallResult = { resultType: 'complete', content: (result.content as unknown[] | undefined) ?? [] };
  if (result.isError === true) out.isError = true;
  if (result.structuredContent !== undefined) out.structuredContent = result.structuredContent;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tool descriptor validation (exported for tests)
// ---------------------------------------------------------------------------------------------

/** Validate one `tools/list` entry; returns null (and logs) for anything unusable. */
export function parseToolDescriptor(raw: unknown): McpToolDescriptor | null {
  if (!isRecord(raw)) return null;
  const name = raw.name;
  if (typeof name !== 'string' || name.length === 0 || name.length > MCP_LIMITS.maxToolNameLength || CONTROL_CHARS.test(name)) {
    log.warn('Skipping an MCP tool with an invalid name');
    return null;
  }
  const schema = raw.inputSchema;
  if (!isRecord(schema)) {
    log.warn(`Skipping MCP tool "${name}": inputSchema is not an object`);
    return null;
  }
  if (schema.type !== undefined && schema.type !== 'object') {
    log.warn(`Skipping MCP tool "${name}": inputSchema type is not "object"`);
    return null;
  }
  let json: string;
  try {
    json = JSON.stringify(schema);
  } catch {
    return null;
  }
  if (json.length > MCP_LIMITS.maxSchemaChars) {
    log.warn(`Skipping MCP tool "${name}": inputSchema is too large`);
    return null;
  }
  const inputSchema = JSON.parse(json) as JsonSchemaObject;
  inputSchema.type = 'object';

  const headerParams = collectHeaderParams(inputSchema);
  if (headerParams === null) {
    log.warn(`Skipping MCP tool "${name}": invalid x-mcp-header annotation`);
    return null;
  }

  const out: McpToolDescriptor = {
    name,
    description: typeof raw.description === 'string' ? cleanText(raw.description, MCP_LIMITS.maxDescriptionChars, true) : '',
    inputSchema,
  };
  if (typeof raw.title === 'string' && raw.title.trim() !== '') out.title = cleanText(raw.title, MCP_LIMITS.maxTitleChars);
  if (isRecord(raw.annotations)) {
    const a = raw.annotations;
    const annotations: McpToolAnnotations = {};
    if (typeof a.title === 'string') annotations.title = cleanText(a.title, MCP_LIMITS.maxTitleChars);
    for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
      if (typeof a[key] === 'boolean') annotations[key] = a[key];
    }
    out.annotations = annotations;
  }
  if (headerParams.length > 0) out.headerParams = headerParams;
  return out;
}

// Matching control characters is the point of these (untrusted server text).
/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const CONTROL_RUNS = /[\u0000-\u001f\u007f]+/g;
const CONTROL_CHARS_EXCEPT_NEWLINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
/* eslint-enable no-control-regex */

const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_HEADER_DEPTH = 16;

/**
 * `x-mcp-header` annotations (2026-07-28): only on primitive (string/integer/boolean) properties
 * reachable from the root through `properties` keys only, token-syntax names, unique
 * case-insensitively. Returns null when any annotation is invalid (the tool must be rejected).
 */
export function collectHeaderParams(schema: Record<string, unknown>): McpHeaderParam[] | null {
  const found: McpHeaderParam[] = [];
  let valid = true;
  const walkProps = (node: Record<string, unknown>, path: string[]): void => {
    if (path.length > MAX_HEADER_DEPTH || !isRecord(node.properties)) return;
    for (const [key, child] of Object.entries(node.properties)) {
      if (!isRecord(child)) continue;
      const childPath = [...path, key];
      if ('x-mcp-header' in child) {
        const header = child['x-mcp-header'];
        const type = child.type;
        if (
          typeof header !== 'string' ||
          header.length > 100 ||
          !TOKEN_RE.test(header) ||
          (type !== 'string' && type !== 'integer' && type !== 'boolean')
        ) {
          valid = false;
        } else {
          found.push({ path: childPath, header });
        }
      }
      walkProps(child, childPath);
    }
  };
  walkProps(schema, []);
  if (!valid) return null;
  // Annotations anywhere else (items, oneOf, $defs, ...) make the tool invalid.
  if (countHeaderAnnotations(schema, 0) !== found.length) return null;
  const names = new Set(found.map((p) => p.header.toLowerCase()));
  if (names.size !== found.length) return null;
  return found;
}

const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples']);

function countHeaderAnnotations(node: unknown, depth: number): number {
  if (depth > 64) return Number.POSITIVE_INFINITY;
  if (Array.isArray(node)) return node.reduce<number>((n, item) => n + countHeaderAnnotations(item, depth + 1), 0);
  if (!isRecord(node)) return 0;
  let n = 'x-mcp-header' in node ? 1 : 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'x-mcp-header' || DATA_KEYWORDS.has(key)) continue;
    if (key === 'properties' || key === 'patternProperties' || key === '$defs' || key === 'definitions') {
      if (isRecord(value)) for (const child of Object.values(value)) n += countHeaderAnnotations(child, depth + 1);
      continue;
    }
    n += countHeaderAnnotations(value, depth + 1);
  }
  return n;
}

function headerParamValue(args: Record<string, unknown>, path: string[]): string | undefined {
  let value: unknown = args;
  for (const key of path) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = value[key];
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

/**
 * Header value encoding (2026-07-28 "Value Encoding"): plain when visible ASCII and interior
 * spaces only (no leading/trailing whitespace), otherwise `=?base64?<base64 of UTF-8>?=`. Any
 * control character, including TAB (which RFC 9110 would allow but the revision lists among the
 * characters that need encoding), is base64-encoded, as is a value that looks like the sentinel.
 */
export function encodeHeaderValue(value: string): string {
  if (value === '') return '';
  const plain = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(value);
  const sentinel = value.startsWith('=?base64?') && value.endsWith('?=');
  if (plain && !sentinel) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `=?base64?${btoa(binary)}?=`;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function withMeta(params: Record<string, unknown>, version: string, clientInfo: McpClientInfo): Record<string, unknown> {
  const meta = isRecord(params._meta) ? params._meta : {};
  return {
    ...params,
    _meta: {
      ...meta,
      'io.modelcontextprotocol/protocolVersion': version,
      'io.modelcontextprotocol/clientInfo': clientInfo,
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  };
}

function assertComplete(result: Record<string, unknown>, method: string): void {
  const type = result.resultType;
  if (type === undefined || type === 'complete') return;
  if (type === 'input_required') throw invalidResponse(`${method}: the server asked for interactive input, which is not supported`);
  throw invalidResponse(`${method}: unknown resultType "${describeValue(type)}"`);
}

function parseServerInfo(value: unknown): McpServerInfo {
  if (!isRecord(value)) return { name: 'unknown', version: '' };
  return {
    name: typeof value.name === 'string' ? cleanText(value.name, 100) : 'unknown',
    version: typeof value.version === 'string' ? cleanText(value.version, 50) : '',
  };
}

function optionalText(key: 'instructions', value: unknown, max: number): { instructions?: string } {
  return typeof value === 'string' && value.trim() !== '' ? { [key]: cleanText(value, max, true) } : {};
}

function parseRpcError(error: unknown): RpcErrorInfo {
  if (!isRecord(error)) return { code: 0, message: 'Unknown error' };
  const code = typeof error.code === 'number' && Number.isInteger(error.code) ? error.code : 0;
  const message = typeof error.message === 'string' ? cleanText(error.message, MCP_LIMITS.maxErrorChars) : 'Unknown error';
  return error.data === undefined ? { code, message } : { code, message, data: error.data };
}

function rpcError(error: unknown): McpError {
  const rpc = parseRpcError(error);
  return new McpError('invalid', `MCP error ${rpc.code}: ${rpc.message}`, { rpc });
}

function invalidResponse(detail: string): McpError {
  return new McpError('invalid', `Invalid response from the MCP server: ${detail}`);
}

/** `redirect: 'manual'` turns a redirect into an opaque response (status 0, no Location). */
function isRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
}

function redirectError(): McpError {
  return new McpError(
    'http',
    'The MCP server answered with a redirect, which is not followed (the token / headers would be sent along). ' +
      'Use the final URL; often this is a missing or extra trailing slash (".../mcp" vs ".../mcp/").',
  );
}

function timeoutError(method: string, ms: number): McpError {
  return new McpError('network', `MCP request "${method}" timed out after ${Math.round(ms / 1000)} s`, { timeout: true });
}

function errorText(err: unknown): string {
  return cleanText(err instanceof Error ? err.message : String(err), MCP_LIMITS.maxErrorChars);
}

/** Short printable rendering of an untrusted value for error messages. */
function describeValue(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? typeof value);
  } catch {
    text = typeof value;
  }
  return cleanText(text, 40);
}

/** Strip control characters (keeping newlines/tabs when `multiline`) and cap the length. */
export function cleanText(text: string, max: number, multiline = false): string {
  const cleaned = multiline ? text.replace(CONTROL_CHARS_EXCEPT_NEWLINES, '') : text.replace(CONTROL_RUNS, ' ');
  return truncate(cleaned.trim(), max);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} characters]`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function isBase64(data: string): boolean {
  return data.length > 0 && data.length <= MCP_LIMITS.maxImageBase64Chars && /^[A-Za-z0-9+/]+={0,2}$/.test(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 50) : [];
}

class StreamTooLarge extends Error {}

/** Pass bytes through until `budget` is exceeded, then error the stream. Reports usage on end. */
function limitStream(
  stream: ReadableStream<Uint8Array>,
  budget: number,
  onUsed: (bytes: number) => void,
): ReadableStream<Uint8Array> {
  let used = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        used += chunk.byteLength;
        if (used > budget) {
          controller.error(new StreamTooLarge());
          return;
        }
        controller.enqueue(chunk);
      },
      flush() {
        onUsed(used);
      },
    }),
  );
}

async function readTextCapped(res: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const onAbort = (): void => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw invalidResponse('the response is too large');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolve/reject with `promise`, or reject with `aborted` as soon as `signal` aborts. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new CcError('aborted', 'Aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new CcError('aborted', 'Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
