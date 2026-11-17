/**
 * Model markdown -> sanitised HTML. marked (GFM) renders, raw HTML in the markdown is escaped
 * (shown as text), then DOMPurify sanitises the result with a strict allow-list:
 *
 * - links: only `http:`, `https:` and `mailto:` hrefs; always `target=_blank rel="noopener noreferrer"`.
 * - images: only `data:image/(png|jpeg|gif|webp);base64` sources (no remote loads, no tracking pixels);
 *   anything else is replaced by its alt text.
 * - no `style`, no forms, no embeds, no SVG / MathML, no event handlers.
 */
import DOMPurify, { type DOMPurify as Purifier } from 'dompurify';
import { Marked } from 'marked';
import { h, type SanitizedHtml } from './dom';

const SAFE_LINK = /^(?:https?:|mailto:)/i;
const SAFE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    // Raw HTML in model output is shown literally, never interpreted.
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

let purifier: Purifier | null = null;

function getPurifier(): Purifier {
  if (purifier) return purifier;
  const p = DOMPurify(window);
  p.addHook('afterSanitizeAttributes', (node) => {
    const tag = node.tagName.toLowerCase();
    if (tag === 'a') {
      const href = node.getAttribute('href')?.trim() ?? '';
      if (!SAFE_LINK.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (tag === 'img') {
      const src = node.getAttribute('src')?.trim() ?? '';
      // Mark unsafe images; they are swapped for their alt text after sanitising (replacing
      // nodes while DOMPurify iterates is not safe).
      if (!SAFE_IMAGE.test(src)) node.removeAttribute('src');
    } else {
      node.removeAttribute('href');
      node.removeAttribute('src');
    }
  });
  purifier = p;
  return p;
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'picture', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'srcset', 'action', 'formaction', 'background', 'poster', 'xlink:href'],
  ADD_ATTR: ['target'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
};

/** Sanitise an HTML string (exported for tests and for `renderMarkdown`). */
export function sanitizeHtml(html: string): SanitizedHtml {
  const fragment = getPurifier().sanitize(html, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
  for (const img of Array.from(fragment.querySelectorAll('img'))) {
    if (img.hasAttribute('src')) continue;
    const alt = img.getAttribute('alt') ?? '';
    img.replaceWith(document.createTextNode(alt ? `[image: ${alt}]` : '[image]'));
  }
  const holder = document.createElement('div');
  holder.append(fragment);
  // Reading (not writing) innerHTML: serialising the sanitised fragment.
  return holder.innerHTML as SanitizedHtml;
}

/** Markdown from the model -> sanitised HTML, safe for `setSanitizedHtml`. */
export function renderMarkdown(markdown: string): SanitizedHtml {
  const html = marked.parse(markdown, { async: false });
  return sanitizeHtml(html);
}

/**
 * Add a copy button to every `<pre>` block inside `container` (after `setSanitizedHtml`).
 * The button copies the block's text content.
 */
export function enhanceCodeBlocks(container: Element, copy: (text: string) => Promise<void> = copyText): void {
  for (const pre of Array.from(container.querySelectorAll('pre'))) {
    if (pre.parentElement?.classList.contains('cc-code')) continue;
    const button = h('button', { type: 'button', class: 'cc-copy', 'aria-label': 'Copy code' }, 'Copy');
    button.addEventListener('click', () => {
      const text = pre.textContent ?? '';
      copy(text).then(
        () => flashLabel(button, 'Copied'),
        () => flashLabel(button, 'Failed'),
      );
    });
    const wrapper = h('div', { class: 'cc-code' });
    pre.replaceWith(wrapper);
    wrapper.append(button, pre);
  }
}

function flashLabel(button: HTMLButtonElement, label: string): void {
  button.textContent = label;
  setTimeout(() => (button.textContent = 'Copy'), 1200);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
