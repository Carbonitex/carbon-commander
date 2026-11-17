/**
 * Server-Sent Events parser (WHATWG event-stream format). Used by the LLM client (streamed chat
 * completions) and the MCP client (Streamable HTTP responses).
 */

export interface SseEvent {
  /** `event:` field; `message` when absent. */
  event: string;
  /** `data:` lines joined with `\n`. */
  data: string;
  /** `id:` field of this event, if any. */
  id?: string;
  /** `retry:` field in ms, if any. */
  retry?: number;
}

/** Default cap on one pending line / event (characters): a server cannot grow memory unbounded. */
export const MAX_SSE_EVENT_CHARS = 8 * 1024 * 1024;

/** Thrown when one line or event exceeds `maxEventChars`. */
export class SseTooLarge extends Error {
  constructor() {
    super('A server-sent event is too large');
    this.name = 'SseTooLarge';
  }
}

/**
 * Parse a byte stream into SSE events. Comment lines are skipped; events with no `data` are
 * skipped. A final event not followed by a blank line is still emitted (lenient, unlike the spec),
 * because some servers close the stream right after the last `data:` line.
 * Aborting `signal` cancels the reader and throws an `AbortError`. A line or event longer than
 * `maxEventChars` cancels the reader and throws `SseTooLarge`.
 */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  maxEventChars: number = MAX_SSE_EVENT_CHARS,
): AsyncGenerator<SseEvent, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let buffer = '';
  let event = '';
  let data: string[] = [];
  let dataChars = 0;
  let id: string | undefined;
  let retry: number | undefined;
  let first = true;

  const flush = (): SseEvent | null => {
    const out: SseEvent | null =
      data.length > 0
        ? {
            event: event || 'message',
            data: data.join('\n'),
            ...(id !== undefined ? { id } : {}),
            ...(retry !== undefined ? { retry } : {}),
          }
        : null;
    event = '';
    data = [];
    dataChars = 0;
    id = undefined;
    retry = undefined;
    return out;
  };

  const processLine = (line: string): SseEvent | null => {
    if (line === '') return flush();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'data':
        dataChars += value.length + 1;
        if (dataChars > maxEventChars) throw new SseTooLarge();
        data.push(value);
        break;
      case 'event':
        event = value;
        break;
      case 'id':
        if (!value.includes('\0')) id = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        break;
    }
    return null;
  };

  try {
    for (;;) {
      if (signal?.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError(signal);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (first && buffer.length > 0) {
        if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);
        first = false;
      }
      // Split on CRLF, CR or LF. A trailing CR may be the first half of CRLF: keep it buffered.
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) break;
        if (match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const ev = processLine(line);
        if (ev) yield ev;
      }
      // What is left is one unfinished line.
      if (buffer.length > maxEventChars) throw new SseTooLarge();
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      for (const line of buffer.split(/\r\n|\r|\n/)) {
        const ev = processLine(line);
        if (ev) yield ev;
      }
    }
    const last = flush();
    if (last) yield last;
  } catch (err) {
    if (err instanceof SseTooLarge) await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}
