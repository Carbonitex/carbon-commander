import { describe, expect, it, vi } from 'vitest';
import { blockedHostReason, decodeEntities, htmlToText, parseHttpUrl } from '../../src/tools/net';
import { createFetchUrlTool } from '../../src/tools/generic/browser';
import { callContext } from './fakes';

const blocked = (u: string): boolean => blockedHostReason(new URL(u)) !== null;

describe('host blocking', () => {
  it('blocks loopback, private, link-local and local names in any notation', () => {
    for (const u of [
      'http://localhost:8080/', 'http://app.localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/',
      'http://0x7f000001/', 'http://0.0.0.0/', 'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/',
      'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://224.0.0.1/',
      'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://router/',
      'http://nas.local/', 'http://printer.lan/', 'http://svc.internal/', 'http://host.home.arpa/', 'http://localhost./',
    ]) {
      expect(blocked(u), u).toBe(true);
    }
  });

  it('allows public hosts', () => {
    for (const u of ['https://example.com/', 'http://8.8.8.8/', 'https://172.32.0.1/', 'https://[2606:4700::1111]/', 'https://news.ycombinator.com/']) {
      expect(blocked(u), u).toBe(false);
    }
  });

  it('parseHttpUrl refuses other schemes and credentials', () => {
    expect(() => parseHttpUrl('file:///etc/passwd')).toThrow(/Only http and https/);
    expect(() => parseHttpUrl('javascript:alert(1)')).toThrow(/Only http/);
    expect(() => parseHttpUrl('https://user:pw@example.com/')).toThrow(/credentials/);
    expect(parseHttpUrl('/x?y=1', 'https://a.test/b/c').href).toBe('https://a.test/x?y=1');
  });
});

describe('htmlToText', () => {
  it('reduces HTML to readable text', () => {
    const html = `<!doctype html><html><head><title>The &amp; Title</title><style>p{}</style></head><body>
      <nav><a href="/">Home</a></nav>
      <h1>Big &lt;Heading&gt;</h1>
      <p>First <b>para</b> with <a href="/rel?a=1&amp;b=2">a link</a> and &#8220;quotes&#x201D;.</p>
      <script>alert("no")</script><!-- comment -->
      <ul><li>One</li><li>Two</li></ul>
      <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
      <pre>  indented\n    code</pre>
      <footer>foot</footer></body></html>`;
    const { title, text } = htmlToText(html, 'https://site.test/dir/page');
    expect(title).toBe('The & Title');
    expect(text).toContain('# Big <Heading>');
    expect(text).toContain('First para with [a link](https://site.test/rel?a=1&b=2) and “quotes”.');
    expect(text).toContain('- One\n- Two');
    expect(text).toContain('| A | B |');
    expect(text).toContain('```\n  indented\n    code\n```');
    expect(text).not.toMatch(/alert|comment|Home|foot|p\{\}/);
  });

  it('decodes entities', () => {
    expect(decodeEntities('&lt;a&gt; &amp;amp; &#65;&#x42; &unknown; &nbsp;')).toBe('<a> &amp; AB &unknown;  ');
  });
});

describe('fetch_url', () => {
  const ctx = callContext();
  const make = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    const fetchFn = vi.fn(impl);
    return { tool: createFetchUrlTool({ fetch: fetchFn as unknown as typeof fetch }), fetchFn };
  };
  const withUrl = (res: Response, url: string): Response => {
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };

  it('refuses private hosts without making a request', async () => {
    const { tool, fetchFn } = make(async () => new Response('x'));
    const r = await tool.run({ url: 'http://192.168.0.1/admin' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Refused/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches without credentials and reduces HTML', async () => {
    const { tool, fetchFn } = make(async (url) =>
      withUrl(new Response('<html><head><title>T</title></head><body><h2>Hi</h2><p>there</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }), url),
    );
    const r = await tool.run({ url: 'https://example.com/a' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('Title: T');
    expect(r.content).toContain('## Hi\n\nthere');
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', method: 'GET' });
  });

  it('refuses content after a redirect to a private host', async () => {
    const { tool } = make(async () => withUrl(new Response('secret', { headers: { 'content-type': 'text/plain' } }), 'http://10.0.0.5/'));
    const r = await tool.run({ url: 'https://example.com/redirect' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).not.toContain('secret');
  });

  it('pretty-prints JSON, rejects binary, paginates, and reports HTTP errors', async () => {
    const json = make(async (url) => withUrl(new Response('{"a":[1,2]}', { headers: { 'content-type': 'application/json' } }), url));
    expect((await json.tool.run({ url: 'https://api.test/x' }, ctx)).content).toContain('{\n  "a": [');
    const bin = make(async (url) => withUrl(new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }), url));
    expect((await bin.tool.run({ url: 'https://a.test/i.png' }, ctx)).content).toMatch(/not text/);
    const long = make(async (url) => withUrl(new Response('y'.repeat(5000), { headers: { 'content-type': 'text/plain' } }), url));
    const page = await long.tool.run({ url: 'https://a.test/t', max_chars: 1000 }, ctx);
    expect(page.content).toContain('offset=1000');
    const notFound = make(async (url) => withUrl(new Response('nope', { status: 404, statusText: 'Not Found', headers: { 'content-type': 'text/plain' } }), url));
    const r404 = await notFound.tool.run({ url: 'https://a.test/missing' }, ctx);
    expect(r404.ok).toBe(false);
    expect(r404.content).toContain('HTTP error 404');
  });

  it('is an egress tool (asks first) and does not follow redirects', async () => {
    const { tool, fetchFn } = make(async () => {
      const res = new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } });
      return res;
    });
    expect(tool.egress).toBe(true);
    const r = await tool.run({ url: 'https://example.com/r' }, ctx);
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/does not follow redirects/);
  });
});

describe('blockedHostReason: names that resolve to private addresses', () => {
  it('refuses wildcard / loopback DNS services and names embedding a private IPv4', () => {
    for (const host of ['127.0.0.1.nip.io', 'app.10.1.2.3.sslip.io', 'x.lvh.me', 'localtest.me', '10.1.2.3.example.com', '192-168-1-2.example.com', 'app-10-1-2-7.example.net']) {
      expect(blockedHostReason(new URL(`https://${host}/`)), host).not.toBeNull();
    }
    for (const host of ['8.8.8.8.example.com', '1-2-3-4.example.com', 'v10-0-1.example.com', 'example.com']) {
      expect(blockedHostReason(new URL(`https://${host}/`)), host).toBeNull();
    }
  });
});
