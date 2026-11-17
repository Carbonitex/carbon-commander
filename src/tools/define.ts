/**
 * Helpers to define built-in tools. One definition = spec (name, description, JSON schema) +
 * where it runs (`context`) + `run`. Definitions are validated when they are created, so a bad
 * name or schema fails at extension start-up (and in unit tests), not when the model calls it.
 *
 * Page tools (`context: 'page' | 'page-main'`) are injected with `chrome.scripting.executeScript`,
 * which serialises `run` with `Function.prototype.toString`. That means:
 * - write `run: function (args) { ... }` or an arrow function, never method shorthand
 *   (`run(args) { ... }` stringifies to something that is not a valid expression);
 * - everything `run` needs (helpers, constants) must be declared inside it;
 * - args and the returned `ToolResult` must be JSON-serialisable.
 * `definePageTool` checks the first point; the other two are covered by `tests/tools/injection.test.ts`,
 * which re-evaluates every page tool from its (minified) source text alone.
 *
 * Bundling: esbuild keeps nested helpers inside the function (it never hoists them, minified or
 * not; verified in `dist/background.js`), and with `target: chrome120` it emits no runtime helpers
 * (`__async`, `__spreadValues`, ...) for modern syntax. Do NOT enable esbuild's `keepNames`: it
 * wraps every inner named function in a call to a module-scope `__name` helper, which is undefined
 * in the page (the injection test checks this). Avoid `class` declarations inside `run` for the
 * same reason (field helpers).
 */
import { TOOL_NAME_PATTERN } from '../shared/defaults';
import {
  CcError,
  type BackgroundToolDefinition,
  type PageToolDefinition,
  type ToolArgs,
  type ToolDefinition,
} from '../shared/types';
import { checkSchemaShape } from './schema';

/** Throws `CcError('invalid')` listing every problem with the definition. */
export function validateToolDefinition(def: ToolDefinition): void {
  const problems: string[] = [];
  const name = typeof def.name === 'string' ? def.name : '';
  if (!TOOL_NAME_PATTERN.test(name)) problems.push(`name "${String(def.name)}" must match ${String(TOOL_NAME_PATTERN)}`);
  if (typeof def.description !== 'string' || def.description.trim() === '') problems.push('description is required');
  const params: unknown = def.parameters;
  if (typeof params !== 'object' || params === null || (params as { type?: unknown }).type !== 'object') {
    problems.push('parameters must be a JSON schema with type "object"');
  } else {
    problems.push(...checkSchemaShape(params));
  }
  if (typeof def.run !== 'function') problems.push('run must be a function');
  if (def.matches !== undefined && typeof def.matches !== 'function') problems.push('matches must be a function');
  const context: unknown = def.context;
  if (context !== 'background' && context !== 'page' && context !== 'page-main') {
    problems.push(`context must be "background", "page" or "page-main", got ${JSON.stringify(context)}`);
  } else if (context !== 'background' && typeof def.run === 'function') {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only stringified, never called
    const problem = checkInjectable(def.run);
    if (problem) problems.push(problem);
  }
  if (problems.length > 0) {
    throw new CcError('invalid', `Invalid tool definition "${name || '?'}": ${problems.join('; ')}`);
  }
}

/**
 * `executeScript` evaluates `(<source>)(...args)`, so the source must be a function expression.
 * Returns a problem description, or null.
 */
export function checkInjectable(fn: (...args: never[]) => unknown): string | null {
  const src = Function.prototype.toString.call(fn).trim();
  if (src.includes('[native code]')) return 'run must not be a bound or native function (it is serialised with toString)';
  if (/^class\b/.test(src)) return 'run must not be a class';
  const ok =
    /^(async\s+)?function\b/.test(src) || // function (args) {} / async function name(args) {}
    /^(async\s*)?\(/.test(src) || // (args) => ...
    /^(async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(src); // args => ...
  return ok ? null : 'page tool run must be a function expression or arrow function, not method shorthand';
}

/** Define any tool (context given explicitly). Validates and returns the definition. */
export function defineTool<A extends ToolArgs>(definition: ToolDefinition<A>): ToolDefinition<A> {
  validateToolDefinition(definition);
  return definition;
}

/** Define a tool that runs in the service worker with the full `ToolCallContext`. */
export function defineBackgroundTool<A extends ToolArgs>(
  definition: Omit<BackgroundToolDefinition<A>, 'context'>,
): BackgroundToolDefinition<A> {
  const def: BackgroundToolDefinition<A> = { ...definition, context: 'background' };
  validateToolDefinition(def);
  return def;
}

/**
 * Define a tool injected into the page. `context` defaults to `page` (ISOLATED world); use
 * `page-main` only when the tool needs the page's own JS objects.
 */
export function definePageTool<A extends ToolArgs>(
  definition: Omit<PageToolDefinition<A>, 'context'> & { context?: 'page' | 'page-main' },
): PageToolDefinition<A> {
  const def: PageToolDefinition<A> = { ...definition, context: definition.context ?? 'page' };
  validateToolDefinition(def);
  return def;
}

/**
 * Group tools that share a `matches` filter (e.g. one site). Tools that declare their own
 * `matches` keep it. Returns the tools typed as plain `ToolDefinition`s for the registry.
 */
export function defineToolset(options: {
  /** Used in error messages only. */
  id: string;
  matches?: (url: URL) => boolean;
  tools: readonly ToolDefinition<never>[];
}): ToolDefinition[] {
  return options.tools.map((tool) => {
    const t = tool as unknown as ToolDefinition;
    const out = t.matches || !options.matches ? t : { ...t, matches: options.matches };
    try {
      validateToolDefinition(out);
    } catch (err) {
      throw new CcError('invalid', `[toolset ${options.id}] ${(err as Error).message}`);
    }
    return out;
  });
}
