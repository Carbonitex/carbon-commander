/**
 * Small GET helpers for site toolsets that call public APIs from the service worker. Responses
 * are read with a byte cap (`SITE_MAX_BYTES`) so a misbehaving API cannot exhaust memory, and
 * redirects are not followed (site toolsets only talk to their fixed API hosts).
 */
import { CcError } from '../../shared/types';
import { readTextCapped, withTimeout } from '../net';

/** Bytes read from one site API response. */
export const SITE_MAX_BYTES = 4 * 1024 * 1024;

async function get(fetchFn: typeof fetch, url: string, signal: AbortSignal, headers: Record<string, string>): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { credentials: 'omit', redirect: 'manual', headers, signal: withTimeout(signal, 15_000) });
  } catch (err) {
    if (signal.aborted) throw new CcError('aborted', 'Aborted');
    throw new CcError('network', `Request to ${new URL(url).host} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.type === 'opaqueredirect') throw new CcError('http', `${new URL(url).host} answered with a redirect, which is not followed`);
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    const remaining = res.headers.get('x-ratelimit-remaining');
    const hint = (res.status === 403 || res.status === 429) && remaining === '0' ? ' (API rate limit reached; try again later)' : '';
    throw new CcError('http', `${new URL(url).host} returned HTTP ${res.status}${hint}`, { status: res.status });
  }
  return res;
}

async function readBody(res: Response, url: string): Promise<string> {
  const { text, truncated } = await readTextCapped(res, SITE_MAX_BYTES);
  if (truncated) throw new CcError('invalid', `${new URL(url).host} sent more than ${SITE_MAX_BYTES / 1024 / 1024} MB`);
  return text;
}

export async function getJson<T>(
  fetchFn: typeof fetch,
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await get(fetchFn, url, signal, { Accept: 'application/json', ...headers });
  const text = await readBody(res, url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CcError('invalid', `${new URL(url).host} returned invalid JSON`);
  }
}

export async function getText(fetchFn: typeof fetch, url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<string> {
  return readBody(await get(fetchFn, url, signal, headers), url);
}
