/**
 * Dev-only fake worker for `bar.html?mock=1`: an in-page port that plays a scripted session
 * (streaming markdown, a tool call that needs confirmation, a read-only tool with an image, usage)
 * and in-memory RPC handlers. Type "error" or "nokey" to see error states. Only bundled when
 * `__DEV__` (bar.ts guards the import path), so production builds drop it.
 */
import { MODEL_ROLES, PROVIDER_IDS, PROVIDERS, defaultSettings } from '../shared/defaults';
import type { RpcMethod, SwToUiMessage, UiToSwMessage } from '../shared/protocol';
import type {
  McpServerStatus,
  ModelInfo,
  SecretName,
  SessionState,
  Settings,
  SettingsPatch,
  ToolInfo,
  ToolItem,
  Usage,
} from '../shared/types';
import { CcError } from '../shared/types';
import type { PortLike, Rpc } from './connection';
import type { UiEnv } from './env';

// 8x8 purple PNG.
const PNG_8x8 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNIM56JFTEMLQkA17tMgW5G47AAAAAASUVORK5CYII=';

const ANSWER = `Here is what I found on **this page**:

1. The headline is *"Example Domain"*.
2. There is one link: [More information](https://example.com/more).

\`\`\`js
// HTML inside code stays text: <script>alert(1)</script>
const answer = 42;
\`\`\`

Sanitiser check (should be inert): <img src=x onerror=alert(1)> [bad link](javascript:alert(1))

| Field | Value |
|-------|-------|
| Title | Example Domain |
| Links | 1 |
`;

interface MockState {
  session: SessionState;
  settings: Settings;
  secrets: Set<SecretName>;
  mcp: McpServerStatus[];
  listeners: Set<(m: unknown) => void>;
}

const usage = (p: number, c: number, cost?: number): Usage => ({ promptTokens: p, completionTokens: c, totalTokens: p + c, ...(cost === undefined ? {} : { cost }) });

function newSession(): SessionState {
  return { tabId: 1, status: 'idle', runId: null, items: [], messages: [], pendingConfirm: null, alwaysAllow: [], usage: usage(0, 0), updatedAt: Date.now() };
}

function mergeSettings(s: Settings, patch: SettingsPatch): Settings {
  const next = structuredClone(s);
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'providers' || k === 'models') continue;
    (next as unknown as Record<string, unknown>)[k] = v;
  }
  for (const id of PROVIDER_IDS) if (patch.providers?.[id]) Object.assign(next.providers[id], patch.providers[id]);
  for (const role of MODEL_ROLES) if (patch.models?.[role]) next.models[role] = { ...patch.models[role] };
  return next;
}

const MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', contextLength: 1_000_000, supportsTools: true, supportsImages: true, pricing: { prompt: 2, completion: 10 } },
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5', contextLength: 200_000, supportsTools: true, supportsImages: true, pricing: { prompt: 0.1, completion: 0.5 } },
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', contextLength: 1_000_000, supportsTools: true, supportsImages: true, pricing: { prompt: 0.83, completion: 4.12 } },
  { id: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', contextLength: 1_000_000, supportsTools: true, pricing: { prompt: 0.3, completion: 2.5 } },
  { id: 'example/no-tools-model', name: 'Example (no tools)', contextLength: 8192, supportsTools: false, pricing: { prompt: 0, completion: 0 } },
];

const TOOLS: ToolInfo[] = [
  { name: 'read_page', description: 'Read the visible text of the page.', sourceId: 'builtin', sourceLabel: 'Built-in', mutates: false, egress: false, enabled: true },
  { name: 'click', description: 'Click an element.', sourceId: 'builtin', sourceLabel: 'Built-in', mutates: true, egress: false, enabled: true },
  { name: 'mcp__docs__search', description: 'Search the docs.', sourceId: 'mcp', sourceLabel: 'MCP: docs', mutates: false, egress: false, enabled: true },
];

export function createMockEnv(): UiEnv {
  const st: MockState = { session: newSession(), settings: defaultSettings(), secrets: new Set(), mcp: [], listeners: new Set() };
  let timers: ReturnType<typeof setTimeout>[] = [];
  let confirmWaiter: ((allow: boolean) => void) | null = null;
  let runCounter = 0;

  const emit = (m: SwToUiMessage): void => {
    applyToMock(m);
    for (const l of st.listeners) l(structuredClone(m));
  };
  const applyToMock = (m: SwToUiMessage): void => {
    // Keep a server-side copy so re-attach replays the transcript.
    const s = st.session;
    if (m.type === 'run.started') Object.assign(s, { status: 'running', runId: m.runId, items: [...s.items, m.item] });
    else if (m.type === 'assistant.delta') {
      const item = s.items.find((i) => i.id === m.itemId);
      if (item?.kind === 'assistant') item.text += m.text;
      else s.items.push({ kind: 'assistant', id: m.itemId, text: m.text, at: Date.now() });
    } else if (m.type === 'tool.start') s.items.push(structuredClone(m.item));
    else if (m.type === 'tool.update' || m.type === 'tool.end') {
      const item = s.items.find((i) => i.id === m.itemId);
      if (item?.kind === 'tool') {
        item.status = m.status;
        if (m.type === 'tool.end') item.result = m.result;
      }
    } else if (m.type === 'confirm.request') Object.assign(s, { status: 'awaiting-confirm', pendingConfirm: m.request });
    else if (m.type === 'confirm.resolved') Object.assign(s, { status: 'running', pendingConfirm: null });
    else if (m.type === 'run.end') Object.assign(s, { status: 'idle', runId: null, pendingConfirm: null, usage: { ...s.usage, promptTokens: s.usage.promptTokens + m.usage.promptTokens, completionTokens: s.usage.completionTokens + m.usage.completionTokens, totalTokens: s.usage.totalTokens + m.usage.totalTokens, cost: (s.usage.cost ?? 0) + (m.usage.cost ?? 0) } });
    else if (m.type === 'run.error' && m.runId) Object.assign(s, { status: 'idle', runId: null, pendingConfirm: null, items: [...s.items, { kind: 'error', id: `e${Date.now()}`, error: m.error, at: Date.now() }] });
  };

  const later = (ms: number, fn: () => void): void => {
    timers.push(setTimeout(fn, ms));
  };
  const stopTimers = (): void => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const waitConfirm = (): Promise<boolean> => new Promise((resolve) => (confirmWaiter = resolve));

  const stream = (runId: string, itemId: string, text: string, start: number): number => {
    const chunks = text.match(/[\s\S]{1,6}/g) ?? [];
    chunks.forEach((chunk, i) => later(start + i * 15, () => emit({ type: 'assistant.delta', runId, itemId, text: chunk })));
    return start + chunks.length * 15;
  };

  const run = async (text: string): Promise<void> => {
    const runId = `run-${++runCounter}`;
    emit({ type: 'run.started', runId, item: { kind: 'user', id: `u-${runId}`, text, at: Date.now() } });
    if (/nokey/i.test(text)) {
      later(200, () => emit({ type: 'run.error', runId, error: { code: 'no-key', message: 'OpenRouter needs an API key' } }));
      return;
    }
    if (/error/i.test(text)) {
      later(300, () => emit({ type: 'run.error', runId, error: { code: 'http', status: 502, message: 'Upstream model unavailable' } }));
      return;
    }
    const t1 = stream(runId, `a1-${runId}`, 'Let me look at the page first.', 50);
    const click: ToolItem = { kind: 'tool', id: `t1-${runId}`, name: 'click', args: { selector: '#more', label: 'More information <b>' }, sourceLabel: 'Built-in', status: 'pending-confirm', at: Date.now() };
    await new Promise((r) => later(t1 + 100, () => r(undefined)));
    if (st.session.runId !== runId) return;
    emit({ type: 'tool.start', runId, item: click });
    emit({ type: 'confirm.request', runId, request: { id: `c-${runId}`, toolCallId: click.id, toolName: 'click', args: click.args, sourceLabel: 'Built-in' } });
    const allow = await waitConfirm();
    if (st.session.runId !== runId) return;
    emit({ type: 'confirm.resolved', runId, id: `c-${runId}`, allow });
    if (allow) {
      emit({ type: 'tool.update', runId, itemId: click.id, status: 'running' });
      await new Promise((r) => later(600, () => r(undefined)));
      if (st.session.runId !== runId) return;
      emit({ type: 'tool.end', runId, itemId: click.id, status: 'ok', result: { ok: true, content: 'Clicked <a id="more">More information</a>' } });
    } else {
      emit({ type: 'tool.end', runId, itemId: click.id, status: 'denied', result: { ok: false, content: 'The user denied this action.' } });
    }
    const read: ToolItem = { kind: 'tool', id: `t2-${runId}`, name: 'screenshot', args: {}, sourceLabel: 'Built-in', status: 'running', at: Date.now() };
    emit({ type: 'tool.start', runId, item: read });
    await new Promise((r) => later(500, () => r(undefined)));
    if (st.session.runId !== runId) return;
    emit({ type: 'tool.end', runId, itemId: read.id, status: 'ok', result: { ok: true, content: 'Captured the visible area (8x8).', images: [{ mime: 'image/png', base64: PNG_8x8 }] } });
    const t2 = stream(runId, `a2-${runId}`, ANSWER, 50);
    later(t2 + 50, () => emit({ type: 'run.end', runId, reason: 'complete', usage: usage(1834, 212, 0.0058) }));
  };

  const handle = (m: UiToSwMessage): void => {
    switch (m.type) {
      case 'session.attach':
        later(30, () => emit({ type: 'session.state', state: structuredClone(st.session) }));
        break;
      case 'run.start':
        if (st.session.status !== 'idle') emit({ type: 'run.error', runId: null, error: { code: 'busy', message: 'A run is already active' } });
        else void run(m.text);
        break;
      case 'run.abort':
        if (st.session.runId) {
          const runId = st.session.runId;
          stopTimers();
          confirmWaiter = null;
          emit({ type: 'run.end', runId, reason: 'aborted', usage: usage(120, 8) });
        }
        break;
      case 'confirm.reply':
        if (st.session.pendingConfirm?.id === m.id && confirmWaiter) {
          if (m.always) st.session.alwaysAllow.push({ tool: st.session.pendingConfirm.toolName, origin: st.session.pendingConfirm.origin ?? '' });
          const w = confirmWaiter;
          confirmWaiter = null;
          w(m.allow);
        }
        break;
      case 'session.clear':
        stopTimers();
        confirmWaiter = null;
        st.session = newSession();
        emit({ type: 'session.state', state: structuredClone(st.session) });
        break;
      case 'ping':
        break;
    }
  };

  const connect = (): PortLike => {
    const messageListeners: ((m: unknown) => void)[] = [];
    const listener = (m: unknown): void => messageListeners.forEach((l) => l(m));
    st.listeners.add(listener);
    return {
      postMessage: (m) => setTimeout(() => handle(structuredClone(m)), 0),
      disconnect: () => st.listeners.delete(listener),
      onMessage: { addListener: (cb) => messageListeners.push(cb) },
      onDisconnect: { addListener: () => undefined },
    };
  };

  const broadcastSettings = (): void => emit({ type: 'settings.changed', settings: structuredClone(st.settings) });

  const handlers: { [M in RpcMethod]?: (params: never) => unknown } = {
    'settings.get': () => st.settings,
    'settings.set': ({ patch }: { patch: SettingsPatch }) => {
      st.settings = mergeSettings(st.settings, patch);
      broadcastSettings();
      return st.settings;
    },
    'settings.reset': () => {
      st.settings = defaultSettings();
      broadcastSettings();
      return st.settings;
    },
    'secrets.set': ({ name }: { name: SecretName }) => void st.secrets.add(name),
    'secrets.has': ({ name }: { name: SecretName }) => st.secrets.has(name),
    'secrets.delete': ({ name }: { name: SecretName }) => void st.secrets.delete(name),
    'providers.status': ({ check }: { check?: boolean }) =>
      PROVIDER_IDS.map((id) => ({
        id,
        label: id === 'custom' ? st.settings.providers.custom.label : PROVIDERS[id].label,
        baseUrl: st.settings.providers[id].baseUrl,
        needsKey: PROVIDERS[id].needsKey,
        hasKey: st.secrets.has(PROVIDERS[id].keyName),
        ...(check ? (id === 'openrouter' ? { reachable: true } : { reachable: false, error: { code: 'network' as const, message: 'Failed to fetch' } }) : {}),
      })),
    'models.list': ({ provider }: { provider: string }) => {
      if (provider === 'ollama') return [{ id: 'llama3.3:latest', name: 'llama3.3:latest' }, { id: 'qwen3:8b', name: 'qwen3:8b' }];
      if (provider === 'custom') throw new CcError('network', 'Failed to fetch');
      return MODELS;
    },
    'mcp.list': () => st.mcp,
    'mcp.add': ({ server, auth }: { server: McpServerStatus; auth?: unknown }) => {
      const s: McpServerStatus = { ...server, id: `m${st.mcp.length + 1}`, hasAuth: !!auth, state: server.enabled ? 'connected' : 'disabled', toolCount: 3, serverInfo: { name: 'mock-mcp', version: '1.0.0' } };
      st.mcp.push(s);
      return s;
    },
    'mcp.update': ({ id, patch, auth }: { id: string; patch: Partial<McpServerStatus>; auth?: unknown }) => {
      const s = st.mcp.find((x) => x.id === id);
      if (!s) throw new CcError('invalid', 'Unknown server');
      Object.assign(s, patch);
      if (auth === null) s.hasAuth = false;
      else if (auth) s.hasAuth = true;
      s.state = s.enabled ? 'connected' : 'disabled';
      return s;
    },
    'mcp.remove': ({ id }: { id: string }) => void (st.mcp = st.mcp.filter((x) => x.id !== id)),
    'mcp.test': () => ({ ok: true, serverInfo: { name: 'mock-mcp', version: '1.0.0' }, protocolVersion: '2025-06-18', tools: [{ name: 'search', description: '' }] }),
    'tools.list': () => TOOLS.map((t) => ({ ...t, enabled: !st.settings.disabledTools.includes(t.name) })),
    'webmcp.status': () => ({ enabled: st.settings.webmcp, count: st.settings.webmcp ? 2 : 0, host: 'example.com' }),
    autocomplete: ({ text }: { text: string }) => ({ text, suggestions: [`${text} and summarise it`, 'Summarise this page', 'List the links on this page'] }),
  };

  const rpc = (async (method: RpcMethod, params?: unknown) => {
    await new Promise((r) => setTimeout(r, 60));
    const handler = handlers[method] as ((p: unknown) => unknown) | undefined;
    if (!handler) throw new CcError('not-implemented', `RPC ${method} is not implemented`);
    return structuredClone(await handler(params ?? {}));
  }) as Rpc;

  const historyStore: string[] = ['What is on this page?', 'Summarise this page'];
  return {
    rpc,
    connect,
    isContextValid: () => true,
    tabId: 1,
    mock: true,
    loadHistory: async () => historyStore.slice(),
    saveHistory: async (entries) => void historyStore.splice(0, historyStore.length, ...entries),
  };
}
