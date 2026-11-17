/**
 * The command input: auto-growing textarea, Enter to send (Shift+Enter for a newline), Up/Down
 * history, autocomplete ghost text (Tab accepts) and suggestion chips.
 */
import { h, replaceChildren } from '../dom';
import { ghostTail, type Autocompleter } from './autocomplete';
import type { InputHistory } from './history';

export interface InputViewOptions {
  history: InputHistory;
  autocompleter: Autocompleter;
  /** Return false to refuse the message (e.g. not connected): the text then stays in the box. */
  onSubmit(text: string): boolean | void;
  onChange(): void;
}

const MAX_CHIPS = 3;
/** "Typing" lasts this long after the last input (focus-stealing guard of the confirm prompt). */
export const TYPING_GRACE_MS = 2_000;

export class InputView {
  readonly el: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  private readonly mirrorText: HTMLSpanElement;
  private readonly ghost: HTMLSpanElement;
  private readonly chips: HTMLElement;
  private suggestions: string[] = [];
  private suggestionsFor = '';
  private lastInputAt = -Infinity;

  constructor(private readonly options: InputViewOptions) {
    this.textarea = h('textarea', {
      class: 'cc-input',
      rows: 1,
      placeholder: 'Ask anything, or tell me what to do on this page…',
      'aria-label': 'Message',
      autocomplete: 'off',
      spellcheck: 'true',
      'data-lpignore': 'true',
    });
    this.mirrorText = h('span', { class: 'cc-ghost-typed' });
    this.ghost = h('span', { class: 'cc-ghost-tail' });
    const mirror = h('div', { class: 'cc-ghost', 'aria-hidden': 'true' }, this.mirrorText, this.ghost);
    this.chips = h('div', { class: 'cc-chips', role: 'list', 'aria-label': 'Suggestions' });
    this.el = h('div', { class: 'cc-input-wrap' }, h('div', { class: 'cc-input-field' }, mirror, this.textarea), this.chips);

    this.textarea.addEventListener('input', () => {
      this.lastInputAt = performance.now();
      this.options.history.reset();
      this.autogrow();
      this.renderGhost();
      this.options.autocompleter.update(this.textarea.value);
      this.options.onChange();
    });
    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.textarea.addEventListener('scroll', () => (mirror.scrollTop = this.textarea.scrollTop));
  }

  get value(): string {
    return this.textarea.value;
  }

  setValue(text: string): void {
    this.textarea.value = text;
    this.textarea.setSelectionRange(text.length, text.length);
    this.autogrow();
    this.renderGhost();
    this.options.onChange();
  }

  /** Focused, or typed in within `TYPING_GRACE_MS`. */
  isTyping(): boolean {
    return document.activeElement === this.textarea || performance.now() - this.lastInputAt < TYPING_GRACE_MS;
  }

  focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  setDisabled(disabled: boolean): void {
    this.textarea.readOnly = disabled;
    this.el.classList.toggle('cc-input-busy', disabled);
  }

  /** Autocompleter callback. */
  showSuggestions(forText: string, suggestions: string[]): void {
    this.suggestionsFor = forText;
    this.suggestions = suggestions;
    this.renderGhost();
    this.options.onChange();
  }

  private currentGhost(): string {
    const value = this.textarea.value;
    if (value !== this.suggestionsFor) return '';
    return ghostTail(value, this.suggestions[0]);
  }

  private renderGhost(): void {
    const value = this.textarea.value;
    const tail = this.currentGhost();
    this.mirrorText.textContent = value;
    this.ghost.textContent = tail;
    // The first suggestion is shown as ghost text when it continues the input; the rest as chips.
    const chips = value === this.suggestionsFor ? (tail ? this.suggestions.slice(1) : this.suggestions) : [];
    replaceChildren(
      this.chips,
      chips.slice(0, MAX_CHIPS).map((s) =>
        h('button', { type: 'button', class: 'cc-chip', role: 'listitem', on: { click: () => this.accept(s) } }, s),
      ),
    );
  }

  /** Send the current text (Enter / Send button). */
  submit(): void {
    const text = this.textarea.value.trim();
    if (!text) return;
    if (this.options.onSubmit(text) === false) return;
    this.options.history.push(text);
    this.options.autocompleter.cancel();
    this.suggestions = [];
    this.setValue('');
  }

  private accept(text: string): void {
    this.options.autocompleter.cancel();
    this.suggestions = [];
    this.setValue(text);
    this.focus();
  }

  private autogrow(): void {
    const ta = this.textarea;
    ta.style.height = 'auto';
    // scrollHeight excludes the border; add it so no scrollbar appears below the cap.
    const border = ta.offsetHeight - ta.clientHeight;
    const wanted = ta.scrollHeight + border;
    ta.style.height = `${Math.min(wanted, 160)}px`;
    ta.style.overflowY = wanted > 160 ? 'auto' : 'hidden';
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const ta = this.textarea;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      const tail = this.currentGhost();
      const chip = this.suggestions[0];
      if (tail) {
        event.preventDefault();
        this.accept(ta.value + tail);
      } else if (chip && ta.value === this.suggestionsFor) {
        event.preventDefault();
        this.accept(chip);
      }
      return;
    }
    if (event.key === 'ArrowUp' && !event.shiftKey && !ta.value.slice(0, ta.selectionStart).includes('\n')) {
      const prev = this.options.history.up(ta.value);
      if (prev !== undefined) {
        event.preventDefault();
        this.options.autocompleter.cancel();
        this.setValue(prev);
      }
      return;
    }
    if (event.key === 'ArrowDown' && !event.shiftKey && !ta.value.slice(ta.selectionEnd).includes('\n')) {
      const next = this.options.history.down();
      if (next !== undefined) {
        event.preventDefault();
        this.options.autocompleter.cancel();
        this.setValue(next);
      }
    }
  }
}
