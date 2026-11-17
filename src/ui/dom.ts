/**
 * Tiny element builder. The convention for the whole UI:
 *
 * - Build DOM with `h()` (or `document.createElement` + `textContent`). Strings passed as children
 *   always become text nodes, so model / tool / MCP / settings strings can never become markup.
 * - The ONLY way to put HTML into the DOM is `setSanitizedHtml()` with a `SanitizedHtml` value,
 *   which only `markdown.ts` can produce (DOMPurify output). ESLint forbids `innerHTML` /
 *   `outerHTML` / `insertAdjacentHTML` everywhere else in `src/ui` and `src/content`.
 */

/** Branded string: HTML that went through DOMPurify. Only `markdown.ts` creates it. */
export type SanitizedHtml = string & { readonly __sanitized: unique symbol };

type Child = Node | string | number | null | undefined | false;

export type Attrs = {
  class?: string;
  /** `data-*` attributes. */
  data?: Record<string, string>;
  /** Event listeners (`on: { click: fn }`). */
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
  /** Anything else is set with `setAttribute` (booleans: present / absent). */
  [attr: string]: unknown;
};

const FORBIDDEN_ATTRS = new Set(['innerhtml', 'outerhtml', 'srcdoc']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = typeof value === 'string' ? value : '';
      else if (key === 'data') {
        for (const [k, v] of Object.entries(value as Record<string, string>)) el.dataset[k] = v;
      } else if (key === 'on') {
        for (const [type, fn] of Object.entries(value as Record<string, EventListener>)) el.addEventListener(type, fn);
      } else {
        const lower = key.toLowerCase();
        if (FORBIDDEN_ATTRS.has(lower) || lower.startsWith('on')) {
          throw new Error(`h(): attribute "${key}" is not allowed`);
        }
        el.setAttribute(key, value === true ? '' : `${value as string | number}`);
      }
    }
  }
  append(el, ...children);
  return el;
}

/** Append children; strings become text nodes. */
export function append(parent: Node, ...children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Replace all children. */
export function replaceChildren(parent: Element, ...children: (Child | Child[])[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

/** The single sanctioned `innerHTML` write: DOMPurify output of model markdown. */
export function setSanitizedHtml(el: Element, html: SanitizedHtml): void {
  // eslint-disable-next-line no-restricted-syntax -- SanitizedHtml only comes from markdown.ts (DOMPurify)
  el.innerHTML = html;
}

export function byId<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
