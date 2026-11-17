/**
 * Runs a page tool's `run` in a tab with `chrome.scripting.executeScript`: top frame only,
 * ISOLATED world for `page`, MAIN world for `page-main`, model args passed as the single argument.
 *
 * Failures the model can act on (page cannot be scripted, tab gone, page navigated, timeout,
 * bad result) are thrown as `CcError` with a plain-English message; the registry turns them into
 * `{ ok: false }` results. Abort throws `CcError('aborted')`.
 *
 * Note on timeouts: an injected script cannot be cancelled. On timeout / abort we stop waiting
 * and report; the function may still finish in the page (its result is then discarded).
 */
import { CcError, type PageToolDefinition, type ToolArgs, type ToolCallContext, type ToolResult } from '../shared/types';
import { chromeToolDeps, type ScriptingLike, type TabLike, type TabsLike } from './deps';

export const DEFAULT_PAGE_TIMEOUT_MS = 20_000;

export interface PageExecOptions {
  /** Overrides the executor's default timeout for this call. */
  timeoutMs?: number;
}

/** The parts of a page tool the executor needs (so background tools can inject helpers too). */
export type InjectablePageTool = Pick<PageToolDefinition, 'name' | 'context' | 'run'>;

export interface PageExecutor {
  run(tool: InjectablePageTool, args: ToolArgs, ctx: ToolCallContext, options?: PageExecOptions): Promise<ToolResult>;
}

/**
 * Why a URL cannot be scripted, or null if it probably can. (Chrome has the final word; its
 * errors are mapped by `explainInjectionError` too.)
 */
export function unscriptableReason(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return `The tab has no usable URL (${rawUrl || 'empty'}).`;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (url.hostname === 'chromewebstore.google.com' || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))) {
      return 'The Chrome Web Store cannot be scripted by extensions. Page tools do not work here.';
    }
    return null;
  }
  if (url.protocol === 'file:') return null; // works only if "Allow access to file URLs" is on; mapped below
  return `Chrome does not let extensions script ${url.protocol}// pages (browser-internal page). Page tools do not work here; navigate to a normal web page first.`;
}

const isPdfUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
};

/** Map a Chrome injection error to a message the model can act on. */
export function explainInjectionError(message: string, url: string): string {
  if (/No tab with id/i.test(message)) return 'The tab was closed.';
  if (/Frame with ID 0 is showing error page/i.test(message)) {
    return 'The tab is showing a browser error page (the site failed to load). Try reload or navigate.';
  }
  if (/Frame with ID 0 was removed|document was removed|navigat/i.test(message)) {
    return 'The page navigated or reloaded while the tool was running. Inspect the new page before retrying.';
  }
  if (/extensions gallery cannot be scripted/i.test(message)) return 'The Chrome Web Store cannot be scripted by extensions.';
  if (/Cannot access a (chrome|chrome-extension|devtools|edge)[^ ]* URL/i.test(message)) {
    return 'Chrome does not let extensions script browser-internal pages. Navigate to a normal web page first.';
  }
  if (/Cannot access contents of/i.test(message)) {
    if (isPdfUrl(url)) {
      return "This tab shows Chrome's PDF viewer, which extensions cannot script. Use screenshot to see it, or ask the user to copy the text.";
    }
    if (url.startsWith('file:')) {
      return 'Extensions cannot read local files unless "Allow access to file URLs" is enabled for CarbonCommander in chrome://extensions.';
    }
    return 'The extension has no access to this page (it may be blocked by browser policy or still loading).';
  }
  return `Could not run the tool in the page: ${message}`;
}

const sameDocumentUrl = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? '').split('#')[0] === (b ?? '').split('#')[0];

function isToolResult(v: unknown): v is ToolResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ToolResult).ok === 'boolean' &&
    typeof (v as ToolResult).content === 'string'
  );
}

const abortError = (): CcError => new CcError('aborted', 'Aborted');

export function createPageExecutor(
  deps: { scripting: ScriptingLike; tabs: TabsLike },
  defaults: { timeoutMs?: number } = {},
): PageExecutor {
  const defaultTimeout = defaults.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;

  async function getTab(tabId: number): Promise<TabLike> {
    try {
      return await deps.tabs.get(tabId);
    } catch {
      throw new CcError('no-tab', 'The tab was closed.');
    }
  }

  /** After a failure: did the tab move to another document? */
  async function navigatedAway(tabId: number, before: string): Promise<boolean> {
    try {
      const now = await deps.tabs.get(tabId);
      return !sameDocumentUrl(now.url ?? now.pendingUrl, before) || now.status === 'loading';
    } catch {
      return false;
    }
  }

  return {
    async run(tool, args, ctx, options = {}) {
      if (ctx.signal.aborted) throw abortError();
      const tabId = ctx.tab.tabId;
      const tab = await getTab(tabId);
      if (tab.discarded) {
        throw new CcError('no-tab', 'The tab is discarded (unloaded to save memory). Reload it first.');
      }
      const url = tab.url ?? tab.pendingUrl ?? '';
      const reason = unscriptableReason(url);
      if (reason) throw new CcError('no-tab', reason);

      const timeoutMs = options.timeoutMs ?? defaultTimeout;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new CcError(
                'unknown',
                `${tool.name} timed out after ${Math.round(timeoutMs / 1000)}s in the page (the page may be busy or frozen).`,
              ),
            ),
          timeoutMs,
        );
        onAbort = () => reject(abortError());
        if (ctx.signal.aborted) onAbort();
        else ctx.signal.addEventListener('abort', onAbort, { once: true });
      });

      let results: { frameId: number; result?: unknown }[];
      try {
        results = await Promise.race([
          deps.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            world: tool.context === 'page-main' ? 'MAIN' : 'ISOLATED',
            func: tool.run,
            args: [args],
          }),
          stop,
        ]);
      } catch (err) {
        if (err instanceof CcError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        if (await navigatedAway(tabId, url)) {
          throw new CcError('no-tab', 'The page navigated or reloaded while the tool was running. Inspect the new page before retrying.');
        }
        throw new CcError('no-tab', explainInjectionError(message, url));
      } finally {
        clearTimeout(timer);
        if (onAbort) ctx.signal.removeEventListener('abort', onAbort);
      }

      const result = results[0]?.result;
      if (isToolResult(result)) return result;
      if (await navigatedAway(tabId, url)) {
        throw new CcError('no-tab', 'The page navigated or reloaded while the tool was running. Inspect the new page before retrying.');
      }
      if (result === undefined || result === null) {
        throw new CcError(
          'invalid',
          `${tool.name} returned no result from the page (it threw, returned a non-serialisable value, or the page unloaded).`,
        );
      }
      throw new CcError('invalid', `${tool.name} returned an invalid result from the page (expected { ok, content }).`);
    },
  };
}

let defaultExecutor: PageExecutor | undefined;

/** Run `tool` with the real `chrome.scripting` (default timeout). */
export function executePageTool(tool: PageToolDefinition, args: ToolArgs, ctx: ToolCallContext): Promise<ToolResult> {
  defaultExecutor ??= createPageExecutor(chromeToolDeps());
  return defaultExecutor.run(tool, args, ctx);
}
