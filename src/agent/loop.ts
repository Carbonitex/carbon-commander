/**
 * The agent loop. Pure: no `chrome.*`; everything comes in through `RunAgentOptions`.
 *
 * One step = one LLM call. After a step with tool calls, the calls run sequentially in order and
 * their results go back to the model; a step without tool calls ends the run. Whatever happens
 * (abort, tool failure, denial) every assistant `tool_call` gets a matching `tool` message before
 * the loop returns, because providers reject dangling calls on the next request.
 */
import { parseToolArguments } from '../llm/tool-schema';
import type {
  AgentEvent,
  AssistantMessage,
  ChatMessage,
  ConfirmDecision,
  ConfirmRequest,
  ContentPart,
  ImagePart,
  RunAgentOptions,
  RunAgentResult,
  RunEndReason,
  ToolArgs,
  ToolCall,
  ToolItem,
  ToolItemStatus,
  ToolResult,
  ToolSource,
  ToolSpec,
  Usage,
} from '../shared/types';
import { CcError } from '../shared/types';
import { createLogger } from '../shared/logger';
import { repairToolCalls } from './transcript';

const log = createLogger('agent');

export const TOOL_RESULT_TEXT = {
  aborted: 'The run was aborted by the user before this tool finished.',
  notRun: 'Not run: the run was aborted by the user.',
  denied:
    'The user declined to run this tool. Do not call it again unless the user asks; continue without it or ask the user how to proceed.',
  empty: '(no output)',
} as const;

interface CatalogEntry {
  source: ToolSource;
  spec: ToolSpec;
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { llm, model, signal } = options;
  let tab = options.tab;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const appended: ChatMessage[] = [];
  const history: ChatMessage[] = repairToolCalls(options.messages);
  const usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const emit = (event: AgentEvent): void => {
    try {
      options.emit(event);
    } catch (err) {
      log.error('emit handler threw', err);
    }
  };
  const append = (message: ChatMessage): void => {
    history.push(message);
    appended.push(message);
    emit({ type: 'message', message });
  };
  const end = (reason: RunEndReason): RunAgentResult => ({ reason, messages: appended, usage });

  if (signal.aborted) return end('aborted');

  let { catalog, lists } = await buildCatalog(options.sources, tab);
  let specs = [...catalog.values()].map((e) => e.spec);
  const hasDynamicSource = options.sources.some((s) => s.dynamic === true);

  for (let step = 0; step < options.maxSteps; step++) {
    if (signal.aborted) return end('aborted');
    let relisted = false;

    // ---- 0. follow navigations: refresh the tab, then tools + system prompt if it changed ----
    if (step > 0 && options.getTab) {
      let fresh: typeof tab | null = null;
      try {
        fresh = await options.getTab();
      } catch (err) {
        log.debug('getTab failed; keeping the previous tab snapshot', err);
      }
      if (signal.aborted) return end('aborted');
      if (fresh && (fresh.url !== tab.url || fresh.title !== tab.title)) {
        const urlChanged = fresh.url !== tab.url;
        tab = fresh;
        if (urlChanged) {
          ({ catalog, lists } = await buildCatalog(options.sources, tab));
          specs = [...catalog.values()].map((e) => e.spec);
          relisted = true;
        }
        if (options.systemPrompt && history[0]?.role === 'system') {
          history[0] = { role: 'system', content: options.systemPrompt(tab) };
        }
      }
    }
    // Sources whose tools change without a navigation (page tools) are listed again every step.
    if (step > 0 && hasDynamicSource && !relisted) {
      ({ catalog, lists } = await buildCatalog(options.sources, tab, lists));
      specs = [...catalog.values()].map((e) => e.spec);
      if (signal.aborted) return end('aborted');
    }

    // ---- 1. stream one assistant turn -------------------------------------------------------
    let text = '';
    let itemId: string | null = null;
    let thinking = false;
    let reasoningDetails: unknown[] | undefined;
    const calls: ToolCall[] = [];
    try {
      const stream = llm.streamChat({
        model,
        messages: history,
        ...(specs.length > 0 ? { tools: specs } : {}),
        signal,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      });
      for await (const ev of stream) {
        if (signal.aborted) break;
        if (ev.type === 'text-delta') {
          if (ev.text === '') continue;
          itemId ??= newId();
          text += ev.text;
          emit({ type: 'assistant.delta', itemId, text: ev.text });
        } else if (ev.type === 'reasoning') {
          if (!thinking && text === '') emit({ type: 'thinking' });
          thinking = true;
        } else if (ev.type === 'tool-call') {
          calls.push(ev.call);
        } else {
          if (ev.reasoningDetails && ev.reasoningDetails.length > 0) reasoningDetails = ev.reasoningDetails;
          if (ev.usage) {
            addUsage(usage, ev.usage);
            emit({ type: 'usage', usage: ev.usage });
          }
        }
      }
    } catch (err) {
      // Keep what was said so far (without the incomplete tool calls).
      if (text) append({ role: 'assistant', content: text });
      if (signal.aborted || isAbort(err)) return end('aborted');
      throw err;
    }
    if (signal.aborted) {
      if (text) append({ role: 'assistant', content: text });
      return end('aborted');
    }

    // ---- 2. record the assistant turn ---------------------------------------------------------
    const prepared = prepareCalls(calls, newId);
    // An empty turn (no text, no calls) is not recorded: some providers reject empty assistant content.
    if (prepared.length === 0) {
      if (text !== '') append({ role: 'assistant', content: text });
      return end('complete');
    }
    const assistant: AssistantMessage = {
      role: 'assistant',
      content: text === '' ? null : text,
      tool_calls: prepared.map((p) => p.call),
      // Reasoning models continue from their reasoning on the next turn (OpenRouter only).
      ...(reasoningDetails ? { reasoning_details: reasoningDetails } : {}),
    };
    append(assistant);

    // ---- 3. run the tool calls, in order --------------------------------------------------------
    const images: { call: ToolCall; result: ToolResult }[] = [];
    let aborted = false;
    for (const p of prepared) {
      if (aborted || signal.aborted) {
        aborted = true;
        recordSkipped(p);
        continue;
      }
      const outcome = await runCall(p);
      if (outcome.status === 'aborted') aborted = true;
      if (outcome.result.images && outcome.result.images.length > 0) images.push({ call: p.call, result: outcome.result });
    }

    // Images cannot go in tool messages: one user message with image parts after all results.
    if (images.length > 0) {
      let followUp: ChatMessage;
      try {
        followUp = await imageFollowUp(images, options.describeImages, signal);
      } catch (err) {
        if (signal.aborted || isAbort(err)) return end('aborted');
        throw err;
      }
      if (signal.aborted) return end('aborted');
      append(followUp);
    }
    if (aborted || signal.aborted) return end('aborted');
  }
  return end('max-steps');

  // ---------------------------------------------------------------------------------------------

  function recordSkipped(p: PreparedCall): void {
    const item = toolItem(p, 'running');
    emit({ type: 'tool.start', item });
    finishCall(p, 'aborted', { ok: false, content: TOOL_RESULT_TEXT.notRun });
  }

  function finishCall(p: PreparedCall, status: ToolItemStatus, result: ToolResult): { status: ToolItemStatus; result: ToolResult } {
    emit({ type: 'tool.end', itemId: p.call.id, status, result });
    append({ role: 'tool', tool_call_id: p.call.id, content: result.content === '' ? TOOL_RESULT_TEXT.empty : result.content });
    return { status, result };
  }

  function toolItem(p: PreparedCall, status: ToolItemStatus): ToolItem {
    return {
      kind: 'tool',
      id: p.call.id,
      name: p.call.function.name,
      args: p.args ?? {},
      sourceLabel: labelOf(catalog.get(p.call.function.name)),
      status,
      at: Date.now(),
    };
  }

  async function runCall(p: PreparedCall): Promise<{ status: ToolItemStatus; result: ToolResult }> {
    const name = p.call.function.name;
    const entry = catalog.get(name);

    if (!entry) {
      emit({ type: 'tool.start', item: toolItem(p, 'running') });
      const available = [...catalog.keys()];
      const list = available.length > 0 ? ` Available tools: ${available.slice(0, 50).join(', ')}.` : ' No tools are available.';
      return finishCall(p, 'error', { ok: false, content: `Unknown tool "${name}".${list}` });
    }
    if (p.args === null) {
      emit({ type: 'tool.start', item: toolItem(p, 'running') });
      return finishCall(p, 'error', {
        ok: false,
        content: `Invalid arguments for "${name}": ${p.argsError}. Call the tool again with a JSON object matching its schema. Received: ${p.rawArgs.slice(0, 500)}`,
      });
    }

    const confirmation = options.confirmMutations ? confirmationFor(entry.spec, p.args) : null;
    if (confirmation) {
      emit({ type: 'tool.start', item: toolItem(p, 'pending-confirm') });
      let decision: ConfirmDecision;
      try {
        decision = await untilAborted(
          options.confirm({ id: newId(), toolCallId: p.call.id, toolName: name, args: p.args, sourceLabel: labelOf(entry), ...confirmation }),
          signal,
        );
      } catch (err) {
        if (signal.aborted || isAbort(err)) return finishCall(p, 'aborted', { ok: false, content: TOOL_RESULT_TEXT.aborted });
        log.warn('confirm failed; treating as denied', err);
        decision = { allow: false };
      }
      if (signal.aborted) return finishCall(p, 'aborted', { ok: false, content: TOOL_RESULT_TEXT.aborted });
      if (!decision.allow) return finishCall(p, 'denied', { ok: false, content: TOOL_RESULT_TEXT.denied });
      // "Always allow" is remembered by the confirm callback (the session), per tab origin.
      emit({ type: 'tool.update', itemId: p.call.id, status: 'running' });
    } else {
      emit({ type: 'tool.start', item: toolItem(p, 'running') });
    }

    let result: ToolResult;
    try {
      result = normalizeResult(
        await untilAborted(
          entry.source.callTool(name, p.args, {
            tab,
            signal,
            toolCallId: p.call.id,
            ...(entry.spec.binding !== undefined ? { binding: entry.spec.binding } : {}),
          }),
          signal,
        ),
      );
    } catch (err) {
      if (signal.aborted || isAbort(err)) return finishCall(p, 'aborted', { ok: false, content: TOOL_RESULT_TEXT.aborted });
      const message = err instanceof Error ? err.message : String(err);
      return finishCall(p, 'error', { ok: false, content: `Tool "${name}" failed: ${message}` });
    }
    return finishCall(p, result.ok ? 'ok' : 'error', result);
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * Does this call need the user's approval (when confirmations are on), and why? `mutates` first,
 * then `egress` (with the destination host from the `url` argument), then `confirmWhenArgs`.
 */
export function confirmationFor(
  spec: ToolSpec,
  args: ToolArgs,
): Pick<ConfirmRequest, 'reason' | 'egressHost' | 'triggerArgs'> | null {
  // Declared by the (untrusted) page itself: always asks, whatever it claims about itself.
  if (spec.pageTool === true) return { reason: 'page' };
  if (spec.mutates === true) return { reason: 'mutates' };
  if (spec.egress === true) {
    let host: string | undefined;
    try {
      host = typeof args.url === 'string' ? new URL(args.url.trim()).host || undefined : undefined;
    } catch {
      host = undefined;
    }
    return host ? { reason: 'egress', egressHost: host } : { reason: 'egress' };
  }
  const triggered = (spec.confirmWhenArgs ?? []).filter((a) => Boolean(args[a]));
  if (triggered.length > 0) return { reason: 'args', triggerArgs: triggered };
  return null;
}

function labelOf(entry: CatalogEntry | undefined): string {
  if (!entry) return 'Unknown';
  return entry.spec.sourceLabel ?? entry.source.label;
}

interface PreparedCall {
  /** The call as recorded in the transcript (arguments are always valid JSON). */
  call: ToolCall;
  /** Parsed arguments, or null when they were invalid. */
  args: ToolArgs | null;
  rawArgs: string;
  argsError?: string;
}

/**
 * Parse arguments and make ids unique. Invalid argument JSON is replaced by `{}` in the recorded
 * call (some providers reject replaying malformed JSON) and reported to the model as a tool error.
 */
function prepareCalls(calls: readonly ToolCall[], newId: () => string): PreparedCall[] {
  const seen = new Set<string>();
  return calls.map((c) => {
    let id = c.id;
    if (!id || seen.has(id)) id = `call_${newId().replace(/-/g, '').slice(0, 24)}`;
    seen.add(id);
    const raw = c.function.arguments;
    try {
      const args = parseToolArguments(raw);
      return { call: { id, type: 'function', function: { name: c.function.name, arguments: JSON.stringify(args) } }, args, rawArgs: raw };
    } catch (err) {
      return {
        call: { id, type: 'function', function: { name: c.function.name, arguments: '{}' } },
        args: null,
        rawArgs: raw,
        argsError: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

/**
 * List tools from every source; the first source to expose a name wins. A failing source is
 * skipped. With `previous`, only `dynamic` sources are listed again; the others keep their list.
 */
async function buildCatalog(
  sources: readonly ToolSource[],
  tab: RunAgentOptions['tab'],
  previous?: ReadonlyMap<ToolSource, ToolSpec[]>,
): Promise<{ catalog: Map<string, CatalogEntry>; lists: Map<ToolSource, ToolSpec[]> }> {
  const catalog = new Map<string, CatalogEntry>();
  const lists = await Promise.all(
    sources.map(async (source) => {
      const kept = previous && source.dynamic !== true ? previous.get(source) : undefined;
      if (kept) return { source, specs: kept };
      try {
        return { source, specs: await source.listTools(tab) };
      } catch (err) {
        log.warn(`Tool source "${source.id}" failed to list tools`, err);
        return { source, specs: [] as ToolSpec[] };
      }
    }),
  );
  for (const { source, specs } of lists) {
    for (const spec of specs) {
      if (catalog.has(spec.name)) {
        log.warn(`Duplicate tool name "${spec.name}" from "${source.id}" ignored`);
        continue;
      }
      catalog.set(spec.name, { source, spec });
    }
  }
  return { catalog, lists: new Map(lists.map(({ source, specs }) => [source, specs])) };
}

export const IMAGES_NOT_SHOWN = 'The image could not be shown to you (it could not be described).';

async function imageFollowUp(
  entries: { call: ToolCall; result: ToolResult }[],
  describe: RunAgentOptions['describeImages'],
  signal: AbortSignal,
): Promise<ChatMessage> {
  const parts: ContentPart[] = [];
  let anyImage = false;
  for (const { call, result } of entries) {
    const images = result.images ?? [];
    const count = images.length;
    const label = `${count === 1 ? 'Image' : `${count} images`} returned by tool "${call.function.name}" (call ${call.id})`;
    let description: string | null = null;
    if (describe) {
      try {
        description = await describe(images, { toolName: call.function.name, signal });
      } catch (err) {
        if (signal.aborted || isAbort(err)) throw err;
        log.warn('describeImages failed', err);
        description = IMAGES_NOT_SHOWN;
      }
    }
    if (description !== null) {
      parts.push({ type: 'text', text: `${label}, as text because you cannot see images:\n${description}` });
      continue;
    }
    parts.push({ type: 'text', text: `${label}:` });
    for (const img of images) {
      const part: ImagePart = { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } };
      parts.push(part);
      anyImage = true;
    }
  }
  if (!anyImage) return { role: 'user', content: parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n') };
  return { role: 'user', content: parts };
}

/** Tools are untrusted code (MCP servers): coerce whatever comes back into a `ToolResult`. */
function normalizeResult(value: unknown): ToolResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, content: `Tool returned an invalid result: ${String(value)}` };
  }
  const r = value as Partial<ToolResult>;
  const content = typeof r.content === 'string' ? r.content : r.content === undefined ? '' : safeJson(r.content);
  const out: ToolResult = { ok: r.ok !== false, content };
  if (r.data !== undefined) out.data = r.data;
  if (Array.isArray(r.images)) {
    const images = r.images.filter(
      (i): i is { mime: string; base64: string } =>
        typeof i === 'object' && i !== null && typeof i.mime === 'string' && typeof i.base64 === 'string' && i.base64 !== '',
    );
    if (images.length > 0) out.images = images;
  }
  return out;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function addUsage(total: Usage, u: Usage): void {
  total.promptTokens += u.promptTokens;
  total.completionTokens += u.completionTokens;
  total.totalTokens += u.totalTokens;
  if (u.cost !== undefined) total.cost = (total.cost ?? 0) + u.cost;
}

function isAbort(err: unknown): boolean {
  if (err instanceof CcError) return err.code === 'aborted';
  return err instanceof Error && err.name === 'AbortError';
}

/** Resolve with `promise`, or reject with an AbortError as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(new CcError('aborted', 'Aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new CcError('aborted', 'Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
