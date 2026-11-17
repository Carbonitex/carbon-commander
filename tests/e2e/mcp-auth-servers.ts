/**
 * Local servers for `mcp-auth.spec.ts` (MCP discovery + OAuth):
 *
 * - a scripted OpenAI-compatible LLM: "call <tool> <json args>" makes it call that tool once and
 *   then report the result ("Tool said: ..."); anything else gets "ok";
 * - a "card site" (served as `http://localhost:<port>`): a page, an AI Catalog at
 *   `/.well-known/ai-catalog.json` naming its server card at `/mcp/server-card` (the `serverInfo`
 *   + `transport` shape), an anonymous mock MCP server at `/mcp`, and protected resource metadata
 *   for a REST API that is not MCP (like a wiki with a public MCP endpoint and an OAuth API); with
 *   `legacy`, the catalog answers 401 and the card is only at `/.well-known/mcp/server-card.json`;
 * - the OAuth site comes from `tests/helpers/mock-oauth-server.ts` (`startOAuthMcpSite`).
 */
import { serveFetch, type RunningHttpServer } from '../helpers/http-server';
import { createMockMcpServer, type MockMcpServer } from '../helpers/mock-mcp-server';

interface WireMessage {
  role: string;
  content: unknown;
}

export interface ScriptedLlm extends RunningHttpServer {
  baseUrl: string;
  requests: { messages: WireMessage[]; tools?: { function: { name: string } }[] }[];
}

const text = (m: WireMessage | undefined): string => (m && typeof m.content === 'string' ? m.content : '');

export async function startScriptedLlm(): Promise<ScriptedLlm> {
  const requests: ScriptedLlm['requests'] = [];
  const running = await serveFetch(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/v1/models') return Response.json({ data: [{ id: 'mock-model', name: 'Mock model', context_length: 32000 }] });
    if (url.pathname !== '/v1/chat/completions') return new Response('Not found', { status: 404 });
    const body = (await request.json()) as ScriptedLlm['requests'][number];
    requests.push(body);
    let lastUser = -1;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      if (body.messages[i]?.role === 'user' && typeof body.messages[i]?.content === 'string') {
        lastUser = i;
        break;
      }
    }
    const prompt = text(body.messages[lastUser]).trim();
    const after = body.messages.slice(lastUser + 1);
    const m = /^call (\S+)\s*(.*)$/s.exec(prompt);
    const id = `c${requests.length}`;
    const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const parts: string[] = [chunk({ role: 'assistant', content: '' })];
    if (m && !after.some((x) => x.role === 'assistant')) {
      parts.push(chunk({ tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: m[1], arguments: m[2] || '{}' } }] }));
      parts.push(chunk({}, 'tool_calls'));
    } else {
      const tool = after.filter((x) => x.role === 'tool').at(-1);
      parts.push(chunk({ content: tool ? `Tool said: ${text(tool)}` : 'ok' }));
      parts.push(chunk({}, 'stop'));
    }
    parts.push('data: [DONE]\n\n');
    return new Response(parts.join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  return Object.assign(running, { baseUrl: `${running.origin}/v1`, requests });
}

export interface CardSite extends RunningHttpServer {
  mcp: MockMcpServer;
  /** Paths requested, in order (to check discovery requests). */
  paths: string[];
}

/** A site that advertises an anonymous MCP server with a server card. */
export async function startCardSite(name = 'Fixture Wiki', options: { legacy?: boolean } = {}): Promise<CardSite> {
  const mcp = createMockMcpServer({ serverInfo: { name: 'fixture-wiki', version: '2.4.0' } });
  const paths: string[] = [];
  let origin = '';
  const running = await serveFetch((request) => {
    const path = new URL(request.url).pathname;
    paths.push(`${request.method} ${path}`);
    switch (path) {
      case '/':
      case '/wiki':
        return new Response(`<!doctype html><title>${name}</title><h1>${name}</h1>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      case '/.well-known/mcp/server-card.json':
        if (!options.legacy) break;
        return Response.json({ serverInfo: { name, version: '2.4.0' }, transport: { type: 'streamable-http', endpoint: `${origin}/mcp` }, capabilities: { tools: {} } });
      case '/.well-known/ai-catalog.json':
        if (options.legacy) return Response.json({ error: 'invalid_token' }, { status: 401 });
        return Response.json(
          { specVersion: '1.0', entries: [{ identifier: 'urn:air:localhost:mcp:wiki', type: 'application/mcp-server-card+json', url: '/mcp/server-card' }] },
          { headers: { 'Content-Type': 'application/ai-catalog+json' } },
        );
      case '/mcp/server-card':
        if (options.legacy) break;
        return Response.json(
          { serverInfo: { name, version: '2.4.0' }, transport: { type: 'streamable-http', endpoint: `${origin}/mcp` }, capabilities: { tools: {} } },
          { headers: { 'Content-Type': 'application/mcp-server-card+json' } },
        );
      case '/.well-known/oauth-protected-resource':
        // The site's REST API is OAuth-protected; it is not an MCP endpoint (the probe tells).
        return Response.json({ resource: `${origin}/wiki`, authorization_servers: [origin], scopes_supported: ['wiki.read'] });
      case '/mcp':
        return mcp.handle(request);
      default:
        break;
    }
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/html' } });
  });
  // Another host name than the OAuth site's 127.0.0.1, so the two get different server names.
  origin = running.origin.replace('127.0.0.1', 'localhost');
  return Object.assign(running, { origin, mcp, paths });
}
