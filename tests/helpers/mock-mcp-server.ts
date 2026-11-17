/**
 * Mock MCP server (Streamable HTTP) for unit tests and the Playwright smoke test.
 *
 * - `createMockMcpServer(options)` gives an in-process server: `server.fetch` is a drop-in `fetch`
 *   for the client, `server.handle(request)` the raw web `Request -> Response` handler.
 * - `startMockMcpServer(options)` serves the same handler on a real `node:http` port.
 *
 * Speaks MCP 2026-07-28 (stateless, `_meta` + mirrored headers, `server/discover`) and the legacy
 * initialize-based revisions (2025-11-25 / 2025-06-18 / 2025-03-26 with `Mcp-Session-Id`), or both
 * (`era: 'dual'`, the default). Default tools: `echo` (read-only) and `add`.
 */
import { serveFetch } from './http-server';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

export interface MockToolContext {
  signal: AbortSignal;
}

export interface MockTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  /** Returns a raw MCP `CallToolResult` (`{ content, isError?, structuredContent? }`). Throwing -> `isError`. */
  handler(args: Record<string, unknown>, ctx: MockToolContext): unknown;
}

export interface MockMcpOptions {
  /** Which protocol era(s) to serve. Default `dual`. */
  era?: 'modern' | 'legacy' | 'dual';
  /** Answer requests with a JSON body or an SSE stream. Default `json`. */
  responseMode?: 'json' | 'sse';
  /** Require `Authorization: Bearer <token>`. */
  token?: string;
  /** Default `defaultMockTools()`. */
  tools?: MockTool[];
  /** `tools/list` page size. Default: everything on one page. */
  pageSize?: number;
  serverInfo?: { name: string; version: string };
  modernVersions?: string[];
  legacyVersions?: string[];
  /** `ttlMs` on modern `tools/list` / `server/discover` results. */
  ttlMs?: number;
  /** SSE mode: extra messages (notifications, server requests) sent before the response. */
  beforeResponse?: (rpcMethod: string) => unknown[];
  /**
   * Legacy + SSE: send a priming event (with an id), then close the stream without the response;
   * the response is delivered when the client resumes with `GET` + `Last-Event-ID`.
   */
  dropBeforeResponse?: boolean;
  /** SSE `retry:` (ms) sent with priming events. Default 10. */
  retryMs?: number;
  /**
   * Custom auth (e.g. OAuth, see `mock-oauth-server.ts`): return a response (401 / 403) to send
   * instead, or null to serve the request. Called for every request; POSTs after body parsing.
   */
  authorize?: (request: { httpMethod: string; headers: Record<string, string>; rpcMethod?: string; params?: Record<string, unknown> }) => Response | null;
}

export interface LoggedRequest {
  httpMethod: string;
  rpcMethod?: string;
  headers: Record<string, string>;
  body?: unknown;
  status?: number;
}

export interface MockMcpServer {
  handle(request: Request): Promise<Response>;
  /** In-process `fetch` bound to this server (any URL). Honours `init.signal`. */
  fetch: typeof fetch;
  /** Every HTTP request received, in order. */
  readonly requests: LoggedRequest[];
  /** Notifications and responses the client POSTed. */
  readonly clientMessages: Record<string, unknown>[];
  /** Live legacy sessions. */
  readonly sessions: Set<string>;
  /** Forget every legacy session (next request with an old id gets 404). */
  expireSessions(): void;
  /** Mutable: tests may add / remove tools. */
  tools: MockTool[];
  options: MockMcpOptions;
}

export function defaultMockTools(): MockTool[] {
  return [
    {
      name: 'echo',
      description: 'Echo the given text back.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      annotations: { readOnlyHint: true },
      handler: (args) => ({
        content: [{ type: 'text', text: typeof args.text === 'string' ? args.text : JSON.stringify(args.text ?? '') }],
      }),
    },
    {
      name: 'add',
      description: 'Add two numbers.',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
      handler: (args) => {
        const sum = Number(args.a) + Number(args.b);
        return { content: [{ type: 'text', text: String(sum) }], structuredContent: { sum } };
      },
    },
  ];
}

type Json = Record<string, unknown>;

export function createMockMcpServer(options: MockMcpOptions = {}): MockMcpServer {
  const era = options.era ?? 'dual';
  const modernVersions = options.modernVersions ?? MODERN_VERSIONS;
  const legacyVersions = options.legacyVersions ?? LEGACY_VERSIONS;
  const serverInfo = options.serverInfo ?? { name: 'mock-mcp', version: '1.0.0' };
  const requests: LoggedRequest[] = [];
  const clientMessages: Json[] = [];
  const sessions = new Map<string, string>(); // id -> negotiated version
  const pendingResume = new Map<string, unknown>(); // event id -> response message
  let sessionCounter = 0;
  let eventCounter = 0;

  const server: MockMcpServer = {
    handle,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const signal = init?.signal ?? undefined;
      if (signal?.aborted) throw abortError();
      const response = handle(request);
      if (!signal) return response;
      return new Promise<Response>((resolve, reject) => {
        const onAbort = (): void => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        response.then(
          (r) => {
            signal.removeEventListener('abort', onAbort);
            resolve(r);
          },
          (e: unknown) => {
            signal.removeEventListener('abort', onAbort);
            reject(e instanceof Error ? e : new Error(String(e)));
          },
        );
      });
    },
    requests,
    clientMessages,
    get sessions() {
      return new Set(sessions.keys());
    },
    expireSessions: () => sessions.clear(),
    tools: options.tools ?? defaultMockTools(),
    options,
  };

  async function handle(request: Request): Promise<Response> {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    const entry: LoggedRequest = { httpMethod: request.method, headers };
    requests.push(entry);
    const res = await route(request, headers, entry);
    entry.status = res.status;
    return res;
  }

  async function route(request: Request, headers: Record<string, string>, entry: LoggedRequest): Promise<Response> {
    if (options.token !== undefined && headers.authorization !== `Bearer ${options.token}`) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="mock-mcp"' },
      });
    }
    if (request.method !== 'POST' && options.authorize) {
      const denied = options.authorize({ httpMethod: request.method, headers });
      if (denied) return denied;
    }
    if (request.method === 'DELETE') {
      if (era === 'modern') return new Response(null, { status: 405 });
      const sid = headers['mcp-session-id'];
      if (!sid || !sessions.has(sid)) return new Response(null, { status: 404 });
      sessions.delete(sid);
      return new Response(null, { status: 200 });
    }
    if (request.method === 'GET') {
      const last = headers['last-event-id'];
      if (era === 'modern' || !last || !pendingResume.has(last)) return new Response(null, { status: 405 });
      const message = pendingResume.get(last);
      pendingResume.delete(last);
      return sse([{ id: String(++eventCounter), data: message }]);
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });

    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }
    entry.body = body;
    if (!isRecord(body) || body.jsonrpc !== '2.0') {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, 400);
    }
    if (typeof body.method === 'string') entry.rpcMethod = body.method;
    if (options.authorize) {
      const denied = options.authorize({
        httpMethod: 'POST',
        headers,
        ...(typeof body.method === 'string' ? { rpcMethod: body.method } : {}),
        ...(isRecord(body.params) ? { params: body.params } : {}),
      });
      if (denied) return denied;
    }
    if (typeof body.method !== 'string' || body.id === undefined) {
      // Notification or a response to a server request.
      clientMessages.push(body);
      return new Response(null, { status: 202 });
    }
    const method = body.method;
    const id = body.id as string | number;
    const params = isRecord(body.params) ? body.params : {};
    const meta = isRecord(params._meta) ? params._meta : undefined;
    const metaVersion = meta?.['io.modelcontextprotocol/protocolVersion'];

    if (metaVersion !== undefined && era !== 'legacy') {
      return modern(request, headers, id, method, params, meta as Json, metaVersion);
    }
    if (era === 'modern') {
      return json(rpcErr(id, -32020, 'Missing MCP-Protocol-Version / _meta (this server speaks 2026-07-28 only)'), 400);
    }
    return legacy(request, headers, id, method, params);
  }

  async function modern(
    request: Request,
    headers: Record<string, string>,
    id: string | number,
    method: string,
    params: Json,
    meta: Json,
    metaVersion: unknown,
  ): Promise<Response> {
    if (headers['mcp-protocol-version'] !== metaVersion) {
      return json(rpcErr(id, -32020, 'MCP-Protocol-Version header does not match _meta'), 400);
    }
    if (typeof metaVersion !== 'string' || !modernVersions.includes(metaVersion)) {
      const supported = era === 'dual' ? [...modernVersions, ...legacyVersions] : modernVersions;
      return json(rpcErr(id, -32022, 'Unsupported protocol version', { supported, requested: metaVersion }), 400);
    }
    if (!isRecord(meta['io.modelcontextprotocol/clientCapabilities'])) {
      return json(rpcErr(id, -32602, 'Missing clientCapabilities'), 400);
    }
    if (headers['mcp-method'] !== method) return json(rpcErr(id, -32020, 'Mcp-Method mismatch'), 400);
    if (method === 'tools/call') {
      if (decodeHeader(headers['mcp-name']) !== params.name) return json(rpcErr(id, -32020, 'Mcp-Name mismatch'), 400);
      const tool = server.tools.find((t) => t.name === params.name);
      if (tool) {
        const mismatch = checkParamHeaders(tool, isRecord(params.arguments) ? params.arguments : {}, headers);
        if (mismatch) return json(rpcErr(id, -32020, mismatch), 400);
      }
    }
    if (method === 'server/discover') {
      return respond(
        id,
        {
          resultType: 'complete',
          supportedVersions: era === 'dual' ? [...modernVersions, ...legacyVersions] : modernVersions,
          capabilities: { tools: { listChanged: true } },
          _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
          ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs, cacheScope: 'public' } : {}),
        },
        method,
        false,
      );
    }
    const out = await dispatch(method, params, request.signal);
    if ('error' in out) return json({ jsonrpc: '2.0', id, error: out.error }, out.status ?? 200);
    const result: Json = { resultType: 'complete', ...out.result };
    if (method === 'tools/list' && options.ttlMs !== undefined) {
      result.ttlMs = options.ttlMs;
      result.cacheScope = 'public';
    }
    return respond(id, result, method, false);
  }

  async function legacy(
    request: Request,
    headers: Record<string, string>,
    id: string | number,
    method: string,
    params: Json,
  ): Promise<Response> {
    if (method === 'initialize') {
      const requested = params.protocolVersion;
      const version =
        typeof requested === 'string' && legacyVersions.includes(requested) ? requested : (legacyVersions[0] as string);
      const sid = `session-${++sessionCounter}`;
      sessions.set(sid, version);
      const res = await respond(
        id,
        { protocolVersion: version, capabilities: { tools: { listChanged: true } }, serverInfo },
        method,
        true,
      );
      res.headers.set('Mcp-Session-Id', sid);
      return res;
    }
    const sid = headers['mcp-session-id'];
    if (!sid) {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bad Request: No valid session ID provided' } }, 400);
    }
    const version = sessions.get(sid);
    if (version === undefined) {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } }, 404);
    }
    if (headers['mcp-protocol-version'] !== undefined && headers['mcp-protocol-version'] !== version) {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bad protocol version' } }, 400);
    }
    const out = await dispatch(method, params, request.signal);
    if ('error' in out) return json({ jsonrpc: '2.0', id, error: out.error }, 200);
    return respond(id, out.result, method, true);
  }

  async function dispatch(
    method: string,
    params: Json,
    signal: AbortSignal,
  ): Promise<{ result: Json } | { error: Json; status?: number }> {
    switch (method) {
      case 'ping':
        return { result: {} };
      case 'tools/list': {
        const start = typeof params.cursor === 'string' ? Number(params.cursor) : 0;
        if (!Number.isInteger(start) || start < 0) return { error: { code: -32602, message: 'Invalid cursor' } };
        const size = options.pageSize ?? server.tools.length;
        const page = server.tools.slice(start, start + size).map((t) => {
          const out: Json = { name: t.name, inputSchema: t.inputSchema };
          if (t.title !== undefined) out.title = t.title;
          if (t.description !== undefined) out.description = t.description;
          if (t.annotations !== undefined) out.annotations = t.annotations;
          return out;
        });
        const next = start + size < server.tools.length ? String(start + size) : undefined;
        return { result: next === undefined ? { tools: page } : { tools: page, nextCursor: next } };
      }
      case 'tools/call': {
        const tool = server.tools.find((t) => t.name === params.name);
        if (!tool) return { error: { code: -32602, message: `Unknown tool: ${String(params.name)}` } };
        try {
          const result = await tool.handler(isRecord(params.arguments) ? params.arguments : {}, { signal });
          return { result: isRecord(result) ? result : { content: [] } };
        } catch (err) {
          return {
            result: { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true },
          };
        }
      }
      default:
        return { error: { code: -32601, message: 'Method not found' }, status: era === 'modern' ? 404 : 200 };
    }
  }

  async function respond(id: string | number, result: Json, method: string, isLegacy: boolean): Promise<Response> {
    const message = { jsonrpc: '2.0', id, result };
    if (options.responseMode !== 'sse') return json(message, 200);
    const events: { id?: string; data: unknown }[] = [];
    if (isLegacy) events.push({ id: String(++eventCounter), data: '' }); // priming event
    for (const m of options.beforeResponse?.(method) ?? []) events.push({ data: m });
    if (isLegacy && options.dropBeforeResponse && method !== 'initialize') {
      const last = String(++eventCounter);
      events.push({ id: last, data: '' });
      pendingResume.set(last, message);
      return sse(events, 50, options.retryMs);
    }
    events.push({ data: message });
    return sse(events, 0, options.retryMs);
  }

  return server;
}

// ---------------------------------------------------------------------------------------------
// node:http wrapper
// ---------------------------------------------------------------------------------------------

export interface RunningMockMcpServer extends MockMcpServer {
  /** e.g. `http://127.0.0.1:43210/mcp` */
  url: string;
  close(): Promise<void>;
}

/** Serve the mock on `node:http` (127.0.0.1, random port unless given). Path: `/mcp`. */
export async function startMockMcpServer(
  options: MockMcpOptions & { port?: number; host?: string } = {},
): Promise<RunningMockMcpServer> {
  const mock = createMockMcpServer(options);
  const running = await serveFetch(
    (request) => (new URL(request.url).pathname === '/mcp' ? mock.handle(request) : new Response('Not found', { status: 404 })),
    { ...(options.host ? { host: options.host } : {}), ...(options.port ? { port: options.port } : {}) },
  );
  return Object.assign(mock, { url: `${running.origin}/mcp`, close: () => running.close() });
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(message: unknown, status: number): Response {
  return new Response(JSON.stringify(message), { status, headers: { 'Content-Type': 'application/json' } });
}

function rpcErr(id: string | number | null, code: number, message: string, data?: unknown): Json {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** An SSE response; `data: ''` events are priming events (id only). Closes after the last event. */
function sse(events: { id?: string; data: unknown }[], delayMs = 0, retryMs = 10): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const ev of events) {
        let text = '';
        if (ev.id !== undefined) text += `id: ${ev.id}\n`;
        if (ev.data === '') text += `retry: ${retryMs}\ndata: \n\n`;
        else text += `data: ${JSON.stringify(ev.data)}\n\n`;
        controller.enqueue(encoder.encode(text));
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

function decodeHeader(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const m = /^=\?base64\?(.*)\?=$/.exec(value);
  if (!m) return value;
  const binary = atob(m[1] ?? '');
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Check `x-mcp-header` mirroring for top-level properties (enough for tests). */
function checkParamHeaders(tool: MockTool, args: Json, headers: Record<string, string>): string | null {
  const props = isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
  for (const [key, schema] of Object.entries(props)) {
    if (!isRecord(schema) || typeof schema['x-mcp-header'] !== 'string') continue;
    const header = `mcp-param-${schema['x-mcp-header'].toLowerCase()}`;
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (decodeHeader(headers[header]) !== (typeof value === 'string' ? value : JSON.stringify(value))) return `Header ${header} does not match the body`;
  }
  return null;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}
