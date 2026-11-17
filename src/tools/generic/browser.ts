/**
 * Background (service-worker) tools for the browser: screenshot, navigation, waiting, tabs and
 * `fetch_url`. Built by a factory so `chrome.*` and `fetch` can be injected in tests.
 *
 * Page tools always act on the session's tab (`ctx.tab`). The tab tools are deliberately
 * conservative: list, open (in the background by default) and switch; no closing.
 */
import { CcError, type BackgroundToolDefinition, type ToolCallContext, type ToolResult } from '../../shared/types';
import { defineBackgroundTool } from '../define';
import type { TabLike, ToolDeps } from '../deps';
import { blockedHostReason, htmlToText, parseHttpUrl, readTextCapped, withTimeout } from '../net';
import type { PageExecutor } from '../page-exec';
import { waitInPage } from './page-actions';

const clamp = (v: unknown, def: number, min: number, max: number): number => {
  const n = Number(v ?? def);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CcError('aborted', 'Aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new CcError('aborted', 'Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Run `trigger` (a navigation) and wait for the tab's next `status: complete`. Resolves
 * `complete: false` on timeout (the navigation is still allowed to finish).
 */
export function navigateAndWait(
  deps: Pick<ToolDeps, 'tabs'>,
  tabId: number,
  trigger: () => Promise<unknown>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ complete: boolean; tab: TabLike }> {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = (): void => {
      done = true;
      clearTimeout(timer);
      deps.tabs.onUpdated.removeListener(listener);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (complete: boolean): void => {
      if (done) return;
      cleanup();
      deps.tabs.get(tabId).then(
        (tab) => resolve({ complete, tab }),
        () => reject(new CcError('no-tab', 'The tab was closed.')),
      );
    };
    const listener = (id: number, info: { status?: string }): void => {
      if (id === tabId && info.status === 'complete') finish(true);
    };
    const onAbort = (): void => {
      if (done) return;
      cleanup();
      reject(new CcError('aborted', 'Aborted'));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    deps.tabs.onUpdated.addListener(listener);
    trigger().catch((err: unknown) => {
      if (done) return;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

const loadedMessage = (verb: string, r: { complete: boolean; tab: TabLike }, timeoutMs: number): string =>
  r.complete
    ? `${verb}: ${r.tab.url ?? '(unknown URL)'} — "${r.tab.title ?? ''}". The page finished loading; earlier element refs are no longer valid.`
    : `${verb}; the page is still loading after ${Math.round(timeoutMs / 1000)}s (now at ${r.tab.url ?? r.tab.pendingUrl ?? 'unknown URL'}). Use wait or get_page_info before reading it.`;

/**
 * URL of a tab as `list_tabs` reports it: full for the session's own tab, without query string and
 * fragment for every other tab (those often carry tokens, and the model does not need them).
 */
export function listedTabUrl(t: TabLike, current: number): string {
  const raw = t.url ?? t.pendingUrl ?? '';
  if (t.id === current) return raw;
  try {
    const u = new URL(raw);
    if (u.search === '' && u.hash === '') return raw;
    u.search = '';
    u.hash = '';
    return `${u.href} [query/fragment hidden]`;
  } catch {
    return raw.split(/[?#]/)[0] ?? '';
  }
}

const tabLine = (t: TabLike, current: number): string =>
  `[tab ${t.id ?? '?'}]${t.id === current ? ' (this tab)' : ''}${t.active ? ' (active)' : ''}${t.pinned ? ' (pinned)' : ''}${t.discarded ? ' (unloaded)' : ''} ${t.title ?? ''} — ${listedTabUrl(t, current)}`;

export function createBrowserTools(deps: ToolDeps, pageExec: PageExecutor): BackgroundToolDefinition[] {
  const screenshot = defineBackgroundTool<{ quality?: number }>({
    name: 'screenshot',
    description:
      'Take a screenshot of the visible part of the current tab (JPEG). Use it when layout, images or ' +
      'canvas content matter, or when text tools cannot read the page. Works only while the tab is the ' +
      'active tab of its window.',
    parameters: {
      type: 'object',
      properties: { quality: { type: 'integer', description: 'JPEG quality 20-90 (default 60). Lower is smaller.' } },
    },
    run: async (args, ctx) => {
      const tab = await deps.tabs.get(ctx.tab.tabId).catch(() => {
        throw new CcError('no-tab', 'The tab was closed.');
      });
      if (!tab.active) {
        return {
          ok: false,
          content: 'Cannot take a screenshot: this tab is not the active tab in its window (Chrome can only capture the visible tab). Ask the user to switch to it, or use switch_tab.',
        };
      }
      const quality = Math.round(clamp(args.quality, 60, 20, 90));
      // Our own overlay would cover the page: hide it (the iframe stays alive) while capturing.
      const overlay = deps.overlay;
      const suspended = overlay ? await overlay.suspend(ctx.tab.tabId).catch(() => false) : false;
      let dataUrl: string;
      try {
        dataUrl = await deps.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality });
      } finally {
        if (suspended && overlay) await overlay.resume(ctx.tab.tabId).catch(() => undefined);
      }
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
      if (!m?.[1] || m[2] === undefined) return { ok: false, content: 'Screenshot failed: unexpected image data.' };
      const kb = Math.round((m[2].length * 3) / 4 / 1024);
      return {
        ok: true,
        content: `Screenshot of the visible part of ${tab.url ?? 'the tab'} (JPEG, ~${kb} KB).`,
        images: [{ mime: m[1], base64: m[2] }],
        data: { url: tab.url, bytes: kb * 1024 },
      };
    },
  });

  const navigate = defineBackgroundTool<{ url: string; timeout_ms?: number }>({
    name: 'navigate',
    description:
      'Load a URL in the current tab and wait for it to finish loading. http(s) only; a relative URL is ' +
      'resolved against the current page.',
    mutates: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL, or a path relative to the current page.' },
        timeout_ms: { type: 'integer', description: 'How long to wait for the load (default 15000, max 60000).' },
      },
      required: ['url'],
    },
    run: async (args, ctx) => {
      const url = parseHttpUrl(args.url, /^https?:/.test(ctx.tab.url) ? ctx.tab.url : undefined);
      const timeoutMs = clamp(args.timeout_ms, 15_000, 1_000, 60_000);
      const r = await navigateAndWait(deps, ctx.tab.tabId, () => deps.tabs.update(ctx.tab.tabId, { url: url.href }), timeoutMs, ctx.signal);
      return { ok: true, content: loadedMessage('Navigated', r, timeoutMs), data: { url: r.tab.url, complete: r.complete } };
    },
  });

  const historyTool = (name: 'go_back' | 'go_forward', verb: string): BackgroundToolDefinition =>
    defineBackgroundTool({
      name,
      description: `${verb === 'Went back' ? 'Go back to the previous page' : 'Go forward to the next page'} in the current tab's history and wait for it to load.`,
      mutates: true,
      parameters: { type: 'object', properties: {} },
      run: async (_args, ctx) => {
        const go = name === 'go_back' ? () => deps.tabs.goBack(ctx.tab.tabId) : () => deps.tabs.goForward(ctx.tab.tabId);
        try {
          const r = await navigateAndWait(deps, ctx.tab.tabId, go, 15_000, ctx.signal);
          return { ok: true, content: loadedMessage(verb, r, 15_000) };
        } catch (err) {
          if (err instanceof CcError) throw err;
          return { ok: false, content: `There is no ${name === 'go_back' ? 'previous' : 'next'} page in this tab's history.` };
        }
      },
    });

  const reload = defineBackgroundTool<{ bypass_cache?: boolean }>({
    name: 'reload',
    description: 'Reload the current tab and wait for it to load. Unsaved form input on the page is lost.',
    mutates: true,
    parameters: {
      type: 'object',
      properties: { bypass_cache: { type: 'boolean', description: 'Ignore the HTTP cache (default false).' } },
    },
    run: async (args, ctx) => {
      const r = await navigateAndWait(deps, ctx.tab.tabId, () => deps.tabs.reload(ctx.tab.tabId, { bypassCache: args.bypass_cache === true }), 20_000, ctx.signal);
      return { ok: true, content: loadedMessage('Reloaded', r, 20_000) };
    },
  });

  const wait = defineBackgroundTool<{ ms?: number; selector?: string; text?: string; gone?: boolean; timeout_ms?: number }>({
    name: 'wait',
    description:
      'Wait for the page: either a fixed time (ms, max 10000), or until a CSS selector / text appears ' +
      '(or disappears with gone=true), up to timeout_ms (default 10000, max 30000).',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'integer', description: 'Fixed wait in milliseconds (max 10000).' },
        selector: { type: 'string', description: 'Wait until an element matching this CSS selector is visible.' },
        text: { type: 'string', description: 'Wait until this text appears on the page (case-insensitive).' },
        gone: { type: 'boolean', description: 'Wait for the selector/text to disappear instead.' },
        timeout_ms: { type: 'integer', description: 'Maximum wait for selector/text (default 10000, max 30000).' },
      },
    },
    run: async (args, ctx) => {
      if (args.selector || args.text) {
        const timeout = Math.round(clamp(args.timeout_ms, 10_000, 100, 30_000));
        const pageArgs: Record<string, unknown> = { timeout_ms: timeout, gone: args.gone === true };
        if (args.selector) pageArgs.selector = args.selector;
        if (args.text) pageArgs.text = args.text;
        return pageExec.run(waitInPage, pageArgs, ctx, { timeoutMs: timeout + 5_000 });
      }
      const ms = Math.round(clamp(args.ms, 1_000, 0, 10_000));
      await sleep(ms, ctx.signal);
      return { ok: true, content: `Waited ${ms} ms.` };
    },
  });

  const listTabs = defineBackgroundTool<{ all_windows?: boolean }>({
    name: 'list_tabs',
    description:
      'List open tabs (id, title, URL) in the current window, or in all windows (the user is asked first). ' +
      'URLs of tabs other than the current one are shown without their query string and fragment.',
    confirmWhenArgs: ['all_windows'],
    parameters: {
      type: 'object',
      properties: { all_windows: { type: 'boolean', description: 'Include tabs from every window (default false).' } },
    },
    run: async (args, ctx) => {
      const tabs = await deps.tabs.query(args.all_windows ? {} : { windowId: ctx.tab.windowId });
      const lines = tabs.slice(0, 100).map((t) => tabLine(t, ctx.tab.tabId));
      const more = tabs.length > 100 ? `\n… and ${tabs.length - 100} more` : '';
      return {
        ok: true,
        content: `${tabs.length} tab${tabs.length === 1 ? '' : 's'}:\n${lines.join('\n')}${more}`,
        data: tabs.map((t) => ({ id: t.id, windowId: t.windowId, title: t.title, url: listedTabUrl(t, ctx.tab.tabId), active: t.active })),
      };
    },
  });

  const openTab = defineBackgroundTool<{ url: string; active?: boolean }>({
    name: 'open_tab',
    description:
      'Open an http(s) URL in a new tab next to the current one (in the background unless active is ' +
      'true). Page tools keep working on the current tab; use fetch_url to read another page.',
    mutates: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL (or relative to the current page).' },
        active: { type: 'boolean', description: 'Switch to the new tab (default false).' },
      },
      required: ['url'],
    },
    run: async (args, ctx) => {
      const url = parseHttpUrl(args.url, /^https?:/.test(ctx.tab.url) ? ctx.tab.url : undefined);
      const current = await deps.tabs.get(ctx.tab.tabId).catch(() => undefined);
      const props: { url: string; active: boolean; windowId: number; openerTabId: number; index?: number } = {
        url: url.href,
        active: args.active === true,
        windowId: ctx.tab.windowId,
        openerTabId: ctx.tab.tabId,
      };
      if (current?.index !== undefined) props.index = current.index + 1;
      const tab = await deps.tabs.create(props);
      return { ok: true, content: `Opened ${url.href} in tab ${tab.id ?? '?'}${args.active ? ' and switched to it' : ' (in the background)'}.`, data: { tabId: tab.id } };
    },
  });

  const switchTab = defineBackgroundTool<{ tab_id: number }>({
    name: 'switch_tab',
    description:
      'Bring a tab (id from list_tabs) to the front for the user. The assistant keeps operating on the ' +
      'tab it was opened in.',
    mutates: true,
    parameters: {
      type: 'object',
      properties: { tab_id: { type: 'integer', description: 'Tab id from list_tabs.' } },
      required: ['tab_id'],
    },
    run: async (args) => {
      let tab: TabLike | undefined;
      try {
        tab = await deps.tabs.update(args.tab_id, { active: true });
      } catch {
        return { ok: false, content: `No tab with id ${args.tab_id}. Use list_tabs.` };
      }
      if (tab) await deps.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      return { ok: true, content: `Switched to tab ${args.tab_id}${tab?.title ? ` ("${tab.title}")` : ''}.` };
    },
  });

  return [screenshot, navigate, historyTool('go_back', 'Went back'), historyTool('go_forward', 'Went forward'), reload, wait, listTabs, openTab, switchTab] as BackgroundToolDefinition[];
}

export const FETCH_MAX_BYTES = 3 * 1024 * 1024;

export function createFetchUrlTool(deps: Pick<ToolDeps, 'fetch'>): BackgroundToolDefinition {
  return defineBackgroundTool<{ url: string; max_chars?: number; offset?: number; raw?: boolean }>({
    name: 'fetch_url',
    description:
      'Fetch a public http(s) URL without cookies and return it as readable text (HTML is reduced to ' +
      'markdown-like text, JSON is pretty-printed). Use it to read a link without leaving the current ' +
      'page. The user is asked before every request. Local-network and localhost addresses are refused ' +
      'and redirects are not followed. Long results are paginated with offset.',
    egress: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL.' },
        max_chars: { type: 'integer', description: 'Maximum characters to return (default 15000, max 50000).' },
        offset: { type: 'integer', description: 'Character offset to continue from (default 0).' },
        raw: { type: 'boolean', description: 'Return the raw response text (e.g. HTML source) instead of reducing it.' },
      },
      required: ['url'],
    },
    run: async (args, ctx: ToolCallContext): Promise<ToolResult> => {
      const url = parseHttpUrl(args.url);
      const blocked = blockedHostReason(url);
      if (blocked) return { ok: false, content: `Refused: ${blocked}. fetch_url only reaches public internet hosts.` };
      const maxChars = Math.round(clamp(args.max_chars, 15_000, 500, 50_000));
      const offset = Math.max(0, Math.round(clamp(args.offset, 0, 0, Number.MAX_SAFE_INTEGER)));

      let res: Response;
      try {
        res = await deps.fetch(url.href, {
          method: 'GET',
          credentials: 'omit',
          // Not followed: a public URL could redirect to a private address, and the request to it
          // would be sent before the final URL could be checked. `manual` returns an opaque
          // redirect (no Location) without contacting the target.
          redirect: 'manual',
          referrerPolicy: 'no-referrer',
          headers: { Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5' },
          signal: withTimeout(ctx.signal, 15_000),
        });
      } catch (err) {
        if (ctx.signal.aborted) throw new CcError('aborted', 'Aborted');
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        return { ok: false, content: timedOut ? `Timed out fetching ${url.href} (15s).` : `Could not fetch ${url.href}: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        await res.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          content:
            `${url.href} answered with a redirect. fetch_url does not follow redirects (the browser hides the target, and a ` +
            'redirect could lead to a private address). If you can tell the final URL (often https:// instead of http://, ' +
            'with or without "www." or a trailing slash), fetch that instead.',
        };
      }
      const finalUrl = res.url || url.href;
      try {
        const finalBlocked = blockedHostReason(new URL(finalUrl));
        if (finalBlocked) {
          await res.body?.cancel().catch(() => undefined);
          return { ok: false, content: `Refused: the URL redirected to ${finalUrl} (${finalBlocked}).` };
        }
      } catch {
        // unparsable final URL: fall through with the original
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      const textual = type === '' || type.startsWith('text/') || /json|xml|javascript|ecmascript|yaml|csv|markdown/.test(type);
      if (!textual) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, content: `${finalUrl} returned ${type} (HTTP ${res.status}), which is not text. fetch_url only reads text, HTML and JSON.` };
      }
      const { text, truncated } = await readTextCapped(res, FETCH_MAX_BYTES);

      let title = '';
      let body = text;
      if (!args.raw) {
        if (type.includes('html') || (type === '' && /<html|<body|<!doctype html/i.test(text.slice(0, 2000)))) {
          const reduced = htmlToText(text, finalUrl);
          title = reduced.title;
          body = reduced.text;
        } else if (type.includes('json')) {
          try {
            body = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            // leave as-is
          }
        }
      }
      const header = [`URL: ${finalUrl}`, `Status: ${res.status}`, `Content-Type: ${type || 'unknown'}`, title && `Title: ${title}`, truncated && `(Response cut at ${FETCH_MAX_BYTES / 1024 / 1024} MB.)`]
        .filter(Boolean)
        .join('\n');
      const total = body.length;
      const end = Math.min(offset + maxChars, total);
      const footer = end < total ? `\n\n[Characters ${offset}-${end} of ${total}. To continue, call fetch_url with offset=${end}.]` : '';
      const slice = offset >= total && total > 0 ? `(No more content: ${total} characters.)` : body.slice(offset, end);
      return {
        ok: res.ok,
        content: `${header}\n\n${res.ok ? '' : `HTTP error ${res.status} ${res.statusText}.\n\n`}${slice}${footer}`,
        data: { url: finalUrl, status: res.status, contentType: type, total },
      };
    },
  });
}
