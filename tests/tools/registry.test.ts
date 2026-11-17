/* eslint-disable @typescript-eslint/unbound-method -- expect(mock) / toString() on method references is intended in tests */
import { describe, expect, it, vi } from 'vitest';
import { defineBackgroundTool, definePageTool } from '../../src/tools/define';
import { createBuiltinToolSource, createToolRegistry, truncateContent } from '../../src/tools/registry';
import type { PageExecutor } from '../../src/tools/page-exec';
import { CcError, type ToolResult } from '../../src/shared/types';
import { callContext, fakeDeps, tabContext } from './fakes';

const echo = defineBackgroundTool<{ text: string; times?: number }>({
  name: 'echo',
  description: 'Echo text',
  parameters: { type: 'object', properties: { text: { type: 'string' }, times: { type: 'integer' } }, required: ['text'] },
  run: async (args) => ({ ok: true, content: args.text.repeat(args.times ?? 1) }),
});
const onlyExample = defineBackgroundTool({
  name: 'only_example',
  description: 'Only on example.org',
  parameters: { type: 'object', properties: {} },
  matches: (u) => u.hostname === 'example.org',
  run: async () => ({ ok: true, content: 'here' }),
});
const boom = defineBackgroundTool({
  name: 'boom',
  description: 'Throws',
  mutates: true,
  parameters: { type: 'object', properties: {} },
  run: async () => {
    throw new Error('kaput');
  },
});
const pageTool = definePageTool<{ n: number }>({
  name: 'page_thing',
  description: 'Runs in page',
  parameters: { type: 'object', properties: { n: { type: 'number' } } },
  run: function (args) {
    return { ok: true, content: String(args.n) };
  },
});

function registry(exec?: PageExecutor, max?: number) {
  const pageExecutor: PageExecutor = exec ?? { run: vi.fn(async (): Promise<ToolResult> => ({ ok: true, content: 'from page' })) };
  return { reg: createToolRegistry([echo, onlyExample, boom, pageTool], { pageExecutor, ...(max ? { maxResultChars: max } : {}) }), pageExecutor };
}

describe('tool registry', () => {
  it('lists specs filtered by matches(url), without run/context', async () => {
    const { reg } = registry();
    const names = (await reg.listTools(tabContext('https://example.com/'))).map((t) => t.name);
    expect(names).toEqual(['echo', 'boom', 'page_thing']);
    const there = await reg.listTools(tabContext('https://example.org/x'));
    expect(there.map((t) => t.name)).toContain('only_example');
    expect(Object.keys(there[0] ?? {}).sort()).toEqual(['description', 'mutates', 'name', 'parameters']);
    expect(there.find((t) => t.name === 'boom')?.mutates).toBe(true);
    // Unparsable URLs (e.g. about:blank is fine, '' is not) only drop matching tools.
    expect((await reg.listTools(tabContext(''))).map((t) => t.name)).toEqual(['echo', 'boom', 'page_thing']);
  });

  it('passes egress / confirmWhenArgs through to the specs (fetch_url, list_tabs)', async () => {
    const all = await createBuiltinToolSource(fakeDeps()).listTools(tabContext('https://example.com/'));
    expect(all.find((t) => t.name === 'fetch_url')).toMatchObject({ egress: true });
    expect(all.find((t) => t.name === 'list_tabs')).toMatchObject({ confirmWhenArgs: ['all_windows'] });
    // No other tool sends model-chosen data to a model-chosen host without asking.
    const silent = all.filter((t) => !t.mutates && !t.egress).map((t) => t.name);
    expect(silent).not.toContain('fetch_url');
  });

  it('rejects duplicate names at registration', () => {
    expect(() => createToolRegistry([echo, echo], { pageExecutor: { run: vi.fn() } })).toThrow(/Duplicate/);
  });

  it('validates arguments and returns a helpful error to the model', async () => {
    const { reg } = registry();
    const r = await reg.callTool('echo', { times: 'x' }, callContext());
    expect(r.ok).toBe(false);
    expect(r.content).toContain('Invalid arguments for echo');
    expect(r.content).toContain('text: is required');
    expect(r.content).toContain('- text (string, required)');
    expect(await reg.callTool('echo', { text: 'ab', times: '2' }, callContext())).toEqual({ ok: true, content: 'abab' });
  });

  it('handles unknown tools and tools not available on the tab', async () => {
    const { reg } = registry();
    expect((await reg.callTool('nope', {}, callContext())).content).toContain('Unknown tool');
    expect((await reg.callTool('only_example', {}, callContext('https://example.com/'))).content).toContain('not available');
  });

  it('dispatches page tools to the executor with validated args', async () => {
    const { reg, pageExecutor } = registry();
    const ctx = callContext();
    expect(await reg.callTool('page_thing', { n: '3' }, ctx)).toEqual({ ok: true, content: 'from page' });
    expect(pageExecutor.run).toHaveBeenCalledWith(pageTool, { n: 3 }, ctx);
  });

  it('converts thrown errors to ok:false and rethrows aborts', async () => {
    const { reg } = registry({ run: async () => Promise.reject(new CcError('no-tab', 'Chrome does not let extensions script chrome:// pages')) });
    expect(await reg.callTool('boom', {}, callContext())).toEqual({ ok: false, content: 'boom failed: kaput' });
    expect((await reg.callTool('page_thing', {}, callContext())).content).toContain('chrome:// pages');

    const ac = new AbortController();
    ac.abort();
    await expect(reg.callTool('echo', { text: 'x' }, callContext(undefined, ac.signal))).rejects.toMatchObject({ code: 'aborted' });
    const { reg: abortingReg } = registry({ run: async () => Promise.reject(new CcError('aborted', 'Aborted')) });
    await expect(abortingReg.callTool('page_thing', {}, callContext())).rejects.toMatchObject({ code: 'aborted' });
  });

  it('caps result size with a truncation marker', async () => {
    const { reg } = registry(undefined, 100);
    const r = await reg.callTool('echo', { text: 'x', times: 500 }, callContext());
    expect(r.content.startsWith('x'.repeat(100))).toBe(true);
    expect(r.content).toContain('truncated: 400 more characters');
    expect(truncateContent('short', 10)).toBe('short');
  });

  it('the full built-in source registers cleanly with unique names', async () => {
    const source = createBuiltinToolSource(fakeDeps());
    const all = await source.listTools(tabContext('https://example.com/'));
    const names = all.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['read_page', 'find_elements', 'click', 'type_text', 'screenshot', 'navigate', 'fetch_url', 'get_current_time']));
    expect(names).not.toContain('hn_list_stories');
    expect((await source.listTools(tabContext('https://news.ycombinator.com/'))).map((t) => t.name)).toContain('hn_list_stories');
    expect((await source.listTools(tabContext('https://github.com/a/b'))).map((t) => t.name)).toContain('github_repo_info');
    const mutating = all.filter((t) => t.mutates).map((t) => t.name).sort();
    expect(mutating).toEqual(['click', 'go_back', 'go_forward', 'navigate', 'open_tab', 'press_key', 'reload', 'select_option', 'switch_tab', 'type_text']);
  });
});
