import { describe, expect, it } from 'vitest';
import { createMemoryBackend, createSecretStore, type EncryptedValue } from '../../src/background/secrets';
import { createFakeStorageArea } from '../helpers/fake-storage';

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** Re-implementation of the v0.3 `CCLocalStorage.setEncrypted` (src/chrome-serviceworker/local-storage.js in the v0.3 sources). */
async function legacyEncrypt(jwk: JsonWebKey, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return JSON.stringify({ v: 2, iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}

async function newJwk(): Promise<JsonWebKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return crypto.subtle.exportKey('jwk', key);
}

function makeStore(area = createFakeStorageArea(), backend = createMemoryBackend()) {
  return { area, backend, store: createSecretStore({ backend, legacy: area }) };
}

describe('secret store', () => {
  it('round-trips a value, encrypted in the backend with a non-extractable key, nothing in chrome.storage', async () => {
    const { area, backend, store } = makeStore();
    await store.set('openrouter-key', 'sk-or-test-123');

    const stored = backend.values.get('openrouter-key');
    expect(stored?.iv).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(stored?.ct)).not.toContain('sk-or-test-123');
    const key = await backend.getKey();
    expect(key?.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', key as CryptoKey)).rejects.toThrow();
    expect([...area.data.keys()]).toEqual([]);

    expect(await store.get('openrouter-key')).toBe('sk-or-test-123');
    expect(await store.has('openrouter-key')).toBe(true);
  });

  it('migrates legacy values once, then deletes the legacy key and ciphertexts', async () => {
    const jwk = await newJwk();
    const area = createFakeStorageArea({
      _cc_encryption_key: jwk,
      'encrypted_openrouter-key': await legacyEncrypt(jwk, 'sk-or-legacy'),
      'encrypted_mcp-auth-abc': await legacyEncrypt(jwk, '{"bearerToken":"t"}'),
      'encrypted_ollama-key': '00230009', // v0.3 XOR hex format (dropped)
      cc_settings: { keep: true },
    });
    const { store } = makeStore(area);
    expect(await store.get('openrouter-key')).toBe('sk-or-legacy');
    expect(await store.get('mcp-auth-abc')).toBe('{"bearerToken":"t"}');
    expect(await store.has('ollama-key')).toBe(false);
    expect([...area.data.keys()]).toEqual(['cc_settings']);
  });

  it('keeps a value already in the new store over a legacy one', async () => {
    const jwk = await newJwk();
    const area = createFakeStorageArea({ _cc_encryption_key: jwk });
    const backend = createMemoryBackend();
    await makeStore(createFakeStorageArea(), backend).store.set('custom-key', 'new');
    await area.set({ 'encrypted_custom-key': await legacyEncrypt(jwk, 'old') });
    const { store } = makeStore(area, backend);
    expect(await store.get('custom-key')).toBe('new');
    expect(area.data.size).toBe(0);
  });

  it('drops legacy ciphertexts whose key is gone', async () => {
    const area = createFakeStorageArea({ 'encrypted_openrouter-key': await legacyEncrypt(await newJwk(), 'x') });
    const { store } = makeStore(area);
    expect(await store.get('openrouter-key')).toBeNull();
    expect(area.data.size).toBe(0);
  });

  it('reuses the stored key across store instances and creates only one key under concurrency', async () => {
    const backend = createMemoryBackend();
    const a = makeStore(createFakeStorageArea(), backend).store;
    await Promise.all([a.set('openrouter-key', 'one'), a.set('custom-key', 'two')]);
    const b = makeStore(createFakeStorageArea(), backend).store;
    expect(await b.get('openrouter-key')).toBe('one');
    expect(await b.get('custom-key')).toBe('two');
  });

  it('returns null for missing and undecryptable values', async () => {
    const backend = createMemoryBackend();
    const { store } = makeStore(createFakeStorageArea(), backend);
    expect(await store.get('openrouter-key')).toBeNull();
    await store.set('custom-key', 'x');
    const other = createMemoryBackend();
    await other.put('custom-key', backend.values.get('custom-key') as EncryptedValue);
    expect(await makeStore(createFakeStorageArea(), other).store.get('custom-key')).toBeNull();
  });

  it('deletes and lists', async () => {
    const { store } = makeStore();
    await store.set('openrouter-key', 'a');
    await store.set('mcp-auth-abc', JSON.stringify({ bearerToken: 't' }));
    expect((await store.list()).sort()).toEqual(['mcp-auth-abc', 'openrouter-key']);
    await store.delete('openrouter-key');
    expect(await store.has('openrouter-key')).toBe(false);
    expect(await store.list()).toEqual(['mcp-auth-abc']);
  });
});
