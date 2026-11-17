// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { enhanceCodeBlocks, renderMarkdown, sanitizeHtml } from '../../src/ui/markdown';
import { setSanitizedHtml } from '../../src/ui/dom';

function render(md: string): HTMLElement {
  const el = document.createElement('div');
  setSanitizedHtml(el, renderMarkdown(md));
  return el;
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNIM56JFTEMLQkA17tMgW5G47AAAAAASUVORK5CYII=';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const el = render('**bold** and `code`\n\n- a\n- b');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('code')?.textContent).toBe('code');
    expect(el.querySelectorAll('li')).toHaveLength(2);
  });

  it('never produces script elements', () => {
    const el = render('hello <script>alert(1)</script>\n\n<script>alert(2)</script>');
    expect(el.querySelector('script')).toBeNull();
    // Raw HTML is shown as text, not interpreted.
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });

  it('drops javascript: and other non-http links but keeps the text', () => {
    const el = render('[click](javascript:alert(1)) [data](data:text/html,<b>x</b>) [vb](vbscript:x) [rel](/relative)');
    const links = Array.from(el.querySelectorAll('a'));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.hasAttribute('href')).toBe(false);
    expect(el.textContent).toContain('click');
  });

  it('keeps http(s) and mailto links and opens them safely', () => {
    const el = render('[site](https://example.com) <https://example.org> [mail](mailto:a@example.com)');
    const links = Array.from(el.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com', 'https://example.org', 'mailto:a@example.com']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('strips event handler attributes', () => {
    const html = sanitizeHtml('<a href="https://x.test" onclick="alert(1)" onmouseover="alert(2)">x</a><div onload="x()">y</div>');
    expect(html).not.toMatch(/onclick|onmouseover|onload/i);
  });

  it('removes remote images (no tracking pixels) and keeps alt text', () => {
    const el = render('![tracker](https://evil.example/pixel.gif) <img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('[image: tracker]');
    // The raw tag is escaped text, not an element.
    expect(Array.from(el.querySelectorAll('*')).some((n) => n.hasAttribute('onerror'))).toBe(false);
    const direct = sanitizeHtml('<img src="https://evil.example/p.gif" onerror="alert(1)" alt="p">');
    expect(direct).not.toMatch(/<img|onerror|evil/);
    expect(direct).toContain('[image: p]');
  });

  it('allows data: image URLs', () => {
    const el = render(`![dot](data:image/png;base64,${PNG})`);
    expect(el.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${PNG}`);
  });

  it('rejects data:image/svg+xml (scriptable)', () => {
    const el = render('![svg](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)');
    expect(el.querySelector('img')).toBeNull();
  });

  it('keeps HTML inside code blocks as text', () => {
    const el = render('```html\n<img src=x onerror=alert(1)><script>bad()</script>\n```\n\nand `<b>inline</b>`');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('pre code')?.textContent).toContain('<script>bad()</script>');
    expect(el.textContent).toContain('<b>inline</b>');
  });

  it('sanitizeHtml removes dangerous elements and attributes directly', () => {
    const html = sanitizeHtml(
      '<iframe src="https://x"></iframe><form action="https://x"><input></form><style>*{}</style><svg><script>1</script></svg><p style="color:red">ok</p>',
    );
    expect(html).not.toMatch(/iframe|form|input|style|svg|script/i);
    expect(html).toContain('<p>ok</p>');
  });

  it('enhanceCodeBlocks adds one copy button per block, idempotently', async () => {
    const el = render('```\nconst a = 1;\n```');
    let copied = '';
    const copy = async (t: string): Promise<void> => {
      copied = t;
    };
    enhanceCodeBlocks(el, copy);
    enhanceCodeBlocks(el, copy);
    const buttons = el.querySelectorAll('button.cc-copy');
    expect(buttons).toHaveLength(1);
    (buttons[0] as HTMLButtonElement).click();
    await Promise.resolve();
    expect(copied).toContain('const a = 1;');
  });
});
