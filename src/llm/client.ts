/**
 * One OpenAI-compatible chat-completions client for every provider (OpenRouter, Ollama's `/v1`,
 * any custom endpoint). Streams with SSE, accumulates tool calls across deltas and emits each
 * complete, maps `/models` into `ModelInfo`.
 */
import { endpointUrlProblem } from '../shared/defaults';
import type {
  ChatMessage,
  ChatRequest,
  FinishReason,
  LlmClient,
  LlmEvent,
  ModelInfo,
  ProviderConfig,
  ToolCall,
  Usage,
} from '../shared/types';
import { CcError } from '../shared/types';
import { createLogger } from '../shared/logger';
import { parseSse, SseTooLarge } from './sse';
import { toOpenAiTools } from './tool-schema';

const log = createLogger('llm');

/** Public project URL + name for OpenRouter app attribution (sent to OpenRouter only). */
export const ATTRIBUTION = {
  referer: 'https://github.com/carbonitex/carbon-commander',
  title: 'Carbon Commander',
} as const;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Bytes read from one streamed completion (a broken or hostile endpoint cannot exhaust memory). */
export const MAX_STREAM_BYTES = 32 * 1024 * 1024;
/** Bytes read from one JSON response (`/models`, a non-streamed completion, an error body). */
export const MAX_JSON_BYTES = 16 * 1024 * 1024;
/** Characters of `reasoning_details` kept per turn (they are sent back on tool-call turns). */
export const MAX_REASONING_DETAILS_CHARS = 1024 * 1024;

export interface LlmClientOptions {
  /** Injected for tests. Default: the global `fetch`. */
  fetch?: FetchLike;
}

/** `apiKey` is sent as `Authorization: Bearer` when non-null. */
export function createLlmClient(provider: ProviderConfig, apiKey: string | null, options: LlmClientOptions = {}): LlmClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');

  function headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: json ? 'application/json' : 'text/event-stream' };
    if (apiKey) h.Authorization = `Bearer ${apiKey}`;
    if (provider.id === 'openrouter') {
      h['HTTP-Referer'] = ATTRIBUTION.referer;
      h['X-OpenRouter-Title'] = ATTRIBUTION.title;
      h['X-Title'] = ATTRIBUTION.title; // older alias, still honoured
    }
    return h;
  }

  async function request(path: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> {
    if (!baseUrl) throw new CcError('invalid', `${provider.label}: no base URL configured`);
    const problem = endpointUrlProblem(baseUrl);
    if (problem) throw new CcError('invalid', `${provider.label}: the base URL ${problem}. Fix it in settings.`);
    if (signal?.aborted) throw abortedError(signal, signal.reason, provider);
    let res: Response;
    try {
      // Redirects are not followed: the API key would go along to wherever the endpoint points.
      // `manual` (not `error`) so a redirect can be told apart from a network failure.
      res = await doFetch(`${baseUrl}${path}`, { ...init, redirect: 'manual', credentials: 'omit', ...(signal ? { signal } : {}) });
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw abortedError(signal, err, provider);
      throw new CcError('network', `Could not reach ${provider.label} at ${baseUrl}`, { cause: err });
    }
    if (isRedirect(res)) {
      throw new CcError(
        'http',
        `${provider.label} answered with a redirect, which is not followed (the API key would be sent along). ` +
          'Set the final URL as the base URL in settings (check https://, a trailing slash or a path like /v1).',
        res.status ? { status: res.status } : undefined,
      );
    }
    if (!res.ok) throw await httpError(provider, res);
    return res;
  }

  return {
    provider,

    async *streamChat(req: ChatRequest): AsyncGenerator<LlmEvent, void, undefined> {
      if (provider.needsKey && !apiKey) {
        throw new CcError('no-key', `${provider.label} needs an API key. Add it in settings.`);
      }
      const body: Record<string, unknown> = {
        model: req.model,
        messages: provider.id === 'openrouter' ? req.messages : req.messages.map(withoutReasoning),
        stream: true,
        stream_options: { include_usage: true },
      };
      if (req.tools && req.tools.length > 0) body.tools = toOpenAiTools(req.tools);
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

      const res = await request(
        '/chat/completions',
        {
          method: 'POST',
          headers: { ...headers(false), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        req.signal,
      );

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        // The server ignored `stream: true` and answered with one completion.
        yield* fromCompletion(await readJson(res, req.signal), provider);
        return;
      }
      if (!res.body) throw new CcError('invalid', `${provider.label}: empty response`);

      const acc = new ToolCallAccumulator();
      const reasoning = new ReasoningAccumulator();
      let finish: FinishReason | undefined;
      let usage: Usage | undefined;
      let sawChunk = false;
      let completed = false;
      let tooLarge = false;
      const limited = capStream(res.body, MAX_STREAM_BYTES, () => (tooLarge = true));
      try {
        for await (const ev of parseSse(limited, req.signal)) {
          const data = ev.data.trim();
          if (data === '') continue;
          if (data === '[DONE]') break;
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            log.warn('Skipping non-JSON stream chunk from', provider.label);
            continue;
          }
          if (!isRecord(chunk)) continue;
          sawChunk = true;
          if (chunk.error !== undefined && chunk.error !== null) throw providerError(provider, chunk.error);
          if (isRecord(chunk.usage)) usage = mapUsage(chunk.usage);
          const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
          for (const choice of choices) {
            if (!isRecord(choice)) continue;
            if (typeof choice.index === 'number' && choice.index !== 0) continue; // n = 1
            const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : null;
            if (delta) {
              const thinking =
                (typeof delta.reasoning === 'string' && delta.reasoning !== '') ||
                (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0);
              if (Array.isArray(delta.reasoning_details)) reasoning.add(delta.reasoning_details);
              if (thinking) yield { type: 'reasoning' };
              if (typeof delta.content === 'string' && delta.content !== '') {
                yield { type: 'text-delta', text: delta.content };
              }
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) if (isRecord(tc)) acc.add(tc);
              }
            }
            if (typeof choice.finish_reason === 'string') {
              finish = mapFinishReason(choice.finish_reason);
              if (finish === 'error') {
                throw new CcError('http', `${provider.label}: the model stopped with an error`);
              }
            }
          }
        }
        completed = true;
      } catch (err) {
        if (err instanceof CcError) throw err;
        if (req.signal?.aborted || isAbortError(err)) throw abortedError(req.signal, err, provider);
        if (tooLarge || err instanceof SseTooLarge) {
          throw new CcError('invalid', `${provider.label}: the response is too large (over ${MAX_STREAM_BYTES / 1024 / 1024} MB)`, { cause: err });
        }
        throw new CcError('network', `${provider.label}: the stream was interrupted`, { cause: err });
      } finally {
        if (!completed) void limited.cancel().catch(() => undefined);
      }

      if (!sawChunk) throw new CcError('invalid', `${provider.label}: the response stream was empty`);
      const calls = acc.finish();
      for (const call of calls) yield { type: 'tool-call', call };
      const details = provider.id === 'openrouter' ? reasoning.finish() : [];
      yield {
        type: 'done',
        finishReason: settleFinish(finish, calls.length),
        ...(usage ? { usage } : {}),
        ...(details.length > 0 ? { reasoningDetails: details } : {}),
      };
    },

    async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
      const res = await request('/models', { method: 'GET', headers: headers(true) }, signal);
      return mapModelList(await readJson(res, signal));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tool call accumulation
// ---------------------------------------------------------------------------------------------

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Accumulates `delta.tool_calls` entries. Handles:
 * - OpenAI-style fragments (`index` + `id`/`name` on the first fragment, argument pieces after);
 * - a whole call in one chunk (Ollama), several such chunks possibly all with `index: 0`
 *   (a new `id`, or a new `name` after complete arguments, starts a new call);
 * - missing `index` (matched by `id`, else continues the last call);
 * - `arguments` sent as an object instead of a string.
 */
export class ToolCallAccumulator {
  private readonly calls: PartialCall[] = [];
  /** `index` from the wire -> position in `calls`. */
  private readonly byIndex = new Map<number, number>();

  add(tc: Record<string, unknown>): void {
    const fn = isRecord(tc.function) ? tc.function : {};
    const id = typeof tc.id === 'string' ? tc.id : '';
    const name = typeof fn.name === 'string' ? fn.name : '';
    const rawArgs = fn.arguments;
    const args =
      typeof rawArgs === 'string' ? rawArgs : rawArgs !== undefined && rawArgs !== null ? JSON.stringify(rawArgs) : '';
    const index = typeof tc.index === 'number' ? tc.index : undefined;

    let pos: number | undefined;
    if (index !== undefined) pos = this.byIndex.get(index);
    else if (id) pos = this.calls.findIndex((c) => c.id === id);
    else pos = this.calls.length - 1;
    if (pos !== undefined && pos < 0) pos = undefined;

    const current = pos === undefined ? undefined : this.calls[pos];
    const startsNew =
      !current ||
      (id !== '' && current.id !== '' && id !== current.id) ||
      (name !== '' && current.name !== '' && name !== current.name && isCompleteJson(current.args));

    if (startsNew) {
      this.calls.push({ id, name, args });
      if (index !== undefined) this.byIndex.set(index, this.calls.length - 1);
      return;
    }
    if (id && !current.id) current.id = id;
    if (name && !current.name) current.name = name;
    current.args += args;
  }

  /** Complete calls, in order. Nameless fragments are dropped; ids are generated when missing. */
  finish(): ToolCall[] {
    const seen = new Set<string>();
    const out: ToolCall[] = [];
    for (const c of this.calls) {
      if (!c.name) {
        log.warn('Dropping a tool call without a name');
        continue;
      }
      let id = c.id;
      if (!id || seen.has(id)) id = `call_${randomId()}`;
      seen.add(id);
      const args = c.args.trim() === '' ? '{}' : c.args;
      out.push({ id, type: 'function', function: { name: c.name, arguments: args } });
    }
    return out;
  }
}

function isCompleteJson(text: string): boolean {
  if (text.trim() === '') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

// ---------------------------------------------------------------------------------------------
// Reasoning details (OpenRouter)
// ---------------------------------------------------------------------------------------------

/**
 * Rebuilds OpenRouter `reasoning_details` from streamed chunks. Entries with the same `index` (and
 * type) are pieces of one block: their `text` / `summary` / `data` strings are concatenated and the
 * other fields (`id`, `format`, `signature`) are taken from the first piece that has them. Entries
 * without an `index` are kept as they are. The result is what the non-streamed API returns, which
 * OpenRouter asks clients to send back unmodified on tool-call turns. Capped in size: when the
 * blocks are too large they are dropped entirely (a partial sequence must not be sent back).
 */
export class ReasoningAccumulator {
  private readonly blocks: Record<string, unknown>[] = [];
  private readonly byIndex = new Map<string, Record<string, unknown>>();
  private chars = 0;
  private overflow = false;

  add(entries: unknown[]): void {
    for (const raw of entries) {
      if (!isRecord(raw) || this.overflow) continue;
      this.chars += safeLength(raw);
      if (this.chars > MAX_REASONING_DETAILS_CHARS) {
        this.overflow = true;
        log.warn('Dropping oversized reasoning details');
        continue;
      }
      const key = typeof raw.index === 'number' ? `${String(raw.type)}#${raw.index}` : null;
      const existing = key === null ? undefined : this.byIndex.get(key);
      if (!existing) {
        const copy = { ...raw };
        this.blocks.push(copy);
        if (key !== null) this.byIndex.set(key, copy);
        continue;
      }
      for (const field of ['text', 'summary', 'data'] as const) {
        const piece = raw[field];
        if (typeof piece === 'string') existing[field] = `${typeof existing[field] === 'string' ? existing[field] : ''}${piece}`;
      }
      for (const [k, v] of Object.entries(raw)) {
        if (k === 'text' || k === 'summary' || k === 'data') continue;
        if ((existing[k] === undefined || existing[k] === null || existing[k] === '') && v !== undefined && v !== null && v !== '') existing[k] = v;
      }
    }
  }

  finish(): unknown[] {
    return this.overflow ? [] : this.blocks;
  }
}

function safeLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** `reasoning_details` is OpenRouter-only: other providers may reject unknown message fields. */
function withoutReasoning(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant' || message.reasoning_details === undefined) return message;
  const { reasoning_details: _drop, ...rest } = message;
  return rest;
}

// ---------------------------------------------------------------------------------------------
// Non-streamed completion
// ---------------------------------------------------------------------------------------------

function* fromCompletion(body: unknown, provider: ProviderConfig): Generator<LlmEvent, void, undefined> {
  if (!isRecord(body)) throw new CcError('invalid', `${provider.label}: malformed response`);
  if (body.error !== undefined && body.error !== null) throw providerError(provider, body.error);
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  if (!choice || !message) throw new CcError('invalid', `${provider.label}: response has no message`);
  if (typeof message.content === 'string' && message.content !== '') yield { type: 'text-delta', text: message.content };
  const acc = new ToolCallAccumulator();
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((tc, i) => {
      if (isRecord(tc)) acc.add({ index: i, ...tc });
    });
  }
  const finish = typeof choice.finish_reason === 'string' ? mapFinishReason(choice.finish_reason) : undefined;
  if (finish === 'error') throw new CcError('http', `${provider.label}: the model stopped with an error`);
  const calls = acc.finish();
  for (const call of calls) yield { type: 'tool-call', call };
  const usage = isRecord(body.usage) ? mapUsage(body.usage) : undefined;
  const reasoning = new ReasoningAccumulator();
  if (provider.id === 'openrouter' && Array.isArray(message.reasoning_details)) reasoning.add(message.reasoning_details);
  const details = reasoning.finish();
  yield {
    type: 'done',
    finishReason: settleFinish(finish, calls.length),
    ...(usage ? { usage } : {}),
    ...(details.length > 0 ? { reasoningDetails: details } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------------------------

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
    case 'tool_calls':
    case 'length':
    case 'content_filter':
    case 'error':
      return reason;
    case 'function_call':
      return 'tool_calls';
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    default:
      return 'unknown';
  }
}

/** Some providers say `stop` even when they returned tool calls. */
function settleFinish(finish: FinishReason | undefined, callCount: number): FinishReason {
  if (callCount > 0 && (finish === undefined || finish === 'stop' || finish === 'unknown')) return 'tool_calls';
  return finish ?? 'unknown';
}

export function mapUsage(u: Record<string, unknown>): Usage {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const promptTokens = num(u.prompt_tokens);
  const completionTokens = num(u.completion_tokens);
  const total = num(u.total_tokens) || promptTokens + completionTokens;
  const usage: Usage = { promptTokens, completionTokens, totalTokens: total };
  if (typeof u.cost === 'number' && Number.isFinite(u.cost)) usage.cost = u.cost;
  return usage;
}

/** Normalise a `/models` response: OpenRouter's rich list, OpenAI / Ollama `/v1` lists, Ollama's native `/api/tags`. */
export function mapModelList(body: unknown): ModelInfo[] {
  const list: unknown[] = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : [];
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id) ?? str(entry.model) ?? str(entry.name);
    if (!id || seen.has(id)) continue;
    // OpenRouter lists the API paths a model serves; batch-only (`:batch`) and media-only models
    // cannot answer chat completions.
    if (Array.isArray(entry.endpoints) && !entry.endpoints.some((e) => typeof e === 'string' && /\/chat\/completions$/.test(e))) continue;
    seen.add(id);
    const info: ModelInfo = { id, name: str(entry.name) ?? id };

    const top = isRecord(entry.top_provider) ? entry.top_provider : {};
    const ctx = firstPositive(entry.context_length, top.context_length, entry.max_context_length, entry.context_window);
    if (ctx !== undefined) info.contextLength = ctx;

    if (Array.isArray(entry.supported_parameters)) info.supportsTools = entry.supported_parameters.includes('tools');
    const arch = isRecord(entry.architecture) ? entry.architecture : null;
    if (arch && Array.isArray(arch.input_modalities)) info.supportsImages = arch.input_modalities.includes('image');

    if (isRecord(entry.pricing)) {
      const prompt = perMillion(entry.pricing.prompt);
      const completion = perMillion(entry.pricing.completion);
      if (prompt !== undefined && completion !== undefined) info.pricing = { prompt, completion };
    }
    out.push(info);
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function firstPositive(...values: unknown[]): number | undefined {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return undefined;
}

/** OpenRouter prices are USD per token as decimal strings; `-1` means "varies" (routers). */
function perMillion(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

async function httpError(provider: ProviderConfig, res: Response): Promise<CcError> {
  let text = '';
  try {
    text = await readCapped(res, 64 * 1024, undefined, true);
  } catch {
    // ignore
  }
  let detail: string;
  try {
    detail = errorMessageFrom(JSON.parse(text));
  } catch {
    detail = text.trim().slice(0, 300);
  }
  let message = `${provider.label} returned HTTP ${res.status}${detail ? `: ${detail}` : res.statusText ? ` ${res.statusText}` : ''}`;
  if (res.status === 403 && provider.id === 'ollama') message += `. ${ollamaOriginsHint()}`;
  if (res.status === 401 && provider.needsKey) message += '. Check the API key in settings.';
  return new CcError('http', message, { status: res.status });
}

/** Ollama rejects unknown `Origin`s with 403; `chrome-extension://` is not allowed by default. */
export function ollamaOriginsHint(): string {
  const origin =
    typeof location !== 'undefined' && location.protocol === 'chrome-extension:' ? location.origin : 'chrome-extension://*';
  return `Ollama refused this extension's origin. Set the environment variable OLLAMA_ORIGINS=${origin} for the Ollama server and restart it.`;
}

/** A mid-stream (or 200-body) `error` object, e.g. OpenRouter's `{ error: { code: 502, message } }`. */
function providerError(provider: ProviderConfig, error: unknown): CcError {
  const message = errorMessageFrom({ error }) || 'unknown error';
  const code = isRecord(error) ? error.code : undefined;
  const status = typeof code === 'number' ? code : undefined;
  return new CcError('http', `${provider.label}: ${message}`, status === undefined ? undefined : { status });
}

function errorMessageFrom(body: unknown): string {
  if (!isRecord(body)) return typeof body === 'string' ? body : '';
  const err = body.error;
  if (typeof err === 'string') return err;
  if (isRecord(err)) {
    let msg = typeof err.message === 'string' ? err.message : '';
    // OpenRouter puts the upstream provider's explanation in `metadata.raw`.
    const meta = isRecord(err.metadata) ? err.metadata : null;
    if (meta && typeof meta.raw === 'string' && meta.raw && !msg.includes(meta.raw)) {
      msg = msg ? `${msg} (${meta.raw.slice(0, 300)})` : meta.raw.slice(0, 300);
    }
    return msg;
  }
  return typeof body.message === 'string' ? body.message : typeof body.detail === 'string' ? body.detail : '';
}

async function readJson(res: Response, signal: AbortSignal | undefined): Promise<unknown> {
  let text: string;
  try {
    text = await readCapped(res, MAX_JSON_BYTES, signal);
  } catch (err) {
    if (err instanceof CcError) throw err;
    if (signal?.aborted || isAbortError(err)) throw abortedError(signal, err);
    throw new CcError('network', 'The response was interrupted', { cause: err });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new CcError('invalid', 'Malformed JSON response', { cause: err });
  }
}

/** Read a body as text, failing (or, with `truncate`, stopping) after `maxBytes`. */
async function readCapped(res: Response, maxBytes: number, signal?: AbortSignal, truncate = false): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = (): void => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        void reader.cancel().catch(() => undefined);
        if (!truncate) throw new CcError('invalid', `The response is too large (over ${Math.round(maxBytes / 1024 / 1024)} MB)`);
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Pass bytes through; error the stream once more than `maxBytes` went through. */
function capStream(stream: ReadableStream<Uint8Array>, maxBytes: number, onOverflow: () => void): ReadableStream<Uint8Array> {
  let used = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        used += chunk.byteLength;
        if (used > maxBytes) {
          onOverflow();
          controller.error(new Error('stream too large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/** `redirect: 'manual'` answers a redirect with an opaque-redirect response (status 0). */
function isRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
}

/** A timeout (`AbortSignal.timeout`) is a `network` error; anything else is `aborted`. */
function abortedError(signal: AbortSignal | undefined, err: unknown, provider?: ProviderConfig): CcError {
  const reason: unknown = signal?.aborted ? signal.reason : err;
  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return new CcError('network', `${provider ? `${provider.label}: ` : ''}request timed out`, { cause: err });
  }
  return new CcError('aborted', 'Aborted', { cause: err });
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error || (typeof DOMException !== 'undefined' && err instanceof DOMException)) &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
