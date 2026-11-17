/**
 * The in-page overlay: a host element with a closed shadow root holding a `<dialog>` (backdrop +
 * the extension-origin `bar.html` iframe). No app logic and nothing from the page is ever rendered.
 * The iframe is kept alive while hidden so a conversation survives toggling.
 *
 * Stacking. The overlay must sit in the browser's top layer, above everything the page draws:
 * - normally the host is a manual popover (`showPopover()`) and the dialog is shown non-modally
 *   inside it, so the page stays usable (and focusable) for the agent's page tools;
 * - when the page has a modal dialog open (`:modal`), a popover would be inert under it, so the
 *   dialog is opened with `showModal()` instead and stacks above the page's modal. While the bar is
 *   open in that mode the page (including its dialog) is inert for the user: scripted clicks from
 *   page tools still work, but nothing on the page can take focus.
 * - `raise()` (asked by the bar when a confirmation appears) moves the overlay back to the top of
 *   the top layer, in case the page opened its own popover / modal above it since.
 *
 * Channel. On every iframe load we started, a fresh `MessageChannel` is created and one port is
 * transferred to the bar with the handshake token, target origin pinned to the extension. All bar
 * <-> host traffic uses that port; the bar never posts to the page's window, so the page never gets
 * a message (or `event.source`, a reference to the bar's window) from it. A load we did not start
 * (something navigated our iframe) is treated as hostile: the iframe is destroyed and recreated.
 *
 * Every page-originated event handler ignores synthetic (`isTrusted === false`) events.
 */
import {
  isFrameToHostMessage,
  newBarToken,
  type FrameToHostMessage,
  type HostInitMessage,
  type HostToFrameMessage,
} from '../shared/protocol';

export const OVERLAY_TAG = 'carbon-commander-overlay';
const MIN_HEIGHT = 64;
const INITIAL_HEIGHT = 96;
/** Space kept free above the bar (fraction of the viewport). */
const TOP_OFFSET_VH = 7;
const MAX_HEIGHT_VH = 86;

export interface OverlayOptions {
  /**
   * `chrome-extension://<id>` (no trailing slash): the origin the bar document really has. With
   * `use_dynamic_url` the iframe is loaded from a per-session URL, but its origin stays this one.
   */
  extensionOrigin: string;
  /** Full URL of bar.html (the dynamic URL from `chrome.runtime.getURL`). */
  barUrl: string;
  /**
   * Register a fresh handshake token with the worker (see `shared/protocol.ts`). Called on every
   * load of the iframe; the token is then posted to the iframe with the channel port. Omitted in
   * tests (no `init` is sent then).
   */
  registerToken?: (token: string) => Promise<boolean>;
  doc?: Document;
}

export interface Overlay {
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Move the open overlay to the top of the top layer (switching to modal mode if needed). */
  raise(): void;
  /**
   * Make an open overlay invisible without closing it (the iframe stays alive), e.g. for a
   * screenshot. Resolves true once the hidden state has been painted, false if it was not open.
   */
  suspend(): Promise<boolean>;
  /** Undo `suspend`. */
  resume(): void;
  dispose(): void;
}

/** Resolve after the next frames have been rendered (with a timeout for background tabs). */
function afterPaint(win: Window): Promise<void> {
  return new Promise((resolve) => {
    const timer = win.setTimeout(resolve, 300);
    const done = (): void => {
      win.clearTimeout(timer);
      // One more short beat so the compositor has presented the frame.
      win.setTimeout(resolve, 30);
    };
    if (typeof win.requestAnimationFrame !== 'function') return;
    win.requestAnimationFrame(() => win.requestAnimationFrame(done));
  });
}

/**
 * Inline styles on the host. Layout is also forced from inside the shadow root (`:host` rules
 * marked !important win over everything the page can set, including the page's own !important
 * rules); visibility (`display`, `visibility`) is controlled inline only, so `:host` must not reset it.
 */
const HOST_STYLE: Record<string, string> = {
  position: 'fixed',
  inset: '0',
  width: '100vw',
  height: '100vh',
  'max-width': 'none',
  'max-height': 'none',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  overflow: 'hidden',
  'z-index': '2147483647',
  display: 'none',
  'color-scheme': 'light dark',
  contain: 'strict',
};

const SHADOW_CSS = `
:host {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  max-width: none !important; max-height: none !important; min-width: 0 !important; min-height: 0 !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important;
  overflow: hidden !important; z-index: 2147483647 !important; contain: strict !important;
  opacity: 1 !important; transform: none !important; filter: none !important; clip-path: none !important;
  pointer-events: auto !important; color-scheme: light dark !important;
}
dialog {
  position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none;
  margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden; color: inherit;
  outline: none; opacity: 1; transform: none; filter: none;
}
dialog:not([open]) { display: none; }
dialog::backdrop { background: transparent; }
.backdrop {
  position: fixed; inset: 0; margin: 0; padding: 0; border: 0;
  background: rgba(0, 0, 0, 0.28);
}
.frame-wrap {
  position: fixed; top: ${TOP_OFFSET_VH}vh; left: 50%; transform: translateX(-50%);
  width: min(720px, 94vw); margin: 0; padding: 0; border: 0; background: transparent;
}
iframe {
  display: block; width: 100%; height: ${INITIAL_HEIGHT}px; margin: 0; padding: 0; border: 0;
  background: transparent; color-scheme: light dark; transition: height 120ms ease-out;
}
@media (prefers-reduced-motion: reduce) { iframe { transition: none; } }
`;

function deepActiveElement(doc: Document): Element | null {
  let el = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Does the page have a modal dialog (or other `:modal` element) open? */
function pageHasModal(doc: Document): boolean {
  try {
    return doc.querySelector(':modal') !== null;
  } catch {
    return false; // `:modal` unsupported (very old engines / jsdom)
  }
}

export function createOverlay(options: OverlayOptions): Overlay {
  const doc = options.doc ?? document;
  const win = doc.defaultView ?? window;

  const host = doc.createElement(OVERLAY_TAG);
  for (const [prop, value] of Object.entries(HOST_STYLE)) host.style.setProperty(prop, value, 'important');
  const usePopover = typeof host.showPopover === 'function';
  if (usePopover) host.setAttribute('popover', 'manual');

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = SHADOW_CSS;
  const layer = doc.createElement('dialog');
  layer.setAttribute('aria-label', 'Carbon Commander');
  const canModal = typeof layer.showModal === 'function';
  const backdrop = doc.createElement('div');
  backdrop.className = 'backdrop';
  const wrap = doc.createElement('div');
  wrap.className = 'frame-wrap';
  layer.append(backdrop, wrap);
  shadow.append(style, layer);

  let iframe: HTMLIFrameElement | null = null;
  /** Host end of the channel to the current bar document. */
  let port: MessagePort | null = null;
  /** The next `load` of the current iframe is the one we started by setting `src`. */
  let expectLoad = false;
  let open = false;
  let modal = false;
  let requestedHeight = INITIAL_HEIGHT;
  let previousFocus: Element | null = null;
  /** Latest visibility hint, (re)sent when a bar document connects. */
  let visibility: HostToFrameMessage | null = null;

  const post = (message: HostToFrameMessage): void => {
    visibility = message;
    port?.postMessage(message);
  };

  const applyHeight = (): void => {
    if (!iframe) return;
    const max = Math.max(MIN_HEIGHT, Math.floor((win.innerHeight * MAX_HEIGHT_VH) / 100));
    const height = Math.min(Math.max(requestedHeight, MIN_HEIGHT), max);
    iframe.style.height = `${height}px`;
  };

  const onFrameMessage = (event: MessageEvent): void => {
    if (!isFrameToHostMessage(event.data)) return;
    const message: FrameToHostMessage = event.data;
    if (message.cc === 'close') overlay.hide();
    else if (message.cc === 'raise') {
      overlay.raise();
      port?.postMessage({ cc: 'raised' } satisfies HostToFrameMessage);
    }
    else {
      requestedHeight = message.height;
      applyHeight();
    }
  };

  const closePort = (): void => {
    if (!port) return;
    port.onmessage = null;
    port.close();
    port = null;
  };

  /** Destroy the current iframe (if any) and load a fresh bar document (fresh handshake). */
  const createFrame = (): void => {
    closePort();
    iframe?.remove();
    const frame = doc.createElement('iframe');
    frame.title = 'Carbon Commander';
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('allowtransparency', 'true');
    frame.addEventListener('load', () => onLoad(frame));
    iframe = frame;
    expectLoad = true;
    frame.src = options.barUrl;
    wrap.append(frame);
    applyHeight();
  };

  const onLoad = (frame: HTMLIFrameElement): void => {
    if (frame !== iframe) return;
    if (!expectLoad) {
      // We did not navigate this iframe: someone else did. Start over with a fresh document.
      createFrame();
      if (open) iframe?.focus();
      return;
    }
    expectLoad = false;
    closePort();
    const register = options.registerToken;
    const target = frame.contentWindow;
    if (!register || !target) return;
    const token = newBarToken();
    register(token).then(
      (ok) => {
        if (!ok || frame !== iframe || frame.contentWindow !== target) return;
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = onFrameMessage;
        const init: HostInitMessage = { cc: 'init', token };
        target.postMessage(init, options.extensionOrigin, [channel.port2]);
        if (visibility) port.postMessage(visibility);
      },
      () => undefined,
    );
  };

  /** `dialog.close()` (attribute fallback for engines without <dialog> methods, e.g. jsdom). */
  const closeLayer = (): void => {
    if (typeof layer.close === 'function') layer.close();
    else layer.removeAttribute('open');
  };

  /** Show the layer in the right mode for the page's current state. */
  const present = (wantModal: boolean): void => {
    const nextModal = wantModal && canModal;
    if (layer.hasAttribute('open') && nextModal === modal) return;
    if (layer.hasAttribute('open')) closeLayer();
    modal = nextModal;
    if (modal) {
      if (usePopover && host.matches(':popover-open')) host.hidePopover();
      try {
        layer.showModal();
      } catch {
        modal = false;
        layer.setAttribute('open', '');
      }
    } else {
      if (usePopover && !host.matches(':popover-open')) {
        try {
          host.showPopover();
        } catch {
          // Not connected / already open: the fixed position + z-index still apply.
        }
      }
      if (typeof layer.show === 'function') layer.show();
      else layer.setAttribute('open', '');
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Only reached while the page (not the iframe) has focus. Synthetic events are ignored.
    if (!event.isTrusted) return;
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      overlay.hide();
    }
  };

  /** The page moved focus (e.g. it opened a modal dialog): make sure we are not inert under it. */
  const onFocusIn = (): void => {
    if (open && !modal && pageHasModal(doc)) present(true);
  };

  backdrop.addEventListener('click', (event) => {
    if (event.isTrusted) overlay.hide();
  });
  // Esc on our modal dialog (focus on the page side of it) and forced closes.
  layer.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (event.isTrusted) overlay.hide();
  });
  layer.addEventListener('close', () => {
    if (open && !layer.hasAttribute('open') && !switching) overlay.hide();
  });
  let switching = false;
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('focusin', onFocusIn, true);
  win.addEventListener('resize', applyHeight);

  /** Before showing: (re)attach the host to <html> and (re)create the iframe when needed. */
  const ensureAttached = (): void => {
    if (host.isConnected && iframe) return;
    // `<html>`, not `<body>`: pages that swap <body> (Turbo-style navigation) keep the host.
    doc.documentElement.append(host);
    createFrame();
  };

  const overlay: Overlay = {
    show() {
      ensureAttached();
      if (open) {
        overlay.raise();
        iframe?.focus();
        return;
      }
      open = true;
      previousFocus = deepActiveElement(doc);
      host.style.setProperty('display', 'block', 'important');
      present(pageHasModal(doc));
      applyHeight();
      iframe?.focus();
      post({ cc: 'shown' });
    },
    hide() {
      if (!open) return;
      open = false;
      post({ cc: 'hidden' });
      switching = true;
      if (layer.hasAttribute('open')) closeLayer();
      switching = false;
      modal = false;
      if (usePopover && host.matches(':popover-open')) {
        try {
          host.hidePopover();
        } catch {
          // ignore
        }
      }
      host.style.setProperty('display', 'none', 'important');
      const target = previousFocus;
      previousFocus = null;
      if (target?.isConnected && typeof (target as HTMLElement).focus === 'function') {
        (target as HTMLElement).focus({ preventScroll: true });
      }
    },
    toggle() {
      if (open) overlay.hide();
      else overlay.show();
    },
    isOpen: () => open,
    raise() {
      if (!open) return;
      // Our shadow root is closed, so `document.activeElement` only ever shows the host: ask the
      // shadow root (we hold it) whether the iframe has focus.
      const hadFocus = iframe !== null && shadow.activeElement === iframe;
      switching = true;
      try {
        if (layer.hasAttribute('open')) closeLayer();
        if (usePopover && host.matches(':popover-open')) host.hidePopover();
        present(modal || pageHasModal(doc));
      } finally {
        switching = false;
      }
      if (hadFocus || modal) iframe?.focus();
    },
    suspend() {
      if (!open) return Promise.resolve(false);
      host.style.setProperty('visibility', 'hidden', 'important');
      return afterPaint(win).then(() => true);
    },
    resume() {
      host.style.removeProperty('visibility');
    },
    dispose() {
      win.removeEventListener('keydown', onKeyDown, true);
      win.removeEventListener('focusin', onFocusIn, true);
      win.removeEventListener('resize', applyHeight);
      closePort();
      host.remove();
      open = false;
    },
  };
  return overlay;
}
