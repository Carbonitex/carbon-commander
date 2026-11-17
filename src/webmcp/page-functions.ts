/**
 * Functions the worker injects into the page's MAIN world (`chrome.scripting.executeScript`) to
 * read and run the page's WebMCP tools through the API's own consumer methods,
 * `document.modelContext.getTools()` / `executeTool()`: Chrome's native implementation or ours
 * (`page-api.ts`), whichever the page has.
 *
 * This is the whole bridge. It is pull-only: the worker asks, the page answers through the return
 * value of a script the worker started. Nothing in the extension listens to the page, so a page
 * cannot send the extension anything unasked. The page fully controls what these functions see
 * (it can replace `document.modelContext` or patch built-ins), so everything they return is
 * treated as hostile data and validated again in the worker (`sanitize.ts`); here they only keep
 * the transfer small and plain (strings, numbers, booleans).
 *
 * They are serialised with `Function.prototype.toString`: self-contained, no imports, no closures.
 */

/** Limits applied in the page before anything is sent back (re-checked in the worker). */
export interface PageListLimits {
  /** Entries looked at (valid or not). */
  maxScan: number;
  maxNameChars: number;
  maxTitleChars: number;
  maxDescriptionChars: number;
  maxSchemaChars: number;
}

/** One tool as read in the page. `inputSchema`: JSON text, null = none, false = unusable / too large. */
export interface RawPageTool {
  name: string;
  title: string | null;
  description: string;
  inputSchema: string | null | false;
  readOnlyHint: boolean;
}

export interface RawPageToolList {
  origin: string;
  /** `document.modelContext` with `getTools` exists. */
  api: boolean;
  tools: RawPageTool[];
  /** Entries skipped in the page (bad shape, too long, over `maxScan`). */
  skipped: number;
}

export type RawCallOutcome =
  | { kind: 'ok'; text: string | null; length: number }
  | { kind: 'error'; name: string; message: string }
  | { kind: 'missing' }
  | { kind: 'moved' }
  | { kind: 'no-api' };

// Running calls are kept in a page-visible map, `window[Symbol.for('carbon-commander.webmcp.calls')]`,
// so a later injection (`abortPageCall`) can abort one. A page can only use it to abort calls of
// its own tools.

export async function listPageTools(limits: PageListLimits): Promise<RawPageToolList> {
  const origin = location.origin;
  const out: RawPageToolList = { origin, api: false, tools: [], skipped: 0 };
  let list: unknown;
  try {
    const mc = (document as unknown as { modelContext?: { getTools?: () => Promise<unknown> } }).modelContext;
    if (!mc || typeof mc.getTools !== 'function') return out;
    out.api = true;
    list = await mc.getTools();
  } catch {
    return out;
  }
  if (!Array.isArray(list)) return out;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    if (i >= limits.maxScan) {
      out.skipped += n - i;
      break;
    }
    try {
      const t = list[i] as Record<string, unknown>;
      const name = t.name;
      const description = t.description;
      const title = t.title;
      if (typeof name !== 'string' || name.length > limits.maxNameChars || typeof description !== 'string') {
        out.skipped++;
        continue;
      }
      let inputSchema: string | null | false = null;
      const schema = t.inputSchema;
      if (schema !== null && schema !== undefined) {
        const text: unknown = JSON.stringify(schema);
        inputSchema = typeof text === 'string' && text.length <= limits.maxSchemaChars ? text : false;
      }
      const annotations = t.annotations as Record<string, unknown> | null | undefined;
      out.tools.push({
        name,
        title: typeof title === 'string' ? title.slice(0, limits.maxTitleChars + 1) : null,
        description: description.slice(0, limits.maxDescriptionChars + 1),
        inputSchema,
        readOnlyHint: !!annotations && typeof annotations === 'object' && annotations.readOnlyHint === true,
      });
    } catch {
      out.skipped++;
    }
  }
  return out;
}

export async function callPageTool(
  name: string,
  input: Record<string, unknown>,
  expectedOrigin: string,
  callId: string,
  maxChars: number,
): Promise<RawCallOutcome> {
  // Same document as listed (the worker targets its documentId), but check the origin anyway.
  if (location.origin !== expectedOrigin) return { kind: 'moved' };
  const key = Symbol.for('carbon-commander.webmcp.calls');
  let calls: Map<string, AbortController>;
  try {
    const existing = (window as unknown as Record<symbol, unknown>)[key];
    if (existing instanceof Map) calls = existing as Map<string, AbortController>;
    else {
      calls = new Map();
      Object.defineProperty(window, key, { value: calls, configurable: true });
    }
  } catch {
    calls = new Map();
  }
  const controller = new AbortController();
  try {
    calls.set(callId, controller);
  } catch {
    // A page that broke Map only breaks aborting its own tool.
  }
  try {
    const mc = (document as unknown as {
      modelContext?: { getTools?: () => Promise<unknown>; executeTool?: (t: unknown, i: unknown, o: unknown) => Promise<unknown> };
    }).modelContext;
    if (!mc || typeof mc.getTools !== 'function' || typeof mc.executeTool !== 'function') return { kind: 'no-api' };
    const tools: unknown = await mc.getTools();
    let tool: unknown = null;
    if (Array.isArray(tools)) {
      for (let i = 0; i < tools.length; i++) {
        const t = tools[i] as { name?: unknown } | null;
        if (t && t.name === name) {
          tool = t;
          break;
        }
      }
    }
    if (!tool) return { kind: 'missing' };
    const result: unknown = await mc.executeTool(tool, input, { signal: controller.signal });
    // Chrome resolves with null when the tool navigated the page.
    if (typeof result !== 'string') return { kind: 'ok', text: null, length: 0 };
    return { kind: 'ok', text: result.length > maxChars ? result.slice(0, maxChars) : result, length: result.length };
  } catch (err) {
    let errName = 'Error';
    let message = '';
    try {
      const e = err as { name?: unknown; message?: unknown } | null;
      errName = String(e && typeof e === 'object' ? e.name : 'Error').slice(0, 64);
      message = String(e && typeof e === 'object' && 'message' in e ? e.message : err).slice(0, 2000);
    } catch {
      // unreadable error
    }
    return { kind: 'error', name: errName, message };
  } finally {
    try {
      calls.delete(callId);
    } catch {
      // ignore
    }
  }
}

export function abortPageCall(callId: string): boolean {
  try {
    const calls = (window as unknown as Record<symbol, unknown>)[Symbol.for('carbon-commander.webmcp.calls')];
    if (!(calls instanceof Map)) return false;
    const controller: unknown = calls.get(callId);
    if (!(controller instanceof AbortController)) return false;
    controller.abort(new DOMException('Cancelled by the user', 'AbortError'));
    return true;
  } catch {
    return false;
  }
}
