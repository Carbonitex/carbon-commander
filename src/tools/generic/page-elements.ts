/**
 * `find_elements`: a snapshot of the visible interactive elements, each with a short ref (`e12`)
 * that the action tools (`click`, `type_text`, ...) accept.
 *
 * Ref registry: `window[Symbol.for('carbon-commander.element-refs')]` in the extension's
 * ISOLATED world, `{ next, byRef: Map<ref, WeakRef<Element>>, byEl: WeakMap<Element, ref> }`.
 * The isolated world's global lives as long as the document, so refs survive across separate
 * `executeScript` calls, are invisible to page scripts (no DOM attribute to read, copy or clobber,
 * no DOM mutation for frameworks or MutationObservers to see), and die with the document on
 * navigation. An element that was re-rendered is detected as stale (`!isConnected`) instead of
 * silently matching a copy, which a `data-` attribute cloned by a framework could do. The same
 * element keeps its ref across snapshots. Ref tools must therefore use the ISOLATED world
 * (`context: 'page'`); MAIN-world tools cannot see the registry.
 *
 * Self-contained `run` (see `src/tools/define.ts`).
 */
import { definePageTool } from '../define';
import type { ToolResult } from '../../shared/types';

export type FindElementsArgs = {
  query?: string;
  selector?: string;
  limit?: number;
  include_offscreen?: boolean;
};

export const findElements = definePageTool<FindElementsArgs>({
  name: 'find_elements',
  description:
    'List the visible interactive elements on the page (links, buttons, inputs, selects, text areas, ' +
    'ARIA widgets, contenteditable editors, clickable elements), each with a ref like "e12", its role, ' +
    'accessible name, value/state, and "offscreen" when outside the viewport. Pass the ref to click, ' +
    'type_text, select_option, press_key, scroll or hover. Refs stay valid until the page navigates or ' +
    're-renders that element; call find_elements again if a ref is reported stale. Use query to filter.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Only elements whose name, role, value or link contains all these words (case-insensitive).' },
      selector: { type: 'string', description: 'Only search inside the element matching this CSS selector.' },
      limit: { type: 'integer', description: 'Maximum elements to list (default 80, max 300). In-viewport elements are listed first.' },
      include_offscreen: { type: 'boolean', description: 'Include elements outside the viewport (default true).' },
    },
  },
  run: function (args: FindElementsArgs): ToolResult {
    try {
      type Registry = { next: number; byRef: Map<string, WeakRef<Element>>; byEl: WeakMap<Element, string> };
      const KEY = Symbol.for('carbon-commander.element-refs');
      const holder = window as unknown as Record<symbol, Registry | undefined>;
      const reg: Registry = (holder[KEY] ??= { next: 1, byRef: new Map(), byEl: new WeakMap() });
      if (reg.byRef.size > 5000) {
        for (const [r, w] of reg.byRef) if (!w.deref()?.isConnected) reg.byRef.delete(r);
      }
      const refFor = (el: Element): string => {
        const known = reg.byEl.get(el);
        if (known && reg.byRef.get(known)?.deref() === el) return known;
        const ref = 'e' + String(reg.next++);
        reg.byEl.set(el, ref);
        reg.byRef.set(ref, new WeakRef(el));
        return ref;
      };

      const limit = Math.min(Math.max(Math.floor(Number(args.limit ?? 80)) || 80, 1), 300);
      const includeOffscreen = args.include_offscreen !== false;
      const clip = (s: string, n: number): string => {
        const t = s.replace(/\s+/g, ' ').trim();
        return t.length > n ? t.slice(0, n - 1) + '…' : t;
      };

      let scope: Element | Document = document;
      if (args.selector) {
        let found: Element | null;
        try {
          found = document.querySelector(args.selector);
        } catch {
          return { ok: false, content: `Invalid CSS selector: ${args.selector}` };
        }
        if (!found) return { ok: false, content: `No element matches selector "${args.selector}".` };
        scope = found;
      }

      const all: Element[] = [];
      const collect = (root: Element | Document | ShadowRoot): void => {
        if (root instanceof Element) {
          all.push(root);
          if (root.shadowRoot) collect(root.shadowRoot);
        }
        for (const el of Array.from(root.querySelectorAll('*'))) {
          all.push(el);
          if (el.shadowRoot) collect(el.shadowRoot);
        }
      };
      collect(scope);

      const ROLES = new Set([
        'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem', 'listbox',
      ]);
      const isEditableRoot = (el: Element): boolean => {
        const ce = el.getAttribute('contenteditable');
        if (ce === null || ce === 'false') return false;
        const parentCe = el.parentElement?.closest('[contenteditable]');
        return !parentCe || parentCe.getAttribute('contenteditable') === 'false';
      };
      const roleOf = (el: Element): string | null => {
        const explicit = (el.getAttribute('role') ?? '').split(/\s+/)[0] ?? '';
        if (ROLES.has(explicit)) return explicit;
        const tag = el.localName;
        if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
        if (tag === 'button') return 'button';
        if (tag === 'input') {
          const type = (el as HTMLInputElement).type;
          if (type === 'hidden') return null;
          if (type === 'checkbox' || type === 'radio') return type;
          if (type === 'range') return 'slider';
          if (type === 'number') return 'spinbutton';
          if (type === 'search') return 'searchbox';
          if (type === 'file') return 'file-input';
          if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
          return 'textbox';
        }
        if (tag === 'select') return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'summary') return 'button';
        if (isEditableRoot(el)) return 'textbox';
        if (el.hasAttribute('onclick')) return 'clickable';
        const ti = el.getAttribute('tabindex');
        if (ti !== null && Number(ti) >= 0 && tag !== 'body' && tag !== 'html') return 'focusable';
        return null;
      };

      const nameOf = (el: Element): string => {
        const byIds = el.getAttribute('aria-labelledby');
        if (byIds) {
          const t = byIds
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .trim();
          if (t) return t;
        }
        const aria = el.getAttribute('aria-label')?.trim();
        if (aria) return aria;
        const tag = el.localName;
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
          const control = el as HTMLInputElement;
          if (['submit', 'button', 'reset'].includes(control.type) && control.value) return control.value;
          if (control.type === 'image') return control.alt || control.value || 'image button';
          const labels = control.labels ? Array.from(control.labels).map((l) => l.textContent ?? '').join(' ').trim() : '';
          if (labels) return labels;
          return control.placeholder || control.title || el.getAttribute('aria-placeholder') || control.name || '';
        }
        if (isEditableRoot(el)) return el.getAttribute('aria-placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('title') || '';
        const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
        if (text.trim()) return text;
        const img = el.querySelector('img[alt]');
        if (img?.getAttribute('alt')) return img.getAttribute('alt') ?? '';
        return el.getAttribute('title') ?? el.querySelector('[title]')?.getAttribute('title') ?? '';
      };

      const stateOf = (el: Element, role: string): string[] => {
        const parts: string[] = [];
        const tag = el.localName;
        if (tag === 'input' || tag === 'textarea') {
          const c = el as HTMLInputElement;
          if (role === 'checkbox' || role === 'radio') parts.push(c.checked ? 'checked' : 'unchecked');
          else if (role !== 'button' && role !== 'file-input') {
            if (c.value) parts.push(`value="${c.type === 'password' ? '•'.repeat(Math.min(c.value.length, 8)) : clip(c.value, 80)}"`);
            if (c.placeholder && !c.value && nameOf(el) !== c.placeholder) parts.push(`placeholder="${clip(c.placeholder, 60)}"`);
          }
          if (c.type && !['text', 'textarea', 'checkbox', 'radio', 'submit', 'button'].includes(c.type)) parts.push(`type=${c.type}`);
          if (c.required) parts.push('required');
          if (c.readOnly) parts.push('readonly');
        } else if (tag === 'select') {
          const s = el as HTMLSelectElement;
          const chosen = Array.from(s.selectedOptions).map((o) => clip(o.text, 40));
          parts.push(`selected="${chosen.join(', ')}"`, `${s.options.length} options`);
        } else if (role === 'textbox' && isEditableRoot(el)) {
          const t = clip(el.textContent ?? '', 80);
          if (t) parts.push(`text="${t}"`);
        } else if (tag === 'a') {
          const href = (el as HTMLAnchorElement).href;
          if (href && !href.startsWith('javascript:')) {
            let shown = href;
            try {
              const u = new URL(href);
              if (u.origin === location.origin) shown = u.pathname + u.search + u.hash;
            } catch {
              // keep full href
            }
            parts.push('→ ' + clip(shown, 100));
          }
        }
        for (const attr of ['aria-checked', 'aria-pressed', 'aria-selected', 'aria-expanded']) {
          const v = el.getAttribute(attr);
          if (v === 'true' || v === 'false' || v === 'mixed') parts.push(`${attr.slice(5)}=${v}`);
        }
        if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
        return parts;
      };

      const isVisible = (el: Element): boolean => {
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) {
          return false;
        }
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      };

      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const queryWords = (args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);

      type Row = { el: Element; ref: string; role: string; name: string; state: string[]; inView: boolean; index: number };
      const rows: Row[] = [];
      const seen = new Set<Element>();
      // Real controls only: a landmark role (`<main role="main">`) or an app root with
      // `tabindex="-1"` must not hide the clickable elements inside it.
      const interactiveSelector =
        'a[href], button, input, select, textarea, summary, [onclick], [tabindex]:not([tabindex="-1"]), ' +
        '[contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], ' +
        '[role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"]';
      let index = 0;
      for (const el of all) {
        index++;
        let role = roleOf(el);
        if (!role) {
          // Heuristic for div/span "buttons": the outermost element with cursor:pointer that has a name.
          if (!(el instanceof HTMLElement) || el.localName === 'body' || el.localName === 'html') continue;
          if (el.parentElement?.closest(interactiveSelector)) continue;
          const cs = getComputedStyle(el);
          if (cs.cursor !== 'pointer') continue;
          if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
          role = 'clickable';
        }
        if (role === 'focusable' || role === 'clickable') {
          // Skip wrappers around a real control we already list.
          if (el.querySelector('a[href], button, input, select, textarea')) continue;
        }
        if (!isVisible(el)) continue;
        const name = clip(nameOf(el), 100);
        if ((role === 'clickable' || role === 'focusable') && !name) continue;
        const state = stateOf(el, role);
        if (queryWords.length > 0) {
          const hay = [role, name, ...state].join(' ').toLowerCase();
          if (!queryWords.every((w) => hay.includes(w))) continue;
        }
        const r = el.getBoundingClientRect();
        const inView = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        if (!inView && !includeOffscreen) continue;
        if (seen.has(el)) continue;
        seen.add(el);
        rows.push({ el, ref: '', role, name, state, inView, index });
      }

      const inView = rows.filter((r) => r.inView);
      const chosen = [...inView, ...rows.filter((r) => !r.inView)].slice(0, limit).sort((a, b) => a.index - b.index);
      for (const row of chosen) row.ref = refFor(row.el);

      const lines = chosen.map(
        (r) =>
          `${r.ref} ${r.role}${r.name ? ` "${r.name.replace(/"/g, "'")}"` : ''}${r.state.length ? ' ' + r.state.join(' ') : ''}${r.inView ? '' : ' (offscreen)'}`,
      );
      const head =
        rows.length === 0
          ? queryWords.length
            ? `No visible interactive elements match "${args.query ?? ''}".`
            : 'No visible interactive elements found.'
          : `${rows.length} interactive element${rows.length === 1 ? '' : 's'}${queryWords.length ? ` matching "${args.query ?? ''}"` : ''} (${inView.length} in viewport)` +
            (chosen.length < rows.length ? `; showing ${chosen.length} (in-viewport first). Use query or selector to narrow, or scroll.` : '.');
      return {
        ok: true,
        content: [head, ...lines].join('\n'),
        data: {
          total: rows.length,
          elements: chosen.map((r) => ({ ref: r.ref, role: r.role, name: r.name, state: r.state, inViewport: r.inView })),
        },
      };
    } catch (err) {
      return { ok: false, content: 'find_elements failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});
