/* eslint-disable @typescript-eslint/unbound-method -- expect(mock) / toString() on method references is intended in tests */
/**
 * Page tools are serialised with `Function.prototype.toString` and evaluated in the page by
 * `chrome.scripting.executeScript`. This test reproduces that: it bundles the tools the way the
 * production build does (esbuild, minified), then re-creates every page tool's `run` from its
 * source text alone inside a separate jsdom realm and runs it. Any reference to module scope
 * (a hoisted helper, an imported constant, an esbuild runtime helper such as `__name`) would
 * throw a ReferenceError there.
 */
import { describe, expect, it } from 'vitest';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';

import type { PageToolDefinition, ToolResult } from '../../src/shared/types';

const entry = decodeURIComponent(new URL('../../src/tools/generic/index.ts', import.meta.url).pathname);

async function bundle(keepNames: boolean): Promise<{ genericPageTools: PageToolDefinition[] }> {
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    minify: true,
    keepNames,
    format: 'iife',
    globalName: '__ccTools',
    platform: 'browser',
    target: 'chrome120',
    define: { __DEV__: 'false' },
    logLevel: 'silent',
  });
  const code = out.outputFiles[0]?.text ?? '';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating our own bundle is the point of this test
  return (new Function(`${code}; return __ccTools;`) as () => unknown)() as { genericPageTools: PageToolDefinition[] };
}

const FIXTURE = `<!doctype html><html><head><title>Inject</title></head><body>
  <main><h1>Heading</h1><p>${'Some readable text. '.repeat(20)}</p>
  <form><label>Name <input id="name"></label><select aria-label="Pick"><option>One</option><option>Two</option></select></form>
  <button id="go">Go</button><div contenteditable="true" aria-label="Ed">x</div></main></body></html>`;

function realm(): JSDOM {
  const dom = new JSDOM(FIXTURE, { runScripts: 'outside-only', url: 'https://example.test/page' });
  dom.window.eval(`
    Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 10, top: 10, left: 10, width: 100, height: 20, right: 110, bottom: 30, toJSON() {} }; };
    Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
    Element.prototype.scrollIntoView = function () {};
    window.scrollTo = function () {};
  `);
  return dom;
}

/** Re-create `run` inside the realm from its source and call it with JSON-cloned args. */
async function runInRealm(dom: JSDOM, tool: PageToolDefinition, args: object): Promise<ToolResult> {
  const fn = dom.window.eval(`(${Function.prototype.toString.call(tool.run)})`) as (a: unknown) => unknown;
  const result = (await fn(JSON.parse(JSON.stringify(args)))) as ToolResult;
  // executeScript results must survive serialisation.
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  return result;
}

describe('page tool injection (minified build)', () => {
  it('every page tool runs from its source text alone', async () => {
    const { genericPageTools } = await bundle(false);
    const byName = new Map(genericPageTools.map((t) => [t.name, t]));
    expect(byName.size).toBeGreaterThanOrEqual(10);
    for (const t of genericPageTools) {
      expect(Function.prototype.toString.call(t.run), t.name).not.toMatch(/__name|__async|__publicField|__spread|__objRest/);
    }

    const dom = realm();
    const call = (name: string, args: object): Promise<ToolResult> => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`missing ${name}`);
      return runInRealm(dom, tool, args);
    };

    expect((await call('read_page', {})).content).toContain('# Heading');
    expect((await call('get_page_info', {})).content).toContain('URL: https://example.test/page');
    expect((await call('get_selection', {})).ok).toBe(true);
    const snapshot = await call('find_elements', {});
    expect(snapshot.ok).toBe(true);
    const ref = (needle: string): string => snapshot.content.split('\n').find((l) => l.includes(needle))?.split(' ')[0] ?? '';

    // Refs persist across separate injections in the same realm (like the isolated world).
    expect(await call('click', { ref: ref('"Go"') })).toMatchObject({ ok: true });
    expect(await call('type_text', { ref: ref('"Name"'), text: 'Ada' })).toMatchObject({ ok: true });
    expect(dom.window.document.querySelector<HTMLInputElement>('#name')?.value).toBe('Ada');
    expect(await call('type_text', { ref: ref('"Ed"'), text: 'rich' })).toMatchObject({ ok: true });
    expect(await call('select_option', { ref: ref('"Pick"'), option: 'Two' })).toMatchObject({ ok: true });
    expect(await call('press_key', { key: 'Escape' })).toMatchObject({ ok: true });
    expect(await call('scroll', { direction: 'down' })).toMatchObject({ ok: true });
    expect(await call('hover', { ref: ref('"Go"') })).toMatchObject({ ok: true });
  });

  it('documents why keepNames must stay off: it wraps inner helpers in a module-scope __name call', async () => {
    const { genericPageTools } = await bundle(true);
    const tool = genericPageTools.find((t) => t.name === 'find_elements');
    if (!tool) throw new Error('missing find_elements');
    const result = await runInRealm(realm(), tool, {});
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/is not defined/);
  });
});
