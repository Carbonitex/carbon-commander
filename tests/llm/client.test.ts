import { describe, expect, it } from 'vitest';
import { createLlmClient, mapModelList, type FetchLike } from '../../src/llm/client';
import { PROVIDERS } from '../../src/shared/defaults';
import type { ChatRequest, LlmEvent, ProviderConfig } from '../../src/shared/types';
import { CcError } from '../../src/shared/types';

const OPENROUTER: ProviderConfig = PROVIDERS.openrouter;
const OLLAMA: ProviderConfig = PROVIDERS.ollama;

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** SSE body from chunks; each string is enqueued as-is (so tests can split mid-line). */
function sse(chunks: string[], opts: { hang?: boolean } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
        return;
      }
      if (opts.hang) return new Promise<void>(() => undefined); // never ends
      controller.close();
      return undefined;
    },
  });
}

const data = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
  data({ id: 'gen-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });

function fakeFetch(
  respond: (c: Captured) => Response | Promise<Response>,
  captured: Captured[] = [],
): { fetch: FetchLike; captured: Captured[] } {
  const fetch: FetchLike = async (url, init) => {
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const c: Captured = {
      url,
      init,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      headers: init.headers as Record<string, string>,
    };
    captured.push(c);
    return respond(c);
  };
  return { fetch, captured };
}

function streamResponse(chunks: string[], opts: { hang?: boolean } = {}): Response {
  return new Response(sse(chunks, opts), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(iter: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

async function errorOf(p: Promise<unknown>): Promise<CcError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(CcError);
    return err as CcError;
  }
  throw new Error('expected a rejection');
}

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: 'some/model',
  messages: [{ role: 'user', content: 'hi' }],
  ...over,
});

describe('createLlmClient.streamChat', () => {
  it('streams text, reports usage and builds the request (OpenRouter headers, no temperature)', async () => {
    const { fetch, captured } = fakeFetch(() =>
      streamResponse([
        ': OPENROUTER PROCESSING\n\n',
        chunk({ role: 'assistant', content: 'Hel' }),
        chunk({ content: 'lo' }),
        chunk({}, 'stop'),
        data({ id: 'gen-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.00042 } }),
        'data: [DONE]\n\n',
      ]),
    );
    const llm = createLlmClient(OPENROUTER, 'sk-test', { fetch });
    const events = await collect(
      llm.streamChat(req({ tools: [{ name: 'read_page', description: 'Read', parameters: { type: 'object', properties: {} }, mutates: false }] })),
    );
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'done', finishReason: 'stop', usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15, cost: 0.00042 } },
    ]);
    const c = captured[0]!;
    expect(c.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(c.headers.Authorization).toBe('Bearer sk-test');
    expect(c.headers['HTTP-Referer']).toMatch(/^https:\/\//);
    expect(c.headers['X-Title']).toBe('Carbon Commander');
    expect(c.body).toMatchObject({ model: 'some/model', stream: true, stream_options: { include_usage: true } });
    expect(c.body).not.toHaveProperty('temperature');
    expect(c.body.tools).toEqual([
      { type: 'function', function: { name: 'read_page', description: 'Read', parameters: { type: 'object', properties: {} } } },
    ]);
  });

  it('sends temperature when set, no attribution headers and no auth for Ollama without a key', async () => {
    const { fetch, captured } = fakeFetch(() => streamResponse([chunk({ content: 'x' }, 'stop'), 'data: [DONE]\n\n']));
    await collect(createLlmClient(OLLAMA, null, { fetch }).streamChat(req({ temperature: 0.2, maxTokens: 50 })));
    const c = captured[0]!;
    expect(c.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(c.body.temperature).toBe(0.2);
    expect(c.body.max_tokens).toBe(50);
    expect(c.headers).not.toHaveProperty('Authorization');
    expect(c.headers).not.toHaveProperty('HTTP-Referer');
    expect(c.headers).not.toHaveProperty('X-Title');
  });

  it('accumulates a tool call whose arguments arrive in fragments split mid-line', async () => {
    const full = chunk({ tool_calls: [{ index: 0, function: { arguments: '"sel' } }] });
    const { fetch } = fakeFetch(() =>
      streamResponse([
        chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'click', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{' } }] }),
        full.slice(0, 25),
        full.slice(25),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'ector": "#go"}' } }] }),
        chunk({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ]),
    );
    const events = await collect(createLlmClient(OPENROUTER, 'k', { fetch }).streamChat(req()));
    expect(events).toEqual([
      { type: 'tool-call', call: { id: 'call_abc', type: 'function', function: { name: 'click', arguments: '{"selector": "#go"}' } } },
      { type: 'done', finishReason: 'tool_calls' },
    ]);
  });

  it('handles interleaved parallel tool calls by index', async () => {
    const { fetch } = fakeFetch(() =>
      streamResponse([
        chunk({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'one', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'two', arguments: '{"x"' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"y":2}' } }] }),
        chunk({ tool_calls: [{ index: 1, function: { arguments: ':1}' } }] }),
        chunk({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ]),
    );
    const events = await collect(createLlmClient(OPENROUTER, 'k', { fetch }).streamChat(req()));
    const calls = events.filter((e) => e.type === 'tool-call').map((e) => (e.type === 'tool-call' ? e.call : null));
    expect(calls).toEqual([
      { id: 'a', type: 'function', function: { name: 'one', arguments: '{"y":2}' } },
      { id: 'b', type: 'function', function: { name: 'two', arguments: '{"x":1}' } },
    ]);
  });

  it('handles whole calls per chunk (Ollama style), all with index 0, and generates missing ids', async () => {
    const { fetch } = fakeFetch(() =>
      streamResponse([
        chunk({ role: 'assistant', content: '', tool_calls: [{ id: 'call_1', index: 0, type: 'function', function: { name: 'a', arguments: '{"q":1}' } }] }),
        chunk({ role: 'assistant', content: '', tool_calls: [{ id: 'call_2', index: 0, type: 'function', function: { name: 'b', arguments: '{}' } }] }),
        chunk({ role: 'assistant', content: '', tool_calls: [{ id: '', index: 0, type: 'function', function: { name: 'c', arguments: '{"z":true}' } }] }),
        // Ollama sends `stop` even with tool calls.
        chunk({ role: 'assistant', content: '' }, 'stop'),
        'data: [DONE]\n\n',
      ]),
    );
    const events = await collect(createLlmClient(OLLAMA, null, { fetch }).streamChat(req()));
    const calls = events.flatMap((e) => (e.type === 'tool-call' ? [e.call] : []));
    expect(calls.map((c) => [c.function.name, c.function.arguments])).toEqual([
      ['a', '{"q":1}'],
      ['b', '{}'],
      ['c', '{"z":true}'],
    ]);
    expect(calls[0]!.id).toBe('call_1');
    expect(calls[2]!.id).toMatch(/^call_\w+/);
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'tool_calls' });
  });

  it('handles fragments without index, object arguments and empty-string arguments', async () => {
    const { fetch } = fakeFetch(() =>
      streamResponse([
        chunk({ tool_calls: [{ id: 'x1', type: 'function', function: { name: 'noargs', arguments: '' } }] }),
        chunk({ tool_calls: [{ id: 'x2', type: 'function', function: { name: 'objargs', arguments: { a: 1 } } }] }),
        chunk({ tool_calls: [{ id: 'x3', type: 'function', function: { name: 'frag', arguments: '{"k":' } }] }),
        chunk({ tool_calls: [{ function: { arguments: '"v"}' } }] }),
        chunk({}, 'tool_calls'),
      ]),
    );
    const events = await collect(createLlmClient(OPENROUTER, 'k', { fetch }).streamChat(req()));
    const calls = events.flatMap((e) => (e.type === 'tool-call' ? [e.call] : []));
    expect(calls.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ['x1', 'noargs', '{}'],
      ['x2', 'objargs', '{"a":1}'],
      ['x3', 'frag', '{"k":"v"}'],
    ]);
  });

  it('emits invalid argument JSON as-is (the loop reports it to the model)', async () => {
    const { fetch } = fakeFetch(() =>
      streamResponse([chunk({ tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 't', arguments: '{"a": ' } }] }, 'tool_calls')]),
    );
    const events = await collect(createLlmClient(OPENROUTER, 'k', { fetch }).streamChat(req()));
    expect(events[0]).toEqual({ type: 'tool-call', call: { id: 'c', type: 'function', function: { name: 't', arguments: '{"a": ' } } });
  });

  it('throws a CcError(http) for a mid-stream error object (OpenRouter shape)', async () => {
    const { fetch } = fakeFetch(() =>
      streamResponse([
        chunk({ content: 'partial' }),
        data({ id: 'gen-1', object: 'chat.completion.chunk', error: { code: 502, message: 'Provider disconnected unexpectedly' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] }),
      ]),
    );
    const seen: LlmEvent[] = [];
    const err = await errorOf(
      (async () => {
        for await (const e of createLlmClient(OPENROUTER, 'k', { fetch }).streamChat(req())) seen.push(e);
      })(),
    );
    expect(seen).toEqual([{ type: 'text-delta', text: 'partial' }]);
    expect(err.code).toBe('http');
    expect(err.status).toBe(502);
    expect(err.message).toContain('Provider disconnected unexpectedly');
  });

  it('maps HTTP errors with the provider message', async () => {
    const { fetch } = fakeFetch(() =>
      new Response(JSON.stringify({ error: { code: 401, message: 'User not found.' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    const err = await errorOf(collect(createLlmClient(OPENROUTER, 'bad', { fetch }).streamChat(req())));
    expect(err.code).toBe('http');
    expect(err.status).toBe(401);
    expect(err.message).toContain('User not found.');
  });

  it('includes upstream metadata.raw and plain-text bodies', async () => {
    const meta = fakeFetch(() =>
      new Response(JSON.stringify({ error: { code: 400, message: 'Provider returned error', metadata: { raw: 'tools not supported' } } }), { status: 400 }),
    );
    expect((await errorOf(collect(createLlmClient(OPENROUTER, 'k', { fetch: meta.fetch }).streamChat(req())))).message).toContain(
      'tools not supported',
    );
    const plain = fakeFetch(() => new Response('model "x" not found', { status: 404 }));
    const err = await errorOf(collect(createLlmClient(OLLAMA, null, { fetch: plain.fetch }).streamChat(req())));
    expect(err.status).toBe(404);
    expect(err.message).toContain('model "x" not found');
  });

  it('adds an OLLAMA_ORIGINS hint to an Ollama 403', async () => {
    const { fetch } = fakeFetch(() => new Response('', { status: 403 }));
    const err = await errorOf(collect(createLlmClient(OLLAMA, null, { fetch }).streamChat(req())));
    expect(err.status).toBe(403);
    expect(err.message).toContain('OLLAMA_ORIGINS=chrome-extension://');
  });

  it('throws no-key before any request when the provider needs a key', async () => {
    const { fetch, captured } = fakeFetch(() => streamResponse([]));
    const err = await errorOf(collect(createLlmClient(OPENROUTER, null, { fetch }).streamChat(req())));
    expect(err.code).toBe('no-key');
    expect(captured).toHaveLength(0);
  });

  it('maps fetch failures to network errors', async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    const err = await errorOf(collect(createLlmClient(OLLAMA, null, { fetch }).streamChat(req())));
    expect(err.code).toBe('network');
    expect(err.message).toContain('http://localhost:11434/v1');
  });

  it('aborts mid-stream with CcError(aborted)', async () => {
    const { fetch } = fakeFetch(() => streamResponse([chunk({ content: 'first' })], { hang: true }));
    const controller = new AbortController();
    const seen: LlmEvent[] = [];
    const run = (async () => {
      for await (const e of createLlmClient(OPENROUTER, 'k', { fetch }).streamChat(req({ signal: controller.signal }))) {
        seen.push(e);
        controller.abort();
      }
    })();
    const err = await errorOf(run);
    expect(err.code).toBe('aborted');
    expect(seen).toEqual([{ type: 'text-delta', text: 'first' }]);
  });

  it('aborts before the response arrives', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch } = fakeFetch(() => streamResponse([]));
    const err = await errorOf(collect(createLlmClient(OLLAMA, null, { fetch }).streamChat(req({ signal: controller.signal }))));
    expect(err.code).toBe('aborted');
  });

  it('accepts a non-streamed JSON completion', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: { role: 'assistant', content: 'ok', tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '' } }] },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    );
    const events = await collect(createLlmClient(OLLAMA, null, { fetch }).streamChat(req()));
    expect(events).toEqual([
      { type: 'text-delta', text: 'ok' },
      { type: 'tool-call', call: { id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } } },
      { type: 'done', finishReason: 'tool_calls', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
    ]);
  });

  it('rejects an empty stream', async () => {
    const { fetch } = fakeFetch(() => streamResponse([': keepalive\n\n']));
    expect((await errorOf(collect(createLlmClient(OLLAMA, null, { fetch }).streamChat(req())))).code).toBe('invalid');
  });

  it('rejects a custom provider without a base URL', async () => {
    const { fetch } = fakeFetch(() => streamResponse([]));
    const err = await errorOf(collect(createLlmClient(PROVIDERS.custom, null, { fetch }).streamChat(req())));
    expect(err.code).toBe('invalid');
  });
});

describe('listModels / mapModelList', () => {
  it('maps OpenRouter entries (pricing per million, tools, images, context)', async () => {
    const body = {
      data: [
        {
          id: 'vendor/model-a',
          name: 'Vendor: Model A',
          context_length: 200000,
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          pricing: { prompt: '0.000002', completion: '0.00001' },
          top_provider: { context_length: 200000 },
          supported_parameters: ['max_tokens', 'tools', 'tool_choice'],
        },
        {
          id: 'openrouter/auto',
          name: 'Auto Router',
          context_length: 2000000,
          architecture: { input_modalities: ['text'] },
          pricing: { prompt: '-1', completion: '-1' },
          supported_parameters: ['max_tokens'],
        },
      ],
    };
    const { fetch, captured } = fakeFetch(() => Response.json(body));
    const models = await createLlmClient(OPENROUTER, null, { fetch }).listModels();
    expect(captured[0]!.url).toBe('https://openrouter.ai/api/v1/models');
    expect(models).toEqual([
      { id: 'vendor/model-a', name: 'Vendor: Model A', contextLength: 200000, supportsTools: true, supportsImages: true, pricing: { prompt: 2, completion: 10 } },
      { id: 'openrouter/auto', name: 'Auto Router', contextLength: 2000000, supportsTools: false, supportsImages: false },
    ]);
  });

  it('maps an Ollama /v1/models list (capabilities unknown)', () => {
    expect(
      mapModelList({ object: 'list', data: [{ id: 'llama3.2:latest', object: 'model', created: 1, owned_by: 'library' }] }),
    ).toEqual([{ id: 'llama3.2:latest', name: 'llama3.2:latest' }]);
  });

  it('maps Ollama native /api/tags, bare arrays and skips junk', () => {
    expect(mapModelList({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }] })).toEqual([{ id: 'qwen3:8b', name: 'qwen3:8b' }]);
    expect(mapModelList([{ id: 'a' }, 'junk', { nope: 1 }, { id: 'a' }])).toEqual([{ id: 'a', name: 'a' }]);
    expect(mapModelList({ error: 'x' })).toEqual([]);
  });
});

describe('review fixes: endpoints, redirects, caps, reasoning', () => {
  it('drops OpenRouter models that do not serve chat completions (:batch, media-only)', () => {
    const models = mapModelList({
      data: [
        { id: 'a/chat', endpoints: ['/api/v1/chat/completions', '/api/v1/completions', '/api/v1/messages', '/api/v1/responses'] },
        { id: 'a/chat:batch', endpoints: ['/api/v1/batches'] },
        { id: 'b/image', endpoints: ['/api/v1/images'] },
        { id: 'c/no-field' },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(['a/chat', 'c/no-field']);
  });

  it('does not follow redirects (the key would go along) and explains it', async () => {
    const { fetch, captured } = fakeFetch(() => Response.redirect('https://elsewhere.example/v1/models', 302));
    const err = await errorOf(createLlmClient(OPENROUTER, 'k', { fetch }).listModels());
    expect(captured[0]!.init.redirect).toBe('manual');
    expect(err.message).toMatch(/redirect/);
  });

  it('refuses a remote http:// base URL (the key would travel in clear text)', async () => {
    const { fetch, captured } = fakeFetch(() => Response.json({ data: [] }));
    const remote = { ...OLLAMA, baseUrl: 'http://192.168.1.20:11434/v1' };
    const err = await errorOf(createLlmClient(remote, null, { fetch }).listModels());
    expect(err.code).toBe('invalid');
    expect(err.message).toMatch(/https/);
    expect(captured).toHaveLength(0);
    // Local http is fine.
    await createLlmClient({ ...OLLAMA, baseUrl: 'http://127.0.0.1:11434/v1' }, null, { fetch }).listModels();
  });

  it('caps one SSE event (a line that never ends is not buffered forever)', async () => {
    const { parseSse, SseTooLarge } = await import('../../src/llm/sse');
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(enc.encode('data: ' + 'x'.repeat(1000)));
      },
    });
    await expect(
      (async () => {
        for await (const _ of parseSse(stream, undefined, 10_000)) void _;
      })(),
    ).rejects.toBeInstanceOf(SseTooLarge);
  });

  it('signals reasoning, rebuilds reasoning_details by index, and sends them back only to OpenRouter', async () => {
    const chunks = [
      chunk({ reasoning: 'Let me', reasoning_details: [{ type: 'reasoning.text', text: 'Let me', index: 0, format: 'anthropic-claude-v1' }] }),
      chunk({ reasoning: ' think', reasoning_details: [{ type: 'reasoning.text', text: ' think', index: 0, signature: 'sig' }] }),
      chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] }, 'tool_calls'),
      'data: [DONE]\n\n',
    ];
    const { fetch, captured } = fakeFetch(() => streamResponse(chunks));
    const events = await collect(createLlmClient(OPENROUTER, 'k', { fetch }).streamChat(req()));
    expect(events.filter((e) => e.type === 'reasoning')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reasoningDetails: [{ type: 'reasoning.text', text: 'Let me think', index: 0, format: 'anthropic-claude-v1', signature: 'sig' }],
    });
    expect(captured).toHaveLength(1);

    const history = req({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }], reasoning_details: [{ type: 'reasoning.text', text: 'x' }] },
        { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      ],
    });
    const or = fakeFetch(() => streamResponse([chunk({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']));
    await collect(createLlmClient(OPENROUTER, 'k', { fetch: or.fetch }).streamChat(history));
    expect(JSON.stringify(or.captured[0]!.body.messages)).toContain('reasoning_details');
    const ol = fakeFetch(() => streamResponse([chunk({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']));
    const events2 = await collect(createLlmClient(OLLAMA, null, { fetch: ol.fetch }).streamChat(history));
    expect(JSON.stringify(ol.captured[0]!.body.messages)).not.toContain('reasoning_details');
    expect(events2.at(-1)).not.toHaveProperty('reasoningDetails');
  });
});
