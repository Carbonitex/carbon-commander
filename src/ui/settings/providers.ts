/** Providers: API keys (write-only), base URLs, reachability check. */
import { endpointUrlProblem, PROVIDER_IDS, PROVIDERS } from '../../shared/defaults';
import type { ProviderId, ProviderStatus } from '../../shared/types';
import { h } from '../dom';
import { describeError } from '../format';
import { errorMessage, type SettingsContext, type SettingsPanel } from './context';
import { busy, button, field, secretInput, section, statusLine, textInput } from './fields';

export function ollamaOriginsHint(): string {
  return `Ollama must allow this extension: start it with OLLAMA_ORIGINS=${location.origin} (or OLLAMA_ORIGINS=chrome-extension://*).`;
}

export function createProvidersPanel(ctx: SettingsContext): SettingsPanel {
  const el = h('div', { class: 'cc-panel' });
  const statuses = new Map<ProviderId, ProviderStatus>();
  const rows = new Map<ProviderId, { keyState: HTMLElement; reach: ReturnType<typeof statusLine> }>();

  const showStatus = (s: ProviderStatus): void => {
    statuses.set(s.id, s);
    const row = rows.get(s.id);
    if (!row) return;
    row.keyState.textContent = s.hasKey ? 'Key: set' : s.needsKey ? 'Key: not set (required)' : 'Key: not set (optional)';
    row.keyState.dataset.tone = s.hasKey ? 'ok' : s.needsKey ? 'error' : 'muted';
    if (s.reachable === true) row.reach.set('Reachable', 'ok');
    else if (s.reachable === false || s.error) row.reach.set(s.error ? describeError(s.error).detail : 'Unreachable', 'error');
  };

  const loadStatus = async (check: boolean): Promise<void> => {
    const list = await ctx.rpc('providers.status', { check });
    for (const s of list) showStatus(s);
  };

  const providerSection = (id: ProviderId): HTMLElement => {
    const def = PROVIDERS[id];
    const settings = ctx.settings().providers[id];
    const keyState = h('span', { class: 'cc-pill' }, 'Key: …');
    const reach = statusLine();
    rows.set(id, { keyState, reach });

    const baseUrl = textInput(settings.baseUrl, { placeholder: id === 'custom' ? 'https://example.com/v1' : def.baseUrl, inputmode: 'url' });
    const saveUrl = async (): Promise<void> => {
      const value = baseUrl.value.trim().replace(/\/+$/, '');
      if (value === ctx.settings().providers[id].baseUrl) return;
      const problem = value ? endpointUrlProblem(value) : null;
      if (problem) {
        reach.set(`Base URL: ${problem}`, 'error');
        return;
      }
      try {
        await ctx.save({ providers: { [id]: { baseUrl: value || def.baseUrl } } });
        reach.set('Saved', 'ok');
      } catch (err) {
        reach.set(errorMessage(err), 'error');
      }
    };
    baseUrl.addEventListener('change', () => void saveUrl());

    const key = secretInput(def.needsKey ? 'Paste API key' : 'API key (optional)');
    const saveKey = button('Save key', () => {
      const value = key.value.trim();
      if (!value) return;
      void busy(saveKey, async () => {
        await ctx.rpc('secrets.set', { name: def.keyName, value });
        key.value = '';
        await loadStatus(false);
        reach.set('Key saved', 'ok');
      }, (m) => reach.set(m, 'error'));
    });
    key.addEventListener('keydown', (e) => e.key === 'Enter' && saveKey.click());
    const removeKey = button('Remove key', () => {
      void busy(removeKey, async () => {
        await ctx.rpc('secrets.delete', { name: def.keyName });
        await loadStatus(false);
        reach.set('Key removed', 'muted');
      }, (m) => reach.set(m, 'error'));
    }, 'cc-button-subtle');

    const children: (HTMLElement | null)[] = [
      h('div', { class: 'cc-row' }, keyState),
      field('Base URL', baseUrl),
      field('API key', key, 'Stored encrypted in the extension; it is never shown again.'),
      h('div', { class: 'cc-row' }, saveKey, removeKey),
    ];
    if (id === 'custom') {
      const label = textInput(settings.label, { placeholder: 'Display name' });
      label.addEventListener('change', () => {
        ctx.save({ providers: { custom: { label: label.value.trim() || def.label } } }).catch((err) => reach.set(errorMessage(err), 'error'));
      });
      children.splice(1, 0, field('Name', label));
    }
    if (id === 'ollama') children.push(h('div', { class: 'cc-hint' }, ollamaOriginsHint()));
    children.push(reach.el);
    return section(id === 'custom' ? 'Custom (OpenAI-compatible)' : def.label, ...children);
  };

  const check = button('Check connections', () => {
    void busy(check, () => loadStatus(true), (m) => ctx.error(m));
  });

  return {
    id: 'providers',
    title: 'Providers',
    el,
    refresh() {
      rows.clear();
      el.replaceChildren(h('div', { class: 'cc-row' }, check), ...PROVIDER_IDS.map(providerSection));
      for (const s of statuses.values()) showStatus(s);
      loadStatus(false).catch((err) => ctx.error(errorMessage(err)));
    },
  };
}
