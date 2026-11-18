// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentHeight, createResizeReporter, naturalHeight, RESIZE_FALLBACK_MS } from '../../src/ui/host';

afterEach(() => vi.useRealTimers());

describe('createResizeReporter', () => {
  it('reports even when animation frames never come (throttled iframe), once per change', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1); // frames starved
    let height = 300;
    const posted: number[] = [];
    const report = createResizeReporter(() => height, (h) => posted.push(h));
    report();
    report(); // coalesced
    vi.advanceTimersByTime(RESIZE_FALLBACK_MS);
    expect(posted).toEqual([300]);
    report();
    vi.advanceTimersByTime(RESIZE_FALLBACK_MS);
    expect(posted).toEqual([300]); // unchanged: not re-sent
    height = 420;
    report();
    vi.advanceTimersByTime(RESIZE_FALLBACK_MS);
    expect(posted).toEqual([300, 420]);
    raf.mockRestore();
  });

  it('force() re-sends an unchanged height (repairs a report the host missed)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const posted: number[] = [];
    const report = createResizeReporter(() => 250, (h) => posted.push(h));
    report();
    vi.advanceTimersByTime(RESIZE_FALLBACK_MS);
    report.force();
    vi.advanceTimersByTime(RESIZE_FALLBACK_MS);
    expect(posted).toEqual([250, 250]);
  });
});

/**
 * A model of the embedded bar's layout as a function of the iframe height: fixed parts (header,
 * input, footer, padding, borders) plus a scroll area that shrinks when the bar is clamped
 * (`max-height: 100vh - 32px`). Fractional sizes, rounded the way the browser rounds `offsetHeight`,
 * `clientHeight` and `scrollHeight`.
 */
function barModel(frameHeight: () => number) {
  const FIXED = 113.6;
  const PADDING = 16;
  const bar = document.createElement('div');
  const header = document.createElement('div');
  const scroller = document.createElement('div');
  const first = document.createElement('div');
  const second = document.createElement('div');
  first.style.marginBottom = '2px';
  second.style.marginTop = '4px'; // collapses with the 2px above: 4px between them
  scroller.append(first, second);
  bar.append(header, scroller);
  document.body.replaceChildren(bar);
  const content = 200.3 + 4 + 28.3; // 232.6
  const natural = FIXED + content; // 346.2
  const barHeight = (): number => Math.min(natural, frameHeight() - PADDING * 2);
  const box = (): number => Math.max(0, barHeight() - FIXED);
  const rect = (height: number) => ({ height }) as DOMRect;
  bar.getBoundingClientRect = () => rect(barHeight());
  scroller.getBoundingClientRect = () => rect(box());
  first.getBoundingClientRect = () => rect(200.3);
  second.getBoundingClientRect = () => rect(28.3);
  header.getBoundingClientRect = () => rect(FIXED);
  const define = (el: HTMLElement, props: Record<string, () => number>): void => {
    for (const [key, get] of Object.entries(props)) Object.defineProperty(el, key, { configurable: true, get });
  };
  define(bar, {
    offsetHeight: () => Math.round(barHeight()),
    clientHeight: () => Math.round(barHeight()),
    scrollHeight: () => Math.max(Math.round(FIXED + box()), Math.round(barHeight())),
  });
  define(scroller, {
    clientHeight: () => Math.round(box()),
    scrollHeight: () => Math.max(Math.ceil(content), Math.round(box())),
  });
  return { bar, scroller, natural, PADDING };
}

describe('naturalHeight', () => {
  /** What the host does with each report (the iframe's height is a whole number of pixels). */
  const settle = (measure: () => number, set: (h: number) => void, steps = 8): number[] => {
    const heights: number[] = [];
    for (let i = 0; i < steps; i++) {
      const h = Math.ceil(measure());
      heights.push(h);
      set(h);
    }
    return heights;
  };

  it('converges on one height when the bar is clamped by a fraction of a pixel (no resize loop)', () => {
    let frame = 96; // the overlay's initial iframe height
    const m = barModel(() => frame);
    const heights = settle(() => naturalHeight(m.bar, m.scroller) + m.PADDING * 2, (h) => (frame = h));
    expect(heights.at(-1)).toBe(Math.ceil(m.natural + m.PADDING * 2)); // 379: the whole bar fits
    expect(new Set(heights.slice(1)).size).toBe(1); // settled after the first report
  });

  it('(the model reproduces the loop the rounded measurement caused)', () => {
    let frame = 378;
    const m = barModel(() => frame);
    const legacy = (): number =>
      m.bar.offsetHeight +
      Math.max(0, m.bar.scrollHeight - m.bar.clientHeight) +
      Math.max(0, m.scroller.scrollHeight - m.scroller.clientHeight) +
      m.PADDING * 2;
    expect(settle(legacy, (h) => (frame = h), 4)).toEqual([379, 378, 379, 378]);
  });

  it('is the same at every iframe height', () => {
    let frame = 0;
    const m = barModel(() => frame);
    const seen = new Set<number>();
    for (frame = 150; frame <= 500; frame++) seen.add(Math.ceil(naturalHeight(m.bar, m.scroller)));
    expect([...seen]).toEqual([Math.ceil(m.natural)]);
  });
});

describe('contentHeight', () => {
  it('adds children, collapsed margins and the padding, ignoring hidden children and transforms', () => {
    const el = document.createElement('div');
    el.style.padding = '3px 0 5px';
    const a = document.createElement('div');
    const hidden = document.createElement('div');
    const b = document.createElement('div');
    a.style.marginBottom = '6px';
    hidden.style.display = 'none';
    b.style.margin = '4px 0 2px';
    el.append(a, hidden, b);
    document.body.replaceChildren(el);
    a.getBoundingClientRect = () => ({ height: 10.25, top: 100 }) as DOMRect;
    hidden.getBoundingClientRect = () => ({ height: 99 }) as DOMRect;
    b.getBoundingClientRect = () => ({ height: 20.5, top: 999 }) as DOMRect; // e.g. mid-slide-in
    expect(contentHeight(el)).toBeCloseTo(3 + 10.25 + 6 + 20.5 + 2 + 5);
  });
});
