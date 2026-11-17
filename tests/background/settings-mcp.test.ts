import { describe, expect, it } from 'vitest';
import { createSettingsStore, normalizeSettings } from '../../src/background/settings';
import { createFakeStorageArea } from '../helpers/fake-storage';

describe('MCP discovery + OAuth settings', () => {
  it('discovery is on by default and validated', async () => {
    const store = createSettingsStore(createFakeStorageArea());
    expect((await store.get()).mcpDiscovery).toBe(true);
    expect((await store.set({ mcpDiscovery: false })).mcpDiscovery).toBe(false);
    await expect(store.set({ mcpDiscovery: 'yes' as never })).rejects.toThrow(/mcpDiscovery/);
    expect(normalizeSettings({ mcpDiscovery: 1 }).mcpDiscovery).toBe(true);
  });

  it('keeps a valid OAuth client id per server and drops invalid ones', async () => {
    const store = createSettingsStore(createFakeStorageArea());
    const saved = await store.update((s) => ({ ...s, mcpServers: [{ id: 'a', name: 'a', url: 'https://a.example.com/mcp', enabled: true, oauthClientId: 'client-123' }] }));
    expect(saved.mcpServers[0]?.oauthClientId).toBe('client-123');
    await expect(store.update((s) => ({ ...s, mcpServers: [{ id: 'a', name: 'a', url: 'https://a.example.com/mcp', enabled: true, oauthClientId: 'has space' }] }))).rejects.toThrow(/client id/);
    const n = normalizeSettings({ mcpServers: [{ id: 'a', name: 'a', url: 'https://a.example.com/mcp', enabled: true, oauthClientId: 'bad id' }] });
    expect(n.mcpServers[0]).toEqual({ id: 'a', name: 'a', url: 'https://a.example.com/mcp', enabled: true });
  });
});
