/**
 * Everything the UI needs from the outside world, injected so the same UI runs against the real
 * worker or the dev mock (`bar.html?mock=1`).
 */
import { STORAGE_KEYS } from '../shared/defaults';
import { sendRpc } from '../shared/protocol';
import { chromeContextValid, chromePort, type PortLike, type Rpc } from './connection';

export interface UiEnv {
  rpc: Rpc;
  connect(): PortLike;
  isContextValid(): boolean;
  /** Tab the bar targets when opened as a standalone tab (`?tabId=N`). */
  tabId: number | undefined;
  loadHistory(): Promise<string[]>;
  saveHistory(entries: string[]): Promise<void>;
  /** Label shown in the header in mock mode. */
  mock?: boolean;
}

/** `chrome.storage.local` key for the input history (UI-owned). */
export const HISTORY_STORAGE_KEY = STORAGE_KEYS.uiHistory;

export function parseTabId(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('tabId');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function chromeEnv(tabId: number | undefined): UiEnv {
  return {
    rpc: sendRpc,
    connect: chromePort,
    isContextValid: chromeContextValid,
    tabId,
    async loadHistory() {
      const items = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
      const value: unknown = items[HISTORY_STORAGE_KEY];
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    },
    async saveHistory(entries) {
      await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: entries });
    },
  };
}
