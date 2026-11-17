import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __DEV__: 'true', __E2E__: 'false' },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
