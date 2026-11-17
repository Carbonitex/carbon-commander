/**
 * MCP servers: list with status, add / edit / remove, write-only auth, connection test, OAuth
 * sign-in / sign-out, and the servers discovered on visited sites (one-click add).
 */
import { MCP_OAUTH_REDIRECT_PATH, MCP_SERVER_NAME_PATTERN } from '../../shared/defaults';
import type {
  DiscoveredMcpServer,
  McpOAuthStatus,
  McpServerAuth,
  McpServerInput,
  McpServerStatus,
  McpSignInPlan,
  McpTestResult,
} from '../../shared/types';
import { h } from '../dom';
import { describeError } from '../format';
import { errorMessage, type SettingsContext, type SettingsPanel } from './context';
import { busy, button, checkbox, field, section, statusLine, textInput } from './fields';

/** Parse `Header: value` lines. Returns an error string for malformed input. */
export function parseHeaders(text: string): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    const name = colon > 0 ? line.slice(0, colon).trim() : '';
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return `Line ${i + 1}: expected "Header-Name: value"`;
    out[name] = line.slice(colon + 1).trim();
  }
  return out;
}

/** Validate the form; returns an error message or the input. */
export function validateServer(name: string, url: string): McpServerInput | string {
  if (!MCP_SERVER_NAME_PATTERN.test(name)) return 'Name: 1–32 letters, digits, "_" or "-"';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'URL is not valid';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'URL must be http:// or https://';
  return { name, url: parsed.toString(), enabled: true };
}

function testSummary(result: McpTestResult): { text: string; ok: boolean } {
  if (!result.ok) return { text: result.error ? describeError(result.error).detail : 'Test failed', ok: false };
  const info = result.serverInfo ? `${result.serverInfo.name} ${result.serverInfo.version}` : 'Server';
  return { text: `${info} OK · ${result.tools?.length ?? 0} tools${result.protocolVersion ? ` · protocol ${result.protocolVersion}` : ''}`, ok: true };
}

/** `https://<extension-id>.chromiumapp.org/mcp-oauth`, the redirect URI to register manually. */
export function oauthRedirectUri(): string {
  const id = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
  return `https://${id ?? '<extension-id>'}.chromiumapp.org/${MCP_OAUTH_REDIRECT_PATH}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatExpiry(at: number, now = Date.now()): string {
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Pill text, tone and description of an OAuth status (exported for tests). */
export function describeOAuth(oauth: McpOAuthStatus, now = Date.now()): { pill: string; tone: 'ok' | 'warn' | 'error'; text: string } {
  const by = oauth.issuer ? ` with ${hostOf(oauth.issuer)}` : '';
  switch (oauth.state) {
    case 'signed-in': {
      const expiry =
        oauth.expiresAt === undefined
          ? ''
          : oauth.canRefresh
            ? ` · token renews automatically (current one until ${formatExpiry(oauth.expiresAt, now)})`
            : ` (expires ${formatExpiry(oauth.expiresAt, now)})`;
      return { pill: 'signed in', tone: 'ok', text: `Signed in${by}${expiry}${oauth.scope ? ` · scope: ${oauth.scope}` : ''}` };
    }
    case 'in-progress':
      return { pill: 'signing in…', tone: 'warn', text: 'Finish signing in in the window that opened.' };
    case 'failed':
      return { pill: 'sign-in failed', tone: 'error', text: `Sign-in failed: ${oauth.error ?? 'unknown error'}` };
    case 'interrupted':
      return { pill: 'sign-in interrupted', tone: 'warn', text: oauth.error ?? 'The sign-in was interrupted. Sign in again.' };
    case 'insufficient-scope':
      return {
        pill: 'needs more access',
        tone: 'warn',
        text: `The server asks for more permissions${oauth.requiredScope ? ` (${oauth.requiredScope})` : ''}. Sign in again to grant them.`,
      };
    default:
      return {
        pill: 'sign-in required',
        tone: 'warn',
        text: `Sign-in required${by}.${oauth.error ? ` ${oauth.error}` : ''}`,
      };
  }
}

/** What "Sign in" opens and asks for, in words (exported for tests). */
export function describePlan(plan: McpSignInPlan): { opens: string; site: string | null; scopes: string } {
  const opens = `Sign-in opens a window at ${plan.authorizationHost}${hostOf(plan.issuer) !== plan.authorizationHost ? ` (authorization server ${hostOf(plan.issuer)})` : ''}.`;
  const site = plan.crossSite
    ? `${plan.authorizationHost} is a different site from the MCP server ${plan.serverHost}. Only continue if you expect ${plan.serverHost} to sign in there.`
    : null;
  const where = plan.scopeSource === 'step-up' ? 'the server asked for more' : plan.scopeSource === 'challenge' ? 'the server asked for these' : 'the server lists these';
  const scopes =
    plan.scopes.length === 0
      ? 'Requests no specific scope (the authorization server decides the access).'
      : plan.scopes.length === 1
        ? `Requests the scope ${plan.scopes[0] ?? ''} (${where}).`
        : `Requests the checked scopes (${where}); uncheck what you do not want to grant.`;
  return { opens, site, scopes };
}

export function createMcpPanel(ctx: SettingsContext): SettingsPanel {
  const el = h('div', { class: 'cc-panel' });
  const listEl = h('div', { class: 'cc-mcp-list' });
  const discoveredEl = h('div', { class: 'cc-mcp-list cc-mcp-discovered' });
  const formHost = h('div');
  const status = statusLine();

  const reloadServers = async (): Promise<void> => {
    const servers = await ctx.rpc('mcp.list');
    listEl.replaceChildren(...(servers.length ? servers.map(serverRow) : [h('div', { class: 'cc-hint' }, 'No MCP servers yet.')]));
  };
  const reloadDiscovered = async (): Promise<void> => {
    let found: DiscoveredMcpServer[];
    try {
      found = await ctx.rpc('mcp.discovered.list');
    } catch {
      found = [];
    }
    discoveredEl.replaceChildren(
      ...(found.length
        ? found.map(discoveredRow)
        : [h('div', { class: 'cc-hint' }, ctx.settings().mcpDiscovery ? 'Nothing found yet. Sites that advertise an MCP server show up here.' : 'Discovery is off.')]),
    );
  };
  const reload = async (): Promise<void> => {
    await Promise.all([reloadServers(), reloadDiscovered()]);
  };
  const reloadSafe = (): void => void reload().catch((err) => status.set(errorMessage(err), 'error'));

  /** Run the interactive sign-in the user confirmed (host + scopes); progress and errors go to `line`. */
  const signIn = async (id: string, line: ReturnType<typeof statusLine>, plan: McpSignInPlan, scopes: string[], stepUp: boolean): Promise<void> => {
    line.set(`Finish signing in in the window that opened (${plan.authorizationHost})…`, 'muted');
    try {
      await ctx.rpc('mcp.signIn', { id, ...(stepUp ? { stepUp: true } : {}), confirm: { authorizationHost: plan.authorizationHost, scopes } });
      line.set('Signed in', 'ok');
    } finally {
      await reload().catch(() => undefined);
    }
  };

  /**
   * The plan shown before the sign-in window opens: the host it opens (a different site called
   * out), and the scopes, each a checkbox when there is a choice. Returns the block and a getter
   * for the selection (null = nothing selected although scopes are offered).
   */
  const planBlock = (server: McpServerStatus, plan: McpSignInPlan, onChange: () => void): { el: HTMLElement; selection(): string[] | null } => {
    const d = describePlan(plan);
    const boxes = new Map<string, HTMLInputElement>();
    const scopeEls: HTMLElement[] = [];
    if (plan.scopes.length > 1) {
      for (const scope of plan.scopes) {
        const required = plan.required.includes(scope);
        const input = h('input', { type: 'checkbox', 'aria-label': `Scope ${scope} for ${server.name}`, ...(required ? { disabled: true } : {}) });
        input.checked = required || plan.selected.includes(scope);
        input.addEventListener('change', onChange);
        boxes.set(scope, input);
        scopeEls.push(h('label', { class: 'cc-mcp-scope' }, input, ' ', h('code', null, scope), required ? ' (asked for now)' : null));
      }
    }
    const el = h(
      'div',
      { class: 'cc-mcp-plan', data: { crossSite: String(plan.crossSite) } },
      h('div', { class: 'cc-hint cc-break' }, d.opens),
      d.site ? h('div', { class: 'cc-hint cc-break cc-mcp-cross-site', role: 'note' }, h('span', { class: 'cc-pill', data: { tone: 'warn' } }, 'different site'), ' ', d.site) : null,
      h('div', { class: 'cc-hint cc-break' }, d.scopes),
      scopeEls.length ? h('div', { class: 'cc-row cc-mcp-scopes' }, ...scopeEls) : null,
    );
    return {
      el,
      selection() {
        if (plan.scopes.length <= 1) return [...plan.scopes];
        const chosen = plan.scopes.filter((s) => boxes.get(s)?.checked === true);
        return chosen.length > 0 ? chosen : null;
      },
    };
  };

  const oauthBlock = (server: McpServerStatus, rowStatus: ReturnType<typeof statusLine>): HTMLElement | null => {
    const oauth = server.oauth;
    if (!oauth) return null;
    const d = describeOAuth(oauth);
    const buttons: HTMLElement[] = [];
    let plan: ReturnType<typeof planBlock> | null = null;
    const signInButtons: HTMLButtonElement[] = [];
    const updateButtons = (): void => {
      const none = plan?.selection() === null;
      for (const b of signInButtons) b.disabled = none;
    };
    if (oauth.plan && oauth.state !== 'signed-in' && oauth.state !== 'in-progress') plan = planBlock(server, oauth.plan, updateButtons);
    const signInButton = (label: string, stepUp = false): HTMLButtonElement | null => {
      const shown = oauth.plan;
      if (!shown || !plan) return null; // the authorization server is not known yet: nothing to confirm
      const current = plan;
      const b: HTMLButtonElement = button(label, () => {
        const scopes = current.selection();
        if (scopes === null) return;
        void busy(b, () => signIn(server.id, rowStatus, shown, scopes, stepUp), (m) => rowStatus.set(m, 'error'));
      }, 'cc-button-confirm', { 'aria-label': `${label}: ${server.name}` });
      signInButtons.push(b);
      return b;
    };
    const retry = (): HTMLButtonElement => {
      const b: HTMLButtonElement = button('Check again', () => {
        void busy(b, () => reload(), (m) => rowStatus.set(m, 'error'));
      }, 'cc-button-subtle', { 'aria-label': `Check sign-in again: ${server.name}` });
      return b;
    };
    if (oauth.state === 'signed-in' || oauth.state === 'insufficient-scope') {
      if (oauth.state === 'insufficient-scope') buttons.push(signInButton('Sign in again', true) ?? retry());
      const out: HTMLButtonElement = button('Sign out', () => {
        void busy(out, async () => {
          await ctx.rpc('mcp.signOut', { id: server.id });
          rowStatus.set('Signed out', 'ok');
          await reload();
        }, (m) => rowStatus.set(m, 'error'));
      }, 'cc-button-subtle', { 'aria-label': `Sign out: ${server.name}` });
      buttons.push(out);
    } else if (oauth.state !== 'in-progress') {
      buttons.push(signInButton('Sign in') ?? retry());
    }
    updateButtons();
    return h(
      'div',
      { class: 'cc-mcp-oauth', data: { oauth: oauth.state } },
      h('div', { class: 'cc-row' }, h('span', { class: 'cc-pill', data: { tone: d.tone } }, d.pill), ...buttons),
      h('div', { class: 'cc-hint cc-break' }, d.text),
      plan?.el ?? null,
    );
  };

  const serverRow = (server: McpServerStatus): HTMLElement => {
    const rowStatus = statusLine();
    const state = h('span', { class: 'cc-pill', data: { state: server.state } }, server.state);
    const test = button('Test', () => {
      void busy(test, async () => {
        const res = testSummary(await ctx.rpc('mcp.test', { id: server.id }));
        rowStatus.set(res.text, res.ok ? 'ok' : 'error');
      }, (m) => rowStatus.set(m, 'error'));
    }, 'cc-button-subtle');
    let armed = false;
    const remove = button('Remove', () => {
      if (!armed) {
        armed = true;
        remove.textContent = 'Confirm remove';
        return;
      }
      void busy(remove, async () => {
        await ctx.rpc('mcp.remove', { id: server.id });
        await reload();
      }, (m) => rowStatus.set(m, 'error'));
    }, 'cc-button-subtle', { 'aria-label': `Remove ${server.name}` });
    const edit = button('Edit', () => openForm(server), 'cc-button-subtle', { 'aria-label': `Edit ${server.name}` });
    const enabled = checkbox('Enabled', server.enabled, (v) => {
      ctx.rpc('mcp.update', { id: server.id, patch: { enabled: v } }).then(reloadSafe, (err) => rowStatus.set(errorMessage(err), 'error'));
    });
    // The OAuth block explains a 401 better than the raw connection error.
    const authError = server.oauth && server.error && (server.error.status === 401 || server.error.status === 403);
    if (server.error && !authError) rowStatus.set(describeError(server.error).detail, 'error');
    return h(
      'div',
      { class: 'cc-mcp-server', data: { server: server.name } },
      h(
        'div',
        { class: 'cc-row' },
        h('strong', null, server.name),
        state,
        server.toolCount !== undefined ? h('span', { class: 'cc-pill' }, `${server.toolCount} tools`) : null,
        server.hasAuth ? h('span', { class: 'cc-pill' }, 'auth set') : null,
        server.trustReadOnlyHints ? h('span', { class: 'cc-pill' }, 'trusts read-only hints') : null,
      ),
      h('div', { class: 'cc-hint cc-break' }, server.url),
      server.serverInfo ? h('div', { class: 'cc-hint' }, `${server.serverInfo.name} ${server.serverInfo.version}`) : null,
      oauthBlock(server, rowStatus),
      h('div', { class: 'cc-row' }, enabled, test, edit, remove),
      rowStatus.el,
    );
  };

  const discoveredRow = (found: DiscoveredMcpServer): HTMLElement => {
    const rowStatus = statusLine();
    const auth =
      found.auth === 'oauth'
        ? h('span', { class: 'cc-pill', data: { tone: 'warn' } }, 'sign-in required')
        : found.auth === 'none'
          ? h('span', { class: 'cc-pill', data: { tone: 'ok' } }, 'no sign-in')
          : h('span', { class: 'cc-pill' }, 'sign-in unknown');
    const via = found.source === 'server-card' ? 'server card' : found.source === 'catalog' ? 'AI catalog' : 'OAuth metadata';
    const where = found.sameOrigin
      ? `On ${found.endpointHost} · found in this site's ${via}`
      : `On ${found.endpointHost} · a different host from ${hostOf(found.foundOn)}, whose ${via} names it`;
    const actions: HTMLElement[] = [];
    if (found.addedServerId) {
      actions.push(h('span', { class: 'cc-pill', data: { tone: 'ok' } }, 'added'));
    } else {
      const add: HTMLButtonElement = button('Add', () => {
        void busy(add, async () => {
          rowStatus.set('Adding…', 'muted');
          const added = await ctx.rpc('mcp.discovered.add', { key: found.key });
          const needsSignIn = added.oauth && added.oauth.state !== 'signed-in' && added.oauth.state !== 'in-progress';
          // Never straight into a sign-in window: the server's row shows where it signs in first.
          status.set(needsSignIn ? `Added "${added.name}". It needs sign-in: check where it signs you in, then click Sign in.` : `Added "${added.name}"`, 'ok');
          await reload();
        }, (m) => {
          // The list is rebuilt after a reload: report on the panel's status line.
          status.set(m, 'error');
          reloadSafe();
        });
      }, 'cc-button-confirm', { 'aria-label': `Add ${found.name}` });
      const dismiss: HTMLButtonElement = button('Dismiss', () => {
        void busy(dismiss, async () => {
          await ctx.rpc('mcp.discovered.dismiss', { key: found.key });
          await reloadDiscovered();
        }, (m) => rowStatus.set(m, 'error'));
      }, 'cc-button-subtle', { 'aria-label': `Dismiss ${found.name}` });
      actions.push(add, dismiss);
    }
    return h(
      'div',
      { class: 'cc-mcp-server', data: { discovered: found.key } },
      // The name is the site's claim; the host is not.
      h('div', { class: 'cc-row' }, h('strong', null, found.name), auth),
      found.name !== found.endpointHost ? h('div', { class: 'cc-hint' }, `“${found.name}” is the name the site gives it.`) : null,
      h('div', { class: 'cc-hint cc-break' }, where),
      h('div', { class: 'cc-hint cc-break' }, found.endpoint),
      found.description ? h('div', { class: 'cc-hint' }, found.description) : null,
      h('div', { class: 'cc-row' }, ...actions),
      rowStatus.el,
    );
  };

  const openForm = (existing?: McpServerStatus): void => {
    const formStatus = statusLine();
    const name = textInput(existing?.name ?? '', { placeholder: 'github' });
    const url = textInput(existing?.url ?? '', { placeholder: 'https://example.com/mcp', inputmode: 'url' });
    const token = h('input', { type: 'password', autocomplete: 'off', placeholder: existing?.hasAuth ? 'Leave empty to keep the saved auth' : 'Optional' });
    const headers = h('textarea', { rows: 2, placeholder: 'X-API-Key: …', spellcheck: 'false' });
    const clientId = textInput(existing?.oauthClientId ?? '', { placeholder: 'Optional' });
    let clearAuth = false;
    let trustHints = existing?.trustReadOnlyHints === true;
    const trustBox = checkbox(
      'Trust read-only hints',
      trustHints,
      (v) => (trustHints = v),
      'Off: every tool from this server asks before running (unless you allow it "always" in a chat). On: tools the server marks read-only run without asking. The server sets that mark, so only trust servers you control.',
    );
    const clearAuthBox = existing?.hasAuth ? checkbox('Remove saved auth', false, (v) => (clearAuth = v)) : null;

    const collect = (): { server: McpServerInput; auth: McpServerAuth | undefined } | null => {
      const server = validateServer(name.value.trim(), url.value.trim());
      if (typeof server === 'string') {
        formStatus.set(server, 'error');
        return null;
      }
      server.enabled = existing?.enabled ?? true;
      server.trustReadOnlyHints = trustHints;
      const id = clientId.value.trim();
      if (id && !/^[\x21-\x7e]{1,512}$/.test(id)) {
        formStatus.set('OAuth client ID: printable characters without spaces', 'error');
        return null;
      }
      if (id) server.oauthClientId = id;
      const parsed = parseHeaders(headers.value);
      if (typeof parsed === 'string') {
        formStatus.set(parsed, 'error');
        return null;
      }
      const auth: McpServerAuth = {};
      if (token.value.trim()) auth.bearerToken = token.value.trim();
      if (Object.keys(parsed).length) auth.headers = parsed;
      return { server, auth: Object.keys(auth).length ? auth : undefined };
    };

    const test = button('Test connection', () => {
      const input = collect();
      if (!input) return;
      void busy(test, async () => {
        // Unsaved values are tested directly; an existing server without new auth uses its saved auth.
        const res = testSummary(
          existing && !input.auth && !clearAuth
            ? await ctx.rpc('mcp.test', { server: input.server, authFrom: existing.id })
            : await ctx.rpc('mcp.test', { server: input.server, auth: input.auth }),
        );
        formStatus.set(res.text, res.ok ? 'ok' : 'error');
      }, (m) => formStatus.set(m, 'error'));
    });
    const save = button(existing ? 'Save' : 'Add server', () => {
      const input = collect();
      if (!input) return;
      void busy(save, async () => {
        let saved: McpServerStatus;
        if (existing) {
          saved = await ctx.rpc('mcp.update', {
            id: existing.id,
            patch: { name: input.server.name, url: input.server.url, trustReadOnlyHints: trustHints, oauthClientId: input.server.oauthClientId ?? '' },
            auth: input.auth ?? (clearAuth ? null : undefined),
          });
        } else {
          saved = await ctx.rpc('mcp.add', { server: input.server, auth: input.auth });
        }
        formHost.replaceChildren();
        status.set(
          saved.oauth?.state === 'required' ? `${existing ? 'Server updated' : 'Server added'}: it requires sign-in` : existing ? 'Server updated' : 'Server added',
          'ok',
        );
        await reload();
      }, (m) => formStatus.set(m, 'error'));
    }, 'cc-button-confirm');
    const cancel = button('Cancel', () => formHost.replaceChildren(), 'cc-button-subtle');

    formHost.replaceChildren(
      section(
        existing ? `Edit ${existing.name}` : 'Add MCP server',
        field('Name', name, 'Used in tool names: mcp__<name>__<tool>'),
        field('URL (Streamable HTTP)', url),
        field('Bearer token', token, 'Write-only: stored encrypted, never shown again. Leave empty for servers you sign in to.'),
        field('Extra headers', headers, 'One "Header: value" per line. Write-only.'),
        field(
          'OAuth client ID',
          clientId,
          `Only for servers whose sign-in does not allow automatic registration: register a client there with the redirect URI ${oauthRedirectUri()} and enter its ID.`,
        ),
        trustBox,
        clearAuthBox,
        h('div', { class: 'cc-row' }, save, test, cancel),
        formStatus.el,
      ),
    );
    name.focus();
  };

  const add = button('Add server', () => openForm());
  const forget: HTMLButtonElement = button('Forget discovered servers', () => {
    void busy(forget, async () => {
      await ctx.rpc('mcp.discovered.clear');
      await reloadDiscovered();
    }, (m) => status.set(m, 'error'));
  }, 'cc-button-subtle');

  const discoveryToggle = (): HTMLElement =>
    checkbox(
      'Look for MCP servers on sites I visit',
      ctx.settings().mcpDiscovery,
      (v) => {
        ctx.save({ mcpDiscovery: v }).then(() => reloadDiscovered(), (err) => status.set(errorMessage(err), 'error'));
      },
      'When on, each site you open is asked about once a day whether it offers an MCP server: up to three requests to ' +
        "that site's own /.well-known/ addresses (its AI catalog, OAuth metadata and, without a catalog, its server card), " +
        'sent without cookies; only when one names an MCP server on the same site, a request for its card and one test ' +
        'request to it (which tells the site that this extension is installed). Not done in incognito windows. Servers ' +
        'found are only listed here; nothing is added until you click Add.',
    );

  return {
    id: 'mcp',
    title: 'MCP',
    el,
    refresh() {
      el.replaceChildren(
        section('MCP servers', listEl, h('div', { class: 'cc-row' }, add)),
        formHost,
        section('Discovered', discoveryToggle(), discoveredEl, h('div', { class: 'cc-row' }, forget)),
        status.el,
      );
      reloadSafe();
    },
    onSettings() {
      if (!el.contains(document.activeElement)) reloadSafe();
    },
  };
}
