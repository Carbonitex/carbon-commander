/**
 * Command history for the input (Up / Down), shell style: navigating away from an unsent draft
 * keeps it, and Down past the newest entry restores it. Pure; persistence is injected.
 */

export const HISTORY_LIMIT = 100;

export class InputHistory {
  private entries: string[];
  /** Index into `entries` while navigating; `entries.length` = the draft. */
  private cursor: number;
  private draft = '';

  constructor(entries: readonly string[] = [], private readonly limit = HISTORY_LIMIT) {
    this.entries = entries.filter((e) => e.trim() !== '').slice(-limit);
    this.cursor = this.entries.length;
  }

  /** Record a submitted command (consecutive duplicates collapse) and reset navigation. */
  push(text: string): void {
    const value = text.trim();
    if (value && this.entries[this.entries.length - 1] !== value) {
      this.entries.push(value);
      if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    }
    this.reset();
  }

  /** Older entry, or undefined when there is none (caller keeps the current text). */
  up(current: string): string | undefined {
    if (this.cursor === 0 || this.entries.length === 0) return undefined;
    if (this.cursor === this.entries.length) this.draft = current;
    this.cursor--;
    return this.entries[this.cursor];
  }

  /** Newer entry, the saved draft past the newest, or undefined when not navigating. */
  down(): string | undefined {
    if (this.cursor >= this.entries.length) return undefined;
    this.cursor++;
    return this.cursor === this.entries.length ? this.draft : this.entries[this.cursor];
  }

  /** Stop navigating (e.g. the user edited the text). */
  reset(): void {
    this.cursor = this.entries.length;
    this.draft = '';
  }

  get navigating(): boolean {
    return this.cursor < this.entries.length;
  }

  toArray(): string[] {
    return this.entries.slice();
  }
}
