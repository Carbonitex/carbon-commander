import type { Settings, SettingsPatch } from '../../shared/types';
import type { Rpc } from '../connection';

/** What every settings panel gets. */
export interface SettingsContext {
  rpc: Rpc;
  /** Target tab for `tools.list` when the bar is a standalone tab. */
  tabId: number | undefined;
  settings(): Settings;
  /** `settings.set`; updates the cached settings and re-renders. Throws on failure. */
  save(patch: SettingsPatch): Promise<void>;
  /** Replace cached settings (after `settings.reset`). */
  replace(settings: Settings): void;
  /** Error banner at the top of the settings view. */
  error(message: string): void;
}

export interface SettingsPanel {
  id: string;
  title: string;
  el: HTMLElement;
  /** (Re)render from settings / reload remote state. Called when the panel is shown. */
  refresh(): void | Promise<void>;
  /** Settings changed elsewhere; panels keep what the user is typing. */
  onSettings?(settings: Settings): void;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
