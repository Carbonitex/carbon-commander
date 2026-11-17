/** Small form builders for the settings view. Labels are always associated with controls. */
import { h } from '../dom';

let counter = 0;
export function uid(prefix: string): string {
  counter++;
  return `${prefix}-${counter}`;
}

export function section(title: string, ...children: (Node | null)[]): HTMLElement {
  const id = uid('cc-sec');
  return h('section', { class: 'cc-settings-section', 'aria-labelledby': id }, h('h3', { id }, title), ...children);
}

export function field(label: string, control: HTMLElement, hint?: string | Node): HTMLElement {
  const id = control.id || uid('cc-field');
  control.id = id;
  let hintEl: HTMLElement | null = null;
  if (hint) {
    const hintId = `${id}-hint`;
    hintEl = h('div', { class: 'cc-hint', id: hintId }, hint);
    control.setAttribute('aria-describedby', hintId);
  }
  return h('div', { class: 'cc-field' }, h('label', { for: id }, label), control, hintEl);
}

export function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void, hint?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', id: uid('cc-check') });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const hintEl = hint ? h('div', { class: 'cc-hint' }, hint) : null;
  return h('div', { class: 'cc-field cc-field-check' }, h('label', { for: input.id }, input, ' ', label), hintEl);
}

export function textInput(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...attrs });
  input.value = value;
  return input;
}

/** Write-only secret input: never pre-filled. */
export function secretInput(placeholder: string): HTMLInputElement {
  return h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder });
}

export function button(label: string, onClick: () => void, cls = '', attrs: Record<string, string> = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: `cc-button ${cls}`.trim(), ...attrs, on: { click: onClick } }, label);
}

/** Inline status line (`role=status`) with a tone. */
export function statusLine(): { el: HTMLElement; set(text: string, tone?: 'ok' | 'error' | 'muted'): void } {
  const el = h('div', { class: 'cc-status-line', role: 'status' });
  return {
    el,
    set(text, tone = 'muted') {
      el.textContent = text;
      el.dataset.tone = tone;
    },
  };
}

/** Run an async action with the button disabled; report errors to `onError`. */
export async function busy<T>(btn: HTMLButtonElement, action: () => Promise<T>, onError: (message: string) => void): Promise<T | undefined> {
  btn.disabled = true;
  try {
    return await action();
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
    return undefined;
  } finally {
    btn.disabled = false;
  }
}
