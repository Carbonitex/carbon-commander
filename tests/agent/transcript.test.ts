import { describe, expect, it } from 'vitest';
import { IMAGE_OMITTED, INTERRUPTED_TOOL_RESULT, repairToolCalls, stripImages, truncateText } from '../../src/agent/transcript';
import type { ChatMessage } from '../../src/shared/types';

const call = (id: string): { id: string; type: 'function'; function: { name: string; arguments: string } } => ({
  id,
  type: 'function',
  function: { name: 't', arguments: '{}' },
});

describe('repairToolCalls', () => {
  it('fills missing results in call order and drops orphans and duplicates', () => {
    const input: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'tool', tool_call_id: 'orphan', content: 'x' },
      { role: 'assistant', content: null, tool_calls: [call('a'), call('b'), call('c')] },
      { role: 'tool', tool_call_id: 'b', content: 'B' },
      { role: 'tool', tool_call_id: 'b', content: 'B again' },
      { role: 'user', content: 'next' },
    ];
    expect(repairToolCalls(input)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [call('a'), call('b'), call('c')] },
      { role: 'tool', tool_call_id: 'a', content: INTERRUPTED_TOOL_RESULT },
      { role: 'tool', tool_call_id: 'b', content: 'B' },
      { role: 'tool', tool_call_id: 'c', content: INTERRUPTED_TOOL_RESULT },
      { role: 'user', content: 'next' },
    ]);
  });

  it('leaves a consistent transcript unchanged', () => {
    const ok: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'calling', tool_calls: [call('a')] },
      { role: 'tool', tool_call_id: 'a', content: 'A' },
      { role: 'assistant', content: 'done' },
    ];
    expect(repairToolCalls(ok)).toEqual(ok);
  });
});

describe('stripImages / truncateText', () => {
  it('replaces image parts with a note', () => {
    const m: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Image returned by tool "shot":' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    };
    expect(stripImages(m)).toEqual({ role: 'user', content: `Image returned by tool "shot":\n${IMAGE_OMITTED}` });
    const plain: ChatMessage = { role: 'user', content: 'x' };
    expect(stripImages(plain)).toBe(plain);
  });

  it('truncates with a marker', () => {
    expect(truncateText('abcdef', 10)).toBe('abcdef');
    expect(truncateText('abcdef', 3)).toBe('abc\n\n[... truncated: 3 more characters not shown]');
  });
});
