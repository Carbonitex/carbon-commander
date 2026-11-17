import { describe, expect, it, vi } from 'vitest';
import {
  applyPatch,
  createSettingsStore,
  migrateLegacy,
  normalizeSettings,
  validateSettings,
} from '../../src/background/settings';
import { DEFAULT_SETTINGS, STORAGE_KEYS, defaultSettings } from '../../src/shared/defaults';
import type { Settings } from '../../src/shared/types';
import { CcError } from '../../src/shared/types';
import { createFakeStorageArea } from '../helpers/fake-storage';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('settings store', () => {
  it('returns defaults when nothing is stored', async () => {
    const store = createSettingsStore(createFakeStorageArea());
    expect(await store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a stored partial object with defaults', async () => {
    const area = createFakeStorageArea({
      [STORAGE_KEYS.settings]: { systemPrompt: 'be brief', models: { chat: { provider: 'ollama', model: 'llama' } } },
    });
    const s = await createSettingsStore(area).get();
    expect(s.systemPrompt).toBe('be brief');
    expect(s.models.chat).toEqual({ provider: 'ollama', model: 'llama' });
    expect(s.models.vision).toEqual(DEFAULT_SETTINGS.models.vision);
    expect(s.confirmMutations).toBe(true);
  });

  it('saves a patch, merging providers/models one level deep', async () => {
    const area = createFakeStorageArea();
    const store = createSettingsStore(area);
    const s = await store.set({
      maxSteps: 7,
      providers: { custom: { baseUrl: 'http://localhost:8080/v1' } },
      models: { autocomplete: { provider: 'custom', model: 'tiny' } },
    });
    expect(s.maxSteps).toBe(7);
    expect(s.providers.custom).toEqual({ baseUrl: 'http://localhost:8080/v1', label: DEFAULT_SETTINGS.providers.custom.label });
    expect(s.models.autocomplete).toEqual({ provider: 'custom', model: 'tiny' });
    expect(s.models.chat).toEqual(DEFAULT_SETTINGS.models.chat);
    expect(area.data.get(STORAGE_KEYS.settings)).toEqual(s);
    // A new store instance reads it back.
    expect(await createSettingsStore(area).get()).toEqual(s);
  });

  it('rejects invalid patches without saving', async () => {
    const area = createFakeStorageArea();
    const store = createSettingsStore(area);
    await expect(store.set({ maxSteps: 0 })).rejects.toBeInstanceOf(CcError);
    await expect(store.set({ providers: { ollama: { baseUrl: 'javascript:alert(1)' } } })).rejects.toThrow(/baseUrl/);
    await expect(store.set({ models: { chat: { provider: 'nope' as 'ollama', model: 'x' } } })).rejects.toThrow(/models\.chat/);
    expect(area.data.has(STORAGE_KEYS.settings)).toBe(false);
    expect((await store.get()).maxSteps).toBe(DEFAULT_SETTINGS.maxSteps);
  });

  it('ignores mcpServers / version / unknown keys in a patch', async () => {
    const store = createSettingsStore(createFakeStorageArea());
    const s = await store.set({
      mcpServers: [{ id: 'x', name: 'x', url: 'https://x', enabled: true }],
      version: 99,
      bogus: true,
    } as never);
    expect(s.mcpServers).toEqual([]);
    expect(s.version).toBe(1);
    expect('bogus' in s).toBe(false);
  });

  it('serialises concurrent writes', async () => {
    const store = createSettingsStore(createFakeStorageArea());
    await Promise.all([
      store.set({ systemPrompt: 'a' }),
      store.set({ maxSteps: 3 }),
      store.update((s) => ({ ...s, disabledTools: ['click'] })),
    ]);
    const s = await store.get();
    expect(s).toMatchObject({ systemPrompt: 'a', maxSteps: 3, disabledTools: ['click'] });
  });

  it('update() validates MCP servers', async () => {
    const store = createSettingsStore(createFakeStorageArea());
    const ok = await store.update((s) => ({
      ...s,
      mcpServers: [{ id: 'id1', name: 'github', url: 'https://example.com/mcp', enabled: true }],
    }));
    expect(ok.mcpServers).toHaveLength(1);
    await expect(
      store.update((s) => ({
        ...s,
        mcpServers: [...s.mcpServers, { id: 'id2', name: 'GitHub', url: 'https://example.org/mcp', enabled: true }],
      })),
    ).rejects.toThrow(/duplicate name/);
    await expect(
      store.update((s) => ({ ...s, mcpServers: [{ id: 'id3', name: 'bad name', url: 'https://x', enabled: true }] })),
    ).rejects.toThrow(/name/);
  });

  it('notifies listeners once per own write and on external writes', async () => {
    const area = createFakeStorageArea();
    const store = createSettingsStore(area);
    const listener = vi.fn();
    store.onChange(listener);

    await store.set({ autocomplete: false });
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as Settings).autocomplete).toBe(false);

    // Another context (e.g. a second worker instance) writes the key directly.
    await area.set({ [STORAGE_KEYS.settings]: { ...defaultSettings(), maxSteps: 42 } });
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);
    expect((await store.get()).maxSteps).toBe(42);
  });

  it('reset() restores defaults', async () => {
    const store = createSettingsStore(createFakeStorageArea());
    await store.set({ systemPrompt: 'x' });
    expect(await store.reset()).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates the v0.3 system prompt and hostname prompts on first load', async () => {
    const area = createFakeStorageArea({
      [STORAGE_KEYS.legacySettings]: {
        systemPrompt: 'legacy prompt',
        hostnamePrompts: { 'example.com': 'site prompt', 'empty.com': '' },
        keyValuePairs: {},
      },
    });
    const s = await createSettingsStore(area).get();
    expect(s.systemPrompt).toBe('legacy prompt');
    expect(s.sitePrompts).toEqual({ 'example.com': 'site prompt' });
  });
});

describe('settings helpers', () => {
  it('normalizeSettings repairs corrupt fields and drops bad MCP entries', () => {
    const s = normalizeSettings({
      maxSteps: -3,
      keybind: { key: 'k' },
      sitePrompts: { a: 1 },
      mcpServers: [
        { id: '1', name: 'ok', url: 'https://a.example/mcp', enabled: true },
        { id: '2', name: 'ok', url: 'https://b.example/mcp', enabled: true }, // duplicate name
        { id: '3', name: 'ftp', url: 'ftp://c.example', enabled: true },
        'junk',
      ],
      disabledTools: ['a', 'a', 'b'],
    });
    expect(s.maxSteps).toBe(DEFAULT_SETTINGS.maxSteps);
    expect(s.keybind).toBeNull();
    expect(s.sitePrompts).toEqual({});
    expect(s.mcpServers.map((m) => m.id)).toEqual(['1']);
    expect(s.disabledTools).toEqual(['a', 'b']);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('validateSettings accepts the defaults and a keybind', () => {
    expect(validateSettings(defaultSettings())).toEqual(DEFAULT_SETTINGS);
    const kb = { key: 'k', ctrl: true, meta: false, alt: false, shift: false };
    expect(validateSettings(applyPatch(defaultSettings(), { keybind: kb })).keybind).toEqual(kb);
  });

  it('migrateLegacy accepts Map-entries arrays', () => {
    expect(migrateLegacy({ hostnamePrompts: [['x.com', 'p']] }).sitePrompts).toEqual({ 'x.com': 'p' });
    expect(migrateLegacy(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('provider base URLs: https, or http only for the local machine (stored remote http falls back)', () => {
    const remote = applyPatch(defaultSettings(), { providers: { ollama: { baseUrl: 'http://192.168.1.20:11434/v1' } } });
    expect(() => validateSettings(remote)).toThrow(/https/);
    const local = applyPatch(defaultSettings(), { providers: { ollama: { baseUrl: 'http://127.0.0.1:11434/v1' } } });
    expect(validateSettings(local).providers.ollama.baseUrl).toBe('http://127.0.0.1:11434/v1');
    const stored = normalizeSettings({ providers: { custom: { baseUrl: 'http://llm.lan.example/v1', label: 'x' } } });
    expect(stored.providers.custom.baseUrl).toBe('');
  });

  it('drops the removed "fast" role from stored settings and patches', () => {
    const s = normalizeSettings({ models: { fast: { provider: 'openrouter', model: 'x' }, chat: { provider: 'ollama', model: 'llama' } } });
    expect(Object.keys(s.models).sort()).toEqual(['autocomplete', 'chat', 'vision']);
    const patched = validateSettings(applyPatch(defaultSettings(), { models: { fast: { provider: 'ollama', model: 'y' } } } as never));
    expect(patched.models).not.toHaveProperty('fast');
  });
});
