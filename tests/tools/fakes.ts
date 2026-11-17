/** Fakes for `ToolDeps` used by the tools tests. */
import { vi } from 'vitest';
import type { ScriptingLike, TabLike, TabsLike, TabUpdatedListener, ToolDeps } from '../../src/tools/deps';
import type { TabContext, ToolCallContext } from '../../src/shared/types';

export function tabContext(url = 'https://example.com/page', tabId = 7): TabContext {
  return { tabId, windowId: 1, url, title: 'Example' };
}

export function callContext(url?: string, signal: AbortSignal = new AbortController().signal): ToolCallContext {
  return { tab: tabContext(url), signal, toolCallId: 'call_1' };
}

export interface FakeTabs extends TabsLike {
  tabs: Map<number, TabLike>;
  listeners: Set<TabUpdatedListener>;
  /** Fire `onUpdated` for a tab. */
  emit(tabId: number, info: { status?: string; url?: string }): void;
}

export function fakeTabs(initial: TabLike[] = [{ id: 7, windowId: 1, url: 'https://example.com/page', title: 'Example', active: true, status: 'complete', index: 0 }]): FakeTabs {
  const tabs = new Map(initial.map((t) => [t.id ?? 0, { ...t }]));
  const listeners = new Set<TabUpdatedListener>();
  const get = (id: number): Promise<TabLike> => {
    const t = tabs.get(id);
    return t ? Promise.resolve({ ...t }) : Promise.reject(new Error(`No tab with id: ${id}.`));
  };
  const fake: FakeTabs = {
    tabs,
    listeners,
    emit(tabId, info) {
      const t = tabs.get(tabId);
      if (!t) return;
      Object.assign(t, info.url ? { url: info.url } : {}, info.status ? { status: info.status } : {});
      for (const l of listeners) l(tabId, info, { ...t });
    },
    get,
    query: vi.fn(async (q: { windowId?: number }) => [...tabs.values()].filter((t) => q.windowId === undefined || t.windowId === q.windowId)),
    update: vi.fn(async (id: number, props: { url?: string; active?: boolean }) => {
      const t = tabs.get(id);
      if (!t) throw new Error(`No tab with id: ${id}.`);
      if (props.url) {
        // Simulate a navigation that completes asynchronously.
        setTimeout(() => {
          fake.emit(id, { status: 'loading', url: props.url });
          fake.emit(id, { status: 'complete' });
        }, 5);
      }
      if (props.active) t.active = true;
      return { ...t };
    }),
    create: vi.fn(async (props: Parameters<TabsLike['create']>[0]) => {
      const id = Math.max(...tabs.keys()) + 1;
      const t: TabLike = { id, windowId: props.windowId ?? 1, url: props.url, active: props.active ?? true, index: props.index ?? 0 };
      tabs.set(id, t);
      return { ...t };
    }),
    goBack: vi.fn(async () => {
      throw new Error('Cannot find a next page in history.');
    }),
    goForward: vi.fn(async () => undefined),
    reload: vi.fn(async (id: number) => {
      setTimeout(() => fake.emit(id, { status: 'complete' }), 5);
    }),
    captureVisibleTab: vi.fn(async () => 'data:image/jpeg;base64,QUJD'),
    onUpdated: {
      addListener: (l) => listeners.add(l),
      removeListener: (l) => listeners.delete(l),
    },
  };
  return fake;
}

export function fakeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps & { tabs: FakeTabs } {
  const scripting: ScriptingLike = { executeScript: vi.fn(async () => [{ frameId: 0, result: { ok: true, content: 'page ok' } }]) };
  return {
    scripting,
    tabs: fakeTabs(),
    windows: { update: vi.fn(async () => undefined) },
    fetch: vi.fn(async () => new Response('')),
    now: () => new Date('2026-01-02T03:04:05Z'),
    ...overrides,
  } as ToolDeps & { tabs: FakeTabs };
}
