/**
 * The subset of `chrome.storage.StorageArea` the worker's stores use. `chrome.storage.local` /
 * `.session` satisfy it; tests use `tests/helpers/fake-storage.ts`.
 */
export interface StorageAreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  onChanged?: {
    addListener(callback: (changes: Record<string, StorageChangeLike>) => void): void;
    removeListener(callback: (changes: Record<string, StorageChangeLike>) => void): void;
  };
}

export interface StorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}
