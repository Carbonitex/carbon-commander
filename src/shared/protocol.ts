/**
 * Wire protocol between the bar UI (extension page / iframe), the service worker and the content
 * script. Three channels:
 *
 * 1. **Port** `chrome.runtime.connect({ name: BAR_PORT_NAME })` from the bar to the worker: the
 *    live session channel (attach, run, stream, confirm, abort). The worker accepts it only from
 *    the extension's own `bar.html`.
 * 2. **RPC** `chrome.runtime.sendMessage({ rpc, params })` from the bar to the worker:
 *    request/response calls for settings, secrets, models, MCP servers, tools and autocomplete.
 *    Only accepted from extension pages (never from content scripts).
 * 3. **Content messages** `chrome.tabs.sendMessage` from the worker to the content script, and
 *    a private `MessageChannel` between the bar iframe and its host content script (its port is
 *    handed over in the origin-pinned `init` message; nothing is posted to the page's window).
 */

import type {
  AutocompleteResult,
  DiscoveredMcpServer,
  Keybind,
  ConfirmRequest,
  ErrorInfo,
  McpServerAuth,
  McpServerInput,
  McpServerStatus,
  McpSignInConfirm,
  McpTestResult,
  ModelInfo,
  ProviderId,
  ProviderStatus,
  RunEndReason,
  SecretName,
  SessionState,
  Settings,
  SettingsPatch,
  ToolInfo,
  ToolItem,
  ToolItemStatus,
  ToolResult,
  Usage,
  UserItem,
  WebMcpStatus,
} from './types';
import { CcError, toErrorInfo } from './types';

/** Distributive helper: `{ type: K } & Payload` for every key of a payload map. */
type Tagged<M> = { [K in keyof M]: { type: K } & M[K] }[keyof M];

// ---------------------------------------------------------------------------------------------
// Port: bar <-> service worker
// ---------------------------------------------------------------------------------------------

export const BAR_PORT_NAME = 'bar';
/** The bar page, relative to the extension root. Optional query `?tabId=<n>` when opened as a tab. */
export const BAR_PAGE = 'bar.html';
/**
 * While a run is active the UI sends `ping` this often, and the worker itself calls a cheap
 * extension API this often, so the worker is not stopped as idle mid-run.
 */
export const KEEPALIVE_INTERVAL_MS = 20_000;

export interface UiToSwPayloads {
  /**
   * Bind this port to a tab's session. When `tabId` is omitted the worker uses the tab the bar
   * iframe lives in (`port.sender.tab`). A standalone bar tab must pass the target `tabId`.
   * The worker answers with `session.state`. A port can re-attach (switch tab) at any time.
   */
  'session.attach': { tabId?: number };
  /** Start a run with a user message. Rejected with `run.error { code: 'busy' }` if one is active. */
  'run.start': { text: string };
  /** Abort the active run (no-op when idle). */
  'run.abort': object;
  /** Answer a `confirm.request`. */
  'confirm.reply': { id: string; allow: boolean; always?: boolean };
  /** Abort any run and wipe the transcript; worker replies with `session.state`. */
  'session.clear': object;
  /** Keepalive while a run is active (every `KEEPALIVE_INTERVAL_MS`). No reply. */
  ping: object;
}

export interface SwToUiPayloads {
  /** Full replay of the session (on attach, clear, and whenever the UI may be out of sync). */
  'session.state': { state: SessionState };
  /** A run started; `item` is the user's message as recorded in the transcript. */
  'run.started': { runId: string; item: UserItem };
  'assistant.delta': { runId: string; itemId: string; text: string };
  /** The model is reasoning before it answers; the UI shows "thinking…" until the next event. */
  'assistant.thinking': { runId: string };
  /** Mirrors the loop's `AgentEvent`s of the same name, tagged with the run. */
  'tool.start': { runId: string; item: ToolItem };
  'tool.update': { runId: string; itemId: string; status: ToolItemStatus };
  'tool.end': { runId: string; itemId: string; status: ToolItemStatus; result: ToolResult };
  'confirm.request': { runId: string; request: ConfirmRequest };
  /** A confirmation was answered (possibly from another attached UI); remove the prompt. */
  'confirm.resolved': { runId: string; id: string; allow: boolean };
  'run.end': { runId: string; reason: RunEndReason; usage: Usage };
  /**
   * A run failed, or a port request was rejected (`runId: null`, e.g. `busy`, `no-tab`). Code
   * `no-tab` also means the session's tab was closed: the session is gone and the port is dropped.
   */
  'run.error': { runId: string | null; error: ErrorInfo };
  /** Settings changed (from any page); UIs refresh what they show. */
  'settings.changed': { settings: Settings };
}

export type UiToSwMessage = Tagged<UiToSwPayloads>;
export type SwToUiMessage = Tagged<SwToUiPayloads>;
export type UiToSwType = keyof UiToSwPayloads;
export type SwToUiType = keyof SwToUiPayloads;

const UI_TO_SW_TYPES: ReadonlySet<string> = new Set<UiToSwType>([
  'session.attach',
  'run.start',
  'run.abort',
  'confirm.reply',
  'session.clear',
  'ping',
]);

/** Structural check for messages arriving on the port (the worker must not trust shapes). */
export function isUiToSwMessage(value: unknown): value is UiToSwMessage {
  return isRecord(value) && typeof value.type === 'string' && UI_TO_SW_TYPES.has(value.type);
}

// ---------------------------------------------------------------------------------------------
// RPC: bar -> service worker
// ---------------------------------------------------------------------------------------------

/** `params` / `result` for every RPC method. `void` params may be omitted when calling. */
export interface RpcMap {
  'settings.get': { params: void; result: Settings };
  /** Validates + merges; returns the stored settings. Broadcasts `settings.changed`. */
  'settings.set': { params: { patch: SettingsPatch }; result: Settings };
  'settings.reset': { params: void; result: Settings };

  /** There is deliberately no `secrets.get`: secrets never leave the worker. */
  'secrets.set': { params: { name: SecretName; value: string }; result: void };
  'secrets.has': { params: { name: SecretName }; result: boolean };
  'secrets.delete': { params: { name: SecretName }; result: void };

  /** `check: true` probes each provider's `/models` (sets `reachable` / `error`). */
  'providers.status': { params: { check?: boolean }; result: ProviderStatus[] };
  /** Provider's model list (cached in the worker; `refresh` bypasses the cache). */
  'models.list': { params: { provider: ProviderId; refresh?: boolean }; result: ModelInfo[] };

  'mcp.list': { params: void; result: McpServerStatus[] };
  /** Adds (and connects, when enabled) a server. `auth` is stored encrypted. */
  'mcp.add': { params: { server: McpServerInput; auth?: McpServerAuth }; result: McpServerStatus };
  /** `auth`: undefined = keep, null = remove, object = replace. Reconnects the server. */
  'mcp.update': {
    params: { id: string; patch: Partial<McpServerInput>; auth?: McpServerAuth | null };
    result: McpServerStatus;
  };
  /** Disconnects, removes the config and its secret. */
  'mcp.remove': { params: { id: string }; result: void };
  /**
   * Test a saved server (`id`) or an unsaved one (`server` + `auth`): initialize + tools/list.
   * `authFrom`: when testing edited-but-unsaved values without new `auth`, use the stored auth of
   * this saved server.
   */
  'mcp.test': {
    params: { id: string } | { server: McpServerInput; auth?: McpServerAuth; authFrom?: string };
    result: McpTestResult;
  };
  /**
   * OAuth sign-in for a saved server: discovery, client registration, the browser sign-in window
   * (`chrome.identity.launchWebAuthFlow`), token exchange. Resolves when it finished; fails with
   * the reason (also shown in the server's `oauth` status). `stepUp`: ask for the extra scopes the
   * server wanted. `confirm`: what the user saw and chose in the server's `oauth.plan` (sign-in
   * host, scopes); the sign-in is refused when the server's metadata now names another sign-in
   * host or the scopes are not offered. Only ever started by the user, never by the agent.
   */
  'mcp.signIn': { params: { id: string; stepUp?: boolean; confirm: McpSignInConfirm }; result: McpServerStatus };
  /** Revoke (when the authorization server supports it) and delete the server's tokens. */
  'mcp.signOut': { params: { id: string }; result: McpServerStatus };
  /** MCP servers found on visited sites (dismissed ones excluded), with `addedServerId` when configured. */
  'mcp.discovered.list': { params: void; result: DiscoveredMcpServer[] };
  /** Discovered servers on a tab's site (default: the sender's tab) that are not added or dismissed. */
  'mcp.discovered.forTab': { params: { tabId?: number }; result: DiscoveredMcpServer[] };
  /**
   * Add a discovered server (`suggestedName`). Never signs in: when `oauth.state` is `required`, the
   * UI shows the server's `oauth.plan` and the user clicks "Sign in".
   */
  'mcp.discovered.add': { params: { key: string }; result: McpServerStatus };
  /** Hide a discovered server (it is not listed again until "Forget"). */
  'mcp.discovered.dismiss': { params: { key: string }; result: void };
  /** Forget every discovered server, dismissal and checked site. */
  'mcp.discovered.clear': { params: void; result: void };

  /** All tools from all sources for a tab (default: the sender's tab), incl. disabled ones. */
  'tools.list': { params: { tabId?: number }; result: ToolInfo[] };
  /** How many tools the tab's page offers through WebMCP right now (the bar's chip). */
  'webmcp.status': { params: { tabId?: number }; result: WebMcpStatus };

  /**
   * Suggestions for the command bar input. A newer request from the same sender aborts the
   * older one (which then fails with `aborted`); the result echoes `text`.
   */
  autocomplete: { params: { text: string; tabId?: number }; result: AutocompleteResult };
}

export type RpcMethod = keyof RpcMap;
export type RpcParams<M extends RpcMethod> = RpcMap[M]['params'];
export type RpcResult<M extends RpcMethod> = RpcMap[M]['result'];

export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  rpc: M;
  params: RpcParams<M>;
}

export type RpcResponse<M extends RpcMethod = RpcMethod> =
  | { ok: true; result: RpcResult<M> }
  | { ok: false; error: ErrorInfo };

type RpcArgs<M extends RpcMethod> = RpcParams<M> extends void ? [params?: undefined] : [params: RpcParams<M>];

export function isRpcRequest(value: unknown): value is RpcRequest {
  return isRecord(value) && typeof value.rpc === 'string';
}

/**
 * Call the worker. Throws `CcError` with the worker's error code on failure.
 * @example const s = await sendRpc('settings.get');
 */
export async function sendRpc<M extends RpcMethod>(method: M, ...args: RpcArgs<M>): Promise<RpcResult<M>> {
  const request: RpcRequest<M> = { rpc: method, params: args[0] };
  const response = await chrome.runtime.sendMessage<RpcRequest<M>, RpcResponse<M> | undefined>(request);
  if (!response) throw new CcError('unknown', `No response for ${method}`);
  if (!response.ok) {
    throw new CcError(response.error.code, response.error.message, { status: response.error.status });
  }
  return response.result;
}

export type RpcHandler<M extends RpcMethod> = (
  params: RpcParams<M>,
  sender: chrome.runtime.MessageSender,
) => Promise<RpcResult<M>> | RpcResult<M>;

export type RpcHandlers = { [M in RpcMethod]: RpcHandler<M> };

/** Default sender check: only the extension's own pages (not content scripts, not other extensions). */
export function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !!sender.url && sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

/**
 * Worker side: register RPC handlers on `chrome.runtime.onMessage`. Methods without a handler
 * answer `not-implemented`; non-RPC messages are ignored (left for other listeners).
 * Returns an unregister function.
 */
export function registerRpcHandlers(
  handlers: Partial<RpcHandlers>,
  options: { isAllowedSender?: (sender: chrome.runtime.MessageSender) => boolean | Promise<boolean> } = {},
): () => void {
  const allowed = options.isAllowedSender ?? isExtensionPageSender;
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RpcResponse) => void,
  ): boolean | undefined => {
    if (!isRpcRequest(message)) return undefined;
    const denied: RpcResponse = { ok: false, error: { code: 'invalid', message: 'Sender not allowed' } };
    void Promise.resolve()
      .then(() => allowed(sender))
      .then(
        (ok) => (ok ? dispatchRpc(handlers, message, sender) : denied),
        () => denied,
      )
      .then(sendResponse);
    return true; // async response
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** Runs one RPC request against a handler table. Exported for unit tests. */
export async function dispatchRpc(
  handlers: Partial<RpcHandlers>,
  request: RpcRequest,
  sender: chrome.runtime.MessageSender,
): Promise<RpcResponse> {
  const handler = handlers[request.rpc] as RpcHandler<RpcMethod> | undefined;
  if (!handler) {
    return { ok: false, error: { code: 'not-implemented', message: `RPC ${request.rpc} is not implemented` } };
  }
  try {
    const result = await handler(request.params, sender);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: toErrorInfo(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// Content script
// ---------------------------------------------------------------------------------------------

/**
 * Worker -> content script (`chrome.tabs.sendMessage`). The content script replies `{ ok: true }`.
 * `overlay.suspend` hides the overlay without destroying the iframe (screenshots) and replies once
 * the hidden state is painted; `overlay.resume` restores it. `keybind` pushes the fallback
 * shortcut (`Settings.keybind`) after it changed: content scripts cannot read extension storage.
 */
export type SwToContentMessage =
  | { cc: 'overlay.toggle' }
  | { cc: 'overlay.open' }
  | { cc: 'overlay.close' }
  | { cc: 'overlay.suspend' }
  | { cc: 'overlay.resume' }
  | { cc: 'keybind'; keybind: Keybind | null };

const SW_TO_CONTENT: ReadonlySet<unknown> = new Set([
  'overlay.toggle',
  'overlay.open',
  'overlay.close',
  'overlay.suspend',
  'overlay.resume',
  'keybind',
]);

export function isSwToContentMessage(value: unknown): value is SwToContentMessage {
  return isRecord(value) && SW_TO_CONTENT.has(value.cc);
}

/**
 * Frame ownership handshake (clickjacking defence). `bar.html` is web-accessible, so a hostile page
 * could try to frame it itself. Embedded bars are therefore served only after proving they sit in
 * the iframe our content script created:
 *
 * 1. On every load of its iframe the content script registers a fresh random token with the
 *    worker (`bar.token`; the worker binds it to `sender.tab`, top frame only).
 * 2. It posts `{ cc: 'init', token }` to that iframe's window, pinned to the extension origin, so
 *    only our document in our iframe can receive it.
 * 3. The bar sends `bar.claim` with the token; the worker checks the tab matches and trusts that
 *    bar document (`sender.documentId`) from then on. Ports and RPCs from any other framed bar
 *    document are refused. Tokens are single-use and short-lived.
 */
export const BAR_TOKEN_TTL_MS = 60_000;

/** Content script -> worker: register a handshake token. */
export type ContentToSwMessage = { cc: 'bar.token'; token: string };
/** Content script -> worker: the fallback keybind. Reply `{ keybind: Keybind | null }`. */
export type KeybindRequestMessage = { cc: 'keybind.get' };

export function isKeybindRequestMessage(value: unknown): value is KeybindRequestMessage {
  return isRecord(value) && value.cc === 'keybind.get';
}
/** Embedded bar -> worker, before it connects or calls any RPC. Reply: `{ ok: boolean }`. */
export type BarClaimMessage = { cc: 'bar.claim'; token: string };

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function isContentToSwMessage(value: unknown): value is ContentToSwMessage {
  return isRecord(value) && value.cc === 'bar.token' && typeof value.token === 'string' && TOKEN_RE.test(value.token);
}

export function isBarClaimMessage(value: unknown): value is BarClaimMessage {
  return isRecord(value) && value.cc === 'bar.claim' && typeof value.token === 'string' && TOKEN_RE.test(value.token);
}

/** Random URL-safe token (128 bits). */
export function newBarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Host content script -> bar iframe, once per bar document:
 * `iframe.contentWindow.postMessage({ cc: 'init', token }, extensionOrigin, [port])`. The target
 * origin is pinned to the extension, so only our bar document can receive it; it carries the token
 * to claim (see above) and one end of a fresh `MessageChannel`. All further host <-> bar traffic
 * uses that channel (`FrameToHostMessage` / `HostToFrameMessage`), never `window.parent`, so the
 * page never sees a message from the bar (or a reference to the bar's window).
 */
export type HostInitMessage = { cc: 'init'; token: string };

/** Bar -> host over the channel. `raise`: a confirmation appeared, move the overlay to the top. */
export type FrameToHostMessage = { cc: 'close' } | { cc: 'resize'; height: number } | { cc: 'raise' };

/**
 * Host -> bar over the channel. Lets the UI focus its input / pause work / re-arm prompts.
 * `raised` answers `raise`: moving the overlay in the top layer briefly un-renders the iframe, which
 * drops the focus inside the bar, so the bar restores it.
 */
export type HostToFrameMessage = { cc: 'shown' } | { cc: 'hidden' } | { cc: 'raised' };

export function isHostInitMessage(value: unknown): value is HostInitMessage {
  return isRecord(value) && value.cc === 'init' && typeof value.token === 'string' && TOKEN_RE.test(value.token);
}

export function isFrameToHostMessage(value: unknown): value is FrameToHostMessage {
  if (!isRecord(value)) return false;
  if (value.cc === 'close' || value.cc === 'raise') return true;
  return value.cc === 'resize' && typeof value.height === 'number' && Number.isFinite(value.height);
}

export function isHostToFrameMessage(value: unknown): value is HostToFrameMessage {
  return isRecord(value) && (value.cc === 'shown' || value.cc === 'hidden' || value.cc === 'raised');
}

// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
