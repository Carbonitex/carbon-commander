/**
 * Default values. This is the ONLY place model ids may be hard-coded.
 *
 * OpenRouter defaults were checked against https://openrouter.ai/api/v1/models on 2026-11-16
 * (all listed, all accept `tools`; chat/vision accept image input). Ollama and custom
 * providers have no defaults: the user picks from the provider's `/models` list.
 */

import type { ModelRole, ProviderConfig, ProviderId, Settings } from './types';

/** Built-in provider definitions. `Settings.providers` may override `baseUrl` / `label`. */
export const PROVIDERS: Readonly<Record<ProviderId, ProviderConfig>> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyName: 'openrouter-key',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    keyName: 'ollama-key',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    // A key is optional for custom endpoints: sent when one is stored.
    needsKey: false,
    keyName: 'custom-key',
  },
};

export const PROVIDER_IDS: readonly ProviderId[] = ['openrouter', 'ollama', 'custom'];
export const MODEL_ROLES: readonly ModelRole[] = ['chat', 'vision', 'autocomplete'];

/** Default OpenRouter model per role. */
export const DEFAULT_OPENROUTER_MODELS: Readonly<Record<ModelRole, string>> = {
  /** Agent loop: strong, reliable tool calling. $2 / $10 per M tokens. */
  chat: 'anthropic/claude-sonnet-5.5',
  /** Describes images for a chat model that cannot see them. $0.83 / $4.12. */
  vision: 'google/gemini-3.8-flash',
  /** Typing suggestions: low latency, low cost. $0.30 / $2.50. */
  autocomplete: 'google/gemini-3.5-flash-lite',
};

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  version: 1,
  providers: {
    openrouter: { baseUrl: PROVIDERS.openrouter.baseUrl, label: PROVIDERS.openrouter.label },
    ollama: { baseUrl: PROVIDERS.ollama.baseUrl, label: PROVIDERS.ollama.label },
    custom: { baseUrl: '', label: PROVIDERS.custom.label },
  },
  models: {
    chat: { provider: 'openrouter', model: DEFAULT_OPENROUTER_MODELS.chat },
    vision: { provider: 'openrouter', model: DEFAULT_OPENROUTER_MODELS.vision },
    autocomplete: { provider: 'openrouter', model: DEFAULT_OPENROUTER_MODELS.autocomplete },
  },
  systemPrompt: '',
  sitePrompts: {},
  confirmMutations: true,
  maxSteps: 20,
  autocomplete: true,
  webmcp: true,
  keybind: null,
  mcpServers: [],
  mcpDiscovery: true,
  disabledTools: [],
  debugLogging: false,
};

/** Fresh mutable copy of the defaults. */
export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

/** Hosts allowed over plain `http:` for providers and MCP servers (the local machine only). */
export const LOCAL_HTTP_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Endpoint rule shared by MCP servers and LLM providers: `https:`, or `http:` only for
 * localhost / 127.0.0.1 / [::1]. Returns an error message, or null when the URL is acceptable.
 */
export function endpointUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'not a valid URL';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'must start with https://';
  if (u.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(u.hostname)) {
    return 'use https:// (plain http:// is only allowed for localhost, 127.0.0.1 and [::1])';
  }
  if (u.username || u.password) return 'must not contain credentials';
  return null;
}

/** Upper bound accepted for `Settings.maxSteps`. */
export const MAX_STEPS_LIMIT = 100;

/** Pattern for tool names exposed to the model (OpenAI / Anthropic function-name rule). */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
/** Pattern for `McpServerConfig.name`. */
export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

/** `chrome.storage` keys. */
export const STORAGE_KEYS = {
  /** `chrome.storage.local`: the `Settings` object. */
  settings: 'cc_settings',
  /**
   * Legacy (v0.3 / early v0.4) `chrome.storage.local` key holding an extractable AES-GCM key as
   * JWK. Read once to migrate secrets into IndexedDB, then deleted.
   */
  encryptionKey: '_cc_encryption_key',
  /** Legacy `chrome.storage.local` prefix of encrypted values, `encrypted_<SecretName>`; migrated, then deleted. */
  secretPrefix: 'encrypted_',
  /** `chrome.storage.session`: prefix for per-tab `SessionState`, `cc_session_<tabId>`. */
  sessionPrefix: 'cc_session_',
  /** `chrome.storage.session`: frame ids of bar iframes announced by our content script, per tab. */
  barFrames: 'cc_bar_frames',
  /** `chrome.storage.local`: the bar's input history (owned by the UI). */
  uiHistory: 'cc_ui_history',
  /** v0.3 keys read once to migrate the system prompt / site prompts. */
  legacySettings: 'carbonbar_settings',
  /** `chrome.storage.local`: MCP servers found on visited sites + dismissed keys (`mcp/discovery.ts`). */
  mcpDiscovered: 'cc_mcp_discovered',
  /** `chrome.storage.session`: origins already checked for MCP servers -> time (cleared with the browser session). */
  mcpDiscoveryChecked: 'cc_mcp_discovery_checked',
  /** `chrome.storage.session`: MCP OAuth sign-ins in progress / failed, per server id (no secrets). */
  mcpOAuthPending: 'cc_mcp_oauth_pending',
} as const;

/** Path of the OAuth redirect URI, `https://<extension-id>.chromiumapp.org/<path>`. */
export const MCP_OAUTH_REDIRECT_PATH = 'mcp-oauth';

/** Secret name for an MCP server's OAuth state (client registration + tokens). Not reachable over RPC. */
export function mcpOAuthSecretName(serverId: string): `mcp-oauth-${string}` {
  return `mcp-oauth-${serverId}`;
}

/** Secret name for an MCP server's auth JSON. */
export function mcpAuthSecretName(serverId: string): `mcp-auth-${string}` {
  return `mcp-auth-${serverId}`;
}
