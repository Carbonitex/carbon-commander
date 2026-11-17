/**
 * Mock OAuth 2.1 authorization server + protected resource metadata for an MCP server, for unit
 * tests (in-process `handle`) and the end-to-end test (`startOAuthMcpSite` serves the AS, the
 * metadata and an OAuth-protected mock MCP server on one local origin, like a typical MCP site).
 *
 * Implements: RFC 8414 metadata (or OIDC discovery), RFC 9728 protected resource metadata,
 * RFC 7591 registration (public clients), /authorize (auto-approve, or a consent page with an
 * "Allow" link), the authorization_code (PKCE S256 checked) and refresh_token grants (rotating
 * refresh tokens), RFC 7009 revocation, RFC 9207 `iss`. Tokens are bound to the `resource`.
 */
import { serveFetch } from './http-server';
import { createMockMcpServer, type MockMcpOptions, type MockMcpServer } from './mock-mcp-server';

export interface MockOAuthOptions {
  /** Issuer identifier, e.g. `https://auth.example.com` (no trailing slash). */
  issuer: string;
  /** The MCP endpoint (protected resource). */
  resource: string;
  scopesSupported?: string[];
  /** Access token lifetime. Default 3600 s. */
  accessTokenTtlS?: number;
  /** Default true. */
  refreshTokens?: boolean;
  /** Default true. */
  registration?: boolean;
  /** Default true. */
  revocation?: boolean;
  /** Advertise + send `iss` (RFC 9207). Default true. */
  issParameter?: boolean;
  /** Metadata `issuer` override (mix-up tests). */
  metadataIssuer?: string;
  /** `code_challenge_methods_supported`; null = omit. Default ['S256']. */
  pkceMethods?: string[] | null;
  /** Which metadata document exists. Default `oauth`. */
  metadataKind?: 'oauth' | 'oidc';
  /** Where the protected resource metadata is served. Default `root`. */
  prmAt?: 'root' | 'path';
  /** `resource` value in the PRM (default = `resource`). */
  prmResource?: string;
  /** Auto-approve (302 straight back) or show a consent page with an "Allow" link. Default auto. */
  consent?: 'auto' | 'page';
  /** Tool name -> scope it needs (403 insufficient_scope otherwise). */
  toolScopes?: Record<string, string>;
  /** `scope` in the 401 challenge: default `scopesSupported` joined (when given); null = none. */
  challengeScope?: string | null;
  /** `authorization_endpoint` override (another host, e.g. a sign-in page on another site). */
  authorizationEndpoint?: string;
}

export interface IssuedToken {
  scope: string;
  resource: string;
  clientId: string;
  expiresAt: number;
}

export interface MockOAuthServer {
  handle(request: Request): Promise<Response | null>;
  /** For `MockMcpOptions.authorize`: 401 / 403 unless the bearer token is valid (and scoped). */
  authorize: NonNullable<MockMcpOptions['authorize']>;
  /** Unit tests: run GET /authorize in-process and return where it redirects (the "browser"). */
  approve(url: string): Promise<string>;
  readonly clients: Map<string, { redirectUris: string[]; name: string }>;
  readonly accessTokens: Map<string, IssuedToken>;
  readonly refreshTokens: Map<string, IssuedToken>;
  readonly revoked: string[];
  readonly requests: { method: string; path: string; form?: Record<string, string>; json?: unknown }[];
  /** Expire every access token now (refresh still works). */
  expireAccessTokens(): void;
  /** Invalidate everything (refresh fails with invalid_grant). */
  revokeAll(): void;
  options: MockOAuthOptions;
  readonly prmUrl: string;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  resource: string;
}

export function createMockOAuthServer(options: MockOAuthOptions): MockOAuthServer {
  const issuer = options.issuer;
  const iss = new URL(issuer);
  const res = new URL(options.resource);
  const prmUrl =
    options.prmAt === 'path' ? `${res.origin}/.well-known/oauth-protected-resource${res.pathname}` : `${res.origin}/.well-known/oauth-protected-resource`;
  const clients = new Map<string, { redirectUris: string[]; name: string }>();
  const codes = new Map<string, PendingCode>();
  const accessTokens = new Map<string, IssuedToken>();
  const refreshTokens = new Map<string, IssuedToken>();
  const revoked: string[] = [];
  const requests: MockOAuthServer['requests'] = [];
  let counter = 0;
  const next = (prefix: string): string => `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 10)}`;
  const issParam = options.issParameter !== false;

  const metadata = (): Record<string, unknown> => {
    const m: Record<string, unknown> = {
      issuer: options.metadataIssuer ?? issuer,
      authorization_endpoint: options.authorizationEndpoint ?? `${iss.origin}/oauth/authorize`,
      token_endpoint: `${iss.origin}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: options.scopesSupported ?? ['read', 'write'],
    };
    if (options.pkceMethods !== null) m.code_challenge_methods_supported = options.pkceMethods ?? ['S256'];
    if (options.registration !== false) m.registration_endpoint = `${iss.origin}/oauth/register`;
    if (options.revocation !== false) m.revocation_endpoint = `${iss.origin}/oauth/revoke`;
    if (issParam) m.authorization_response_iss_parameter_supported = true;
    return m;
  };

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const oauthError = (error: string, status = 400, description?: string): Response =>
    json(description ? { error, error_description: description } : { error }, status);

  async function sha256b64url(text: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    let bin = '';
    for (const b of digest) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function issue(clientId: string, scope: string, resource: string): Record<string, unknown> {
    const ttl = options.accessTokenTtlS ?? 3600;
    const access = next('at');
    const info: IssuedToken = { scope, resource, clientId, expiresAt: Date.now() + ttl * 1000 };
    accessTokens.set(access, info);
    const out: Record<string, unknown> = { access_token: access, token_type: 'Bearer', expires_in: ttl, scope };
    if (options.refreshTokens !== false) {
      const refresh = next('rt');
      refreshTokens.set(refresh, { ...info, expiresAt: Number.MAX_SAFE_INTEGER });
      out.refresh_token = refresh;
    }
    return out;
  }

  function authorizeRequest(url: URL): Response {
    const p = url.searchParams;
    const clientId = p.get('client_id') ?? '';
    const redirectUri = p.get('redirect_uri') ?? '';
    const client = clients.get(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) return new Response('unknown client or redirect_uri', { status: 400 });
    if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
      return new Response('bad request', { status: 400 });
    }
    const back = new URL(redirectUri);
    if (p.get('resource') !== options.resource.replace(/\/+$/, '')) {
      back.searchParams.set('error', 'invalid_target');
    } else {
      const code = next('code');
      codes.set(code, {
        clientId,
        redirectUri,
        challenge: p.get('code_challenge') ?? '',
        scope: p.get('scope') ?? '',
        resource: p.get('resource') ?? '',
      });
      back.searchParams.set('code', code);
    }
    back.searchParams.set('state', p.get('state') ?? '');
    if (issParam) back.searchParams.set('iss', issuer);
    if (options.consent === 'page' && url.searchParams.get('approved') !== '1') {
      const approveUrl = new URL(url);
      approveUrl.searchParams.set('approved', '1');
      // The consent page: "Allow" re-requests /authorize with approved=1 (that issues the code).
      codes.delete(back.searchParams.get('code') ?? '');
      return new Response(
        `<!doctype html><html><head><title>Consent</title></head><body><h1>Allow Carbon Commander?</h1><p>Scopes: ${escapeHtml(p.get('scope') ?? '')}</p><a id="allow" href="${escapeHtml(approveUrl.href)}">Allow</a></body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    return new Response(null, { status: 302, headers: { Location: back.href } });
  }

  async function token(form: Record<string, string>): Promise<Response> {
    const clientId = form.client_id ?? '';
    if (!clients.has(clientId)) return oauthError('invalid_client', 401);
    if (form.grant_type === 'authorization_code') {
      const pending = codes.get(form.code ?? '');
      codes.delete(form.code ?? '');
      if (!pending || pending.clientId !== clientId || pending.redirectUri !== form.redirect_uri) return oauthError('invalid_grant');
      if ((await sha256b64url(form.code_verifier ?? '')) !== pending.challenge) return oauthError('invalid_grant', 400, 'PKCE verification failed');
      if (form.resource !== pending.resource) return oauthError('invalid_target');
      return json(issue(clientId, pending.scope, pending.resource));
    }
    if (form.grant_type === 'refresh_token') {
      const info = refreshTokens.get(form.refresh_token ?? '');
      if (!info || info.clientId !== clientId) return oauthError('invalid_grant');
      if (form.resource !== undefined && form.resource !== info.resource) return oauthError('invalid_target');
      refreshTokens.delete(form.refresh_token ?? ''); // rotation
      return json(issue(clientId, info.scope, info.resource));
    }
    return oauthError('unsupported_grant_type');
  }

  async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname;
    const entry: MockOAuthServer['requests'][number] = { method: request.method, path };
    const isOurs =
      (url.origin === res.origin && path.startsWith('/.well-known/oauth-protected-resource')) ||
      (url.origin === iss.origin && (path.startsWith('/.well-known/') || path.startsWith('/oauth/')));
    if (!isOurs) return null;
    requests.push(entry);
    if (url.origin === res.origin && request.method === 'GET' && `${url.origin}${path}` === prmUrl) {
      return json({
        resource: options.prmResource ?? options.resource,
        authorization_servers: [issuer],
        scopes_supported: options.scopesSupported ?? ['read', 'write'],
        bearer_methods_supported: ['header'],
      });
    }
    const issPath = iss.pathname.replace(/\/+$/, '');
    if (request.method === 'GET' && options.metadataKind !== 'oidc' && path === `/.well-known/oauth-authorization-server${issPath}`) {
      return json(metadata());
    }
    if (request.method === 'GET' && options.metadataKind === 'oidc' && path === `/.well-known/openid-configuration${issPath}`) {
      return json(metadata());
    }
    if (path === '/oauth/register' && request.method === 'POST' && options.registration !== false) {
      const body = (await request.json()) as Record<string, unknown>;
      entry.json = body;
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
      if (uris.length === 0) return oauthError('invalid_redirect_uri');
      const clientId = next('client');
      clients.set(clientId, { redirectUris: uris, name: typeof body.client_name === 'string' ? body.client_name : '' });
      return json({ client_id: clientId, redirect_uris: uris, token_endpoint_auth_method: 'none', client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
    }
    if (path === '/oauth/authorize' && request.method === 'GET') return authorizeRequest(url);
    if (path === '/oauth/token' && request.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(await request.text()));
      entry.form = form;
      return token(form);
    }
    if (path === '/oauth/revoke' && request.method === 'POST' && options.revocation !== false) {
      const form = Object.fromEntries(new URLSearchParams(await request.text()));
      entry.form = form;
      const t = form.token ?? '';
      revoked.push(t);
      accessTokens.delete(t);
      refreshTokens.delete(t);
      return new Response(null, { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  }

  const challenge = (extra = ''): string => `Bearer resource_metadata="${prmUrl}"${extra}`;

  const authorize: MockOAuthServer['authorize'] = ({ headers, rpcMethod, params }) => {
    const auth = headers.authorization ?? '';
    const m = /^Bearer (.+)$/.exec(auth);
    const info = m ? accessTokens.get(m[1] ?? '') : undefined;
    const hinted = options.challengeScope === undefined ? options.scopesSupported?.join(' ') : options.challengeScope;
    const scopeHint = hinted ? `, scope="${hinted}"` : '';
    if (!info || info.expiresAt <= Date.now() || info.resource !== options.resource.replace(/\/+$/, '')) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge(info ? ', error="invalid_token"' : scopeHint) },
      });
    }
    if (rpcMethod === 'tools/call' && params && typeof params.name === 'string') {
      const needed = options.toolScopes?.[params.name];
      if (needed && !info.scope.split(' ').includes(needed)) {
        return new Response(JSON.stringify({ error: 'insufficient_scope' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge(`, error="insufficient_scope", scope="${needed}"`) },
        });
      }
    }
    return null;
  };

  return {
    handle,
    authorize,
    async approve(url) {
      const r = await handle(new Request(url));
      const loc = r?.headers.get('location');
      if (!r || r.status !== 302 || !loc) throw new Error(`authorize did not redirect (HTTP ${r?.status ?? 'none'})`);
      return loc;
    },
    clients,
    accessTokens,
    refreshTokens,
    revoked,
    requests,
    expireAccessTokens() {
      for (const t of accessTokens.values()) t.expiresAt = 0;
    },
    revokeAll() {
      accessTokens.clear();
      refreshTokens.clear();
    },
    options,
    prmUrl,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------------------------------------------------------------------------------------------
// One local origin: AS + protected resource metadata + OAuth-protected MCP server (e2e)
// ---------------------------------------------------------------------------------------------

export interface RunningOAuthMcpSite {
  origin: string;
  /** `${origin}/mcp` */
  mcpUrl: string;
  oauth: MockOAuthServer;
  mcp: MockMcpServer;
  close(): Promise<void>;
}

/**
 * Like a site that publishes only protected resource metadata: `/.well-known/oauth-protected-resource`
 * -> `{ resource: <origin>/mcp, authorization_servers: [<origin>] }`, `POST /mcp` answers 401 with a
 * `resource_metadata` challenge until signed in. The origin is only known after listening, so the
 * servers are created lazily on the first request.
 */
export async function startOAuthMcpSite(
  options: Partial<Omit<MockOAuthOptions, 'issuer' | 'resource'>> & { mcp?: MockMcpOptions; page?: string } = {},
): Promise<RunningOAuthMcpSite> {
  let site: { oauth: MockOAuthServer; mcp: MockMcpServer } | null = null;
  let origin = '';
  const init = (): { oauth: MockOAuthServer; mcp: MockMcpServer } => {
    if (site) return site;
    const oauth = createMockOAuthServer({ ...options, issuer: origin, resource: `${origin}/mcp` });
    const mcp = createMockMcpServer({ ...options.mcp, authorize: oauth.authorize });
    site = { oauth, mcp };
    return site;
  };
  const running = await serveFetch(async (request) => {
    const s = init();
    const path = new URL(request.url).pathname;
    if (path === '/mcp') return s.mcp.handle(request);
    if (path === '/' || path === '/index.html') {
      return new Response(options.page ?? '<!doctype html><title>OAuth MCP site</title><h1>A site with an OAuth MCP server</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return (await s.oauth.handle(request)) ?? new Response('Not found', { status: 404 });
  });
  origin = running.origin;
  const s = init();
  return { origin, mcpUrl: `${origin}/mcp`, oauth: s.oauth, mcp: s.mcp, close: () => running.close() };
}
