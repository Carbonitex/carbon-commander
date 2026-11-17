/**
 * Small JSON Schema helpers for tool parameters.
 *
 * - `checkSchemaShape` runs once at definition time and rejects schemas that providers choke on
 *   (missing `type`, `array` without `items`, `required` naming an unknown property, ...).
 * - `validateArgs` runs before every call and checks the model's arguments against the schema.
 *   It covers what tool schemas actually use: `type` (incl. unions), `required`, `properties`,
 *   `additionalProperties: false`, `enum`, `items`, `minimum` / `maximum`, `minLength` /
 *   `maxLength`, `minItems` / `maxItems`. Light coercion is applied for the mistakes models make
 *   most often (`"5"` for a number, `"true"` for a boolean); the coerced copy is returned.
 */
import type { JsonSchema, ToolArgs } from '../shared/types';

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function typesOf(schema: JsonSchema): string[] {
  const t = schema.type;
  if (t === undefined) return [];
  return Array.isArray(t) ? t : [t];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems with a schema node (empty = fine). `path` is used in messages, e.g. `parameters.foo`. */
export function checkSchemaShape(schema: unknown, path = 'parameters'): string[] {
  const problems: string[] = [];
  if (!isPlainObject(schema)) return [`${path}: must be a schema object`];
  const node = schema as JsonSchema;
  const types = typesOf(node);
  if (types.length === 0 && node.enum === undefined) problems.push(`${path}: missing "type"`);
  for (const t of types) if (!TYPES.has(t)) problems.push(`${path}: unknown type "${t}"`);
  if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) {
    problems.push(`${path}: "enum" must be a non-empty array`);
  }
  if (node.description !== undefined && typeof node.description !== 'string') {
    problems.push(`${path}: "description" must be a string`);
  }
  if (types.includes('array')) {
    if (node.items === undefined) problems.push(`${path}: array schema needs "items"`);
    else problems.push(...checkSchemaShape(node.items, `${path}[]`));
  }
  if (types.includes('object') || node.properties !== undefined) {
    if (node.properties !== undefined && !isPlainObject(node.properties)) {
      problems.push(`${path}: "properties" must be an object`);
    } else {
      for (const [key, sub] of Object.entries(node.properties ?? {})) {
        problems.push(...checkSchemaShape(sub, `${path}.${key}`));
      }
    }
    if (node.required !== undefined) {
      if (!Array.isArray(node.required) || node.required.some((r) => typeof r !== 'string')) {
        problems.push(`${path}: "required" must be an array of strings`);
      } else {
        for (const r of node.required) {
          if (!node.properties || !(r in node.properties)) problems.push(`${path}: required "${r}" is not in properties`);
        }
      }
    }
  }
  return problems;
}

export interface ArgValidation {
  ok: boolean;
  /** The (possibly coerced) arguments. Only meaningful when `ok`. */
  value: ToolArgs;
  errors: string[];
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  switch (t) {
    case 'object':
      return isPlainObject(v);
    case 'array':
      return Array.isArray(v);
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    default:
      return true;
  }
}

/** Try to turn a near-miss into the expected type; returns `undefined` when it cannot. */
function coerce(v: unknown, t: string): unknown {
  if (typeof v === 'string') {
    const s = v.trim();
    if ((t === 'number' || t === 'integer') && s !== '' && Number.isFinite(Number(s))) {
      const n = Number(s);
      return t === 'integer' && !Number.isInteger(n) ? undefined : n;
    }
    if (t === 'boolean' && (s === 'true' || s === 'false')) return s === 'true';
  }
  return undefined;
}

function validateNode(schema: JsonSchema, value: unknown, path: string, errors: string[]): unknown {
  const types = typesOf(schema);
  let v = value;
  if (types.length > 0 && !types.some((t) => matchesType(v, t))) {
    let fixed: unknown;
    for (const t of types) {
      fixed = coerce(v, t);
      if (fixed !== undefined) break;
    }
    if (fixed === undefined) {
      errors.push(`${path}: expected ${types.join(' or ')}, got ${describeType(v)}`);
      return v;
    }
    v = fixed;
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof v === 'number') {
    if (typeof schema.minimum === 'number' && v < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && v > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (typeof v === 'string') {
    if (typeof schema.minLength === 'number' && v.length < schema.minLength) {
      errors.push(`${path}: must be at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === 'number' && v.length > schema.maxLength) {
      errors.push(`${path}: must be at most ${schema.maxLength} characters`);
    }
  }
  if (Array.isArray(v)) {
    if (typeof schema.minItems === 'number' && v.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) {
      errors.push(`${path}: allows at most ${schema.maxItems} items`);
    }
    const items = schema.items;
    if (items) v = v.map((item, i) => validateNode(items, item, `${path}[${i}]`, errors));
  }
  if (isPlainObject(v) && (schema.properties || schema.required || schema.additionalProperties === false)) {
    const out: Record<string, unknown> = { ...v };
    const props = schema.properties ?? {};
    for (const r of schema.required ?? []) {
      if (out[r] === undefined) errors.push(`${path === '' ? '' : path + '.'}${r}: is required`);
    }
    for (const [key, sub] of Object.entries(out)) {
      const subSchema = props[key];
      const subPath = path === '' ? key : `${path}.${key}`;
      if (subSchema) {
        // `null` for an optional property is a common model habit: treat it as "not given".
        if (sub === null && !typesOf(subSchema).includes('null') && !(schema.required ?? []).includes(key)) {
          delete out[key];
          continue;
        }
        out[key] = validateNode(subSchema, sub, subPath, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${subPath}: unknown property (allowed: ${Object.keys(props).join(', ') || 'none'})`);
      } else if (isPlainObject(schema.additionalProperties)) {
        out[key] = validateNode(schema.additionalProperties, sub, subPath, errors);
      }
    }
    v = out;
  }
  return v;
}

/** Validate (and lightly coerce) tool arguments. `undefined` / `null` args count as `{}`. */
export function validateArgs(schema: JsonSchema, args: unknown): ArgValidation {
  const errors: string[] = [];
  const input = args === undefined || args === null ? {} : args;
  if (!isPlainObject(input)) {
    return { ok: false, value: {}, errors: [`arguments: expected an object, got ${describeType(input)}`] };
  }
  const value = validateNode(schema, input, '', errors) as ToolArgs;
  return { ok: errors.length === 0, value, errors };
}

/** One-line-per-parameter summary of a schema, used in error messages to the model. */
export function describeParameters(schema: JsonSchema): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(props).map(([key, sub]) => {
    const type = typesOf(sub).join('|') || 'any';
    const en = sub.enum ? ` one of ${sub.enum.map((e) => JSON.stringify(e)).join('/')}` : '';
    return `- ${key} (${type}${required.has(key) ? ', required' : ''})${en}`;
  });
  return lines.length ? lines.join('\n') : '(no parameters)';
}
