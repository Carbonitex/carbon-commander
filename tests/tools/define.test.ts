/* eslint-disable @typescript-eslint/unbound-method -- expect(mock) / toString() on method references is intended in tests */
import { describe, expect, it } from 'vitest';
import { checkInjectable, defineBackgroundTool, definePageTool, defineToolset } from '../../src/tools/define';
import { checkSchemaShape, validateArgs } from '../../src/tools/schema';
import type { JsonSchemaObject, ToolResult } from '../../src/shared/types';

const ok = async (): Promise<ToolResult> => ({ ok: true, content: '' });
const params: JsonSchemaObject = { type: 'object', properties: { q: { type: 'string' } } };

describe('define-time validation', () => {
  it('accepts a valid background tool and sets context', () => {
    const t = defineBackgroundTool({ name: 'do_it', description: 'Does it', parameters: params, run: ok });
    expect(t.context).toBe('background');
  });

  it('rejects bad names, empty descriptions and non-object schemas', () => {
    expect(() => defineBackgroundTool({ name: 'bad name!', description: 'x', parameters: params, run: ok })).toThrow(/must match/);
    expect(() => defineBackgroundTool({ name: 'a'.repeat(65), description: 'x', parameters: params, run: ok })).toThrow(/must match/);
    expect(() => defineBackgroundTool({ name: 'x', description: ' ', parameters: params, run: ok })).toThrow(/description/);
    expect(() =>
      defineBackgroundTool({ name: 'x', description: 'd', parameters: { type: 'array' } as unknown as JsonSchemaObject, run: ok }),
    ).toThrow(/type "object"/);
  });

  it('rejects malformed parameter schemas', () => {
    const bad = (p: unknown): (() => unknown) => () =>
      defineBackgroundTool({ name: 'x', description: 'd', parameters: p as JsonSchemaObject, run: ok });
    expect(bad({ type: 'object', properties: { a: { type: 'array' } } })).toThrow(/needs "items"/);
    expect(bad({ type: 'object', properties: { a: { type: 'strnig' } } })).toThrow(/unknown type/);
    expect(bad({ type: 'object', properties: {}, required: ['a'] })).toThrow(/required "a" is not in properties/);
    expect(bad({ type: 'object', properties: { a: { description: 'no type' } } })).toThrow(/missing "type"/);
    expect(bad({ type: 'object', properties: { a: { type: 'string', enum: [] } } })).toThrow(/enum/);
    expect(checkSchemaShape({ type: 'object', properties: { o: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] } } })).toEqual([]);
  });

  it('page tools must be injectable function expressions', () => {
    const t = definePageTool({ name: 'p', description: 'd', parameters: params, run: function () { return { ok: true, content: '' }; } });
    expect(t.context).toBe('page');
    expect(definePageTool({ name: 'm', description: 'd', context: 'page-main', parameters: params, run: () => ({ ok: true, content: '' }) }).context).toBe('page-main');
    const shorthand = { run(): ToolResult { return { ok: true, content: '' }; } };
    expect(() => definePageTool({ name: 'p', description: 'd', parameters: params, run: shorthand.run })).toThrow(/method shorthand/);
    expect(checkInjectable(function named() {}.bind(null))).toMatch(/bound or native/);
    expect(checkInjectable(async (a: never) => a)).toBeNull();
    expect(checkInjectable(async function () {})).toBeNull();
  });

  it('defineToolset applies matches to tools without their own', () => {
    const own = (u: URL): boolean => u.hostname === 'own.test';
    const [a, b] = defineToolset({
      id: 's',
      matches: (u) => u.hostname === 'site.test',
      tools: [
        defineBackgroundTool({ name: 'a', description: 'd', parameters: params, run: ok }),
        defineBackgroundTool({ name: 'b', description: 'd', parameters: params, run: ok, matches: own }),
      ],
    });
    expect(a?.matches?.(new URL('https://site.test/'))).toBe(true);
    expect(b?.matches).toBe(own);
  });
});

describe('validateArgs', () => {
  const schema: JsonSchemaObject = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      count: { type: 'integer', minimum: 0, maximum: 10 },
      mode: { type: 'string', enum: ['a', 'b'] },
      flag: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      nested: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'], additionalProperties: false },
    },
    required: ['name'],
  };

  it('accepts valid args and treats undefined/null args as {}', () => {
    expect(validateArgs(schema, { name: 'n', count: 3, mode: 'a', tags: ['t'], nested: { x: 1.5 } }).ok).toBe(true);
    expect(validateArgs({ type: 'object', properties: {} }, undefined)).toEqual({ ok: true, value: {}, errors: [] });
    expect(validateArgs({ type: 'object', properties: {} }, null).ok).toBe(true);
  });

  it('reports type, required, enum, range, nesting and unknown-property errors', () => {
    const r = validateArgs(schema, { count: 11, mode: 'c', flag: 'yes', tags: [1], nested: { y: 2 } });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'name: is required',
        'count: must be <= 10',
        'mode: must be one of "a", "b"',
        'flag: expected boolean, got string',
        'tags[0]: expected string, got integer',
        'nested.x: is required',
        'nested.y: unknown property (allowed: x)',
      ]),
    );
    expect(validateArgs(schema, 'str').errors[0]).toMatch(/expected an object/);
  });

  it('coerces numeric and boolean strings, drops null optionals', () => {
    const r = validateArgs(schema, { name: 'n', count: '4', flag: 'true', mode: null });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ name: 'n', count: 4, flag: true });
    expect(validateArgs(schema, { name: 'n', count: '4.5' }).ok).toBe(false);
  });
});
