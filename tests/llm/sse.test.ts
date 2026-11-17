import { describe, expect, it } from 'vitest';
import { parseSse, type SseEvent } from '../../src/llm/sse';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of parseSse(stream, signal)) out.push(e);
  return out;
}

describe('parseSse', () => {
  it('parses OpenAI-style data events split across chunks', async () => {
    const events = await collect(streamOf('data: {"a":', '1}\n\n', 'data: [DONE]\n\n'));
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '[DONE]' },
    ]);
  });

  it('handles event/id/retry fields, comments, multi-line data and CRLF', async () => {
    const events = await collect(
      streamOf(': keepalive\r\n', 'event: message\r\nid: 7\r\nretry: 1000\r\ndata: line1\r\ndata: line2\r', '\n\r\n'),
    );
    expect(events).toEqual([{ event: 'message', data: 'line1\nline2', id: '7', retry: 1000 }]);
  });

  it('skips events without data and strips a BOM', async () => {
    const events = await collect(streamOf('﻿event: ping\n\ndata:x\n\n'));
    expect(events).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('emits a trailing event without a final blank line', async () => {
    expect(await collect(streamOf('data: last'))).toEqual([{ event: 'message', data: 'last' }]);
  });

  it('handles multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: héllo\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 8));
        c.enqueue(bytes.slice(8));
        c.close();
      },
    });
    expect(await collect(stream)).toEqual([{ event: 'message', data: 'héllo' }]);
  });

  it('throws on abort', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: 1\n\n'));
      },
    });
    const it = parseSse(stream, controller.signal);
    expect((await it.next()).value).toEqual({ event: 'message', data: '1' });
    const pending = it.next();
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
