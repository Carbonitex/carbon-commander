/**
 * Which bar documents the worker serves (clickjacking defence; see the handshake in
 * `shared/protocol.ts`).
 *
 * - Not in a tab (side panel, popup): only the extension can open those -> trusted.
 * - Top frame of a tab (`bar.html?tabId=N` opened as a tab): cannot be framed -> trusted.
 * - Framed inside a web page: trusted only after it claimed a token our content script registered
 *   for that same tab. Trust is per document (`sender.documentId`), so a reload needs a new token.
 *
 * State lives in `chrome.storage.session` so a worker restart does not log the bar out.
 */
import { STORAGE_KEYS } from '../shared/defaults';
import { BAR_PAGE, BAR_TOKEN_TTL_MS } from '../shared/protocol';
import type { StorageAreaLike } from './storage-area';

/** The fields of `chrome.runtime.MessageSender` this module reads. */
export interface SenderLike {
  id?: string;
  url?: string;
  frameId?: number;
  documentId?: string;
  tab?: { id?: number; url?: string };
}

interface TrustState {
  /** tabId -> tokens not yet claimed. */
  tokens: Record<string, { token: string; expires: number }[]>;
  /** tabId -> trusted bar document ids. */
  docs: Record<string, string[]>;
}

/** Bounds so a page cannot grow worker state by making the content script reload its iframe. */
const MAX_TOKENS_PER_TAB = 4;
const MAX_DOCS_PER_TAB = 8;

export interface BarTrustDeps {
  extensionId: string;
  /** `chrome-extension://<id>/` */
  extensionBaseUrl: string;
  storage?: StorageAreaLike;
  now?: () => number;
}

export interface BarTrust {
  /** From the content script (`bar.token`). Returns false when the sender is not our content script. */
  registerToken(token: string, sender: SenderLike): Promise<boolean>;
  /** From an embedded bar (`bar.claim`). */
  claim(token: string, sender: SenderLike): Promise<boolean>;
  /** May this sender use the bar port / RPCs? */
  isTrusted(sender: SenderLike): Promise<boolean>;
  onTabRemoved(tabId: number): void;
}

export function createBarTrust(deps: BarTrustDeps): BarTrust {
  const storage = deps.storage ?? chrome.storage.session;
  const now = deps.now ?? Date.now;
  const barUrl = `${deps.extensionBaseUrl}${BAR_PAGE}`;
  let state: Promise<TrustState> | null = null;
  let writing: Promise<void> = Promise.resolve();

  const load = (): Promise<TrustState> => {
    state ??= storage.get(STORAGE_KEYS.barFrames).then(
      (items) => normalize(items[STORAGE_KEYS.barFrames]),
      () => ({ tokens: {}, docs: {} }),
    );
    return state;
  };
  const save = (s: TrustState): Promise<void> => {
    const snapshot = JSON.parse(JSON.stringify(s)) as TrustState;
    writing = writing.then(() => storage.set({ [STORAGE_KEYS.barFrames]: snapshot })).catch(() => undefined);
    return writing;
  };

  const isOurs = (sender: SenderLike): boolean => sender.id === deps.extensionId;
  const isExtensionUrl = (url: string | undefined): boolean => !!url && url.startsWith(deps.extensionBaseUrl);
  const isBarUrl = (url: string | undefined): boolean => !!url && url.split(/[?#]/)[0] === barUrl;

  return {
    async registerToken(token, sender) {
      // Our content script: a tab's top frame running a web page (not one of our pages).
      const tabId = sender.tab?.id;
      if (!isOurs(sender) || tabId === undefined || sender.frameId !== 0 || isExtensionUrl(sender.url)) return false;
      const s = await load();
      const t = now();
      const list = (s.tokens[tabId] ?? []).filter((x) => x.expires > t);
      list.push({ token, expires: t + BAR_TOKEN_TTL_MS });
      s.tokens[tabId] = list.slice(-MAX_TOKENS_PER_TAB);
      await save(s);
      return true;
    },

    async claim(token, sender) {
      const tabId = sender.tab?.id;
      if (!isOurs(sender) || !isBarUrl(sender.url) || tabId === undefined || !sender.documentId) return false;
      if (sender.frameId === 0) return false; // only embedded bars claim
      const s = await load();
      const t = now();
      const list = (s.tokens[tabId] ?? []).filter((x) => x.expires > t);
      const index = list.findIndex((x) => x.token === token);
      if (index < 0) {
        s.tokens[tabId] = list;
        return false;
      }
      list.splice(index, 1); // single use
      s.tokens[tabId] = list;
      const docs = (s.docs[tabId] ?? []).filter((d) => d !== sender.documentId);
      docs.push(sender.documentId);
      s.docs[tabId] = docs.slice(-MAX_DOCS_PER_TAB);
      await save(s);
      return true;
    },

    async isTrusted(sender) {
      if (!isOurs(sender) || !isExtensionUrl(sender.url)) return false;
      const tab = sender.tab;
      if (!tab || tab.id === undefined) return true; // not in a tab: extension-owned surface
      if (sender.frameId === 0) return true; // top-level extension page in a tab
      if (!sender.documentId) return false;
      const s = await load();
      return (s.docs[tab.id] ?? []).includes(sender.documentId);
    },

    onTabRemoved(tabId) {
      void load().then((s) => {
        if (!(tabId in s.tokens) && !(tabId in s.docs)) return;
        delete s.tokens[tabId];
        delete s.docs[tabId];
        return save(s);
      });
    },
  };
}

function normalize(raw: unknown): TrustState {
  const out: TrustState = { tokens: {}, docs: {} };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Partial<TrustState>;
  if (typeof r.tokens === 'object' && r.tokens !== null) {
    for (const [tab, list] of Object.entries(r.tokens)) {
      if (Array.isArray(list)) {
        out.tokens[tab] = list.filter(
          (x): x is { token: string; expires: number } => typeof x?.token === 'string' && typeof x.expires === 'number',
        );
      }
    }
  }
  if (typeof r.docs === 'object' && r.docs !== null) {
    for (const [tab, list] of Object.entries(r.docs)) {
      if (Array.isArray(list)) out.docs[tab] = list.filter((x): x is string => typeof x === 'string');
    }
  }
  return out;
}
