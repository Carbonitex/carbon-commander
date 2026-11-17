import { describe, expect, it, vi } from 'vitest';
import {
  MCP_LIMITS,
  McpClient,
  McpError,
  collectHeaderParams,
  encodeHeaderValue,
  parseToolDescriptor,
  toToolResult,
  type McpClientOptions,
} from '../../src/mcp/client';
import { CcError } from '../../src/shared/types';
import {
  createMockMcpServer,
  defaultMockTools,
  startMockMcpServer,
  type MockMcpOptions,
  type MockMcpServer,
  type MockTool,
} from '../helpers/mock-mcp-server';

const URL_ = 'https://mcp.example.test/mcp';

function setup(
  serverOptions: MockMcpOptions = {},
  clientOptions: Partial<McpClientOptions> = {},
): { server: MockMcpServer; client: McpClient; notifications: string[] } {
  const server = createMockMcpServer(serverOptions);
  const notifications: string[] = [];
  const client = new McpClient({
    url: URL_,
    fetch: server.fetch,
    onNotification: (method) => notifications.push(method),
    ...clientOptions,
  });
  return { server, client, notifications };
}

const posts = (server: MockMcpServer): string[] =>
  server.requests.filter((r) => r.httpMethod === 'POST').map((r) => r.rpcMethod ?? '(response)');

function never(): MockTool {
  return {
    name: 'never',
    inputSchema: { type: 'object' },
    handler: (_args, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  };
}

describe('McpClient: modern (2026-07-28)', () => {
  it('discovers, then sends _meta and mirrored headers on every request (JSON responses)', async () => {
    const { server, client } = setup({ era: 'modern' });
    const info = await client.connect();
    expect(info).toMatchObject({ era: 'modern', protocolVersion: '2026-07-28', serverInfo: { name: 'mock-mcp' } });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo', 'add']);
    const result = await client.callTool('echo', { text: 'hi' });
    expect(toToolResult(result)).toEqual({ ok: true, content: 'hi' });

    expect(posts(server)).toEqual(['server/discover', 'tools/list', 'tools/call']);
    const call = server.requests[2];
    expect(call?.headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(call?.headers['mcp-method']).toBe('tools/call');
    expect(call?.headers['mcp-name']).toBe('echo');
    expect(call?.headers.accept).toBe('application/json, text/event-stream');
    expect(call?.headers['mcp-session-id']).toBeUndefined();
    const meta = (call?.body as { params: { _meta: Record<string, unknown> } }).params._meta;
    expect(meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(meta['io.modelcontextprotocol/clientCapabilities']).toEqual({});
  });

  it('handles SSE responses with interleaved notifications', async () => {
    const { client, notifications } = setup({
      era: 'modern',
      responseMode: 'sse',
      beforeResponse: () => [
        { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } },
        { jsonrpc: '2.0', id: 999, result: { unrelated: true } },
      ],
    });
    const result = await client.callTool('add', { a: 2, b: 3 });
    expect(toToolResult(result)).toEqual({ ok: true, content: '5', data: { sum: 5 } });
    expect(notifications).toContain('notifications/progress');
  });

  it('mirrors x-mcp-header parameters, base64-encoding unsafe values', async () => {
    const tool: MockTool = {
      name: 'sql',
      inputSchema: {
        type: 'object',
        properties: { region: { type: 'string', 'x-mcp-header': 'Region' }, query: { type: 'string' } },
      },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
    const { server, client } = setup({ era: 'modern', tools: [tool] });
    const { tools } = await client.listTools();
    expect(tools[0]?.headerParams).toEqual([{ path: ['region'], header: 'Region' }]);
    await client.callTool('sql', { region: 'Zürich', query: 'x' }, { tool: tools[0] });
    const last = server.requests.at(-1);
    expect(last?.status).toBe(200);
    expect(last?.headers['mcp-param-region']).toBe(encodeHeaderValue('Zürich'));
    expect(last?.headers['mcp-param-region']).toMatch(/^=\?base64\?.+\?=$/);
  });

  it('falls back to the legacy handshake when the server lists only legacy versions in common', async () => {
    const { server, client } = setup({ era: 'dual', modernVersions: ['2099-01-01'] });
    const info = await client.connect();
    expect(info.era).toBe('legacy');
    expect(posts(server)).toEqual(['server/discover', 'initialize', 'notifications/initialized']);
  });

  it('fails clearly when no version is in common', async () => {
    const { client } = setup({ era: 'modern', modernVersions: ['2099-01-01'] });
    await expect(client.connect()).rejects.toThrow(/No protocol version in common/);
  });
});

describe('McpClient: era-specific behaviour (review fixes)', () => {
  it('ping: legacy sends ping, modern (which removed ping) asks server/discover', async () => {
    const legacy = setup({ era: 'legacy' });
    await legacy.client.ping();
    expect(posts(legacy.server)).toContain('ping');
    const modern = setup({ era: 'modern' });
    await modern.client.ping();
    expect(posts(modern.server)).toEqual(['server/discover', 'server/discover']);
  });

  it('modern: re-issues a request whose response stream broke, with a new id', async () => {
    const server = createMockMcpServer({ era: 'modern', responseMode: 'sse' });
    let broken = 0;
    const ids: unknown[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { id?: unknown; method?: string }) : {};
      if (body.method === 'tools/call') {
        ids.push(body.id);
        if (broken++ === 0) {
          // A stream that ends without the response.
          return new Response('data: \n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
      }
      return server.fetch(input, init);
    };
    const client = new McpClient({ url: URL_, fetch: fetchFn });
    const result = await client.callTool('add', { a: 1, b: 2 });
    expect(result.structuredContent).toEqual({ sum: 3 });
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toEqual(ids[1]);
  });

  it('modern: gives up after one re-issue', async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { method?: string }) : {};
      if (body.method === 'tools/call') return new Response('data: \n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      return createMockMcpServer({ era: 'modern' }).fetch(input, init);
    };
    const client = new McpClient({ url: URL_, fetch: fetchFn });
    await expect(client.callTool('add', { a: 1, b: 2 })).rejects.toThrow(/closed the response stream/);
  });

  it('legacy: waits the server\'s retry before resuming, beyond the old 5 s cap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { server, client } = setup({ era: 'legacy', responseMode: 'sse', dropBeforeResponse: true, retryMs: 8_000 });
      await client.connect();
      const listing = client.listTools();
      await vi.advanceTimersByTimeAsync(7_000);
      expect(server.requests.some((r) => r.httpMethod === 'GET')).toBe(false);
      await vi.advanceTimersByTimeAsync(1_500);
      const { tools } = await listing;
      expect(tools).toHaveLength(2);
      expect(server.requests.some((r) => r.httpMethod === 'GET')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to initialize when a discover result lists only legacy versions', async () => {
    const legacy = createMockMcpServer({ era: 'legacy' });
    const fetchFn: typeof fetch = async (input, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { id?: number; method?: string }) : {};
      if (body.method === 'server/discover') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { supportedVersions: ['2025-11-25'], capabilities: {} } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return legacy.fetch(input, init);
    };
    const client = new McpClient({ url: URL_, fetch: fetchFn });
    const info = await client.connect();
    expect(info.era).toBe('legacy');
    expect(info.protocolVersion).toBe('2025-11-25');
  });

  it('does not follow redirects (credentials would go along) and says so', async () => {
    const seen: RequestInit[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      seen.push(init ?? {});
      return Response.redirect('https://elsewhere.example/mcp', 307);
    };
    const client = new McpClient({ url: URL_, fetch: fetchFn, auth: { bearerToken: 't' } });
    await expect(client.connect()).rejects.toThrow(/redirect/);
    expect(seen.every((i) => i.redirect === 'manual')).toBe(true);
  });
});

describe('McpClient: legacy (initialize + sessions)', () => {
  it('initializes, sends the session id and negotiated version afterwards', async () => {
    const { server, client } = setup({ era: 'legacy' });
    const info = await client.connect();
    expect(info).toMatchObject({ era: 'legacy', protocolVersion: '2025-11-25' });
    expect(client.session).toBe('session-1');
    await client.listTools();

    expect(posts(server)).toEqual(['server/discover', 'initialize', 'notifications/initialized', 'tools/list']);
    const init = server.requests[1];
    expect(init?.headers['mcp-session-id']).toBeUndefined();
    expect(init?.headers['mcp-protocol-version']).toBeUndefined();
    const list = server.requests[3];
    expect(list?.headers['mcp-session-id']).toBe('session-1');
    expect(list?.headers['mcp-protocol-version']).toBe('2025-11-25');
    expect((list?.body as { params: Record<string, unknown> }).params._meta).toBeUndefined();
  });

  it('re-initializes once, transparently, when the session expired (404)', async () => {
    const { server, client } = setup({ era: 'legacy' });
    await client.listTools();
    server.expireSessions();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(client.session).toBe('session-2');
    expect(posts(server).filter((m) => m === 'initialize')).toHaveLength(2);
  });

  it('answers server requests on SSE streams (ping -> result, others -> method not found)', async () => {
    const { server, client, notifications } = setup({
      era: 'legacy',
      responseMode: 'sse',
      beforeResponse: (method) =>
        method === 'tools/call'
          ? [
              { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
              { jsonrpc: '2.0', id: 'srv-1', method: 'ping' },
              { jsonrpc: '2.0', id: 'srv-2', method: 'sampling/createMessage', params: {} },
            ]
          : [],
    });
    const result = await client.callTool('echo', { text: 'x' });
    expect(toToolResult(result).content).toBe('x');
    expect(notifications).toEqual(['notifications/tools/list_changed']);
    await vi_waitFor(() => server.clientMessages.length >= 3);
    expect(server.clientMessages).toEqual(
      expect.arrayContaining([
        { jsonrpc: '2.0', id: 'srv-1', result: {} },
        { jsonrpc: '2.0', id: 'srv-2', error: { code: -32601, message: 'Method not found' } },
      ]),
    );
  });

  it('resumes a stream closed before the response with GET + Last-Event-ID', async () => {
    const { server, client } = setup({ era: 'legacy', responseMode: 'sse', dropBeforeResponse: true });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(2);
    const get = server.requests.find((r) => r.httpMethod === 'GET');
    expect(get?.headers['last-event-id']).toBeDefined();
    expect(get?.headers['mcp-session-id']).toBe('session-1');
  });

  it('DELETEs the session on close', async () => {
    const { server, client } = setup({ era: 'legacy' });
    await client.connect();
    await client.close();
    expect(server.requests.at(-1)?.httpMethod).toBe('DELETE');
    expect(server.sessions.size).toBe(0);
  });

  it('sends notifications/cancelled when a request is aborted', async () => {
    const { server, client } = setup({ era: 'legacy', tools: [never()] });
    await client.connect();
    const ac = new AbortController();
    const pending = client.callTool('never', {}, { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CcError);
    expect((err as CcError).code).toBe('aborted');
    await vi_waitFor(() => server.clientMessages.some((m) => m.method === 'notifications/cancelled'));
    const cancel = server.clientMessages.find((m) => m.method === 'notifications/cancelled');
    expect(cancel?.params).toMatchObject({ reason: 'Aborted by the user' });
  });
});

describe('McpClient: errors, auth, limits', () => {
  it('times out a slow request', async () => {
    const { client } = setup({ era: 'modern', tools: [never()] }, { toolCallTimeoutMs: 30 });
    const err = await client.callTool('never', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe('network');
    expect((err as McpError).message).toMatch(/timed out/);
  });

  it('aborts in the modern era without sending a cancel notification', async () => {
    const { server, client } = setup({ era: 'modern', tools: [never()] });
    await client.connect();
    const ac = new AbortController();
    ac.abort();
    await expect(client.callTool('never', {}, { signal: ac.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(server.clientMessages).toHaveLength(0);
  });

  it('sends the bearer token and custom headers', async () => {
    const { server, client } = setup(
      { era: 'modern', token: 'tok-123' },
      { auth: { bearerToken: 'tok-123', headers: { 'X-Api-Key': 'k' } } },
    );
    await client.listTools();
    expect(server.requests.every((r) => r.headers.authorization === 'Bearer tok-123')).toBe(true);
    expect(server.requests[0]?.headers['x-api-key']).toBe('k');
  });

  it('reports 401 without credentials (and without OAuth hooks) as a sign-in requirement', async () => {
    const { client } = setup({ era: 'modern', token: 'secret' });
    const err = await client.connect().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'http', status: 401 });
    expect((err as Error).message).toMatch(/^This server requires sign-in \(OAuth\)\. Save it, then click "Sign in"/);
    expect((err as Error).message).not.toMatch(/not supported/);
  });

  it('reports 401 with a wrong token as rejected credentials', async () => {
    const { client } = setup({ era: 'legacy', token: 'secret' }, { auth: { bearerToken: 'wrong' } });
    await expect(client.connect()).rejects.toThrow(/rejected the credentials/);
  });

  it('turns JSON-RPC errors into McpError with the rpc code', async () => {
    const { client } = setup({ era: 'modern' });
    const err = await client.callTool('missing', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).rpc?.code).toBe(-32602);
  });

  it('rejects unexpected content types and missing answers', async () => {
    const html = new McpClient({
      url: URL_,
      fetch: () => Promise.resolve(new Response('<html>', { headers: { 'Content-Type': 'text/html' } })),
    });
    await expect(html.connect()).rejects.toThrow(/Content-Type|does not accept MCP/);

    const network = new McpClient({ url: URL_, fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(network.connect()).rejects.toMatchObject({ code: 'network' });
  });

  it('follows tools/list pagination', async () => {
    const tools: MockTool[] = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
      name,
      inputSchema: { type: 'object' },
      handler: () => ({ content: [] }),
    }));
    const { server, client } = setup({ era: 'modern', tools, pageSize: 2 });
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(posts(server).filter((m) => m === 'tools/list')).toHaveLength(3);
    const cursors = server.requests
      .filter((r) => r.rpcMethod === 'tools/list')
      .map((r) => (r.body as { params: { cursor?: string } }).params.cursor);
    expect(cursors).toEqual([undefined, '2', '4']);
  });

  it('caps the number of tools and stops on a repeated cursor', async () => {
    let calls = 0;
    const fetchLoop: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { id: number; method: string };
      calls++;
      if (body.method === 'server/discover') {
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { supportedVersions: ['2026-07-28'] } });
      }
      const tools = Array.from({ length: 10 }, (_, i) => ({ name: `t${calls}_${i}`, inputSchema: { type: 'object' } }));
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools, nextCursor: 'same' } });
    };
    const client = new McpClient({ url: URL_, fetch: fetchLoop });
    const list = await client.listTools();
    expect(list.tools).toHaveLength(20); // two pages: the cursor repeated on the second
    expect(list.tools.length).toBeLessThanOrEqual(MCP_LIMITS.maxToolsPerServer);
  });
});

describe('tool descriptors', () => {
  it('validates and caps untrusted tool definitions', () => {
    expect(parseToolDescriptor({ name: 'x' })).toBeNull();
    expect(parseToolDescriptor({ name: '', inputSchema: { type: 'object' } })).toBeNull();
    expect(parseToolDescriptor({ name: 'x', inputSchema: { type: 'string' } })).toBeNull();
    const t = parseToolDescriptor({
      name: 'x',
      description: 'd'.repeat(10_000),
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: 'yes' },
    });
    expect(t?.inputSchema.type).toBe('object');
    expect(t?.description.length).toBeLessThan(MCP_LIMITS.maxDescriptionChars + 100);
    expect(t?.annotations).toEqual({ readOnlyHint: true });
  });

  it('rejects tools with invalid x-mcp-header annotations', () => {
    expect(collectHeaderParams({ properties: { n: { type: 'number', 'x-mcp-header': 'N' } } })).toBeNull();
    expect(collectHeaderParams({ properties: { a: { type: 'string', 'x-mcp-header': 'bad header' } } })).toBeNull();
    expect(
      collectHeaderParams({
        properties: { a: { type: 'string', 'x-mcp-header': 'X' }, b: { type: 'string', 'x-mcp-header': 'x' } },
      }),
    ).toBeNull();
    expect(
      collectHeaderParams({ properties: { list: { type: 'array', items: { type: 'string', 'x-mcp-header': 'L' } } } }),
    ).toBeNull();
    expect(
      collectHeaderParams({
        properties: { outer: { type: 'object', properties: { id: { type: 'integer', 'x-mcp-header': 'Id' } } } },
      }),
    ).toEqual([{ path: ['outer', 'id'], header: 'Id' }]);
  });

  it('encodes header values per the spec', () => {
    expect(encodeHeaderValue('us-west1')).toBe('us-west1');
    expect(encodeHeaderValue('Hello, 世界')).toBe('=?base64?SGVsbG8sIOS4lueVjA==?=');
    expect(encodeHeaderValue(' padded ')).toBe('=?base64?IHBhZGRlZCA=?=');
    expect(encodeHeaderValue('line1\nline2')).toBe('=?base64?bGluZTEKbGluZTI=?=');
    expect(encodeHeaderValue('=?base64?literal?=')).toBe('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
    // Interior spaces are plain; any control character (TAB too) is encoded.
    expect(encodeHeaderValue('a b')).toBe('a b');
    expect(encodeHeaderValue('a\tb')).toBe(`=?base64?${btoa('a\tb')}?=`);
    expect(encodeHeaderValue('a\u0001b')).toBe(`=?base64?${btoa('a\u0001b')}?=`);
  });
});

describe('toToolResult', () => {
  it('maps text, images, resources, structured content and isError', () => {
    const r = toToolResult({
      resultType: 'complete',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
        { type: 'image', mimeType: 'text/html', data: 'PGI+' },
        { type: 'audio', mimeType: 'audio/wav', data: 'AAAA' },
        { type: 'resource_link', uri: 'file:///a.txt', name: 'a.txt', mimeType: 'text/plain' },
        { type: 'resource', resource: { uri: 'file:///b.txt', text: 'inner' } },
        { type: 'resource', resource: { uri: 'file:///c.bin', blob: 'AAAA' } },
        { type: 'weird' },
      ],
      structuredContent: { a: 1 },
      isError: true,
    });
    expect(r.ok).toBe(false);
    expect(r.images).toEqual([{ mime: 'image/png', base64: 'iVBORw0KGgo=' }]);
    expect(r.data).toEqual({ a: 1 });
    expect(r.content.split('\n')).toEqual([
      'hello',
      '[image 1: image/png]',
      '[image omitted: invalid, too large or too many]',
      '[audio omitted: audio/wav]',
      '[resource link] a.txt: file:///a.txt (text/plain)',
      '[resource file:///b.txt]',
      'inner',
      '[binary resource file:///c.bin, ~3 bytes omitted]',
      '[unsupported content type: weird]',
    ]);
  });

  it('uses structured content as text when there is no text block, and truncates', () => {
    expect(toToolResult({ resultType: 'complete', content: [], structuredContent: { n: 1 } }).content).toBe(
      '{\n  "n": 1\n}',
    );
    expect(toToolResult({ resultType: 'complete', content: [] })).toEqual({ ok: true, content: '(no output)' });
    const big = toToolResult({ resultType: 'complete', content: [{ type: 'text', text: 'x'.repeat(100_000) }] });
    expect(big.content).toMatch(/\[truncated 40000 characters\]$/);
  });

  it('reports input_required as a tool error', () => {
    expect(toToolResult({ resultType: 'input_required', content: [] }).ok).toBe(false);
  });
});

describe('real node:http server', () => {
  it('works end to end over HTTP (legacy SSE + modern JSON)', async () => {
    for (const options of [{ era: 'legacy', responseMode: 'sse' }, { era: 'modern' }] as const) {
      const server = await startMockMcpServer({ ...options, token: 't' });
      try {
        const client = new McpClient({ url: server.url, auth: { bearerToken: 't' } });
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(defaultMockTools().map((t) => t.name));
        expect(toToolResult(await client.callTool('add', { a: 1, b: 2 })).content).toBe('3');
        await client.close();
      } finally {
        await server.close();
      }
    }
  });
});

async function vi_waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
