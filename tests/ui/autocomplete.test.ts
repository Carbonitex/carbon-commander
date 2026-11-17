import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autocompleter, ghostTail } from '../../src/ui/chat/autocomplete';
import { CcError, type AutocompleteResult } from '../../src/shared/types';

function setup(impl: (text: string) => Promise<AutocompleteResult>) {
  const shown: { text: string; suggestions: string[] }[] = [];
  const request = vi.fn(impl);
  const ac = new Autocompleter({
    request,
    onSuggestions: (text, suggestions) => shown.push({ text, suggestions }),
    delayMs: 100,
    minLength: 2,
  });
  const lastNonEmpty = () => shown.filter((s) => s.suggestions.length).at(-1);
  return { ac, shown, lastNonEmpty, request };
}

describe('Autocompleter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces: only the last text within the delay is requested', async () => {
    const { ac, request, lastNonEmpty } = setup(async (text) => ({ text, suggestions: [`${text} more`] }));
    ac.update('ab');
    vi.advanceTimersByTime(50);
    ac.update('abc');
    vi.advanceTimersByTime(50);
    ac.update('abcd');
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('abcd');
    expect(lastNonEmpty()).toEqual({ text: 'abcd', suggestions: ['abcd more'] });
  });

  it('skips short input', async () => {
    const { ac, request } = setup(async (text) => ({ text, suggestions: ['x'] }));
    ac.update('a');
    await vi.advanceTimersByTimeAsync(500);
    expect(request).not.toHaveBeenCalled();
  });

  it('drops a response that arrives after the text changed (cancel)', async () => {
    let resolve!: (r: AutocompleteResult) => void;
    const { ac, lastNonEmpty } = setup(() => new Promise((r) => (resolve = r)));
    ac.update('hello');
    await vi.advanceTimersByTimeAsync(100);
    ac.update('hello w'); // user kept typing: in-flight result is stale
    resolve({ text: 'hello', suggestions: ['hello there'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastNonEmpty()).toBeUndefined();
  });

  it('drops responses whose echoed text does not match', async () => {
    const { ac, lastNonEmpty } = setup(async () => ({ text: 'something else', suggestions: ['zzz'] }));
    ac.update('abc');
    await vi.advanceTimersByTimeAsync(100);
    expect(lastNonEmpty()).toBeUndefined();
  });

  it('cancel() stops a pending request and clears suggestions', async () => {
    const { ac, request, shown } = setup(async (text) => ({ text, suggestions: ['x'] }));
    ac.update('abc');
    ac.cancel();
    await vi.advanceTimersByTimeAsync(200);
    expect(request).not.toHaveBeenCalled();
    expect(shown.at(-1)?.suggestions).toEqual([]);
  });

  it('turns itself off when the worker says not-implemented', async () => {
    const { ac, request } = setup(async () => {
      throw new CcError('not-implemented', 'nope');
    });
    ac.update('abc');
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(1);
    expect(ac.active).toBe(false);
    ac.update('abcd');
    await vi.advanceTimersByTimeAsync(200);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stays on after a transient (aborted / network) failure', async () => {
    const { ac } = setup(async () => {
      throw new CcError('aborted', 'newer request');
    });
    ac.update('abc');
    await vi.advanceTimersByTimeAsync(100);
    expect(ac.active).toBe(true);
  });

  it('respects the setting', async () => {
    const { ac, request } = setup(async (text) => ({ text, suggestions: ['x'] }));
    ac.setEnabled(false);
    ac.update('abc');
    await vi.advanceTimersByTimeAsync(200);
    expect(request).not.toHaveBeenCalled();
    ac.setEnabled(true);
    ac.update('abc');
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('ghostTail', () => {
  it('returns the continuation of the input', () => {
    expect(ghostTail('summ', 'Summarise this page')).toBe('arise this page');
    expect(ghostTail('abc', 'xyz')).toBe('');
    expect(ghostTail('abc', 'abc')).toBe('');
    expect(ghostTail('', 'abc')).toBe('');
    expect(ghostTail('abc', undefined)).toBe('');
  });
});
