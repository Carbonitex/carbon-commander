/**
 * Pure helpers over the model transcript (`ChatMessage[]`), shared by the loop and the session
 * manager.
 */
import type { AssistantMessage, ChatMessage, ContentPart, ToolMessage } from '../shared/types';

export const INTERRUPTED_TOOL_RESULT = 'The tool call was interrupted before it returned a result.';

/**
 * Providers reject an assistant `tool_calls` entry without a matching `tool` message right after
 * it. Returns a copy where every call has one (inserted with `content` when missing) and orphan
 * `tool` messages (no preceding call with that id) are dropped.
 */
export function repairToolCalls(messages: readonly ChatMessage[], content = INTERRUPTED_TOOL_RESULT): ChatMessage[] {
  const out: ChatMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i] as ChatMessage;
    i++;
    if (msg.role === 'tool') continue; // orphan: its assistant turn was handled below
    out.push(msg);
    if (msg.role !== 'assistant' || !msg.tool_calls || msg.tool_calls.length === 0) continue;

    // The contiguous tool messages right after the call are its results (first one per id wins).
    const found = new Map<string, ToolMessage>();
    while (i < messages.length && (messages[i] as ChatMessage).role === 'tool') {
      const next = messages[i] as ToolMessage;
      if (!found.has(next.tool_call_id)) found.set(next.tool_call_id, next);
      i++;
    }
    // One result per call, in call order; missing ones are filled in.
    for (const call of msg.tool_calls) {
      out.push(found.get(call.id) ?? { role: 'tool', tool_call_id: call.id, content });
    }
  }
  return out;
}

/** Placeholder that replaces image parts in stored transcripts. */
export const IMAGE_OMITTED = '[image omitted from the saved conversation]';

/** Copy of a message with image parts replaced by a text note (for storage / later runs). */
export function stripImages(message: ChatMessage): ChatMessage {
  if (message.role !== 'user' || typeof message.content === 'string') return message;
  let images = 0;
  const parts: ContentPart[] = [];
  for (const part of message.content) {
    if (part.type === 'image_url') images++;
    else parts.push(part);
  }
  if (images === 0) return message;
  const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
  return { role: 'user', content: `${text}${text ? '\n' : ''}${images === 1 ? IMAGE_OMITTED : `${IMAGE_OMITTED} (x${images})`}` };
}

/** Text of a user / assistant message (images ignored). */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (message.content === null) return '';
  return message.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

export function isAssistantWithCalls(m: ChatMessage): m is AssistantMessage & { tool_calls: NonNullable<AssistantMessage['tool_calls']> } {
  return m.role === 'assistant' && !!m.tool_calls && m.tool_calls.length > 0;
}

/** Cut `text` to `max` characters with a marker saying how much was removed. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const removed = text.length - max;
  return `${text.slice(0, max)}\n\n[... truncated: ${removed} more characters not shown]`;
}
