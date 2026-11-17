/**
 * A small implementation of WebMCP's `document.modelContext` for browsers without it, injected
 * into the page's MAIN world at `document_start` (bundled alone as `webmcp.js`, registered by the
 * worker only while `Settings.webmcp` is on; see `register.ts`).
 *
 * Revision implemented: WebMCP, W3C Web Machine Learning CG, Draft Community Group Report of
 * 13 November 2026 (https://webmachinelearning.github.io/webmcp/): the imperative API only.
 *
 * - `partial interface Document { readonly attribute ModelContext modelContext; }` (secure
 *   contexts only). The declarative form attributes are not implemented here (Chrome's native API
 *   has them).
 * - `registerTool(tool, { signal })` validates like the draft (name `[A-Za-z0-9_.-]{1,128}`,
 *   non-empty description, unique name; schemas are JSON-serialised at registration) and rejects
 *   (never throws) with the same exception types as Chrome; aborting `signal` unregisters.
 * - `getTools()` returns the registered tools sorted by name; `executeTool(tool, input, { signal })`
 *   runs `execute(input, { signal })` and resolves with the result serialised to a string (strings
 *   as they are, anything else as JSON), like Chrome.
 * - `toolchange` fires (as a task) after every registration change.
 *
 * **Compatibility shim** (not in the current draft): pages written for the earlier drafts and
 * Chrome's early preview (spec text up to March 2026) use `navigator.modelContext` with
 * `provideContext({ tools })` (replaces every tool), `clearContext()`, `registerTool(tool)` and
 * `unregisterTool(name)`, all synchronous (throwing `InvalidStateError` / `TypeError`), and tools
 * whose `execute(input, client)` gets a `ModelContextClient` with `requestUserInteraction(cb)`
 * and returns a string or an MCP-style `{ content: [{ type: 'text', text }] }`. When this file
 * installs `document.modelContext`, it also installs that `navigator.modelContext` (unless the
 * page's navigator already has one), as a second view of the same tool set: tools registered
 * either way are listed and run alike. `requestUserInteraction(cb)` just runs `cb` (the page shows
 * its own UI; the user already confirmed the call in the extension). Results go through
 * `executeTool`'s JSON serialisation; the worker unpacks MCP-style results.
 *
 * When the browser already has the API (`document.modelContext` exists), nothing is changed (no
 * shim either): the worker then uses the native `getTools` / `executeTool`. Nothing here talks to the extension;
 * the worker reads tools through `chrome.scripting.executeScript` (see `page-functions.ts`). This
 * file never throws into page code.
 */

interface ToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
  consequentialHint: boolean;
  debugging: boolean;
}

interface Registration {
  name: string;
  title: string | null;
  description: string;
  /** JSON text, serialised at registration (later changes to the page's object do not count). */
  inputSchema: string | null;
  outputSchema: string | null;
  annotations: ToolAnnotations;
  execute: (input: object, options: { signal: AbortSignal }) => unknown;
}

/** The record `getTools()` hands out; `executeTool` only accepts records it handed out. */
interface RegisteredTool {
  readonly name: string;
  readonly title: string | null;
  readonly description: string;
  readonly inputSchema: object | null;
  readonly outputSchema: object | null;
  readonly annotations: ToolAnnotations;
  readonly window: Window;
  readonly origin: string;
}

export type InstallResult = 'installed' | 'native' | 'skipped';

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const ANNOTATION_KEYS = ['readOnlyHint', 'untrustedContentHint', 'consequentialHint', 'debugging'] as const;
const EVENT_TYPES = ['toolchange', 'toolactivated', 'toolcancel'] as const;

type PageWindow = Window & typeof globalThis;

/** Installs `document.modelContext` on `win` unless it exists already. Never throws. */
export function installModelContext(win: PageWindow): InstallResult {
  try {
    const doc = win.document;
    // Top-level documents of secure contexts only (the draft: [SecureContext]).
    if (!doc || win.top !== win || win.isSecureContext === false) return 'skipped';
    const DocumentProto = win.Document.prototype;
    if ('modelContext' in DocumentProto || 'modelContext' in doc) return 'native';

    // Captured before any page script runs, so later page changes to these globals do not matter.
    const { JSON: Json, Promise: PromiseCtor, DOMException: DomException, TypeError: TypeErrorCtor, Event: EventCtor } = win;
    const stringify = Json.stringify.bind(Json);
    const parse = Json.parse.bind(Json);
    const defineProperty = Object.defineProperty;
    const freeze = Object.freeze;
    const setTimer = win.setTimeout.bind(win);
    const AbortCtrl = win.AbortController;
    /* eslint-disable @typescript-eslint/unbound-method -- captured to be called with .call() on our instance */
    const dispatch = win.EventTarget.prototype.dispatchEvent;
    const addListener = win.EventTarget.prototype.addEventListener;
    /* eslint-enable @typescript-eslint/unbound-method */

    const tools = new Map<string, Registration>();
    const issued = new WeakSet<object>();
    const handlers = new Map<string, unknown>();
    const internal = Symbol('ModelContext');
    let instance: ModelContext | null = null;

    // Rejection reasons pass through as the page gave them (e.g. an AbortSignal's reason), like the platform does.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const reject = (error: unknown): Promise<never> => PromiseCtor.reject(error);
    const invalidState = (message: string): DOMException => new DomException(message, 'InvalidStateError');

    const fire = (type: string): void => {
      setTimer(() => {
        try {
          if (instance) dispatch.call(instance, new EventCtor(type));
        } catch {
          // A page listener threw: not our concern.
        }
      }, 0);
    };

    /** JSON text of a schema member (dictionary `object` conversion + JSON serialisation). */
    const schemaText = (value: unknown, member: string): string | null => {
      if (value === undefined) return null;
      if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
        throw new TypeErrorCtor(`Failed to read the '${member}' property from 'ModelContextTool': The provided value is not of type 'object'.`);
      }
      let text: unknown;
      try {
        text = stringify(value);
      } catch {
        throw new TypeErrorCtor(`Failed to serialize '${member}' to JSON.`);
      }
      if (typeof text !== 'string') throw new TypeErrorCtor(`Failed to serialize '${member}' to JSON.`);
      return text;
    };

    const unregister = (name: string): void => {
      if (tools.delete(name)) fire('toolchange');
    };

    /**
     * Read a `ModelContextTool` dictionary (members once, in the IDL's alphabetical order; schemas
     * JSON-serialised now). Throws `TypeError` like WebIDL conversion; semantic checks are in `check`.
     */
    const readTool = (tool: unknown, method: string): Registration => {
      if (typeof tool !== 'object' || tool === null) {
        throw new TypeErrorCtor(`Failed to execute '${method}' on 'ModelContext': parameter 1 is not of type 'ModelContextTool'.`);
      }
      const t = tool as Record<string, unknown>;
      const annotationsRaw = t.annotations;
      const descriptionRaw = t.description;
      const execute = t.execute;
      const inputSchemaRaw = t.inputSchema;
      const nameRaw = t.name;
      const outputSchemaRaw = t.outputSchema;
      const titleRaw = t.title;
      if (descriptionRaw === undefined) throw new TypeErrorCtor("Required member 'description' is undefined.");
      if (typeof execute !== 'function') throw new TypeErrorCtor("Required member 'execute' is not a function.");
      if (nameRaw === undefined) throw new TypeErrorCtor("Required member 'name' is undefined.");
      const annotations: ToolAnnotations = { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false, debugging: false };
      if (annotationsRaw !== undefined && annotationsRaw !== null) {
        if (typeof annotationsRaw !== 'object') throw new TypeErrorCtor("Member 'annotations' is not an object.");
        for (const key of ANNOTATION_KEYS) annotations[key] = Boolean((annotationsRaw as Record<string, unknown>)[key]);
      }
      // WebIDL DOMString conversion is String(): page objects with toString() are accepted, like natively.
      /* eslint-disable @typescript-eslint/no-base-to-string */
      const description = String(descriptionRaw);
      const inputSchema = schemaText(inputSchemaRaw, 'inputSchema');
      const name = String(nameRaw);
      const outputSchema = schemaText(outputSchemaRaw, 'outputSchema');
      const title = titleRaw === undefined ? null : String(titleRaw);
      /* eslint-enable @typescript-eslint/no-base-to-string */
      return { name, title, description, inputSchema, outputSchema, annotations, execute: execute as Registration['execute'] };
    };
    /** The draft's checks after conversion: an error message for `InvalidStateError`, or null. */
    const check = (r: Registration): string | null => {
      if (!TOOL_NAME.test(r.name)) return 'Invalid tool name';
      if (r.description === '') return 'Tool description must not be empty';
      if (tools.has(r.name)) return `A tool named "${r.name}" is already registered`;
      return null;
    };

    class ModelContext extends win.EventTarget {
      constructor(token?: unknown) {
        if (token !== internal) throw new TypeErrorCtor('Illegal constructor');
        super();
      }

      registerTool(tool: unknown, options?: unknown): Promise<undefined> {
        try {
          if (this !== instance) return reject(new TypeErrorCtor('Illegal invocation'));
          const registration = readTool(tool, 'registerTool');
          let signal: AbortSignal | null = null;
          if (options !== undefined && options !== null) {
            if (typeof options !== 'object') return reject(new TypeErrorCtor('parameter 2 is not of type ModelContextRegisterToolOptions.'));
            const s = (options as { signal?: unknown }).signal;
            if (s !== undefined) {
              if (!(s instanceof win.AbortSignal)) return reject(new TypeErrorCtor("Member 'signal' is not of type 'AbortSignal'."));
              signal = s;
            }
          }
          const problem = check(registration);
          if (problem) return reject(invalidState(problem));
          if (signal?.aborted) return reject(signal.reason);
          const { name } = registration;
          tools.set(name, registration);
          signal?.addEventListener(
            'abort',
            () => {
              if (tools.get(name) === registration) unregister(name);
            },
            { once: true },
          );
          fire('toolchange');
          return PromiseCtor.resolve(undefined);
        } catch (err) {
          return reject(err);
        }
      }

      getTools(_options?: unknown): Promise<RegisteredTool[]> {
        try {
          if (this !== instance) return reject(new TypeErrorCtor('Illegal invocation'));
          const origin = win.location.origin;
          const out: RegisteredTool[] = [];
          for (const name of [...tools.keys()].sort()) {
            const r = tools.get(name);
            if (!r) continue;
            const record: RegisteredTool = freeze({
              name: r.name,
              title: r.title,
              description: r.description,
              inputSchema: r.inputSchema === null ? null : (parse(r.inputSchema) as object),
              outputSchema: r.outputSchema === null ? null : (parse(r.outputSchema) as object),
              annotations: freeze({ ...r.annotations }),
              window: win,
              origin,
            });
            issued.add(record);
            out.push(record);
          }
          return PromiseCtor.resolve(out);
        } catch (err) {
          return reject(err);
        }
      }

      executeTool(tool: unknown, input?: unknown, options?: unknown): Promise<string> {
        try {
          if (this !== instance) return reject(new TypeErrorCtor('Illegal invocation'));
          if (typeof tool !== 'object' || tool === null || !issued.has(tool)) {
            return reject(new TypeErrorCtor("Failed to execute 'executeTool' on 'ModelContext': parameter 1 is not of type 'Tool'."));
          }
          const registration = tools.get((tool as RegisteredTool).name);
          if (!registration) return reject(new DomException('Tool not found', 'NotFoundError'));
          if (input !== undefined && (typeof input !== 'object' || input === null)) {
            return reject(new TypeErrorCtor("Failed to execute 'executeTool' on 'ModelContext': parameter 2 is not of type 'object'."));
          }
          let outer: AbortSignal | null = null;
          if (options !== undefined && options !== null && typeof options === 'object') {
            const s = (options as { signal?: unknown }).signal;
            if (s instanceof win.AbortSignal) outer = s;
          }
          if (outer?.aborted) return reject(outer.reason);
          const controller = new AbortCtrl();
          return new PromiseCtor<string>((resolve, rejectCall) => {
            let settled = false;
            const finish = (fn: () => void): void => {
              if (settled) return;
              settled = true;
              fn();
            };
            outer?.addEventListener(
              'abort',
              () => {
                controller.abort(outer?.reason);
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the caller's abort reason, as is
                finish(() => rejectCall(outer?.reason));
              },
              { once: true },
            );
            let pending: unknown;
            try {
              pending = registration.execute.call(undefined, input ?? {}, { signal: controller.signal });
            } catch (err) {
              finish(() => rejectCall(new DomException(`Tool execution failed: ${messageOf(err)}`, 'OperationError')));
              return;
            }
            PromiseCtor.resolve(pending).then(
              (value: unknown) =>
                finish(() => {
                  if (typeof value === 'string') return resolve(value);
                  let text: unknown;
                  try {
                    text = stringify(value);
                  } catch {
                    return rejectCall(new DomException('The tool result could not be serialized to JSON.', 'OperationError'));
                  }
                  resolve(typeof text === 'string' ? text : 'undefined');
                }),
              (err: unknown) => finish(() => rejectCall(new DomException(`Tool execution failed: ${messageOf(err)}`, 'OperationError'))),
            );
          });
        } catch (err) {
          return reject(err);
        }
      }
    }

    // Event handler attributes: like HTML, the handler joins the listener list when first set.
    const attached = new Set<string>();
    for (const type of EVENT_TYPES) {
      defineProperty(ModelContext.prototype, `on${type}`, {
        get(): unknown {
          return handlers.get(type) ?? null;
        },
        set(this: unknown, value: unknown) {
          if (this !== instance) return;
          const handler = typeof value === 'function' ? value : null;
          handlers.set(type, handler);
          if (handler && !attached.has(type)) {
            attached.add(type);
            addListener.call(instance, type, (event: Event) => {
              const current = handlers.get(type);
              if (typeof current === 'function') (current as (e: Event) => unknown).call(instance, event);
            });
          }
        },
        enumerable: true,
        configurable: true,
      });
    }
    defineProperty(ModelContext.prototype, Symbol.toStringTag, { value: 'ModelContext', configurable: true });

    instance = new ModelContext(internal);
    const context = instance;
    // Like a WebIDL [SameObject] attribute: a configurable accessor on Document.prototype.
    defineProperty(DocumentProto, 'modelContext', {
      get(this: unknown): ModelContext | undefined {
        return this === doc ? context : undefined;
      },
      enumerable: true,
      configurable: true,
    });
    installLegacyAlias(win, { tools, readTool, check, fire, invalidState });
    return 'installed';
  } catch {
    return 'skipped';
  }
}

/**
 * The compatibility shim: `navigator.modelContext` as in the earlier drafts / Chrome's early
 * preview, over the same tool map. Synchronous methods that throw, like they did. Not installed
 * when the page's navigator already has a `modelContext`.
 */
function installLegacyAlias(
  win: PageWindow,
  core: {
    tools: Map<string, Registration>;
    readTool: (tool: unknown, method: string) => Registration;
    check: (r: Registration) => string | null;
    fire: (type: string) => void;
    invalidState: (message: string) => DOMException;
  },
): void {
  const nav = win.navigator;
  const NavigatorProto = win.Navigator.prototype;
  if ('modelContext' in NavigatorProto || 'modelContext' in nav) return;
  const { tools, readTool, check, fire, invalidState } = core;
  const freeze = Object.freeze;
  const PromiseCtor = win.Promise;
  /** `execute(input, client)`: the old `ModelContextClient`, plus the new `signal`. */
  const legacy = (r: Registration): Registration => {
    const execute = r.execute as (input: object, client: unknown) => unknown;
    return {
      ...r,
      execute: (input, { signal }) =>
        execute.call(
          undefined,
          input,
          freeze({ signal, requestUserInteraction: (callback: unknown) => PromiseCtor.resolve().then(() => (callback as () => unknown)()) }),
        ),
    };
  };
  const add = (r: Registration, into: Map<string, Registration>): void => {
    const problem = check(r) ?? (into !== tools && into.has(r.name) ? `A tool named "${r.name}" is listed twice` : null);
    if (problem) throw invalidState(problem);
    into.set(r.name, legacy(r));
  };
  const methods = {
    provideContext(options?: unknown): void {
      const list = options === undefined || options === null ? [] : (options as { tools?: unknown }).tools;
      if (list !== undefined && !Array.isArray(list)) throw new win.TypeError("Failed to execute 'provideContext': 'tools' is not a sequence.");
      // Every tool is checked first: on an error nothing changes.
      const next = new Map<string, Registration>();
      const saved = new Map(tools);
      tools.clear(); // the old set is replaced, so its names are free
      try {
        for (const tool of list ?? []) add(readTool(tool, 'provideContext'), next);
      } catch (err) {
        for (const [k, v] of saved) tools.set(k, v);
        throw err;
      }
      for (const [k, v] of next) tools.set(k, v);
      fire('toolchange');
    },
    clearContext(): void {
      if (tools.size === 0) return;
      tools.clear();
      fire('toolchange');
    },
    registerTool(tool: unknown): void {
      add(readTool(tool, 'registerTool'), tools);
      fire('toolchange');
    },
    unregisterTool(name: unknown): void {
      if (tools.delete(String(name))) fire('toolchange');
    },
  };
  const alias = freeze(Object.create(null, {
    ...Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, { value: v, enumerable: true }])),
    [Symbol.toStringTag]: { value: 'ModelContext' },
  }) as object);
  Object.defineProperty(NavigatorProto, 'modelContext', {
    get(this: unknown): object | undefined {
      return this === nav ? alias : undefined;
    },
    enumerable: true,
    configurable: true,
  });
}

function messageOf(err: unknown): string {
  try {
    if (typeof err === 'object' && err !== null && 'message' in err) return String(err.message).slice(0, 2000);
    return String(err).slice(0, 2000);
  } catch {
    return 'unknown error';
  }
}
