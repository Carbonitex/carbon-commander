import { describe, expect, it } from 'vitest';
import {
  OAuthError,
  authServerMetadataUrls,
  bearerChallenge,
  buildAuthorizationUrl,
  canonicalResourceUrl,
  createPkce,
  discoverAuthServer,
  exchangeCode,
  fetchAuthServerMetadata,
  fetchProtectedResourceMetadata,
  oauthUrlProblem,
  parseAuthorizationResponse,
  parseTokenResponse,
  parseWwwAuthenticate,
  protectedResourceMetadataUrls,
  randomState,
  refreshTokens,
  registerClient,
  resourceMatches,
  revokeToken,
  unionScopes,
  type AuthServerMetadata,
  type OAuthHttp,
} from '../../src/mcp/oauth';
import { createMockOAuthServer, type MockOAuthOptions } from '../helpers/mock-oauth-server';

const SERVER = 'https://mcp.example.com/mcp';
const ISSUER = 'https://auth.example.com';
const REDIRECT = 'https://abcdefghijklmnop.chromiumapp.org/mcp-oauth';

function fetchFrom(handler: (r: Request) => Promise<Response | null>, log: string[] = []): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    log.push(`${request.method} ${request.url}`);
    return (await handler(request)) ?? new Response('Not found', { status: 404 });
  };
}

function setup(options: Partial<MockOAuthOptions> = {}) {
  const as = createMockOAuthServer({ issuer: ISSUER, resource: SERVER, ...options });
  const log: string[] = [];
  const http: OAuthHttp = { serverUrl: SERVER, fetch: fetchFrom((r) => as.handle(r), log) };
  return { as, http, log };
}

describe('WWW-Authenticate', () => {
  it('parses several challenges, quoted values and token68', () => {
    const c = parseWwwAuthenticate('Basic abc==, Bearer realm="x, y", resource_metadata="https://a.example/.well-known/oauth-protected-resource", scope="read write"');
    expect(c.map((x) => x.scheme)).toEqual(['basic', 'bearer']);
    expect(c[1]?.params).toEqual({ realm: 'x, y', resource_metadata: 'https://a.example/.well-known/oauth-protected-resource', scope: 'read write' });
  });

  it('extracts the Bearer challenge (error, scope, escaped quotes)', () => {
    expect(bearerChallenge('Bearer error="insufficient_scope", scope="files:write", error_description="needs \\"write\\""')).toEqual({
      error: 'insufficient_scope',
      scope: 'files:write',
      errorDescription: 'needs "write"',
    });
    expect(bearerChallenge('Basic realm="x"')).toBeNull();
    expect(bearerChallenge(null)).toBeNull();
    // Invalid scope characters are dropped rather than passed along.
    expect(bearerChallenge('Bearer scope="a\\"b"')?.scope).toBeUndefined();
  });
});

describe('URLs', () => {
  it('canonicalises resources', () => {
    expect(canonicalResourceUrl('HTTPS://MCP.Example.COM/mcp/#frag')).toBe('https://mcp.example.com/mcp');
    expect(canonicalResourceUrl('https://mcp.example.com/')).toBe('https://mcp.example.com');
    expect(canonicalResourceUrl('https://mcp.example.com:8443')).toBe('https://mcp.example.com:8443');
  });

  it('matches the protected resource to the server (RFC 9728)', () => {
    expect(resourceMatches('https://mcp.example.com/mcp', SERVER)).toBe(true);
    expect(resourceMatches('https://mcp.example.com/mcp/', SERVER)).toBe(true);
    expect(resourceMatches('https://mcp.example.com', SERVER)).toBe(true); // root protects /mcp
    expect(resourceMatches('https://mcp.example.com/other', SERVER)).toBe(false);
    expect(resourceMatches('https://mcp.example.com/mc', SERVER)).toBe(false); // not on a segment boundary
    expect(resourceMatches('https://evil.example.com/mcp', SERVER)).toBe(false);
    expect(resourceMatches('http://mcp.example.com/mcp', SERVER)).toBe(false);
  });

  it('builds the well-known URLs in the specified order', () => {
    expect(protectedResourceMetadataUrls('https://example.com/public/mcp')).toEqual([
      'https://example.com/.well-known/oauth-protected-resource/public/mcp',
      'https://example.com/.well-known/oauth-protected-resource',
    ]);
    expect(authServerMetadataUrls('https://auth.example.com')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ]);
    expect(authServerMetadataUrls('https://auth.example.com/tenant1')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1',
      'https://auth.example.com/.well-known/openid-configuration/tenant1',
      'https://auth.example.com/tenant1/.well-known/openid-configuration',
    ]);
  });

  it('accepts https and local http only, and no private hosts for a public server', () => {
    expect(oauthUrlProblem('https://auth.example.com/x', SERVER)).toBeNull();
    expect(oauthUrlProblem('http://auth.example.com/x', SERVER)).toMatch(/https/);
    expect(oauthUrlProblem('https://10.1.2.3/x', SERVER)).toMatch(/private/);
    expect(oauthUrlProblem('http://127.0.0.1:9/x', SERVER)).toMatch(/private/);
    expect(oauthUrlProblem('http://127.0.0.1:9/x', 'http://127.0.0.1:8/mcp')).toBeNull();
    expect(oauthUrlProblem('https://auth.example.com/x#f', SERVER)).toMatch(/fragment/);
  });
});

describe('protected resource metadata discovery', () => {
  it('uses the URL from the challenge first', async () => {
    const { as, http, log } = setup({ prmAt: 'path' });
    const prm = await fetchProtectedResourceMetadata(SERVER, { resourceMetadataUrl: as.prmUrl }, http);
    expect(prm.resource).toBe(SERVER);
    expect(prm.authorizationServers).toEqual([ISSUER]);
    expect(log).toEqual([`GET ${as.prmUrl}`]);
  });

  it('falls back to the path-aware, then the root well-known URL', async () => {
    const root = setup({ prmAt: 'root' });
    const prm = await fetchProtectedResourceMetadata(SERVER, {}, root.http);
    expect(prm.url).toBe('https://mcp.example.com/.well-known/oauth-protected-resource');
    expect(root.log).toEqual([
      'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
      'GET https://mcp.example.com/.well-known/oauth-protected-resource',
    ]);
    const path = setup({ prmAt: 'path' });
    expect((await fetchProtectedResourceMetadata(SERVER, {}, path.http)).url).toBe(path.as.prmUrl);
    expect(path.log).toHaveLength(1);
  });

  it('rejects metadata for another resource', async () => {
    const { http } = setup({ prmResource: 'https://mcp.example.com/other' });
    await expect(fetchProtectedResourceMetadata(SERVER, {}, http)).rejects.toThrow(/not for this server/);
  });

  it('explains when there is no metadata at all', async () => {
    const http: OAuthHttp = { serverUrl: SERVER, fetch: fetchFrom(async () => null) };
    await expect(fetchProtectedResourceMetadata(SERVER, {}, http)).rejects.toThrow(/does not publish OAuth protected resource metadata/);
  });

  it('does not follow redirects and caps sizes', async () => {
    const redirect: OAuthHttp = { serverUrl: SERVER, fetch: async () => new Response(null, { status: 302, headers: { Location: 'https://x.example' } }) };
    await expect(fetchProtectedResourceMetadata(SERVER, {}, redirect)).rejects.toThrow(/redirect/);
    const big: OAuthHttp = { serverUrl: SERVER, fetch: async () => new Response(`{"resource":"${'x'.repeat(70_000)}"}`, { headers: { 'Content-Type': 'application/json' } }) };
    await expect(fetchProtectedResourceMetadata(SERVER, {}, big)).rejects.toThrow(/too large/);
  });

  it('never sends cookies or follows redirects (fetch options)', async () => {
    const seen: RequestInit[] = [];
    const http: OAuthHttp = {
      serverUrl: SERVER,
      fetch: async (_i, init) => {
        seen.push(init ?? {});
        return new Response('{}', { status: 404 });
      },
    };
    await fetchProtectedResourceMetadata(SERVER, {}, http).catch(() => undefined);
    expect(seen.every((i) => i.credentials === 'omit' && i.redirect === 'manual')).toBe(true);
  });
});

describe('authorization server metadata', () => {
  it('validates issuer, PKCE and endpoints', async () => {
    const ok = setup();
    const asm = await fetchAuthServerMetadata(ISSUER, ok.http);
    expect(asm).toMatchObject({ issuer: ISSUER, tokenEndpoint: `${ISSUER}/oauth/token`, issParameterSupported: true });

    await expect(fetchAuthServerMetadata(ISSUER, setup({ metadataIssuer: 'https://evil.example.com' }).http)).rejects.toThrow(/different issuer/);
    await expect(fetchAuthServerMetadata(ISSUER, setup({ pkceMethods: null }).http)).rejects.toThrow(/PKCE/);
    await expect(fetchAuthServerMetadata(ISSUER, setup({ pkceMethods: ['plain'] }).http)).rejects.toThrow(/PKCE/);
  });

  it('falls back to OpenID discovery and handles path issuers', async () => {
    const oidc = setup({ metadataKind: 'oidc' });
    expect((await fetchAuthServerMetadata(ISSUER, oidc.http)).issuer).toBe(ISSUER);
    expect(oidc.log).toEqual([`GET ${ISSUER}/.well-known/oauth-authorization-server`, `GET ${ISSUER}/.well-known/openid-configuration`]);
    const tenant = setup({ issuer: `${ISSUER}/tenant1` });
    expect((await fetchAuthServerMetadata(`${ISSUER}/tenant1`, tenant.http)).issuer).toBe(`${ISSUER}/tenant1`);
  });

  it('refuses plain-http endpoints and private hosts', async () => {
    const http: OAuthHttp = {
      serverUrl: SERVER,
      fetch: async () =>
        Response.json({
          issuer: ISSUER,
          authorization_endpoint: 'http://auth.example.com/authorize',
          token_endpoint: `${ISSUER}/token`,
          code_challenge_methods_supported: ['S256'],
        }),
    };
    await expect(fetchAuthServerMetadata(ISSUER, http)).rejects.toThrow(/authorization_endpoint is not acceptable/);
    await expect(fetchAuthServerMetadata('https://192.168.1.2', { serverUrl: SERVER, fetch: async () => new Response('') })).rejects.toThrow(/private/);
  });

  it('picks the first authorization server that validates', async () => {
    const { http } = setup();
    const asm = await discoverAuthServer({ resource: SERVER, authorizationServers: ['https://gone.example.com', ISSUER], url: '' }, http);
    expect(asm.issuer).toBe(ISSUER);
  });
});

describe('registration, PKCE, authorization, tokens', () => {
  async function metadata() {
    const s = setup({ scopesSupported: ['read', 'write'] });
    return { ...s, asm: await fetchAuthServerMetadata(ISSUER, s.http) };
  }

  it('registers a public client with the chromiumapp redirect URI', async () => {
    const { as, http, asm } = await metadata();
    const client = await registerClient(asm, { redirectUri: REDIRECT, clientName: 'Carbon Commander' }, http);
    expect(client).toMatchObject({ authMethod: 'none', redirectUri: REDIRECT, source: 'dynamic', issuer: ISSUER });
    const body = as.requests.find((r) => r.path === '/oauth/register')?.json as Record<string, unknown>;
    expect(body).toMatchObject({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], application_type: 'web' });
  });

  it('fails clearly without a registration endpoint', async () => {
    const s = setup({ registration: false });
    const asm = await fetchAuthServerMetadata(ISSUER, s.http);
    await expect(registerClient(asm, { redirectUri: REDIRECT, clientName: 'x' }, s.http)).rejects.toThrow(/dynamic client registration/);
  });

  it('creates S256 PKCE pairs and random state', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
    expect(randomState()).not.toBe(randomState());
  });

  it('runs the code flow end to end (resource, state, iss, PKCE)', async () => {
    const { as, http, asm } = await metadata();
    const client = await registerClient(asm, { redirectUri: REDIRECT, clientName: 'x' }, http);
    const pkce = await createPkce();
    const state = randomState();
    const url = buildAuthorizationUrl(asm, { clientId: client.clientId, redirectUri: REDIRECT, state, codeChallenge: pkce.challenge, resource: SERVER, scope: 'read' });
    const u = new URL(url);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', code_challenge_method: 'S256', resource: SERVER, scope: 'read', state });
    const back = await as.approve(url);
    const code = parseAuthorizationResponse(back, { redirectUri: REDIRECT, state, issuer: ISSUER, issRequired: true });
    const tokens = await exchangeCode({ issuer: ISSUER, tokenEndpoint: asm.tokenEndpoint }, client, { code, verifier: pkce.verifier, resource: SERVER }, http, 1000);
    expect(tokens.accessToken).toMatch(/^at-/);
    expect(tokens.refreshToken).toMatch(/^rt-/);
    expect(tokens.expiresAt).toBe(1000 + 3600_000);
    expect(tokens.scope).toBe('read');
    expect(as.requests.find((r) => r.path === '/oauth/token')?.form).toMatchObject({ grant_type: 'authorization_code', resource: SERVER, redirect_uri: REDIRECT });

    // A wrong verifier is refused by the server and reported without leaking anything.
    const back2 = await as.approve(url);
    const code2 = parseAuthorizationResponse(back2, { redirectUri: REDIRECT, state, issuer: ISSUER, issRequired: true });
    await expect(exchangeCode({ issuer: ISSUER, tokenEndpoint: asm.tokenEndpoint }, client, { code: code2, verifier: 'wrong', resource: SERVER }, http, 0)).rejects.toThrow(/invalid_grant/);
  });

  it('checks iss before state before error', () => {
    const exp = { redirectUri: REDIRECT, state: 's1', issuer: ISSUER, issRequired: true };
    // Mix-up: a response from another issuer is refused and its error text is not shown.
    const mixed = `${REDIRECT}?error=access_denied&error_description=evil+text&state=s1&iss=https%3A%2F%2Fevil.example.com`;
    expect(() => parseAuthorizationResponse(mixed, exp)).toThrow(/issuer mismatch/);
    expect(() => parseAuthorizationResponse(mixed, exp)).not.toThrow(/evil text/);
    expect(() => parseAuthorizationResponse(`${REDIRECT}?code=c&state=s1`, exp)).toThrow(/missing "iss"/);
    expect(parseAuthorizationResponse(`${REDIRECT}?code=c&state=s1`, { ...exp, issRequired: false })).toBe('c');
    expect(() => parseAuthorizationResponse(`${REDIRECT}?code=c&state=s2&iss=${encodeURIComponent(ISSUER)}`, exp)).toThrow(/state mismatch/);
    expect(() => parseAuthorizationResponse(`${REDIRECT}?error=access_denied&state=s1&iss=${encodeURIComponent(ISSUER)}`, exp)).toThrow(/Access was denied/);
    expect(() => parseAuthorizationResponse(`https://evil.example.com/mcp-oauth?code=c&state=s1`, exp)).toThrow(/unexpected address/);
    expect(parseAuthorizationResponse(`${REDIRECT}#code=c&state=s1&iss=${encodeURIComponent(ISSUER)}`, exp)).toBe('c');
  });

  it('validates token responses', () => {
    expect(() => parseTokenResponse({ access_token: 'a', token_type: 'DPoP' }, 0)).toThrow(/Bearer/);
    expect(() => parseTokenResponse({ access_token: 'a b', token_type: 'bearer' }, 0)).toThrow(/access_token/);
    expect(parseTokenResponse({ access_token: 'a', token_type: 'bearer', expires_in: '60' }, 0)).toEqual({ accessToken: 'a', expiresAt: 60_000 });
    expect(parseTokenResponse({ access_token: 'a', token_type: 'Bearer', expires_in: 1e12 }, 0).expiresAt).toBe(366 * 24 * 3600 * 1000);
  });

  it('refreshes (rotating, keeping an unrotated refresh token) and revokes', async () => {
    const { as, http, asm } = await metadata();
    const client = await registerClient(asm, { redirectUri: REDIRECT, clientName: 'x' }, http);
    const pkce = await createPkce();
    const url = buildAuthorizationUrl(asm, { clientId: client.clientId, redirectUri: REDIRECT, state: 's', codeChallenge: pkce.challenge, resource: SERVER });
    const code = parseAuthorizationResponse(await as.approve(url), { redirectUri: REDIRECT, state: 's', issuer: ISSUER, issRequired: true });
    const endpoints = { issuer: ISSUER, tokenEndpoint: asm.tokenEndpoint, revocationEndpoint: `${ISSUER}/oauth/revoke` };
    const t1 = await exchangeCode(endpoints, client, { code, verifier: pkce.verifier, resource: SERVER }, http, 0);
    const t2 = await refreshTokens(endpoints, client, { refreshToken: t1.refreshToken as string, resource: SERVER }, http, 0);
    expect(t2.accessToken).not.toBe(t1.accessToken);
    expect(t2.refreshToken).not.toBe(t1.refreshToken);
    // The old refresh token was rotated away: invalid_grant.
    await expect(refreshTokens(endpoints, client, { refreshToken: t1.refreshToken as string, resource: SERVER }, http, 0)).rejects.toMatchObject({ oauthError: 'invalid_grant' });
    expect(await revokeToken(endpoints, client, t2.accessToken, 'access_token', http)).toBe(true);
    expect(as.revoked).toEqual([t2.accessToken]);
    expect(await revokeToken({ issuer: ISSUER, tokenEndpoint: 'x' }, client, 't', 'access_token', http)).toBe(false);
  });

  it('keeps the refresh token when the server does not rotate it', async () => {
    const http: OAuthHttp = { serverUrl: SERVER, fetch: async () => Response.json({ access_token: 'new', token_type: 'Bearer' }) };
    const asm = { tokenEndpoint: `${ISSUER}/token` } as AuthServerMetadata;
    const out = await refreshTokens({ issuer: ISSUER, tokenEndpoint: asm.tokenEndpoint }, { clientId: 'c', authMethod: 'none', redirectUri: REDIRECT, source: 'manual', issuer: ISSUER }, { refreshToken: 'keep', resource: SERVER }, http, 0);
    expect(out).toEqual({ accessToken: 'new', refreshToken: 'keep' });
  });

  it('unions scopes', () => {
    expect(unionScopes('read write', undefined, 'write admin')).toBe('read write admin');
    expect(unionScopes(undefined, '')).toBeUndefined();
  });

  it('OAuthError carries the server error code', () => {
    expect(new OAuthError('http', 'x', { oauthError: 'invalid_grant' }).oauthError).toBe('invalid_grant');
  });
});
