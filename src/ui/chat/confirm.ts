/**
 * Confirmation prompt for a tool call that needs approval (`confirm.request`).
 *
 * Guards against accidental and tricked approvals:
 * - **Arming delay**: the buttons ignore activation for `ARM_DELAY_MS` after the prompt appears
 *   (and after the overlay is shown again), so a click or Enter meant for something else cannot
 *   land on a prompt that just popped up.
 * - **Visibility check** (embedded only): a page can draw over our overlay (its own top-layer
 *   element, even with `pointer-events: none` so clicks pass through). The buttons are watched with
 *   an `IntersectionObserver` using `trackVisibility` (the browser's occlusion check, made for
 *   exactly this in cross-origin iframes). Activation is accepted only while the browser reports
 *   the buttons as visible, unobscured and unaltered. The check is conservative: it may say
 *   "not visible" when it is, never the opposite. Where the browser does not report visibility,
 *   only the arming delay applies.
 * - **No focus stealing**: the prompt never takes focus from the message box while the user is
 *   typing (focused, or typed recently); it is announced instead, and Shift+Tab from the message
 *   box reaches its buttons (Deny first). There are no single-letter shortcuts.
 */
import type { ConfirmRequest } from '../../shared/types';
import { h } from '../dom';
import { formatJson, truncate } from '../format';

export interface ConfirmReply {
  allow: boolean;
  always?: boolean;
}

/** Activations within this time after the prompt (or the overlay) appeared are ignored. */
export const ARM_DELAY_MS = 500;
/** Minimum time between two raise requests for the same prompt (a page could keep re-covering it). */
export const RAISE_INTERVAL_MS = 1_000;
/** `IntersectionObserver` `delay` for visibility tracking (the minimum the API accepts is 100). */
const VISIBILITY_DELAY_MS = 100;

/** The parts of an `IntersectionObserverEntry` we read (`isVisible` is IntersectionObserver v2). */
export interface VisibilityEntry {
  isIntersecting: boolean;
  isVisible?: boolean;
}

export type VisibilityObserverFactory = (callback: (entries: VisibilityEntry[]) => void) => {
  observe(el: Element): void;
  disconnect(): void;
} | null;

export interface ConfirmViewOptions {
  onReply(id: string, reply: ConfirmReply): void;
  /** In a web page (the visibility check applies), rather than an extension tab. */
  embedded: boolean;
  /** True while the user is typing in the message box (focused, or typed recently). */
  isTyping(): boolean;
  /** Screen-reader announcement. */
  announce(text: string): void;
  /**
   * Ask the host to move the overlay to the top of the top layer. Called only when needed: when the
   * visibility check reports the prompt covered (at most once per `RAISE_INTERVAL_MS`), or once
   * when a prompt appears and visibility cannot be tracked. Raising re-shows the top-layer
   * element, which briefly un-renders the iframe and can drop the keyboard focus inside it, so it
   * is not done when nothing covers the prompt.
   */
  onRaise?(): void;
  now?: () => number;
  /** Injectable for tests. Default: `IntersectionObserver` with `trackVisibility`. */
  observeVisibility?: VisibilityObserverFactory;
}

/** Default factory: null when the browser cannot track visibility. */
export const trackVisibilityObserver: VisibilityObserverFactory = (callback) => {
  if (typeof IntersectionObserver !== 'function') return null;
  try {
    // IntersectionObserver v2 options (Chrome 74+); TypeScript's DOM types do not list them yet.
    const init: IntersectionObserverInit & { trackVisibility: boolean; delay: number } = {
      threshold: [1],
      trackVisibility: true,
      delay: VISIBILITY_DELAY_MS,
    };
    const observer = new IntersectionObserver((entries) => callback(entries), init);
    if ((observer as { trackVisibility?: boolean }).trackVisibility !== true) {
      observer.disconnect();
      return null; // option ignored: no occlusion information
    }
    return observer;
  } catch {
    return null;
  }
};

export function describeConfirm(request: ConfirmRequest): string {
  switch (request.reason) {
    case 'egress':
      return request.egressHost ? `It sends a request to ${request.egressHost}.` : 'It sends a request to another site.';
    case 'args':
      return `It was called with ${(request.triggerArgs ?? []).join(', ') || 'options'} set.`;
    case 'page': {
      const host = request.origin && /^https?:/.test(request.origin) ? new URL(request.origin).host : '';
      return `This tool is provided by the web page${host ? ` ${host}` : ''}, not by Carbon Commander: the page decides what it does with these arguments.`;
    }
    default:
      return '';
  }
}

export class ConfirmView {
  readonly el: HTMLElement;
  private current: ConfirmRequest | null = null;
  private shownAt = 0;
  private hint: HTMLElement | null = null;
  private box: HTMLElement | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: ReturnType<VisibilityObserverFactory> = null;
  private lastRaise = -Infinity;
  /** Visibility tracking state: unsupported = only the arming delay applies. */
  private tracking: 'unsupported' | 'tracking' = 'unsupported';
  private visibleSince: number | null = null;
  private readonly now: () => number;

  constructor(private readonly options: ConfirmViewOptions) {
    this.now = options.now ?? (() => performance.now());
    this.el = h('div', { class: 'cc-confirm', hidden: true });
  }

  get pending(): ConfirmRequest | null {
    return this.current;
  }

  /** The overlay was shown again (or raised): restart the arming delay. */
  rearm(): void {
    if (!this.current) return;
    this.shownAt = this.now();
    this.scheduleReadyCheck();
  }

  /**
   * `data-ready` on the prompt says whether the buttons would accept a click right now (used
   * for styling and by the end-to-end test). Re-checked when the arming delay ends and whenever
   * the visibility report changes.
   */
  private updateReady(): void {
    if (this.box) this.box.dataset.ready = String(this.blockedReason() === null);
  }

  private scheduleReadyCheck(): void {
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.updateReady();
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      this.updateReady();
    }, ARM_DELAY_MS + 10);
  }

  /** Show / hide for the session's `pendingConfirm`. Returns true when a new prompt appeared. */
  show(request: ConfirmRequest | null): boolean {
    if (request?.id === this.current?.id) return false;
    this.stopObserving();
    this.current = request;
    if (!request) {
      this.el.hidden = true;
      this.el.replaceChildren();
      this.hint = null;
      this.box = null;
      if (this.readyTimer !== null) clearTimeout(this.readyTimer);
      this.readyTimer = null;
      return false;
    }
    const titleId = `cc-confirm-title-${request.id.replace(/[^\w-]/g, '')}`;
    const button = (label: string, cls: string, reply: ConfirmReply, title?: string): HTMLButtonElement =>
      h('button', { type: 'button', class: `cc-button ${cls}`, ...(title ? { title } : {}), on: { click: () => this.activate(reply) } }, label);
    const origin = request.origin && /^https?:/.test(request.origin) ? new URL(request.origin).host : '';
    const always = button(
      origin ? `Always allow on ${origin}` : 'Always allow this tool',
      '',
      { allow: true, always: true },
      `Do not ask again for this tool${origin ? ` on ${origin}` : ''} in this conversation`,
    );
    // Deny is the last button, so Shift+Tab from the message box reaches it first.
    const buttons = h(
      'div',
      { class: 'cc-confirm-buttons' },
      button('Allow', 'cc-button-confirm', { allow: true }),
      always,
      button('Deny', 'cc-button-cancel', { allow: false }),
    );
    const note = describeConfirm(request);
    this.hint = h('div', { class: 'cc-confirm-hint', role: 'status' });
    const box = h(
      'div',
      { class: 'cc-confirm-box', role: 'alertdialog', 'aria-modal': 'false', 'aria-labelledby': titleId, tabindex: '-1' },
      h('div', { class: 'cc-confirm-title', id: titleId }, 'Allow ', h('code', null, request.toolName), ` (${request.sourceLabel})?`, note ? ` ${note}` : ''),
      h('pre', { class: 'cc-tool-pre cc-confirm-args' }, truncate(formatJson(request.args), 4000)),
      buttons,
      this.hint,
    );
    this.box = box;
    this.el.replaceChildren(box);
    this.el.hidden = false;
    this.shownAt = this.now();
    this.startObserving(buttons);
    this.scheduleReadyCheck();
    this.lastRaise = -Infinity;
    if (this.tracking !== 'tracking') this.raise();
    if (this.options.isTyping()) {
      this.options.announce(`Approval needed for tool ${request.toolName}. ${note} Press Shift+Tab to review it.`);
    } else {
      box.focus({ preventScroll: true });
      this.options.announce(`Approval needed for tool ${request.toolName}. ${note}`);
    }
    return true;
  }

  private startObserving(target: Element): void {
    this.visibleSince = null;
    this.tracking = 'unsupported';
    if (!this.options.embedded) return;
    const factory = this.options.observeVisibility ?? trackVisibilityObserver;
    const observer = factory((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const visible = entry.isIntersecting && entry.isVisible === true;
      if (!visible) {
        this.visibleSince = null;
        // Something may be drawn over the overlay: move it back to the top.
        if (this.now() - this.lastRaise >= RAISE_INTERVAL_MS) this.raise();
      } else this.visibleSince ??= this.now();
      this.updateReady();
    });
    if (!observer) return;
    this.observer = observer;
    this.tracking = 'tracking';
    observer.observe(target);
  }

  private raise(): void {
    if (!this.options.embedded) return;
    this.lastRaise = this.now();
    this.options.onRaise?.();
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.visibleSince = null;
  }

  /** Why an activation right now would be refused, or null when it is accepted. */
  blockedReason(): string | null {
    if (!this.current) return 'No prompt';
    const t = this.now();
    if (t - this.shownAt < ARM_DELAY_MS) return 'Just a moment: the buttons work half a second after the prompt appears.';
    if (this.tracking === 'tracking' && this.visibleSince === null) {
      return 'Not accepted: the prompt is not fully visible (something on the page may be covering it). Make sure it is visible, then try again.';
    }
    return null;
  }

  private activate(reply: ConfirmReply): void {
    const reason = this.blockedReason();
    if (reason) {
      if (this.hint) this.hint.textContent = reason;
      return;
    }
    this.reply(reply);
  }

  /** Send a reply (bypasses the guards: used for Esc = deny, which is always safe). */
  reply(reply: ConfirmReply): void {
    const request = this.current;
    if (!request) return;
    this.options.onReply(request.id, reply);
  }
}
