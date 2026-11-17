/**
 * The production bundle (`dist-prod/`, built by `npm run test:e2e` with `build.mjs --prod --out
 * dist-prod`): no test hooks, and the main path works. The detailed suite (smoke.spec.ts) runs on
 * the development build with e2e hooks; this file covers what differs in production (minified
 * bundles, `__DEV__` / `__E2E__` false) without any hook: the overlay is opened through the same
 * worker -> content-script message the toolbar button ends in.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import type { RunningHttpServer } from '../helpers/http-server';
import { startFixtureSite, startMockLlm, type MockLlm } from './servers';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist-prod');

let context: BrowserContext;
let worker: Worker;
let llm: MockLlm;
let site: RunningHttpServer;
const errors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await startFixtureSite();
  llm = await startMockLlm(site.origin);
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    viewport: { width: 1200, height: 900 },
    reducedMotion: 'reduce',
  });
  context.on('weberror', (err) => {
    const stack = err.error().stack ?? '';
    if (stack.includes('chrome-extension://')) errors.push(stack);
  });
  [worker] = context.serviceWorkers() as [Worker];
  worker ??= await context.waitForEvent('serviceworker');
});

test.afterAll(async () => {
  await context?.close();
  await Promise.all([llm?.close(), site?.close()]);
});

test('production bundle: no test hooks, the overlay opens and a chat round-trip works', async () => {
  expect(await worker.evaluate(() => typeof (globalThis as { __ccToggleOverlay?: unknown }).__ccToggleOverlay)).toBe('undefined');
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.icons).toMatchObject({ '16': 'icons/icon-16.png', '128': 'icons/icon-128.png' });

  const page = await context.newPage();
  await page.goto(`${site.origin}/`);
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error('no tab');
    await chrome.tabs.sendMessage(tab.id, { cc: 'overlay.toggle' }, { frameId: 0 });
  }, page.url());
  await expect(page.locator('carbon-commander-overlay')).toBeVisible();
  const prefix = `chrome-extension://${extensionId}/bar.html`;
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(prefix))).toBe(true);
  const bar = page.frames().find((f) => f.url().startsWith(prefix));
  if (!bar) throw new Error('no bar frame');
  // The mock UI is development-only.
  await expect(bar.locator('.cc-badge[data-status="mock"]')).toHaveCount(0);

  const setup = bar.getByRole('region', { name: 'Set up a model provider' });
  const custom = setup.locator('.cc-setup-option', { hasText: 'Custom OpenAI-compatible endpoint' });
  await custom.getByLabel('Base URL').fill(llm.baseUrl);
  await custom.getByRole('button', { name: 'Connect' }).click();
  await expect(custom.getByRole('status')).toContainText('1 models available');
  await custom.getByRole('combobox').selectOption('mock-model');
  await custom.getByRole('button', { name: 'Use this model' }).click();
  await expect(setup).toBeHidden();

  const input = bar.getByRole('textbox', { name: 'Message' });
  await input.fill('hello production');
  await input.press('Enter');
  await expect(bar.locator('.cc-item-assistant').last().locator('strong')).toHaveText('world');
  await page.close();
  expect(errors).toEqual([]);
});
