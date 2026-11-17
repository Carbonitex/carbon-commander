/**
 * In-memory `chrome.storage` area for unit tests. Values are JSON round-tripped like Chrome does,
 * and `onChanged` fires asynchronously (microtask) after `set` / `remove` / `clear`.
 *
 * - `createFakeStorageArea()` for code that takes a `StorageAreaLike` parameter.
 * - `installFakeChromeStorage()` to put `chrome.storage.local` / `.session` on `globalThis`.
 */
import type { StorageAreaLike, StorageChangeLike } from '../../src/background/storage-area';

type Listener = (changes: Record<string, StorageChangeLike>) => void;

export interface FakeStorageArea extends StorageAreaLike {
  /** Direct view of the stored data (already JSON round-tripped). */
  readonly data: Map<string, unknown>;
  clear(): Promise<void>;
  onChanged: NonNullable<StorageAreaLike['onChanged']> & { listeners: Set<Listener> };
}

const roundTrip = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createFakeStorageArea(initial: Record<string, unknown> = {}): FakeStorageArea {
  const data = new Map<string, unknown>(Object.entries(initial).map(([k, v]) => [k, roundTrip(v)]));
  const listeners = new Set<Listener>();

  const emit = (changes: Record<string, StorageChangeLike>): void => {
    if (Object.keys(changes).length === 0) return;
    queueMicrotask(() => {
      for (const l of listeners) l(changes);
    });
  };

  return {
    data,
    get(keys) {
      const out: Record<string, unknown> = {};
      const wanted = keys === null || keys === undefined ? [...data.keys()] : typeof keys === 'string' ? [keys] : keys;
      for (const k of wanted) if (data.has(k)) out[k] = roundTrip(data.get(k));
      return Promise.resolve(out);
    },
    set(items) {
      const changes: Record<string, StorageChangeLike> = {};
      for (const [k, v] of Object.entries(items)) {
        const newValue = roundTrip(v);
        changes[k] = { oldValue: data.get(k), newValue };
        data.set(k, newValue);
      }
      emit(changes);
      return Promise.resolve();
    },
    remove(keys) {
      const changes: Record<string, StorageChangeLike> = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        if (!data.has(k)) continue;
        changes[k] = { oldValue: data.get(k) };
        data.delete(k);
      }
      emit(changes);
      return Promise.resolve();
    },
    clear() {
      const changes: Record<string, StorageChangeLike> = {};
      for (const [k, v] of data) changes[k] = { oldValue: v };
      data.clear();
      emit(changes);
      return Promise.resolve();
    },
    onChanged: {
      listeners,
      addListener: (l: Listener) => void listeners.add(l),
      removeListener: (l: Listener) => void listeners.delete(l),
    },
  };
}

/**
 * Install `globalThis.chrome.storage.{local,session}` fakes (merging into any existing `chrome`
 * fake). Returns the areas; call the returned `restore()` in `afterEach`.
 */
export function installFakeChromeStorage(): { local: FakeStorageArea; session: FakeStorageArea; restore(): void } {
  const g = globalThis as { chrome?: unknown };
  const previous = g.chrome;
  const local = createFakeStorageArea();
  const session = createFakeStorageArea();
  g.chrome = { ...(previous as object | undefined), storage: { local, session } };
  return {
    local,
    session,
    restore() {
      g.chrome = previous;
    },
  };
}
