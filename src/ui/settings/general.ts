/** Prompts, behaviour toggles, step limit, fallback keybind, debug logging, reset. */
import { MAX_STEPS_LIMIT } from '../../shared/defaults';
import type { Settings, SettingsPatch } from '../../shared/types';
import { formatKeybind, keybindFromEvent } from '../../content/keybind';
import { h } from '../dom';
import { errorMessage, type SettingsContext, type SettingsPanel } from './context';
import { button, checkbox, field, section, statusLine, textInput } from './fields';

/** `example.com` from user input like `https://www.example.com/path`; null when invalid. */
export function normaliseHost(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname || null;
  } catch {
    return null;
  }
}

export function createGeneralPanel(ctx: SettingsContext): SettingsPanel {
  const el = h('div', { class: 'cc-panel' });
  const status = statusLine();

  const save = (patch: SettingsPatch, okText = 'Saved'): void => {
    ctx.save(patch).then(
      () => status.set(okText, 'ok'),
      (err) => status.set(errorMessage(err), 'error'),
    );
  };

  const render = (s: Settings): void => {
    const systemPrompt = h('textarea', { rows: 4, placeholder: 'Extra instructions added to every conversation' });
    systemPrompt.value = s.systemPrompt;
    systemPrompt.addEventListener('change', () => save({ systemPrompt: systemPrompt.value }));

    // Per-site prompts.
    const siteList = h('div', { class: 'cc-site-prompts' });
    const renderSites = (prompts: Record<string, string>): void => {
      siteList.replaceChildren(
        ...Object.entries(prompts).map(([host, text]) => {
          const ta = h('textarea', { rows: 2, 'aria-label': `Prompt for ${host}` });
          ta.value = text;
          ta.addEventListener('change', () => save({ sitePrompts: { ...ctx.settings().sitePrompts, [host]: ta.value } }));
          const remove = button('Remove', () => {
            const next = { ...ctx.settings().sitePrompts };
            delete next[host];
            save({ sitePrompts: next }, 'Removed');
            renderSites(next);
          }, 'cc-button-subtle', { 'aria-label': `Remove prompt for ${host}` });
          return h('div', { class: 'cc-site-prompt' }, h('div', { class: 'cc-row' }, h('code', null, host), remove), ta);
        }),
      );
    };
    renderSites(s.sitePrompts);
    const newHost = textInput('', { placeholder: 'example.com' });
    const addSite = button('Add site', () => {
      const host = normaliseHost(newHost.value);
      if (!host) {
        status.set('Enter a hostname like example.com', 'error');
        return;
      }
      const next = { ...ctx.settings().sitePrompts, [host]: ctx.settings().sitePrompts[host] ?? '' };
      newHost.value = '';
      renderSites(next);
      save({ sitePrompts: next }, 'Added');
    });

    const maxSteps = h('input', { type: 'number', min: 1, max: MAX_STEPS_LIMIT, step: 1 });
    maxSteps.value = String(s.maxSteps);
    maxSteps.addEventListener('change', () => {
      const n = Math.round(Number(maxSteps.value));
      if (!Number.isFinite(n) || n < 1 || n > MAX_STEPS_LIMIT) {
        status.set(`Max steps must be 1–${MAX_STEPS_LIMIT}`, 'error');
        return;
      }
      save({ maxSteps: n });
    });

    // Keybind capture.
    const kbDisplay = h('span', { class: 'cc-kbd' }, formatKeybind(s.keybind));
    const capture = h('button', { type: 'button', class: 'cc-button', 'aria-describedby': 'cc-kb-hint' }, s.keybind ? 'Change' : 'Set shortcut');
    let capturing = false;
    capture.addEventListener('click', () => {
      capturing = !capturing;
      capture.textContent = capturing ? 'Press keys… (Esc cancels)' : s.keybind ? 'Change' : 'Set shortcut';
    });
    capture.addEventListener('keydown', (event) => {
      if (!capturing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        capturing = false;
        capture.textContent = 'Change';
        return;
      }
      if (event.key === 'Tab') return;
      const kb = keybindFromEvent(event);
      event.preventDefault();
      event.stopPropagation();
      if (!kb) return;
      capturing = false;
      kbDisplay.textContent = formatKeybind(kb);
      capture.textContent = 'Change';
      save({ keybind: kb });
    });
    const clearKb = button('Clear', () => {
      kbDisplay.textContent = formatKeybind(null);
      save({ keybind: null });
    }, 'cc-button-subtle');

    let resetArmed = false;
    const reset = button('Reset all settings', () => {
      if (!resetArmed) {
        resetArmed = true;
        reset.textContent = 'Click again to reset';
        setTimeout(() => {
          resetArmed = false;
          reset.textContent = 'Reset all settings';
        }, 4000);
        return;
      }
      ctx.rpc('settings.reset').then(
        (fresh) => {
          ctx.replace(fresh);
          status.set('Settings reset (API keys are kept)', 'ok');
        },
        (err) => status.set(errorMessage(err), 'error'),
      );
    }, 'cc-button-cancel');

    el.replaceChildren(
      section('Prompts', field('System prompt', systemPrompt), h('div', { class: 'cc-label' }, 'Per-site prompts'), siteList, h('div', { class: 'cc-row' }, newHost, addSite)),
      section(
        'Behaviour',
        checkbox('Ask before tools change things', s.confirmMutations, (v) => save({ confirmMutations: v }), 'Clicking, typing, navigating, MCP tools (unless a server is set to trust read-only hints) and tools offered by the page.'),
        field('Max steps per request', maxSteps),
        checkbox('Autocomplete suggestions while typing', s.autocomplete, (v) => save({ autocomplete: v })),
        checkbox(
          'Use tools offered by the page (WebMCP)',
          s.webmcp,
          (v) => save({ webmcp: v }),
          'Pages can offer tools to AI agents (document.modelContext). The page decides what they do, so each use asks first. Takes effect on pages loaded after the change.',
        ),
      ),
      section(
        'Shortcut',
        h('div', { class: 'cc-row' }, h('span', null, 'In-page fallback: '), kbDisplay, capture, clearKb),
        h('div', { class: 'cc-hint', id: 'cc-kb-hint' }, 'The main shortcut (Ctrl/Cmd+K) is set at chrome://extensions/shortcuts. The fallback works on pages where that one is taken.'),
      ),
      section('Advanced', checkbox('Debug logging (console)', s.debugLogging, (v) => save({ debugLogging: v })), h('div', { class: 'cc-row' }, reset)),
      status.el,
    );
  };

  return {
    id: 'general',
    title: 'General',
    el,
    refresh: () => render(ctx.settings()),
    onSettings(settings) {
      if (!el.contains(document.activeElement)) render(settings);
    },
  };
}
