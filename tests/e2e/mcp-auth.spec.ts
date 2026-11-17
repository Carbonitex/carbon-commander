/* eslint-disable no-console -- prints extension warnings */
/**
 * End-to-end: MCP server discovery ("quick add") and OAuth sign-in, with the built extension in
 * Playwright's Chromium against local fixtures only: a scripted LLM, a site with a server card and
 * an anonymous MCP server, and a site with protected resource metadata, a mock OAuth authorization
 * server and an OAuth-protected MCP server.
 *
 * The interactive step is real: `chrome.identity.launchWebAuthFlow` opens its sign-in window (a
 * Playwright page), the test clicks "Allow" on the mock consent page, and Chrome intercepts the
 * redirect to `https://<id>.chromiumapp.org/mcp-oauth`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Frame, type Locator, type Page, type Worker } from '@playwright/test';
import { startOAuthMcpSite, type RunningOAuthMcpSite } from '../helpers/mock-oauth-server';
import { startCardSite, startScriptedLlm, type CardSite, type ScriptedLlm } from './mcp-auth-servers';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

let context: BrowserContext;
let extensionId = '';
let llm: ScriptedLlm;
let cardSite: CardSite;
let oauthSite: RunningOAuthMcpSite;
let lateSite: CardSite;
const extensionErrors: string[] = [];
const extensionWarnings: string[] = [];

test.describe.configure({ mode: 'serial' });
// The sign-in windows Chrome opens and closes by itself occasionally make Playwright's trace
// recorder fail at teardown (ENOENT on a trace chunk), which would leave this browser running into
// the next spec file. This spec does not record traces.
test.use({ trace: 'off' });

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function watchWorker(worker: Worker): void {
  worker.on('console', (msg) => {
    if (msg.type() === 'error') extensionErrors.push(`[worker] ${msg.text()}`);
    if (msg.type() === 'warning') extensionWarnings.push(`[worker] ${msg.text()}`);
  });
}

async function serviceWorker(): Promise<Worker> {
  const existing = context.serviceWorkers().filter((w) => w.url().startsWith(`chrome-extension://${extensionId}/`));
  for (const w of existing.reverse()) {
    const alive = await Promise.race([w.evaluate(() => true).catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    if (alive) return w;
  }
  const next = context.waitForEvent('serviceworker', { timeout: 15_000 });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/bar.html?tabId=0`).catch(() => undefined);
  const worker = await next;
  await page.close();
  return worker;
}

/** Call an RPC as the extension's own page would (a top-level bar tab is trusted). */
async function rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/bar.html?tabId=0`);
    const res = await page.evaluate(
      async ([m, p]) => chrome.runtime.sendMessage<unknown, { ok: boolean; result?: unknown; error?: { message: string } }>({ rpc: m, params: p }),
      [method, params] as const,
    );
    if (!res.ok) throw new Error(res.error?.message ?? 'rpc failed');
    return res.result as T;
  } finally {
    await page.close();
  }
}

async function tabIdOf(page: Page): Promise<number> {
  const sw = await serviceWorker();
  const url = page.url();
  const id = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  if (id === undefined) throw new Error(`No tab for ${url}`);
  return id;
}

async function openBar(page: Page): Promise<Frame> {
  const tabId = await tabIdOf(page);
  const sw = await serviceWorker();
  await sw.evaluate(async (id) => {
    await (globalThis as unknown as { __ccToggleOverlay(tabId: number): Promise<void> }).__ccToggleOverlay(id);
  }, tabId);
  const prefix = `chrome-extension://${extensionId}/bar.html`;
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(prefix))).toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith(prefix)) as Frame;
  await expect(frame.locator('.cc-chat')).toBeVisible();
  await expect(frame.locator('.cc-badge-conn')).toBeHidden();
  return frame;
}

async function send(bar: Frame, text: string): Promise<void> {
  await expect(bar.locator('.cc-bar')).toHaveAttribute('data-state', 'idle');
  const input = bar.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

async function allow(bar: Frame): Promise<void> {
  await expect(bar.locator('.cc-confirm-box')).toHaveAttribute('data-ready', 'true');
  await bar.getByRole('button', { name: 'Allow', exact: true }).click();
}

async function mcpPanel(bar: Frame): Promise<Locator> {
  await bar.getByRole('button', { name: 'Settings' }).click();
  await bar.getByRole('tab', { name: 'MCP' }).click();
  return bar.locator('#cc-panel-mcp');
}

async function backToChat(bar: Frame): Promise<void> {
  await bar.getByRole('button', { name: 'Back to chat' }).click();
}

interface Discovered {
  key: string;
  name: string;
  endpoint: string;
  auth: string;
  source: string;
  authorizationServer?: string;
}
interface ServerStatus {
  id: string;
  name: string;
  url: string;
  state: string;
  oauth?: { state: string; issuer?: string; error?: string };
}

const lastAssistant = (bar: Frame): Locator => bar.locator('.cc-item-assistant').last();
const refreshGrants = (): number => oauthSite.oauth.requests.filter((r) => r.form?.grant_type === 'refresh_token').length;

/** Wait for the sign-in window (`launchWebAuthFlow`) and approve on the mock consent page. */
async function approveSignIn(): Promise<void> {
  const authPage = await context.waitForEvent('page', { predicate: (p) => p.url().startsWith(`${oauthSite.origin}/oauth/authorize`), timeout: 20_000 });
  await expect(authPage.getByRole('heading', { name: 'Allow Carbon Commander?' })).toBeVisible();
  await authPage.getByRole('link', { name: 'Allow' }).click();
}

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

test.beforeAll(async () => {
  llm = await startScriptedLlm();
  cardSite = await startCardSite('Fixture Wiki');
  lateSite = await startCardSite('Late Site', { legacy: true }); // only the legacy well-known card
  oauthSite = await startOAuthMcpSite({ consent: 'page', scopesSupported: ['read', 'write'] });
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    viewport: { width: 1200, height: 900 },
    reducedMotion: 'reduce',
  });
  context.on('serviceworker', watchWorker);
  context.on('console', (msg) => {
    const url = msg.location().url;
    if (msg.type() === 'error' && url.startsWith('chrome-extension://')) extensionErrors.push(`[page ${url}] ${msg.text()}`);
    if (msg.type() === 'warning' && url.startsWith('chrome-extension://')) extensionWarnings.push(`[page ${url}] ${msg.text()}`);
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  watchWorker(sw);
  extensionId = new URL(sw.url()).host;
  await rpc('settings.set', {
    patch: {
      providers: { custom: { baseUrl: llm.baseUrl } },
      models: { chat: { provider: 'custom', model: 'mock-model' } },
      autocomplete: false,
    },
  });
});

test.afterAll(async () => {
  try {
    await context?.close();
  } finally {
    await Promise.all([llm?.close(), cardSite?.close(), lateSite?.close(), oauthSite?.close()]);
  }
});

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test('visiting sites lists their MCP servers under Discovered (AI catalog card + protected-resource shapes)', async () => {
  const wiki = await context.newPage();
  await wiki.goto(`${cardSite.origin}/wiki`);
  const tool = await context.newPage();
  await tool.goto(`${oauthSite.origin}/`);
  await expect
    .poll(async () => (await rpc<Discovered[]>('mcp.discovered.list')).map((d) => `${d.source}:${d.auth}:${d.endpoint}`).sort(), { timeout: 20_000 })
    .toEqual([`protected-resource:oauth:${oauthSite.mcpUrl}`, `catalog:none:${cardSite.origin}/mcp`].sort());
  // Discovery only fetched the two well-known documents, the card the catalog names on that site,
  // and probed the MCP endpoint (plus the REST API named by its protected resource metadata, which
  // is not MCP and was ignored).
  expect(cardSite.paths.filter((p) => p !== 'GET /wiki' && p !== 'GET /favicon.ico').sort()).toEqual(
    ['GET /.well-known/ai-catalog.json', 'GET /.well-known/oauth-protected-resource', 'GET /mcp/server-card', 'POST /mcp', 'POST /wiki'].sort(),
  );
  expect(cardSite.mcp.requests.every((r) => !r.headers.cookie && !r.headers.authorization)).toBe(true);

  // The bar on that site shows the hint; it leads to the Discovered list.
  const bar = await openBar(tool);
  const hint = bar.locator('.cc-badge-mcp');
  await expect(hint).toHaveText('MCP server available');
  await hint.click();
  const panel = bar.locator('#cc-panel-mcp');
  await expect(panel).toBeVisible();
  const found = panel.locator('[data-discovered]');
  await expect(found).toHaveCount(2);
  const wikiRow = found.filter({ hasText: 'Fixture Wiki' });
  await expect(wikiRow.locator('.cc-pill')).toHaveText('no sign-in');
  await expect(wikiRow).toContainText('“Fixture Wiki” is the name the site gives it.');
  const oauthRow = found.filter({ hasText: '127.0.0.1' }).filter({ hasText: 'OAuth metadata' });
  await expect(oauthRow.locator('.cc-pill')).toHaveText('sign-in required');
  await wiki.close();
  await tool.close();
});

test('quick add of the anonymous server, then a tool call through it', async () => {
  const page = await context.newPage();
  await page.goto(`${cardSite.origin}/wiki`);
  const bar = await openBar(page);
  await expect(bar.locator('.cc-badge-mcp')).toBeVisible();
  const panel = await mcpPanel(bar);
  const row = panel.locator('[data-discovered]', { hasText: 'Fixture Wiki' });
  await row.getByRole('button', { name: 'Add Fixture Wiki' }).click();
  await expect(row.locator('.cc-pill', { hasText: 'added' })).toBeVisible();
  // Named after its host: the card's own name does not match it (a card cannot pick "github").
  const server = panel.locator('.cc-mcp-server[data-server="localhost"]');
  await expect(server.locator('.cc-pill').first()).toHaveText('connected');
  await expect(server.locator('.cc-mcp-oauth')).toHaveCount(0); // anonymous: no sign-in UI
  await backToChat(bar);
  await expect(bar.locator('.cc-badge-mcp')).toBeHidden(); // added: no more hint

  await send(bar, 'call mcp__localhost__echo {"text":"hello wiki"}');
  await allow(bar);
  await expect(lastAssistant(bar)).toHaveText('Tool said: hello wiki');
  await page.close();
});

test('quick add of the OAuth server shows where it signs in and what it asks for; one click opens the real launchWebAuthFlow window', async () => {
  const page = await context.newPage();
  await page.goto(`${oauthSite.origin}/`);
  const bar = await openBar(page);
  const panel = await mcpPanel(bar);
  const row = panel.locator('[data-discovered]').filter({ hasText: 'OAuth metadata' });
  const pagesBefore = context.pages().length;
  await row.getByRole('button', { name: /^Add / }).click();
  await expect(panel.locator(':scope > .cc-status-line')).toHaveText('Added "127-0-0-1". It needs sign-in: check where it signs you in, then click Sign in.');
  expect(context.pages().length).toBe(pagesBefore); // no window before the user saw where it goes
  expect(oauthSite.oauth.clients.size).toBe(0); // nor a registration
  const server = panel.locator('.cc-mcp-server[data-server="127-0-0-1"]');
  const plan = server.locator('.cc-mcp-plan');
  await expect(plan).toContainText(`Sign-in opens a window at ${new URL(oauthSite.origin).host}.`);
  await expect(plan).toHaveAttribute('data-cross-site', 'false');
  await expect(plan).toContainText('Requests the checked scopes (the server asked for these)');
  // Leave "write" out: only "read" is requested.
  await server.getByRole('checkbox', { name: 'Scope write for 127-0-0-1' }).uncheck();
  const window = approveSignIn();
  await server.getByRole('button', { name: 'Sign in: 127-0-0-1' }).click();
  await window;
  await expect(server.locator('.cc-pill').first()).toHaveText('connected');
  await expect(server.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('signed in');
  await expect(server.locator('.cc-mcp-oauth > .cc-hint')).toContainText(`Signed in with ${new URL(oauthSite.origin).host}`);
  await expect(server.locator('.cc-mcp-oauth > .cc-hint')).toContainText('scope: read');
  expect([...oauthSite.oauth.accessTokens.values()].map((t) => t.scope)).toEqual(['read']);
  // One dynamic registration with the chromiumapp redirect URI, then the code flow with PKCE + resource.
  const reg = oauthSite.oauth.requests.find((r) => r.path === '/oauth/register')?.json as { redirect_uris: string[] };
  expect(reg.redirect_uris).toEqual([`https://${extensionId}.chromiumapp.org/mcp-oauth`]);
  const tokenReq = oauthSite.oauth.requests.find((r) => r.form?.grant_type === 'authorization_code')?.form;
  expect(tokenReq).toMatchObject({ resource: oauthSite.mcpUrl, redirect_uri: `https://${extensionId}.chromiumapp.org/mcp-oauth` });
  expect(tokenReq?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // The tokens are nowhere in extension storage or RPC results (only encrypted in IndexedDB).
  const access = [...oauthSite.oauth.accessTokens.keys()][0] as string;
  const sw = await serviceWorker();
  const storage = JSON.stringify(await sw.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) })));
  expect(storage).not.toContain(access);
  expect(JSON.stringify(await rpc('mcp.list'))).not.toContain(access);
  await page.close();
});

test('tool call with the token; an expired token is refreshed once and the call retried', async () => {
  const page = await context.newPage();
  await page.goto(`${oauthSite.origin}/`);
  const bar = await openBar(page);
  await send(bar, 'call mcp__127-0-0-1__add {"a":20,"b":22}');
  await allow(bar);
  await expect(lastAssistant(bar)).toHaveText('Tool said: 42');
  const access = [...oauthSite.oauth.accessTokens.keys()].at(-1) as string;
  expect(oauthSite.mcp.requests.some((r) => r.headers.authorization === `Bearer ${access}`)).toBe(true);

  const before = refreshGrants();
  oauthSite.oauth.expireAccessTokens(); // the server now answers 401 to the stored token
  await send(bar, 'call mcp__127-0-0-1__echo {"text":"after refresh"}');
  await allow(bar);
  await expect(lastAssistant(bar)).toHaveText('Tool said: after refresh');
  expect(refreshGrants()).toBe(before + 1);
  // The transcript never contains a token.
  expect(await bar.locator('.cc-transcript').textContent()).not.toMatch(/\bat-\d+-/);
  await page.close();
});

test('a revoked grant: the tool call tells the user to sign in (no window opens); sign out revokes; a cancelled sign-in is reported', async () => {
  const page = await context.newPage();
  await page.goto(`${oauthSite.origin}/`);
  const bar = await openBar(page);
  // The authorization server revokes everything; the tool list is still cached, so the model calls it.
  oauthSite.oauth.revokeAll();
  oauthSite.oauth.expireAccessTokens();
  const pagesBefore = context.pages().length;
  await send(bar, 'call mcp__127-0-0-1__echo {"text":"x"}');
  await allow(bar);
  await expect(lastAssistant(bar)).toContainText('requires sign-in. Tell the user to open Settings → MCP and click "Sign in"');
  expect(context.pages().length).toBe(pagesBefore); // never an interactive sign-in from the agent

  let panel = await mcpPanel(bar);
  const server = panel.locator('.cc-mcp-server[data-server="127-0-0-1"]');
  await expect(server.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('sign-in required');
  await expect(server.locator('.cc-mcp-oauth > .cc-hint')).toContainText('expired or was revoked');

  const window = approveSignIn();
  await server.getByRole('button', { name: 'Sign in: 127-0-0-1' }).click();
  await window;
  await expect(server.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('signed in');

  // Sign out: both tokens revoked at the authorization server, then deleted.
  const revokedBefore = oauthSite.oauth.revoked.length;
  await server.getByRole('button', { name: 'Sign out: 127-0-0-1' }).click();
  await expect(server.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('sign-in required');
  expect(oauthSite.oauth.revoked.length - revokedBefore).toBe(2);
  await backToChat(bar);
  // A signed-out server offers no tools to the model.
  await send(bar, 'call mcp__127-0-0-1__echo {"text":"x"}');
  await expect(lastAssistant(bar)).toContainText('Unknown tool "mcp__127-0-0-1__echo"');

  panel = await mcpPanel(bar);
  const again = panel.locator('.cc-mcp-server[data-server="127-0-0-1"]');
  const authPage = context.waitForEvent('page', { predicate: (p) => p.url().startsWith(`${oauthSite.origin}/oauth/authorize`) });
  await again.getByRole('button', { name: 'Sign in: 127-0-0-1' }).click();
  await (await authPage).close(); // the user closes the window
  await expect(again.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('sign-in failed');
  await expect(again.locator('.cc-mcp-oauth > .cc-hint')).toHaveText('Sign-in failed: Sign-in was cancelled (the window was closed).');

  // And signing in again works (the registration is reused).
  const window2 = approveSignIn();
  await again.getByRole('button', { name: 'Sign in: 127-0-0-1' }).click();
  await window2;
  await expect(again.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('signed in');
  expect(oauthSite.oauth.requests.filter((r) => r.path === '/oauth/register')).toHaveLength(1);
  await page.close();
});

test('a sign-in interrupted by a worker restart is reported and can be retried', async () => {
  const page = await context.newPage();
  await page.goto(`${oauthSite.origin}/`);
  const bar = await openBar(page);
  const panel = await mcpPanel(bar);
  const server = panel.locator('.cc-mcp-server[data-server="127-0-0-1"]');
  await server.getByRole('button', { name: 'Sign out: 127-0-0-1' }).click();
  await expect(server.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('sign-in required');

  const authPage = context.waitForEvent('page', { predicate: (p) => p.url().startsWith(`${oauthSite.origin}/oauth/authorize`) });
  await server.getByRole('button', { name: 'Sign in: 127-0-0-1' }).click();
  const win = await authPage;
  // Chrome stops the worker (crash, update...) while the user is in the sign-in window.
  const cdp = await context.newCDPSession(page);
  const versions: { versionId: string; scriptURL: string; runningStatus: string }[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => versions.push(...e.versions));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.some((v) => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && v.runningStatus === 'running')).toBe(true);
  for (const v of versions.filter((x) => x.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && x.runningStatus === 'running')) {
    await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  }
  await cdp.detach();
  await expect(server.getByRole('status')).not.toHaveText('Finish signing in in the window that opened…', { timeout: 20_000 });
  if (!win.isClosed()) await win.close();
  const fresh = (await rpc<ServerStatus[]>('mcp.list')).find((s) => s.name === '127-0-0-1');
  expect(fresh?.oauth?.state).toBe('interrupted');
  await page.close();

  const page2 = await context.newPage();
  await page2.goto(`${oauthSite.origin}/`);
  const bar2 = await openBar(page2);
  const panel2 = await mcpPanel(bar2);
  const row = panel2.locator('.cc-mcp-server[data-server="127-0-0-1"]');
  await expect(row.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('sign-in interrupted');
  const window = approveSignIn();
  await row.getByRole('button', { name: 'Sign in: 127-0-0-1' }).click();
  await window;
  await expect(row.locator('.cc-mcp-oauth > .cc-row > .cc-pill')).toHaveText('signed in');
  await page2.close();
});

test('with discovery switched off, visited sites are not contacted', async () => {
  const page = await context.newPage();
  await page.goto(`${cardSite.origin}/`);
  const bar = await openBar(page);
  const panel = await mcpPanel(bar);
  await panel.getByRole('checkbox', { name: 'Look for MCP servers on sites I visit' }).uncheck();
  await panel.getByRole('button', { name: 'Forget discovered servers' }).click();
  await expect(panel.locator('[data-discovered]')).toHaveCount(0);
  await expect(panel.getByText('Discovery is off.')).toBeVisible();
  expect((await rpc<{ mcpDiscovery: boolean }>('settings.get')).mcpDiscovery).toBe(false);

  const late = await context.newPage();
  await late.goto(`${lateSite.origin}/`);
  await late.waitForTimeout(1500);
  expect(lateSite.paths.filter((p) => p !== 'GET /favicon.ico')).toEqual(['GET /']);
  expect(await rpc<Discovered[]>('mcp.discovered.list')).toEqual([]);

  // Switched back on, the next visit finds it.
  await panel.getByRole('checkbox', { name: 'Look for MCP servers on sites I visit' }).check();
  await late.reload();
  // That site has no catalog (401) and advertises its server only at the legacy well-known card.
  await expect
    .poll(async () => (await rpc<Discovered[]>('mcp.discovered.list')).map((d) => `${d.source}:${d.auth}:${d.name}`), { timeout: 20_000 })
    .toContain('server-card:none:Late Site');
  expect(lateSite.paths.filter((p) => p.includes('well-known')).sort()).toEqual(
    ['GET /.well-known/ai-catalog.json', 'GET /.well-known/mcp/server-card.json', 'GET /.well-known/oauth-protected-resource'].sort(),
  );
  await late.close();
  await page.close();
});

test('no console errors from the extension', () => {
  if (extensionWarnings.length) console.log(`Extension warnings (not failures):\n${extensionWarnings.join('\n')}`);
  expect(extensionErrors).toEqual([]);
});
