/**
 * OAuth sign-in state for MCP servers (one record per server), on top of the protocol pieces in
 * `oauth.ts`:
 *
 * - **Storage**: the client registration, the authorization server's issuer / endpoints, the
 *   tokens and the scopes the user left out are one JSON record, encrypted in the secret store
 *   under `mcp-oauth-<serverId>` (not reachable by any RPC). The record is bound to the server URL
 *   it was obtained for and to the issuer that issued the client id.
 * - **Use**: `hooks(server)` plugs into `McpClient`: it hands out the access token (refreshing
 *   first when it expires within a minute), refreshes once on a 401 (single-flight per server, so
 *   concurrent requests share one refresh), records `insufficient_scope` challenges, and never
 *   starts an interactive sign-in. A refresh that finishes after a sign-out / new sign-in / URL
 *   change is discarded (a generation counter), so it cannot bring old tokens back.
 * - **Plan** (`status().plan`): before sign-in, the authorization server is found with read-only
 *   GETs and the UI shows which host the sign-in window opens (called out when it is on another
 *   site than the MCP server) and which scopes would be requested, per the specification's scope
 *   selection order (401 challenge `scope`, else `scopes_supported`, else none; step-up: the
 *   previously requested scopes + the `insufficient_scope` challenge). The user can leave scopes
 *   out; the choice is remembered per server.
 * - **Sign-in** (`signIn`, from the settings UI only, with the plan the user confirmed): protected
 *   resource metadata and authorization server metadata are read again, and the sign-in is refused
 *   when the sign-in host is not the one shown or a chosen scope is no longer offered; then the
 *   client id (the one the user entered for the server, else the stored dynamic registration for
 *   that issuer, else a new dynamic registration) -> authorization code + PKCE in the browser's
 *   sign-in window (`chrome.identity.launchWebAuthFlow`) -> token exchange. A dynamic registration
 *   the authorization server no longer accepts (`invalid_client`) is dropped, so the next sign-in
 *   registers again.
 * - **Worker restarts**: a sign-in in progress is marked in `chrome.storage.session` (no secrets:
 *   the PKCE verifier and `state` live only in memory). When the worker was stopped mid-flow, the
 *   marker outlives it, the status says the sign-in was interrupted, and the user starts it again;
 *   nothing half-done is used.
 */
import type { SecretStore } from '../background/secrets';
import type { StorageAreaLike } from '../background/storage-area';
import { MCP_OAUTH_REDIRECT_PATH, STORAGE_KEYS, mcpOAuthSecretName } from '../shared/defaults';
import { createLogger } from '../shared/logger';
import { CcError, type McpOAuthStatus, type McpServerConfig, type McpSignInConfirm, type McpSignInPlan } from '../shared/types';
import { cleanText, type McpAuthHooks } from './client';
import {
  OAuthError,
  approximateSite,
  bearerChallenge,
  buildAuthorizationUrl,
  canonicalResourceUrl,
  createPkce,
  discoverAuthServer,
  exchangeCode,
  fetchProtectedResourceMetadata,
  parseAuthorizationResponse,
  randomState,
  refreshTokens,
  registerClient,
  revokeToken,
  splitScope,
  unionScopes,
  type AuthServerMetadata,
  type BearerChallenge,
  type OAuthClient,
  type OAuthHttp,
  type ProtectedResourceMetadata,
  type TokenEndpoints,
  type TokenSet,
} from './oauth';

const log = createLogger('mcp-oauth');

export interface McpOAuthDeps {
  secrets: Pick<SecretStore, 'get' | 'set' | 'delete'>;
  /** Injectable for tests. Default global `fetch`. */
  fetch?: typeof fetch;
  now?: () => number;
  /**
   * The interactive browser step: open `url`, resolve with the URL the authorization server
   * redirected to. Default `chrome.identity.launchWebAuthFlow({ url, interactive: true })`.
   */
  launchWebAuthFlow?: (url: string) => Promise<string>;
  /** Redirect URI registered with authorization servers. Default `chrome.identity.getRedirectURL('mcp-oauth')`. */
  redirectUri?: () => string;
  /** In-progress / failed markers. Default `chrome.storage.session`; null = memory only. */
  session?: StorageAreaLike | null;
  /** `client_name` for dynamic registration. */
  clientName?: string;
  /** Keep the worker alive while the user is in the sign-in window. Returns a stop function. */
  keepAlive?: () => () => void;
  /** Bound on the interactive step. Default 10 min. */
  interactiveTimeoutMs?: number;
  /** Bound on each OAuth HTTP request. Default 15 s. */
  requestTimeoutMs?: number;
  /** Refresh this long before the access token expires. Default 60 s. */
  refreshSkewMs?: number;
}

export interface McpSignInOptions {
  /** Add the scopes the server asked for in an `insufficient_scope` challenge. */
  stepUp?: boolean;
  /** What the user saw and chose (`McpOAuthStatus.plan`). */
  confirm: McpSignInConfirm;
}

export interface McpOAuth {
  /** For `McpClient.authHooks`. */
  hooks(server: McpServerConfig): McpAuthHooks;
  /** Sign-in state for the settings UI (undefined: the server never asked for OAuth). */
  status(server: McpServerConfig): Promise<McpOAuthStatus | undefined>;
  /** Interactive sign-in, as confirmed by the user. Throws `CcError` on failure. */
  signIn(server: McpServerConfig, options: McpSignInOptions): Promise<void>;
  /** Revoke (best effort) and delete the tokens; the client registration is kept. */
  signOut(server: McpServerConfig): Promise<void>;
  /** Drop everything for a server (removed, or its URL changed). */
  forget(serverId: string): Promise<void>;
}

/** The encrypted per-server record. */
interface OAuthRecord {
  v: 1;
  /** Canonical URL of the MCP server the record belongs to. */
  serverUrl: string;
  /** The `resource` value used for this server. */
  resource?: string;
  endpoints?: TokenEndpoints;
  client?: OAuthClient;
  tokens?: TokenSet & { obtainedAt: number };
  /** Scope asked for in the last sign-in. */
  requestedScope?: string;
  /** Scopes the user left out (pre-deselected in the next plan). */
  deselectedScopes?: string[];
}

interface Marker {
  phase: 'pending' | 'failed';
  at: number;
  error?: string;
}

interface Discovered {
  prm: ProtectedResourceMetadata;
  asm: AuthServerMetadata;
}

interface Mem {
  record?: OAuthRecord | null;
  /** Bumped by every sign-in, sign-out and dropped grant: a refresh started before is discarded. */
  gen: number;
  /** The server answered 401 and there is no usable token. */
  required: boolean;
  challenge?: BearerChallenge;
  /** Scope from the last `insufficient_scope` challenge. */
  insufficientScope?: string;
  /** Why the last sign-in failed. */
  error?: string;
  /** Why a sign-in is required again (e.g. the grant was revoked). */
  notice?: string;
  signingIn?: Promise<void>;
  refreshing?: Promise<boolean>;
  /** Read-only discovery of the authorization server (for the status and plan before sign-in). */
  discovered?: Discovered;
  issuerHint?: string;
  hintError?: string;
  hintFailedAt?: number;
  hinting?: Promise<void>;
}

const HINT_WAIT_MS = 5_000;
/** A failed authorization server lookup is not repeated by `status()` sooner than this. */
const HINT_RETRY_MS = 30_000;

export function createMcpOAuth(deps: McpOAuthDeps): McpOAuth {
  const now = deps.now ?? (() => Date.now());
  const skew = deps.refreshSkewMs ?? 60_000;
  const interactiveTimeout = deps.interactiveTimeoutMs ?? 10 * 60_000;
  const clientName = deps.clientName ?? 'Carbon Commander';
  const session = deps.session === undefined ? defaultSession() : deps.session;
  const launch = deps.launchWebAuthFlow ?? defaultLaunch;
  const redirectUri = deps.redirectUri ?? (() => chrome.identity.getRedirectURL(MCP_OAUTH_REDIRECT_PATH));
  const keepAlive = deps.keepAlive ?? defaultKeepAlive;
  const mems = new Map<string, Mem>();
  /** Markers seen in session storage when this worker started (interrupted sign-ins). */
  let markers: Promise<Record<string, Marker>> | null = null;

  const mem = (id: string): Mem => {
    let m = mems.get(id);
    if (!m) {
      m = { required: false, gen: 0 };
      mems.set(id, m);
    }
    return m;
  };
  /** `m` is still the live state of the server and nothing replaced its tokens since `gen`. */
  const unchanged = (id: string, m: Mem, gen: number): boolean => mems.get(id) === m && m.gen === gen;

  const http = (server: McpServerConfig): OAuthHttp => ({
    serverUrl: server.url,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.requestTimeoutMs !== undefined ? { timeoutMs: deps.requestTimeoutMs } : {}),
  });

  // --- record ----------------------------------------------------------------------------------

  async function load(server: McpServerConfig): Promise<OAuthRecord | null> {
    const m = mem(server.id);
    if (m.record !== undefined) {
      if (m.record && m.record.serverUrl !== canonicalResourceUrl(server.url)) m.record = null;
      return m.record;
    }
    let record: OAuthRecord | null = null;
    const raw = await deps.secrets.get(mcpOAuthSecretName(server.id));
    if (raw !== null) {
      try {
        record = parseRecord(JSON.parse(raw));
      } catch {
        record = null;
      }
      if (!record || record.serverUrl !== canonicalResourceUrl(server.url)) {
        // Unreadable, or obtained for another URL (tokens are audience-bound): drop it.
        record = null;
        await deps.secrets.delete(mcpOAuthSecretName(server.id)).catch(() => undefined);
      }
    }
    m.record = record;
    return record;
  }

  async function save(serverId: string, record: OAuthRecord): Promise<void> {
    mem(serverId).record = record;
    await deps.secrets.set(mcpOAuthSecretName(serverId), JSON.stringify(record));
  }

  /** Read-modify-write on the latest record (a refresh may have rotated the tokens meanwhile). */
  async function patch(server: McpServerConfig, fn: (r: OAuthRecord) => OAuthRecord): Promise<void> {
    const current = (await load(server)) ?? { v: 1, serverUrl: canonicalResourceUrl(server.url) };
    await save(server.id, fn(current));
  }

  // --- markers (session storage) ----------------------------------------------------------------

  async function readMarkers(): Promise<Record<string, Marker>> {
    if (!session) return {};
    try {
      const got = await session.get(STORAGE_KEYS.mcpOAuthPending);
      const value = got[STORAGE_KEYS.mcpOAuthPending];
      return isRecord(value) ? (value as Record<string, Marker>) : {};
    } catch {
      return {};
    }
  }

  /** Markers as they were when this worker started (later writes are mirrored into it). */
  function startMarkers(): Promise<Record<string, Marker>> {
    markers ??= readMarkers();
    return markers;
  }

  async function setMarker(id: string, marker: Marker | null): Promise<void> {
    const current = await startMarkers();
    if (marker) current[id] = marker;
    else delete current[id];
    if (!session) return;
    const stored = await readMarkers();
    if (marker) stored[id] = marker;
    else delete stored[id];
    await session.set({ [STORAGE_KEYS.mcpOAuthPending]: stored }).catch(() => undefined);
  }

  // --- refresh ---------------------------------------------------------------------------------

  /** Single-flight refresh. Resolves true when a token other than `usedToken` is available. */
  function refresh(server: McpServerConfig, usedToken: string | null): Promise<boolean> {
    const m = mem(server.id);
    m.refreshing ??= (async (): Promise<boolean> => {
      const gen = m.gen;
      const record = await load(server);
      const tokens = record?.tokens;
      if (!record || !tokens) return false;
      if (usedToken !== null && tokens.accessToken !== usedToken) return true; // someone refreshed already
      if (!tokens.refreshToken || !record.client || !record.endpoints || !record.resource) return false;
      const otherToken = async (): Promise<boolean> => {
        const t = (await load(server))?.tokens;
        return !!t && t.accessToken !== usedToken;
      };
      try {
        const fresh = await refreshTokens(
          record.endpoints,
          record.client,
          { refreshToken: tokens.refreshToken, resource: record.resource },
          http(server),
          now(),
        );
        // Signed out, signed in again or forgotten meanwhile: these tokens must not come back.
        if (!unchanged(server.id, m, gen)) return otherToken();
        const scope = fresh.scope ?? tokens.scope;
        await patch(server, (r) => ({ ...r, tokens: { ...fresh, ...(scope ? { scope } : {}), obtainedAt: now() } }));
        m.required = false;
        log.info(`Refreshed the OAuth token of MCP server "${server.name}"`);
        return true;
      } catch (err) {
        if (!unchanged(server.id, m, gen)) return otherToken();
        const code = err instanceof OAuthError ? err.oauthError : undefined;
        if (code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client') {
          // The grant is gone (revoked, expired, client deleted): the user has to sign in again.
          // A registration the server no longer accepts is dropped too, so the next sign-in registers anew.
          const dropClient = code !== 'invalid_grant' && record.client.source === 'dynamic';
          await patch(server, (r) => withoutTokens(r, dropClient));
          m.gen++;
          m.required = true;
          m.notice = 'The sign-in expired or was revoked; sign in again.';
          log.info(`The OAuth grant of MCP server "${server.name}" is no longer valid; sign-in required`);
        } else {
          log.warn(`Refreshing the OAuth token of MCP server "${server.name}" failed:`, err instanceof Error ? err.message : 'error');
        }
        return false;
      }
    })().finally(() => {
      m.refreshing = undefined;
    });
    return m.refreshing;
  }

  // --- hooks -----------------------------------------------------------------------------------

  function hooks(server: McpServerConfig): McpAuthHooks {
    return {
      async accessToken() {
        const record = await load(server);
        const tokens = record?.tokens;
        if (!tokens) return null;
        if (tokens.expiresAt !== undefined && now() >= tokens.expiresAt - skew && tokens.refreshToken) {
          await refresh(server, tokens.accessToken);
          return (await load(server))?.tokens?.accessToken ?? null;
        }
        return tokens.accessToken;
      },
      async onUnauthorized({ wwwAuthenticate, usedToken }) {
        const m = mem(server.id);
        const challenge = bearerChallenge(wwwAuthenticate);
        if (challenge) m.challenge = challenge;
        if (usedToken !== null && (await refresh(server, usedToken))) return true;
        // No usable token: the user has to sign in (from the settings UI, never automatically).
        const record = await load(server);
        if (record?.tokens && record.tokens.accessToken === usedToken && !record.tokens.refreshToken) {
          await patch(server, (r) => withoutTokens(r, false));
        }
        m.required = true;
        startHint(server);
        return false;
      },
      onInsufficientScope({ wwwAuthenticate }) {
        const m = mem(server.id);
        const challenge = bearerChallenge(wwwAuthenticate);
        if (challenge) m.challenge = challenge;
        m.insufficientScope = challenge?.scope ?? '';
      },
    };
  }

  /** Find the authorization server (read-only GETs) so the status can show the plan before sign-in. */
  function startHint(server: McpServerConfig): void {
    const m = mem(server.id);
    if (m.discovered || m.hinting) return;
    if (m.hintFailedAt !== undefined && now() - m.hintFailedAt < HINT_RETRY_MS) return;
    m.hinting = (async () => {
      try {
        const prm = await fetchProtectedResourceMetadata(server.url, { resourceMetadataUrl: m.challenge?.resourceMetadata }, http(server));
        const asm = await discoverAuthServer(prm, http(server));
        m.discovered = { prm, asm };
        m.issuerHint = asm.issuer;
        delete m.hintError;
        delete m.hintFailedAt;
      } catch (err) {
        m.hintError = err instanceof Error ? cleanText(err.message, 300) : 'Could not find the authorization server';
        m.hintFailedAt = now();
      }
    })().finally(() => {
      m.hinting = undefined;
    });
  }

  // --- plan ------------------------------------------------------------------------------------

  /** What a sign-in would open and request (MCP 2026-07-28, Scope Selection Strategy / Step-Up). */
  function planFor(server: McpServerConfig, record: OAuthRecord | null, m: Mem, d: Discovered, stepUp: boolean): McpSignInPlan {
    const auth = new URL(d.asm.authorizationEndpoint);
    const mcp = new URL(server.url);
    let scopes: string[];
    let required: string[] = [];
    let scopeSource: McpSignInPlan['scopeSource'];
    if (stepUp) {
      // The union of the previously requested scopes and the challenge's (granted ones when the
      // request was not recorded), so permissions needed elsewhere are kept.
      required = splitScope(m.insufficientScope);
      scopes = splitScope(unionScopes(record?.requestedScope ?? record?.tokens?.scope, m.insufficientScope));
      scopeSource = 'step-up';
    } else {
      const challenge = splitScope(m.insufficientScope || m.challenge?.scope);
      if (challenge.length > 0) {
        scopes = challenge;
        scopeSource = 'challenge';
      } else if (d.prm.scopesSupported && d.prm.scopesSupported.length > 0) {
        scopes = splitScope(d.prm.scopesSupported.join(' '));
        scopeSource = 'resource-metadata';
      } else {
        scopes = [];
        scopeSource = 'none';
      }
    }
    const deselected = new Set(record?.deselectedScopes ?? []);
    let selected = scopes.filter((s) => required.includes(s) || !deselected.has(s));
    if (selected.length === 0) selected = [...scopes];
    return {
      authorizationHost: auth.host,
      issuer: d.asm.issuer,
      serverHost: mcp.host,
      crossSite: approximateSite(auth.hostname) !== approximateSite(mcp.hostname),
      scopeSource,
      scopes,
      selected,
      required,
    };
  }

  // --- status ----------------------------------------------------------------------------------

  async function status(server: McpServerConfig): Promise<McpOAuthStatus | undefined> {
    const m = mem(server.id);
    const waitHint = async (): Promise<void> => {
      if (m.hinting) await Promise.race([m.hinting, new Promise((r) => setTimeout(r, HINT_WAIT_MS))]);
    };
    await waitHint();
    const record = await load(server);
    const out = await baseStatus(server, m, record);
    if (!out || out.state === 'signed-in' || out.state === 'in-progress') return out;
    // A sign-in button will be shown: say what it opens and asks for.
    if (!m.discovered) {
      startHint(server);
      await waitHint();
    }
    const issuer = record?.endpoints?.issuer ?? m.issuerHint;
    if (issuer) out.issuer = issuer;
    if (m.discovered) {
      out.plan = planFor(server, record, m, m.discovered, out.state === 'insufficient-scope');
    } else if (!out.error && m.hintError) {
      out.error = m.hintError;
    }
    return out;
  }

  async function baseStatus(server: McpServerConfig, m: Mem, record: OAuthRecord | null): Promise<McpOAuthStatus | undefined> {
    const issuer = record?.endpoints?.issuer ?? m.issuerHint;
    const base = (state: McpOAuthStatus['state']): McpOAuthStatus => {
      const out: McpOAuthStatus = { state };
      if (issuer) out.issuer = issuer;
      if (record?.client) out.clientSource = record.client.source;
      return out;
    };
    if (m.signingIn) return base('in-progress');
    const marker = (await startMarkers())[server.id];
    const tokens = record?.tokens;
    if (tokens) {
      if (m.insufficientScope !== undefined) {
        const out = base('insufficient-scope');
        if (m.insufficientScope) out.requiredScope = m.insufficientScope;
        if (tokens.scope) out.scope = tokens.scope;
        return out;
      }
      if (tokens.expiresAt !== undefined && now() >= tokens.expiresAt && !tokens.refreshToken) {
        return { ...base('required'), error: 'The sign-in expired.' };
      }
      const out = base('signed-in');
      if (tokens.expiresAt !== undefined) out.expiresAt = tokens.expiresAt;
      if (tokens.scope) out.scope = tokens.scope;
      out.canRefresh = !!tokens.refreshToken;
      return out;
    }
    if (marker?.phase === 'pending') {
      return { ...base('interrupted'), error: 'The sign-in was interrupted (the extension restarted). Sign in again.' };
    }
    const error = m.error ?? (marker?.phase === 'failed' ? marker.error : undefined);
    if (error) return { ...base('failed'), error };
    if (m.required || record) {
      const out = base('required');
      if (m.notice) out.error = m.notice;
      return out;
    }
    return undefined;
  }

  // --- sign-in ---------------------------------------------------------------------------------

  async function doSignIn(server: McpServerConfig, stepUp: boolean, confirm: McpSignInConfirm, m: Mem, gen: number): Promise<void> {
    const h = http(server);
    const prm = await fetchProtectedResourceMetadata(server.url, { resourceMetadataUrl: m.challenge?.resourceMetadata }, h);
    const asm = await discoverAuthServer(prm, h);
    m.discovered = { prm, asm };
    m.issuerHint = asm.issuer;
    const endpoints: TokenEndpoints = {
      issuer: asm.issuer,
      tokenEndpoint: asm.tokenEndpoint,
      ...(asm.revocationEndpoint ? { revocationEndpoint: asm.revocationEndpoint } : {}),
    };
    const resource = canonicalResourceUrl(prm.resource);
    const redirect = redirectUri();

    // Only what the user saw: the same sign-in host, scopes from the current offer.
    const plan = planFor(server, await load(server), m, m.discovered, stepUp);
    if (plan.authorizationHost !== confirm.authorizationHost) {
      throw new OAuthError(
        'invalid',
        `The sign-in page is now on ${plan.authorizationHost}, not on ${cleanText(confirm.authorizationHost, 200)} as shown. ` +
          'Check the new address, then click Sign in again.',
      );
    }
    const chosen = new Set(confirm.scopes);
    const unknown = confirm.scopes.filter((s) => !plan.scopes.includes(s));
    if (unknown.length > 0) {
      throw new OAuthError('invalid', `No longer offered: ${cleanText(unknown.join(' '), 200)}. Check the scopes, then click Sign in again.`);
    }
    const missing = plan.required.filter((s) => !chosen.has(s));
    if (missing.length > 0) throw new OAuthError('invalid', `The server needs ${missing.join(' ')} for this; it cannot be left out.`);
    if (plan.scopes.length > 0 && chosen.size === 0) throw new OAuthError('invalid', 'Select at least one scope.');
    const selected = plan.scopes.filter((s) => chosen.has(s));
    const scope = selected.length > 0 ? selected.join(' ') : undefined;
    const deselected = (r: OAuthRecord): string[] => [
      ...(r.deselectedScopes ?? []).filter((s) => !plan.scopes.includes(s)),
      ...plan.scopes.filter((s) => !chosen.has(s)),
    ];
    await patch(server, (r) => ({ ...r, deselectedScopes: deselected(r) }));
    const record = (await load(server)) as OAuthRecord;

    // Client id: manual (per server) > stored dynamic registration for this issuer > new registration.
    let client: OAuthClient;
    const manual = server.oauthClientId?.trim();
    if (manual) {
      client = { clientId: manual, authMethod: 'none', redirectUri: redirect, source: 'manual', issuer: asm.issuer };
    } else if (record.client?.source === 'dynamic' && record.client.issuer === asm.issuer && record.client.redirectUri === redirect) {
      client = record.client;
    } else if (asm.registrationEndpoint) {
      client = await registerClient(asm, { redirectUri: redirect, clientName }, h);
      // Kept even if the rest fails, so a retry does not register again.
      await patch(server, (r) => ({ ...r, client }));
    } else {
      throw new OAuthError(
        'invalid',
        `The authorization server (${asm.issuer}) does not allow automatic client registration. Register a client there ` +
          `with the redirect URI ${redirect}, then enter its client ID in this server's settings.`,
      );
    }

    const pkce = await createPkce();
    const state = randomState();
    const url = buildAuthorizationUrl(asm, {
      clientId: client.clientId,
      redirectUri: redirect,
      state,
      codeChallenge: pkce.challenge,
      resource,
      scope,
    });
    let tokens: TokenSet;
    try {
      const responseUrl = await withTimeout(launch(url), interactiveTimeout, 'The sign-in window was not completed in time.');
      const code = parseAuthorizationResponse(responseUrl, {
        redirectUri: redirect,
        state,
        issuer: asm.issuer,
        issRequired: asm.issParameterSupported,
      });
      tokens = await exchangeCode(endpoints, client, { code, verifier: pkce.verifier, resource }, h, now());
    } catch (err) {
      const code = err instanceof OAuthError ? err.oauthError : undefined;
      if (client.source === 'dynamic' && (code === 'invalid_client' || code === 'unauthorized_client')) {
        // The authorization server forgot (or refuses) our registration: register anew next time.
        await patch(server, (r) => {
          const { client: _dropped, ...rest } = r;
          return rest;
        });
        throw new OAuthError(
          'invalid',
          `The authorization server no longer accepts this extension's registration (${code}). Click Sign in again to register anew.`,
          { cause: err, oauthError: code },
        );
      }
      throw err;
    }
    if (!unchanged(server.id, m, gen)) {
      throw new OAuthError('invalid', 'The sign-in was cancelled: the server was signed out, changed or removed meanwhile.');
    }
    const granted = tokens.scope ?? scope;
    m.gen++;
    await patch(server, ({ requestedScope: _previous, ...r }) => ({
      ...r,
      v: 1,
      serverUrl: canonicalResourceUrl(server.url),
      resource,
      endpoints,
      client,
      tokens: { ...tokens, ...(granted ? { scope: granted } : {}), obtainedAt: now() },
      ...(scope ? { requestedScope: scope } : {}),
    }));
  }

  function signIn(server: McpServerConfig, options: McpSignInOptions): Promise<void> {
    const m = mem(server.id);
    if (m.signingIn) return m.signingIn;
    m.signingIn = (async () => {
      delete m.error;
      const gen = m.gen;
      await setMarker(server.id, { phase: 'pending', at: now() });
      const stop = keepAlive();
      try {
        if (!isConfirm(options.confirm)) throw new OAuthError('invalid', 'Missing sign-in confirmation');
        await doSignIn(server, options.stepUp === true, options.confirm, m, gen);
        m.required = false;
        delete m.insufficientScope;
        delete m.challenge;
        delete m.notice;
        await setMarker(server.id, null);
        log.info(`Signed in to MCP server "${server.name}"`);
      } catch (err) {
        const message = signInErrorMessage(err);
        m.error = message;
        await setMarker(server.id, { phase: 'failed', at: now(), error: message });
        throw new CcError(err instanceof CcError ? err.code : 'unknown', message, { cause: err });
      } finally {
        stop();
      }
    })().finally(() => {
      m.signingIn = undefined;
    });
    return m.signingIn;
  }

  async function signOut(server: McpServerConfig): Promise<void> {
    const m = mem(server.id);
    m.gen++; // a refresh or sign-in still running must not store tokens afterwards
    const record = await load(server);
    if (record?.tokens && record.client && record.endpoints) {
      const h = { ...http(server), timeoutMs: 5_000 };
      if (record.tokens.refreshToken) await revokeToken(record.endpoints, record.client, record.tokens.refreshToken, 'refresh_token', h);
      await revokeToken(record.endpoints, record.client, record.tokens.accessToken, 'access_token', h);
    }
    if (record?.tokens) await patch(server, (r) => withoutTokens(r, false));
    m.required = true;
    delete m.insufficientScope;
    delete m.error;
    await setMarker(server.id, null);
  }

  async function forget(serverId: string): Promise<void> {
    const m = mems.get(serverId);
    if (m) m.gen++;
    mems.delete(serverId);
    await deps.secrets.delete(mcpOAuthSecretName(serverId));
    await setMarker(serverId, null);
  }

  return { hooks, status, signIn, signOut, forget };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function withoutTokens(record: OAuthRecord, dropClient: boolean): OAuthRecord {
  const { tokens: _tokens, client, ...rest } = record;
  return dropClient || !client ? rest : { ...rest, client };
}

function isConfirm(value: unknown): value is McpSignInConfirm {
  if (!isRecord(value) || typeof value.authorizationHost !== 'string' || value.authorizationHost.length > 300) return false;
  return Array.isArray(value.scopes) && value.scopes.length <= 100 && value.scopes.every((s) => typeof s === 'string' && s.length <= 200);
}

function parseRecord(value: unknown): OAuthRecord | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.serverUrl !== 'string') return null;
  const r = value as unknown as OAuthRecord;
  if (r.tokens !== undefined && (!isRecord(r.tokens) || typeof r.tokens.accessToken !== 'string')) return null;
  if (r.client !== undefined && (!isRecord(r.client) || typeof r.client.clientId !== 'string' || typeof r.client.issuer !== 'string')) return null;
  if (r.deselectedScopes !== undefined && !(Array.isArray(r.deselectedScopes) && r.deselectedScopes.every((s) => typeof s === 'string'))) {
    delete r.deselectedScopes;
  }
  return r;
}

/** User-facing reason for a failed sign-in (no token material ever reaches these messages). */
function signInErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // chrome.identity.launchWebAuthFlow rejects with this when the user closes the window.
  if (/did not approve|user (?:closed|cancel)|canceled|cancelled/i.test(raw) && !/meanwhile/.test(raw)) {
    return 'Sign-in was cancelled (the window was closed).';
  }
  if (/Authorization page could not be loaded/i.test(raw)) return 'The sign-in page could not be loaded.';
  return cleanText(raw, 400);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CcError('network', message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function defaultLaunch(url: string): Promise<string> {
  const result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!result) throw new CcError('unknown', 'The sign-in window closed without an answer');
  return result;
}

/** An extension API call resets the worker's idle timer (same trick as running agent sessions). */
function defaultKeepAlive(): () => void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getPlatformInfo) return () => undefined;
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo().catch(() => undefined), 20_000);
  return () => clearInterval(timer);
}

function defaultSession(): StorageAreaLike | null {
  try {
    return typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
