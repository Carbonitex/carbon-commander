/** Build-time constant: true for `npm run build` / `watch` / tests, false for `build:prod`. */
declare const __DEV__: boolean;

/**
 * Build-time constant: true only for the end-to-end test build (`build.mjs --e2e`), which exposes
 * test hooks (e.g. `__ccToggleOverlay` in the worker). False everywhere else, so the hooks are
 * removed from development and production bundles.
 */
declare const __E2E__: boolean;

/** CSS imports are bundled by esbuild into `<entry>.css`. */
declare module '*.css';
