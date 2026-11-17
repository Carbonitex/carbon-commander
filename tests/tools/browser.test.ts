/* eslint-disable @typescript-eslint/unbound-method -- expect(mock) / toString() on method references is intended in tests */
import { describe, expect, it, vi } from 'vitest';
import { createBrowserTools } from '../../src/tools/generic/browser';
import { createBuiltinTools } from '../../src/tools/builtin';
import { createHackerNewsTools, itemIdFromUrl } from '../../src/tools/sites/hackernews';
import { getText, SITE_MAX_BYTES } from '../../src/tools/sites/http';
import { repoFromUrl } from '../../src/tools/sites/github';
import type { BackgroundToolDefinition, ToolDefinition } from '../../src/shared/types';
import type { PageExecutor } from '../../src/tools/page-exec';
import { callContext, fakeDeps, fakeTabs } from './fakes';

const pick = (tools: ToolDefinition[], name: string): BackgroundToolDefinition => {
  const t = tools.find((x) => x.name === name);
  if (!t || t.context !== 'background') throw new Error(`no ${name}`);
  return t;
};

describe('browser tools', () => {
  const pageExec: PageExecutor = { run: vi.fn(async () => ({ ok: true, content: 'appeared' })) };

  it('screenshot returns a JPEG image and refuses inactive tabs', async () => {
    const deps = fakeDeps();
    const shot = pick(createBrowserTools(deps, pageExec), 'screenshot');
    const r = await shot.run({ quality: 200 }, callContext());
    expect(r.ok).toBe(true);
    expect(r.images).toEqual([{ mime: 'image/jpeg', base64: 'QUJD' }]);
    expect(deps.tabs.captureVisibleTab).toHaveBeenCalledWith(1, { format: 'jpeg', quality: 90 });
    const t = deps.tabs.tabs.get(7);
    if (t) t.active = false;
    expect((await shot.run({}, callContext())).content).toMatch(/not the active tab/);
  });

  it('screenshot hides our overlay while capturing and restores it, even when the capture fails', async () => {
    const order: string[] = [];
    const overlay = {
      suspend: vi.fn(async () => {
        order.push('suspend');
        return true;
      }),
      resume: vi.fn(async () => void order.push('resume')),
    };
    const deps = fakeDeps({ overlay });
    const capture = vi.mocked(deps.tabs.captureVisibleTab);
    capture.mockImplementationOnce(async () => {
      order.push('capture');
      return 'data:image/jpeg;base64,QUJD';
    });
    const shot = pick(createBrowserTools(deps, pageExec), 'screenshot');
    expect((await shot.run({}, callContext())).ok).toBe(true);
    expect(order).toEqual(['suspend', 'capture', 'resume']);

    capture.mockImplementationOnce(async () => {
      throw new Error('capture failed');
    });
    await expect(shot.run({}, callContext())).rejects.toThrow('capture failed');
    expect(overlay.resume).toHaveBeenCalledTimes(2);

    // Overlay closed (or no content script): nothing to restore.
    overlay.suspend.mockImplementationOnce(async () => false);
    expect((await shot.run({}, callContext())).ok).toBe(true);
    expect(overlay.resume).toHaveBeenCalledTimes(2);
  });

  it('navigate validates the URL and waits for load complete', async () => {
    const deps = fakeDeps();
    const nav = pick(createBrowserTools(deps, pageExec), 'navigate');
    await expect(nav.run({ url: 'javascript:alert(1)' }, callContext())).rejects.toThrow(/Only http/);
    const r = await nav.run({ url: '/next' }, callContext());
    expect(deps.tabs.update).toHaveBeenCalledWith(7, { url: 'https://example.com/next' });
    expect(r.content).toContain('Navigated: https://example.com/next');
  });

  it('navigate reports a slow load instead of failing', async () => {
    const deps = fakeDeps();
    deps.tabs.update = vi.fn(async () => undefined);
    const nav = pick(createBrowserTools(deps, pageExec), 'navigate');
    const r = await nav.run({ url: 'https://slow.test/', timeout_ms: 1000 }, callContext());
    expect(r.ok).toBe(true);
    expect(r.content).toContain('still loading');
  });

  it('go_back without history is a clean error; wait delegates to the page', async () => {
    const deps = fakeDeps();
    const tools = createBrowserTools(deps, pageExec);
    expect((await pick(tools, 'go_back').run({}, callContext())).content).toMatch(/no previous page/);
    const r = await pick(tools, 'wait').run({ selector: '.done', timeout_ms: 2000 }, callContext());
    expect(r.content).toBe('appeared');
    expect(pageExec.run).toHaveBeenCalledWith(expect.objectContaining({ name: 'wait_in_page' }), { selector: '.done', timeout_ms: 2000, gone: false }, expect.anything(), { timeoutMs: 7000 });
    expect((await pick(tools, 'wait').run({ ms: 1 }, callContext())).content).toBe('Waited 1 ms.');
  });

  it('tab tools list, open next to the current tab, and switch', async () => {
    const deps = fakeDeps();
    const tools = createBrowserTools(deps, pageExec);
    expect((await pick(tools, 'list_tabs').run({}, callContext())).content).toContain('[tab 7] (this tab) (active) Example');
    const opened = await pick(tools, 'open_tab').run({ url: 'https://example.org/' }, callContext());
    expect(deps.tabs.create).toHaveBeenCalledWith({ url: 'https://example.org/', active: false, windowId: 1, openerTabId: 7, index: 1 });
    expect(opened.content).toContain('in the background');
    expect((await pick(tools, 'switch_tab').run({ tab_id: 8 }, callContext())).ok).toBe(true);
    expect(deps.windows.update).toHaveBeenCalledWith(1, { focused: true });
    expect((await pick(tools, 'switch_tab').run({ tab_id: 99 }, callContext())).ok).toBe(false);
  });

  it('list_tabs hides query strings / fragments of other tabs and asks first for all windows', async () => {
    const deps = fakeDeps({
      tabs: fakeTabs([
        { id: 7, windowId: 1, url: 'https://example.com/page?mine=1#x', title: 'Example', active: true, status: 'complete', index: 0 },
        { id: 8, windowId: 1, url: 'https://bank.example/account?token=SECRET#frag', title: 'Bank', active: false, status: 'complete', index: 1 },
      ]),
    });
    const tool = pick(createBrowserTools(deps, pageExec), 'list_tabs');
    expect(tool.confirmWhenArgs).toEqual(['all_windows']);
    const r = await tool.run({}, callContext());
    expect(r.content).toContain('https://example.com/page?mine=1#x');
    expect(r.content).toContain('https://bank.example/account [query/fragment hidden]');
    expect(r.content).not.toContain('SECRET');
    expect(JSON.stringify(r.data)).not.toContain('SECRET');
  });

  it('get_current_time uses the injected clock', async () => {
    const r = await pick(createBuiltinTools(fakeDeps()), 'get_current_time').run({}, callContext());
    expect(r.content).toContain('UTC: 2026-01-02T03:04:05.000Z');
  });
});

describe('site toolsets', () => {
  it('parse ids from the tab URL', () => {
    expect(itemIdFromUrl('https://news.ycombinator.com/item?id=123')).toBe(123);
    expect(itemIdFromUrl('https://news.ycombinator.com/news')).toBeUndefined();
    expect(repoFromUrl('https://github.com/owner/repo/tree/main/src')).toBe('owner/repo');
    expect(repoFromUrl('https://github.com/settings/profile')).toBeUndefined();
    expect(repoFromUrl('https://github.com/owner')).toBeUndefined();
  });

  it('hn_get_item renders the Algolia comment tree for the current item', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('https://hn.algolia.com/api/v1/items/42');
      return new Response(
        JSON.stringify({
          id: 42, type: 'story', title: 'Story', url: 'https://s.test/', points: 10, author: 'pg',
          children: [{ id: 43, author: 'a', text: '<p>Top &amp; level</p>', children: [{ id: 44, author: 'b', text: 'Reply', children: [] }] }],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const tools = createHackerNewsTools({ fetch: fetchFn as unknown as typeof fetch });
    const r = await pick(tools, 'hn_get_item').run({}, callContext('https://news.ycombinator.com/item?id=42'));
    expect(r.content).toContain('# Story');
    expect(r.content).toContain('- a (id 43): Top & level');
    expect(r.content).toContain('  - b (id 44): Reply');
    expect(tools.every((t) => t.matches?.(new URL('https://news.ycombinator.com/')))).toBe(true);
  });
});

describe('site API helpers', () => {
  it('cap the response size and do not follow redirects', async () => {
    const big = vi.fn(async () => new Response('x'.repeat(SITE_MAX_BYTES + 10)));
    await expect(getText(big as unknown as typeof fetch, 'https://api.example/x', new AbortController().signal)).rejects.toThrow(/more than/);
    expect((big.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });
});
