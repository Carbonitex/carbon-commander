/**
 * Settings persistence: load (merge with defaults + validate), patch, reset, change notification.
 * Stored in `chrome.storage.local` under `STORAGE_KEYS.settings`.
 */

import {
  DEFAULT_SETTINGS,
  MAX_STEPS_LIMIT,
  MCP_SERVER_NAME_PATTERN,
  MODEL_ROLES,
  PROVIDER_IDS,
  STORAGE_KEYS,
  defaultSettings,
  endpointUrlProblem,
} from '../shared/defaults';
import type {
  Keybind,
  McpServerConfig,
  ModelSelection,
  ProviderId,
  ProviderSettings,
  Settings,
  SettingsPatch,
} from '../shared/types';
import { CcError } from '../shared/types';
import type { StorageAreaLike, StorageChangeLike } from './storage-area';

export type SettingsListener = (settings: Settings) => void;

export interface SettingsStore {
  /** Current settings (cached; always valid and complete). */
  get(): Promise<Settings>;
  /** Merge a patch (see `SettingsPatch`), validate, save. Throws `CcError('invalid')` on bad input. */
  set(patch: SettingsPatch): Promise<Settings>;
  /**
   * Read-modify-write with full access (e.g. `mcpServers` for the MCP manager). Calls are
   * serialised. The result is validated strictly.
   */
  update(mutate: (current: Settings) => Settings): Promise<Settings>;
  reset(): Promise<Settings>;
  /** Fires after any change (from this store or another context writing the same key). */
  onChange(listener: SettingsListener): () => void;
}

export function createSettingsStore(area: StorageAreaLike = chrome.storage.local): SettingsStore {
  let cache: Settings | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<SettingsListener>();

  const notify = (settings: Settings): void => {
    for (const listener of listeners) listener(structuredClone(settings));
  };

  area.onChanged?.addListener((changes: Record<string, StorageChangeLike>) => {
    const change = changes[STORAGE_KEYS.settings];
    if (!change) return;
    const next = normalizeSettings(change.newValue);
    if (cache && JSON.stringify(cache) === JSON.stringify(next)) return; // our own write, already notified
    cache = next;
    notify(next);
  });

  async function load(): Promise<Settings> {
    if (cache) return cache;
    const got = await area.get([STORAGE_KEYS.settings, STORAGE_KEYS.legacySettings]);
    const stored = got[STORAGE_KEYS.settings];
    cache = stored === undefined ? migrateLegacy(got[STORAGE_KEYS.legacySettings]) : normalizeSettings(stored);
    return cache;
  }

  async function save(next: Settings): Promise<Settings> {
    cache = next;
    await area.set({ [STORAGE_KEYS.settings]: next });
    notify(next);
    return structuredClone(next);
  }

  /** Serialise writes so concurrent patches do not lose updates. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    async get() {
      return structuredClone(await load());
    },
    set(patch) {
      return enqueue(async () => save(validateSettings(applyPatch(await load(), patch))));
    },
    update(mutate) {
      return enqueue(async () => save(validateSettings(mutate(structuredClone(await load())))));
    },
    reset() {
      return enqueue(() => save(defaultSettings()));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Apply a `SettingsPatch` (no validation). */
export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  const next: Settings = { ...structuredClone(current) };
  // `mcpServers` / `version` are not patchable (the patch may come untyped from a page).
  const {
    providers,
    models,
    mcpServers: _mcpServers,
    version: _version,
    ...rest
  } = patch as SettingsPatch & { mcpServers?: unknown; version?: unknown };
  Object.assign(next, structuredClone(rest));
  if (providers) {
    for (const id of PROVIDER_IDS) {
      const p = providers[id];
      if (p) next.providers[id] = { ...next.providers[id], ...p };
    }
  }
  if (models) {
    for (const role of MODEL_ROLES) {
      const m = models[role];
      if (m) next.models[role] = { ...m };
    }
  }
  return next;
}

/**
 * Strict validation for writes: returns a clean copy or throws `CcError('invalid')` with a
 * message naming the bad field.
 */
export function validateSettings(input: Settings): Settings {
  const fail = (field: string, why: string): never => {
    throw new CcError('invalid', `Invalid setting "${field}": ${why}`);
  };
  const s = input as Partial<Record<keyof Settings, unknown>>;

  for (const id of PROVIDER_IDS) {
    const p = (s.providers as Record<string, unknown> | undefined)?.[id];
    if (!isRecord(p) || typeof p.baseUrl !== 'string' || typeof p.label !== 'string') {
      fail(`providers.${id}`, 'expected { baseUrl, label }');
    }
    const url = (p as ProviderSettings).baseUrl;
    const problem = url === '' ? null : endpointUrlProblem(url);
    if (problem) fail(`providers.${id}.baseUrl`, problem);
  }
  for (const role of MODEL_ROLES) {
    const m = (s.models as Record<string, unknown> | undefined)?.[role];
    if (!isModelSelection(m)) fail(`models.${role}`, 'expected { provider, model }');
  }
  if (typeof s.systemPrompt !== 'string') fail('systemPrompt', 'expected a string');
  if (!isStringRecord(s.sitePrompts)) fail('sitePrompts', 'expected hostname -> text');
  if (typeof s.confirmMutations !== 'boolean') fail('confirmMutations', 'expected a boolean');
  if (!isInt(s.maxSteps) || s.maxSteps < 1 || s.maxSteps > MAX_STEPS_LIMIT) {
    fail('maxSteps', `expected an integer 1..${MAX_STEPS_LIMIT}`);
  }
  if (typeof s.autocomplete !== 'boolean') fail('autocomplete', 'expected a boolean');
  if (typeof s.webmcp !== 'boolean') fail('webmcp', 'expected a boolean');
  if (s.keybind !== null && !isKeybind(s.keybind)) fail('keybind', 'expected a keybind or null');
  if (!Array.isArray(s.mcpServers)) fail('mcpServers', 'expected an array');
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const server of s.mcpServers as unknown[]) {
    if (!isMcpServer(server)) fail('mcpServers', 'expected { id, name, url, enabled }');
    const srv = server as McpServerConfig;
    if (!MCP_SERVER_NAME_PATTERN.test(srv.name)) fail('mcpServers', `name "${srv.name}" must match ${MCP_SERVER_NAME_PATTERN.source}`);
    if (!isHttpUrl(srv.url)) fail('mcpServers', `URL of "${srv.name}" must be http(s)`);
    if (names.has(srv.name.toLowerCase())) fail('mcpServers', `duplicate name "${srv.name}"`);
    if (ids.has(srv.id)) fail('mcpServers', `duplicate id "${srv.id}"`);
    if (srv.oauthClientId !== undefined && !isOAuthClientId(srv.oauthClientId)) fail('mcpServers', `OAuth client id of "${srv.name}" is invalid`);
    names.add(srv.name.toLowerCase());
    ids.add(srv.id);
  }
  if (typeof s.mcpDiscovery !== 'boolean') fail('mcpDiscovery', 'expected a boolean');
  if (!isStringArray(s.disabledTools)) fail('disabledTools', 'expected an array of tool names');
  if (typeof s.debugLogging !== 'boolean') fail('debugLogging', 'expected a boolean');

  const v = input;
  return {
    version: 1,
    providers: pickProviders(v.providers),
    models: Object.fromEntries(MODEL_ROLES.map((r) => [r, { ...v.models[r] }])) as Settings['models'],
    systemPrompt: v.systemPrompt,
    sitePrompts: { ...v.sitePrompts },
    confirmMutations: v.confirmMutations,
    maxSteps: v.maxSteps,
    autocomplete: v.autocomplete,
    webmcp: v.webmcp,
    keybind: v.keybind ? pickKeybind(v.keybind) : null,
    mcpServers: v.mcpServers.map((m) => ({ id: m.id, name: m.name, url: m.url, enabled: m.enabled, ...(m.trustReadOnlyHints === true ? { trustReadOnlyHints: true } : {}), ...oauthClientIdOf(m) })),
    mcpDiscovery: v.mcpDiscovery,
    disabledTools: [...new Set(v.disabledTools)],
    debugLogging: v.debugLogging,
  };
}

/**
 * Lenient normalisation for reads: anything stored (possibly older / partially corrupt) becomes
 * a complete, valid `Settings`. Invalid fields fall back to defaults; invalid MCP entries are
 * dropped; roles that no longer exist (the old `fast` role) are ignored.
 */
export function normalizeSettings(stored: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(stored)) return d;
  const s = stored;

  const providers = d.providers;
  if (isRecord(s.providers)) {
    for (const id of PROVIDER_IDS) {
      const p = s.providers[id];
      if (!isRecord(p)) continue;
      // A stored URL that breaks the endpoint rule (e.g. a remote http:// URL saved by an older
      // version) falls back to the default, so a key is never sent in clear text.
      if (typeof p.baseUrl === 'string' && (p.baseUrl === '' || endpointUrlProblem(p.baseUrl) === null)) providers[id].baseUrl = p.baseUrl;
      if (typeof p.label === 'string') providers[id].label = p.label;
    }
  }
  const models = d.models;
  if (isRecord(s.models)) {
    for (const role of MODEL_ROLES) {
      const m = s.models[role];
      if (isModelSelection(m)) models[role] = { provider: m.provider, model: m.model };
    }
  }
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const mcpServers = Array.isArray(s.mcpServers)
    ? s.mcpServers.filter((m): m is McpServerConfig => {
        if (!isMcpServer(m) || !MCP_SERVER_NAME_PATTERN.test(m.name) || !isHttpUrl(m.url)) return false;
        if (seenNames.has(m.name.toLowerCase()) || seenIds.has(m.id)) return false;
        seenNames.add(m.name.toLowerCase());
        seenIds.add(m.id);
        return true;
      })
    : d.mcpServers;

  return {
    version: 1,
    providers,
    models,
    systemPrompt: typeof s.systemPrompt === 'string' ? s.systemPrompt : d.systemPrompt,
    sitePrompts: isStringRecord(s.sitePrompts) ? { ...s.sitePrompts } : d.sitePrompts,
    confirmMutations: typeof s.confirmMutations === 'boolean' ? s.confirmMutations : d.confirmMutations,
    maxSteps:
      isInt(s.maxSteps) && s.maxSteps >= 1 && s.maxSteps <= MAX_STEPS_LIMIT ? s.maxSteps : DEFAULT_SETTINGS.maxSteps,
    autocomplete: typeof s.autocomplete === 'boolean' ? s.autocomplete : d.autocomplete,
    webmcp: typeof s.webmcp === 'boolean' ? s.webmcp : d.webmcp,
    keybind: s.keybind === null ? null : isKeybind(s.keybind) ? pickKeybind(s.keybind) : d.keybind,
    mcpServers: mcpServers.map((m) => ({ id: m.id, name: m.name, url: m.url, enabled: m.enabled, ...(m.trustReadOnlyHints === true ? { trustReadOnlyHints: true } : {}), ...oauthClientIdOf(m) })),
    mcpDiscovery: typeof s.mcpDiscovery === 'boolean' ? s.mcpDiscovery : d.mcpDiscovery,
    disabledTools: isStringArray(s.disabledTools) ? [...new Set(s.disabledTools)] : d.disabledTools,
    debugLogging: typeof s.debugLogging === 'boolean' ? s.debugLogging : d.debugLogging,
  };
}

/**
 * First run of v0.4 on a v0.3 profile: carry over the system prompt and per-host prompts from
 * `carbonbar_settings`. (MCP configs and the page keybind are not migrated: the formats changed.)
 */
export function migrateLegacy(legacy: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(legacy)) return d;
  if (typeof legacy.systemPrompt === 'string') d.systemPrompt = legacy.systemPrompt;
  const hp = legacy.hostnamePrompts;
  const entries: unknown[] = Array.isArray(hp) ? hp : isRecord(hp) ? Object.entries(hp) : [];
  for (const entry of entries) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1] !== '') {
      d.sitePrompts[entry[0]] = entry[1];
    }
  }
  return d;
}

// ---------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function isStringRecord(v: unknown): v is Record<string, string> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === 'string');
}
function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);
}
function isModelSelection(v: unknown): v is ModelSelection {
  return isRecord(v) && isProviderId(v.provider) && typeof v.model === 'string';
}
function isKeybind(v: unknown): v is Keybind {
  return (
    isRecord(v) &&
    typeof v.key === 'string' &&
    v.key.length > 0 &&
    typeof v.ctrl === 'boolean' &&
    typeof v.meta === 'boolean' &&
    typeof v.alt === 'boolean' &&
    typeof v.shift === 'boolean'
  );
}
function pickKeybind(k: Keybind): Keybind {
  return { key: k.key, ctrl: k.ctrl, meta: k.meta, alt: k.alt, shift: k.shift };
}
function isMcpServer(v: unknown): v is McpServerConfig {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.name === 'string' &&
    typeof v.url === 'string' &&
    typeof v.enabled === 'boolean'
  );
}
function pickProviders(p: Settings['providers']): Settings['providers'] {
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, { baseUrl: p[id].baseUrl, label: p[id].label }]),
  ) as Settings['providers'];
}
/** OAuth client ids: printable ASCII, no spaces, at most 512 characters. */
export function isOAuthClientId(v: unknown): v is string {
  return typeof v === 'string' && /^[\x21-\x7e]{1,512}$/.test(v);
}
function oauthClientIdOf(m: McpServerConfig): { oauthClientId?: string } {
  return isOAuthClientId(m.oauthClientId) ? { oauthClientId: m.oauthClientId } : {};
}
