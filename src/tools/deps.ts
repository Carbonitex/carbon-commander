/**
 * The slice of `chrome.*` (and `fetch`) the built-in tools use, behind small interfaces so the
 * registry, page executor and background tools can be unit-tested with fakes.
 *
 * `chromeToolDeps()` binds them to the real APIs lazily (nothing touches `chrome` until a tool
 * runs), so importing this module is safe outside an extension.
 */

/** The subset of `chrome.tabs.Tab` we read. */
export interface TabLike {
  id?: number;
  windowId: number;
  index?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  status?: string;
  active: boolean;
  discarded?: boolean;
  pinned?: boolean;
  audible?: boolean;
  incognito?: boolean;
}

export interface InjectionLike {
  target: { tabId: number; frameIds?: number[] };
  world: 'ISOLATED' | 'MAIN';
  func: (...args: never[]) => unknown;
  args: unknown[];
}

export interface ScriptingLike {
  executeScript(injection: InjectionLike): Promise<{ frameId: number; result?: unknown }[]>;
}

export type TabUpdatedListener = (tabId: number, changeInfo: { status?: string; url?: string }, tab: TabLike) => void;

export interface TabsLike {
  get(tabId: number): Promise<TabLike>;
  query(query: { windowId?: number }): Promise<TabLike[]>;
  update(tabId: number, props: { url?: string; active?: boolean }): Promise<TabLike | undefined>;
  create(props: { url: string; active?: boolean; windowId?: number; openerTabId?: number; index?: number }): Promise<TabLike>;
  goBack(tabId: number): Promise<void>;
  goForward(tabId: number): Promise<void>;
  reload(tabId: number, props?: { bypassCache?: boolean }): Promise<void>;
  captureVisibleTab(windowId: number, options: { format: 'jpeg' | 'png'; quality?: number }): Promise<string>;
  onUpdated: {
    addListener(listener: TabUpdatedListener): void;
    removeListener(listener: TabUpdatedListener): void;
  };
}

export interface WindowsLike {
  update(windowId: number, props: { focused?: boolean }): Promise<unknown>;
}

/** Our own in-page overlay (content script), hidden while a screenshot is taken. */
export interface OverlayLike {
  /** Hide the overlay (keeping its iframe alive); resolves true once the hidden state is painted. */
  suspend(tabId: number): Promise<boolean>;
  /** Show it again if it was open before `suspend`. */
  resume(tabId: number): Promise<void>;
}

export interface ToolDeps {
  scripting: ScriptingLike;
  /** Optional: absent in tests and hosts without an overlay. */
  overlay?: OverlayLike;
  tabs: TabsLike;
  windows: WindowsLike;
  fetch: typeof fetch;
  /** Clock, injectable for tests. */
  now(): Date;
}

/** Real implementations, resolved on each call (safe to create at module load). */
export function chromeToolDeps(): ToolDeps {
  return {
    scripting: {
      executeScript: (injection) =>
        chrome.scripting.executeScript(injection as unknown as chrome.scripting.ScriptInjection<unknown[], unknown>),
    },
    tabs: {
      get: (tabId) => chrome.tabs.get(tabId),
      query: (query) => chrome.tabs.query(query),
      update: (tabId, props) => chrome.tabs.update(tabId, props),
      create: (props) => chrome.tabs.create(props),
      goBack: (tabId) => chrome.tabs.goBack(tabId),
      goForward: (tabId) => chrome.tabs.goForward(tabId),
      reload: (tabId, props) => chrome.tabs.reload(tabId, props ?? {}),
      captureVisibleTab: (windowId, options) => chrome.tabs.captureVisibleTab(windowId, options),
      onUpdated: {
        addListener: (l) => chrome.tabs.onUpdated.addListener(l),
        removeListener: (l) => chrome.tabs.onUpdated.removeListener(l),
      },
    },
    windows: { update: (windowId, props) => chrome.windows.update(windowId, props) },
    overlay: {
      suspend: async (tabId) => {
        const reply: unknown = await chrome.tabs.sendMessage(tabId, { cc: 'overlay.suspend' }, { frameId: 0 });
        return typeof reply === 'object' && reply !== null && (reply as { ok?: unknown }).ok === true;
      },
      resume: async (tabId) => {
        await chrome.tabs.sendMessage(tabId, { cc: 'overlay.resume' }, { frameId: 0 });
      },
    },
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  };
}
