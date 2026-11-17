/**
 * Searchable model list (native `<select size>` so it is keyboard / screen reader friendly).
 * Shows context length, price and tool support when the provider reports them.
 */
import type { ModelInfo } from '../../shared/types';
import { h } from '../dom';
import { describeModel } from '../format';
import { uid } from './fields';

export interface ModelPicker {
  el: HTMLElement;
  setModels(models: ModelInfo[]): void;
  setValue(id: string): void;
  value(): string;
}

/** Pure filter (exported for tests). */
export function filterModels(models: readonly ModelInfo[], query: string, toolsOnly: boolean): ModelInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    if (toolsOnly && m.supportsTools === false) return false;
    const hay = `${m.id} ${m.name}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** The list shows at most this many models (a `<select>` with thousands of options is sluggish). */
export const MAX_LISTED_MODELS = 300;

/** Count line under the list (exported for tests). */
export function modelCountText(matching: number, total: number): string {
  if (total === 0) return '';
  if (matching > MAX_LISTED_MODELS) return `Showing ${MAX_LISTED_MODELS} of ${matching} models; type to filter.`;
  return matching === total ? `${total} models` : `${matching} of ${total} models match`;
}

export function createModelPicker(label: string, onChange: (id: string) => void, options: { toolsFilter?: boolean } = {}): ModelPicker {
  let models: ModelInfo[] = [];
  let current = '';
  const searchId = uid('cc-model-search');
  const listId = uid('cc-model-list');
  const search = h('input', { type: 'search', id: searchId, placeholder: 'Filter models…', autocomplete: 'off', 'aria-controls': listId });
  const toolsOnly = h('input', { type: 'checkbox', id: uid('cc-tools-only') });
  toolsOnly.checked = options.toolsFilter ?? false;
  const list = h('select', { id: listId, size: 6, class: 'cc-model-list', 'aria-label': label });
  const info = h('div', { class: 'cc-hint', 'aria-live': 'polite' });
  const count = h('div', { class: 'cc-hint cc-model-count' });

  const describeCurrent = (): void => {
    const m = models.find((x) => x.id === current);
    info.textContent = current ? `Selected: ${current}${m ? ` — ${describeModel(m)}` : models.length ? ' (not in the provider list)' : ''}` : 'No model selected';
  };

  const render = (): void => {
    const filtered = filterModels(models, search.value, toolsOnly.checked);
    count.textContent = modelCountText(filtered.length, models.length);
    const opts = filtered.slice(0, MAX_LISTED_MODELS).map((m) => {
      const detail = describeModel(m);
      const opt = h('option', { value: m.id }, detail ? `${m.name || m.id} — ${detail}` : m.name || m.id);
      opt.title = m.id;
      return opt;
    });
    if (current && !filtered.some((m) => m.id === current)) {
      opts.unshift(h('option', { value: current }, `${current} (current)`));
    }
    list.replaceChildren(...opts);
    list.value = current;
    describeCurrent();
  };

  search.addEventListener('input', render);
  toolsOnly.addEventListener('change', render);
  list.addEventListener('change', () => {
    current = list.value;
    describeCurrent();
    onChange(current);
  });

  const el = h(
    'div',
    { class: 'cc-model-picker' },
    h('div', { class: 'cc-model-filter' }, h('label', { for: searchId, class: 'cc-visually-hidden' }, `Filter ${label}`), search, h('label', { for: toolsOnly.id, class: 'cc-inline' }, toolsOnly, ' tools only')),
    list,
    count,
    info,
  );
  return {
    el,
    setModels(next) {
      models = next;
      render();
    },
    setValue(id) {
      current = id;
      render();
    },
    value: () => current,
  };
}
