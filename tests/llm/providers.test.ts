import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/llm/client';
import {
  clearModelCache,
  getProviderStatus,
  listModels,
  resolveLlm,
  resolveProvider,
  setLlmClientOptions,
  type SecretReader,
} from '../../src/llm/providers';
import { defaultSettings } from '../../src/shared/defaults';
import type { SecretName } from '../../src/shared/types';
import { CcError } from '../../src/shared/types';

function secrets(values: Partial<Record<SecretName, string>>): SecretReader {
  return {
    get: (name) => Promise.resolve(values[name] ?? null),
    has: (name) => Promise.resolve(values[name] !== undefined),
  };
}

let urls: string[] = [];
let respond: (url: string, init: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  urls = [];
  respond = () => Response.json({ data: [] });
  const fetch: FetchLike = async (url, init) => {
    urls.push(url);
    return respond(url, init);
  };
  setLlmClientOptions({ fetch });
  clearModelCache();
});
afterEach(() => setLlmClientOptions({}));

describe('resolveProvider', () => {
  it('applies base URL / label overrides and strips trailing slashes', () => {
    const s = defaultSettings();
    s.providers.ollama.baseUrl = 'http://127.0.0.1:11434/v1/';
    s.providers.custom = { baseUrl: 'https://llm.example.org/v1', label: 'My server' };
    expect(resolveProvider('ollama', s)).toMatchObject({ id: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false });
    expect(resolveProvider('custom', s)).toMatchObject({ label: 'My server', baseUrl: 'https://llm.example.org/v1', keyName: 'custom-key' });
    expect(resolveProvider('openrouter', defaultSettings()).baseUrl).toBe('https://openrouter.ai/api/v1');
  });
});

describe('resolveLlm', () => {
  it('returns a client and model for the role', async () => {
    const { llm, model } = await resolveLlm('chat', defaultSettings(), secrets({ 'openrouter-key': 'k' }));
    expect(llm.provider.id).toBe('openrouter');
    expect(model).toBe(defaultSettings().models.chat.model);
  });

  it('throws no-model, no-key and invalid (custom without URL)', async () => {
    const s = defaultSettings();
    s.models.vision.model = '';
    await expect(resolveLlm('vision', s, secrets({}))).rejects.toMatchObject({ code: 'no-model' });
    await expect(resolveLlm('chat', s, secrets({}))).rejects.toMatchObject({ code: 'no-key' });
    s.models.chat = { provider: 'custom', model: 'm' };
    await expect(resolveLlm('chat', s, secrets({}))).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('getProviderStatus', () => {
  it('reports configuration without probing when check is false', async () => {
    const list = await getProviderStatus(defaultSettings(), secrets({ 'openrouter-key': 'k' }), false);
    expect(list.map((p) => [p.id, p.hasKey, p.reachable])).toEqual([
      ['openrouter', true, undefined],
      ['ollama', false, undefined],
      ['custom', false, undefined],
    ]);
    expect(urls).toEqual([]);
  });

  it('probes OpenRouter /key, Ollama /models; explains an Ollama 403', async () => {
    respond = (url) => {
      if (url.endsWith('/key')) return Response.json({ data: {} });
      if (url.startsWith('http://localhost:11434')) return new Response('', { status: 403 });
      return Response.json({ data: [] });
    };
    const list = await getProviderStatus(defaultSettings(), secrets({ 'openrouter-key': 'k' }), true);
    const [or, ol, custom] = list;
    expect([...urls].sort()).toEqual(['http://localhost:11434/v1/models', 'https://openrouter.ai/api/v1/key']);
    expect(or).toMatchObject({ reachable: true });
    expect(or!.error).toBeUndefined();
    expect(ol).toMatchObject({ reachable: true, error: { code: 'http', status: 403 } });
    expect(ol!.error!.message).toContain('OLLAMA_ORIGINS');
    expect(custom!.error).toMatchObject({ code: 'invalid' });
  });

  it('reports a rejected key, a missing key and an unreachable server', async () => {
    respond = (url) => {
      if (url.endsWith('/key')) return new Response('{}', { status: 401 });
      throw new TypeError('Failed to fetch');
    };
    const [or, ol] = await getProviderStatus(defaultSettings(), secrets({ 'openrouter-key': 'bad' }), true);
    expect(or).toMatchObject({ reachable: true, error: { code: 'http', status: 401 } });
    expect(ol).toMatchObject({ reachable: false, error: { code: 'network' } });
    expect(ol!.error!.message).toContain('Is Ollama running');

    const [noKey] = await getProviderStatus(defaultSettings(), secrets({}), true);
    expect(noKey).toMatchObject({ hasKey: false, error: { code: 'no-key' } });
  });
});

describe('listModels cache', () => {
  it('caches per provider, refreshes on demand and after the TTL, and does not cache failures', async () => {
    let n = 0;
    respond = () => Response.json({ data: [{ id: `m${++n}` }] });
    const s = defaultSettings();
    const sec = secrets({});
    let t = 1_000;
    const now = (): number => t;
    expect((await listModels('ollama', s, sec, false, now))[0]!.id).toBe('m1');
    expect((await listModels('ollama', s, sec, false, now))[0]!.id).toBe('m1');
    expect((await listModels('ollama', s, sec, true, now))[0]!.id).toBe('m2');
    t += 11 * 60_000;
    expect((await listModels('ollama', s, sec, false, now))[0]!.id).toBe('m3');

    respond = () => new Response('boom', { status: 500 });
    await expect(listModels('ollama', s, sec, true, now)).rejects.toBeInstanceOf(CcError);
    respond = () => Response.json({ data: [{ id: 'after' }] });
    expect((await listModels('ollama', s, sec, false, now))[0]!.id).toBe('after');
  });
});
