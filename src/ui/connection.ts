/**
 * Port connection to the worker: connect + `session.attach`, automatic reconnect (the service
 * worker can be stopped at any time, which disconnects the port), keepalive pings while a run is
 * active, and an outbox so control messages (abort, confirm replies, clear) sent during a
 * reconnect are delivered in order. A new message (`run.start`) is refused while not attached
 * instead of queued: the UI keeps the text in the input, so it can never be lost or reordered.
 */
import { BAR_PORT_NAME, KEEPALIVE_INTERVAL_MS, type SwToUiMessage, type UiToSwMessage } from '../shared/protocol';
import type { sendRpc } from '../shared/protocol';
import type { UiAction } from './state/reducer';

/** The subset of `chrome.runtime.Port` the connection uses (the mock implements it too). */
export interface PortLike {
  postMessage(message: UiToSwMessage): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export type Rpc = typeof sendRpc;

export interface ConnectionOptions {
  connect(): PortLike;
  dispatch(action: UiAction): void;
  /** Target tab (standalone bar tab). Undefined in the iframe: the worker uses the sender tab. */
  tabId?: number;
  /** False once the extension was reloaded / uninstalled: stop reconnecting. */
  isContextValid?(): boolean;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export interface Connection {
  start(): void;
  /**
   * Send now, or queue until re-attached. Returns false (nothing queued) for `run.start` while
   * not attached; true otherwise.
   */
  send(message: UiToSwMessage): boolean;
  /** Ping every `KEEPALIVE_INTERVAL_MS` while true. */
  setKeepalive(active: boolean): void;
  dispose(): void;
}

const BACKOFF_MS = [100, 250, 500, 1000, 2000, 5000];

function isSwToUiMessage(value: unknown): value is SwToUiMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function createConnection(options: ConnectionOptions): Connection {
  const st = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const ct = options.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const si = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const ci = options.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  const contextValid = (): boolean => options.isContextValid?.() ?? true;

  let port: PortLike | null = null;
  let attached = false;
  let disposed = false;
  let attempt = 0;
  let reconnectTimer: unknown = null;
  let keepaliveTimer: unknown = null;
  const outbox: UiToSwMessage[] = [];

  const open = (): void => {
    if (disposed) return;
    if (!contextValid()) {
      options.dispatch({ type: 'connection', status: 'disconnected' });
      return;
    }
    options.dispatch({ type: 'connection', status: 'connecting' });
    let p: PortLike;
    try {
      p = options.connect();
    } catch {
      scheduleReconnect();
      return;
    }
    port = p;
    attached = false;
    p.onMessage.addListener((message) => {
      if (port !== p || !isSwToUiMessage(message)) return;
      if (!attached) {
        attached = true;
        attempt = 0;
        options.dispatch({ type: 'connection', status: 'connected' });
        flush();
      }
      options.dispatch({ type: 'port', message });
    });
    p.onDisconnect.addListener(() => {
      // Reading lastError silences "Unchecked runtime.lastError".
      void (globalThis.chrome?.runtime?.lastError);
      if (port !== p) return;
      port = null;
      attached = false;
      options.dispatch({ type: 'connection', status: 'disconnected' });
      scheduleReconnect();
    });
    const attach: UiToSwMessage =
      options.tabId === undefined ? { type: 'session.attach' } : { type: 'session.attach', tabId: options.tabId };
    p.postMessage(attach);
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== null || !contextValid()) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 5000;
    attempt++;
    reconnectTimer = st(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };

  const flush = (): void => {
    while (port && attached && outbox.length) {
      const next = outbox.shift() as UiToSwMessage;
      post(next);
    }
  };

  const post = (message: UiToSwMessage): boolean => {
    if (!port) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      // Port died between checks; onDisconnect will reconnect.
      return false;
    }
  };

  return {
    start: open,
    send(message) {
      if (port && attached && outbox.length === 0 && post(message)) return true;
      if (message.type === 'ping') return true; // pointless to queue
      if (message.type === 'run.start') {
        if (!port) scheduleReconnect();
        return false;
      }
      outbox.push(message);
      if (!port) scheduleReconnect();
      return true;
    },
    setKeepalive(active) {
      if (active && keepaliveTimer === null) {
        keepaliveTimer = si(() => {
          if (port && attached) post({ type: 'ping' });
        }, KEEPALIVE_INTERVAL_MS);
      } else if (!active && keepaliveTimer !== null) {
        ci(keepaliveTimer);
        keepaliveTimer = null;
      }
    },
    dispose() {
      disposed = true;
      if (reconnectTimer !== null) ct(reconnectTimer);
      if (keepaliveTimer !== null) ci(keepaliveTimer);
      reconnectTimer = keepaliveTimer = null;
      const p = port;
      port = null;
      p?.disconnect();
    },
  };
}

/** The real chrome port. */
export function chromePort(): PortLike {
  return chrome.runtime.connect({ name: BAR_PORT_NAME });
}

export function chromeContextValid(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}
