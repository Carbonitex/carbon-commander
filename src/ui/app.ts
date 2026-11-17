/**
 * Wires the bar: store + connection + chat view + settings view + host messaging + resize.
 * Runs inside the content script's iframe or as a standalone extension tab.
 */
import { PROVIDERS } from '../shared/defaults';
import type { ProviderStatus, Settings } from '../shared/types';
import { matchesKeybind } from '../content/keybind';
import { Autocompleter } from './chat/autocomplete';
import { InputHistory } from './chat/history';
import { createSetupView, needsSetup } from './chat/setup';
import { ChatView } from './chat/view';
import { createMcpHint } from './chat/mcp-hint';
import { createConnection } from './connection';
import { h } from './dom';
import type { UiEnv } from './env';
import { createResizeReporter, isEmbedded, onHostMessage, postToHost, type ResizeReporter } from './host';
import { createStore, isRunActive, type UiState } from './state/reducer';
import { SettingsView, type SettingsTab } from './settings/view';

/** After a raise, focus lost to `<body>` is restored for this long (see `restoreFocusAfterRaise`). */
const RESTORE_FOCUS_WINDOW_MS = 1_000;

/** Body padding (px) around the bar inside the iframe, so the glow is not clipped. */
const FRAME_PADDING = 16;

export async function startApp(root: HTMLElement, env: UiEnv): Promise<void> {
  const embedded = isEmbedded();
  document.documentElement.classList.toggle('cc-embedded', embedded);
  const store = createStore();
  const history = new InputHistory(await env.loadHistory().catch(() => []));
  let statuses: ProviderStatus[] = [];
  let view: 'chat' | 'settings' = 'chat';
  let settingsView: SettingsView | null = null;
  let contextLostShown = false;
  let focusBeforeRaise: Element | null = null;

  const connection = createConnection({
    connect: () => env.connect(),
    dispatch: (action) => store.dispatch(action),
    tabId: env.tabId,
    isContextValid: () => env.isContextValid(),
  });

  const autocompleter = new Autocompleter({
    request: (text) => env.rpc('autocomplete', env.tabId === undefined ? { text } : { text, tabId: env.tabId }),
    onSuggestions: (text, suggestions) => chat.input.showSuggestions(text, suggestions),
  });

  const bar = h('div', { class: 'cc-bar', data: { state: 'idle' } });
  const report: ResizeReporter = embedded ? createResizeReporter(() => measure()) : Object.assign(() => undefined, { force: () => undefined });

  const chat: ChatView = new ChatView({
    embedded,
    mock: env.mock === true,
    history,
    autocompleter,
    onSubmit(text) {
      if (store.get().tabClosed) return false;
      // Refused while (re)connecting: the text stays in the box, so nothing typed is ever lost.
      if (!connection.send({ type: 'run.start', text })) {
        chat.announce('Not connected yet: your message was not sent. Press Enter again in a moment.');
        chat.flash();
        return false;
      }
      // After InputView has added the text to the history.
      queueMicrotask(() => void env.saveHistory(history.toArray()).catch(() => undefined));
      chat.scrollToBottom();
      return true;
    },
    onStop: () => connection.send({ type: 'run.abort' }),
    onClear() {
      connection.send({ type: 'session.clear' });
      chat.input.focus();
    },
    onOpenSettings: (tab) => showSettings(tab),
    onClose: () => postToHost({ cc: 'close' }),
    onConfirm: (id, reply) =>
      void connection.send(reply.always ? { type: 'confirm.reply', id, allow: reply.allow, always: true } : { type: 'confirm.reply', id, allow: reply.allow }),
    onRaise: () =>
      // After the prompt has set (or kept) the focus: remember it, the raise will drop it.
      queueMicrotask(() => {
        focusBeforeRaise = document.activeElement;
        postToHost({ cc: 'raise' });
      }),
    onChange: () => report(),
  });

  // "MCP server available" chip for sites that advertise one (see mcp/discovery.ts).
  const mcpHint = createMcpHint({ rpc: env.rpc, tabId: env.tabId, onOpen: () => showSettings('mcp'), onChange: () => report() });
  chat.el.querySelector('.cc-header-badges')?.append(mcpHint.el);

  // --- views -----------------------------------------------------------------------------------

  const showChat = (): void => {
    view = 'chat';
    bar.replaceChildren(chat.el);
    void refreshSetup();
    mcpHint.refresh();
    chat.input.focus();
    report();
  };

  const showSettings = (tab?: SettingsTab): void => {
    view = 'settings';
    settingsView ??= new SettingsView({
      rpc: env.rpc,
      tabId: env.tabId,
      getSettings: () => store.get().settings,
      onSettings: (s) => store.dispatch({ type: 'settings', settings: s }),
      onBack: showChat,
      onChange: () => report(),
    });
    bar.replaceChildren(settingsView.el);
    settingsView.open(tab);
    if (resizeObserver) for (const panel of settingsView.el.querySelectorAll('.cc-panel')) resizeObserver.observe(panel);
    report();
  };

  // --- settings / setup ------------------------------------------------------------------------

  const updateBadge = (settings: Settings | null): void => {
    if (!settings) return;
    const sel = settings.models.chat;
    const label = sel.provider === 'custom' ? settings.providers.custom.label || PROVIDERS.custom.label : PROVIDERS[sel.provider].label;
    const status = statuses.find((s) => s.id === sel.provider);
    const missingKey = !!status && status.needsKey && !status.hasKey;
    chat.setModelBadge(sel.model ? `${label} · ${sel.model.split('/').pop() ?? sel.model}` : `${label} · no model`, missingKey ? 'error' : sel.model ? 'ok' : 'warn');
  };

  const refreshSetup = async (): Promise<void> => {
    const settings = store.get().settings;
    if (!settings) return;
    try {
      statuses = await env.rpc('providers.status', {});
    } catch {
      return; // worker unavailable: the connection badge already says so
    }
    updateBadge(settings);
    const needed = needsSetup(settings, statuses);
    if (needed && !chat.setupVisible) {
      chat.showSetup(
        createSetupView({
          rpc: env.rpc,
          onSaved: (s) => store.dispatch({ type: 'settings', settings: s }),
          onDone: () => void refreshSetup(),
          onOpenSettings: () => showSettings('providers'),
          onChange: () => report(),
        }),
      );
    } else if (!needed && chat.setupVisible) {
      chat.showSetup(null);
      chat.input.focus();
    }
  };

  // --- page tools chip (WebMCP) ----------------------------------------------------------------

  /**
   * Asked when the bar starts or is shown again, after each run and when settings change (a page
   * can register tools at any time; this is a cheap snapshot, not a live view). Late answers of an
   * older request are dropped.
   */
  let pageToolsRequest = 0;
  const refreshPageTools = (): void => {
    const id = ++pageToolsRequest;
    env.rpc('webmcp.status', env.tabId === undefined ? {} : { tabId: env.tabId }).then(
      (status) => {
        if (id === pageToolsRequest) chat.setPageTools(status.enabled ? status.count : 0, status.host);
      },
      () => {
        if (id === pageToolsRequest) chat.setPageTools(0);
      },
    );
  };

  // --- store -> views --------------------------------------------------------------------------

  const onState = (state: UiState, prev: UiState | null): void => {
    chat.render(state);
    if (prev && isRunActive(prev) && !isRunActive(state)) refreshPageTools();
    connection.setKeepalive(isRunActive(state) && state.connection === 'connected');
    if (state.settings && state.settings !== prev?.settings) {
      autocompleter.setEnabled(state.settings.autocomplete);
      updateBadge(state.settings);
      settingsView?.update(state.settings);
      if (prev?.settings) void refreshSetup();
      if (prev?.settings && prev.settings.webmcp !== state.settings.webmcp) refreshPageTools();
    }
    if (state.connection === 'disconnected' && !env.isContextValid() && !contextLostShown) {
      contextLostShown = true;
      store.dispatch({
        type: 'local-error',
        id: 'context-lost',
        at: Date.now(),
        error: { code: 'unknown', message: 'Carbon Commander was updated or reloaded. Close this bar and open it again.' },
      });
    }
  };
  store.subscribe(onState);

  // --- keyboard --------------------------------------------------------------------------------

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (view === 'settings') {
        showChat();
      } else if (isRunActive(store.get())) {
        connection.send({ type: 'run.abort' });
        chat.flash();
      } else if (embedded) {
        postToHost({ cc: 'close' });
      }
      return;
    }
    if (embedded && matchesKeybind(event, store.get().settings?.keybind)) {
      event.preventDefault();
      postToHost({ cc: 'close' });
    }
  });

  // --- host ------------------------------------------------------------------------------------

  /**
   * Re-showing the top-layer element un-renders the iframe for a moment. The bar's document (in its
   * own process) may notice that a little later and drop its focus then, so the focus is restored
   * not just once on `raised` but whenever it is lost during a short window after it.
   */
  const restoreFocusAfterRaise = (): void => {
    const target = focusBeforeRaise;
    focusBeforeRaise = null;
    if (!(target instanceof HTMLElement) || target === document.body) return;
    const until = performance.now() + RESTORE_FOCUS_WINDOW_MS;
    const check = (): void => {
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (lost && target.isConnected) target.focus({ preventScroll: true });
      if (performance.now() < until) requestAnimationFrame(check);
    };
    check();
  };

  onHostMessage((message) => {
    if (message.cc === 'shown') {
      mcpHint.refresh();
      chat.confirm.rearm();
      if (view === 'chat') chat.input.focus();
      report.force();
      refreshPageTools();
    } else if (message.cc === 'hidden') {
      autocompleter.cancel();
    } else if (message.cc === 'raised') {
      restoreFocusAfterRaise();
    }
  });

  /**
   * The height the bar needs, independent of the iframe's current height. While the iframe is
   * smaller than the content, the bar is clamped to it: the scroll area shrinks (its hidden part
   * is `scrollHeight - clientHeight`) and, once it is at zero, the fixed parts (header, input,
   * footer) overflow the bar itself (`bar.scrollHeight - bar.clientHeight`). Both are added, or
   * a bar opened at the initial 96 px with an empty conversation would measure 96 and never grow.
   */
  const measure = (): number => {
    const scroller = view === 'chat' ? chat.scrollEl : (settingsView?.el.querySelector<HTMLElement>('.cc-settings-body') ?? null);
    const scrollerOverflow = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    const barOverflow = Math.max(0, bar.scrollHeight - bar.clientHeight);
    return bar.offsetHeight + barOverflow + scrollerOverflow + FRAME_PADDING * 2;
  };
  const resizeObserver = embedded && typeof ResizeObserver === 'function' ? new ResizeObserver(() => report()) : null;
  resizeObserver?.observe(bar);
  resizeObserver?.observe(chat.transcript.el);
  bar.addEventListener('toggle', () => report(), true); // <details> in tool cards

  // --- start -----------------------------------------------------------------------------------

  root.replaceChildren(bar);
  showChat();
  onState(store.get(), null);
  connection.start();
  window.addEventListener('pagehide', () => connection.dispose());

  try {
    const settings = await env.rpc('settings.get');
    store.dispatch({ type: 'settings', settings });
    refreshPageTools();
    await refreshSetup();
  } catch (err) {
    store.dispatch({
      type: 'local-error',
      id: 'settings-load',
      at: Date.now(),
      error: { code: 'unknown', message: `Could not load settings: ${err instanceof Error ? err.message : String(err)}` },
    });
  }
}
