/**
 * Registers / unregisters the MAIN-world `webmcp.js` script (see `page-api.ts`) to follow
 * `Settings.webmcp`.
 *
 * Why dynamic registration and not a static manifest entry: a `document_start` script must decide
 * synchronously, before any page script runs, whether to install the API, and a MAIN-world script
 * cannot read extension storage (and an async read would come too late). With
 * `chrome.scripting.registerContentScripts`, Chrome itself injects the script only while it is
 * registered: when the setting is off it is unregistered and nothing is injected at all. The
 * registration persists across browser restarts and extension updates, and the worker reconciles
 * it with the setting on every start and on every settings change; a registration that differs
 * from `WEBMCP_CONTENT_SCRIPT` (e.g. left by an older version) is replaced. Pages already open keep
 * what they had until they reload (with the setting off the worker neither lists nor calls their
 * tools).
 */
import { createLogger } from '../shared/logger';

const log = createLogger('webmcp');

export const WEBMCP_SCRIPT_ID = 'cc-webmcp';
export const WEBMCP_SCRIPT_FILE = 'webmcp.js';

/** The slice of `chrome.scripting` used here (faked in tests). */
export interface ScriptRegistry {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<chrome.scripting.RegisteredContentScript[]>;
  registerContentScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

export const WEBMCP_CONTENT_SCRIPT: chrome.scripting.RegisteredContentScript = {
  id: WEBMCP_SCRIPT_ID,
  js: [WEBMCP_SCRIPT_FILE],
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: false,
  persistAcrossSessions: true,
};

/**
 * Returns `sync(enabled)`: makes the registration match `enabled`. Calls are serialised (two
 * overlapping registrations would fail with a duplicate id). Never rejects.
 */
export function createWebMcpScriptSync(registry?: ScriptRegistry): (enabled: boolean) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  const api = (): ScriptRegistry => registry ?? chrome.scripting;
  return (enabled) => {
    queue = queue.then(async () => {
      try {
        const [current] = await api().getRegisteredContentScripts({ ids: [WEBMCP_SCRIPT_ID] });
        if (current && (!enabled || !sameScript(current, WEBMCP_CONTENT_SCRIPT))) {
          await api().unregisterContentScripts({ ids: [WEBMCP_SCRIPT_ID] });
        }
        if (enabled && (!current || !sameScript(current, WEBMCP_CONTENT_SCRIPT))) await api().registerContentScripts([WEBMCP_CONTENT_SCRIPT]);
      } catch (err) {
        log.warn('Could not update the WebMCP page script registration', err);
      }
    });
    return queue;
  };
}

/** Same registration, as far as this module sets it (absent booleans read as Chrome's defaults). */
function sameScript(a: chrome.scripting.RegisteredContentScript, b: chrome.scripting.RegisteredContentScript): boolean {
  const list = (v: string[] | undefined): string => JSON.stringify(v ?? []);
  return (
    list(a.js) === list(b.js) &&
    list(a.matches) === list(b.matches) &&
    list(a.excludeMatches) === list(b.excludeMatches) &&
    (a.runAt ?? 'document_idle') === (b.runAt ?? 'document_idle') &&
    (a.world ?? 'ISOLATED') === (b.world ?? 'ISOLATED') &&
    (a.allFrames ?? false) === (b.allFrames ?? false) &&
    (a.matchOriginAsFallback ?? false) === (b.matchOriginAsFallback ?? false) &&
    (a.persistAcrossSessions ?? true) === (b.persistAcrossSessions ?? true)
  );
}
