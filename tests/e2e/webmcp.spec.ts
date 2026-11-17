/**
 * End-to-end tests of page tools (WebMCP) with the built extension (dist/) in Playwright's bundled
 * Chromium, against local fixture pages that register tools through `document.modelContext` and a
 * scripted mock LLM (webmcp-fixtures.ts). Two browsers:
 *
 * - the default one (no native WebMCP): the extension's MAIN-world script provides the API;
 * - one started with `--enable-features=WebMCP` (Chrome's native API, incl. declarative forms):
 *   the extension leaves the API alone and reads tools through its native getTools/executeTool.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import type { RunningHttpServer } from '../helpers/http-server';
import { startWebMcpLlm, startWebMcpSite, type WebMcpLlm } from './webmcp-fixtures';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

let site: RunningHttpServer;
let llm: WebMcpLlm;
let host = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await startWebMcpSite();
  llm = await startWebMcpLlm(site.origin);
  host = new URL(site.origin).host;
});

test.afterAll(async () => {
  await Promise.all([llm?.close(), site?.close()]);
});

// ---------------------------------------------------------------------------------------------
// Browser harness (one per describe block)
// ---------------------------------------------------------------------------------------------

interface Harness {
  context: BrowserContext;
  extensionId: string;
  errors: string[];
}

async function launch(extraArgs: string[] = []): Promise<Harness> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, ...extraArgs],
    viewport: { width: 1200, height: 900 },
    reducedMotion: 'reduce',
  });
  const errors: string[] = [];
  const watch = (w: Worker): void => {
    w.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[worker] ${msg.text()}`);
    });
  };
  context.on('serviceworker', watch);
  context.on('weberror', (err) => {
    const stack = err.error().stack ?? '';
    if (stack.includes('chrome-extension://')) errors.push(`[uncaught] ${stack}`);
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  watch(sw);
  const h: Harness = { context, extensionId: new URL(sw.url()).host, errors };
  // The worker registers the MAIN-world script at start (setting on by default).
  await expect.poll(() => registeredScripts(h)).toEqual(['cc-webmcp']);
  return h;
}

async function serviceWorker(h: Harness): Promise<Worker> {
  const existing = h.context.serviceWorkers().filter((w) => w.url().startsWith(`chrome-extension://${h.extensionId}/`));
  for (const w of existing.reverse()) {
    const alive = await Promise.race([w.evaluate(() => true).catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    if (alive) return w;
  }
  const next = h.context.waitForEvent('serviceworker', { timeout: 15_000 });
  const p = await h.context.newPage();
  await p.goto(`chrome-extension://${h.extensionId}/bar.html?tabId=0`).catch(() => undefined);
  const worker = await next;
  await p.close();
  return worker;
}

async function registeredScripts(h: Harness): Promise<string[]> {
  const sw = await serviceWorker(h);
  return sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
}

/** An RPC as the extension's own page sends it (a top-level bar tab is trusted). */
async function rpc<T>(h: Harness, method: string, params?: unknown): Promise<T> {
  const p = await h.context.newPage();
  try {
    await p.goto(`chrome-extension://${h.extensionId}/bar.html?tabId=0`);
    const res = await p.evaluate(
      async ([m, x]) => chrome.runtime.sendMessage<unknown, { ok: boolean; result?: unknown; error?: { message: string } }>({ rpc: m, params: x }),
      [method, params] as const,
    );
    if (!res.ok) throw new Error(res.error?.message ?? 'rpc failed');
    return res.result as T;
  } finally {
    await p.close();
  }
}

async function tabIdOf(h: Harness, p: Page): Promise<number> {
  const sw = await serviceWorker(h);
  const id = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, p.url());
  if (id === undefined) throw new Error(`no tab for ${p.url()}`);
  return id;
}

let pageCounter = 0;
async function open(h: Harness, pathname: string): Promise<Page> {
  const p = await h.context.newPage();
  const [base, hash] = pathname.split('#');
  await p.goto(`${site.origin}${base}${base!.includes('?') ? '&' : '?'}p=${++pageCounter}${hash ? `#${hash}` : ''}`);
  return p;
}

async function openBar(h: Harness, p: Page): Promise<Frame> {
  const sw = await serviceWorker(h);
  const url = p.url();
  await sw.evaluate(async (u) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === u);
    if (tab?.id === undefined) throw new Error(`no tab for ${u}`);
    await (globalThis as unknown as { __ccToggleOverlay(tabId: number): Promise<void> }).__ccToggleOverlay(tab.id);
  }, url);
  await expect(p.locator('carbon-commander-overlay')).toBeVisible();
  const prefix = `chrome-extension://${h.extensionId}/bar.html`;
  await expect.poll(() => p.frames().some((f) => f.url().startsWith(prefix))).toBe(true);
  const frame = p.frames().find((f) => f.url().startsWith(prefix))!;
  await expect(frame.locator('.cc-chat')).toBeVisible();
  await expect(frame.locator('.cc-badge-conn')).toBeHidden();
  // Settings loaded (model badge filled) and the bar sized its iframe: the UI is settled.
  await expect(frame.locator('.cc-badge').first()).toContainText('·');
  await expect.poll(() => frame.evaluate(() => window.innerHeight)).toBeGreaterThan(120);
  return frame;
}

async function setUpModel(bar: Frame): Promise<void> {
  const setup = bar.getByRole('region', { name: 'Set up a model provider' });
  await expect(setup).toBeVisible();
  const custom = setup.locator('.cc-setup-option', { hasText: 'Custom OpenAI-compatible endpoint' });
  await custom.getByLabel('Base URL').fill(llm.baseUrl);
  await custom.getByRole('button', { name: 'Connect' }).click();
  await expect(custom.getByRole('status')).toContainText('1 models available');
  await custom.getByRole('combobox').selectOption('mock-model');
  await custom.getByRole('button', { name: 'Use this model' }).click();
  await expect(setup).toBeHidden();
}

const idle = (bar: Frame) => expect(bar.locator('.cc-bar')).toHaveAttribute('data-state', 'idle');
const lastReply = (bar: Frame) => bar.locator('.cc-item-assistant').last();

async function send(bar: Frame, text: string): Promise<void> {
  await idle(bar);
  const input = bar.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(bar.locator('.cc-item-user').last()).toHaveText(text);
}

async function answer(bar: Frame, button: string): Promise<void> {
  await expect(bar.locator('.cc-confirm-box')).toHaveAttribute('data-ready', 'true');
  await bar.getByRole('button', { name: button, exact: true }).click();
}

const pageToolsOf = (req: WebMcpLlm['requests'][number] | undefined): string[] =>
  (req?.tools ?? []).map((t) => t.function.name).filter((n) => n.startsWith('webmcp__'));

/** The last request's message for a tool call (what the model got back). */
const lastToolMessage = (): string => {
  const msgs = llm.requests.at(-1)?.messages ?? [];
  const tool = [...msgs].reverse().find((m) => m.role === 'tool');
  return typeof tool?.content === 'string' ? tool.content : '';
};

// ---------------------------------------------------------------------------------------------
// Without native WebMCP: the extension provides document.modelContext
// ---------------------------------------------------------------------------------------------

test.describe('page tools via the extension-provided API', () => {
  let h: Harness;

  test.beforeAll(async () => {
    h = await launch();
  });
  test.afterAll(async () => {
    await h?.context.close();
  });

  test('the API exists before page scripts run, spec-shaped on document (navigator has only the compatibility shim)', async () => {
    const p = await open(h, '/tools.html');
    expect(await p.evaluate(() => (window as unknown as { __hadApiAtStart: boolean }).__hadApiAtStart)).toBe(true);
    expect(await p.evaluate(() => (window as unknown as { __navigatorApi: boolean }).__navigatorApi)).toBe(true);
    expect(
      await p.evaluate(() => {
        const legacy = (navigator as unknown as { modelContext: object }).modelContext;
        return [Object.keys(legacy).sort().join(','), legacy === (document as unknown as { modelContext: object }).modelContext];
      }),
    ).toEqual(['clearContext,provideContext,registerTool,unregisterTool', false]);
    const shape = await p.evaluate(async () => {
      const mc = (document as unknown as { modelContext: { getTools(): Promise<{ name: string }[]> } }).modelContext;
      return {
        tag: Object.prototype.toString.call(mc),
        proto: Object.getOwnPropertyNames(Object.getPrototypeOf(mc)).sort(),
        tools: (await mc.getTools()).map((t) => t.name),
      };
    });
    expect(shape).toEqual({
      tag: '[object ModelContext]',
      proto: ['constructor', 'executeTool', 'getTools', 'ontoolactivated', 'ontoolcancel', 'ontoolchange', 'registerTool'],
      tools: ['go_to_b', 'search_fixture', 'set_heading'],
    });
    // Not in frames.
    const frameHasApi = await p.evaluate(async () => {
      const f = document.createElement('iframe');
      f.src = '/other.html';
      document.body.append(f);
      await new Promise((r) => f.addEventListener('load', r));
      return 'modelContext' in (f.contentDocument as Document);
    });
    expect(frameHasApi).toBe(false);
    await p.close();
  });

  test('tools are listed to the model, a call runs in the page after confirmation, the result reaches the model', async () => {
    const p = await open(h, '/tools.html');
    const bar = await openBar(h, p);
    await setUpModel(bar);
    // The chip says the page offers tools.
    await expect(bar.locator('.cc-badge-page')).toHaveText('3 page tools');

    await send(bar, 'list');
    await expect(lastReply(bar)).toContainText('Page tools (3): webmcp__go_to_b, webmcp__search_fixture, webmcp__set_heading. Has click: true.');
    const search = llm.requests.at(-1)?.tools?.find((t) => t.function.name === 'webmcp__search_fixture');
    expect(search?.function.description).toMatch(new RegExp(`^\\[Tool offered by the web page ${host.replace(/\./g, '\\.')} \\(WebMCP\\)`));
    expect(search?.function.parameters).toMatchObject({ type: 'object', required: ['query'] });

    await send(bar, 'call webmcp__search_fixture {"query":"iron"}');
    // Asks although the page marked it read-only, and says the page provides it.
    const title = bar.locator('.cc-confirm-title');
    await expect(title).toContainText('webmcp__search_fixture');
    await expect(title).toContainText(`(Page: ${host})`);
    await expect(title).toContainText(`provided by the web page ${host}, not by Carbon Commander`);
    await expect(bar.getByRole('button', { name: `Always allow on ${host}` })).toBeVisible();
    await answer(bar, 'Allow');
    await expect(lastReply(bar)).toContainText('Result: Found 2 items for "iron": iron bar, iron ore');
    expect(await p.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual(['search:iron']);
    const card = bar.locator('.cc-item-tool').last();
    await expect(card).toContainText(`Page: ${host}`);

    // "Always allow on <site>" makes repeated use painless.
    await send(bar, 'call webmcp__set_heading {"text":"First"}');
    await answer(bar, `Always allow on ${host}`);
    await expect(lastReply(bar)).toContainText('Result: Heading set to First');
    await send(bar, 'call webmcp__set_heading {"text":"Second"}');
    await expect(lastReply(bar)).toContainText('Result: Heading set to Second');
    await expect(p.locator('#h')).toHaveText('Second');
    await idle(bar);
    await p.close();
  });

  test('SPA-style re-registration mid-run, and after a navigation', async () => {
    const p = await open(h, '/tools.html');
    const bar = await openBar(h, p);
    await send(bar, 'spa');
    await expect(bar.locator('.cc-confirm-title')).toContainText('webmcp__go_to_b');
    await answer(bar, 'Allow');
    // Listed again before the next step: view B's tool is offered, view A's are gone.
    await expect(bar.locator('.cc-confirm-title')).toContainText('webmcp__b_tool');
    await answer(bar, 'Allow');
    await expect(lastReply(bar)).toContainText('SPA done: Now on view B | b tool ran; now offered: webmcp__b_tool');
    await expect(p).toHaveURL(/\/tools\/b$/);
    await expect(bar.locator('.cc-badge-page')).toHaveText('1 page tool');

    // Navigation by the agent: the next step sees the new page's tools.
    await send(bar, 'navother');
    await expect(bar.locator('.cc-confirm-title')).toContainText('navigate');
    await answer(bar, 'Allow');
    await p.waitForURL(/other\.html/);
    await expect.poll(() => llm.requests.at(-1)?.messages.some((m) => m.role === 'tool')).toBe(true);
    await expect.poll(() => pageToolsOf(llm.requests.at(-1))).toEqual(['webmcp__other_tool']);
    const again = await openBar(h, p);
    await expect(lastReply(again)).toContainText('After navigation: webmcp__other_tool');
    await expect(again.locator('.cc-badge-page')).toHaveText('1 page tool');
    await p.close();
  });

  test('a call made for one page never runs on the next one, even one with the same tool', async () => {
    const p = await open(h, '/tools.html');
    const bar = await openBar(h, p);
    await send(bar, 'call webmcp__search_fixture {"query":"late"}');
    await expect(bar.locator('.cc-confirm-title')).toContainText('webmcp__search_fixture');
    // While the prompt is open, the page navigates within the site to a new document that offers a
    // tool of the same name; the bar is opened again there (which reads that page's tools).
    await p.evaluate(() => location.assign(`${location.pathname}?next=1`));
    await p.waitForURL(/next=1/);
    const again = await openBar(h, p);
    await expect(again.locator('.cc-badge-page')).toHaveText('3 page tools');
    await answer(again, 'Allow');
    await expect(lastReply(again)).toContainText('Result:');
    expect(lastToolMessage()).toMatch(/navigated or reloaded|changed after its tools were listed/);
    expect(await p.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual([]);
    await p.close();
  });

  test('a page written for the earlier API (navigator.modelContext, provideContext, execute(args, agent)) works through the shim', async () => {
    const p = await open(h, '/legacy.html');
    expect(await p.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual(['dup:InvalidStateError']);
    const bar = await openBar(h, p);
    await expect(bar.locator('.cc-badge-page')).toHaveText('2 page tools');
    await send(bar, 'list');
    await expect(lastReply(bar)).toContainText('Page tools (2): webmcp__add-todo, webmcp__buyProduct.');
    await send(bar, 'call webmcp__add-todo {"text":"milk"}');
    await expect(bar.locator('.cc-confirm-title')).toContainText(`provided by the web page ${host}`);
    await answer(bar, 'Allow');
    // The MCP-style result is unpacked; requestUserInteraction ran the page's callback.
    await expect(lastReply(bar)).toContainText('Result: Added todo: milk');
    await send(bar, 'call webmcp__buyProduct {"product_id":"p-7"}');
    await answer(bar, 'Allow');
    await expect(lastReply(bar)).toContainText('Result: Product p-7 purchased.');
    expect(await p.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual(['dup:InvalidStateError', 'todo:milk:true', 'buy:p-7']);
    await p.close();
  });

  test('structurally different documents: strict CSP, frozen prototypes, own modelContext, XHTML, SVG, document.domain', async () => {
    const expected: Record<string, { api: string; tools: number }> = {
      '/s/csp.html': { api: 'object', tools: 1 },
      '/s/frozen.html': { api: 'object', tools: 1 },
      '/s/own.html': { api: 'object', tools: 1 }, // the page's own implementation, its valid tool only
      '/s/page.xhtml': { api: 'object', tools: 1 },
      '/s/image.svg': { api: 'object', tools: 1 },
      '/s/domain.html': { api: 'object', tools: 1 },
    };
    for (const [pathname, want] of Object.entries(expected)) {
      const p = await h.context.newPage();
      const problems: string[] = [];
      p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      p.on('console', (m) => {
        // The browser's own favicon request may 404 (timing-dependent); everything else counts.
        if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) problems.push(`console: ${m.text()} (${m.location().url})`);
      });
      await p.goto(`${site.origin}${pathname}`);
      expect(await p.evaluate(() => typeof (document as unknown as { modelContext?: unknown }).modelContext), pathname).toBe(want.api);
      const status = await rpc<{ count: number }>(h, 'webmcp.status', { tabId: await tabIdOf(h, p) });
      expect(status.count, pathname).toBe(want.tools);
      await p.waitForTimeout(300); // late errors from the content script
      expect(problems, pathname).toEqual([]);
      await p.close();
    }
    // Tools run there too (CSP + Trusted Types, frozen built-ins, the page's own implementation).
    for (const [pathname, tool, result] of [
      ['/s/csp.html', 'csp_tool', 'csp ok'],
      ['/s/frozen.html', 'frozen_tool', 'frozen ok'],
      ['/s/own.html', 'own_tool', 'own ran own_tool'],
    ] as const) {
      const p = await h.context.newPage();
      await p.goto(`${site.origin}${pathname}`);
      const bar = await openBar(h, p);
      await send(bar, `call webmcp__${tool} {}`);
      await answer(bar, 'Allow');
      await expect(lastReply(bar), pathname).toContainText(`Result: ${result}`);
      await p.close();
    }
  });

  test('a hostile page: caps, malformed tools, a hanging tool, a throwing one, a flood, and no shadowing of click', async () => {
    const p = await open(h, `/hostile.html#ext=${h.extensionId}`);
    const bar = await openBar(h, p);

    await send(bar, 'list');
    await expect(lastReply(bar)).toContainText('Has click: true.');
    const req = llm.requests.at(-1)!;
    const names = pageToolsOf(req);
    expect(names).toHaveLength(32);
    expect(names.slice(0, 6)).toEqual(['webmcp__a_bigdesc', 'webmcp__a_explode', 'webmcp__a_hang', 'webmcp__a_html', 'webmcp__a_huge', 'webmcp__click']);
    expect(names).not.toContain('webmcp__a_bigschema');
    expect(names).not.toContain('webmcp__a_badschema');
    expect(req.tools!.filter((t) => t.function.name === 'click')).toHaveLength(1);
    const big = req.tools!.find((t) => t.function.name === 'webmcp__a_bigdesc')!;
    expect(big.function.description.length).toBeLessThan(3_300);
    const html = req.tools!.find((t) => t.function.name === 'webmcp__a_html')!;
    expect(html.function.description).not.toContain('‮');
    expect(await p.evaluate(() => (window as unknown as { __log: string[] }).__log)).toContain('rejected:bad name!:InvalidStateError');

    // The model's `click` is the built-in one; the page's runs only under its own name.
    await send(bar, 'call click {"selector":"#target"}');
    await expect(bar.locator('.cc-confirm-title')).toContainText('(Built-in)');
    await answer(bar, 'Allow');
    await expect(lastReply(bar)).toContainText('Result:');
    await expect(p.locator('#target')).toHaveAttribute('data-clicked', '1');
    expect(await p.evaluate(() => (window as unknown as { __fakeClickRan?: boolean }).__fakeClickRan)).toBeUndefined();

    // A throwing tool: an error result, HTML shown as text.
    await send(bar, 'call webmcp__a_explode {}');
    await answer(bar, 'Allow');
    await expect(lastReply(bar)).toContainText('failed (OperationError): Tool execution failed: kaboom <img src=x');
    await expect(bar.locator('.cc-item-tool').last().locator('details')).toHaveAttribute('data-status', 'error');
    await expect(bar.locator('.cc-item-tool img')).toHaveCount(0); // tool output is text, never HTML

    // A flood: truncated with a marker before it reaches the model.
    await send(bar, 'call webmcp__a_huge {}');
    await answer(bar, 'Allow');
    await expect(lastReply(bar)).toContainText('Result: xxx');
    const flood = lastToolMessage();
    expect(flood.length).toBeLessThan(32_200);
    expect(flood).toContain("truncated: the page's result was 1000000 characters");

    // A tool that never answers: Stop aborts it in the page.
    await send(bar, 'call webmcp__a_hang {}');
    await answer(bar, 'Allow');
    await expect.poll(() => p.evaluate(() => (window as unknown as { __hangStarted?: boolean }).__hangStarted)).toBe(true);
    await bar.getByRole('button', { name: 'Stop (Esc)' }).click();
    await idle(bar);
    await expect.poll(() => p.evaluate(() => (window as unknown as { __hangAborted?: boolean }).__hangAborted)).toBe(true);
    await expect(bar.locator('.cc-item-tool').last().locator('details')).toHaveAttribute('data-status', 'aborted');

    // The tools list in settings shows page tools as text, grouped under the page, with a switch.
    await bar.getByRole('button', { name: 'Settings' }).click();
    await bar.getByRole('tab', { name: 'Tools' }).click();
    const panel = bar.locator('#cc-panel-tools');
    await panel.getByRole('searchbox', { name: 'Filter tools' }).fill('webmcp__a_html');
    await expect(panel).toContainText(`Page: ${host} (1)`);
    await expect(panel).toContainText('<img src=x onerror=');
    await expect(panel.locator('img, b')).toHaveCount(0);
    expect(await bar.evaluate(() => (window as unknown as { __ccXss?: unknown }).__ccXss)).toBeUndefined();
    expect(await p.evaluate(() => (window as unknown as { __ccXss?: unknown }).__ccXss)).toBeUndefined();

    // Disable one page tool: no longer offered to the model.
    await panel.getByRole('searchbox', { name: 'Filter tools' }).fill('webmcp__a_hang');
    await panel.getByRole('checkbox', { name: /^webmcp__a_hang\b/ }).uncheck();
    await bar.getByRole('button', { name: 'Back to chat' }).click();
    await send(bar, 'list');
    await expect(lastReply(bar)).toContainText('Page tools (31)');
    expect(pageToolsOf(llm.requests.at(-1))).not.toContain('webmcp__a_hang');
    await p.close();
  });

  test('the page cannot use the bridge for anything but offering and running its own tools', async () => {
    const before = llm.requests.length;
    const p = await open(h, `/hostile.html#ext=${h.extensionId}`);
    const probes = await p.evaluate(() => (window as unknown as { __probes: Record<string, unknown> }).__probes);
    // No extension API in the page (no externally_connectable), so no message can be sent.
    expect(probes.runtime === false || probes.runtime === 'undefined').toBe(true);
    expect(probes.sendMessage).toBeUndefined();
    // The page sees the spec's interface and nothing else of ours.
    expect(probes.protoKeys).toBe('constructor,executeTool,getTools,ontoolactivated,ontoolcancel,ontoolchange,registerTool');
    expect(probes.windowSymbols).toBe('');
    // Its posted messages and events did nothing: no overlay, no request to the model.
    await p.waitForTimeout(500);
    await expect(p.locator('carbon-commander-overlay')).toHaveCount(0);
    expect(llm.requests.length).toBe(before);
    // A page cannot construct its own context or reach another registry.
    const constructed = await p.evaluate(() => {
      const mc = (document as unknown as { modelContext: object }).modelContext;
      try {
        new (mc.constructor as new () => unknown)();
        return 'constructed';
      } catch (e) {
        return (e as Error).name;
      }
    });
    expect(constructed).toBe('TypeError');
    await p.close();
  });

  test('with the setting off, nothing is injected and no page tool is listed', async () => {
    const already = await open(h, '/tools.html'); // loaded while on
    const bar = await openBar(h, already);
    await expect(bar.locator('.cc-badge-page')).toHaveText('3 page tools');
    await bar.getByRole('button', { name: 'Settings' }).click();
    await bar.getByRole('tab', { name: 'General' }).click();
    const toggle = bar.getByRole('checkbox', { name: 'Use tools offered by the page (WebMCP)' });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(() => registeredScripts(h)).toEqual([]);
    await bar.getByRole('button', { name: 'Back to chat' }).click();
    await expect(bar.locator('.cc-badge-page')).toBeHidden();
    // The page loaded before keeps its API, but its tools are not offered.
    await send(bar, 'list');
    await expect(lastReply(bar)).toContainText('Page tools (0)');

    const fresh = await open(h, '/tools.html');
    expect(await fresh.evaluate(() => (window as unknown as { __hadApiAtStart: boolean }).__hadApiAtStart)).toBe(false);
    expect(await fresh.evaluate(() => 'modelContext' in document)).toBe(false);
    const freshBar = await openBar(h, fresh);
    await send(freshBar, 'list');
    await expect(lastReply(freshBar)).toContainText('Page tools (0)');
    await expect(freshBar.locator('.cc-badge-page')).toBeHidden();

    // On again: registered again, new pages get the API.
    await freshBar.getByRole('button', { name: 'Settings' }).click();
    await freshBar.getByRole('tab', { name: 'General' }).click();
    await freshBar.getByRole('checkbox', { name: 'Use tools offered by the page (WebMCP)' }).check();
    await expect.poll(() => registeredScripts(h)).toEqual(['cc-webmcp']);
    await fresh.reload();
    expect(await fresh.evaluate(() => (window as unknown as { __hadApiAtStart: boolean }).__hadApiAtStart)).toBe(true);
    await already.close();
    await fresh.close();
  });

  test('no extension errors', () => {
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// With Chrome's native WebMCP (behind a flag in this Chromium)
// ---------------------------------------------------------------------------------------------

test.describe('page tools via Chrome native WebMCP', () => {
  let h: Harness;

  test.beforeAll(async () => {
    h = await launch(['--enable-features=WebMCP']);
  });
  test.afterAll(async () => {
    await h?.context.close();
  });

  test('the native API is left alone; imperative and declarative tools are listed and run', async () => {
    const p = await open(h, '/tools.html');
    const native = await p.evaluate(() => {
      const mc = (document as unknown as { modelContext: { registerTool: () => void } }).modelContext;
      return { fn: Function.prototype.toString.call(mc.registerTool), ctor: typeof (window as unknown as { ModelContext?: unknown }).ModelContext };
    });
    expect(native.fn).toContain('[native code]');
    expect(native.ctor).toBe('function');

    const bar = await openBar(h, p);
    await setUpModel(bar);
    await expect(bar.locator('.cc-badge-page')).toHaveText('3 page tools');
    await send(bar, 'call webmcp__search_fixture {"query":"copper"}');
    await expect(bar.locator('.cc-confirm-title')).toContainText(`(Page: ${host})`);
    await answer(bar, 'Allow');
    await expect(lastReply(bar)).toContainText('Result: Found 2 items for "copper": iron bar, iron ore');

    // Declarative form tool (Chrome implements the form attributes).
    const form = await open(h, '/form.html');
    const formBar = await openBar(h, form);
    await send(formBar, 'list');
    await expect(lastReply(formBar)).toContainText('Page tools (1): webmcp__search_form.');
    await send(formBar, 'call webmcp__search_form {"q":"tin"}');
    await answer(formBar, 'Allow');
    await expect(lastReply(formBar)).toContainText('Result: Form searched for tin');
    expect(await form.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual(['form:tin']);
    await p.close();
    await form.close();
  });

  test('over the native API no compatibility shim is installed', async () => {
    const p = await open(h, '/legacy.html');
    const state = await p.evaluate(() => ({
      navigatorShim: (navigator as unknown as { modelContext?: { provideContext?: unknown } }).modelContext?.provideContext !== undefined,
      log: (window as unknown as { __log: string[] }).__log,
    }));
    expect(state).toEqual({ navigatorShim: false, log: [] });
    await p.close();
  });

  test('no extension errors (native)', () => {
    expect(h.errors).toEqual([]);
  });
});
