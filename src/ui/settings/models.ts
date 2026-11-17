/** Model per role, chosen from the provider's `/models` list. */
import { MODEL_ROLES, PROVIDER_IDS, PROVIDERS } from '../../shared/defaults';
import type { ModelInfo, ModelRole, ProviderId } from '../../shared/types';
import { h } from '../dom';
import { describeError } from '../format';
import { CcError } from '../../shared/types';
import { errorMessage, type SettingsContext, type SettingsPanel } from './context';
import { busy, button, field, section, statusLine } from './fields';
import { createModelPicker, type ModelPicker } from './model-picker';

const ROLE_INFO: Record<ModelRole, { title: string; hint: string }> = {
  chat: { title: 'Chat (agent)', hint: 'Runs the conversation and calls tools. Needs reliable tool calling.' },
  vision: {
    title: 'Vision',
    hint: 'Describes screenshots and other images as text when the chat model is known not to accept images. Without a usable vision model the chat model gets a note that the image could not be shown.',
  },
  autocomplete: { title: 'Autocomplete', hint: 'Suggestions while you type. Latency matters most.' },
};

export function createModelsPanel(ctx: SettingsContext): SettingsPanel {
  const el = h('div', { class: 'cc-panel' });
  const cache = new Map<ProviderId, Promise<ModelInfo[]>>();
  const pickers = new Map<ModelRole, { picker: ModelPicker; provider: HTMLSelectElement; status: ReturnType<typeof statusLine> }>();

  const load = (provider: ProviderId, refresh = false): Promise<ModelInfo[]> => {
    let p = refresh ? undefined : cache.get(provider);
    if (!p) {
      p = ctx.rpc('models.list', { provider, refresh });
      cache.set(provider, p);
      p.catch(() => cache.delete(provider));
    }
    return p;
  };

  const fill = async (role: ModelRole, refresh = false): Promise<void> => {
    const row = pickers.get(role);
    if (!row) return;
    const provider = row.provider.value as ProviderId;
    row.status.set('Loading models…');
    try {
      const models = await load(provider, refresh);
      if (row.provider.value !== provider) return;
      row.picker.setModels(models);
      row.status.set(`${models.length} models`, 'muted');
    } catch (err) {
      row.picker.setModels([]);
      const text = err instanceof CcError ? describeError({ code: err.code, message: err.message }).detail : errorMessage(err);
      row.status.set(`Could not list models: ${text}`, 'error');
    }
  };

  const roleSection = (role: ModelRole): HTMLElement => {
    const selection = ctx.settings().models[role];
    const status = statusLine();
    const provider = h(
      'select',
      null,
      PROVIDER_IDS.map((id) => h('option', { value: id }, id === 'custom' ? ctx.settings().providers.custom.label || PROVIDERS.custom.label : PROVIDERS[id].label)),
    );
    provider.value = selection.provider;
    const picker = createModelPicker(`${ROLE_INFO[role].title} model`, (model) => {
      ctx
        .save({ models: { [role]: { provider: provider.value as ProviderId, model } } })
        .then(() => status.set('Saved', 'ok'))
        .catch((err) => status.set(errorMessage(err), 'error'));
    }, { toolsFilter: role === 'chat' });
    picker.setValue(selection.model);
    provider.addEventListener('change', () => {
      // Switching provider clears the model until one is picked from the new list.
      picker.setValue('');
      void fill(role);
    });
    pickers.set(role, { picker, provider, status });
    const refresh = button('Refresh list', () => void busy(refresh, () => fill(role, true), (m) => status.set(m, 'error')), 'cc-button-subtle');
    return section(ROLE_INFO[role].title, h('div', { class: 'cc-hint' }, ROLE_INFO[role].hint), field('Provider', provider), picker.el, h('div', { class: 'cc-row' }, refresh), status.el);
  };

  return {
    id: 'models',
    title: 'Models',
    el,
    refresh() {
      pickers.clear();
      el.replaceChildren(...MODEL_ROLES.map(roleSection));
      for (const role of MODEL_ROLES) void fill(role);
    },
    onSettings(settings) {
      for (const [role, row] of pickers) {
        if (row.picker.el.contains(document.activeElement)) continue;
        const sel = settings.models[role];
        if (row.provider.value !== sel.provider) {
          row.provider.value = sel.provider;
          void fill(role);
        }
        if (row.picker.value() !== sel.model) row.picker.setValue(sel.model);
      }
    },
  };
}
