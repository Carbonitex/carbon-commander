/** Scripted fakes for the agent loop and the session manager. */
import type {
  ChatRequest,
  LlmClient,
  LlmEvent,
  ProviderConfig,
  TabContext,
  ToolArgs,
  ToolCallContext,
  ToolResult,
  ToolSource,
  ToolSpec,
} from '../../src/shared/types';
import { CcError } from '../../src/shared/types';

export const TAB: TabContext = { tabId: 7, windowId: 1, url: 'https://www.example.com/page', title: 'Example page' };

const PROVIDER: ProviderConfig = {
  id: 'custom',
  label: 'Fake',
  baseUrl: 'http://fake.invalid/v1',
  needsKey: false,
  keyName: 'custom-key',
};

/** One scripted step: events to stream, a custom generator, or an error to throw. */
export type Step = LlmEvent[] | ((req: ChatRequest) => AsyncIterable<LlmEvent>) | Error;

export interface ScriptedLlm extends LlmClient {
  /** Requests received, messages deep-copied at call time. */
  requests: ChatRequest[];
}

export function scriptedLlm(steps: Step[]): ScriptedLlm {
  const queue = [...steps];
  const requests: ChatRequest[] = [];
  return {
    provider: PROVIDER,
    requests,
    streamChat(req) {
      const { signal: _signal, ...rest } = req;
      requests.push({ ...structuredClone(rest), ...(req.signal ? { signal: req.signal } : {}) });
      const step = queue.shift();
      if (step === undefined) throw new Error('scriptedLlm: no more steps');
      if (step instanceof Error) return blockingStream(() => Promise.reject(step));
      if (typeof step === 'function') return step(req);
      return (async function* (): AsyncGenerator<LlmEvent> {
        for (const ev of step) {
          await Promise.resolve();
          yield ev;
        }
      })();
    },
    listModels() {
      return Promise.resolve([]);
    },
  };
}

export function text(t: string, usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }): LlmEvent[] {
  return [{ type: 'text-delta', text: t }, { type: 'done', finishReason: 'stop', usage }];
}

export function toolCalls(...calls: [id: string, name: string, args: ToolArgs | string][]): LlmEvent[] {
  return [
    ...calls.map(
      ([id, name, args]): LlmEvent => ({
        type: 'tool-call',
        call: { id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } },
      }),
    ),
    { type: 'done', finishReason: 'tool_calls', usage: { promptTokens: 20, completionTokens: 2, totalTokens: 22 } },
  ];
}

/** A stream with no events that ends when `wait` settles (rejecting = the stream throws). */
export function blockingStream(wait: () => Promise<unknown>): AsyncIterable<LlmEvent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<LlmEvent>> => {
        await wait();
        return { done: true, value: undefined };
      },
    }),
  };
}

/** A stream that emits `first` then hangs until the request is aborted (then throws `aborted`). */
export function hangingStream(first: string): (req: ChatRequest) => AsyncIterable<LlmEvent> {
  return (req) =>
    (async function* (): AsyncGenerator<LlmEvent> {
      yield { type: 'text-delta', text: first };
      await new Promise<void>((_resolve, reject) => {
        const fail = (): void => reject(new CcError('aborted', 'Aborted'));
        if (req.signal?.aborted) fail();
        req.signal?.addEventListener('abort', fail, { once: true });
      });
    })();
}

export type Handler = (args: ToolArgs, ctx: ToolCallContext) => Promise<ToolResult> | ToolResult;

export interface FakeSource extends ToolSource {
  calls: { name: string; args: ToolArgs }[];
}

export function fakeSource(
  tools: (Partial<ToolSpec> & { name: string })[],
  handlers: Record<string, Handler>,
  id = 'builtin',
  label = 'Built-in',
): FakeSource {
  const calls: { name: string; args: ToolArgs }[] = [];
  const specs: ToolSpec[] = tools.map((t) => ({
    description: `${t.name} tool`,
    parameters: { type: 'object', properties: {} },
    ...t,
  }));
  return {
    id,
    label,
    calls,
    listTools: () => Promise.resolve(specs),
    async callTool(name, args, ctx) {
      calls.push({ name, args });
      const h = handlers[name];
      if (!h) return { ok: false, content: `no handler for ${name}` };
      return h(args, ctx);
    },
  };
}

/** Resolves when the signal aborts, then throws like a well-behaved tool. */
export function untilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => reject(new CcError('aborted', 'Aborted'));
    if (signal.aborted) fail();
    signal.addEventListener('abort', fail, { once: true });
  });
}

export function counterIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Let pending microtasks / zero timers run. */
export async function tick(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

export async function waitFor(cond: () => boolean, what = 'condition', timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}
