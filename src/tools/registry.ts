/**
 * The built-in tool registry: one `ToolSource` over every `ToolDefinition` (generic, site and
 * builtin toolsets).
 *
 * - `listTools(tab)` returns the specs whose `matches(url)` accepts the tab (all tools without
 *   `matches`).
 * - `callTool` validates arguments against the tool's schema (returning a helpful error result to
 *   the model on mismatch), dispatches background tools directly and page tools through the page
 *   executor, converts thrown errors into `{ ok: false }` results, and caps the result text.
 *   Only aborts are thrown.
 */
import { CcError, type ToolArgs, type ToolCallContext, type ToolDefinition, type ToolResult, type ToolSource, type ToolSpec } from '../shared/types';
import { createBuiltinTools } from './builtin';
import { validateToolDefinition } from './define';
import { chromeToolDeps, type ToolDeps } from './deps';
import { createGenericTools } from './generic';
import { createPageExecutor, type PageExecutor } from './page-exec';
import { describeParameters, validateArgs } from './schema';
import { createSiteTools } from './sites';

/** Default cap on `ToolResult.content` handed to the model. */
export const DEFAULT_MAX_RESULT_CHARS = 40_000;

export interface ToolRegistryOptions {
  id?: string;
  label?: string;
  /** Runs `page` / `page-main` tools. Default: `chrome.scripting` via `createPageExecutor`. */
  pageExecutor?: PageExecutor;
  maxResultChars?: number;
}

export interface ToolRegistry extends ToolSource {
  /** Every registered definition (unfiltered). */
  readonly tools: readonly ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
}

/** Every built-in tool definition, bound to `deps`. */
export function allBuiltinTools(deps: ToolDeps = chromeToolDeps(), pageExecutor?: PageExecutor): ToolDefinition[] {
  const exec = pageExecutor ?? createPageExecutor(deps);
  return [...createGenericTools(deps, exec), ...createSiteTools(deps), ...createBuiltinTools(deps)];
}

function urlOf(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function available(tool: ToolDefinition, url: URL | null): boolean {
  if (!tool.matches) return true;
  if (!url) return false;
  try {
    return tool.matches(url);
  } catch {
    return false;
  }
}

/** Cut `content` to `max` characters with a visible marker. */
export function truncateContent(content: string, max: number): string {
  if (content.length <= max) return content;
  const omitted = content.length - max;
  return `${content.slice(0, max)}\n\n[… truncated: ${omitted} more characters omitted. Ask for a smaller part (e.g. offset / max_chars / selector) if you need the rest.]`;
}

const isAbort = (err: unknown, ctx: ToolCallContext): boolean =>
  ctx.signal.aborted || (err instanceof CcError && err.code === 'aborted') || (err instanceof Error && err.name === 'AbortError');

/** ToolSource over `tools` (default: every built-in tool bound to the real `chrome.*`). */
export function createToolRegistry(tools?: readonly ToolDefinition[], options: ToolRegistryOptions = {}): ToolRegistry {
  const pageExecutor = options.pageExecutor ?? createPageExecutor(chromeToolDeps());
  const list = tools ?? allBuiltinTools(chromeToolDeps(), pageExecutor);
  const maxChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  const byName = new Map<string, ToolDefinition>();
  for (const tool of list) {
    validateToolDefinition(tool);
    if (byName.has(tool.name)) throw new CcError('invalid', `Duplicate built-in tool name "${tool.name}"`);
    byName.set(tool.name, tool);
  }

  const toSpec = (t: ToolDefinition): ToolSpec => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    mutates: t.mutates === true,
    ...(t.egress === true ? { egress: true } : {}),
    ...(t.confirmWhenArgs && t.confirmWhenArgs.length > 0 ? { confirmWhenArgs: [...t.confirmWhenArgs] } : {}),
  });

  async function dispatch(tool: ToolDefinition, args: ToolArgs, ctx: ToolCallContext): Promise<ToolResult> {
    if (tool.context === 'background') return tool.run(args, ctx);
    return pageExecutor.run(tool, args, ctx);
  }

  return {
    id: options.id ?? 'builtin',
    label: options.label ?? 'Built-in',
    tools: list,
    get: (name) => byName.get(name),

    async listTools(tab) {
      const url = urlOf(tab.url);
      return list.filter((t) => available(t, url)).map(toSpec);
    },

    async callTool(name, args, ctx) {
      const tool = byName.get(name);
      if (!tool) return { ok: false, content: `Unknown tool "${name}".` };
      if (!available(tool, urlOf(ctx.tab.url))) {
        return { ok: false, content: `Tool "${name}" is not available on this page (${ctx.tab.url}).` };
      }
      const checked = validateArgs(tool.parameters, args);
      if (!checked.ok) {
        return {
          ok: false,
          content: `Invalid arguments for ${name}:\n${checked.errors.map((e) => `- ${e}`).join('\n')}\nParameters:\n${describeParameters(tool.parameters)}`,
        };
      }
      if (ctx.signal.aborted) throw new CcError('aborted', 'Aborted');
      let result: ToolResult;
      try {
        result = await dispatch(tool, checked.value, ctx);
      } catch (err) {
        if (isAbort(err, ctx)) throw err instanceof CcError ? err : new CcError('aborted', 'Aborted', { cause: err });
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, content: `${name} failed: ${message}` };
      }
      if (typeof result !== 'object' || result === null || typeof result.content !== 'string') {
        return { ok: false, content: `${name} returned an invalid result.` };
      }
      const out: ToolResult = { ...result, ok: result.ok === true, content: truncateContent(result.content, maxChars) };
      return out;
    },
  };
}

/** The `builtin` ToolSource with explicit dependencies (tests, alternative hosts). */
export function createBuiltinToolSource(deps: ToolDeps = chromeToolDeps(), options: Omit<ToolRegistryOptions, 'pageExecutor'> & { pageTimeoutMs?: number } = {}): ToolRegistry {
  const pageExecutor = createPageExecutor(deps, options.pageTimeoutMs === undefined ? {} : { timeoutMs: options.pageTimeoutMs });
  return createToolRegistry(allBuiltinTools(deps, pageExecutor), { ...options, pageExecutor });
}
