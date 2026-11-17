/** Settings view (same page as the chat): tabbed panels. */
import type { Settings, SettingsPatch } from '../../shared/types';
import type { Rpc } from '../connection';
import { h } from '../dom';
import type { SettingsContext, SettingsPanel } from './context';
import { createGeneralPanel } from './general';
import { createMcpPanel } from './mcp';
import { createModelsPanel } from './models';
import { createProvidersPanel } from './providers';
import { createToolsPanel } from './tools';

export interface SettingsViewOptions {
  rpc: Rpc;
  tabId: number | undefined;
  getSettings(): Settings | null;
  /** Settings saved from this view (so the app can update its cache). */
  onSettings(settings: Settings): void;
  onBack(): void;
  onChange(): void;
}

export type SettingsTab = 'providers' | 'models' | 'general' | 'mcp' | 'tools';

export class SettingsView {
  readonly el: HTMLElement;
  private readonly panels: SettingsPanel[];
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly banner: HTMLElement;
  private active = 0;
  private settings: Settings | null;

  constructor(private readonly options: SettingsViewOptions) {
    this.settings = options.getSettings();
    const ctx: SettingsContext = {
      rpc: options.rpc,
      tabId: options.tabId,
      settings: () => {
        if (!this.settings) throw new Error('Settings not loaded');
        return this.settings;
      },
      save: async (patch: SettingsPatch) => {
        const next = await options.rpc('settings.set', { patch });
        this.settings = next;
        options.onSettings(next);
      },
      replace: (next) => {
        this.settings = next;
        options.onSettings(next);
        void this.panels[this.active]?.refresh();
      },
      error: (message) => this.showError(message),
    };
    this.panels = [createProvidersPanel(ctx), createModelsPanel(ctx), createGeneralPanel(ctx), createMcpPanel(ctx), createToolsPanel(ctx)];

    const tablist = h('div', { class: 'cc-tabs', role: 'tablist', 'aria-label': 'Settings sections' });
    this.panels.forEach((panel, i) => {
      const tab = h('button', {
        type: 'button',
        role: 'tab',
        id: `cc-tab-${panel.id}`,
        'aria-controls': `cc-panel-${panel.id}`,
        class: 'cc-tab',
        on: { click: () => this.select(i, true) },
      }, panel.title);
      tab.addEventListener('keydown', (event) => {
        const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        event.preventDefault();
        this.select((this.active + delta + this.panels.length) % this.panels.length, true);
      });
      panel.el.id = `cc-panel-${panel.id}`;
      panel.el.setAttribute('role', 'tabpanel');
      panel.el.setAttribute('aria-labelledby', tab.id);
      this.tabs.push(tab);
      tablist.append(tab);
    });

    this.banner = h('div', { class: 'cc-banner', role: 'alert', hidden: true });
    const back = h('button', { type: 'button', class: 'cc-icon-button', 'aria-label': 'Back to chat', title: 'Back (Esc)', on: { click: () => options.onBack() } }, '←');
    this.el = h(
      'div',
      { class: 'cc-settings' },
      h('div', { class: 'cc-header' }, back, h('h2', { class: 'cc-title' }, 'Settings')),
      tablist,
      this.banner,
      h('div', { class: 'cc-settings-body' }, this.panels.map((p) => p.el)),
    );
  }

  /** Show the view, optionally on a given tab. */
  open(tab?: SettingsTab): void {
    this.settings = this.options.getSettings() ?? this.settings;
    this.banner.hidden = true;
    const index = tab ? this.panels.findIndex((p) => p.id === tab) : this.active;
    this.select(index < 0 ? 0 : index, false);
    this.tabs[this.active]?.focus();
  }

  /** Settings changed (from any page). */
  update(settings: Settings): void {
    this.settings = settings;
    for (const p of this.panels) p.onSettings?.(settings);
  }

  private select(index: number, focus: boolean): void {
    this.active = index;
    this.panels.forEach((p, i) => {
      const on = i === index;
      p.el.hidden = !on;
      const tab = this.tabs[i] as HTMLButtonElement;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    if (!this.settings) {
      this.showError('Settings are not loaded yet (is the extension worker running?)');
    } else {
      void Promise.resolve(this.panels[index]?.refresh()).catch((err) => this.showError(String(err)));
    }
    if (focus) this.tabs[index]?.focus();
    this.options.onChange();
  }

  private showError(message: string): void {
    this.banner.textContent = message;
    this.banner.hidden = false;
    this.options.onChange();
  }
}
