/**
 * Pure reducer for the bar's view of a session. Built from a `session.state` replay plus the
 * incremental port messages. No DOM, no chrome.* — unit-tested against message sequences.
 *
 * Assumptions about the worker (see protocol.ts):
 * - `session.state` is authoritative and replaces everything.
 * - Run-tagged messages for a run other than the current one are stale and ignored
 *   (`run.started` is what makes a run current).
 * - `run.end.usage` is the usage of that run; it is added to the session total.
 */
import type { SwToUiMessage } from '../../shared/protocol';
import type {
  ErrorInfo,
  ErrorItem,
  SessionState,
  Settings,
  ToolItem,
  TranscriptItem,
  Usage,
} from '../../shared/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface UiState {
  connection: ConnectionStatus;
  /** Null until the first `session.state` arrives. */
  session: SessionState | null;
  /** Usage of the last finished run, for the footer. */
  lastRunUsage: Usage | null;
  /** Latest settings pushed by the worker (`settings.changed`), if any. */
  settings: Settings | null;
  /** Bumped on every run error / abort so the view can flash the bar. */
  flash: number;
  /** The model is reasoning (`assistant.thinking`) and has not produced output since. */
  thinking: boolean;
  /** The session's tab was closed (`run.error` with code `no-tab`): nothing more can run here. */
  tabClosed: boolean;
}

export type UiAction =
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'port'; message: SwToUiMessage }
  /** A local error (e.g. connection failure) shown in the transcript. */
  | { type: 'local-error'; error: ErrorInfo; id: string; at: number }
  | { type: 'settings'; settings: Settings };

export const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

export function initialUiState(): UiState {
  return { connection: 'connecting', session: null, lastRunUsage: null, settings: null, flash: 0, thinking: false, tabClosed: false };
}

export function emptySession(tabId = -1): SessionState {
  return {
    tabId,
    status: 'idle',
    runId: null,
    items: [],
    messages: [],
    pendingConfirm: null,
    alwaysAllow: [],
    usage: { ...EMPTY_USAGE },
    updatedAt: 0,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  const cost = a.cost === undefined && b.cost === undefined ? undefined : (a.cost ?? 0) + (b.cost ?? 0);
  const sum: Usage = {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
  if (cost !== undefined) sum.cost = cost;
  return sum;
}

function replaceItem(items: TranscriptItem[], id: string, update: (item: TranscriptItem) => TranscriptItem): TranscriptItem[] {
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return items;
  const next = items.slice();
  next[index] = update(items[index] as TranscriptItem);
  return next;
}

function upsertItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const index = items.findIndex((i) => i.id === item.id);
  if (index < 0) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'connection':
      return state.connection === action.status ? state : { ...state, connection: action.status };
    case 'settings':
      return { ...state, settings: action.settings };
    case 'local-error': {
      const session = state.session ?? emptySession();
      const item: ErrorItem = { kind: 'error', id: action.id, error: action.error, at: action.at };
      return { ...state, session: { ...session, items: [...session.items, item] }, flash: state.flash + 1 };
    }
    case 'port':
      return reducePort(state, action.message);
  }
}

function reducePort(state: UiState, msg: SwToUiMessage): UiState {
  const next = reducePortMessage(state, msg);
  // "Thinking" lasts until the model produces anything (or the run ends).
  if (msg.type === 'assistant.thinking') return next;
  return next.thinking ? { ...next, thinking: false } : next;
}

function reducePortMessage(state: UiState, msg: SwToUiMessage): UiState {
  if (msg.type === 'session.state') {
    return { ...state, session: msg.state };
  }
  if (msg.type === 'settings.changed') {
    return { ...state, settings: msg.settings };
  }

  const session = state.session ?? emptySession();
  const now = Date.now();

  if (msg.type === 'run.started') {
    return {
      ...state,
      session: {
        ...session,
        status: 'running',
        runId: msg.runId,
        pendingConfirm: null,
        items: upsertItem(session.items, msg.item),
        updatedAt: now,
      },
    };
  }

  if (msg.type === 'run.error') {
    const item: ErrorItem = { kind: 'error', id: `err-${msg.runId ?? 'x'}-${state.flash + 1}`, error: msg.error, at: now };
    const isCurrent = msg.runId !== null && msg.runId === session.runId;
    if (msg.runId !== null && !isCurrent) return state;
    const tabClosed = state.tabClosed || msg.error.code === 'no-tab';
    // A rejected request (runId null, e.g. `busy`) does not end the current run.
    const ended = isCurrent ? { status: 'idle' as const, runId: null, pendingConfirm: null } : {};
    return {
      ...state,
      session: { ...session, ...ended, items: [...session.items, item], updatedAt: now },
      flash: state.flash + 1,
      tabClosed,
    };
  }

  // Everything below is tagged with a run; ignore stale runs.
  if (msg.runId !== session.runId) return state;

  switch (msg.type) {
    case 'assistant.thinking':
      return state.thinking ? state : { ...state, thinking: true };
    case 'assistant.delta': {
      const existing = session.items.find((i) => i.id === msg.itemId);
      const items =
        existing && existing.kind === 'assistant'
          ? replaceItem(session.items, msg.itemId, (i) => (i.kind === 'assistant' ? { ...i, text: i.text + msg.text } : i))
          : [...session.items, { kind: 'assistant' as const, id: msg.itemId, text: msg.text, at: now }];
      return { ...state, session: { ...session, items, updatedAt: now } };
    }
    case 'tool.start':
      return {
        ...state,
        session: { ...session, items: upsertItem(session.items, msg.item), updatedAt: now },
      };
    case 'tool.update':
      return {
        ...state,
        session: {
          ...session,
          items: replaceItem(session.items, msg.itemId, (i) => (i.kind === 'tool' ? { ...i, status: msg.status } : i)),
          updatedAt: now,
        },
      };
    case 'tool.end':
      return {
        ...state,
        session: {
          ...session,
          items: replaceItem(session.items, msg.itemId, (i): ToolItem | TranscriptItem =>
            i.kind === 'tool' ? { ...i, status: msg.status, result: msg.result } : i,
          ),
          updatedAt: now,
        },
      };
    case 'confirm.request':
      return {
        ...state,
        session: { ...session, status: 'awaiting-confirm', pendingConfirm: msg.request, updatedAt: now },
      };
    case 'confirm.resolved': {
      if (session.pendingConfirm?.id !== msg.id) return state;
      return {
        ...state,
        session: { ...session, status: 'running', pendingConfirm: null, updatedAt: now },
      };
    }
    case 'run.end': {
      // Tools still marked running/pending when the run ends were cut off.
      const items =
        msg.reason === 'aborted'
          ? session.items.map((i) =>
              i.kind === 'tool' && (i.status === 'running' || i.status === 'pending-confirm')
                ? { ...i, status: 'aborted' as const }
                : i,
            )
          : session.items;
      return {
        ...state,
        session: {
          ...session,
          status: 'idle',
          runId: null,
          pendingConfirm: null,
          items,
          usage: addUsage(session.usage, msg.usage),
          updatedAt: now,
        },
        lastRunUsage: msg.usage,
        flash: msg.reason === 'aborted' ? state.flash + 1 : state.flash,
      };
    }
  }
}

/** Minimal observable store around the reducer. */
export interface Store {
  get(): UiState;
  dispatch(action: UiAction): void;
  subscribe(listener: (state: UiState, prev: UiState) => void): () => void;
}

export function createStore(initial: UiState = initialUiState()): Store {
  let state = initial;
  const listeners = new Set<(state: UiState, prev: UiState) => void>();
  return {
    get: () => state,
    dispatch(action) {
      const prev = state;
      state = uiReducer(state, action);
      if (state !== prev) for (const l of listeners) l(state, prev);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Is a run in progress (keepalive + Stop button)? */
export function isRunActive(state: UiState): boolean {
  return state.session !== null && state.session.status !== 'idle';
}
