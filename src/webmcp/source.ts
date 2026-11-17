/**
 * The WebMCP `ToolSource`: tools the page in a tab offers through `document.modelContext`.
 *
 * - `listTools(tab)` injects `listPageTools` into the tab's top frame (MAIN world) and validates
 *   the answer (`sanitize.ts`). The list is read fresh every time (the source is `dynamic`, so the
 *   agent loop re-lists it before every step: pages register and unregister tools at any time).
 *   The document id and origin of the listing are remembered per tab.
 * - Every listed tool carries `ToolSpec.binding` = the id of the document it was listed from.
 *   `callTool` runs the page's tool with `callPageTool`, targeted at exactly that document (from
 *   `ToolCallContext.binding`): a call never reaches a document the model did not see the tool
 *   in, even when the tab was listed again meanwhile (the bar's chip, the settings' tool list) or
 *   navigated within the same site; the call then fails and the model gets the new list next step.
 *   With a timeout; aborting the run aborts the call in the page.
 * - Every page tool is `pageTool` + `mutates`: confirmed on every call while confirmations are
 *   on, whatever the page claims (`readOnlyHint`), with "Always allow" per tool and origin.
 *
 * Off (`Settings.webmcp === false`): lists nothing, calls nothing.
 */
import { createLogger } from '../shared/logger';
import { CcError, type Settings, type TabContext, type ToolArgs, type ToolCallContext, type ToolResult, type ToolSource, type ToolSpec, type WebMcpStatus } from '../shared/types';
import { abortPageCall, callPageTool, listPageTools, type PageListLimits } from './page-functions';
import { WEBMCP_LIMITS, mapPageResult, modelDescription, parsePageToolList, type PageTool, type WebMcpLimits } from './sanitize';

const log = createLogger('webmcp');

export const WEBMCP_SOURCE_ID = 'webmcp';
export const DEFAULT_LIST_TIMEOUT_MS = 3_000;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;

/** The slice of `chrome.scripting` this source needs (faked in tests). */
export interface WebMcpScripting {
  executeScript(injection: {
    target: { tabId: number; frameIds?: number[]; documentIds?: string[] };
    world: 'MAIN';
    func: (...args: never[]) => unknown;
    args: unknown[];
  }): Promise<{ frameId: number; documentId?: string; result?: unknown }[]>;
}

export interface WebMcpSourceDeps {
  settings: { get(): Promise<Settings> };
  scripting?: WebMcpScripting;
  listTimeoutMs?: number;
  callTimeoutMs?: number;
  limits?: WebMcpLimits;
  newId?: () => string;
}

export interface WebMcpSource extends ToolSource {
  /** For the bar's chip. */
  status(tab: TabContext): Promise<WebMcpStatus>;
  /** Forget what was listed for a closed tab. */
  onTabRemoved(tabId: number): void;
}

interface TabEntry {
  tabId: number;
  documentId: string | undefined;
  origin: string;
  host: string;
  byExposed: Map<string, PageTool>;
}

const chromeScripting = (): WebMcpScripting => ({
  executeScript: (injection) =>
    chrome.scripting.executeScript(injection as unknown as chrome.scripting.ScriptInjection<unknown[], unknown>),
});

function isScriptableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Resolves with the promise's value, or `onTimeout()` after `ms`; rejects with `CcError('aborted')` on abort. */
function settleWithin<T>(promise: Promise<T>, ms: number, onTimeout: () => T, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const timer = setTimeout(() => finish(() => resolve(onTimeout())), ms);
    const onAbort = (): void => finish(() => reject(new CcError('aborted', 'Aborted')));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => finish(() => resolve(v)),
      (err: unknown) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

export function createWebMcpSource(deps: WebMcpSourceDeps): WebMcpSource {
  const limits = deps.limits ?? { ...WEBMCP_LIMITS };
  const listTimeout = deps.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
  const callTimeout = deps.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let scripting: WebMcpScripting | null = deps.scripting ?? null;
  const getScripting = (): WebMcpScripting => (scripting ??= chromeScripting());
  const tabs = new Map<number, TabEntry>();
  /** Listings by document id (what `ToolSpec.binding` points at), oldest first, capped. */
  const docs = new Map<string, TabEntry>();
  const MAX_DOCS = 64;
  const remember = (entry: TabEntry): void => {
    if (!entry.documentId) return;
    docs.delete(entry.documentId);
    docs.set(entry.documentId, entry);
    while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value as string);
  };

  const pageLimits: PageListLimits = {
    maxScan: limits.maxScan,
    maxNameChars: limits.maxNameChars,
    maxTitleChars: limits.maxTitleChars,
    maxDescriptionChars: limits.maxDescriptionChars,
    maxSchemaChars: limits.maxSchemaChars,
  };

  const enabled = async (): Promise<boolean> => (await deps.settings.get()).webmcp === true;

  /** Read and validate the tab's page tools; remembers them for calls. Null when there are none to use. */
  async function load(tab: TabContext): Promise<TabEntry | null> {
    if (!isScriptableUrl(tab.url)) {
      tabs.delete(tab.tabId);
      return null;
    }
    let results: Awaited<ReturnType<WebMcpScripting['executeScript']>>;
    try {
      results = await settleWithin(
        getScripting().executeScript({ target: { tabId: tab.tabId, frameIds: [0] }, world: 'MAIN', func: listPageTools, args: [pageLimits] }),
        listTimeout,
        () => {
          log.debug(`Tab ${tab.tabId}: the page did not answer within ${listTimeout} ms`);
          return [];
        },
      );
    } catch (err) {
      log.debug(`Tab ${tab.tabId}: cannot read page tools`, err);
      tabs.delete(tab.tabId);
      return null;
    }
    const first = results.find((r) => r.frameId === 0) ?? results[0];
    const list = parsePageToolList(first?.result, limits);
    if (!list.origin || list.tools.length === 0) {
      tabs.delete(tab.tabId);
      return null;
    }
    if (list.dropped > 0) log.debug(`Tab ${tab.tabId}: ${list.dropped} page tool(s) dropped (invalid, too large or over the limits)`);
    const entry: TabEntry = {
      tabId: tab.tabId,
      documentId: typeof first?.documentId === 'string' ? first.documentId : undefined,
      origin: list.origin,
      host: new URL(list.origin).host,
      byExposed: new Map(list.tools.map((t) => [t.exposedName, t])),
    };
    tabs.set(tab.tabId, entry);
    remember(entry);
    return entry;
  }

  const toSpec = (tool: PageTool, entry: TabEntry): ToolSpec => ({
    name: tool.exposedName,
    description: modelDescription(tool, entry.host),
    parameters: tool.inputSchema,
    mutates: true,
    pageTool: true,
    sourceLabel: `Page: ${entry.host}`,
    ...(entry.documentId ? { binding: entry.documentId } : {}),
  });

  async function listTools(tab: TabContext): Promise<ToolSpec[]> {
    if (!(await enabled())) {
      tabs.delete(tab.tabId);
      return [];
    }
    const entry = await load(tab);
    return entry ? [...entry.byExposed.values()].map((t) => toSpec(t, entry)) : [];
  }

  async function callTool(name: string, args: ToolArgs, ctx: ToolCallContext): Promise<ToolResult> {
    if (!(await enabled())) return { ok: false, content: 'Page tools (WebMCP) are turned off in the settings.' };
    if (ctx.signal.aborted) throw new CcError('aborted', 'Aborted');
    const tabId = ctx.tab.tabId;
    let entry: TabEntry | undefined;
    if (ctx.binding !== undefined) {
      // Exactly the document the model saw the tool in; nothing else (not the tab's latest listing).
      entry = docs.get(ctx.binding);
      if (!entry || entry.tabId !== tabId) {
        return { ok: false, content: `The page changed after its tools were listed, so "${name}" was not run. Look at the current page first.` };
      }
    } else {
      entry = tabs.get(tabId);
      if (!entry?.byExposed.has(name)) entry = (await load(ctx.tab)) ?? undefined; // no listing known (e.g. a worker restart)
    }
    const tool = entry?.byExposed.get(name);
    if (!entry || !tool) {
      return { ok: false, content: `The page no longer offers the tool "${name}" (it was removed or the page changed). Use the page's current tools.` };
    }
    // The tool was listed for the page the loop saw; never run it on another site's page.
    const expected = originOf(ctx.tab.url);
    if (expected && expected !== entry.origin) {
      return mapPageResult({ kind: 'moved' }, name, limits);
    }
    const callId = newId();
    const target = entry.documentId ? { tabId, documentIds: [entry.documentId] } : { tabId, frameIds: [0] };
    const abortInPage = (): void => {
      void getScripting()
        .executeScript({ target, world: 'MAIN', func: abortPageCall, args: [callId] })
        .catch(() => undefined);
    };
    const timedOut = Symbol('timeout');
    let results: Awaited<ReturnType<WebMcpScripting['executeScript']>> | typeof timedOut;
    try {
      results = await settleWithin<Awaited<ReturnType<WebMcpScripting['executeScript']>> | typeof timedOut>(
        getScripting().executeScript({
          target,
          world: 'MAIN',
          func: callPageTool,
          args: [tool.name, args, entry.origin, callId, limits.maxResultChars],
        }),
        callTimeout,
        () => timedOut,
        ctx.signal,
      );
    } catch (err) {
      if (ctx.signal.aborted || (err instanceof CcError && err.code === 'aborted')) {
        abortInPage();
        throw err instanceof CcError ? err : new CcError('aborted', 'Aborted', { cause: err });
      }
      const message = err instanceof Error ? err.message : String(err);
      tabs.delete(tabId);
      if (/No document|document.*removed|Frame .* removed|navigat|No tab with id/i.test(message)) {
        return { ok: false, content: `The page navigated or reloaded before "${name}" could run, so it did not run. Look at the current page first.` };
      }
      return { ok: false, content: `Could not run the page's tool "${name}": ${message}` };
    }
    if (results === timedOut) {
      abortInPage();
      const limit = callTimeout >= 1000 ? `${Math.round(callTimeout / 1000)} s` : `${callTimeout} ms`;
      return { ok: false, content: `The page's tool "${name}" did not answer within ${limit} and was cancelled.` };
    }
    const first = results.find((r) => r.frameId === 0) ?? results[0];
    return mapPageResult(first?.result, name, limits);
  }

  return {
    id: WEBMCP_SOURCE_ID,
    label: 'Page (WebMCP)',
    dynamic: true,
    listTools,
    callTool,
    async status(tab) {
      if (!(await enabled())) return { enabled: false, count: 0 };
      const entry = await load(tab);
      return entry ? { enabled: true, count: entry.byExposed.size, host: entry.host } : { enabled: true, count: 0 };
    },
    onTabRemoved(tabId) {
      tabs.delete(tabId);
      for (const [id, entry] of docs) if (entry.tabId === tabId) docs.delete(id);
    },
  };
}
