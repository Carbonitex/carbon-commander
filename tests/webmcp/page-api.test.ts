/** The MAIN-world `document.modelContext` implementation (page-api.ts), on fresh jsdom windows. */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { installModelContext } from '../../src/webmcp/page-api';

type Win = Window & typeof globalThis;

interface RegisteredToolLike {
  name: string;
  title: string | null;
  description: string;
  inputSchema: Record<string, unknown> | null;
  annotations: Record<string, boolean>;
  window: unknown;
  origin: string;
}
interface Mc extends EventTarget {
  registerTool(tool: unknown, options?: unknown): Promise<undefined>;
  getTools(): Promise<RegisteredToolLike[]>;
  executeTool(tool: unknown, input?: unknown, options?: unknown): Promise<string>;
  ontoolchange: ((e: Event) => void) | null;
}

function page(url = 'https://shop.example/catalog'): { win: Win; mc: Mc } {
  const dom = new JSDOM('<!doctype html><p>x</p>', { url });
  const win = dom.window;
  expect(installModelContext(win)).toBe('installed');
  return { win, mc: (win.document as unknown as { modelContext: Mc }).modelContext };
}

const tool = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name,
  description: `${name} tool`,
  execute: (input: unknown) => ({ echo: input }),
  ...extra,
});

const errorName = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e as { name: string }).name,
  );

const nextTask = (win: Win): Promise<void> => new Promise((r) => win.setTimeout(r, 0));

describe('installModelContext', () => {
  it('installs document.modelContext as a same-object accessor on Document.prototype (plus the navigator shim)', () => {
    const { win, mc } = page();
    expect('modelContext' in win.document).toBe(true);
    expect(Object.getOwnPropertyDescriptor(win.document, 'modelContext')).toBeUndefined();
    expect(typeof Object.getOwnPropertyDescriptor(win.Document.prototype, 'modelContext')?.get).toBe('function');
    expect((win.document as unknown as { modelContext: Mc }).modelContext).toBe(mc);
    // The compatibility shim is a separate object, not the current API.
    expect('modelContext' in win.navigator).toBe(true);
    expect((win.navigator as unknown as { modelContext: unknown }).modelContext).not.toBe(mc);
    expect(Object.prototype.toString.call(mc)).toBe('[object ModelContext]');
    expect(mc).toBeInstanceOf(win.EventTarget);
    // Not constructible by the page.
    expect(() => new (mc.constructor as new () => unknown)()).toThrow(TypeError);
  });

  it('leaves a native implementation alone', () => {
    const dom = new JSDOM('', { url: 'https://a.example/' });
    const native = { native: true };
    Object.defineProperty(dom.window.Document.prototype, 'modelContext', { get: () => native, configurable: true });
    expect(installModelContext(dom.window)).toBe('native');
    expect((dom.window.document as unknown as { modelContext: unknown }).modelContext).toBe(native);
    expect('modelContext' in dom.window.navigator).toBe(false); // no shim over a native implementation
  });

  it('skips insecure contexts and frames, and never throws', () => {
    const dom = new JSDOM('', { url: 'http://insecure.example/' });
    Object.defineProperty(dom.window, 'isSecureContext', { value: false });
    expect(installModelContext(dom.window)).toBe('skipped');
    expect('modelContext' in dom.window.document).toBe(false);
    expect(installModelContext({} as Win)).toBe('skipped');
    expect(installModelContext(null as unknown as Win)).toBe('skipped');
  });
});

describe('registerTool', () => {
  it('registers, lists sorted by name with a fresh schema copy, and fires toolchange as a task', async () => {
    const { win, mc } = page();
    const events: string[] = [];
    mc.addEventListener('toolchange', () => events.push('listener'));
    mc.ontoolchange = () => events.push('handler');
    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    await expect(mc.registerTool(tool('zeta', { title: 'Zeta', inputSchema: schema, annotations: { readOnlyHint: true } }))).resolves.toBeUndefined();
    await mc.registerTool(tool('alpha'));
    expect(events).toEqual([]); // queued, not synchronous
    await nextTask(win);
    expect(events).toEqual(['listener', 'handler', 'listener', 'handler']);
    schema.properties.q.type = 'number'; // later page changes do not count
    const tools = await mc.getTools();
    expect(tools.map((t) => t.name)).toEqual(['alpha', 'zeta']);
    const zeta = tools[1]!;
    expect(zeta).toMatchObject({ title: 'Zeta', description: 'zeta tool', origin: 'https://shop.example' });
    expect(zeta.inputSchema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
    expect(zeta.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false, consequentialHint: false, debugging: false });
    expect(zeta.window).toBe(win);
    expect(tools[0]!.inputSchema).toBeNull();
    expect(Object.isFrozen(zeta)).toBe(true);
  });

  it('rejects (never throws) like the draft and Chrome', async () => {
    const { mc } = page();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cases: [unknown, string][] = [
      [undefined, 'TypeError'],
      ['tool', 'TypeError'],
      [{ name: 'x', description: 'd' }, 'TypeError'], // no execute
      [{ name: 'x', execute() {} }, 'TypeError'], // no description
      [tool('bad name'), 'InvalidStateError'],
      [tool('a'.repeat(129)), 'InvalidStateError'],
      [tool(''), 'InvalidStateError'],
      [tool('x', { description: '' }), 'InvalidStateError'],
      [tool('x', { inputSchema: 5 }), 'TypeError'],
      [tool('x', { inputSchema: cyclic }), 'TypeError'],
    ];
    for (const [input, name] of cases) {
      let threw = false;
      let result: Promise<unknown> | undefined;
      try {
        result = mc.registerTool(input);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      expect(await errorName(result!)).toBe(name);
    }
    await mc.registerTool(tool('ok.name-1_x'));
    expect(await errorName(mc.registerTool(tool('ok.name-1_x')))).toBe('InvalidStateError'); // duplicate
    expect((await mc.getTools()).map((t) => t.name)).toEqual(['ok.name-1_x']);
    // Wrong `this`: rejected, not thrown.
    const detached = mc.registerTool.bind(undefined);
    expect(await errorName(detached(tool('y')))).toBe('TypeError');
  });

  it('unregisters when the signal aborts; an already-aborted signal rejects with its reason', async () => {
    const { win, mc } = page();
    const ac = new win.AbortController();
    await mc.registerTool(tool('a'), { signal: ac.signal });
    await mc.registerTool(tool('b'));
    await nextTask(win); // the two registrations' toolchange events
    let changes = 0;
    mc.addEventListener('toolchange', () => changes++);
    ac.abort();
    expect((await mc.getTools()).map((t) => t.name)).toEqual(['b']);
    await nextTask(win);
    expect(changes).toBe(1);
    // Re-registering the same name after abort works (SPA re-registration).
    const ac2 = new win.AbortController();
    await mc.registerTool(tool('a'), { signal: ac2.signal });
    expect((await mc.getTools()).map((t) => t.name)).toEqual(['a', 'b']);
    const aborted = new win.AbortController();
    aborted.abort(new Error('nope'));
    await expect(mc.registerTool(tool('c'), { signal: aborted.signal })).rejects.toThrow('nope');
    expect(await errorName(mc.registerTool(tool('d'), { signal: 'x' }))).toBe('TypeError');
  });
});

describe('executeTool', () => {
  it('runs execute(input, { signal }) and serialises like Chrome (strings as is, the rest as JSON)', async () => {
    const { win, mc } = page();
    let seen: unknown[] = [];
    await mc.registerTool(
      tool('obj', {
        execute(this: unknown, input: unknown, options: { signal: AbortSignal }) {
          seen = [this, input, options.signal instanceof win.AbortSignal, Object.keys(options)];
          return Promise.resolve({ content: [{ type: 'text', text: 'hi' }] });
        },
      }),
    );
    await mc.registerTool(tool('str', { execute: () => 'plain text' }));
    await mc.registerTool(tool('undef', { execute: () => undefined }));
    const tools = await mc.getTools();
    const get = (n: string) => tools.find((t) => t.name === n);
    expect(await mc.executeTool(get('obj'), { q: 1 })).toBe('{"content":[{"type":"text","text":"hi"}]}');
    expect(seen).toEqual([undefined, { q: 1 }, true, ['signal']]);
    expect(await mc.executeTool(get('str'))).toBe('plain text');
    expect(await mc.executeTool(get('undef'), {})).toBe('undefined');
  });

  it('only accepts tools from getTools, and reports removed tools as NotFoundError', async () => {
    const { win, mc } = page();
    const ac = new win.AbortController();
    await mc.registerTool(tool('a'), { signal: ac.signal });
    const [a] = await mc.getTools();
    expect(await errorName(mc.executeTool({ name: 'a', description: 'x', window: win, origin: 'https://shop.example' }))).toBe('TypeError');
    expect(await errorName(mc.executeTool(a, 'not an object'))).toBe('TypeError');
    ac.abort();
    expect(await errorName(mc.executeTool(a, {}))).toBe('NotFoundError');
  });

  it('maps throws and rejections to OperationError (with the message), unserialisable results too', async () => {
    const { mc } = page();
    await mc.registerTool(tool('throws', { execute: () => { throw new Error('kaboom'); } }));
    await mc.registerTool(tool('rejects', { execute: () => Promise.reject(new Error('later')) }));
    await mc.registerTool(tool('bigint', { execute: () => ({ n: 1n }) }));
    const tools = await mc.getTools();
    for (const [name, message] of [['throws', 'kaboom'], ['rejects', 'later'], ['bigint', 'serialized']] as const) {
      const err = await mc.executeTool(tools.find((t) => t.name === name), {}).then(
        () => null,
        (e: unknown) => e as { name: string; message: string },
      );
      expect(err?.name).toBe('OperationError');
      expect(err?.message).toContain(message);
    }
  });

  it('aborting the caller signal aborts the tool signal and rejects', async () => {
    const { win, mc } = page();
    let toolSignal: AbortSignal | null = null;
    await mc.registerTool(
      tool('hang', {
        execute: (_i: unknown, o: { signal: AbortSignal }) => {
          toolSignal = o.signal;
          return new Promise(() => undefined);
        },
      }),
    );
    const [hang] = await mc.getTools();
    const ac = new win.AbortController();
    const pending = mc.executeTool(hang, {}, { signal: ac.signal });
    ac.abort(new win.DOMException('stop', 'AbortError'));
    expect(await errorName(pending)).toBe('AbortError');
    expect(toolSignal!.aborted).toBe(true);
    const done = new win.AbortController();
    done.abort();
    expect(await errorName(mc.executeTool(hang, {}, { signal: done.signal }))).toBe('AbortError');
  });

  it('keeps working after the page patches globals it relies on', async () => {
    const { win, mc } = page();
    await mc.registerTool(tool('a', { execute: () => ({ ok: 1 }) }));
    // jsdom windows share this realm's JSON: restore it for the tests that follow.
    const original = win.JSON.stringify;
    try {
      (win.JSON as { stringify: unknown }).stringify = () => 'patched';
      win.setTimeout = (() => 0) as unknown as typeof win.setTimeout;
      const [a] = await mc.getTools();
      expect(await mc.executeTool(a, {})).toBe('{"ok":1}');
    } finally {
      win.JSON.stringify = original;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Compatibility shim: navigator.modelContext (earlier drafts / Chrome's early preview)
// ---------------------------------------------------------------------------------------------

interface LegacyMc {
  provideContext(options?: unknown): void;
  clearContext(): void;
  registerTool(tool: unknown): void;
  unregisterTool(name: string): void;
}

const legacyOf = (win: Win): LegacyMc => (win.navigator as unknown as { modelContext: LegacyMc }).modelContext;
const thrownName = (fn: () => unknown): string => {
  try {
    fn();
    return 'none';
  } catch (e) {
    return (e as { name: string }).name;
  }
};

describe('navigator.modelContext compatibility shim', () => {
  it('old-style tools (execute(args, client), MCP-style results) are listed and run through document.modelContext', async () => {
    const { win, mc } = page();
    const legacy = legacyOf(win);
    expect(Object.prototype.toString.call(legacy)).toBe('[object ModelContext]');
    expect(Object.isFrozen(legacy)).toBe(true);
    let client: { requestUserInteraction(cb: () => unknown): Promise<unknown>; signal: AbortSignal } | null = null;
    // The explainer's own example, as written then.
    legacy.provideContext({
      tools: [
        {
          name: 'add-todo',
          description: 'Add a new todo item to the list',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          async execute({ text }: { text: string }, agent: NonNullable<typeof client>) {
            client = agent;
            const ok = await agent.requestUserInteraction(async () => `confirmed ${text}`);
            return { content: [{ type: 'text', text: `Added todo: ${text} (${String(ok)})` }] };
          },
        },
      ],
    });
    legacy.registerTool({ name: 'buyProduct', description: 'Buy', execute: ({ product_id }: { product_id: string }) => `Product ${product_id} purchased.` });
    const tools = await mc.getTools();
    expect(tools.map((t) => t.name)).toEqual(['add-todo', 'buyProduct']);
    expect(tools[0]?.inputSchema).toEqual({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] });
    expect(JSON.parse(await mc.executeTool(tools[0], { text: 'milk' }))).toEqual({ content: [{ type: 'text', text: 'Added todo: milk (confirmed milk)' }] });
    expect(client!.signal).toBeInstanceOf(win.AbortSignal);
    expect(await mc.executeTool(tools[1], { product_id: 'p1' })).toBe('Product p1 purchased.');
  });

  it('provideContext replaces every tool (both APIs), atomically; clearContext / unregisterTool; toolchange fires', async () => {
    const { win, mc } = page();
    const legacy = legacyOf(win);
    let changes = 0;
    mc.addEventListener('toolchange', () => changes++);
    await mc.registerTool(tool('modern'));
    legacy.registerTool(tool('old'));
    legacy.provideContext({ tools: [tool('a'), tool('b')] });
    expect((await mc.getTools()).map((t) => t.name)).toEqual(['a', 'b']);
    // A bad list changes nothing.
    expect(thrownName(() => legacy.provideContext({ tools: [tool('c'), tool('c')] }))).toBe('InvalidStateError');
    expect(thrownName(() => legacy.provideContext({ tools: [tool('d'), { name: 'e' }] }))).toBe('TypeError');
    expect(thrownName(() => legacy.provideContext({ tools: [tool('bad name')] }))).toBe('InvalidStateError');
    expect((await mc.getTools()).map((t) => t.name)).toEqual(['a', 'b']);
    // Synchronous errors, like the old API.
    expect(thrownName(() => legacy.registerTool(tool('a')))).toBe('InvalidStateError');
    expect(thrownName(() => legacy.registerTool(tool('x', { description: '' })))).toBe('InvalidStateError');
    legacy.unregisterTool('a');
    legacy.unregisterTool('not-there');
    expect((await mc.getTools()).map((t) => t.name)).toEqual(['b']);
    legacy.clearContext();
    expect(await mc.getTools()).toEqual([]);
    legacy.provideContext();
    await nextTask(win);
    expect(changes).toBe(6); // register, register, provide, unregister, clear, provide (empty)
  });

  it('is not installed when the navigator already has a modelContext, and the page cannot use it to reach anything else', async () => {
    const dom = new JSDOM('', { url: 'https://a.example/' });
    const theirs = { theirs: true };
    Object.defineProperty(dom.window.Navigator.prototype, 'modelContext', { get: () => theirs, configurable: true });
    expect(installModelContext(dom.window)).toBe('installed');
    expect((dom.window.navigator as unknown as { modelContext: unknown }).modelContext).toBe(theirs);

    const { win } = page();
    const legacy = legacyOf(win);
    expect(Object.getPrototypeOf(legacy)).toBeNull();
    expect(Object.keys(legacy).sort()).toEqual(['clearContext', 'provideContext', 'registerTool', 'unregisterTool']);
  });
});
