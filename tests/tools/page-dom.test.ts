// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- expect(mock) / toString() on method references is intended in tests */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { click, pressKey, selectOption, typeText } from '../../src/tools/generic/page-actions';
import { findElements } from '../../src/tools/generic/page-elements';
import { getPageInfo, getSelection, readPage } from '../../src/tools/generic/page-read';
import type { ToolResult } from '../../src/shared/types';
import { installFakeLayout, resetRefs } from './dom-helpers';

beforeAll(installFakeLayout);
beforeEach(() => {
  resetRefs();
  document.title = 'Fixture';
  document.body.innerHTML = '';
});

const run = <A>(tool: { run: (a: A) => ToolResult | Promise<ToolResult> }, args: A): ToolResult => tool.run(args) as ToolResult;

/** Ref of the first find_elements row whose line contains `needle`. */
function refOf(content: string, needle: string): string {
  const line = content.split('\n').find((l) => l.includes(needle));
  if (!line) throw new Error(`no element line containing ${needle}:\n${content}`);
  return line.split(' ')[0] ?? '';
}

describe('read_page', () => {
  it('renders headings, links, lists, tables and code, skipping nav/script/hidden', () => {
    document.body.innerHTML = `
      <nav><a href="/home">Home nav link</a></nav>
      <h1>Main title</h1>
      <p>Hello <strong>world</strong>, see <a href="https://example.com/docs">the docs</a>.</p>
      <script>var secret = 1;</script>
      <style>.x{}</style>
      <div style="display:none">hidden text</div>
      <div hidden>also hidden</div>
      <ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>
      <ol start="3"><li>three</li></ol>
      <table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apple</td><td>2</td></tr></table>
      <pre><code>const x = 1;\nfoo();</code></pre>
      <blockquote><p>quoted</p></blockquote>`;
    const r = run(readPage, { selector: 'body' });
    expect(r.ok).toBe(true);
    const c = r.content;
    expect(c).toContain('Title: Fixture');
    expect(c).toContain('# Main title');
    expect(c).toContain('Hello world, see [the docs](https://example.com/docs).');
    expect(c).toContain('- one\n- two\n  - nested');
    expect(c).toContain('3. three');
    expect(c).toContain('| Name | Qty |');
    expect(c).toContain('| Apple | 2 |');
    expect(c).toContain('```\nconst x = 1;\nfoo();\n```');
    expect(c).toContain('> quoted');
    expect(c).not.toContain('Home nav link');
    expect(c).not.toContain('secret');
    expect(c).not.toContain('hidden text');
    expect(c).not.toContain('also hidden');
  });

  it('defaults to <main> when it has content', () => {
    document.body.innerHTML = `<header>Site header</header><main><p>${'Article text. '.repeat(30)}</p></main><footer>Footer</footer>`;
    const r = run(readPage, {});
    expect(r.content).toContain('Article text.');
    expect(r.content).not.toContain('Site header');
    expect(r.content).toContain('Scope: main content region');
  });

  it('paginates with offset and reports the continuation', () => {
    document.body.innerHTML = Array.from({ length: 200 }, (_, i) => `<p>Paragraph number ${i} with some filler text.</p>`).join('');
    const first = run(readPage, { selector: 'body', max_chars: 1000 });
    const m = /call read_page with offset=(\d+)/.exec(first.content);
    expect(m).not.toBeNull();
    const next = run(readPage, { selector: 'body', max_chars: 1000, offset: Number(m?.[1]) });
    expect(next.ok).toBe(true);
    expect(next.content).not.toContain('Paragraph number 0 ');
    expect(next.content).toMatch(/Paragraph number \d+/);
  });

  it('reports a bad or missing selector', () => {
    expect(run(readPage, { selector: '##' }).ok).toBe(false);
    expect(run(readPage, { selector: '#nope' }).content).toContain('No element matches');
  });

  it('reads open shadow roots', () => {
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>Inside the shadow</p>';
    document.body.append(host);
    expect(run(readPage, { selector: 'body' }).content).toContain('Inside the shadow');
  });
});

describe('find_elements + refs', () => {
  const fixture = `
    <a href="/about">About us</a>
    <button aria-label="Close dialog">x</button>
    <label for="email">Email</label><input id="email" type="email" placeholder="you@example.com">
    <input type="password" value="hunter2" aria-label="Password">
    <input type="checkbox" checked aria-label="Remember me">
    <input type="hidden" name="csrf" value="t">
    <select aria-label="Country"><option value="us">United States</option><option value="fr" selected>France</option></select>
    <textarea aria-label="Message"></textarea>
    <div contenteditable="true" aria-label="Editor"><p>rich</p></div>
    <div role="button">Role button</div>
    <button style="display:none">Hidden button</button>
    <button data-test-top="5000">Far below</button>`;

  it('lists visible interactive elements with roles, names and state', () => {
    document.body.innerHTML = fixture;
    const r = run(findElements, {});
    expect(r.ok).toBe(true);
    const c = r.content;
    expect(c).toMatch(/^e\d+ link "About us" → \/about$/m);
    expect(c).toMatch(/e\d+ button "Close dialog"/);
    expect(c).toMatch(/e\d+ textbox "Email" placeholder="you@example.com" type=email/);
    expect(c).toMatch(/e\d+ textbox "Password" value="•+" type=password/);
    expect(c).not.toContain('hunter2');
    expect(c).toMatch(/e\d+ checkbox "Remember me" checked/);
    expect(c).toMatch(/e\d+ combobox "Country" selected="France" 2 options/);
    expect(c).toMatch(/e\d+ textbox "Editor" text="rich"/);
    expect(c).toMatch(/e\d+ button "Role button"/);
    expect(c).toMatch(/e\d+ button "Far below" \(offscreen\)/);
    expect(c).not.toContain('Hidden button');
    expect(c).not.toContain('csrf');
  });

  it('filters by query and keeps refs stable across snapshots', () => {
    document.body.innerHTML = fixture;
    const a = run(findElements, {});
    const b = run(findElements, { query: 'about' });
    expect(b.content.split('\n')).toHaveLength(2);
    expect(refOf(b.content, 'About us')).toBe(refOf(a.content, 'About us'));
  });

  it('lists in-viewport elements first when limited', () => {
    document.body.innerHTML = '<button data-test-top="5000">Low</button><button>High</button>';
    const r = run(findElements, { limit: 1 });
    expect(r.content).toContain('"High"');
    expect(r.content).not.toContain('"Low"');
    expect(r.content).toContain('showing 1');
  });

  it('reports unknown and stale refs clearly', () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    expect(run(click, { ref: 'e999' }).content).toMatch(/Unknown ref "e999".*find_elements/);
    const ref = refOf(run(findElements, {}).content, '"Go"');
    document.getElementById('b')?.remove();
    const stale = run(click, { ref });
    expect(stale.ok).toBe(false);
    expect(stale.content).toContain('no longer on the page');
  });
});

describe('click', () => {
  it('clicks by ref, text and selector with full event sequence', () => {
    document.body.innerHTML = '<button id="b">Save changes</button>';
    const btn = document.getElementById('b') as HTMLButtonElement;
    const events: string[] = [];
    for (const t of ['mousedown', 'mouseup', 'click']) btn.addEventListener(t, () => events.push(t));
    const ref = refOf(run(findElements, {}).content, 'Save changes');
    expect(run(click, { ref }).content).toBe('Clicked button "Save changes".');
    expect(events).toEqual(['mousedown', 'mouseup', 'click']);
    expect(run(click, { text: 'save changes' }).ok).toBe(true);
    expect(run(click, { selector: '#b' }).ok).toBe(true);
    expect(events.filter((e) => e === 'click')).toHaveLength(3);
  });

  it('refuses disabled elements and missing targets', () => {
    document.body.innerHTML = '<button disabled>Nope</button>';
    expect(run(click, { text: 'Nope' }).content).toContain('disabled');
    expect(run(click, { text: 'Missing' }).ok).toBe(false);
    expect(run(click, {}).ok).toBe(false);
  });

  it('toggles a checkbox through its default action', () => {
    document.body.innerHTML = '<input type="checkbox" aria-label="Agree">';
    const ref = refOf(run(findElements, {}).content, 'Agree');
    run(click, { ref });
    expect((document.querySelector('input') as HTMLInputElement).checked).toBe(true);
  });
});

describe('type_text', () => {
  /** Simulates React's value tracker: onChange fires only if the DOM value differs from the tracked one. */
  function controlledInput(): { input: HTMLInputElement; changes: string[] } {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Name');
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!desc?.get || !desc.set) throw new Error('no value descriptor');
    const { get, set } = desc;
    let tracked = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get(this: HTMLInputElement) {
        return get.call(this) as string;
      },
      set(this: HTMLInputElement, v: string) {
        tracked = String(v);
        set.call(this, v);
      },
    });
    const changes: string[] = [];
    input.addEventListener('input', () => {
      const current = get.call(input) as string;
      if (current !== tracked) {
        tracked = current;
        changes.push(current);
      }
    });
    document.body.append(input);
    return { input, changes };
  }

  it('the simulation swallows a plain .value assignment (sanity check)', () => {
    const { input, changes } = controlledInput();
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toEqual([]);
  });

  it('updates a React-style controlled input via the native setter', () => {
    const { input, changes } = controlledInput();
    const ref = refOf(run(findElements, {}).content, '"Name"');
    const r = run(typeText, { ref, text: 'Ada Lovelace' });
    expect(r.ok).toBe(true);
    expect(input.value).toBe('Ada Lovelace');
    expect(changes).toEqual(['Ada Lovelace']);
    run(typeText, { ref, text: '!', clear: false });
    expect(input.value).toBe('Ada Lovelace!');
  });

  it('submits the form with submit=true', () => {
    document.body.innerHTML = '<form><input aria-label="Query"></form>';
    let submitted = 0;
    document.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted++;
    });
    const ref = refOf(run(findElements, {}).content, 'Query');
    const r = run(typeText, { ref, text: 'cats', submit: true });
    expect(r.content).toContain('submitted the form');
    expect(submitted).toBe(1);
  });

  it('types into contenteditable and retargets labels', () => {
    document.body.innerHTML = '<div contenteditable="true" aria-label="Body">old</div><label id="l">Notes <textarea></textarea></label>';
    const content = run(findElements, {}).content;
    const r = run(typeText, { ref: refOf(content, '"Body"'), text: 'new text' });
    expect(r.ok).toBe(true);
    expect(document.querySelector('[contenteditable]')?.textContent).toBe('new text');
    expect(run(typeText, { ref: refOf(content, 'Notes'), text: 'hi' }).ok).toBe(true);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hi');
  });

  it('rejects non-text inputs', () => {
    document.body.innerHTML = '<input type="checkbox" aria-label="Box">';
    const ref = refOf(run(findElements, {}).content, 'Box');
    expect(run(typeText, { ref, text: 'x' }).content).toContain('Cannot type');
  });
});

describe('select_option, press_key, info, selection', () => {
  it('selects by label or value and fires change', () => {
    document.body.innerHTML = '<select aria-label="Size"><option value="s">Small</option><option value="l">Large</option></select>';
    const sel = document.querySelector('select') as HTMLSelectElement;
    let changed = 0;
    sel.addEventListener('change', () => changed++);
    const ref = refOf(run(findElements, {}).content, 'Size');
    expect(run(selectOption, { ref, option: 'large' }).content).toBe('Selected "Large".');
    expect(sel.value).toBe('l');
    expect(run(selectOption, { ref, option: 's' }).ok).toBe(true);
    expect(sel.value).toBe('s');
    expect(changed).toBe(2);
    expect(run(selectOption, { ref, option: 'Huge' }).content).toContain('Options: "Small", "Large"');
  });

  it('press_key dispatches key events and Enter submits forms', () => {
    document.body.innerHTML = '<form><input aria-label="Q"></form>';
    const keys: string[] = [];
    let submitted = 0;
    const input = document.querySelector('input') as HTMLInputElement;
    input.addEventListener('keydown', (e) => keys.push(e.key));
    document.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted++;
    });
    const ref = refOf(run(findElements, {}).content, '"Q"');
    expect(run(pressKey, { key: 'esc', ref }).ok).toBe(true);
    expect(run(pressKey, { key: 'enter', ref }).content).toContain('Submitted the form');
    expect(keys).toEqual(['Escape', 'Enter']);
    expect(submitted).toBe(1);
    expect(run(pressKey, { key: 'Hyper' }).ok).toBe(false);
  });

  it('get_page_info and get_selection', () => {
    document.head.innerHTML = '<meta name="description" content="A test page">';
    document.body.innerHTML = '<p id="p">Select me please</p><a href="/x">x</a>';
    expect(run(getPageInfo, {}).content).toContain('Description: A test page');
    expect(run(getSelection, {}).content).toContain('No text is selected');
    // jsdom's Selection.toString() is empty, so test the text-field path and a stubbed selection.
    document.body.innerHTML = '<input value="pick this part">';
    const input = document.querySelector('input') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(5, 14);
    expect(run(getSelection, {}).content).toBe('this part');
    const original = window.getSelection.bind(window);
    window.getSelection = () => ({ toString: () => '  Select me please ' }) as Selection;
    try {
      expect(run(getSelection, {}).content).toBe('Select me please');
    } finally {
      window.getSelection = original;
    }
  });

  it('get_selection never returns text from a password field', () => {
    document.body.innerHTML = '<input type="password" value="hunter2-secret">';
    const input = document.querySelector('input') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 14);
    const r = run(getSelection, {});
    expect(r.content).not.toContain('hunter2');
    expect(r.data).toEqual({ text: '' });
  });
});
