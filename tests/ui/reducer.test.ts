import { describe, expect, it } from 'vitest';
import type { SwToUiMessage } from '../../src/shared/protocol';
import type { SessionState, Settings, ToolItem } from '../../src/shared/types';
import { createStore, emptySession, initialUiState, isRunActive, uiReducer, type UiState } from '../../src/ui/state/reducer';

const usage = (p: number, c: number, cost?: number) => ({ promptTokens: p, completionTokens: c, totalTokens: p + c, ...(cost === undefined ? {} : { cost }) });

function play(messages: SwToUiMessage[], start: UiState = initialUiState()): UiState {
  return messages.reduce((s, message) => uiReducer(s, { type: 'port', message }), start);
}

function session(overrides: Partial<SessionState> = {}): SessionState {
  return { ...emptySession(7), ...overrides };
}

const tool = (status: ToolItem['status'] = 'running'): ToolItem => ({
  kind: 'tool',
  id: 'call-1',
  name: 'click',
  args: { selector: '#a' },
  sourceLabel: 'Built-in',
  status,
  at: 1,
});

describe('uiReducer', () => {
  it('replays session.state wholesale', () => {
    const state = play([{ type: 'session.state', state: session({ items: [{ kind: 'user', id: 'u1', text: 'hi', at: 1 }] }) }]);
    expect(state.session?.items).toHaveLength(1);
    const replaced = play([{ type: 'session.state', state: session() }], state);
    expect(replaced.session?.items).toHaveLength(0);
  });

  it('streams deltas into one assistant item and ends the run with usage', () => {
    const s = play([
      { type: 'session.state', state: session({ usage: usage(10, 5, 0.01) }) },
      { type: 'run.started', runId: 'r1', item: { kind: 'user', id: 'u1', text: 'hello', at: 1 } },
      { type: 'assistant.delta', runId: 'r1', itemId: 'a1', text: 'Hel' },
      { type: 'assistant.delta', runId: 'r1', itemId: 'a1', text: 'lo **world**' },
    ]);
    expect(s.session?.status).toBe('running');
    expect(isRunActive(s)).toBe(true);
    expect(s.session?.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
    expect(s.session?.items[1]).toMatchObject({ kind: 'assistant', text: 'Hello **world**' });

    const end = play([{ type: 'run.end', runId: 'r1', reason: 'complete', usage: usage(100, 20, 0.02) }], s);
    expect(end.session?.status).toBe('idle');
    expect(end.session?.runId).toBeNull();
    expect(end.session?.usage).toEqual({ promptTokens: 110, completionTokens: 25, totalTokens: 135, cost: 0.03 });
    expect(end.lastRunUsage).toEqual(usage(100, 20, 0.02));
    expect(isRunActive(end)).toBe(false);
  });

  it('ignores messages from a stale run', () => {
    const s = play([
      { type: 'session.state', state: session() },
      { type: 'run.started', runId: 'r2', item: { kind: 'user', id: 'u2', text: 'x', at: 1 } },
      { type: 'assistant.delta', runId: 'r1', itemId: 'old', text: 'stale' },
      { type: 'run.end', runId: 'r1', reason: 'complete', usage: usage(1, 1) },
    ]);
    expect(s.session?.items).toHaveLength(1);
    expect(s.session?.status).toBe('running');
  });

  it('tracks the tool lifecycle with confirmation', () => {
    const s = play([
      { type: 'session.state', state: session() },
      { type: 'run.started', runId: 'r1', item: { kind: 'user', id: 'u1', text: 'click it', at: 1 } },
      { type: 'tool.start', runId: 'r1', item: tool('pending-confirm') },
      {
        type: 'confirm.request',
        runId: 'r1',
        request: { id: 'c1', toolCallId: 'call-1', toolName: 'click', args: { selector: '#a' }, sourceLabel: 'Built-in' },
      },
    ]);
    expect(s.session?.status).toBe('awaiting-confirm');
    expect(s.session?.pendingConfirm?.id).toBe('c1');

    const unrelated = play([{ type: 'confirm.resolved', runId: 'r1', id: 'other', allow: true }], s);
    expect(unrelated).toBe(s);

    const allowed = play(
      [
        { type: 'confirm.resolved', runId: 'r1', id: 'c1', allow: true },
        { type: 'tool.update', runId: 'r1', itemId: 'call-1', status: 'running' },
      ],
      s,
    );
    expect(allowed.session?.pendingConfirm).toBeNull();
    expect(allowed.session?.status).toBe('running');
    expect(allowed.session?.items[1]).toMatchObject({ kind: 'tool', status: 'running' });

    const done = play([{ type: 'tool.end', runId: 'r1', itemId: 'call-1', status: 'ok', result: { ok: true, content: 'clicked' } }], allowed);
    expect(done.session?.items[1]).toMatchObject({ kind: 'tool', status: 'ok', result: { ok: true, content: 'clicked' } });
  });

  it('marks unfinished tools aborted and flashes on abort', () => {
    const s = play([
      { type: 'session.state', state: session() },
      { type: 'run.started', runId: 'r1', item: { kind: 'user', id: 'u1', text: 'x', at: 1 } },
      { type: 'tool.start', runId: 'r1', item: tool('running') },
      { type: 'run.end', runId: 'r1', reason: 'aborted', usage: usage(0, 0) },
    ]);
    expect(s.session?.items[1]).toMatchObject({ status: 'aborted' });
    expect(s.flash).toBe(1);
  });

  it('records run errors and ends the current run', () => {
    const s = play([
      { type: 'session.state', state: session() },
      { type: 'run.started', runId: 'r1', item: { kind: 'user', id: 'u1', text: 'x', at: 1 } },
      { type: 'run.error', runId: 'r1', error: { code: 'no-key', message: 'Missing key' } },
    ]);
    expect(s.session?.status).toBe('idle');
    expect(s.session?.items.at(-1)).toMatchObject({ kind: 'error', error: { code: 'no-key' } });
    expect(s.flash).toBe(1);
  });

  it('shows a rejected request (runId null) without ending the active run', () => {
    const s = play([
      { type: 'session.state', state: session() },
      { type: 'run.started', runId: 'r1', item: { kind: 'user', id: 'u1', text: 'x', at: 1 } },
      { type: 'run.error', runId: null, error: { code: 'busy', message: 'busy' } },
    ]);
    expect(s.session?.status).toBe('running');
    expect(s.session?.items.at(-1)).toMatchObject({ kind: 'error', error: { code: 'busy' } });
  });

  it('ignores errors of stale runs', () => {
    const before = play([{ type: 'session.state', state: session() }]);
    const after = play([{ type: 'run.error', runId: 'old', error: { code: 'unknown', message: 'x' } }], before);
    expect(after).toBe(before);
  });

  it('recovers after a reconnect: the replay replaces the partial local view', () => {
    // Streaming, then the worker restarts (port drops) and the replay arrives.
    let s = play([
      { type: 'session.state', state: session() },
      { type: 'run.started', runId: 'r1', item: { kind: 'user', id: 'u1', text: 'x', at: 1 } },
      { type: 'assistant.delta', runId: 'r1', itemId: 'a1', text: 'partial' },
    ]);
    s = uiReducer(s, { type: 'connection', status: 'disconnected' });
    expect(s.connection).toBe('disconnected');
    s = uiReducer(s, { type: 'connection', status: 'connected' });
    s = play(
      [
        {
          type: 'session.state',
          state: session({
            status: 'running',
            runId: 'r1',
            items: [
              { kind: 'user', id: 'u1', text: 'x', at: 1 },
              { kind: 'assistant', id: 'a1', text: 'partial and more', at: 2 },
            ],
          }),
        },
        { type: 'assistant.delta', runId: 'r1', itemId: 'a1', text: '!' },
      ],
      s,
    );
    expect(s.session?.items[1]).toMatchObject({ text: 'partial and more!' });
    expect(s.connection).toBe('connected');
  });

  it('keeps settings from settings.changed', () => {
    const settings = { version: 1 } as unknown as Settings;
    const s = play([{ type: 'settings.changed', settings }]);
    expect(s.settings).toBe(settings);
  });

  it('store notifies subscribers only on change', () => {
    const store = createStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: 'connection', status: 'connecting' }); // unchanged
    store.dispatch({ type: 'connection', status: 'connected' });
    expect(calls).toBe(1);
    expect(store.get().connection).toBe('connected');
  });

  it('shows "thinking" until the model produces output, and only for the current run', () => {
    const started: SwToUiMessage[] = [
      { type: 'session.state', state: session() },
      { type: 'run.started', runId: 'r1', item: { kind: 'user', id: 'u', text: 'hi', at: 1 } },
    ];
    let s = play([...started, { type: 'assistant.thinking', runId: 'r1' }]);
    expect(s.thinking).toBe(true);
    s = play([{ type: 'assistant.delta', runId: 'r1', itemId: 'a', text: 'x' }], s);
    expect(s.thinking).toBe(false);
    expect(play([...started, { type: 'assistant.thinking', runId: 'old' }]).thinking).toBe(false);
    s = play([...started, { type: 'assistant.thinking', runId: 'r1' }, { type: 'run.end', runId: 'r1', reason: 'complete', usage: usage(1, 1) }]);
    expect(s.thinking).toBe(false);
  });
});
