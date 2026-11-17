/* eslint-disable @typescript-eslint/unbound-method -- expect(mock) / toString() on method references is intended in tests */
import { describe, expect, it, vi } from 'vitest';
import { createPageExecutor, explainInjectionError, unscriptableReason } from '../../src/tools/page-exec';
import { definePageTool } from '../../src/tools/define';
import type { InjectionLike, ScriptingLike } from '../../src/tools/deps';
import { callContext, fakeTabs } from './fakes';

const tool = definePageTool({
  name: 'probe',
  description: 'Probe',
  parameters: { type: 'object', properties: {} },
  run: function () {
    return { ok: true, content: 'in page' };
  },
});
const mainTool = definePageTool({ ...tool, name: 'probe_main', context: 'page-main' });

function setup(executeScript: ScriptingLike['executeScript'], url = 'https://example.com/page', extra: object = {}) {
  const tabs = fakeTabs([{ id: 7, windowId: 1, url, active: true, status: 'complete', ...extra }]);
  const scripting = { executeScript: vi.fn(executeScript) };
  return { exec: createPageExecutor({ scripting, tabs }, { timeoutMs: 50 }), scripting, tabs };
}

describe('page executor', () => {
  it('injects into the top frame, ISOLATED for page and MAIN for page-main, args as one argument', async () => {
    const { exec, scripting } = setup(async () => [{ frameId: 0, result: { ok: true, content: 'in page' } }]);
    expect(await exec.run(tool, { a: 1 }, callContext())).toEqual({ ok: true, content: 'in page' });
    await exec.run(mainTool, {}, callContext());
    const calls = scripting.executeScript.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ target: { tabId: 7, frameIds: [0] }, world: 'ISOLATED', args: [{ a: 1 }] });
    expect(calls[0]?.func).toBe(tool.run);
    expect(calls[1]?.world).toBe('MAIN');
  });

  it('refuses unscriptable pages and discarded tabs before injecting', async () => {
    for (const url of ['chrome://settings/', 'https://chromewebstore.google.com/detail/x', 'chrome-extension://abc/bar.html', 'about:blank', 'view-source:https://a.b/']) {
      const { exec, scripting } = setup(async () => [], url);
      await expect(exec.run(tool, {}, callContext()), url).rejects.toMatchObject({ code: 'no-tab' });
      expect(scripting.executeScript).not.toHaveBeenCalled();
    }
    const { exec } = setup(async () => [], 'https://example.com/', { discarded: true });
    await expect(exec.run(tool, {}, callContext())).rejects.toThrow(/discarded/);
  });

  it('maps Chrome errors to actionable messages', async () => {
    const pdf = setup(async () => Promise.reject(new Error('Cannot access contents of url "https://a.test/x.pdf".')), 'https://a.test/x.pdf');
    await expect(pdf.exec.run(tool, {}, callContext())).rejects.toThrow(/PDF viewer/);
    const errorPage = setup(async () => Promise.reject(new Error('Frame with ID 0 is showing error page')));
    await expect(errorPage.exec.run(tool, {}, callContext())).rejects.toThrow(/error page/);
    expect(explainInjectionError('No tab with id: 7.', '')).toBe('The tab was closed.');
    expect(explainInjectionError('Cannot access contents of url "file:///x".', 'file:///x')).toMatch(/file URLs/);
    expect(unscriptableReason('https://example.com/')).toBeNull();
    expect(unscriptableReason('file:///tmp/a.html')).toBeNull();
  });

  it('detects a navigation during the call', async () => {
    const { exec, tabs } = setup(async () => {
      tabs.emit(7, { url: 'https://example.com/other', status: 'loading' });
      return Promise.reject(new Error('Frame with ID 0 was removed.'));
    });
    await expect(exec.run(tool, {}, callContext())).rejects.toThrow(/navigated or reloaded/);

    const second = setup(async () => {
      second.tabs.emit(7, { url: 'https://example.com/next' });
      return [{ frameId: 0, result: undefined }];
    });
    await expect(second.exec.run(tool, {}, callContext())).rejects.toThrow(/navigated/);
  });

  it('reports missing / non-serialisable and malformed results', async () => {
    const none = setup(async () => [{ frameId: 0 }]);
    await expect(none.exec.run(tool, {}, callContext())).rejects.toThrow(/non-serialisable/);
    const bad = setup(async () => [{ frameId: 0, result: { content: 1 } }]);
    await expect(bad.exec.run(tool, {}, callContext())).rejects.toThrow(/invalid result/);
  });

  it('times out and supports abort', async () => {
    const never = (): Promise<never> => new Promise(() => undefined);
    const slow = setup(never);
    await expect(slow.exec.run(tool, {}, callContext())).rejects.toThrow(/timed out/);
    const longer = setup(never);
    const ac = new AbortController();
    const p = longer.exec.run(tool, {}, callContext(undefined, ac.signal), { timeoutMs: 10_000 });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    await expect(longer.exec.run(tool, {}, callContext(undefined, ac.signal))).rejects.toMatchObject({ code: 'aborted' });
  });

  it('reports a closed tab', async () => {
    const { exec } = setup(async () => []);
    await expect(exec.run(tool, {}, { ...callContext(), tab: { tabId: 99, windowId: 1, url: '', title: '' } })).rejects.toThrow(/closed/);
  });

  it('passes the injection shape chrome.scripting expects', async () => {
    let seen: InjectionLike | undefined;
    const { exec } = setup(async (inj) => {
      seen = inj;
      return [{ frameId: 0, result: { ok: true, content: '' } }];
    });
    await exec.run(tool, { q: 'x' }, callContext());
    expect(Object.keys(seen ?? {}).sort()).toEqual(['args', 'func', 'target', 'world']);
  });
});
