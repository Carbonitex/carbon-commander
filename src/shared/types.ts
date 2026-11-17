/**
 * Shared contracts for Carbon Commander v0.4.
 *
 * Everything here is either a plain type or a tiny runtime helper with no `chrome.*` access, so it
 * can be imported from the service worker, the bar UI, the content script and unit tests alike.
 * Wire messages (port + RPC) live in `protocol.ts`; default values in `defaults.ts`.
 */

// ---------------------------------------------------------------------------------------------
// JSON / JSON Schema
// ---------------------------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A (loose) JSON Schema node. Only the keywords we read are typed; anything else passes through. */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' | (string & {}) | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonValue[];
  default?: JsonValue;
  additionalProperties?: boolean | JsonSchema;
  [keyword: string]: unknown;
}

/** The schema of a tool's arguments. Always an object at the top level (OpenAI + MCP requirement). */
export interface JsonSchemaObject extends JsonSchema {
  type: 'object';
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

/** Arguments the model passed to a tool, after `JSON.parse` of the call's `arguments` string. */
export type ToolArgs = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Errors (wire-safe)
// ---------------------------------------------------------------------------------------------

export type ErrorCode =
  | 'aborted' // the user (or a newer request) cancelled
  | 'no-key' // provider needs an API key and none is stored
  | 'no-model' // no model selected for the role
  | 'http' // non-2xx from an LLM / MCP endpoint (see `status`)
  | 'network' // fetch failed / endpoint unreachable
  | 'invalid' // bad input (validation failed, unknown id, malformed response)
  | 'busy' // e.g. `run.start` while a run is already active for the tab
  | 'no-tab' // the target tab is gone or cannot be scripted (chrome://, web store, ...)
  | 'max-steps' // agent loop hit `maxSteps`
  | 'not-implemented'
  | 'unknown';

/** Serialisable error shape used on every wire (port messages, RPC responses, session state). */
export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  /** HTTP status when `code === 'http'`. */
  status?: number;
}

/** Error class to throw inside the extension; `toErrorInfo` turns any thrown value into `ErrorInfo`. */
export class CcError extends Error {
  readonly code: ErrorCode;
  readonly status: number | undefined;
  constructor(code: ErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CcError';
    this.code = code;
    this.status = options?.status;
  }
}

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof CcError) {
    return err.status === undefined
      ? { code: err.code, message: err.message }
      : { code: err.code, message: err.message, status: err.status };
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return { code: 'aborted', message: err.message || 'Aborted' };
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

/** The browser tab a session / tool call is bound to. Snapshot; refreshed before each run. */
export interface TabContext {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
}

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

/** What the model sees for one tool (plus a couple of fields the loop needs). */
export interface ToolSpec {
  /** Unique across all sources, `^[a-zA-Z0-9_-]{1,64}$`. MCP tools are `mcp__<server>__<tool>`. */
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  /**
   * The tool changes something (page, browser, remote system). Mutating tools need user
   * confirmation unless `Settings.confirmMutations` is false. Not sent to the model.
   * MCP tools always mutate unless the user trusts that server's `readOnlyHint` annotations
   * (`McpServerConfig.trustReadOnlyHints`).
   */
  mutates?: boolean;
  /**
   * The tool sends a request to a host chosen by the model (e.g. `fetch_url`), so it could carry
   * conversation data off the machine. Confirmed exactly like `mutates` (same setting); the prompt
   * names the destination host, taken from the call's `url` argument. Not sent to the model.
   */
  egress?: boolean;
  /**
   * Confirm (like `mutates`) only when one of these arguments is truthy, e.g. `list_tabs` with
   * `all_windows`. Ignored when `mutates` / `egress` already require confirmation.
   */
  confirmWhenArgs?: string[];
  /**
   * Label shown to the user for this tool's origin (e.g. `MCP: github`), when it differs per tool
   * within a source. Falls back to `ToolSource.label`. Not sent to the model.
   */
  sourceLabel?: string;
  /**
   * Declared by the web page itself (WebMCP, `src/webmcp`), so untrusted: every call is
   * confirmed (reason `page`) when `Settings.confirmMutations` is on, whatever the page's
   * `readOnlyHint` says. Not sent to the model.
   */
  pageTool?: boolean;
  /**
   * Opaque, set by the source: what this listing is bound to (WebMCP: the page document the tool
   * was listed from). Handed back as `ToolCallContext.binding` when the model calls the tool, so
   * the call reaches exactly what was listed. Not sent to the model.
   */
  binding?: string;
}

export interface ToolImage {
  mime: string;
  /** Base64 without the `data:` prefix. */
  base64: string;
}

export interface ToolResult {
  ok: boolean;
  /** Text given to the model (and shown to the user as plain text, never HTML). */
  content: string;
  /** Optional structured payload for the UI / tests; not sent to the model. */
  data?: unknown;
  /** Images (e.g. screenshots). The loop forwards them to the model in a follow-up user message. */
  images?: ToolImage[];
}

/** Context for a tool call made by the agent loop. */
export interface ToolCallContext {
  tab: TabContext;
  /** Aborted when the run is aborted; tools should stop promptly. */
  signal: AbortSignal;
  /** The model's `tool_call.id`. */
  toolCallId: string;
  /** `ToolSpec.binding` of the listing the model saw, when the source set one. */
  binding?: string;
}

/**
 * Where a tool's `run` executes:
 * - `background`: in the service worker, gets the full `ToolCallContext`.
 * - `page`: injected with `chrome.scripting.executeScript` in the ISOLATED world.
 * - `page-main`: injected in the page's MAIN world (only when page JS objects are needed).
 */
export type ToolExecContext = 'background' | 'page' | 'page-main';

interface ToolDefinitionBase extends ToolSpec {
  /** Limit the tool to some pages. Omitted = available everywhere. */
  matches?(url: URL): boolean;
}

export interface BackgroundToolDefinition<A extends ToolArgs = ToolArgs> extends ToolDefinitionBase {
  context: 'background';
  run(args: A, ctx: ToolCallContext): Promise<ToolResult>;
}

export interface PageToolDefinition<A extends ToolArgs = ToolArgs> extends ToolDefinitionBase {
  context: 'page' | 'page-main';
  /**
   * Serialised with `Function.prototype.toString` and injected into the page, so it must be
   * self-contained: no closures over module scope, no imports, JSON-serialisable args and result.
   */
  run(args: A): ToolResult | Promise<ToolResult>;
}

/** One tool definition format for every built-in tool (generic, site and builtin toolsets). */
export type ToolDefinition<A extends ToolArgs = ToolArgs> = BackgroundToolDefinition<A> | PageToolDefinition<A>;

/**
 * A provider of tools. Implemented by the built-in registry (`src/tools`) and by the MCP
 * manager (`src/mcp`). The agent loop only ever sees `ToolSource[]`.
 */
export interface ToolSource {
  /** Stable id, e.g. `builtin` or `mcp`. */
  readonly id: string;
  /** Human label for UI ("Built-in", "MCP: github"). */
  readonly label: string;
  /**
   * Tools available for this tab right now (filtered by `matches` / connection state). Includes
   * tools the user disabled: the session removes `Settings.disabledTools` before running the loop,
   * and `tools.list` shows them greyed out.
   */
  listTools(tab: TabContext): Promise<ToolSpec[]>;
  /**
   * Execute a tool by its exposed name. Must not throw for tool-level failures: return
   * `{ ok: false, content: <error text for the model> }`. May throw on abort.
   */
  callTool(name: string, args: ToolArgs, ctx: ToolCallContext): Promise<ToolResult>;
  /**
   * The list can change without a navigation (WebMCP page tools: a page registers and
   * unregisters tools at any time), so the agent loop lists this source again before every step,
   * not only when the tab's URL changed.
   */
  readonly dynamic?: boolean;
}

/** Row in the tools list shown in settings (`tools.list` RPC). */
export interface ToolInfo {
  name: string;
  description: string;
  sourceId: string;
  sourceLabel: string;
  mutates: boolean;
  /** Sends requests to model-chosen hosts (see `ToolSpec.egress`); asks first like `mutates`. */
  egress: boolean;
  /** False when the user disabled it (`Settings.disabledTools`). */
  enabled: boolean;
}

/** Page tools (WebMCP) of a tab, for the bar's chip (`webmcp.status` RPC). */
export interface WebMcpStatus {
  /** `Settings.webmcp`. */
  enabled: boolean;
  /** Usable tools the page offers now (after validation and caps; includes user-disabled ones). */
  count: number;
  /** Host of the page that offers them (from the page's own origin), when there are any. */
  host?: string;
}

// ---------------------------------------------------------------------------------------------
// Chat messages (OpenAI chat-completions compatible)
// ---------------------------------------------------------------------------------------------

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image_url';
  /** `url` may be a `data:<mime>;base64,...` URL. */
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = TextPart | ImagePart;

export interface ToolCall {
  id: string;
  type: 'function';
  /** `arguments` is the raw JSON string exactly as the model produced it. */
  function: { name: string; arguments: string };
}

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string | ContentPart[];
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
  /**
   * OpenRouter reasoning blocks of this turn, sent back unchanged on turns with tool calls (as
   * OpenRouter recommends) so reasoning models can continue. The LLM client strips it for every
   * other provider.
   */
  reasoning_details?: unknown[];
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  /** Text only; images from a ToolResult go in a following `UserMessage`. */
  content: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// ---------------------------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------------------------

export type ProviderId = 'openrouter' | 'ollama' | 'custom';

/** A resolved provider: static definition from `defaults.ts` + the user's overrides. */
export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible base URL, no trailing slash (e.g. `https://openrouter.ai/api/v1`). */
  baseUrl: string;
  /** Requires an API key (sent as `Authorization: Bearer`). */
  needsKey: boolean;
  /** Secret name holding the key. */
  keyName: SecretName;
}

/**
 * What a model is used for:
 * - `chat`: the agent loop (needs tool calling).
 * - `vision`: describes images (screenshots, MCP images) as text when the chat model is known
 *   not to accept images (`ModelInfo.supportsImages === false`).
 * - `autocomplete`: command-bar suggestions while typing (latency matters most).
 */
export type ModelRole = 'chat' | 'vision' | 'autocomplete';

export interface ModelSelection {
  provider: ProviderId;
  /** Model id as the provider's `/models` returns it. Empty string = not chosen yet. */
  model: string;
}

/** One entry of a provider's `/models` list, normalised. */
export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  /** Undefined = unknown (e.g. Ollama does not report it). */
  supportsTools?: boolean;
  supportsImages?: boolean;
  /** USD per million tokens, when the provider reports pricing. */
  pricing?: { prompt: number; completion: number };
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD, when the provider reports it (OpenRouter does). */
  cost?: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' | 'unknown';

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Converted to OpenAI `tools: [{ type: 'function', function }]` by the client. */
  tools?: ToolSpec[];
  signal?: AbortSignal;
  /** Omitted from the request when undefined (some models reject it). */
  temperature?: number;
  maxTokens?: number;
}

/**
 * Streaming events. Text arrives as `text-delta`s. Tool calls are emitted once each, complete
 * (arguments fully accumulated), before `done`. `done` is always the last event of a successful
 * stream. Failures are thrown from the iterator (as `CcError`), not emitted.
 */
export type LlmEvent =
  | { type: 'text-delta'; text: string }
  /** The model is reasoning (OpenRouter `delta.reasoning` / `reasoning_details`); text not exposed. */
  | { type: 'reasoning' }
  | { type: 'tool-call'; call: ToolCall }
  | {
      type: 'done';
      finishReason: FinishReason;
      usage?: Usage;
      /** Accumulated OpenRouter `reasoning_details` of this turn, when the provider sent any. */
      reasoningDetails?: unknown[];
    };

export interface LlmClient {
  readonly provider: ProviderConfig;
  streamChat(request: ChatRequest): AsyncIterable<LlmEvent>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

/** Status of a provider for the settings UI (`providers.status` RPC). */
export interface ProviderStatus {
  id: ProviderId;
  label: string;
  baseUrl: string;
  needsKey: boolean;
  hasKey: boolean;
  /** Only set when the caller asked for a probe (`check: true`). */
  reachable?: boolean;
  error?: ErrorInfo;
}

// ---------------------------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------------------------

/**
 * Why a tool call needs confirmation (decides the prompt's wording). `page`: a tool the web page
 * itself offers (WebMCP, `ToolSpec.pageTool`).
 */
export type ConfirmReason = 'mutates' | 'egress' | 'args' | 'page';

export interface ConfirmRequest {
  /** Unique id for this confirmation; echoed in `confirm.reply`. */
  id: string;
  toolCallId: string;
  toolName: string;
  args: ToolArgs;
  sourceLabel: string;
  /** Default `mutates`. */
  reason?: ConfirmReason;
  /** `egress`: the host the request goes to (from the `url` argument), when it parses. */
  egressHost?: string;
  /** `args`: the argument names that triggered the confirmation (`ToolSpec.confirmWhenArgs`). */
  triggerArgs?: string[];
  /**
   * Origin of the session's tab when the prompt was raised (set by the session). "Always allow"
   * applies to this tool on this origin only.
   */
  origin?: string;
}

export interface ConfirmDecision {
  allow: boolean;
  /** Do not ask again for this tool on this tab origin for the rest of this conversation. */
  always?: boolean;
}

/** An "always allow" grant: tool name + the origin of the tab when the user granted it. */
export interface AlwaysAllowGrant {
  tool: string;
  origin: string;
}

/** Events the pure loop emits; the session forwards them to attached UIs and persists state. */
export type AgentEvent =
  /** Streaming text for the assistant item `itemId` (the item is created on its first delta). */
  | { type: 'assistant.delta'; itemId: string; text: string }
  /** The model is reasoning before it answers (sent at most once per step). */
  | { type: 'thinking' }
  /** Emitted with status `pending-confirm` when confirmation is needed, otherwise `running`. */
  | { type: 'tool.start'; item: ToolItem }
  /** Non-final status change, e.g. `pending-confirm` -> `running` after the user allowed it. */
  | { type: 'tool.update'; itemId: string; status: ToolItemStatus }
  /** Final status (`ok` | `error` | `denied` | `aborted`) with the result given to the model. */
  | { type: 'tool.end'; itemId: string; status: ToolItemStatus; result: ToolResult }
  /** A complete transcript message (assistant turn, tool result, image follow-up) to append and persist. */
  | { type: 'message'; message: ChatMessage }
  | { type: 'usage'; usage: Usage };

export interface RunAgentOptions {
  llm: LlmClient;
  model: string;
  sources: ToolSource[];
  /** Full history to send, including the system prompt. Not mutated. */
  messages: ChatMessage[];
  tab: TabContext;
  signal: AbortSignal;
  maxSteps: number;
  temperature?: number;
  /** Whether `mutates` / `egress` / `confirmWhenArgs` tools must be confirmed. */
  confirmMutations: boolean;
  /**
   * Images returned by tools normally go to the model as image parts. When given, this is asked
   * first: a string replaces the images with that text (e.g. a description from the vision model,
   * or a note that they cannot be shown); `null` sends the images as they are.
   */
  describeImages?: (images: ToolImage[], context: { toolName: string; signal: AbortSignal }) => Promise<string | null>;
  /**
   * Fresh tab snapshot, called before every step (after the first) so URL-matched tools and the
   * system prompt follow navigations. A rejection keeps the previous snapshot.
   */
  getTab?: () => Promise<TabContext>;
  /**
   * Rebuilds the system prompt for a tab. When given and `messages[0]` is a system message, it is
   * replaced whenever the tab's URL or title changes during the run.
   */
  systemPrompt?: (tab: TabContext) => string;
  /** Ask the user; resolves with their decision (rejects / resolves deny on abort). */
  confirm(request: ConfirmRequest): Promise<ConfirmDecision>;
  emit(event: AgentEvent): void;
  /** Id generator (injectable for deterministic tests). Default `crypto.randomUUID`. */
  newId?: () => string;
}

export type RunEndReason = 'complete' | 'aborted' | 'max-steps';

export interface RunAgentResult {
  reason: RunEndReason;
  /** Messages appended during the run (same ones emitted as `message` events). */
  messages: ChatMessage[];
  usage: Usage;
}

// ---------------------------------------------------------------------------------------------
// Sessions / transcript (what the UI renders)
// ---------------------------------------------------------------------------------------------

export type ToolItemStatus = 'pending-confirm' | 'running' | 'ok' | 'error' | 'denied' | 'aborted';

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  at: number;
}

export interface AssistantItem {
  kind: 'assistant';
  id: string;
  /** Markdown; sanitised (marked -> DOMPurify) before rendering. */
  text: string;
  at: number;
}

export interface ToolItem {
  kind: 'tool';
  /** Equals the model's `tool_call.id`. */
  id: string;
  name: string;
  args: ToolArgs;
  sourceLabel: string;
  status: ToolItemStatus;
  /** Rendered as text, never HTML. Images may be dropped from persisted state to save space. */
  result?: ToolResult;
  at: number;
}

export interface ErrorItem {
  kind: 'error';
  id: string;
  error: ErrorInfo;
  at: number;
}

/** UI transcript entry. Decoupled from `ChatMessage` so the UI never parses OpenAI shapes. */
export type TranscriptItem = UserItem | AssistantItem | ToolItem | ErrorItem;

export type SessionStatus = 'idle' | 'running' | 'awaiting-confirm';

/**
 * Per-tab session, persisted to `chrome.storage.session` after every step and sent in full as
 * `session.state` on attach.
 */
export interface SessionState {
  tabId: number;
  status: SessionStatus;
  /** Active run id, when `status !== 'idle'`. */
  runId: string | null;
  items: TranscriptItem[];
  /** The model transcript (without the system prompt, which is rebuilt per run). */
  messages: ChatMessage[];
  pendingConfirm: ConfirmRequest | null;
  /** Tools the user allowed with `always`, each for the tab origin it was granted on. */
  alwaysAllow: AlwaysAllowGrant[];
  /** Cumulative for the session. */
  usage: Usage;
  updatedAt: number;
}

// ---------------------------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------------------------

/** Non-secret MCP server config, stored in `Settings.mcpServers`. */
export interface McpServerConfig {
  /** Generated, stable. Secret holding the auth is `mcp-auth-<id>`. */
  id: string;
  /**
   * Short name, `^[a-zA-Z0-9_-]{1,32}$`, unique. Used in tool names `mcp__<name>__<tool>`
   * (the full name is truncated/sanitised to 64 chars by the MCP manager).
   */
  name: string;
  /** Streamable HTTP endpoint (`http:` or `https:`). */
  url: string;
  enabled: boolean;
  /**
   * Skip confirmation for tools this server marks `readOnlyHint: true`. Off by default: the hint
   * is the server's claim, not something the extension can verify.
   */
  trustReadOnlyHints?: boolean;
  /**
   * OAuth client id registered by the user with this server's authorization server, for servers
   * that do not allow dynamic client registration. Not a secret (public client, PKCE).
   */
  oauthClientId?: string;
}

/** Fields the UI provides when adding / editing a server. */
export type McpServerInput = Omit<McpServerConfig, 'id'>;

/** Secret part of an MCP server config, stored encrypted as JSON under `mcp-auth-<id>`. */
export interface McpServerAuth {
  /** Sent as `Authorization: Bearer <token>`. */
  bearerToken?: string;
  /** Extra request headers (e.g. `X-API-Key`). */
  headers?: Record<string, string>;
}

export type McpConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpServerStatus extends McpServerConfig {
  hasAuth: boolean;
  state: McpConnectionState;
  error?: ErrorInfo;
  toolCount?: number;
  serverInfo?: McpServerInfo;
  protocolVersion?: string;
  /** OAuth sign-in state; set for servers without a stored token / headers that use or need OAuth. */
  oauth?: McpOAuthStatus;
}

/**
 * OAuth sign-in state of an MCP server, for the settings UI. Never carries token material.
 * - `required`: the server asked for sign-in (401) and there is no usable token;
 * - `signed-in`: tokens are stored (`expiresAt` of the access token, when the server said);
 * - `in-progress`: a sign-in window is open;
 * - `failed`: the last sign-in failed (`error`);
 * - `interrupted`: a sign-in was running when the extension restarted;
 * - `insufficient-scope`: signed in, but the server wants more scopes (`requiredScope`).
 */
export type McpOAuthState = 'required' | 'signed-in' | 'in-progress' | 'failed' | 'interrupted' | 'insufficient-scope';

export interface McpOAuthStatus {
  state: McpOAuthState;
  /** Issuer of the authorization server (identified even before sign-in, when discovery worked). */
  issuer?: string;
  /** Access token expiry (ms since epoch), when known. */
  expiresAt?: number;
  /** Granted scope. */
  scope?: string;
  /** Scope the server asked for in an `insufficient_scope` challenge. */
  requiredScope?: string;
  /** A refresh token is stored (expiry is handled without the user). */
  canRefresh?: boolean;
  /** Where the client id came from. */
  clientSource?: 'manual' | 'dynamic';
  /** Human-readable reason for `failed` / `interrupted` / a problem finding the authorization server. */
  error?: string;
  /**
   * What "Sign in" would do (states other than `signed-in` / `in-progress`, once the authorization
   * server was found): shown to the user before the sign-in window opens, and echoed back in
   * `mcp.signIn`'s `confirm`.
   */
  plan?: McpSignInPlan;
}

/**
 * What a sign-in would open and ask for, from the server's (untrusted) metadata. Nothing here is
 * secret. The worker re-reads the metadata when the user clicks "Sign in" and refuses to go on
 * when the sign-in host changed since it was shown.
 */
export interface McpSignInPlan {
  /** Host (with port, when not the default) of the page the sign-in window opens (`authorization_endpoint`). */
  authorizationHost: string;
  /** The authorization server's issuer identifier. */
  issuer: string;
  /** Host of the MCP server, for comparison. */
  serverHost: string;
  /**
   * The sign-in page is on another site than the MCP server (registrable domain, approximated
   * without the public suffix list, so two hosts under a shared suffix such as `github.io` may
   * count as one site: the UI always shows both hosts).
   */
  crossSite: boolean;
  /**
   * Where `scopes` come from, in the order the MCP specification gives (2026-07-28, Scope
   * Selection Strategy): the 401 challenge's `scope`, else the protected resource metadata's
   * `scopes_supported`; `step-up`: previously requested + the `insufficient_scope` challenge;
   * `none`: no scope is sent (the authorization server's default).
   */
  scopeSource: 'challenge' | 'resource-metadata' | 'step-up' | 'none';
  /** Scopes that can be requested, in order. */
  scopes: string[];
  /** Pre-selected: everything except what the user deselected for this server before. */
  selected: string[];
  /** Step-up: the scopes the server asked for now (always requested). */
  required: string[];
}

/** The user's answer to a `McpSignInPlan` (`mcp.signIn`). */
export interface McpSignInConfirm {
  /** `McpSignInPlan.authorizationHost` as shown. */
  authorizationHost: string;
  /** The selected scopes (a subset of the plan's `scopes`, incl. every `required` one; non-empty when the plan offers any). */
  scopes: string[];
}

/**
 * An MCP server a visited site advertises (Settings -> MCP -> Discovered). Everything in it came
 * from the network and was validated / sanitised; nothing is added without the user's click.
 */
export interface DiscoveredMcpServer {
  /** Stable key: the normalised endpoint URL. */
  key: string;
  /** Streamable HTTP endpoint (passes the MCP URL rules). */
  endpoint: string;
  endpointHost: string;
  /** Display name from the server card (sanitised, capped), or the host. */
  name: string;
  /** A valid `McpServerConfig.name`: from `name` when it matches the endpoint's host, else from the host. */
  suggestedName: string;
  description?: string;
  version?: string;
  /** Origin of the page it was found on. */
  foundOn: string;
  /** The endpoint is on the same origin as the page (otherwise the UI names the other host). */
  sameOrigin: boolean;
  /**
   * `catalog`: from the site's AI Catalog (`/.well-known/ai-catalog.json`): a card inline or
   * fetched from the same origin, or (card on another host, not fetched) the endpoint at the card's
   * reserved location `<endpoint>/server-card`; `server-card`: the legacy
   * `/.well-known/mcp/server-card.json` (used when the catalog has no MCP entry);
   * `protected-resource`: RFC 9728 metadata + probe.
   */
  source: 'server-card' | 'catalog' | 'protected-resource';
  /** From an unauthenticated probe: `oauth` = 401 Bearer, `none` = answered, `unknown` = not probed / unclear. */
  auth: 'none' | 'oauth' | 'unknown';
  /** First authorization server listed in the site's protected-resource metadata (a hint). */
  authorizationServer?: string;
  discoveredAt: number;
  lastSeenAt: number;
  /** Set in RPC results when a configured server already uses this endpoint. */
  addedServerId?: string;
}

export interface McpTestResult {
  ok: boolean;
  serverInfo?: McpServerInfo;
  protocolVersion?: string;
  tools?: { name: string; description: string }[];
  error?: ErrorInfo;
}

// ---------------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------------

/**
 * Names of encrypted values (API keys, MCP auth), kept in the worker's IndexedDB store (see
 * `background/secrets.ts`). `openrouter-key` keeps the v0.3 name so migrated installs keep their key.
 */
export type SecretName = 'openrouter-key' | 'ollama-key' | 'custom-key' | `mcp-auth-${string}` | `mcp-oauth-${string}`;

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export interface Keybind {
  /** `KeyboardEvent.key`, lower-cased for letters. */
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface ProviderSettings {
  /** Overrides the default base URL (required for `custom`). */
  baseUrl: string;
  /** Display label (only meaningful for `custom`). */
  label: string;
}

export interface Settings {
  /** Schema version of this object; bump + migrate in `background/settings.ts`. */
  version: 1;
  providers: Record<ProviderId, ProviderSettings>;
  models: Record<ModelRole, ModelSelection>;
  /** Extra system prompt appended to the built-in one. */
  systemPrompt: string;
  /** Extra prompt per hostname (`example.com` -> text). */
  sitePrompts: Record<string, string>;
  /** Ask before running tools with `mutates: true`. */
  confirmMutations: boolean;
  /** Agent loop step limit (one step = one LLM call). */
  maxSteps: number;
  /** Suggestions while typing in the bar. */
  autocomplete: boolean;
  /**
   * Use tools that web pages offer through WebMCP (`document.modelContext`). When on, the worker
   * registers a tiny MAIN-world script that provides the API in browsers without it; when off,
   * nothing is injected and no page tool is listed or called.
   */
  webmcp: boolean;
  /**
   * Optional in-page fallback shortcut handled by the content script. The primary shortcut is
   * the `_execute_action` command (Ctrl/Cmd+K by default, changed at chrome://extensions/shortcuts).
   * `null` = no fallback.
   */
  keybind: Keybind | null;
  mcpServers: McpServerConfig[];
  /**
   * Look for MCP servers on visited sites (two requests to the site's own `/.well-known/`
   * addresses, once a day per site, no cookies; never in incognito). Results are only listed.
   */
  mcpDiscovery: boolean;
  /** Tool names the user switched off. */
  disabledTools: string[];
  /** Verbose console logging (otherwise warnings/errors only, or nothing in production). */
  debugLogging: boolean;
}

/**
 * Patch accepted by `settings.set`. Top-level keys replace; `providers` and `models` merge one
 * level deep (per provider / per role). `mcpServers` is managed through the `mcp.*` RPCs.
 */
export type SettingsPatch = {
  [K in Exclude<keyof Settings, 'version' | 'mcpServers' | 'providers' | 'models'>]?: Settings[K];
} & {
  providers?: Partial<Record<ProviderId, Partial<ProviderSettings>>>;
  models?: Partial<Record<ModelRole, ModelSelection>>;
};

// ---------------------------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------------------------

export interface AutocompleteResult {
  /** Echo of the request text, so the UI can drop stale responses. */
  text: string;
  suggestions: string[];
}
