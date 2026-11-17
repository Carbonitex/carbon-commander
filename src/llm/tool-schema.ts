/**
 * `ToolSpec` -> OpenAI chat-completions `tools` entries, and tolerant parsing of the `arguments`
 * string a model produces for a tool call.
 */
import type { JsonSchema, JsonSchemaObject, ToolArgs, ToolSpec } from '../shared/types';
import { CcError } from '../shared/types';

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchemaObject };
}

/**
 * Convert tool specs to the OpenAI `tools` array. The parameter schema is passed through intact
 * (deep-copied), with a few normalisations that providers are strict about:
 * - the top level is always `{ type: 'object', properties: {...} }` (`properties` may not be missing);
 * - `required` only lists existing properties and is omitted when empty;
 * - a top-level `$schema` (common in MCP / zod-generated schemas) is dropped.
 * Fields that are not for the model (`mutates`) are not sent.
 */
export function toOpenAiTools(specs: readonly ToolSpec[]): OpenAiTool[] {
  return specs.map((spec) => ({
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description ?? '',
      parameters: normalizeParameters(spec.parameters),
    },
  }));
}

function normalizeParameters(input: JsonSchemaObject | undefined): JsonSchemaObject {
  const source: JsonSchema = isRecord(input) ? structuredClone(input) : {};
  const { $schema: _schema, type: _type, properties, required, ...rest } = source;
  const props: Record<string, JsonSchema> = isRecord(properties) ? properties : {};
  const out: JsonSchemaObject = { ...rest, type: 'object', properties: props };
  if (Array.isArray(required)) {
    const req = [...new Set(required.filter((r): r is string => typeof r === 'string' && r in props))];
    if (req.length > 0) out.required = req;
  }
  return out;
}

/**
 * Parse a tool call's `arguments` string into an object.
 * - empty / whitespace / `null` -> `{}` (some providers send `""` for no-argument calls);
 * - a JSON string that itself contains a JSON object (double-encoded) is unwrapped;
 * - anything else that is not a JSON object throws `CcError('invalid')`.
 */
export function parseToolArguments(raw: string): ToolArgs {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new CcError('invalid', `Arguments are not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (typeof value === 'string') {
    const inner = value.trim();
    if (inner === '') return {};
    try {
      value = JSON.parse(inner);
    } catch {
      throw new CcError('invalid', 'Arguments must be a JSON object, got a string');
    }
  }
  if (value === null) return {};
  if (!isRecord(value)) {
    throw new CcError('invalid', `Arguments must be a JSON object, got ${Array.isArray(value) ? 'an array' : typeof value}`);
  }
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
