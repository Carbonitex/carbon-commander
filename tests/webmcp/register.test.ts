/** The MAIN-world script registration follows `Settings.webmcp` (register.ts). */
import { describe, expect, it } from 'vitest';
import { WEBMCP_CONTENT_SCRIPT, WEBMCP_SCRIPT_ID, createWebMcpScriptSync, type ScriptRegistry } from '../../src/webmcp/register';

/** Like Chrome: keeps the registrations, and reports them with the defaults filled in. */
function fakeRegistry(): ScriptRegistry & { ids: Set<string>; calls: string[]; scripts: Map<string, chrome.scripting.RegisteredContentScript> } {
  const scripts = new Map<string, chrome.scripting.RegisteredContentScript>();
  const ids = {
    has: (id: string) => scripts.has(id),
    get size() {
      return scripts.size;
    },
  } as unknown as Set<string>;
  const calls: string[] = [];
  return {
    ids,
    calls,
    scripts,
    async getRegisteredContentScripts({ ids: wanted }) {
      await new Promise((r) => setTimeout(r, 1));
      return wanted.flatMap((id) => {
        const s = scripts.get(id);
        return s ? [{ allFrames: false, matchOriginAsFallback: false, persistAcrossSessions: true, runAt: 'document_idle', world: 'ISOLATED', ...s }] : [];
      });
    },
    async registerContentScripts(list) {
      for (const s of list) {
        if (scripts.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
        scripts.set(s.id, { ...s });
      }
      calls.push('register');
    },
    async unregisterContentScripts({ ids: gone }) {
      for (const id of gone) scripts.delete(id);
      calls.push('unregister');
    },
  };
}

describe('createWebMcpScriptSync', () => {
  it('registers a top-frame MAIN-world document_start script, and unregisters it when off', async () => {
    expect(WEBMCP_CONTENT_SCRIPT).toMatchObject({ js: ['webmcp.js'], runAt: 'document_start', world: 'MAIN', allFrames: false, matches: ['<all_urls>'] });
    const registry = fakeRegistry();
    const sync = createWebMcpScriptSync(registry);
    await sync(true);
    expect(registry.ids.has(WEBMCP_SCRIPT_ID)).toBe(true);
    await sync(true); // idempotent
    await sync(false);
    expect(registry.ids.size).toBe(0);
    await sync(false);
    expect(registry.calls).toEqual(['register', 'unregister']);
  });

  it('serialises overlapping calls (no duplicate-id failure) and ends in the last state', async () => {
    const registry = fakeRegistry();
    const sync = createWebMcpScriptSync(registry);
    await Promise.all([sync(true), sync(true), sync(false), sync(true)]);
    expect(registry.ids.has(WEBMCP_SCRIPT_ID)).toBe(true);
    expect(registry.calls).toEqual(['register', 'unregister', 'register']);
  });

  it('replaces a registration that differs from the current definition (e.g. left by an older version after an update)', async () => {
    const registry = fakeRegistry();
    registry.scripts.set(WEBMCP_SCRIPT_ID, { id: WEBMCP_SCRIPT_ID, js: ['webmcp.js'], matches: ['https://*/*'], runAt: 'document_end', world: 'MAIN' });
    await createWebMcpScriptSync(registry)(true);
    expect(registry.calls).toEqual(['unregister', 'register']);
    expect(registry.scripts.get(WEBMCP_SCRIPT_ID)).toEqual(WEBMCP_CONTENT_SCRIPT);
    // The same definition is left alone.
    await createWebMcpScriptSync(registry)(true);
    expect(registry.calls).toEqual(['unregister', 'register']);
  });

  it('never rejects when Chrome fails', async () => {
    const registry = fakeRegistry();
    registry.registerContentScripts = () => Promise.reject(new Error('boom'));
    await expect(createWebMcpScriptSync(registry)(true)).resolves.toBeUndefined();
  });
});
