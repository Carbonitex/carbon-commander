/**
 * Serve a fetch-style handler (`Request` -> `Response`) on a real `node:http` port. Streaming
 * response bodies are forwarded chunk by chunk; the request's signal aborts when the client goes
 * away. Used by the mock MCP server and the end-to-end test servers.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RunningHttpServer {
  /** e.g. `http://127.0.0.1:43210` (no trailing slash). */
  origin: string;
  port: number;
  close(): Promise<void>;
}

export async function serveFetch(
  handler: (request: Request) => Response | Promise<Response>,
  options: { host?: string; port?: number } = {},
): Promise<RunningHttpServer> {
  const host = options.host ?? '127.0.0.1';
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const method = req.method ?? 'GET';
      const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';
      const request = new Request(`http://${req.headers.host ?? host}${req.url ?? '/'}`, {
        method,
        headers,
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
        signal: abort.signal,
      });
      let response: Response;
      try {
        response = await handler(request);
      } catch (err) {
        response = new Response(String(err), { status: 500 });
      }
      const outHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => (outHeaders[k] = v));
      res.writeHead(response.status, outHeaders);
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch {
          // client went away
        }
      }
      res.end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
