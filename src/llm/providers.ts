/**
 * Provider resolution (defaults + user overrides), per-role client resolution, `providers.status`
 * probes and the cached `/models` lists.
 */
import type { SecretStore } from '../background/secrets';
import { endpointUrlProblem, PROVIDER_IDS, PROVIDERS } from '../shared/defaults';
import type { LlmClient, ModelInfo, ModelRole, ProviderConfig, ProviderId, ProviderStatus, Settings } from '../shared/types';
import { CcError, toErrorInfo } from '../shared/types';
import { createLlmClient, type LlmClientOptions } from './client';

/** Secrets the provider layer needs (a `SecretStore` satisfies it). */
export type SecretReader = Pick<SecretStore, 'get' | 'has'>;

/** How long a provider's model list is reused before it is fetched again. */
export const MODEL_CACHE_TTL_MS = 10 * 60_000;
/** Timeout of a status probe / model list request. */
export const PROBE_TIMEOUT_MS = 8_000;

/** Overridable for tests (fake `fetch`). */
let clientOptions: LlmClientOptions = {};
export function setLlmClientOptions(options: LlmClientOptions): void {
  clientOptions = options;
}

/** `PROVIDERS[id]` with the user's `Settings.providers[id]` overrides applied. */
export function resolveProvider(id: ProviderId, settings: Settings): ProviderConfig {
  const base = PROVIDERS[id];
  if (!base) throw new CcError('invalid', `Unknown provider "${String(id)}"`);
  const user = settings.providers[id];
  const baseUrl = (user?.baseUrl.trim() || base.baseUrl).replace(/\/+$/, '');
  const label = user?.label.trim() || base.label;
  return { ...base, baseUrl, label };
}

export function createClientFor(id: ProviderId, settings: Settings, apiKey: string | null): LlmClient {
  return createLlmClient(resolveProvider(id, settings), apiKey, clientOptions);
}

/**
 * Client + model id for a role. Throws `CcError('no-model')` when no model is chosen and
 * `CcError('no-key')` when the provider needs a key that is not stored.
 */
export async function resolveLlm(
  role: ModelRole,
  settings: Settings,
  secrets: SecretReader,
): Promise<{ llm: LlmClient; model: string }> {
  const selection = settings.models[role];
  if (!selection || !selection.model) {
    throw new CcError('no-model', `No model selected for "${role}". Choose one in settings.`);
  }
  const provider = resolveProvider(selection.provider, settings);
  if (!provider.baseUrl) throw new CcError('invalid', `${provider.label}: set a base URL in settings.`);
  const key = await secrets.get(provider.keyName);
  if (provider.needsKey && !key) throw new CcError('no-key', `${provider.label} needs an API key. Add it in settings.`);
  return { llm: createLlmClient(provider, key, clientOptions), model: selection.model };
}

/** Backs the `providers.status` RPC. */
export async function getProviderStatus(
  settings: Settings,
  secrets: SecretReader,
  check: boolean,
): Promise<ProviderStatus[]> {
  return Promise.all(
    PROVIDER_IDS.map(async (id): Promise<ProviderStatus> => {
      const provider = resolveProvider(id, settings);
      const hasKey = await secrets.has(provider.keyName);
      const status: ProviderStatus = {
        id,
        label: provider.label,
        baseUrl: provider.baseUrl,
        needsKey: provider.needsKey,
        hasKey,
      };
      if (!check) return status;
      if (!provider.baseUrl) {
        status.error = { code: 'invalid', message: 'No base URL configured' };
        return status;
      }
      const problem = endpointUrlProblem(provider.baseUrl);
      if (problem) {
        status.error = { code: 'invalid', message: `The base URL ${problem}` };
        return status;
      }
      if (provider.needsKey && !hasKey) {
        status.error = { code: 'no-key', message: `${provider.label} needs an API key` };
        return status;
      }
      try {
        const key = hasKey ? await secrets.get(provider.keyName) : null;
        await probe(provider, key);
        status.reachable = true;
      } catch (err) {
        const info = toErrorInfo(err);
        // An HTTP answer means the server is there; the error says what is wrong (key, origin, ...).
        status.reachable = info.code === 'http';
        status.error = info;
      }
      return status;
    }),
  );
}

/**
 * OpenRouter's `/models` is public, so it cannot tell whether the key works: probe `/key` (401
 * for a bad key). Other providers: `/models`.
 */
async function probe(provider: ProviderConfig, key: string | null): Promise<void> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  if (provider.id === 'openrouter') {
    const doFetch = clientOptions.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
    let res: Response;
    try {
      res = await doFetch(`${provider.baseUrl}/key`, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        redirect: 'manual', // never carry the key to another URL
        credentials: 'omit',
        signal,
      });
    } catch (err) {
      throw new CcError('network', `Could not reach ${provider.label} at ${provider.baseUrl}`, { cause: err });
    }
    void res.body?.cancel().catch(() => undefined);
    if (res.type === 'opaqueredirect') {
      throw new CcError('http', `${provider.label} answered with a redirect, which is not followed. Check the base URL.`);
    }
    if (!res.ok) {
      throw new CcError(
        'http',
        res.status === 401 ? `${provider.label} rejected the API key` : `${provider.label} returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    return;
  }
  const client = createLlmClient(provider, key, clientOptions);
  try {
    await client.listModels(signal);
  } catch (err) {
    if (provider.id === 'ollama' && err instanceof CcError && err.code === 'network') {
      throw new CcError('network', `${err.message}. Is Ollama running (\`ollama serve\`)?`, { cause: err });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Model list cache
// ---------------------------------------------------------------------------------------------

interface CacheEntry {
  at: number;
  models: Promise<ModelInfo[]>;
}

const modelCache = new Map<string, CacheEntry>();

export function clearModelCache(): void {
  modelCache.clear();
}

/** Backs the `models.list` RPC (cached per provider + base URL + key presence unless `refresh`). */
export async function listModels(
  id: ProviderId,
  settings: Settings,
  secrets: SecretReader,
  refresh: boolean,
  now: () => number = Date.now,
): Promise<ModelInfo[]> {
  const provider = resolveProvider(id, settings);
  if (!provider.baseUrl) throw new CcError('invalid', `${provider.label}: set a base URL in settings.`);
  const key = await secrets.get(provider.keyName);
  const cacheKey = `${id}|${provider.baseUrl}|${key ? 'key' : 'nokey'}`;
  const hit = modelCache.get(cacheKey);
  if (!refresh && hit && now() - hit.at < MODEL_CACHE_TTL_MS) return structuredClone(await hit.models);

  const models = createLlmClient(provider, key, clientOptions).listModels(AbortSignal.timeout(PROBE_TIMEOUT_MS));
  const entry: CacheEntry = { at: now(), models };
  modelCache.set(cacheKey, entry);
  try {
    return structuredClone(await models);
  } catch (err) {
    if (modelCache.get(cacheKey) === entry) modelCache.delete(cacheKey); // do not cache failures
    throw err;
  }
}
