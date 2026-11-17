/**
 * First-run / no-provider setup shown inline in the chat view: paste an OpenRouter key, or use
 * Ollama, or a custom OpenAI-compatible base URL. Uses `secrets.set`, `settings.set`,
 * `models.list` and `providers.status`.
 */
import { DEFAULT_OPENROUTER_MODELS, MODEL_ROLES, PROVIDERS, endpointUrlProblem } from '../../shared/defaults';
import type { ModelRole, ModelSelection, ProviderId, ProviderStatus, Settings, SettingsPatch } from '../../shared/types';
import type { Rpc } from '../connection';
import { h } from '../dom';
import { describeModel } from '../format';
import { busy, button, field, secretInput, statusLine, textInput } from '../settings/fields';
import { ollamaOriginsHint } from '../settings/providers';

/** Does the chat role lack what it needs (key or model)? */
export function needsSetup(settings: Settings, statuses: readonly ProviderStatus[]): boolean {
  const chat = settings.models.chat;
  if (!chat.model) return true;
  const status = statuses.find((s) => s.id === chat.provider);
  if (chat.provider === 'custom' && !settings.providers.custom.baseUrl) return true;
  return !!status && status.needsKey && !status.hasKey;
}

function allRoles(selection: ModelSelection): Partial<Record<ModelRole, ModelSelection>> {
  return Object.fromEntries(MODEL_ROLES.map((r) => [r, selection]));
}

export interface SetupOptions {
  rpc: Rpc;
  onSaved(settings: Settings): void;
  onDone(): void;
  onOpenSettings(): void;
  onChange(): void;
}

export function createSetupView(options: SetupOptions): HTMLElement {
  const { rpc } = options;
  const save = async (patch: SettingsPatch): Promise<void> => options.onSaved(await rpc('settings.set', { patch }));

  // OpenRouter
  const orStatus = statusLine();
  const orKey = secretInput('sk-or-…');
  const orSave = button('Save key', () => {
    const value = orKey.value.trim();
    if (!value) {
      orStatus.set('Paste your OpenRouter API key first', 'error');
      return;
    }
    void busy(orSave, async () => {
      await rpc('secrets.set', { name: PROVIDERS.openrouter.keyName, value });
      orKey.value = '';
      const settings = await rpc('settings.get');
      if (settings.models.chat.provider !== 'openrouter' || !settings.models.chat.model) {
        await save({ models: Object.fromEntries(MODEL_ROLES.map((r) => [r, { provider: 'openrouter', model: DEFAULT_OPENROUTER_MODELS[r] }])) });
      }
      orStatus.set('Key saved', 'ok');
      options.onDone();
    }, (m) => orStatus.set(m, 'error'));
  }, 'cc-button-confirm');
  orKey.addEventListener('keydown', (e) => e.key === 'Enter' && orSave.click());

  // Local / custom endpoint: connect, list models, pick one.
  const endpoint = (provider: Exclude<ProviderId, 'openrouter'>): HTMLElement => {
    const status = statusLine();
    const url = textInput(provider === 'ollama' ? PROVIDERS.ollama.baseUrl : '', { placeholder: provider === 'ollama' ? PROVIDERS.ollama.baseUrl : 'https://example.com/v1', inputmode: 'url' });
    const key = provider === 'custom' ? secretInput('API key (optional)') : null;
    const modelSelect = h('select', { 'aria-label': `${PROVIDERS[provider].label} model`, hidden: true });
    const use = button('Use this model', () => {
      if (!modelSelect.value) return;
      void busy(use, async () => {
        await save({ models: allRoles({ provider, model: modelSelect.value }) });
        status.set('Ready', 'ok');
        options.onDone();
      }, (m) => status.set(m, 'error'));
    }, 'cc-button-confirm', { hidden: '' });
    const connect = button('Connect', () => {
      const base = url.value.trim().replace(/\/+$/, '');
      const problem = endpointUrlProblem(base);
      if (problem) {
        status.set(`Base URL: ${problem}`, 'error');
        return;
      }
      void busy(connect, async () => {
        await save({ providers: { [provider]: { baseUrl: base } } });
        if (key?.value.trim()) {
          await rpc('secrets.set', { name: PROVIDERS[provider].keyName, value: key.value.trim() });
          key.value = '';
        }
        status.set('Listing models…');
        const models = await rpc('models.list', { provider, refresh: true });
        if (!models.length) {
          status.set(provider === 'ollama' ? 'Connected, but no models are installed (ollama pull <model>)' : 'Connected, but the endpoint lists no models', 'error');
          return;
        }
        modelSelect.replaceChildren(...models.map((m) => h('option', { value: m.id }, describeModel(m) ? `${m.name || m.id} — ${describeModel(m)}` : m.name || m.id)));
        modelSelect.hidden = false;
        use.hidden = false;
        status.set(`${models.length} models available`, 'ok');
        options.onChange();
      }, (m) => status.set(provider === 'ollama' ? `${m}. ${ollamaOriginsHint()}` : m, 'error'));
    });
    return h(
      'div',
      { class: 'cc-setup-option' },
      h('h4', null, provider === 'ollama' ? 'Use Ollama (local)' : 'Custom OpenAI-compatible endpoint'),
      field('Base URL', url, provider === 'ollama' ? ollamaOriginsHint() : undefined),
      key ? field('API key', key) : null,
      h('div', { class: 'cc-row' }, connect, modelSelect, use),
      status.el,
    );
  };

  return h(
    'div',
    { class: 'cc-setup', role: 'region', 'aria-label': 'Set up a model provider' },
    h('h3', null, 'Connect a model provider'),
    h('p', null, 'Carbon Commander needs a model to talk to. Pick one option:'),
    h(
      'div',
      { class: 'cc-setup-option' },
      h('h4', null, 'OpenRouter (recommended)'),
      h('p', { class: 'cc-hint' }, 'One key for many models. Create a key at openrouter.ai/keys and paste it here. It is stored encrypted and never shown again.'),
      field('OpenRouter API key', orKey),
      h('div', { class: 'cc-row' }, orSave),
      orStatus.el,
    ),
    endpoint('ollama'),
    endpoint('custom'),
    h('div', { class: 'cc-row' }, button('Open full settings', () => options.onOpenSettings(), 'cc-button-subtle')),
  );
}
