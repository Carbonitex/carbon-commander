/** The chat view: header + badges, setup slot, transcript, confirmation, input, footer. */
import type { UiState } from '../state/reducer';
import { h } from '../dom';
import { formatUsage, truncate } from '../format';
import { prefersReducedMotion } from '../dom';
import { ConfirmView, type ConfirmReply } from './confirm';
import { InputView, type InputViewOptions } from './input';
import { StickyScroller } from './scroll';
import { TranscriptView } from './transcript';

export interface ChatViewOptions extends Omit<InputViewOptions, 'onChange'> {
  embedded: boolean;
  mock: boolean;
  onStop(): void;
  onClear(): void;
  onOpenSettings(tab?: 'providers' | 'models' | 'tools'): void;
  onClose(): void;
  onConfirm(id: string, reply: ConfirmReply): void;
  /** A confirmation appeared: ask the host to move the overlay to the top of the top layer. */
  onRaise?(): void;
  /** Layout may have changed (resize reporting). */
  onChange(): void;
}

export class ChatView {
  readonly el: HTMLElement;
  readonly input: InputView;
  readonly transcript: TranscriptView;
  readonly confirm: ConfirmView;
  /** Scroll container (transcript + confirm). */
  readonly scrollEl: HTMLElement;
  private readonly scroller: StickyScroller;
  private readonly setupSlot: HTMLElement;
  private readonly modelBadge: HTMLElement;
  private readonly connBadge: HTMLElement;
  private readonly pageToolsBadge: HTMLButtonElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly footer: HTMLElement;
  private readonly usageEl: HTMLElement;
  private readonly announcer: HTMLElement;
  private readonly thinkingEl: HTMLElement;
  private readonly closedEl: HTMLElement;
  private running = false;
  private lastFlash = 0;
  private lastStatus: string | null = null;

  constructor(private readonly options: ChatViewOptions) {
    this.input = new InputView({ ...options, onChange: () => options.onChange() });
    this.transcript = new TranscriptView({
      onErrorAction: (action) => options.onOpenSettings(action === 'setup' ? 'providers' : 'models'),
      onChange: () => {
        this.scroller.update();
        options.onChange();
      },
    });
    this.confirm = new ConfirmView({
      onReply: (id, reply) => options.onConfirm(id, reply),
      embedded: options.embedded,
      isTyping: () => this.input.isTyping(),
      announce: (text) => this.announce(text),
      ...(options.onRaise ? { onRaise: () => options.onRaise?.() } : {}),
    });
    this.thinkingEl = h('div', { class: 'cc-thinking', role: 'status', hidden: true }, 'Thinking…');
    this.closedEl = h(
      'div',
      { class: 'cc-tab-closed', role: 'alert', hidden: true },
      h('strong', { class: 'cc-error-title' }, 'Tab closed'),
      h('span', { class: 'cc-error-detail' }, 'The tab this conversation belonged to was closed. Close this bar; open it again on another page to start over.'),
    );

    this.modelBadge = h('button', { type: 'button', class: 'cc-badge', title: 'Model (open settings)', on: { click: () => options.onOpenSettings('models') } }, '…');
    this.connBadge = h('span', { class: 'cc-badge cc-badge-conn', role: 'status' });
    // "3 page tools": the page offers tools through WebMCP (hidden when it offers none).
    this.pageToolsBadge = h('button', { type: 'button', class: 'cc-badge cc-badge-page', hidden: true, on: { click: () => options.onOpenSettings('tools') } });
    const newChat = h('button', { type: 'button', class: 'cc-icon-button', title: 'New conversation', 'aria-label': 'New conversation', on: { click: () => options.onClear() } }, '+');
    const settings = h('button', { type: 'button', class: 'cc-icon-button', title: 'Settings', 'aria-label': 'Settings', on: { click: () => options.onOpenSettings() } }, '⚙');
    const close = options.embedded
      ? h('button', { type: 'button', class: 'cc-icon-button', title: 'Close (Esc)', 'aria-label': 'Close', on: { click: () => options.onClose() } }, '×')
      : null;

    this.setupSlot = h('div', { class: 'cc-setup-slot', hidden: true });
    this.scrollEl = h('div', { class: 'cc-scroll' }, this.setupSlot, this.transcript.el, this.thinkingEl, this.closedEl, this.confirm.el);
    this.scroller = new StickyScroller(this.scrollEl);

    this.sendButton = h('button', { type: 'button', class: 'cc-send', on: { click: () => this.onSendClick() } }, 'Send');
    this.usageEl = h('span', { class: 'cc-usage' });
    this.footer = h(
      'div',
      { class: 'cc-footer' },
      h('span', { class: 'cc-keys' }, 'Enter send · Shift+Enter newline · ↑↓ history · Tab accept · Esc stop/close'),
      this.usageEl,
    );
    this.announcer = h('div', { class: 'cc-visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });

    this.el = h(
      'div',
      { class: 'cc-chat' },
      h(
        'div',
        { class: 'cc-header' },
        h('span', { class: 'cc-title' }, 'CarbonCommander'),
        options.mock ? h('span', { class: 'cc-badge', data: { status: 'mock' } }, 'mock') : null,
        h('span', { class: 'cc-header-badges' }, this.modelBadge, this.connBadge, this.pageToolsBadge),
        h('span', { class: 'cc-header-actions' }, newChat, settings, close),
      ),
      this.scrollEl,
      h('div', { class: 'cc-input-row' }, this.input.el, this.sendButton),
      this.footer,
      this.announcer,
    );
  }

  private onSendClick(): void {
    if (this.running) {
      this.options.onStop();
      return;
    }
    const text = this.input.value.trim();
    if (!text) {
      this.input.focus();
      return;
    }
    this.input.submit();
  }

  setModelBadge(text: string, status: 'ok' | 'warn' | 'error'): void {
    this.modelBadge.textContent = truncate(text, 48);
    this.modelBadge.dataset.status = status;
  }

  /** Page tools (WebMCP) of the current page: `count` 0 hides the chip. `host` is page data: text only. */
  setPageTools(count: number, host?: string): void {
    const show = count > 0;
    this.pageToolsBadge.hidden = !show;
    if (!show) return;
    this.pageToolsBadge.textContent = `${count} page tool${count === 1 ? '' : 's'}`;
    const where = host ? truncate(host, 80) : 'This page';
    this.pageToolsBadge.title = `${where} offers ${count} tool${count === 1 ? '' : 's'} through WebMCP. The agent can use them and asks you first. Click to see them.`;
    this.pageToolsBadge.setAttribute('aria-label', `${count} page tool${count === 1 ? '' : 's'} offered by ${where} (open the tools list)`);
  }

  showSetup(content: HTMLElement | null): void {
    this.setupSlot.replaceChildren(...(content ? [content] : []));
    this.setupSlot.hidden = !content;
    this.options.onChange();
  }

  get setupVisible(): boolean {
    return !this.setupSlot.hidden;
  }

  announce(text: string): void {
    this.announcer.textContent = '';
    // New text node so screen readers re-announce identical strings.
    requestAnimationFrame(() => (this.announcer.textContent = truncate(text, 600)));
  }

  /** Brief visual flash of the bar (abort / error). */
  flash(): void {
    const target = this.el.closest('.cc-bar') ?? this.el;
    target.classList.remove('cc-flash');
    if (prefersReducedMotion()) return;
    void (target as HTMLElement).offsetWidth; // restart the animation
    target.classList.add('cc-flash');
  }

  render(state: UiState): void {
    const session = state.session;
    const status = session?.status ?? 'idle';
    this.running = status !== 'idle';
    this.transcript.render(session?.items ?? []);
    const newPrompt = this.confirm.show(session?.pendingConfirm ?? null);
    if (newPrompt) this.scroller.pin();
    const thinking = state.thinking && this.running;
    if (this.thinkingEl.hidden === thinking) {
      this.thinkingEl.hidden = !thinking;
      if (thinking) this.scroller.pin();
    }
    if (state.tabClosed && this.closedEl.hidden) {
      this.closedEl.hidden = false;
      this.scroller.pin();
    }
    this.input.setDisabled(state.tabClosed);
    this.sendButton.disabled = state.tabClosed;

    this.sendButton.textContent = this.running ? 'Stop' : 'Send';
    this.sendButton.classList.toggle('cc-stop', this.running);
    this.sendButton.setAttribute('aria-label', this.running ? 'Stop (Esc)' : 'Send (Enter)');
    this.el.classList.toggle('cc-running', this.running);
    this.el.closest('.cc-bar')?.setAttribute('data-state', status === 'awaiting-confirm' ? 'confirm' : status);

    const conn = state.connection;
    this.connBadge.textContent = conn === 'connected' ? '' : conn === 'connecting' ? 'connecting…' : 'disconnected';
    this.connBadge.dataset.status = conn;
    this.connBadge.hidden = conn === 'connected';

    const usage = session?.usage;
    this.usageEl.textContent = usage && usage.totalTokens > 0 ? formatUsage(usage) : '';
    this.usageEl.title = state.lastRunUsage ? `Last request: ${formatUsage(state.lastRunUsage)}` : '';

    if (state.flash !== this.lastFlash) {
      this.lastFlash = state.flash;
      this.flash();
    }
    if (this.lastStatus !== null && this.lastStatus !== 'idle' && status === 'idle' && session) {
      const text = TranscriptView.lastAssistantText(session.items);
      if (text) this.announce(text);
    }
    this.lastStatus = status;
    this.options.onChange();
  }

  scrollToBottom(): void {
    this.scroller.pin();
  }
}
