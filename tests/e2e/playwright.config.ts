import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke test: the built extension (dist/) in Playwright's bundled Chromium, against
 * local mock servers. Run with `npm run test:e2e` (builds first). Kept out of `npm test`.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]] : 'list',
  outputDir: '../../test-results',
  use: { trace: 'retain-on-failure' },
});
