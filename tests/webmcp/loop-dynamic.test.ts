/** The agent loop with a `dynamic` source (page tools) and the `page` confirmation reason. */
import { describe, expect, it } from 'vitest';
import { confirmationFor, runAgent } from '../../src/agent/loop';
import { wrapSource } from '../../src/background/sessions';
import { toOpenAiTools } from '../../src/llm/tool-schema';
import type { ConfirmRequest, RunAgentOptions, ToolSource, ToolSpec } from '../../src/shared/types';
import { TAB, counterIds, fakeSource, scriptedLlm, text, toolCalls, type Step } from '../agent/fakes';

const spec = (name: string, extra: Partial<ToolSpec> = {}): ToolSpec => ({ name, description: name, parameters: { type: 'object', properties: {} }, ...extra });

function run(steps: Step[], sources: ToolSource[], over: Partial<RunAgentOptions> = {}) {
  const llm = scriptedLlm(steps);
  const confirms: ConfirmRequest[] = [];
  const options: RunAgentOptions = {
    llm,
    model: 'm',
    sources,
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }],
    tab: TAB,
    signal: new AbortController().signal,
    maxSteps: 10,
    confirmMutations: true,
    confirm: (r) => {
      confirms.push(r);
      return Promise.resolve({ allow: true });
    },
    emit: () => undefined,
    newId: counterIds(),
    getTab: () => Promise.resolve(TAB), // same URL every step
    ...over,
  };
  return { llm, confirms, result: runAgent(options) };
}

describe('dynamic tool sources', () => {
  it('re-lists only the dynamic source before every step, without a navigation', async () => {
    let pageTools = ['webmcp__a'];
    let pageLists = 0;
    let staticLists = 0;
    const page: ToolSource = {
      id: 'webmcp',
      label: 'Page',
      dynamic: true,
      listTools: () => {
        pageLists++;
        return Promise.resolve(pageTools.map((n) => spec(n, { mutates: true, pageTool: true })));
      },
      callTool: (name) => {
        // The page swaps its tools (SPA-style) when its first tool runs.
        pageTools = ['webmcp__b'];
        return Promise.resolve({ ok: true, content: `ran ${name}` });
      },
    };
    const builtin: ToolSource = {
      id: 'builtin',
      label: 'Built-in',
      listTools: () => {
        staticLists++;
        return Promise.resolve([spec('read_page')]);
      },
      callTool: () => Promise.resolve({ ok: true, content: 'x' }),
    };
    const { llm, confirms, result } = run([toolCalls(['c1', 'webmcp__a', {}]), toolCalls(['c2', 'webmcp__b', {}]), text('done')], [builtin, page]);
    expect((await result).reason).toBe('complete');
    expect(llm.requests.map((r) => r.tools?.map((t) => t.name))).toEqual([
      ['read_page', 'webmcp__a'],
      ['read_page', 'webmcp__b'],
      ['read_page', 'webmcp__b'],
    ]);
    expect(pageLists).toBe(3);
    expect(staticLists).toBe(1);
    // Page tools always ask, with the `page` reason.
    expect(confirms.map((c) => [c.toolName, c.reason])).toEqual([
      ['webmcp__a', 'page'],
      ['webmcp__b', 'page'],
    ]);
  });

  it('a page tool never shadows a built-in: the first source to expose a name wins', async () => {
    const builtin = fakeSource([{ name: 'click', mutates: true }], { click: () => ({ ok: true, content: 'builtin click' }) });
    const page = fakeSource([{ name: 'click', pageTool: true, mutates: true }], { click: () => ({ ok: true, content: 'page click' }) }, 'webmcp', 'Page');
    const { llm, result } = run([toolCalls(['c1', 'click', {}]), text('ok')], [builtin, page]);
    const messages = (await result).messages;
    expect(messages.find((m) => m.role === 'tool')?.content).toBe('builtin click');
    expect(page.calls).toHaveLength(0);
    expect(llm.requests[0]?.tools?.filter((t) => t.name === 'click')).toHaveLength(1);
  });

  it('page tools run without asking when confirmations are off', async () => {
    const page = fakeSource([{ name: 'webmcp__x', pageTool: true, mutates: true }], { webmcp__x: () => ({ ok: true, content: 'ok' }) }, 'webmcp', 'Page');
    const { confirms, result } = run([toolCalls(['c1', 'webmcp__x', {}]), text('ok')], [page], { confirmMutations: false });
    expect((await result).reason).toBe('complete');
    expect(confirms).toHaveLength(0);
    expect(page.calls).toHaveLength(1);
  });

  it('confirmationFor: pageTool asks with reason page, even when the page says read-only', () => {
    expect(confirmationFor(spec('webmcp__x', { pageTool: true, mutates: false }), {})).toEqual({ reason: 'page' });
    expect(confirmationFor(spec('webmcp__x', { pageTool: true, mutates: true, egress: true }), { url: 'https://a.example' })).toEqual({ reason: 'page' });
  });

  it("hands the listing's binding back with the call (through wrapSource), and never sends it to the model", async () => {
    let listing = 0;
    const bindings: (string | undefined)[] = [];
    const page: ToolSource = {
      id: 'webmcp',
      label: 'Page',
      dynamic: true,
      listTools: () => Promise.resolve([spec('webmcp__x', { pageTool: true, mutates: true, binding: `doc-${++listing}` })]),
      callTool: (_name, _args, c) => {
        bindings.push(c.binding);
        return Promise.resolve({ ok: true, content: 'ok' });
      },
    };
    const { llm, result } = run([toolCalls(['c1', 'webmcp__x', {}]), toolCalls(['c2', 'webmcp__x', {}]), text('ok')], [wrapSource(page, new Set())]);
    expect((await result).reason).toBe('complete');
    expect(bindings).toEqual(['doc-1', 'doc-2']); // each call: the listing of its own step
    // What goes on the wire to the model (the LLM client converts the specs) has no binding.
    expect(JSON.stringify(toOpenAiTools(llm.requests[0]?.tools ?? []))).not.toContain('doc-');
  });

  it('wrapSource keeps the dynamic flag', () => {
    const page: ToolSource = { id: 'webmcp', label: 'Page', dynamic: true, listTools: () => Promise.resolve([]), callTool: () => Promise.resolve({ ok: true, content: '' }) };
    expect(wrapSource(page, new Set()).dynamic).toBe(true);
    expect(wrapSource({ ...page, dynamic: undefined }, new Set()).dynamic).toBeUndefined();
  });
});
