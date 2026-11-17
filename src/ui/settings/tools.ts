/** Tools list (`tools.list`) with enable / disable (`Settings.disabledTools`). */
import type { ToolInfo } from '../../shared/types';
import { h } from '../dom';
import { errorMessage, type SettingsContext, type SettingsPanel } from './context';
import { section, statusLine, uid } from './fields';

export function toggleDisabled(disabled: readonly string[], name: string, enabled: boolean): string[] {
  const set = new Set(disabled);
  if (enabled) set.delete(name);
  else set.add(name);
  return [...set].sort();
}

export function createToolsPanel(ctx: SettingsContext): SettingsPanel {
  const el = h('div', { class: 'cc-panel' });
  const status = statusLine();
  const filter = h('input', { type: 'search', placeholder: 'Filter tools…', 'aria-label': 'Filter tools' });
  const listEl = h('div', { class: 'cc-tools-list' });
  let tools: ToolInfo[] = [];

  const render = (): void => {
    const q = filter.value.trim().toLowerCase();
    const disabled = new Set(ctx.settings().disabledTools);
    const groups = new Map<string, ToolInfo[]>();
    for (const t of tools) {
      if (q && !`${t.name} ${t.description} ${t.sourceLabel}`.toLowerCase().includes(q)) continue;
      const list = groups.get(t.sourceLabel) ?? [];
      list.push(t);
      groups.set(t.sourceLabel, list);
    }
    listEl.replaceChildren(
      ...[...groups].map(([label, list]) =>
        section(
          `${label} (${list.length})`,
          ...list.map((t) => {
            const id = uid('cc-tool');
            const box = h('input', { type: 'checkbox', id });
            box.checked = !disabled.has(t.name);
            box.addEventListener('change', () => {
              ctx
                .save({ disabledTools: toggleDisabled(ctx.settings().disabledTools, t.name, box.checked) })
                .catch((err) => {
                  box.checked = !box.checked;
                  status.set(errorMessage(err), 'error');
                });
            });
            return h(
              'div',
              { class: 'cc-tool-row' },
              h('label', { for: id }, box, ' ', h('code', null, t.name), t.mutates ? h('span', { class: 'cc-pill', data: { tone: 'warn' } }, 'changes things') : null, t.egress ? h('span', { class: 'cc-pill', data: { tone: 'warn' } }, 'sends requests') : null),
              h('div', { class: 'cc-hint' }, t.description),
            );
          }),
        ),
      ),
    );
    if (!groups.size) listEl.append(h('div', { class: 'cc-hint' }, tools.length ? 'No tools match.' : 'No tools available for this tab.'));
  };
  filter.addEventListener('input', render);

  return {
    id: 'tools',
    title: 'Tools',
    el,
    refresh() {
      el.replaceChildren(filter, listEl, status.el);
      status.set('Loading tools…');
      ctx.rpc('tools.list', ctx.tabId === undefined ? {} : { tabId: ctx.tabId }).then(
        (list) => {
          tools = list;
          status.set(`${list.length} tools`);
          render();
        },
        (err) => status.set(`Could not list tools: ${errorMessage(err)}`, 'error'),
      );
    },
    onSettings() {
      if (!el.contains(document.activeElement)) render();
    },
  };
}
