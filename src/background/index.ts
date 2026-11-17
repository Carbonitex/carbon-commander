/**
 * Service worker entry: wiring only. Opens the overlay on action click / Ctrl+K, routes the bar's
 * port to the session manager and its RPCs to the stores / managers.
 *
 * MV3 rules: every `chrome.*` listener is registered synchronously at top level (so events that
 * woke the worker are delivered), and nothing here may throw while the worker loads.
 */
import { createBarTrust } from './bar-trust';
import { createSessionManager, type PortLike } from './sessions';
import { createSecretStore } from './secrets';
import { createSettingsStore } from './settings';
import { getProviderStatus, listModels, resolveLlm } from '../llm/providers';
import { createMcpManager, createMcpRpcHandlers } from '../mcp/manager';
import { createMcpOAuth } from '../mcp/auth';
import { createDiscoveryRpcHandlers, createMcpDiscovery } from '../mcp/discovery';
import { createToolRegistry } from '../tools/registry';
import { createWebMcpSource } from '../webmcp/source';
import { createWebMcpScriptSync } from '../webmcp/register';
import {
  BAR_PAGE,
  BAR_PORT_NAME,
  isBarClaimMessage,
  isContentToSwMessage,
  isKeybindRequestMessage,
  registerRpcHandlers,
  type SwToContentMessage,
} from '../shared/protocol';
import { createLogger, setLogLevel } from '../shared/logger';
import { PROVIDER_IDS } from '../shared/defaults';
import { CcError, type ModelInfo, type SecretName, type Settings, type TabContext, type ToolInfo, type ToolSource } from '../shared/types';

const log = createLogger('bg');

// Content scripts (every page's renderer) can read `chrome.storage.local` by default. Restrict it
// to extension pages and this worker. Supported for the `local` area since Chrome 140; on older
// versions the call fails and local storage stays readable by content scripts (it holds settings
// and input history, never secrets: those are in IndexedDB, see secrets.ts). Called on every start:
// cheap, and the setting's lifetime is not documented.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch((err: unknown) => {
  log.info('chrome.storage.local cannot be restricted to trusted contexts in this Chrome version', err);
});

const settings = createSettingsStore();
const secrets = createSecretStore();
const mcp = createMcpManager({ settings, secrets, oauth: createMcpOAuth({ secrets }) });
const mcpDiscovery = createMcpDiscovery({ settings, clientInfo: { name: 'carbon-commander', version: chrome.runtime.getManifest().version } });
const builtin = createToolRegistry();
// Page tools (WebMCP) come last: the first source to expose a name wins, and their names are
// namespaced (`webmcp__…`) anyway, so a page can never shadow a built-in or MCP tool.
const webmcp = createWebMcpSource({ settings });
const syncWebMcpScript = createWebMcpScriptSync();
const sources = (): ToolSource[] => [builtin, mcp, webmcp];
/**
 * `chrome-extension://<id>/`. Built from the id, not `getURL`: for resources marked
 * `use_dynamic_url` (bar.html), `getURL` returns the per-session dynamic URL, while senders and
 * documents always report the static one.
 */
const extensionBaseUrl = `chrome-extension://${chrome.runtime.id}/`;
const staticUrl = (pathAndQuery: string): string => `${extensionBaseUrl}${pathAndQuery}`;
const trust = createBarTrust({ extensionId: chrome.runtime.id, extensionBaseUrl });

const sessions = createSessionManager({
  settings,
  sources,
  llmFor: async (role) => resolveLlm(role, await settings.get(), secrets),
  // From the provider's (cached) model list; unknown when the list cannot be fetched.
  modelInfo: async (role) => {
    const s = await settings.get();
    const selection = s.models[role];
    if (!selection.model) return undefined;
    const models = await listModels(selection.provider, s, secrets, false).catch(() => [] as ModelInfo[]);
    return models.find((m) => m.id === selection.model);
  },
});

// ---------------------------------------------------------------------------------------------
// Logging follows the setting; settings changes reach every attached bar
// ---------------------------------------------------------------------------------------------

const defaultLevel = __DEV__ ? 'warn' : 'silent';
const applySettings = (s: Settings): void => setLogLevel(s.debugLogging ? 'debug' : defaultLevel);
let lastKeybind = '';
settings.get().then(
  (s) => {
    applySettings(s);
    lastKeybind = JSON.stringify(s.keybind);
    // The MAIN-world WebMCP script follows the setting (reconciled on every worker start).
    void syncWebMcpScript(s.webmcp);
  },
  (err: unknown) => log.warn('Could not read settings', err),
);
settings.onChange((s) => {
  applySettings(s);
  void syncWebMcpScript(s.webmcp);
  sessions.broadcastSettings(s);
  const keybind = JSON.stringify(s.keybind);
  if (keybind !== lastKeybind) {
    lastKeybind = keybind;
    void pushKeybind(s);
  }
});

/** Content scripts cannot read settings: push the fallback keybind to every tab when it changes. */
async function pushKeybind(s: Settings): Promise<void> {
  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  const message: SwToContentMessage = { cc: 'keybind', keybind: s.keybind };
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id !== undefined) await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => undefined);
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Overlay toggle (action click; the `_execute_action` command triggers the same event)
// ---------------------------------------------------------------------------------------------

chrome.action.onClicked.addListener((tab) => {
  toggleOverlay(tab).catch((err: unknown) => log.warn('toggle failed', err));
});

async function sendToContent(tabId: number, message: SwToContentMessage): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
}

async function openBarTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  await chrome.tabs.create({ url: staticUrl(`${BAR_PAGE}?tabId=${tab.id}`), index: tab.index + 1, openerTabId: tab.id });
}

/**
 * Toggle the in-page overlay; fall back to the bar as a tab where pages cannot host it. (A strict
 * page CSP does not block the overlay: Chrome lets content scripts frame web-accessible extension
 * pages regardless of the page's `frame-src`, checked by the end-to-end test.)
 */
async function toggleOverlay(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const message: SwToContentMessage = { cc: 'overlay.toggle' };
  try {
    await sendToContent(tab.id, message);
    return;
  } catch {
    // No content script yet (tab opened before install/update, or a restricted page).
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
    await sendToContent(tab.id, message);
  } catch (err) {
    // Restricted page (chrome://, Web Store, PDF viewer...): open the bar as a tab bound to it.
    log.info('Cannot inject into tab, opening bar page instead', err);
    await openBarTab(tab);
  }
}

// Exposed only in the end-to-end test build (`build.mjs --e2e`; the test cannot click the toolbar
// button): same code path. `__E2E__` is false in every other build, so this is dropped.
if (__E2E__) {
  (globalThis as { __ccToggleOverlay?: (tabId: number) => Promise<void> }).__ccToggleOverlay = async (tabId) =>
    toggleOverlay(await chrome.tabs.get(tabId));
}

// ---------------------------------------------------------------------------------------------
// Bar frame handshake + port (only from a trusted bar document)
// ---------------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: unknown) => void) => {
  if (isContentToSwMessage(message)) {
    trust.registerToken(message.token, sender).then(
      (ok) => sendResponse({ ok }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isBarClaimMessage(message)) {
    trust.claim(message.token, sender).then(
      (ok) => sendResponse({ ok }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isKeybindRequestMessage(message)) {
    // Our content script (or any extension context) asking for the fallback keybind.
    if (sender.id !== chrome.runtime.id) return undefined;
    settings.get().then(
      (s) => sendResponse({ keybind: s.keybind }),
      () => sendResponse({ keybind: null }),
    );
    return true;
  }
  return undefined;
});

const barUrl = staticUrl(BAR_PAGE);

chrome.runtime.onConnect.addListener((port) => {
  const url = port.sender?.url?.split(/[?#]/)[0];
  if (port.name !== BAR_PORT_NAME || port.sender?.id !== chrome.runtime.id || url !== barUrl) {
    port.disconnect();
    return;
  }
  // The trust check is async; buffer what arrives meanwhile so nothing is lost.
  const buffered: unknown[] = [];
  let forward: ((message: unknown) => void) | null = null;
  let disconnected = false;
  const onDisconnect: (() => void)[] = [];
  port.onMessage.addListener((message) => {
    if (forward) forward(message);
    else buffered.push(message);
  });
  port.onDisconnect.addListener(() => {
    disconnected = true;
    for (const cb of onDisconnect) cb();
  });
  const sender = port.sender;
  trust.isTrusted(sender).then(
    (ok) => {
      if (disconnected) return;
      if (!ok) {
        log.warn('Refusing bar port from an unverified frame');
        port.disconnect();
        return;
      }
      const wrapped: PortLike = {
        name: port.name,
        sender,
        postMessage: (m) => port.postMessage(m),
        onMessage: {
          addListener(cb) {
            forward = cb;
            for (const m of buffered.splice(0)) cb(m);
          },
        },
        onDisconnect: { addListener: (cb) => void onDisconnect.push(cb) },
      };
      sessions.handlePort(wrapped);
    },
    () => port.disconnect(),
  );
});

// MCP discovery: a top-frame page finished loading (the discovery module applies the setting,
// the incognito rule, its per-site cache and its limits).
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.status === 'complete' && tab.url) mcpDiscovery.onNavigation(tab.url, { incognito: tab.incognito });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.onTabRemoved(tabId);
  trust.onTabRemoved(tabId);
  webmcp.onTabRemoved(tabId);
});

// ---------------------------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------------------------

function assertSecretName(name: unknown): asserts name is SecretName {
  const ok =
    name === 'openrouter-key' ||
    name === 'ollama-key' ||
    name === 'custom-key' ||
    (typeof name === 'string' && /^mcp-auth-[\w-]{1,64}$/.test(name));
  if (!ok) throw new CcError('invalid', 'Unknown secret name');
}

function optionalTabId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new CcError('invalid', 'Invalid tabId');
  return value;
}

async function tabContext(tabId: number | undefined, sender: chrome.runtime.MessageSender): Promise<TabContext> {
  const id = tabId ?? sender.tab?.id;
  if (id === undefined) throw new CcError('no-tab', 'No target tab');
  const tab = await chrome.tabs.get(id).catch(() => undefined);
  if (!tab || tab.id === undefined) throw new CcError('no-tab', `Tab ${id} not found`);
  return { tabId: tab.id, windowId: tab.windowId, url: tab.url ?? '', title: tab.title ?? '' };
}

const params = (p: unknown): Record<string, unknown> => (typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {});

registerRpcHandlers(
  {
    'settings.get': () => settings.get(),
    'settings.set': (p) => {
      const { patch } = params(p);
      if (typeof patch !== 'object' || patch === null) throw new CcError('invalid', 'Missing patch');
      return settings.set(patch);
    },
    'settings.reset': () => settings.reset(),

    'secrets.set': async (p) => {
      const { name, value } = params(p);
      assertSecretName(name);
      if (typeof value !== 'string' || value === '') throw new CcError('invalid', 'Secret value must be a non-empty string');
      await secrets.set(name, value);
    },
    'secrets.has': (p) => {
      const { name } = params(p);
      assertSecretName(name);
      return secrets.has(name);
    },
    'secrets.delete': async (p) => {
      const { name } = params(p);
      assertSecretName(name);
      await secrets.delete(name);
    },

    'providers.status': async (p) => getProviderStatus(await settings.get(), secrets, params(p).check === true),
    'models.list': async (p) => {
      const { provider, refresh } = params(p);
      if (!PROVIDER_IDS.includes(provider as never)) throw new CcError('invalid', 'Unknown provider');
      return listModels(provider as (typeof PROVIDER_IDS)[number], await settings.get(), secrets, refresh === true);
    },

    ...createMcpRpcHandlers(mcp),
    ...createDiscoveryRpcHandlers({
      discovery: mcpDiscovery,
      manager: mcp,
      settings,
      tabUrl: async (tabId, sender) => (await tabContext(tabId, sender)).url,
    }),

    'tools.list': async (p, sender) => {
      const tab = await tabContext(optionalTabId(params(p).tabId), sender);
      const disabled = new Set((await settings.get()).disabledTools);
      const out: ToolInfo[] = [];
      const lists = await Promise.all(
        sources().map(async (source) => ({ source, specs: await source.listTools(tab).catch(() => []) })),
      );
      for (const { source, specs } of lists) {
        for (const spec of specs) {
          out.push({
            name: spec.name,
            description: spec.description,
            sourceId: source.id,
            sourceLabel: spec.sourceLabel ?? source.label,
            mutates: spec.mutates === true,
            egress: spec.egress === true,
            enabled: !disabled.has(spec.name),
          });
        }
      }
      return out;
    },
    'webmcp.status': async (p, sender) => webmcp.status(await tabContext(optionalTabId(params(p).tabId), sender)),

    autocomplete: (p, sender) => {
      const { text, tabId } = params(p);
      if (typeof text !== 'string') throw new CcError('invalid', 'Missing text');
      const target = optionalTabId(tabId) ?? sender.tab?.id;
      const senderKey = sender.documentId ?? `${sender.tab?.id ?? 'x'}:${sender.frameId ?? 'x'}:${sender.url ?? ''}`;
      return sessions.autocomplete(target === undefined ? { text } : { text, tabId: target }, senderKey);
    },
  },
  { isAllowedSender: (sender) => trust.isTrusted(sender) },
);
