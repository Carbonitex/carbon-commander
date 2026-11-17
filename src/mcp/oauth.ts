/**
 * OAuth 2.1 client pieces for MCP authorization, per the MCP specification revision **2026-07-28**
 * (Authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
 * hand-rolled (no dependency) and written for an MV3 service worker (`fetch` + WebCrypto only):
 *
 * - `WWW-Authenticate` parsing (RFC 9110 §11.6.1, RFC 6750 §3, RFC 9728 §5.1 `resource_metadata`);
 * - protected resource metadata (RFC 9728): header URL, then the path-aware and root well-known
 *   URLs; `resource` must match the MCP server URL;
 * - authorization server metadata (RFC 8414 + OpenID Connect discovery, in the spec's order);
 *   `issuer` must be identical to the identifier the URL was built from; PKCE `S256` must be
 *   advertised (absent `code_challenge_methods_supported` = refuse);
 * - dynamic client registration (RFC 7591) as a public client;
 * - authorization code + PKCE S256 (RFC 7636) with `state`, `resource` (RFC 8707), and the `iss`
 *   response parameter (RFC 9207) checked before anything else in the response is used;
 * - token exchange, refresh, revocation (RFC 7009).
 *
 * Everything from the network is untrusted: URLs must be `https:` (plain `http:` only for
 * localhost / 127.0.0.1 / [::1]), a private / loopback host is refused unless the MCP server
 * itself is on one, responses are size-capped, redirects are not followed, no cookies are sent.
 * Error messages never contain token material.
 */
import { endpointUrlProblem } from '../shared/defaults';
import { CcError, type ErrorCode } from '../shared/types';
import { blockedHostReason } from '../tools/net';
import { cleanText } from './client';

export const OAUTH_LIMITS = {
  /** Metadata / registration / token responses. */
  maxResponseBytes: 64 * 1024,
  maxTokenChars: 16 * 1024,
  maxScopeChars: 2_000,
  maxAuthorizationServers: 5,
  maxScopes: 100,
  maxClientIdChars: 512,
  maxCodeChars: 4_096,
  maxHeaderChars: 8_192,
} as const;

const DEFAULT_TIMEOUT_MS = 15_000;

/** Error from an OAuth step. `oauthError` is the server's `error` code when it sent one. */
export class OAuthError extends CcError {
  readonly oauthError: string | undefined;
  constructor(code: ErrorCode, message: string, options?: { status?: number; cause?: unknown; oauthError?: string }) {
    super(code, message, options);
    this.name = 'OAuthError';
    this.oauthError = options?.oauthError;
  }
}

/** How OAuth requests are made. `serverUrl` (the MCP server) decides whether private hosts are acceptable. */
export interface OAuthHttp {
  fetch?: typeof fetch;
  timeoutMs?: number;
  serverUrl: string;
}

// ---------------------------------------------------------------------------------------------
// WWW-Authenticate
// ---------------------------------------------------------------------------------------------

export interface AuthChallenge {
  /** Lower-cased auth scheme, e.g. `bearer`. */
  scheme: string;
  /** Lower-cased parameter names -> values (first occurrence wins). */
  params: Record<string, string>;
}

const TOKEN_CHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z]/;

/**
 * Parse a `WWW-Authenticate` header value into challenges. Lenient (servers get the grammar
 * wrong) and bounded; `token68` credentials are skipped.
 */
export function parseWwwAuthenticate(header: string | null | undefined): AuthChallenge[] {
  if (!header) return [];
  const s = header.slice(0, OAUTH_LIMITS.maxHeaderChars);
  const out: AuthChallenge[] = [];
  let current: AuthChallenge | null = null;
  let i = 0;
  const skipSpace = (): void => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  };
  const readToken = (): string => {
    const start = i;
    while (i < s.length && TOKEN_CHAR.test(s[i] as string)) i++;
    return s.slice(start, i);
  };
  while (i < s.length) {
    skipSpace();
    if (s[i] === ',') {
      i++;
      continue;
    }
    const name = readToken();
    if (name === '') {
      i++; // junk character
      continue;
    }
    skipSpace();
    if (s[i] === '=' && s[i + 1] !== '=' && current) {
      // auth-param
      i++;
      skipSpace();
      let value = '';
      if (s[i] === '"') {
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < s.length) i++;
          value += s[i];
          i++;
        }
        i++; // closing quote
      } else {
        const start = i;
        while (i < s.length && s[i] !== ',' && s[i] !== ' ' && s[i] !== '\t') i++;
        value = s.slice(start, i);
      }
      const key = name.toLowerCase();
      if (!(key in current.params)) current.params[key] = value;
      continue;
    }
    if (s[i] === '=') {
      // token68 (e.g. `Basic abc==`): skip the padding
      while (s[i] === '=') i++;
      continue;
    }
    // a new challenge: `scheme`, maybe followed by token68 or params
    current = { scheme: name.toLowerCase(), params: {} };
    out.push(current);
    if (out.length > 16) break;
  }
  return out;
}

/** The parts of a Bearer challenge the client uses (RFC 6750 §3, RFC 9728 §5.1). */
export interface BearerChallenge {
  resourceMetadata?: string;
  scope?: string;
  error?: string;
  errorDescription?: string;
}

/** The first `Bearer` challenge of a `WWW-Authenticate` value, or null. Values are cleaned / capped. */
export function bearerChallenge(header: string | null | undefined): BearerChallenge | null {
  const bearer = parseWwwAuthenticate(header).find((c) => c.scheme === 'bearer');
  if (!bearer) return null;
  const out: BearerChallenge = {};
  const p = bearer.params;
  if (p.resource_metadata) out.resourceMetadata = p.resource_metadata.slice(0, 2048);
  if (p.scope !== undefined && isScopeString(p.scope)) out.scope = normalizeScope(p.scope);
  if (p.error) out.error = cleanText(p.error, 64);
  if (p.error_description) out.errorDescription = cleanText(p.error_description, 300);
  return out;
}

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

/**
 * Canonical resource identifier for an MCP server URL (2026-07-28 "Canonical Server URI"):
 * lower-case scheme and host (the URL parser does that), no fragment, no trailing slash.
 */
export function canonicalResourceUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  let href = u.href;
  if (u.search === '' && href.endsWith('/')) href = href.replace(/\/+$/, '');
  return href;
}

/**
 * RFC 9728 §3.3 / §7.3: the metadata's `resource` must identify the server we talk to. Accepted:
 * the same URL (ignoring a trailing slash), or the same origin with a path that is a prefix of the
 * server's path on a segment boundary (a server at `/mcp` protected as `https://host`), which is
 * what the MCP root well-known fallback implies.
 */
export function resourceMatches(resource: string, serverUrl: string): boolean {
  let r: URL;
  let s: URL;
  try {
    r = new URL(resource);
    s = new URL(serverUrl);
  } catch {
    return false;
  }
  if (r.hash !== '' || r.username || r.password) return false;
  if (r.origin !== s.origin) return false;
  const rp = r.pathname.replace(/\/+$/, '');
  const sp = s.pathname.replace(/\/+$/, '');
  if (r.search !== '' && (rp !== sp || r.search !== s.search)) return false;
  return rp === sp || rp === '' || sp.startsWith(`${rp}/`);
}

/** RFC 9728 §3.1 + MCP: path-aware first, then the root. */
export function protectedResourceMetadataUrls(serverUrl: string): string[] {
  const u = new URL(serverUrl);
  const path = u.pathname.replace(/\/+$/, '');
  const urls: string[] = [];
  if (path !== '') urls.push(`${u.origin}/.well-known/oauth-protected-resource${path}`);
  urls.push(`${u.origin}/.well-known/oauth-protected-resource`);
  return urls;
}

/** Authorization server metadata URLs in the order the MCP specification lists them. */
export function authServerMetadataUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, '');
  if (path === '') {
    return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
  }
  return [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    `${u.origin}/.well-known/openid-configuration${path}`,
    `${u.origin}${path}/.well-known/openid-configuration`,
  ];
}

/** Second-level labels under which country-code TLDs register names (`example.co.uk`). */
const CC_SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nic', 'mil', 'ltd', 'plc']);

/**
 * Approximate registrable domain ("site") of a host name, without the public suffix list: the
 * last two labels, or three under a country-code TLD with a typical second level (`co.uk`).
 * IP addresses and single-label hosts are their own site. Used only to call out a sign-in page on
 * another site; it can merge hosts under a shared public suffix (`a.github.io` / `b.github.io`),
 * so the UI shows both hosts as well.
 */
export function approximateSite(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || !h.includes('.')) return h;
  const labels = h.split('.');
  const n = labels.length;
  const tld = labels[n - 1] as string;
  const second = labels[n - 2] as string;
  const take = n >= 3 && tld.length === 2 && CC_SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * Problem with a URL from the network that the extension would contact, or null. Rules: the
 * endpoint rule (`https:`; `http:` only for localhost), no fragment, and no private / loopback /
 * intranet host unless the MCP server itself is on one.
 */
export function oauthUrlProblem(raw: string, serverUrl: string): string | null {
  const basic = endpointUrlProblem(raw);
  if (basic) return basic;
  const u = new URL(raw);
  if (u.hash !== '') return 'must not contain a fragment';
  let server: URL;
  try {
    server = new URL(serverUrl);
  } catch {
    return 'invalid server URL';
  }
  if (blockedHostReason(u) !== null && blockedHostReason(server) === null) {
    return `${u.hostname} is a private or local address, but the MCP server is not`;
  }
  return null;
}

function requireUrl(value: unknown, field: string, http: OAuthHttp): string {
  if (typeof value !== 'string' || value === '' || value.length > 2048) {
    throw new OAuthError('invalid', `The authorization server metadata has no valid "${field}"`);
  }
  const problem = oauthUrlProblem(value, http.serverUrl);
  if (problem) throw new OAuthError('invalid', `The authorization server's ${field} is not acceptable: ${problem}`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

interface JsonResponse {
  status: number;
  json: unknown;
}

async function oauthFetch(url: string, init: RequestInit, http: OAuthHttp): Promise<Response> {
  const problem = oauthUrlProblem(url, http.serverUrl);
  if (problem) throw new OAuthError('invalid', `Refusing to contact ${safeHost(url)}: ${problem}`);
  const doFetch = http.fetch ?? ((input: string, i: RequestInit) => globalThis.fetch(input, i));
  let res: Response;
  try {
    res = await doFetch(url, {
      ...init,
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(http.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new OAuthError('network', timeout ? `${safeHost(url)} did not answer in time` : `Could not reach ${safeHost(url)}`, { cause: err });
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    void res.body?.cancel().catch(() => undefined);
    throw new OAuthError('http', `${safeHost(url)} answered with a redirect, which is not followed`, { status: res.status || 302 });
  }
  return res;
}

/** Read a JSON body (any status), capped. Throws on a non-JSON body. */
async function readJson(res: Response, what: string): Promise<JsonResponse> {
  const text = await readCapped(res, OAUTH_LIMITS.maxResponseBytes);
  try {
    return { status: res.status, json: JSON.parse(text) as unknown };
  } catch {
    throw new OAuthError('invalid', `${what}: the response is not JSON (HTTP ${res.status})`, { status: res.status });
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => undefined);
      throw new OAuthError('invalid', 'The response is too large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** GET a JSON document. Returns null on 404 / 410; throws on other failures. */
async function getJsonDocument(url: string, http: OAuthHttp, what: string): Promise<unknown> {
  const res = await oauthFetch(url, { method: 'GET', headers: { Accept: 'application/json' } }, http);
  if (res.status === 404 || res.status === 410) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => undefined);
    throw new OAuthError('http', `${what}: HTTP ${res.status} from ${safeHost(url)}`, { status: res.status });
  }
  return (await readJson(res, what)).json;
}

// ---------------------------------------------------------------------------------------------
// Protected resource metadata (RFC 9728)
// ---------------------------------------------------------------------------------------------

export interface ProtectedResourceMetadata {
  resource: string;
  authorizationServers: string[];
  scopesSupported?: string[];
  /** Where the document was fetched from. */
  url: string;
}

/** Validate a protected resource metadata document against the server URL. Exported for discovery + tests. */
export function parseProtectedResourceMetadata(json: unknown, serverUrl: string, url: string): ProtectedResourceMetadata {
  if (!isRecord(json)) throw new OAuthError('invalid', 'The protected resource metadata is not a JSON object');
  const resource = json.resource;
  if (typeof resource !== 'string' || resource.length > 2048) {
    throw new OAuthError('invalid', 'The protected resource metadata has no "resource"');
  }
  if (!resourceMatches(resource, serverUrl)) {
    throw new OAuthError('invalid', `The protected resource metadata is for ${cleanText(resource, 200)}, not for this server`);
  }
  const servers = Array.isArray(json.authorization_servers)
    ? json.authorization_servers.filter((v): v is string => typeof v === 'string' && v.length <= 2048).slice(0, OAUTH_LIMITS.maxAuthorizationServers)
    : [];
  if (servers.length === 0) throw new OAuthError('invalid', 'The protected resource metadata lists no authorization server');
  const out: ProtectedResourceMetadata = { resource, authorizationServers: servers, url };
  const scopes = scopeArray(json.scopes_supported);
  if (scopes) out.scopesSupported = scopes;
  return out;
}

/**
 * Find the server's protected resource metadata: the `resource_metadata` URL from its
 * `WWW-Authenticate` challenge when given, otherwise (or when that fails) the well-known URLs.
 */
export async function fetchProtectedResourceMetadata(
  serverUrl: string,
  options: { resourceMetadataUrl?: string | undefined },
  http: OAuthHttp,
): Promise<ProtectedResourceMetadata> {
  const candidates: string[] = [];
  if (options.resourceMetadataUrl) {
    try {
      candidates.push(new URL(options.resourceMetadataUrl, serverUrl).href);
    } catch {
      // ignore a malformed header value; fall back to the well-known URLs
    }
  }
  for (const u of protectedResourceMetadataUrls(serverUrl)) if (!candidates.includes(u)) candidates.push(u);
  let firstError: unknown;
  for (const url of candidates) {
    try {
      const json = await getJsonDocument(url, http, 'Protected resource metadata');
      if (json === null) continue;
      return parseProtectedResourceMetadata(json, serverUrl, url);
    } catch (err) {
      firstError ??= err;
    }
  }
  if (firstError instanceof CcError) throw firstError;
  throw new OAuthError(
    'invalid',
    'This server does not publish OAuth protected resource metadata (RFC 9728), so the extension cannot find where to sign in.',
  );
}

// ---------------------------------------------------------------------------------------------
// Authorization server metadata (RFC 8414 / OIDC discovery)
// ---------------------------------------------------------------------------------------------

export interface AuthServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  scopesSupported?: string[];
  tokenEndpointAuthMethods?: string[];
  /** RFC 9207: the authorization response carries `iss`, which must then be present. */
  issParameterSupported: boolean;
  clientIdMetadataDocumentSupported: boolean;
}

/** Validate an authorization server metadata document. `issuer` is the identifier the URL was built from. */
export function parseAuthServerMetadata(json: unknown, issuer: string, http: OAuthHttp): AuthServerMetadata {
  if (!isRecord(json)) throw new OAuthError('invalid', 'The authorization server metadata is not a JSON object');
  if (json.issuer !== issuer) {
    throw new OAuthError(
      'invalid',
      `The authorization server metadata names a different issuer (${cleanText(String(json.issuer), 200)} instead of ${issuer}); it was not used.`,
    );
  }
  const methods = stringArray(json.code_challenge_methods_supported);
  if (!methods.includes('S256')) {
    throw new OAuthError(
      'invalid',
      'The authorization server does not advertise PKCE with S256 (code_challenge_methods_supported), which MCP requires.',
    );
  }
  const responseTypes = json.response_types_supported;
  if (responseTypes !== undefined && !stringArray(responseTypes).includes('code')) {
    throw new OAuthError('invalid', 'The authorization server does not support the authorization code flow');
  }
  const grants = json.grant_types_supported;
  if (grants !== undefined && !stringArray(grants).includes('authorization_code')) {
    throw new OAuthError('invalid', 'The authorization server does not support the authorization code grant');
  }
  const out: AuthServerMetadata = {
    issuer,
    authorizationEndpoint: requireUrl(json.authorization_endpoint, 'authorization_endpoint', http),
    tokenEndpoint: requireUrl(json.token_endpoint, 'token_endpoint', http),
    issParameterSupported: json.authorization_response_iss_parameter_supported === true,
    clientIdMetadataDocumentSupported: json.client_id_metadata_document_supported === true,
  };
  if (json.registration_endpoint !== undefined) out.registrationEndpoint = requireUrl(json.registration_endpoint, 'registration_endpoint', http);
  if (json.revocation_endpoint !== undefined) out.revocationEndpoint = requireUrl(json.revocation_endpoint, 'revocation_endpoint', http);
  const scopes = scopeArray(json.scopes_supported);
  if (scopes) out.scopesSupported = scopes;
  const auth = json.token_endpoint_auth_methods_supported;
  if (auth !== undefined) out.tokenEndpointAuthMethods = stringArray(auth);
  return out;
}

/** Fetch + validate the metadata of one authorization server (issuer identifier from the PRM). */
export async function fetchAuthServerMetadata(issuer: string, http: OAuthHttp): Promise<AuthServerMetadata> {
  const problem = oauthUrlProblem(issuer, http.serverUrl);
  if (problem) throw new OAuthError('invalid', `The authorization server ${cleanText(issuer, 200)} is not acceptable: ${problem}`);
  const u = new URL(issuer);
  if (u.search !== '') throw new OAuthError('invalid', 'The authorization server identifier must not contain a query');
  let firstError: unknown;
  for (const url of authServerMetadataUrls(issuer)) {
    try {
      const json = await getJsonDocument(url, http, 'Authorization server metadata');
      if (json === null) continue;
      return parseAuthServerMetadata(json, issuer, http);
    } catch (err) {
      firstError ??= err;
    }
  }
  if (firstError instanceof CcError) throw firstError;
  throw new OAuthError('invalid', `No authorization server metadata found for ${cleanText(issuer, 200)}`);
}

/** The first listed authorization server whose metadata validates. */
export async function discoverAuthServer(prm: ProtectedResourceMetadata, http: OAuthHttp): Promise<AuthServerMetadata> {
  let firstError: unknown;
  for (const issuer of prm.authorizationServers) {
    try {
      return await fetchAuthServerMetadata(issuer, http);
    } catch (err) {
      firstError ??= err;
    }
  }
  throw firstError instanceof Error ? firstError : new OAuthError('invalid', 'No usable authorization server');
}

// ---------------------------------------------------------------------------------------------
// Client registration (RFC 7591)
// ---------------------------------------------------------------------------------------------

export type ClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

export interface OAuthClient {
  clientId: string;
  /** Only when the authorization server insisted on one (we register as a public client). */
  clientSecret?: string;
  authMethod: ClientAuthMethod;
  redirectUri: string;
  source: 'manual' | 'dynamic';
  /** The issuer this client id belongs to (credentials are bound to their authorization server). */
  issuer: string;
}

/** Register as a public client with the chromiumapp redirect URI. */
export async function registerClient(
  asm: AuthServerMetadata,
  options: { redirectUri: string; clientName: string; scope?: string | undefined },
  http: OAuthHttp,
): Promise<OAuthClient> {
  if (!asm.registrationEndpoint) throw new OAuthError('invalid', 'The authorization server does not support dynamic client registration');
  const body: Record<string, unknown> = {
    client_name: options.clientName,
    redirect_uris: [options.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    // The redirect URI is an https URL on a public host (chromiumapp.org), which OpenID's rules
    // classify as a web client (native clients use custom schemes or loopback).
    application_type: 'web',
  };
  if (options.scope) body.scope = options.scope;
  const res = await oauthFetch(
    asm.registrationEndpoint,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
    http,
  );
  const { status, json } = await readJson(res, 'Client registration');
  if (status !== 200 && status !== 201) throw oauthErrorFrom(json, status, 'Client registration failed');
  if (!isRecord(json)) throw new OAuthError('invalid', 'Client registration: the response is not a JSON object');
  const clientId = json.client_id;
  if (typeof clientId !== 'string' || !/^[\x21-\x7e]+$/.test(clientId) || clientId.length > OAUTH_LIMITS.maxClientIdChars) {
    throw new OAuthError('invalid', 'Client registration: the response has no valid client_id');
  }
  const uris = json.redirect_uris;
  if (uris !== undefined && !stringArray(uris).includes(options.redirectUri)) {
    throw new OAuthError('invalid', 'Client registration: the authorization server changed the redirect URI');
  }
  const method = json.token_endpoint_auth_method;
  const client: OAuthClient = { clientId, authMethod: 'none', redirectUri: options.redirectUri, source: 'dynamic', issuer: asm.issuer };
  const secret = json.client_secret;
  if ((method === 'client_secret_post' || method === 'client_secret_basic') && typeof secret === 'string' && secret.length <= OAUTH_LIMITS.maxTokenChars) {
    client.authMethod = method;
    client.clientSecret = secret;
  }
  return client;
}

// ---------------------------------------------------------------------------------------------
// Authorization request / response
// ---------------------------------------------------------------------------------------------

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** RFC 7636: 32 random bytes as base64url (43 chars), challenge = BASE64URL(SHA-256(verifier)). */
export async function createPkce(): Promise<Pkce> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** 128-bit random `state`. */
export function randomState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export function buildAuthorizationUrl(
  asm: AuthServerMetadata,
  p: { clientId: string; redirectUri: string; state: string; codeChallenge: string; resource: string; scope?: string | undefined },
): string {
  const u = new URL(asm.authorizationEndpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('resource', p.resource);
  if (p.scope) u.searchParams.set('scope', p.scope);
  return u.href;
}

/**
 * Validate the URL the browser was redirected to and return the authorization code. Order
 * matters: `iss` first (RFC 9207 mix-up defence: on a mismatch nothing else in the response,
 * not even `error`, is used), then `state`, then `error`, then `code`.
 */
export function parseAuthorizationResponse(
  responseUrl: string,
  expected: { redirectUri: string; state: string; issuer: string; issRequired: boolean },
): string {
  let u: URL;
  try {
    u = new URL(responseUrl);
  } catch {
    throw new OAuthError('invalid', 'The sign-in returned an invalid address');
  }
  const r = new URL(expected.redirectUri);
  if (u.origin !== r.origin || u.pathname !== r.pathname) {
    throw new OAuthError('invalid', 'The sign-in finished on an unexpected address');
  }
  let params = u.searchParams;
  if (!params.has('state') && !params.has('code') && !params.has('error') && u.hash.length > 1) {
    params = new URLSearchParams(u.hash.slice(1));
  }
  const iss = params.get('iss');
  if (iss !== null) {
    if (iss !== expected.issuer) {
      throw new OAuthError('invalid', 'The sign-in response came from a different authorization server (issuer mismatch) and was rejected.');
    }
  } else if (expected.issRequired) {
    throw new OAuthError('invalid', 'The sign-in response did not name its authorization server (missing "iss") and was rejected.');
  }
  if (params.get('state') !== expected.state) {
    throw new OAuthError('invalid', 'The sign-in response does not belong to this sign-in (state mismatch) and was rejected.');
  }
  const error = params.get('error');
  if (error !== null) {
    const desc = params.get('error_description');
    const text = error === 'access_denied' ? 'Access was denied' : `The authorization server refused the sign-in (${cleanText(error, 64)})`;
    throw new OAuthError('http', desc ? `${text}: ${cleanText(desc, 300)}` : text, { oauthError: cleanText(error, 64) });
  }
  const code = params.get('code');
  if (!code || code.length > OAUTH_LIMITS.maxCodeChars) throw new OAuthError('invalid', 'The sign-in response has no authorization code');
  return code;
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch. */
  expiresAt?: number;
  scope?: string;
}

/** Token endpoints the client needs after sign-in (kept with the tokens). */
export interface TokenEndpoints {
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
}

const MAX_EXPIRES_IN_S = 366 * 24 * 3600;

/** Validate a token endpoint success response. */
export function parseTokenResponse(json: unknown, now: number): TokenSet {
  if (!isRecord(json)) throw new OAuthError('invalid', 'Token response: not a JSON object');
  const access = json.access_token;
  if (typeof access !== 'string' || access === '' || access.length > OAUTH_LIMITS.maxTokenChars || !/^[\x21-\x7e]+$/.test(access)) {
    throw new OAuthError('invalid', 'Token response: no valid access_token');
  }
  if (typeof json.token_type !== 'string' || json.token_type.toLowerCase() !== 'bearer') {
    throw new OAuthError('invalid', 'Token response: only Bearer tokens are supported');
  }
  const out: TokenSet = { accessToken: access };
  const refresh = json.refresh_token;
  if (typeof refresh === 'string' && refresh !== '' && refresh.length <= OAUTH_LIMITS.maxTokenChars && /^[\x20-\x7e]+$/.test(refresh)) {
    out.refreshToken = refresh;
  }
  const raw = typeof json.expires_in === 'string' && /^\d{1,10}$/.test(json.expires_in) ? Number(json.expires_in) : json.expires_in;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) out.expiresAt = now + Math.min(raw, MAX_EXPIRES_IN_S) * 1000;
  if (typeof json.scope === 'string' && isScopeString(json.scope)) out.scope = normalizeScope(json.scope);
  return out;
}

async function tokenRequest(
  endpoints: TokenEndpoints,
  client: OAuthClient,
  form: Record<string, string>,
  http: OAuthHttp,
  now: number,
): Promise<TokenSet> {
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  applyClientAuth(client, body, headers);
  const res = await oauthFetch(endpoints.tokenEndpoint, { method: 'POST', headers, body: body.toString() }, http);
  const { status, json } = await readJson(res, 'Token request');
  if (status !== 200) throw oauthErrorFrom(json, status, 'The token request failed');
  return parseTokenResponse(json, now);
}

export function exchangeCode(
  endpoints: TokenEndpoints,
  client: OAuthClient,
  p: { code: string; verifier: string; resource: string },
  http: OAuthHttp,
  now: number,
): Promise<TokenSet> {
  return tokenRequest(
    endpoints,
    client,
    { grant_type: 'authorization_code', code: p.code, redirect_uri: client.redirectUri, code_verifier: p.verifier, resource: p.resource },
    http,
    now,
  );
}

export async function refreshTokens(
  endpoints: TokenEndpoints,
  client: OAuthClient,
  p: { refreshToken: string; resource: string },
  http: OAuthHttp,
  now: number,
): Promise<TokenSet> {
  const tokens = await tokenRequest(endpoints, client, { grant_type: 'refresh_token', refresh_token: p.refreshToken, resource: p.resource }, http, now);
  // The server may rotate the refresh token, or keep the old one valid (RFC 6749 §6).
  if (!tokens.refreshToken) tokens.refreshToken = p.refreshToken;
  return tokens;
}

/** RFC 7009. Best effort: resolves false when it did not work. */
export async function revokeToken(
  endpoints: TokenEndpoints,
  client: OAuthClient,
  token: string,
  hint: 'access_token' | 'refresh_token',
  http: OAuthHttp,
): Promise<boolean> {
  if (!endpoints.revocationEndpoint) return false;
  const body = new URLSearchParams({ token, token_type_hint: hint });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  applyClientAuth(client, body, headers);
  try {
    const res = await oauthFetch(endpoints.revocationEndpoint, { method: 'POST', headers, body: body.toString() }, http);
    void res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

function applyClientAuth(client: OAuthClient, body: URLSearchParams, headers: Record<string, string>): void {
  if (client.authMethod === 'client_secret_basic' && client.clientSecret !== undefined) {
    const enc = (v: string): string => encodeURIComponent(v).replace(/%20/g, '+');
    headers.Authorization = `Basic ${btoa(`${enc(client.clientId)}:${enc(client.clientSecret)}`)}`;
    return;
  }
  body.set('client_id', client.clientId);
  if (client.authMethod === 'client_secret_post' && client.clientSecret !== undefined) body.set('client_secret', client.clientSecret);
}

function oauthErrorFrom(json: unknown, status: number, fallback: string): OAuthError {
  if (isRecord(json) && typeof json.error === 'string') {
    const code = cleanText(json.error, 64);
    const desc = typeof json.error_description === 'string' ? `: ${cleanText(json.error_description, 300)}` : '';
    return new OAuthError('http', `${fallback} (${code})${desc}`, { status, oauthError: code });
  }
  return new OAuthError('http', `${fallback} (HTTP ${status})`, { status });
}

// ---------------------------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------------------------

const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

function isScopeString(value: string): boolean {
  if (value.length > OAUTH_LIMITS.maxScopeChars) return false;
  return value.trim().split(/ +/).every((s) => s === '' || SCOPE_TOKEN.test(s));
}

function normalizeScope(value: string): string {
  return [...new Set(value.trim().split(/ +/).filter(Boolean))].join(' ');
}

/** The valid scope tokens of a space-separated scope string, order kept, duplicates dropped. */
export function splitScope(value: string | undefined): string[] {
  return unionScopes(value)?.split(' ') ?? [];
}

/** Union of scope strings (space-separated), order kept, duplicates dropped. */
export function unionScopes(...values: (string | undefined)[]): string | undefined {
  const all = new Set<string>();
  for (const v of values) if (v) for (const s of v.trim().split(/ +/)) if (s && SCOPE_TOKEN.test(s)) all.add(s);
  const out = [...all].join(' ');
  return out === '' ? undefined : out.slice(0, OAUTH_LIMITS.maxScopeChars);
}

function scopeArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((s): s is string => typeof s === 'string' && SCOPE_TOKEN.test(s)).slice(0, OAUTH_LIMITS.maxScopes);
  return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 100) : [];
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the server';
  }
}
