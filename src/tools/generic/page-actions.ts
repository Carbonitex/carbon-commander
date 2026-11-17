/**
 * Page action tools: `click`, `type_text`, `select_option`, `press_key`, `scroll`, `hover`, and the
 * in-page half of `wait` (`waitInPage`).
 *
 * Each `run` is injected with `chrome.scripting.executeScript` (ISOLATED world, where the ref
 * registry from `find_elements` lives) and must be self-contained, so the small `resolveRef`
 * helper is repeated inside every function on purpose. See `page-elements.ts` for the registry.
 *
 * Events are synthetic (`isTrusted === false`). That is enough for nearly all sites, including
 * React/Vue controlled inputs (we use the prototype's native value setter, then dispatch
 * `input` + `change`), but a few sites ignore untrusted key events.
 */
import { definePageTool } from '../define';
import type { ToolResult } from '../../shared/types';

export type ClickArgs = { ref?: string; text?: string; selector?: string };

export const click = definePageTool<ClickArgs>({
  name: 'click',
  description:
    'Click an element. Prefer a ref from find_elements; otherwise give the visible text of a button/link ' +
    '(exact match preferred) or a CSS selector. Scrolls the element into view first and reports if ' +
    'something seems to cover it.',
  mutates: true,
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'Element ref from find_elements, e.g. "e12".' },
      text: { type: 'string', description: 'Visible text or accessible name of the element to click (used if no ref).' },
      selector: { type: 'string', description: 'CSS selector of the element to click (used if no ref or text).' },
    },
  },
  run: function (args: ClickArgs): ToolResult {
    try {
      const resolveRef = (ref: string): Element | string => {
        const reg = (window as unknown as Record<symbol, { byRef: Map<string, WeakRef<Element>> } | undefined>)[
          Symbol.for('carbon-commander.element-refs')
        ];
        const weak = reg?.byRef.get(ref.trim());
        if (!weak) return `Unknown ref "${ref}". Refs reset when the page navigates or reloads; call find_elements again.`;
        const el = weak.deref();
        if (!el || !el.isConnected) return `Element ${ref} is no longer on the page (the page changed). Call find_elements again.`;
        return el;
      };
      const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const describe = (el: Element): string => {
        const name = (el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const role = el.getAttribute('role') ?? el.localName;
        return `${role}${name ? ` "${name.length > 60 ? name.slice(0, 59) + '…' : name}"` : ''}`;
      };
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return (r.width > 0 || r.height > 0) && cs.visibility !== 'hidden' && cs.display !== 'none';
      };

      let el: Element | null = null;
      let note = '';
      if (args.ref) {
        const found = resolveRef(args.ref);
        if (typeof found === 'string') return { ok: false, content: found };
        el = found;
      } else if (args.text) {
        const want = norm(args.text);
        const candidates = Array.from(
          document.querySelectorAll(
            'a, button, summary, label, input[type="submit"], input[type="button"], input[type="reset"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [onclick], [tabindex]',
          ),
        ).filter(visible);
        const nameOf = (c: Element): string =>
          norm(c.getAttribute('aria-label') ?? ((c as HTMLInputElement).value && c.localName === 'input' ? (c as HTMLInputElement).value : (c as HTMLElement).innerText ?? c.textContent ?? ''));
        let matches = candidates.filter((c) => nameOf(c) === want);
        if (matches.length === 0) matches = candidates.filter((c) => nameOf(c).includes(want));
        if (matches.length === 0) {
          // Any visible element whose own text matches exactly; prefer the innermost.
          matches = Array.from(document.body.querySelectorAll('*')).filter(
            (c) => norm(c.textContent ?? '') === want && visible(c) && !Array.from(c.children).some((k) => norm(k.textContent ?? '') === want),
          );
        }
        if (matches.length === 0) return { ok: false, content: `No visible element with text "${args.text}". Use find_elements to list clickable elements.` };
        el = matches[0] ?? null;
        if (matches.length > 1) note = ` (${matches.length} elements matched "${args.text}"; clicked the first. Use find_elements refs to be precise.)`;
      } else if (args.selector) {
        try {
          el = document.querySelector(args.selector);
        } catch {
          return { ok: false, content: `Invalid CSS selector: ${args.selector}` };
        }
        if (!el) return { ok: false, content: `No element matches selector "${args.selector}".` };
      } else {
        return { ok: false, content: 'Give a ref (preferred), text or selector.' };
      }
      if (!el) return { ok: false, content: 'Element not found.' };
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
        return { ok: false, content: `${describe(el)} is disabled.` };
      }

      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      let covered = '';
      if (typeof document.elementsFromPoint === 'function' && rect.width > 0 && rect.height > 0 && !(el.getRootNode() instanceof ShadowRoot)) {
        // Carbon Commander's own overlay (open while the agent works) is not the page: skip it.
        const hits = document.elementsFromPoint(x, y).filter((e) => e.localName !== 'carbon-commander-overlay');
        const related = (e: Element): boolean => e === el || el.contains(e) || e.contains(el);
        const top = hits[0];
        // Warn only when the target is under something else; when it is not hit-testable at all
        // (inert, pointer-events: none) there is nothing reliable to say.
        if (top && !related(top) && hits.some(related)) {
          covered = ` Warning: another element (${describe(top)}) is on top of it; the click may not have reached the intended element.`;
        }
      }
      const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
      const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Pointer('pointerover', init));
      el.dispatchEvent(new MouseEvent('mouseover', init));
      el.dispatchEvent(new Pointer('pointerdown', { ...init, buttons: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
      if (el instanceof HTMLElement && typeof el.focus === 'function') el.focus({ preventScroll: true });
      el.dispatchEvent(new Pointer('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      if (el instanceof HTMLElement) el.click();
      else el.dispatchEvent(new MouseEvent('click', init));
      return { ok: true, content: `Clicked ${describe(el)}.${note}${covered}` };
    } catch (err) {
      return { ok: false, content: 'click failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export type TypeTextArgs = { ref: string; text: string; clear?: boolean; submit?: boolean };

export const typeText = definePageTool<TypeTextArgs>({
  name: 'type_text',
  description:
    'Type text into an input, text area or rich-text editor (contenteditable) given by ref. Replaces the ' +
    'current content unless clear is false. Works with React/Vue controlled inputs. Set submit to press ' +
    'Enter afterwards (submits the form for inputs).',
  mutates: true,
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'Ref of the field from find_elements.' },
      text: { type: 'string', description: 'Text to type.' },
      clear: { type: 'boolean', description: 'Replace existing content (default true); false appends.' },
      submit: { type: 'boolean', description: 'Press Enter after typing (default false).' },
    },
    required: ['ref', 'text'],
  },
  run: function (args: TypeTextArgs): ToolResult {
    try {
      const resolveRef = (ref: string): Element | string => {
        const reg = (window as unknown as Record<symbol, { byRef: Map<string, WeakRef<Element>> } | undefined>)[
          Symbol.for('carbon-commander.element-refs')
        ];
        const weak = reg?.byRef.get(ref.trim());
        if (!weak) return `Unknown ref "${ref}". Refs reset when the page navigates or reloads; call find_elements again.`;
        const el = weak.deref();
        if (!el || !el.isConnected) return `Element ${ref} is no longer on the page (the page changed). Call find_elements again.`;
        return el;
      };
      const found = resolveRef(args.ref);
      if (typeof found === 'string') return { ok: false, content: found };
      let el: Element = found;
      const text = String(args.text);
      const clear = args.clear !== false;

      // Retarget labels / wrappers to the actual field.
      if (el instanceof HTMLLabelElement && el.control) el = el.control;
      const isField = (e: Element): boolean => e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement;
      const isEditable = (e: Element): boolean => {
        const ce = e.getAttribute('contenteditable');
        return (e as HTMLElement).isContentEditable === true || (ce !== null && ce !== 'false');
      };
      if (!isField(el) && !isEditable(el)) {
        const inner = el.querySelector('input:not([type="hidden"]), textarea, [contenteditable]:not([contenteditable="false"])');
        if (inner) el = inner;
      }

      const enter = (target: Element): boolean => {
        const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
        const notPrevented = target.dispatchEvent(new KeyboardEvent('keydown', init));
        target.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
        return notPrevented;
      };

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.disabled) return { ok: false, content: 'The field is disabled.' };
        if (el.readOnly) return { ok: false, content: 'The field is read-only.' };
        if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image', 'range', 'color', 'hidden'].includes(el.type)) {
          return { ok: false, content: `Cannot type into an input of type "${el.type}". Use click (checkbox/radio/button) instead.` };
        }
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- called with .call(el)
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const next = clear ? text : el.value + text;
        // The prototype setter bypasses value trackers that frameworks (React) install on the
        // instance, so the following input event is seen as a real change.
        if (setter) setter.call(el, next);
        else el.value = next;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        let submitted = '';
        if (args.submit) {
          const go = enter(el);
          if (go && el instanceof HTMLInputElement && el.form) {
            if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
            else el.form.submit();
            submitted = ' and submitted the form';
          } else submitted = ' and pressed Enter';
        }
        const shown = el instanceof HTMLInputElement && el.type === 'password' ? '(hidden)' : JSON.stringify(el.value.length > 200 ? el.value.slice(0, 199) + '…' : el.value);
        const mismatch = el.value !== next ? ' Note: the page changed the value after typing (it may format or restrict input).' : '';
        return { ok: true, content: `Typed ${text.length} characters${submitted}. Field value is now ${shown}.${mismatch}` };
      }

      if (isEditable(el)) {
        const target = el as HTMLElement;
        target.focus();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(target);
          if (!clear) range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        let inserted = false;
        try {
          // execCommand goes through the editor's own beforeinput/input handling (ProseMirror,
          // Lexical, Draft, ...); deprecated but still the most compatible way.
          inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
        } catch {
          inserted = false;
        }
        if (!inserted) {
          if (clear) target.textContent = text;
          else target.append(document.createTextNode(text));
          target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
        }
        if (args.submit) enter(target);
        const now = (target.textContent ?? '').trim();
        return {
          ok: true,
          content: `Typed ${text.length} characters into the editor${args.submit ? ' and pressed Enter' : ''}. Its text is now ${JSON.stringify(now.length > 200 ? now.slice(0, 199) + '…' : now)}.`,
        };
      }
      return { ok: false, content: `Element ${args.ref} (${el.localName}) is not a text field or editor. Use find_elements to find the field.` };
    } catch (err) {
      return { ok: false, content: 'type_text failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export type SelectOptionArgs = { ref: string; option: string };

export const selectOption = definePageTool<SelectOptionArgs>({
  name: 'select_option',
  description:
    'Choose an option in a native <select> dropdown by its visible label or value. For custom ' +
    '(non-<select>) dropdowns, click the dropdown, then click the option instead.',
  mutates: true,
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'Ref of the <select> from find_elements.' },
      option: { type: 'string', description: 'Option label or value (exact match preferred, case-insensitive).' },
    },
    required: ['ref', 'option'],
  },
  run: function (args: SelectOptionArgs): ToolResult {
    try {
      const resolveRef = (ref: string): Element | string => {
        const reg = (window as unknown as Record<symbol, { byRef: Map<string, WeakRef<Element>> } | undefined>)[
          Symbol.for('carbon-commander.element-refs')
        ];
        const weak = reg?.byRef.get(ref.trim());
        if (!weak) return `Unknown ref "${ref}". Refs reset when the page navigates or reloads; call find_elements again.`;
        const el = weak.deref();
        if (!el || !el.isConnected) return `Element ${ref} is no longer on the page (the page changed). Call find_elements again.`;
        return el;
      };
      const found = resolveRef(args.ref);
      if (typeof found === 'string') return { ok: false, content: found };
      const el = found instanceof HTMLLabelElement && found.control ? found.control : found;
      if (!(el instanceof HTMLSelectElement)) {
        return { ok: false, content: `Element ${args.ref} is not a <select>. For custom dropdowns, click it to open, then click the option.` };
      }
      if (el.disabled) return { ok: false, content: 'The dropdown is disabled.' };
      const want = String(args.option).replace(/\s+/g, ' ').trim().toLowerCase();
      const options = Array.from(el.options);
      const label = (o: HTMLOptionElement): string => o.text.replace(/\s+/g, ' ').trim().toLowerCase();
      const match =
        options.find((o) => label(o) === want) ??
        options.find((o) => o.value.toLowerCase() === want) ??
        options.find((o) => label(o).includes(want));
      if (!match) {
        const list = options.slice(0, 40).map((o) => `"${o.text.trim()}"`).join(', ');
        return { ok: false, content: `No option matches "${args.option}". Options: ${list}${options.length > 40 ? ', …' : ''}` };
      }
      if (match.disabled) return { ok: false, content: `Option "${match.text.trim()}" is disabled.` };
      el.focus();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- called with .call(el)
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(el, match.value);
      match.selected = true;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, content: `Selected "${match.text.trim()}".` };
    } catch (err) {
      return { ok: false, content: 'select_option failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export type PressKeyArgs = { key: string; ref?: string; modifiers?: string[] };

export const pressKey = definePageTool<PressKeyArgs>({
  name: 'press_key',
  description:
    'Press a key on the focused element (or the element given by ref): Enter, Escape, Tab, Space, ' +
    'Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/PageDown, Home, End, or a single character, ' +
    'optionally with modifiers. Enter submits forms, Enter/Space activate buttons and links, Tab moves ' +
    'focus. Does not insert text: use type_text for that.',
  mutates: true,
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key name, e.g. "Enter", "Escape", "ArrowDown", "a".' },
      ref: { type: 'string', description: 'Ref of the element to send the key to (default: the focused element).' },
      modifiers: {
        type: 'array',
        items: { type: 'string', enum: ['ctrl', 'shift', 'alt', 'meta'] },
        description: 'Modifier keys held during the press.',
      },
    },
    required: ['key'],
  },
  run: function (args: PressKeyArgs): ToolResult {
    try {
      const resolveRef = (ref: string): Element | string => {
        const reg = (window as unknown as Record<symbol, { byRef: Map<string, WeakRef<Element>> } | undefined>)[
          Symbol.for('carbon-commander.element-refs')
        ];
        const weak = reg?.byRef.get(ref.trim());
        if (!weak) return `Unknown ref "${ref}". Refs reset when the page navigates or reloads; call find_elements again.`;
        const el = weak.deref();
        if (!el || !el.isConnected) return `Element ${ref} is no longer on the page (the page changed). Call find_elements again.`;
        return el;
      };
      const ALIASES: Record<string, string> = {
        enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: ' ', spacebar: ' ',
        backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft',
        right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
        pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End',
      };
      const CODES: Record<string, number> = {
        Enter: 13, Escape: 27, Tab: 9, ' ': 32, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38,
        ArrowRight: 39, ArrowDown: 40, PageUp: 33, PageDown: 34, Home: 36, End: 35,
      };
      const raw = String(args.key);
      const key = raw.length === 1 ? raw : (ALIASES[raw.toLowerCase()] ?? raw);
      if (key.length !== 1 && !(key in CODES) && !/^F([1-9]|1[0-2])$/.test(key)) {
        return { ok: false, content: `Unsupported key "${raw}". Use Enter, Escape, Tab, Space, Backspace, Delete, arrows, PageUp/PageDown, Home, End, F1-F12 or one character.` };
      }
      let code = key;
      if (key === ' ') code = 'Space';
      else if (/^[a-z]$/i.test(key)) code = 'Key' + key.toUpperCase();
      else if (/^[0-9]$/.test(key)) code = 'Digit' + key;
      const keyCode = CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      const mods = new Set((args.modifiers ?? []).map((m) => String(m).toLowerCase()));

      let target: Element | null = null;
      if (args.ref) {
        const found = resolveRef(args.ref);
        if (typeof found === 'string') return { ok: false, content: found };
        target = found;
        if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      } else {
        target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
      }
      if (!target) return { ok: false, content: 'No element to send the key to.' };

      const init = {
        key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true,
        ctrlKey: mods.has('ctrl') || mods.has('control'), shiftKey: mods.has('shift'), altKey: mods.has('alt'), metaKey: mods.has('meta') || mods.has('cmd'),
      };
      const notPrevented = target.dispatchEvent(new KeyboardEvent('keydown', init));
      if (key.length === 1 || key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: keyCode }));
      target.dispatchEvent(new KeyboardEvent('keyup', init));

      // Emulate the default actions the browser would take for a trusted key press.
      let effect = '';
      const plain = !init.ctrlKey && !init.altKey && !init.metaKey;
      if (notPrevented && plain) {
        if (key === 'Tab') {
          const focusable = Array.from(
            document.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable]:not([contenteditable="false"])'),
          ).filter((e) => !(e as HTMLButtonElement).disabled && e.tabIndex >= 0 && e.getClientRects().length > 0);
          const i = focusable.indexOf(target as HTMLElement);
          const next = focusable[(i + (init.shiftKey ? -1 : 1) + focusable.length) % focusable.length];
          if (next) {
            next.focus();
            const label = (next.getAttribute('aria-label') ?? next.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
            effect = ` Focus moved to ${next.localName}${label ? ` "${label}"` : ''}.`;
          }
        } else if (key === 'Enter' && target instanceof HTMLInputElement && target.form) {
          if (typeof target.form.requestSubmit === 'function') target.form.requestSubmit();
          else target.form.submit();
          effect = ' Submitted the form.';
        } else if ((key === 'Enter' && (target instanceof HTMLAnchorElement || target instanceof HTMLButtonElement || target.localName === 'summary')) ||
          (key === ' ' && (target instanceof HTMLButtonElement || (target instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit'].includes(target.type))))) {
          (target as HTMLElement).click();
          effect = ' Activated the element.';
        }
      }
      const shown = key === ' ' ? 'Space' : key;
      const combo = [...['ctrl', 'alt', 'shift', 'meta'].filter((m) => (m === 'ctrl' ? init.ctrlKey : m === 'alt' ? init.altKey : m === 'shift' ? init.shiftKey : init.metaKey)), shown].join('+');
      return { ok: true, content: `Pressed ${combo} on ${target.localName}.${effect}${notPrevented ? '' : ' (The page handled the key itself.)'}` };
    } catch (err) {
      return { ok: false, content: 'press_key failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export type ScrollArgs = { direction?: string; ref?: string; amount?: number };

export const scroll = definePageTool<ScrollArgs>({
  name: 'scroll',
  description:
    'Scroll the page or a scrollable element. direction: down/up (by amount viewports, default 0.8), ' +
    'top/bottom, or into_view (requires ref). With a ref and down/up/top/bottom, scrolls the nearest ' +
    'scrollable container of that element. Returns the new position.',
  parameters: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom', 'left', 'right', 'into_view'], description: 'Default "down", or "into_view" when only ref is given.' },
      ref: { type: 'string', description: 'Element ref from find_elements.' },
      amount: { type: 'number', description: 'How far for down/up/left/right, in viewport fractions (default 0.8, max 10).' },
    },
  },
  run: function (args: ScrollArgs): ToolResult {
    try {
      const resolveRef = (ref: string): Element | string => {
        const reg = (window as unknown as Record<symbol, { byRef: Map<string, WeakRef<Element>> } | undefined>)[
          Symbol.for('carbon-commander.element-refs')
        ];
        const weak = reg?.byRef.get(ref.trim());
        if (!weak) return `Unknown ref "${ref}". Refs reset when the page navigates or reloads; call find_elements again.`;
        const el = weak.deref();
        if (!el || !el.isConnected) return `Element ${ref} is no longer on the page (the page changed). Call find_elements again.`;
        return el;
      };
      let el: Element | null = null;
      if (args.ref) {
        const found = resolveRef(args.ref);
        if (typeof found === 'string') return { ok: false, content: found };
        el = found;
      }
      const direction = args.direction ?? (el ? 'into_view' : 'down');
      const amount = Math.min(Math.max(Number(args.amount ?? 0.8) || 0.8, 0.05), 10);
      const instant = 'instant' as ScrollBehavior;

      if (direction === 'into_view') {
        if (!el) return { ok: false, content: 'into_view needs a ref.' };
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: instant });
        const r = el.getBoundingClientRect();
        return { ok: true, content: `Scrolled ${el.localName} into view (now at y=${Math.round(r.top)} in a ${window.innerHeight}px viewport).` };
      }

      // Pick the container: the element's nearest scrollable ancestor (or itself), else the page.
      const scrollable = (e: Element): boolean => {
        const cs = getComputedStyle(e);
        const y = /(auto|scroll|overlay)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
        const x = /(auto|scroll|overlay)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
        return y || x;
      };
      let box: Element | null = null;
      for (let e: Element | null = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        if (scrollable(e)) {
          box = e;
          break;
        }
      }
      const page = document.scrollingElement ?? document.documentElement;
      const target = box ?? page;
      const viewH = box ? box.clientHeight : window.innerHeight;
      const viewW = box ? box.clientWidth : window.innerWidth;
      const before = { x: target.scrollLeft, y: target.scrollTop };
      const opts: ScrollToOptions = { behavior: instant };
      if (direction === 'down') opts.top = before.y + viewH * amount;
      else if (direction === 'up') opts.top = before.y - viewH * amount;
      else if (direction === 'top') opts.top = 0;
      else if (direction === 'bottom') opts.top = target.scrollHeight;
      else if (direction === 'right') opts.left = before.x + viewW * amount;
      else if (direction === 'left') opts.left = before.x - viewW * amount;
      else return { ok: false, content: `Unknown direction "${direction}".` };
      if (box) box.scrollTo(opts);
      else window.scrollTo(opts);
      const after = { x: Math.round(target.scrollLeft), y: Math.round(target.scrollTop) };
      const maxY = target.scrollHeight - viewH;
      const where = after.y <= 0 ? ' (at top)' : after.y >= maxY - 2 ? ' (at bottom)' : '';
      const moved = after.y !== Math.round(before.y) || after.x !== Math.round(before.x);
      return {
        ok: true,
        content: `${moved ? 'Scrolled' : 'Could not scroll further'} ${box ? `inside ${box.localName}` : 'the page'}: y=${after.y} of ${Math.max(0, Math.round(maxY))}${where}, x=${after.x}.`,
        data: { ...after, maxY, container: box ? 'element' : 'page' },
      };
    } catch (err) {
      return { ok: false, content: 'scroll failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export type HoverArgs = { ref: string };

export const hover = definePageTool<HoverArgs>({
  name: 'hover',
  description: 'Move the (synthetic) mouse over an element, e.g. to open a hover menu or show a tooltip.',
  parameters: {
    type: 'object',
    properties: { ref: { type: 'string', description: 'Element ref from find_elements.' } },
    required: ['ref'],
  },
  run: function (args: HoverArgs): ToolResult {
    try {
      const resolveRef = (ref: string): Element | string => {
        const reg = (window as unknown as Record<symbol, { byRef: Map<string, WeakRef<Element>> } | undefined>)[
          Symbol.for('carbon-commander.element-refs')
        ];
        const weak = reg?.byRef.get(ref.trim());
        if (!weak) return `Unknown ref "${ref}". Refs reset when the page navigates or reloads; call find_elements again.`;
        const el = weak.deref();
        if (!el || !el.isConnected) return `Element ${ref} is no longer on the page (the page changed). Call find_elements again.`;
        return el;
      };
      const found = resolveRef(args.ref);
      if (typeof found === 'string') return { ok: false, content: found };
      const el = found;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
      const r = el.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Pointer('pointerover', init));
      el.dispatchEvent(new Pointer('pointerenter', { ...init, bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseover', init));
      el.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false }));
      el.dispatchEvent(new Pointer('pointermove', init));
      el.dispatchEvent(new MouseEvent('mousemove', init));
      return { ok: true, content: `Hovering over ${el.localName}. CSS :hover styles are not triggered by synthetic events; menus opened by JS are.` };
    } catch (err) {
      return { ok: false, content: 'hover failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
  },
});

export type WaitInPageArgs = { selector?: string; text?: string; gone?: boolean; timeout_ms: number };

/**
 * In-page half of the background `wait` tool: resolves when `selector` / `text` appears (or is
 * gone), or after `timeout_ms`. Not registered as a tool itself.
 */
export const waitInPage = definePageTool<WaitInPageArgs>({
  name: 'wait_in_page',
  description: 'Internal: wait in the page for a selector or text.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string' },
      text: { type: 'string' },
      gone: { type: 'boolean' },
      timeout_ms: { type: 'integer' },
    },
    required: ['timeout_ms'],
  },
  run: function (args: WaitInPageArgs): Promise<ToolResult> {
    const started = Date.now();
    const want = (args.text ?? '').toLowerCase();
    const present = (): boolean => {
      if (args.selector) {
        const el = document.querySelector(args.selector);
        if (!el) return false;
        // Present but display:none (e.g. a hidden spinner template) does not count.
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
      }
      if (want) {
        const body = document.body;
        const text = ((body as HTMLElement | null)?.innerText ?? body?.textContent ?? '').toLowerCase();
        if (!text.includes(want)) return false;
      }
      return true;
    };
    const what = [args.selector && `selector "${args.selector}"`, args.text && `text "${args.text}"`].filter(Boolean).join(' and ');
    return new Promise<ToolResult>((resolve) => {
      try {
        if (args.selector) document.querySelector(args.selector);
      } catch {
        resolve({ ok: false, content: `Invalid CSS selector: ${args.selector}` });
        return;
      }
      const check = (): boolean => present() !== (args.gone === true);
      if (check()) {
        resolve({ ok: true, content: `${what} ${args.gone ? 'is already gone' : 'is already present'}.` });
        return;
      }
      const timer = setInterval(() => {
        if (check()) {
          clearInterval(timer);
          resolve({ ok: true, content: `${what} ${args.gone ? 'disappeared' : 'appeared'} after ${Date.now() - started} ms.` });
        } else if (Date.now() - started >= args.timeout_ms) {
          clearInterval(timer);
          resolve({ ok: false, content: `Timed out after ${args.timeout_ms} ms waiting for ${what} to ${args.gone ? 'disappear' : 'appear'}.` });
        }
      }, 200);
    });
  },
});
