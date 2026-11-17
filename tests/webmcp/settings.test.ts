/** `Settings.webmcp`: default on, validated, normalised from older stored settings. */
import { describe, expect, it } from 'vitest';
import { applyPatch, normalizeSettings, validateSettings } from '../../src/background/settings';
import { defaultSettings } from '../../src/shared/defaults';
import type { Settings } from '../../src/shared/types';

describe('Settings.webmcp', () => {
  it('defaults to on, also for settings stored before it existed', () => {
    expect(defaultSettings().webmcp).toBe(true);
    const { webmcp: _omit, ...older } = defaultSettings();
    expect(normalizeSettings(older).webmcp).toBe(true);
    expect(normalizeSettings({ ...older, webmcp: 'yes' }).webmcp).toBe(true);
    expect(normalizeSettings({ ...older, webmcp: false }).webmcp).toBe(false);
  });

  it('is patched and validated as a boolean', () => {
    expect(validateSettings(applyPatch(defaultSettings(), { webmcp: false })).webmcp).toBe(false);
    expect(() => validateSettings({ ...defaultSettings(), webmcp: 1 } as unknown as Settings)).toThrow(/webmcp/);
  });
});
