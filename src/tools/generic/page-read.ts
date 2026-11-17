/**
 * Read-only page tools: `read_page`, `get_page_info`, `get_selection`.
 *
 * Every `run` here is injected with `chrome.scripting.executeScript` and must stay
 * self-contained: helpers are declared inside `run`, nothing from module scope is referenced.
 * See `src/tools/define.ts` and `src/tools/README.md`.
 */
import { definePageTool } from '../define';
import type { ToolResult } from '../../shared/types';

export interface ReadPageArgs {
  [key: string]: unknown;
  selector?: string;
  max_chars?: number;
  offset?: number;
  include_links?: boolean;
}

export const readPage = definePageTool<ReadPageArgs>({
  name: 'read_page',
  description:
    "Read the current page's main content as markdown-like text (headings, paragraphs, links, lists, " +
    'simplified tables, code). Skips navigation, scripts, hidden elements and form controls (use ' +
    'find_elements for controls). By default it reads the <main> region if the page has one; pass ' +
    'selector "body" for everything or any CSS selector to scope it. Long pages are paginated: call ' +
    'again with the offset given at the end of the result.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of the element to read (default: main content).' },
      max_chars: { type: 'integer', description: 'Maximum characters to return (default 12000, 500-50000).' },
      offset: { type: 'integer', description: 'Character offset to continue from (default 0).' },
      include_links: { type: 'boolean', description: 'Render links as [text](url) (default true).' },
    },
  },
  run: function (args: ReadPageArgs): ToolResult {
    try {
      const maxChars = Math.min(Math.max(Math.floor(Number(args.max_chars ?? 12000)) || 12000, 500), 50000);
      const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
      const withLinks = args.include_links !== false;

      const SKIP = new Set([
        'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'frame', 'object', 'embed',
        'video', 'audio', 'map', 'head', 'meta', 'link', 'input', 'select', 'textarea', 'button', 'nav',
        'dialog', 'option', 'datalist', 'math',
      ]);
      const INLINE = new Set([
        'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'label', 'mark',
        'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'img', 'br', 'wbr',
        'font', 'del', 'ins', 'slot', 'picture', 'output', 'big', 'tt', 'strike', 'nobr',
      ]);

      const isHidden = (el: Element): boolean => {
        if (SKIP.has(el.localName)) return true;
        if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
        const role = el.getAttribute('role');
        if (role === 'navigation' || role === 'dialog' || role === 'alertdialog') return true;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
        if (cs.display !== 'contents' && typeof el.checkVisibility === 'function' && !el.checkVisibility()) return true;
        return false;
      };

      // Children including open shadow roots and slotted content.
      const childrenOf = (node: Node): Node[] => {
        if (node instanceof Element) {
          if (node.shadowRoot) return Array.from(node.shadowRoot.childNodes);
          if (node.localName === 'slot') {
            const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true });
            if (assigned.length > 0) return assigned;
          }
        }
        return Array.from(node.childNodes);
      };

      const textOf = (node: Node): string => {
        let s = '';
        for (const child of childrenOf(node)) {
          if (child.nodeType === Node.TEXT_NODE) s += (child as Text).data;
          else if (child instanceof Element) {
            if (isHidden(child)) continue;
            if (child.localName === 'img') s += ' ' + (child.getAttribute('alt') ?? '').trim() + ' ';
            else if (child.localName === 'br') s += ' ';
            else s += INLINE.has(child.localName) ? textOf(child) : ' ' + textOf(child) + ' ';
          }
        }
        return s.replace(/\s+/g, ' ').trim();
      };

      const linkTarget = (a: Element): string => {
        const href = (a as HTMLAnchorElement).href || '';
        if (!href || /^(javascript|data):/i.test(href)) return '';
        if (href === location.href + '#' || href.startsWith(location.href.split('#')[0] + '#')) return '';
        return href;
      };

      const indent = (s: string, pad: string): string => s.split('\n').join('\n' + pad);

      const renderBlocks = (parent: Node): string[] => {
        const blocks: string[] = [];
        let buf = '';
        const flush = (): void => {
          const t = buf
            .replace(/[ \t\r\f\v]+/g, ' ')
            .replace(/ *\n */g, '\n')
            .trim();
          if (t) blocks.push(t);
          buf = '';
        };
        const visit = (node: Node): void => {
          for (const child of childrenOf(node)) {
            if (child.nodeType === Node.TEXT_NODE) {
              buf += (child as Text).data.replace(/\s+/g, ' ');
              continue;
            }
            if (!(child instanceof Element) || isHidden(child)) continue;
            const tag = child.localName;
            if (tag === 'br') buf += '\n';
            else if (tag === 'img') {
              const alt = (child.getAttribute('alt') ?? '').trim();
              if (alt) buf += ` [image: ${alt}] `;
            } else if (tag === 'a') {
              const text = textOf(child);
              const href = withLinks ? linkTarget(child) : '';
              if (text) buf += href ? `[${text}](${href})` : text;
            } else if (tag === 'code' || tag === 'kbd' || tag === 'samp') {
              const t = (child.textContent ?? '').trim();
              if (t) buf += '`' + t + '`';
            } else if (INLINE.has(tag)) visit(child);
            else {
              flush();
              blocks.push(...renderBlock(child));
            }
          }
        };
        visit(parent);
        flush();
        return blocks;
      };

      const renderTable = (table: HTMLTableElement): string[] => {
        const rows = Array.from(table.rows);
        const layout =
          table.querySelector('table') !== null ||
          ['presentation', 'none'].includes(table.getAttribute('role') ?? '') ||
          rows.every((r) => r.cells.length <= 1);
        if (layout) {
          const out: string[] = [];
          for (const row of rows) {
            const parts = Array.from(row.cells).flatMap((c) => (isHidden(c) ? [] : renderBlocks(c)));
            if (parts.length === 0) continue;
            if (parts.every((p) => !p.includes('\n'))) out.push(parts.join(' '));
            else out.push(...parts);
          }
          return out;
        }
        const lines: string[] = [];
        rows.forEach((row, i) => {
          if (isHidden(row)) return;
          const cells = Array.from(row.cells).map((c) => {
            const t = textOf(c).replace(/\|/g, '\\|');
            return t.length > 200 ? t.slice(0, 199) + '…' : t;
          });
          lines.push('| ' + cells.join(' | ') + ' |');
          if (i === 0) lines.push('|' + cells.map(() => ' --- ').join('|') + '|');
        });
        const caption = table.caption ? textOf(table.caption) : '';
        return lines.length ? [(caption ? caption + '\n' : '') + lines.join('\n')] : [];
      };

      const renderList = (list: Element): string[] => {
        const ordered = list.localName === 'ol';
        let n = ordered ? Number((list as HTMLOListElement).start || 1) : 1;
        const items: string[] = [];
        for (const child of childrenOf(list)) {
          if (!(child instanceof Element) || isHidden(child)) continue;
          if (child.localName !== 'li') {
            items.push(...renderBlocks(child));
            continue;
          }
          const body = renderBlocks(child).join('\n');
          const bullet = ordered ? `${n++}.` : '-';
          if (body) items.push(bullet + ' ' + indent(body, '  '));
        }
        return items.length ? [items.join('\n')] : [];
      };

      const renderBlock = (el: Element): string[] => {
        const tag = el.localName;
        const heading = /^h([1-6])$/.exec(tag);
        if (heading) {
          const t = textOf(el);
          return t ? ['#'.repeat(Number(heading[1])) + ' ' + t] : [];
        }
        if (tag === 'ul' || tag === 'ol' || tag === 'menu') return renderList(el);
        if (tag === 'li') {
          const body = renderBlocks(el).join('\n');
          return body ? ['- ' + indent(body, '  ')] : [];
        }
        if (tag === 'pre') {
          const t = (el.textContent ?? '').replace(/\n+$/, '');
          return t.trim() ? ['```\n' + t + '\n```'] : [];
        }
        if (tag === 'blockquote') {
          const body = renderBlocks(el).join('\n\n');
          return body ? [body.split('\n').map((l) => '> ' + l).join('\n')] : [];
        }
        if (tag === 'table') return renderTable(el as HTMLTableElement);
        if (tag === 'hr') return ['---'];
        if (tag === 'dt') {
          const t = textOf(el);
          return t ? ['**' + t + '**'] : [];
        }
        if (tag === 'dd') {
          const body = renderBlocks(el).join('\n');
          return body ? [': ' + indent(body, '  ')] : [];
        }
        return renderBlocks(el);
      };

      let root: Element | null;
      let scopeNote = '';
      if (args.selector) {
        try {
          root = document.querySelector(args.selector);
        } catch {
          return { ok: false, content: `Invalid CSS selector: ${args.selector}` };
        }
        if (!root) return { ok: false, content: `No element matches selector "${args.selector}".` };
      } else {
        const main = document.querySelector('main, [role="main"]');
        const mainLen = main ? (main.textContent ?? '').trim().length : 0;
        if (main && mainLen > 200 && !isHidden(main)) {
          root = main;
          scopeNote = 'Scope: main content region (use selector "body" for the whole page).\n';
        } else {
          root = document.body ?? document.documentElement;
        }
      }

      const blocks = root.localName === 'table' || /^(ul|ol|pre|blockquote|h[1-6])$/.test(root.localName) ? renderBlock(root) : renderBlocks(root);
      const body = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n');
      const total = body.length;
      const header = `Title: ${document.title}\nURL: ${location.href}\n${scopeNote}`;
      if (total === 0) return { ok: true, content: header + '\n(No readable text found. Try find_elements or screenshot.)' };
      if (offset >= total) return { ok: true, content: header + `\n(No more content: the text is ${total} characters long.)` };

      let end = Math.min(offset + maxChars, total);
      if (end < total) {
        const nl = body.lastIndexOf('\n', end);
        if (nl > offset + maxChars * 0.7) end = nl;
      }
      const footer =
        end < total
          ? `\n\n[Characters ${offset}-${end} of ${total}. To continue, call read_page with offset=${end}${args.selector ? ` and the same selector` : ''}.]`
          : offset > 0
            ? `\n\n[End of content (characters ${offset}-${end} of ${total}).]`
            : '';
      return {
        ok: true,
        content: header + '\n' + body.slice(offset, end) + footer,
        data: { total, offset, end },
      };
    } catch (err) {
      return { ok: false, content: 'read_page failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export const getPageInfo = definePageTool({
  name: 'get_page_info',
  description:
    'Get facts about the current page: URL, title, meta description, language, load state, scroll ' +
    'position, page and viewport size, and counts of links, forms, inputs, images, headings and frames.',
  parameters: { type: 'object', properties: {} },
  run: function (): ToolResult {
    try {
      const meta = (sel: string): string => (document.querySelector(sel)?.getAttribute('content') ?? '').trim();
      const count = (sel: string): number => document.querySelectorAll(sel).length;
      const doc = document.documentElement;
      const info = {
        url: location.href,
        title: document.title,
        description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
        language: doc.lang || '',
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
        readyState: document.readyState,
        scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
        page: { width: doc.scrollWidth, height: doc.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        counts: {
          links: count('a[href]'),
          forms: count('form'),
          inputs: count('input:not([type="hidden"]), textarea, select'),
          buttons: count('button, [role="button"], input[type="submit"], input[type="button"]'),
          images: count('img'),
          headings: count('h1, h2, h3, h4, h5, h6'),
          iframes: count('iframe'),
        },
        selectionLength: (window.getSelection()?.toString() ?? '').length,
      };
      const atBottom = info.scroll.y + info.viewport.height >= info.page.height - 2;
      const lines = [
        `URL: ${info.url}`,
        `Title: ${info.title}`,
        info.description && `Description: ${info.description}`,
        info.language && `Language: ${info.language}`,
        info.canonical && `Canonical: ${info.canonical}`,
        `Ready state: ${info.readyState}`,
        `Scroll: x=${info.scroll.x}, y=${info.scroll.y}${atBottom ? ' (at bottom)' : ''}; page ${info.page.width}x${info.page.height}; viewport ${info.viewport.width}x${info.viewport.height}`,
        `Counts: ${Object.entries(info.counts)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}`,
        info.selectionLength > 0 && `Selected text: ${info.selectionLength} characters (use get_selection)`,
      ].filter(Boolean);
      return { ok: true, content: lines.join('\n'), data: info };
    } catch (err) {
      return { ok: false, content: 'get_page_info failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export const getSelection = definePageTool({
  name: 'get_selection',
  description: 'Get the text the user has selected on the page (including inside a text field).',
  parameters: { type: 'object', properties: {} },
  run: function (): ToolResult {
    try {
      const active = document.activeElement;
      // Never return (part of) a password, even if the user selected it.
      if (active instanceof HTMLInputElement && active.type === 'password') {
        return { ok: true, content: 'The selection is in a password field; its text is not read.', data: { text: '' } };
      }
      let text = window.getSelection()?.toString() ?? '';
      if (!text && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
        const start = active.selectionStart ?? 0;
        const end = active.selectionEnd ?? 0;
        if (end > start) text = active.value.slice(start, end);
      }
      text = text.trim();
      if (!text) return { ok: true, content: 'No text is selected on the page.', data: { text: '' } };
      return { ok: true, content: text, data: { text } };
    } catch (err) {
      return { ok: false, content: 'get_selection failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});
