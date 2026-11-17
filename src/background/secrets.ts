/**
 * Encrypted secrets (API keys, MCP auth), used by the service worker only.
 *
 * Storage: the extension origin's IndexedDB (`cc_secrets`), which web pages and content scripts
 * cannot open (content scripts get the page's IndexedDB, not ours). Each value is AES-GCM 256
 * encrypted with a **non-extractable** `CryptoKey` that is itself stored in the same database as a
 * structured-clone of the key object: its raw bytes cannot be exported by script, only used for
 * encrypt / decrypt by extension code.
 *
 * What this protects: secrets are not readable by pages or content scripts, are not in
 * `chrome.storage` (which content scripts can read where Chrome cannot restrict it), and are not
 * exportable from the key object. What it does not: anyone who can run code in the extension (or
 * read and decrypt the browser profile on disk) can use the key; the worker decrypts secrets to
 * send them to the provider / MCP server they belong to.
 *
 * Migration: earlier versions (v0.3, early v0.4) kept an extractable AES-GCM key as JWK under
 * `_cc_encryption_key` in `chrome.storage.local`, next to `encrypted_<name>` values
 * (`{"v":2,"iv","ct"}` JSON strings). On first use those are decrypted, re-encrypted into
 * IndexedDB, and the old key and ciphertexts are deleted from `chrome.storage.local`.
 */

import { STORAGE_KEYS } from '../shared/defaults';
import { createLogger } from '../shared/logger';
import type { SecretName } from '../shared/types';
import type { StorageAreaLike } from './storage-area';

const log = createLogger('secrets');

export interface SecretStore {
  get(name: SecretName): Promise<string | null>;
  set(name: SecretName, value: string): Promise<void>;
  has(name: SecretName): Promise<boolean>;
  delete(name: SecretName): Promise<void>;
  /** Names of all stored secrets. */
  list(): Promise<string[]>;
}

/** One encrypted value as kept by a backend. */
export interface EncryptedValue {
  iv: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

/** Where keys and ciphertexts live. IndexedDB in the extension; an in-memory map in tests. */
export interface SecretBackend {
  getKey(): Promise<CryptoKey | undefined>;
  /** Store the key unless one exists; resolves with the key that is stored (first writer wins). */
  putKeyIfAbsent(key: CryptoKey): Promise<CryptoKey>;
  get(name: string): Promise<EncryptedValue | undefined>;
  put(name: string, value: EncryptedValue): Promise<void>;
  delete(name: string): Promise<void>;
  names(): Promise<string[]>;
}

export interface SecretStoreOptions {
  /** Default: IndexedDB (`createIndexedDbBackend`). */
  backend?: SecretBackend;
  /** Where legacy values are migrated from. Default `chrome.storage.local`; null = no migration. */
  legacy?: StorageAreaLike | null;
  subtle?: SubtleCrypto;
}

interface LegacySecret {
  v: 2;
  iv: string;
  ct: string;
}

export function createSecretStore(options: SecretStoreOptions = {}): SecretStore {
  const backend = options.backend ?? createIndexedDbBackend();
  const legacy = options.legacy === undefined ? chrome.storage.local : options.legacy;
  const subtle = options.subtle ?? crypto.subtle;
  let keyPromise: Promise<CryptoKey> | null = null;
  let migrated: Promise<void> | null = null;

  function getKey(): Promise<CryptoKey> {
    keyPromise ??= (async () => {
      const existing = await backend.getKey();
      if (existing) return existing;
      const fresh = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return backend.putKeyIfAbsent(fresh);
    })().catch((err: unknown) => {
      keyPromise = null;
      throw err;
    });
    return keyPromise;
  }

  async function encrypt(value: string): Promise<EncryptedValue> {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
    return { iv, ct: new Uint8Array(ct) };
  }

  /** One-time move of legacy `chrome.storage.local` secrets (see the module comment). */
  function ready(): Promise<void> {
    migrated ??= migrate().catch((err: unknown) => {
      log.warn('Secret migration failed; will retry', err);
      migrated = null;
    });
    return migrated;
  }

  async function migrate(): Promise<void> {
    if (!legacy) return;
    const all = await legacy.get(null);
    const legacyKeys = Object.keys(all).filter((k) => k === STORAGE_KEYS.encryptionKey || k.startsWith(STORAGE_KEYS.secretPrefix));
    if (legacyKeys.length === 0) return;
    const jwk = all[STORAGE_KEYS.encryptionKey];
    let oldKey: CryptoKey | null = null;
    if (jwk && typeof jwk === 'object') {
      try {
        oldKey = await subtle.importKey('jwk', jwk as JsonWebKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      } catch (err) {
        log.warn('Legacy encryption key is unreadable; legacy secrets are dropped', err);
      }
    }
    let moved = 0;
    for (const storageKey of legacyKeys) {
      if (!storageKey.startsWith(STORAGE_KEYS.secretPrefix) || !oldKey) continue;
      const name = storageKey.slice(STORAGE_KEYS.secretPrefix.length);
      if (await backend.get(name)) continue; // already set in the new store: newer wins
      const parsed = parseLegacy(all[storageKey]);
      if (!parsed) continue;
      try {
        const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(parsed.iv) }, oldKey, fromBase64(parsed.ct));
        await backend.put(name, await encrypt(new TextDecoder().decode(plain)));
        moved++;
      } catch (err) {
        log.warn('Could not migrate legacy secret', name, err);
      }
    }
    await legacy.remove(legacyKeys);
    log.info(`Migrated ${moved} secret(s) to IndexedDB and removed the legacy key`);
  }

  return {
    async set(name, value) {
      await ready();
      await backend.put(name, await encrypt(value));
    },

    async get(name) {
      await ready();
      const stored = await backend.get(name);
      if (!stored) return null;
      try {
        const key = await getKey();
        const plain = await subtle.decrypt({ name: 'AES-GCM', iv: stored.iv }, key, stored.ct);
        return new TextDecoder().decode(plain);
      } catch (err) {
        log.warn('Could not decrypt secret', name, err);
        return null;
      }
    },

    async has(name) {
      await ready();
      return (await backend.get(name)) !== undefined;
    },

    async delete(name) {
      await ready();
      await backend.delete(name);
    },

    async list() {
      await ready();
      return backend.names();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// IndexedDB backend
// ---------------------------------------------------------------------------------------------

const DB_NAME = 'cc_secrets';
const DB_VERSION = 1;
const KEYS = 'keys';
const VALUES = 'values';
const KEY_ID = 'aes-gcm';

/** IndexedDB (extension origin) backend. The database is opened lazily, once per worker. */
export function createIndexedDbBackend(factory: IDBFactory = indexedDB): SecretBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
        if (!db.objectStoreNames.contains(VALUES)) db.createObjectStore(VALUES);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('Could not open the secrets database'));
      req.onblocked = () => reject(new Error('The secrets database is blocked'));
    }).catch((err: unknown) => {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  };

  async function tx<T>(store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest | null): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = body(t.objectStore(store));
      t.oncomplete = () => resolve((req?.result as T) ?? (undefined as T));
      t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  return {
    getKey: () => tx<CryptoKey | undefined>(KEYS, 'readonly', (s) => s.get(KEY_ID)),
    async putKeyIfAbsent(key) {
      const db = await open();
      return new Promise<CryptoKey>((resolve, reject) => {
        const t = db.transaction(KEYS, 'readwrite');
        const store = t.objectStore(KEYS);
        let result: CryptoKey = key;
        const get = store.get(KEY_ID);
        get.onsuccess = () => {
          const existing = get.result as CryptoKey | undefined;
          if (existing) result = existing;
          else store.put(key, KEY_ID);
        };
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
      });
    },
    async get(name) {
      const value = await tx<unknown>(VALUES, 'readonly', (s) => s.get(name));
      return isEncrypted(value) ? value : undefined;
    },
    put: (name, value) => tx<void>(VALUES, 'readwrite', (s) => s.put({ iv: value.iv, ct: value.ct }, name)),
    delete: (name) => tx<void>(VALUES, 'readwrite', (s) => s.delete(name)),
    async names() {
      const keys = await tx<IDBValidKey[]>(VALUES, 'readonly', (s) => s.getAllKeys());
      return keys.filter((k): k is string => typeof k === 'string');
    },
  };
}

/** In-memory backend (tests, or hosts without IndexedDB). */
export function createMemoryBackend(): SecretBackend & { readonly values: Map<string, EncryptedValue> } {
  let key: CryptoKey | undefined;
  const values = new Map<string, EncryptedValue>();
  return {
    values,
    getKey: async () => key,
    putKeyIfAbsent: async (k) => (key ??= k),
    get: async (name) => values.get(name),
    put: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
    names: async () => [...values.keys()],
  };
}

function isEncrypted(v: unknown): v is EncryptedValue {
  return typeof v === 'object' && v !== null && (v as EncryptedValue).iv instanceof Uint8Array && (v as EncryptedValue).ct instanceof Uint8Array;
}

function parseLegacy(raw: unknown): LegacySecret | null {
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as LegacySecret).v === 2 &&
      typeof (value as LegacySecret).iv === 'string' &&
      typeof (value as LegacySecret).ct === 'string'
    ) {
      return value as LegacySecret;
    }
  } catch {
    // not JSON (e.g. the dropped v0.3 XOR format)
  }
  return null;
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
