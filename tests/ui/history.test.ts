import { describe, expect, it } from 'vitest';
import { InputHistory } from '../../src/ui/chat/history';

describe('InputHistory', () => {
  it('walks back and forth and restores the draft', () => {
    const h = new InputHistory(['one', 'two']);
    expect(h.up('draft')).toBe('two');
    expect(h.up('two')).toBe('one');
    expect(h.up('one')).toBeUndefined(); // at the oldest
    expect(h.down()).toBe('two');
    expect(h.down()).toBe('draft');
    expect(h.down()).toBeUndefined(); // not navigating any more
    expect(h.navigating).toBe(false);
  });

  it('push records, collapses consecutive duplicates and resets navigation', () => {
    const h = new InputHistory();
    h.push('a');
    h.push('a');
    h.push('  ');
    h.push('b');
    expect(h.toArray()).toEqual(['a', 'b']);
    h.up('');
    h.push('c');
    expect(h.navigating).toBe(false);
    expect(h.up('')).toBe('c');
  });

  it('caps the number of entries', () => {
    const h = new InputHistory([], 3);
    for (const x of ['1', '2', '3', '4']) h.push(x);
    expect(h.toArray()).toEqual(['2', '3', '4']);
    expect(new InputHistory(['a', '', 'b', 'c', 'd'], 2).toArray()).toEqual(['c', 'd']);
  });

  it('reset abandons navigation', () => {
    const h = new InputHistory(['x']);
    expect(h.up('typed')).toBe('x');
    h.reset();
    expect(h.down()).toBeUndefined();
    expect(h.up('new')).toBe('x');
  });

  it('does nothing on an empty history', () => {
    const h = new InputHistory();
    expect(h.up('a')).toBeUndefined();
    expect(h.down()).toBeUndefined();
  });
});
