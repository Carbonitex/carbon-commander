/**
 * Debounced, cancellable autocomplete requests. Pure logic (timers and the RPC are injected);
 * the input view renders the ghost text / suggestion chips.
 */
import { CcError, type AutocompleteResult } from '../../shared/types';

export const AUTOCOMPLETE_DELAY_MS = 350;
export const AUTOCOMPLETE_MIN_LENGTH = 3;

export interface AutocompleterOptions {
  request(text: string): Promise<AutocompleteResult>;
  /** Called with the suggestions for `text` (an empty list clears them). */
  onSuggestions(text: string, suggestions: string[]): void;
  delayMs?: number;
  minLength?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export class Autocompleter {
  private timer: unknown = null;
  private seq = 0;
  private latest = '';
  private enabled = true;
  /** Set once the worker says the feature is unavailable; stays off for this page. */
  private unavailable = false;
  private readonly st: (fn: () => void, ms: number) => unknown;
  private readonly ct: (id: unknown) => void;

  constructor(private readonly options: AutocompleterOptions) {
    this.st = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.ct = options.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  get active(): boolean {
    return this.enabled && !this.unavailable;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  /** The input text changed. */
  update(text: string): void {
    this.cancel();
    this.latest = text;
    if (!this.active || text.trim().length < (this.options.minLength ?? AUTOCOMPLETE_MIN_LENGTH)) return;
    const seq = this.seq;
    this.timer = this.st(() => {
      this.timer = null;
      void this.fire(text, seq);
    }, this.options.delayMs ?? AUTOCOMPLETE_DELAY_MS);
  }

  /** Drop the pending timer and any in-flight response; clears shown suggestions. */
  cancel(): void {
    this.seq++;
    if (this.timer !== null) {
      this.ct(this.timer);
      this.timer = null;
    }
    this.options.onSuggestions(this.latest, []);
  }

  private async fire(text: string, seq: number): Promise<void> {
    try {
      const result = await this.options.request(text);
      if (seq !== this.seq || result.text !== text || text !== this.latest) return;
      const suggestions = result.suggestions.filter((s) => typeof s === 'string' && s.trim() !== '' && s !== text);
      this.options.onSuggestions(text, suggestions);
    } catch (err) {
      if (err instanceof CcError && (err.code === 'not-implemented' || err.code === 'no-key' || err.code === 'no-model')) {
        this.unavailable = true;
      }
      // Other failures (aborted, network) are silent: suggestions are optional.
    }
  }
}

/**
 * The part of `suggestion` to show as ghost text after `input`, or '' when the suggestion does
 * not continue what was typed (it is then offered as a chip instead).
 */
export function ghostTail(input: string, suggestion: string | undefined): string {
  if (!suggestion || !input) return '';
  if (suggestion.length <= input.length) return '';
  if (suggestion.slice(0, input.length).toLowerCase() !== input.toLowerCase()) return '';
  return suggestion.slice(input.length);
}
