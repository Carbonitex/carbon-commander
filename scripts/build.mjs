#!/usr/bin/env node
/**
 * Builds the unpacked extension into dist/.
 *
 *   node scripts/build.mjs             development (sourcemaps, __DEV__ = true)
 *   node scripts/build.mjs --prod      production (minified, no sourcemaps, __DEV__ = false)
 *   node scripts/build.mjs --watch     development + rebuild on change
 *   node scripts/build.mjs --e2e       development + end-to-end test hooks (__E2E__ = true)
 *   --out <dir>                        output directory (default dist/)
 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

const argv = process.argv.slice(2);
const args = new Set(argv);
const outIndex = argv.indexOf('--out');
const dist = path.resolve(root, outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : 'dist');
const prod = args.has('--prod');
const watch = args.has('--watch');
const e2e = args.has('--e2e');
if (prod && (watch || e2e)) {
  console.error('--prod cannot be combined with --watch or --e2e');
  process.exit(1);
}

/** Files copied verbatim (src-relative -> dist-relative). The manifest is handled separately. */
const STATIC_FILES = [
  ['ui/bar.html', 'bar.html'],
  ...[16, 32, 48, 128].map((size) => [`icons/icon-${size}.png`, `icons/icon-${size}.png`]),
];

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  target: 'chrome120',
  platform: 'browser',
  minify: prod,
  sourcemap: prod ? false : 'linked',
  define: { __DEV__: prod ? 'false' : 'true', __E2E__: e2e ? 'true' : 'false' },
  logLevel: 'info',
  legalComments: prod ? 'eof' : 'inline',
  drop: prod ? ['debugger'] : [],
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  // Module service worker.
  { ...common, entryPoints: { background: path.join(src, 'background/index.ts') }, format: 'esm', outdir: dist },
  // Classic content script.
  { ...common, entryPoints: { content: path.join(src, 'content/index.ts') }, format: 'iife', outdir: dist },
  // Bar page; CSS imported from TS is emitted as bar.css.
  { ...common, entryPoints: { bar: path.join(src, 'ui/bar.ts') }, format: 'esm', outdir: dist },
  // WebMCP page API: MAIN-world document_start script, registered at runtime by the worker
  // (chrome.scripting.registerContentScripts, see src/webmcp/register.ts). Runs in every page:
  // kept tiny, no source map (the page's DevTools would try to load it).
  { ...common, entryPoints: { webmcp: path.join(src, 'webmcp/page-entry.ts') }, format: 'iife', outdir: dist, sourcemap: false },
];

/** Scripts the worker registers at runtime (not in the manifest); verified like manifest files. */
const DYNAMIC_SCRIPTS = ['webmcp.js'];

async function copyStatic() {
  for (const [from, to] of STATIC_FILES) {
    await mkdir(path.dirname(path.join(dist, to)), { recursive: true });
    await copyFile(path.join(src, from), path.join(dist, to));
  }
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(src, 'manifest.json'), 'utf8'));
  // Chrome versions are 1-4 dot-separated integers: drop any pre-release suffix.
  const version = String(pkg.version).split('-')[0];
  if (manifest.version !== version) {
    console.warn(`warning: src/manifest.json version ${manifest.version} != package.json ${version}; using ${version}`);
    manifest.version = version;
  }
  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

/** Every file the manifest references must exist in dist/. */
async function verifyManifest() {
  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
  const files = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
    ...(manifest.web_accessible_resources ?? []).flatMap((w) => w.resources ?? []),
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...DYNAMIC_SCRIPTS,
  ].filter(Boolean);
  const missing = [];
  for (const f of files) {
    if (f.includes('*')) continue;
    try {
      await stat(path.join(dist, f));
    } catch {
      missing.push(f);
    }
  }
  if (missing.length) throw new Error(`dist/manifest.json references missing files: ${missing.join(', ')}`);
}

async function buildOnce() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await Promise.all(builds.map((b) => esbuild.build(b)));
  await copyStatic();
  await verifyManifest();
}

async function buildWatch() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await copyStatic();
  await Promise.all(contexts.map((c) => c.watch()));
  // esbuild only watches imported files; watch the static ones ourselves.
  for (const file of ['manifest.json', ...STATIC_FILES.map(([from]) => from)]) {
    fsWatch(path.join(src, file), () => {
      copyStatic().then(
        () => console.log(`copied ${file}`),
        (err) => console.error(err),
      );
    });
  }
  console.log('watching for changes...');
}

try {
  if (watch) await buildWatch();
  else {
    await buildOnce();
    console.log(`built ${path.relative(root, dist) || '.'}/ (${prod ? 'production' : e2e ? 'development + e2e hooks' : 'development'})`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
