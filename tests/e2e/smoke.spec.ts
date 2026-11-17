/* eslint-disable no-console -- the test probes console output and prints extension warnings */
/**
 * End-to-end smoke test of the built extension in Playwright's bundled Chromium, against a mock
 * LLM, the mock MCP server and a fixture site (all local). One browser profile for the whole file:
 * the tests run in order and build on each other (setup first, then chat, tools, MCP...).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { startMockMcpServer, type RunningMockMcpServer } from '../helpers/mock-mcp-server';
import type { RunningHttpServer } from '../helpers/http-server';
import { startFixtureSite, startMockLlm, type MockLlm } from './servers';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

let context: BrowserContext;
let extensionId = '';
let llm: MockLlm;
let site: RunningHttpServer;
let mcp: RunningMockMcpServer;
const extensionErrors: string[] = [];
const extensionWarnings: string[] = [];
let pageCounter = 0;

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function watchWorker(worker: Worker): void {
  worker.on('console', (msg) => {
    if (msg.type() === 'error') extensionErrors.push(`[worker] ${msg.text()}`);
    if (msg.type() === 'warning') extensionWarnings.push(`[worker] ${msg.text()}`);
  });
}

/** The current (running) service worker; wakes it if needed. */
async function serviceWorker(): Promise<Worker> {
  const existing = context.serviceWorkers().filter((w) => w.url().startsWith(`chrome-extension://${extensionId}/`));
  for (const w of existing.reverse()) {
    const alive = await Promise.race([w.evaluate(() => true).catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    if (alive) return w;
  }
  // Wake it: any extension event starts the worker again.
  const next = context.waitForEvent('serviceworker', { timeout: 15_000 });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/bar.html?tabId=0`).catch(() => undefined);
  const worker = await next;
  await page.close();
  return worker;
}

async function openFixture(pathname = '/'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${site.origin}${pathname}${pathname.includes('?') ? '&' : '?'}p=${++pageCounter}`);
  return page;
}

async function tabIdOf(page: Page): Promise<number> {
  const sw = await serviceWorker();
  const url = page.url();
  const id = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  if (id === undefined) throw new Error(`No tab for ${url}`);
  return id;
}

/** Same code path as the toolbar button / Ctrl+K (`chrome.action.onClicked`). */
async function toggleOverlay(page: Page): Promise<void> {
  const tabId = await tabIdOf(page);
  const sw = await serviceWorker();
  await sw.evaluate(async (id) => {
    await (globalThis as unknown as { __ccToggleOverlay(tabId: number): Promise<void> }).__ccToggleOverlay(id);
  }, tabId);
}

async function barFrame(page: Page): Promise<Frame> {
  const prefix = `chrome-extension://${extensionId}/bar.html`;
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(prefix))).toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith(prefix));
  if (!frame) throw new Error('bar frame not found');
  await expect(frame.locator('.cc-chat')).toBeVisible();
  return frame;
}

async function openBar(page: Page): Promise<Frame> {
  await toggleOverlay(page);
  await expect(page.locator('carbon-commander-overlay')).toBeVisible();
  const frame = await barFrame(page);
  await expect(frame.locator('.cc-badge-conn')).toBeHidden(); // connected
  // The bar sized its iframe (from the initial 96 px) to fit its content.
  await expect.poll(() => frame.evaluate(() => window.innerHeight)).toBeGreaterThan(120);
  return frame;
}

async function send(bar: Frame, text: string): Promise<void> {
  // The worker rejects a second run while one is active ("busy"): wait for the previous one.
  await expect(bar.locator('.cc-bar')).toHaveAttribute('data-state', 'idle');
  // Messages are refused (kept in the input) while the bar is reconnecting.
  await expect(bar.locator('.cc-badge-conn')).toBeHidden();
  const input = bar.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

const assistantItems = (bar: Frame) => bar.locator('.cc-item-assistant');
const idle = (bar: Frame) => expect(bar.locator('.cc-bar')).toHaveAttribute('data-state', 'idle');

async function confirmPrompt(bar: Frame, toolName: string, source: string): Promise<void> {
  const title = bar.locator('.cc-confirm-title');
  await expect(title).toContainText(toolName);
  await expect(title).toContainText(`(${source})`);
}

/**
 * Answer the open prompt once it accepts clicks: after the arming delay, and only while the
 * browser's occlusion check (IntersectionObserver v2) reports its buttons visible.
 */
async function answer(bar: Frame, button: 'Allow' | 'Deny'): Promise<void> {
  await expect(bar.locator('.cc-confirm-box')).toHaveAttribute('data-ready', 'true');
  await bar.getByRole('button', { name: button, exact: true }).click();
}

/** Stop the extension's service worker (like Chrome does after 30 s idle, or a crash). */
async function stopServiceWorker(page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  const versions: { versionId: string; scriptURL: string; runningStatus: string }[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => versions.push(...e.versions));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.some((v) => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`))).toBe(true);
  const ours = (x: { scriptURL: string }): boolean => x.scriptURL.startsWith(`chrome-extension://${extensionId}/`);
  const running = versions.filter((x) => ours(x) && x.runningStatus === 'running');
  expect(running.length).toBeGreaterThan(0);
  const seen = versions.length;
  for (const v of running) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  // Really stopped (not just asked to). Check that a "stopped" update arrived, not that the worker
  // is still stopped: the reconnecting bar wakes it again within ~100 ms.
  await expect.poll(() => versions.slice(seen).some((v) => ours(v) && v.runningStatus === 'stopped')).toBe(true);
  await cdp.detach();
}

// ---------------------------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------------------------

test.beforeAll(async () => {
  site = await startFixtureSite();
  llm = await startMockLlm(site.origin);
  mcp = await startMockMcpServer({ token: 'e2e-token' });
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', // bundled Chromium: runs extensions headless
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    viewport: { width: 1200, height: 900 },
    // No resize animation of the overlay iframe: clicks land where Playwright aimed (one early
    // flake was a click intercepted while the iframe grew).
    reducedMotion: 'reduce',
  });
  context.on('serviceworker', watchWorker);
  context.on('console', (msg) => {
    const url = msg.location().url;
    if (msg.type() === 'error' && url.startsWith('chrome-extension://')) extensionErrors.push(`[page ${url}] ${msg.text()}`);
    if (msg.type() === 'warning' && url.startsWith('chrome-extension://')) extensionWarnings.push(`[page ${url}] ${msg.text()}`);
  });
  context.on('weberror', (err) => {
    const stack = err.error().stack ?? '';
    if (stack.includes('chrome-extension://')) extensionErrors.push(`[uncaught] ${stack}`);
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  watchWorker(sw);
  extensionId = new URL(sw.url()).host;
  // A profile from an older version: an extractable key + ciphertext in chrome.storage.local
  // (migrated into IndexedDB and deleted on first use; checked by a test below).
  await sw.evaluate(async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('legacy-ollama-key')));
    const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
    await chrome.storage.local.set({
      _cc_encryption_key: await crypto.subtle.exportKey('jwk', key),
      'encrypted_ollama-key': JSON.stringify({ v: 2, iv: b64(iv), ct: b64(ct) }),
    });
  });
});

test.afterAll(async () => {
  await context?.close();
  await Promise.all([llm?.close(), site?.close(), mcp?.close()]);
});

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test('opens the overlay and completes first-run setup with a custom endpoint', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  // The page sees only an empty host element: closed shadow root, no reachable iframe.
  const pageView = await page.evaluate(() => {
    const host = document.querySelector('carbon-commander-overlay');
    return { host: !!host, shadow: host?.shadowRoot ?? null, iframes: document.querySelectorAll('iframe').length, frames: window.frames.length };
  });
  expect(pageView).toEqual({ host: true, shadow: null, iframes: 0, frames: 0 });

  // The console-error collector sees the bar and the worker (probe it, then forget the probes).
  // Logged by the bar's own script (e2e build hook): a message from evaluated code carries no
  // script URL on Linux, so it would not count as coming from the extension.
  await bar.evaluate(() => (globalThis as unknown as { __ccProbeConsole(text: string): void }).__ccProbeConsole('cc-e2e-probe-bar'));
  await (await serviceWorker()).evaluate(() => console.error('cc-e2e-probe-worker'));
  // Each probe at least once: some platforms report a frame's console message more than once.
  await expect.poll(() => ['cc-e2e-probe-bar', 'cc-e2e-probe-worker'].every((p) => extensionErrors.some((e) => e.includes(p)))).toBe(true);
  extensionErrors.splice(0, extensionErrors.length, ...extensionErrors.filter((e) => !e.includes('cc-e2e-probe')));

  const setup = bar.getByRole('region', { name: 'Set up a model provider' });
  await expect(setup).toBeVisible();
  const custom = setup.locator('.cc-setup-option', { hasText: 'Custom OpenAI-compatible endpoint' });
  await custom.getByLabel('Base URL').fill(llm.baseUrl);
  await custom.getByRole('button', { name: 'Connect' }).click();
  await expect(custom.getByRole('status')).toContainText('1 models available');
  await custom.getByRole('combobox').selectOption('mock-model');
  await custom.getByRole('button', { name: 'Use this model' }).click();
  await expect(setup).toBeHidden();
  await expect(bar.locator('.cc-badge').first()).toContainText('mock-model');
  await page.close();
});

test('streams a reply as sanitised markdown, with usage', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await send(bar, 'hello there');
  await expect(bar.locator('.cc-item-user').last()).toHaveText('hello there');
  const reply = assistantItems(bar).last();
  await expect(reply.locator('strong')).toHaveText('world');
  await expect(reply.locator('li')).toHaveCount(2);
  await expect(reply.locator('li code')).toHaveText('two');
  await idle(bar);
  await expect(bar.locator('.cc-usage')).not.toBeEmpty();
  // The request carried the built-in tools and our system prompt with the tab URL.
  const req = llm.requests.at(-1);
  expect(req?.tools?.map((t) => t.function.name)).toContain('find_elements');
  expect(JSON.stringify(req?.messages[0])).toContain(site.origin);
  await page.close();
});

test('markdown XSS payloads from the model stay inert', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await send(bar, 'xss please');
  const reply = assistantItems(bar).last();
  await expect(reply).toContainText('safe link');
  await idle(bar);
  await bar.waitForTimeout(300);
  const transcript = bar.locator('.cc-transcript');
  await expect(transcript.locator('script, iframe, svg, img[onerror], [onclick], a[href^="javascript:"]')).toHaveCount(0);
  expect(await bar.evaluate(() => (window as unknown as { __ccXss?: unknown }).__ccXss)).toBeUndefined();
  expect(await page.evaluate(() => (window as unknown as { __ccXss?: unknown }).__ccXss)).toBeUndefined();
  await page.close();
});

test('page tools: read + find, type (allowed), click (denied), then click (allowed)', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await send(bar, 'form fill it in');

  await confirmPrompt(bar, 'type_text', 'Built-in');
  await answer(bar, 'Allow');
  await confirmPrompt(bar, 'click', 'Built-in');
  await answer(bar, 'Deny');
  await expect(assistantItems(bar).last()).toContainText('Form step done');
  await idle(bar);

  await expect(page.locator('#name')).toHaveValue('Ada Lovelace');
  await expect(page.locator('#heading')).toHaveText('Original heading');
  const cards = bar.locator('.cc-item-tool');
  await expect(cards.filter({ hasText: 'read_page' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'find_elements' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'click' }).last().locator('details')).toHaveAttribute('data-status', 'denied');

  await send(bar, 'click the button');
  await confirmPrompt(bar, 'click', 'Built-in');
  // S4: the prompt leaves the focus in the message box.
  await expect(bar.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await answer(bar, 'Allow');
  await expect(page.locator('#heading')).toHaveText('Heading changed by click');
  await expect(assistantItems(bar).last()).toContainText('Clicked');
  // Our own open overlay is not reported as covering the page (C3).
  await expect(assistantItems(bar).last()).not.toContainText('on top');
  await idle(bar);
  await page.close();
});

test('Escape closes the overlay; re-opening keeps the same conversation; + starts a new one', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await send(bar, 'hello keep me');
  await expect(assistantItems(bar).last()).toContainText('world');
  await idle(bar);
  await bar.getByRole('textbox', { name: 'Message' }).press('Escape');
  await expect(page.locator('carbon-commander-overlay')).toBeHidden();
  const again = await openBar(page);
  expect(again).toBe(bar); // the iframe was kept alive
  await expect(bar.locator('.cc-item-user').last()).toHaveText('hello keep me');
  await expect(bar.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await bar.getByRole('button', { name: 'New conversation' }).click();
  await expect(bar.locator('.cc-item')).toHaveCount(0);
  await page.close();
});

test('autocomplete suggests completions from the autocomplete model', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  const input = bar.getByRole('textbox', { name: 'Message' });
  await input.pressSequentially('summarise', { delay: 20 });
  // The first suggestion is ghost text (Tab accepts it), the others are chips.
  await expect(bar.locator('.cc-ghost-tail')).toHaveText(' this page');
  const chips = bar.getByRole('list', { name: 'Suggestions' }).getByRole('listitem');
  await expect(chips.first()).toHaveText('summarise the selection');
  await input.press('Tab');
  await expect(input).toHaveValue('summarise this page');
  await input.fill('');
  await input.pressSequentially('explain', { delay: 20 });
  await expect(chips.first()).toHaveText('explain the selection');
  await chips.first().click();
  await expect(input).toHaveValue('explain the selection');
  await page.close();
});

test('a tool disabled in settings is not offered to the model', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await bar.getByRole('button', { name: 'Settings' }).click();
  await bar.getByRole('tab', { name: 'Tools' }).click();
  const panel = bar.locator('#cc-panel-tools');
  await panel.getByRole('searchbox', { name: 'Filter tools' }).fill('click');
  const box = panel.getByRole('checkbox', { name: /^click\b/ });
  await expect(box).toBeChecked();
  await box.uncheck();
  await bar.getByRole('button', { name: 'Back to chat' }).click();
  await send(bar, 'tools please');
  await expect(assistantItems(bar).last()).toContainText('has click: false');
  // Turn it back on for the remaining tests.
  await bar.getByRole('button', { name: 'Settings' }).click();
  await bar.getByRole('tab', { name: 'Tools' }).click();
  await panel.getByRole('searchbox', { name: 'Filter tools' }).fill('click');
  await panel.getByRole('checkbox', { name: /^click\b/ }).check();
  await bar.getByRole('button', { name: 'Back to chat' }).click();
  await send(bar, 'tools again');
  await expect(assistantItems(bar).last()).toContainText('has click: true');
  await page.close();
});

test('aborts a run mid-stream', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  const abortedBefore = llm.aborted();
  await send(bar, 'slow story');
  const reply = assistantItems(bar).last();
  await expect(reply).toContainText('chunk3');
  await bar.getByRole('button', { name: 'Stop (Esc)' }).click();
  await idle(bar);
  await expect.poll(() => llm.aborted()).toBeGreaterThan(abortedBefore);
  const text = (await reply.textContent()) ?? '';
  expect(text).not.toContain('chunk299');
  // The conversation goes on after an abort.
  await send(bar, 'hello again');
  await expect(assistantItems(bar).last().locator('strong')).toHaveText('world');
  await page.close();
});

test('navigation mid-conversation: re-open the overlay, transcript replays, tab context follows', async () => {
  const page = await openFixture();
  let bar = await openBar(page);
  await send(bar, 'hello first');
  await expect(assistantItems(bar).last()).toContainText('world');
  await send(bar, 'navigate to page two');
  await confirmPrompt(bar, 'navigate', 'Built-in');
  await answer(bar, 'Allow');
  await page.waitForURL(/page2\.html/);
  // The navigation destroyed the iframe; the run carries on in the worker.
  bar = await openBar(page);
  await expect(bar.locator('.cc-item-user').first()).toHaveText('hello first');
  const last = assistantItems(bar).last();
  await expect(last).toContainText('System prompt now says');
  await expect(last).toContainText('page2.html');
  await expect(last).toContainText('Second page');
  await idle(bar);
  await page.close();
});

test('recovers when the service worker is stopped, idle and mid-run', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await send(bar, 'hello before restart');
  await expect(assistantItems(bar).last()).toContainText('world');
  await idle(bar);

  await stopServiceWorker(page);
  await send(bar, 'hello after restart');
  await expect(bar.locator('.cc-item-user').last()).toHaveText('hello after restart');
  await expect(assistantItems(bar).last()).toContainText('world');
  await expect(bar.locator('.cc-item-user')).toHaveCount(2);
  await idle(bar);

  await send(bar, 'slow while dying');
  await expect(assistantItems(bar).last()).toContainText('chunk2');
  await stopServiceWorker(page);
  await expect(bar.locator('.cc-item-error').last()).toContainText('interrupted', { timeout: 30_000 });
  await idle(bar);
  await send(bar, 'hello once more');
  await expect(bar.locator('.cc-item-user').last()).toHaveText('hello once more');
  await expect(assistantItems(bar).last()).toContainText('world');
  await page.close();
});

test('adds the mock MCP server in settings, tests it, and calls a tool through it', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await bar.getByRole('button', { name: 'Settings' }).click();
  await bar.getByRole('tab', { name: 'MCP' }).click();
  const panel = bar.locator('#cc-panel-mcp');
  await panel.getByRole('button', { name: 'Add server' }).click();
  const form = panel.locator('.cc-settings-section', { hasText: 'Add MCP server' });
  await form.getByLabel('Name').fill('mock');
  await form.getByLabel('URL (Streamable HTTP)').fill(mcp.url);
  await form.getByLabel('Bearer token').fill('e2e-token');
  await form.getByRole('button', { name: 'Test connection' }).click();
  await expect(form.getByRole('status')).toContainText('OK · 2 tools');
  await form.getByRole('button', { name: 'Add server', exact: true }).click();
  const row = panel.locator('.cc-mcp-server', { hasText: 'mock' });
  await expect(row.locator('.cc-pill').first()).toHaveText('connected');
  await row.getByRole('button', { name: 'Test' }).click();
  await expect(row.getByRole('status')).toContainText('2 tools');
  await bar.getByRole('button', { name: 'Back to chat' }).click();

  await send(bar, 'mcp add two numbers');
  // Even though the server marks tools read-only or not, MCP tools always ask by default.
  await confirmPrompt(bar, 'mcp__mock__add', 'MCP: mock');
  await answer(bar, 'Allow');
  await expect(assistantItems(bar).last()).toContainText('The MCP sum is 5.');
  await expect(bar.locator('.cc-item-tool').last().locator('.cc-tool-source')).toHaveText('MCP: mock');
  await page.close();
});

test('the screenshot tool hides the overlay while capturing and restores it', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  // Record the host's visibility changes from the page while the worker captures.
  await page.evaluate(() => {
    const host = document.querySelector('carbon-commander-overlay') as HTMLElement;
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => seen.push(host.style.getPropertyValue('visibility') || 'visible')).observe(host, { attributes: true });
  });
  await send(bar, 'shot of the page');
  await expect(assistantItems(bar).last()).toContainText('Screenshot result');
  await idle(bar);
  const card = bar.locator('.cc-item-tool', { hasText: 'screenshot' }).last();
  await expect(card.locator('details')).toHaveAttribute('data-status', 'ok');
  expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual(['hidden', 'visible']);
  await expect(page.locator('carbon-commander-overlay')).toBeVisible();
  // The image went to the model as a follow-up user message.
  const req = llm.requests.at(-1);
  expect(JSON.stringify(req?.messages)).toContain('data:image/jpeg;base64,');
  await page.close();
});

test('falls back to the bar in its own tab where the page cannot be scripted', async () => {
  const page = await context.newPage();
  await page.goto('chrome://version/');
  const opened = context.waitForEvent('page');
  await toggleOverlay(page);
  const barTab = await opened;
  await barTab.waitForLoadState();
  const tabId = await tabIdOf(page);
  expect(barTab.url()).toBe(`chrome-extension://${extensionId}/bar.html?tabId=${tabId}`);
  const main = barTab.mainFrame();
  await expect(main.locator('.cc-badge-conn')).toBeHidden();
  await send(main, 'hello from a tab');
  await expect(assistantItems(main).last().locator('strong')).toHaveText('world');
  // The session belongs to the target tab: its system prompt names that tab.
  expect(JSON.stringify(llm.requests.at(-1)?.messages[0])).toContain('chrome://version');
  await barTab.close();
  await page.close();
});

test('works on a page with a strict frame-src / child-src CSP', async () => {
  const page = await openFixture('/csp.html');
  const cspErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') cspErrors.push(m.text());
  });
  const bar = await openBar(page);
  await send(bar, 'hello csp');
  await expect(assistantItems(bar).last().locator('strong')).toHaveText('world');
  expect(cspErrors.filter((e) => e.includes('chrome-extension'))).toEqual([]);
  await page.close();
});

test('a page that frames bar.html itself gets nothing', async () => {
  const page = await openFixture('/hostile.html');
  // 1. The static URL is not web-accessible (use_dynamic_url): the frame is blocked.
  const staticUrl = `chrome-extension://${extensionId}/bar.html`;
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.id = 'static';
    f.src = src;
    document.body.append(f);
  }, staticUrl);
  await page.waitForTimeout(1000);
  const staticFrame = page.frames().find((f) => f.url() === staticUrl);
  if (staticFrame) await expect(staticFrame.locator('.cc-chat')).toHaveCount(0);

  // 2. Even with the per-session dynamic URL (as if it leaked), the bar refuses to start: it never
  //    gets a handshake token from our content script, and the worker refuses its RPCs / port.
  const sw = await serviceWorker();
  const tabId = await tabIdOf(page);
  const dynamicUrl = await sw.evaluate(async (id) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => chrome.runtime.getURL('bar.html') });
    return r?.result as string;
  }, tabId);
  expect(dynamicUrl).not.toContain(extensionId);
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.id = 'dynamic';
    f.src = src;
    document.body.append(f);
  }, dynamicUrl);
  const framed = await (async () => {
    await expect.poll(() => page.frames().some((f) => f.url().startsWith(`chrome-extension://${extensionId}/bar.html`))).toBe(true);
    return page.frames().find((f) => f.url().startsWith(`chrome-extension://${extensionId}/bar.html`)) as Frame;
  })();
  // A hostile page can also post fake init tokens; they are refused.
  await page.evaluate(() => {
    const f = document.getElementById('dynamic') as HTMLIFrameElement;
    for (let i = 0; i < 3; i++) f.contentWindow?.postMessage({ cc: 'init', token: `fake-token-${i}-0123456789` }, '*');
  });
  await expect(framed.locator('body')).toContainText('only runs in its own overlay', { timeout: 20_000 });
  await expect(framed.locator('.cc-chat')).toHaveCount(0);
  // And it cannot call RPCs directly either.
  const rpc: unknown = await framed.evaluate(async (): Promise<unknown> => chrome.runtime.sendMessage({ rpc: 'settings.get' }));
  expect(rpc).toMatchObject({ ok: false, error: { message: 'Sender not allowed' } });
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Review regressions (security + correctness)
// ---------------------------------------------------------------------------------------------

const BAR_PREFIX = (): string => `chrome-extension://${extensionId}/bar.html`;

test('S2: the page receives nothing from the bar; a navigation of our iframe we did not start recreates it', async () => {
  const page = await openFixture();
  await page.evaluate(() => {
    const w = window as unknown as { __msgs: unknown[] };
    w.__msgs = [];
    window.addEventListener('message', (e) => w.__msgs.push({ origin: e.origin, source: e.source !== null }));
  });
  let bar = await openBar(page);
  await send(bar, 'hello channel');
  await expect(assistantItems(bar).last()).toContainText('world');
  await idle(bar);
  await bar.getByRole('textbox', { name: 'Message' }).press('Escape'); // close goes over the channel
  await expect(page.locator('carbon-commander-overlay')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __msgs: unknown[] }).__msgs)).toEqual([]);

  bar = await openBar(page);
  // Something navigates the bar's iframe away (here: from inside, as if it had a reference).
  const old = bar;
  await old.evaluate((u) => void (location.href = u), `${site.origin}/page2.html`);
  // The overlay notices the load it did not start, removes that iframe and builds a fresh,
  // verified bar.
  await expect.poll(() => old.isDetached(), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(() => page.frames().filter((f) => f.url().startsWith(BAR_PREFIX())).length, { timeout: 15_000 })
    .toBe(1);
  bar = await barFrame(page);
  await expect(bar.locator('.cc-badge-conn')).toBeHidden();
  await expect(bar.locator('.cc-item-user').last()).toHaveText('hello channel');
  expect(page.frames().some((f) => f.url().startsWith(`${site.origin}/page2.html`))).toBe(false);
  await page.close();
});

test('S3: a page element drawn over the prompt (clicks passing through) blocks approval; the prompt raises the overlay', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  // The page puts its own top-layer element over everything; clicks pass through it.
  const cover = async (action: 'show' | 'raise' | 'remove'): Promise<void> =>
    page.evaluate((a) => {
      let c = document.getElementById('cover');
      if (!c) {
        c = document.createElement('div');
        c.id = 'cover';
        c.setAttribute('popover', 'manual');
        c.style.cssText =
          'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:40vh 0 0;border:0;' +
          'background:rgba(255,255,255,0.06);pointer-events:none;font:40px sans-serif;text-align:center';
        c.textContent = 'Click anywhere to win!';
        document.body.append(c);
      }
      if (a === 'remove') c.hidePopover();
      else {
        if (c.matches(':popover-open')) c.hidePopover();
        c.showPopover();
      }
    }, action);

  await cover('show'); // over our overlay already
  await send(bar, 'click the button');
  await confirmPrompt(bar, 'click', 'Built-in');
  const box = bar.locator('.cc-confirm-box');
  // The prompt saw it was covered and asked the host to raise the overlay above the cover, so it
  // is usable; the raise does not take the focus out of the message box the user typed in.
  await expect(box).toHaveAttribute('data-ready', 'true');
  await expect(bar.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await page.waitForTimeout(300);
  await expect(bar.getByRole('textbox', { name: 'Message' })).toBeFocused();

  await cover('raise'); // the page pushes its cover on top again
  await expect(box).toHaveAttribute('data-ready', 'false');
  await bar.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(bar.locator('.cc-confirm-hint')).toContainText('not fully visible');
  await page.waitForTimeout(300);
  await expect(page.locator('#heading')).toHaveText('Original heading');
  await expect(box).toBeVisible();

  await cover('remove');
  await answer(bar, 'Allow');
  await expect(page.locator('#heading')).toHaveText('Heading changed by click');
  await idle(bar);
  await page.close();
});

test('S8: synthetic key events from the page neither close nor open the overlay; real ones do', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await page.waitForTimeout(200);
  await expect(page.locator('carbon-commander-overlay')).toBeVisible();

  // Fallback shortcut Ctrl+Shift+Y (pushed by the worker to the content script).
  const setKeybind = (keybind: unknown): Promise<unknown> =>
    bar.evaluate(async (kb): Promise<unknown> => chrome.runtime.sendMessage({ rpc: 'settings.set', params: { patch: { keybind: kb } } }), keybind);
  await setKeybind({ key: 'y', ctrl: true, meta: false, alt: false, shift: true });
  await bar.getByRole('textbox', { name: 'Message' }).press('Escape');
  await expect(page.locator('carbon-commander-overlay')).toBeHidden();
  await page.locator('h1').click();
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Y', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })),
  );
  await page.waitForTimeout(300);
  await expect(page.locator('carbon-commander-overlay')).toBeHidden();
  await page.keyboard.press('Control+Shift+KeyY');
  await expect(page.locator('carbon-commander-overlay')).toBeVisible();
  await setKeybind(null);
  await page.close();
});

test('S5: content scripts cannot read extension storage; legacy secrets moved to IndexedDB', async () => {
  const page = await openFixture();
  const sw = await serviceWorker();
  const tabId = await tabIdOf(page);
  const fromContentScript = await sw.evaluate(async (id) => {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: async () => {
        try {
          return `readable: ${Object.keys(await chrome.storage.local.get(null)).join(',')}`;
        } catch (err) {
          return `refused: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    });
    return r?.result as string;
  }, tabId);
  expect(fromContentScript).toMatch(/^refused: .*not allowed/);

  const bar = await openBar(page);
  expect(await bar.evaluate(async (): Promise<unknown> => chrome.runtime.sendMessage({ rpc: 'secrets.has', params: { name: 'ollama-key' } }))).toEqual({
    ok: true,
    result: true,
  });
  const localKeys = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
  expect(localKeys.filter((k) => k.startsWith('encrypted_') || k === '_cc_encryption_key')).toEqual([]);
  // The MCP token stored earlier is in IndexedDB, not in chrome.storage.
  expect(JSON.stringify(await sw.evaluate(async () => chrome.storage.local.get(null)))).not.toContain('e2e-token');
  await page.close();
});

test('S1: fetch_url asks first and names the destination host', async () => {
  const page = await openFixture();
  const bar = await openBar(page);
  await send(bar, 'fetch it');
  await confirmPrompt(bar, 'fetch_url', 'Built-in');
  await expect(bar.locator('.cc-confirm-title')).toContainText('It sends a request to example.com.');
  await answer(bar, 'Deny');
  await expect(assistantItems(bar).last()).toContainText('Fetch result: The user declined');
  await idle(bar);
  await page.close();
});

test('C1: with a modal <dialog> open on the page the bar stays usable, and page tools still click inside it', async () => {
  const page = await openFixture('/modal.html');
  await expect.poll(() => page.evaluate(() => document.querySelector(':modal') !== null)).toBe(true);
  const bar = await openBar(page);
  await send(bar, 'hello modal');
  await expect(assistantItems(bar).last().locator('strong')).toHaveText('world');
  await send(bar, 'dialogclick');
  await confirmPrompt(bar, 'click', 'Built-in');
  await answer(bar, 'Allow');
  await expect(page.locator('#dialog-status')).toHaveText('confirmed');
  await expect(assistantItems(bar).last()).toContainText('Dialog click: Clicked');
  await idle(bar);
  // Closing the bar gives the page its dialog back.
  await bar.getByRole('textbox', { name: 'Message' }).press('Escape');
  await expect(page.locator('carbon-commander-overlay')).toBeHidden();
  await expect(page.locator('#dlg')).toBeVisible();
  await page.close();
});

test('C2: the overlay survives the page replacing <body>, and comes back if its host is removed', async () => {
  const page = await openFixture();
  let bar = await openBar(page);
  await send(bar, 'hello turbo');
  await expect(assistantItems(bar).last()).toContainText('world');
  await idle(bar);
  await bar.getByRole('textbox', { name: 'Message' }).press('Escape');
  await page.evaluate(() => {
    const body = document.createElement('body');
    body.append(Object.assign(document.createElement('h1'), { textContent: 'Swapped body' }));
    document.body.replaceWith(body);
  });
  bar = await openBar(page);
  await expect(bar.locator('.cc-item-user').last()).toHaveText('hello turbo');
  await bar.getByRole('textbox', { name: 'Message' }).press('Escape');
  await page.evaluate(() => document.querySelector('carbon-commander-overlay')?.remove());
  bar = await openBar(page);
  await expect(bar.locator('.cc-item-user').last()).toHaveText('hello turbo');
  await page.close();
});

test('C4: find_elements lists cursor:pointer elements inside landmark roles and tabindex=-1 app roots', async () => {
  const page = await openFixture('/clickables.html');
  const bar = await openBar(page);
  await send(bar, 'find clickables');
  const last = assistantItems(bar).last();
  await expect(last).toContainText('clickable "Open card alpha"');
  await expect(last).toContainText('clickable "Open card beta"');
  await idle(bar);
  await page.close();
});

test('C7: a standalone bar shows that its tab was closed instead of hanging on "running"', async () => {
  const target = await openFixture();
  const tabId = await tabIdOf(target);
  const barTab = await context.newPage();
  await barTab.goto(`chrome-extension://${extensionId}/bar.html?tabId=${tabId}`);
  const main = barTab.mainFrame();
  await expect(main.locator('.cc-badge-conn')).toBeHidden();
  await send(main, 'slow while the tab closes');
  await expect(assistantItems(main).last()).toContainText('chunk1');
  await target.close();
  await expect(main.locator('.cc-tab-closed')).toBeVisible();
  await expect(main.locator('.cc-bar')).toHaveAttribute('data-state', 'idle');
  await expect(main.getByRole('textbox', { name: 'Message' })).toHaveJSProperty('readOnly', true);
  await barTab.close();
});

test('no console errors from the extension', () => {
  if (extensionWarnings.length) console.log(`Extension warnings (not failures):\n${extensionWarnings.join('\n')}`);
  expect(extensionErrors).toEqual([]);
});
