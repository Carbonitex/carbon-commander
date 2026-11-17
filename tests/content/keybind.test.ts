import { describe, expect, it } from 'vitest';
import { formatKeybind, isKeybind, keybindFromEvent, matchesKeybind } from '../../src/content/keybind';

const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('keybind helpers', () => {
  const kb = { key: 'j', ctrl: true, meta: false, alt: false, shift: true };

  it('matches exactly (case-insensitive letters, exact modifiers)', () => {
    expect(matchesKeybind(ev('J', { ctrlKey: true, shiftKey: true }), kb)).toBe(true);
    expect(matchesKeybind(ev('j', { ctrlKey: true }), kb)).toBe(false);
    expect(matchesKeybind(ev('j', { ctrlKey: true, shiftKey: true, altKey: true }), kb)).toBe(false);
    expect(matchesKeybind(ev('j'), null)).toBe(false);
  });

  it('captures only combinations with Ctrl/Cmd/Alt', () => {
    expect(keybindFromEvent(ev('k', { metaKey: true }))).toEqual({ key: 'k', ctrl: false, meta: true, alt: false, shift: false });
    expect(keybindFromEvent(ev('k'))).toBeNull();
    expect(keybindFromEvent(ev('k', { shiftKey: true }))).toBeNull();
    expect(keybindFromEvent(ev('Control', { ctrlKey: true }))).toBeNull();
  });

  it('formats and validates', () => {
    expect(formatKeybind(kb)).toBe('Ctrl+Shift+J');
    expect(formatKeybind(null)).toBe('None');
    expect(isKeybind(kb)).toBe(true);
    expect(isKeybind({ key: 'j' })).toBe(false);
    expect(isKeybind(null)).toBe(false);
  });
});
