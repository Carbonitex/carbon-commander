// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResizeReporter, RESIZE_FALLBACK_MS } from '../../src/ui/host';

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
