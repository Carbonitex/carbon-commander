import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEPALIVE_INTERVAL_MS, type UiToSwMessage } from '../../src/shared/protocol';
import { createConnection, type PortLike } from '../../src/ui/connection';
import type { UiAction } from '../../src/ui/state/reducer';

class FakePort implements PortLike {
  sent: UiToSwMessage[] = [];
  private messageCbs: ((m: unknown) => void)[] = [];
  private disconnectCbs: (() => void)[] = [];
  disconnected = false;
  postMessage(m: UiToSwMessage): void {
    if (this.disconnected) throw new Error('Attempting to use a disconnected port object');
    this.sent.push(m);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  onMessage = { addListener: (cb: (m: unknown) => void) => void this.messageCbs.push(cb) };
  onDisconnect = { addListener: (cb: () => void) => void this.disconnectCbs.push(cb) };
  receive(m: unknown): void {
    this.messageCbs.forEach((cb) => cb(m));
  }
  /** The worker went away. */
  drop(): void {
    this.disconnected = true;
    this.disconnectCbs.forEach((cb) => cb());
  }
}

const state = { type: 'session.state', state: { tabId: 1 } };

function setup(options: { tabId?: number; valid?: () => boolean } = {}) {
  const ports: FakePort[] = [];
  const actions: UiAction[] = [];
  const conn = createConnection({
    connect: () => {
      const p = new FakePort();
      ports.push(p);
      return p;
    },
    dispatch: (a) => actions.push(a),
    tabId: options.tabId,
    isContextValid: options.valid,
  });
  const statuses = () => actions.filter((a) => a.type === 'connection').map((a) => (a as { status: string }).status);
  return { conn, ports, actions, statuses };
}

describe('createConnection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('attaches on connect (with the tab id when given) and becomes connected on the first message', () => {
    const { conn, ports, statuses, actions } = setup({ tabId: 42 });
    conn.start();
    expect(ports[0]?.sent).toEqual([{ type: 'session.attach', tabId: 42 }]);
    expect(statuses()).toEqual(['connecting']);
    ports[0]?.receive(state);
    expect(statuses()).toEqual(['connecting', 'connected']);
    expect(actions.at(-1)).toEqual({ type: 'port', message: state });
  });

  it('attaches without a tab id inside the iframe', () => {
    const { conn, ports } = setup();
    conn.start();
    expect(ports[0]?.sent).toEqual([{ type: 'session.attach' }]);
  });

  it('reconnects and re-attaches after the worker restarts', () => {
    const { conn, ports, statuses } = setup({ tabId: 3 });
    conn.start();
    ports[0]?.receive(state);
    ports[0]?.drop();
    expect(statuses().at(-1)).toBe('disconnected');
    vi.advanceTimersByTime(100);
    expect(ports).toHaveLength(2);
    expect(ports[1]?.sent).toEqual([{ type: 'session.attach', tabId: 3 }]);
    // Messages from the dead port are ignored.
    ports[0]?.receive({ type: 'assistant.delta' });
    ports[1]?.receive(state);
    expect(statuses().at(-1)).toBe('connected');
  });

  it('backs off between failed reconnects', () => {
    const { conn, ports } = setup();
    conn.start();
    ports[0]?.drop();
    vi.advanceTimersByTime(100);
    ports[1]?.drop();
    vi.advanceTimersByTime(100);
    expect(ports).toHaveLength(2); // second delay is longer
    vi.advanceTimersByTime(150);
    expect(ports).toHaveLength(3);
  });

  it('refuses new messages while disconnected (text stays with the UI), queues control messages in order', () => {
    const { conn, ports } = setup();
    conn.start();
    ports[0]?.receive(state);
    ports[0]?.drop();
    expect(conn.send({ type: 'run.start', text: 'hi' })).toBe(false);
    expect(conn.send({ type: 'confirm.reply', id: 'a', allow: true })).toBe(true);
    expect(conn.send({ type: 'confirm.reply', id: 'b', allow: false })).toBe(true);
    expect(conn.send({ type: 'run.abort' })).toBe(true);
    conn.send({ type: 'ping' }); // not queued
    vi.advanceTimersByTime(100);
    expect(ports[1]?.sent).toEqual([{ type: 'session.attach' }]);
    // Still not attached: refused again.
    expect(conn.send({ type: 'run.start', text: 'hi' })).toBe(false);
    ports[1]?.receive(state);
    expect(ports[1]?.sent).toEqual([
      { type: 'session.attach' },
      { type: 'confirm.reply', id: 'a', allow: true },
      { type: 'confirm.reply', id: 'b', allow: false },
      { type: 'run.abort' },
    ]);
    expect(conn.send({ type: 'run.start', text: 'hi' })).toBe(true);
    expect(ports[1]?.sent.at(-1)).toEqual({ type: 'run.start', text: 'hi' });
  });

  it('pings while a run is active, and stops after', () => {
    const { conn, ports } = setup();
    conn.start();
    ports[0]?.receive(state);
    conn.setKeepalive(true);
    conn.setKeepalive(true); // idempotent
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 2);
    expect(ports[0]?.sent.filter((m) => m.type === 'ping')).toHaveLength(2);
    conn.setKeepalive(false);
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 3);
    expect(ports[0]?.sent.filter((m) => m.type === 'ping')).toHaveLength(2);
  });

  it('stops reconnecting when the extension context is gone', () => {
    let valid = true;
    const { conn, ports, statuses } = setup({ valid: () => valid });
    conn.start();
    valid = false;
    ports[0]?.drop();
    vi.advanceTimersByTime(10_000);
    expect(ports).toHaveLength(1);
    expect(statuses().at(-1)).toBe('disconnected');
  });

  it('dispose disconnects and cancels timers', () => {
    const { conn, ports } = setup();
    conn.start();
    conn.setKeepalive(true);
    conn.dispose();
    expect(ports[0]?.disconnected).toBe(true);
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 2);
    expect(ports).toHaveLength(1);
  });
});
