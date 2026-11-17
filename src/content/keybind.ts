/** Keybind helpers shared by the content script (matching) and the settings UI (capture / display). */
import type { Keybind } from '../shared/types';

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Fn', 'OS']);

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function matchesKeybind(event: KeyEventLike, keybind: Keybind | null | undefined): boolean {
  if (!keybind || !keybind.key) return false;
  return (
    normaliseKey(event.key) === normaliseKey(keybind.key) &&
    event.ctrlKey === keybind.ctrl &&
    event.metaKey === keybind.meta &&
    event.altKey === keybind.alt &&
    event.shiftKey === keybind.shift
  );
}

/** Keybind from a keydown, or null for a lone modifier / a key without any modifier. */
export function keybindFromEvent(event: KeyEventLike): Keybind | null {
  if (MODIFIER_KEYS.has(event.key) || event.key === 'Dead' || event.key === 'Unidentified') return null;
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return null;
  return { key: normaliseKey(event.key), ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey };
}

export function formatKeybind(keybind: Keybind | null | undefined): string {
  if (!keybind) return 'None';
  const parts: string[] = [];
  if (keybind.ctrl) parts.push('Ctrl');
  if (keybind.meta) parts.push('Cmd');
  if (keybind.alt) parts.push('Alt');
  if (keybind.shift) parts.push('Shift');
  parts.push(keybind.key.length === 1 ? keybind.key.toUpperCase() : keybind.key);
  return parts.join('+');
}

export function isKeybind(value: unknown): value is Keybind {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === 'string' &&
    typeof v.ctrl === 'boolean' &&
    typeof v.meta === 'boolean' &&
    typeof v.alt === 'boolean' &&
    typeof v.shift === 'boolean'
  );
}
