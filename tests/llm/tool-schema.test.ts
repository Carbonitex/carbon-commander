import { describe, expect, it } from 'vitest';
import { parseToolArguments, toOpenAiTools } from '../../src/llm/tool-schema';
import type { JsonSchemaObject, ToolSpec } from '../../src/shared/types';
import { CcError } from '../../src/shared/types';

describe('toOpenAiTools', () => {
  it('keeps the full parameter schema (nested objects, arrays, enums) and drops mutates', () => {
    const parameters: JsonSchemaObject = {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        options: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['a', 'b'] }, count: { type: 'integer', default: 1 } },
          required: ['mode'],
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['selector'],
      additionalProperties: false,
    };
    const spec: ToolSpec = { name: 'click', description: 'Click it', parameters, mutates: true };
    const [tool] = toOpenAiTools([spec]);
    expect(tool).toEqual({ type: 'function', function: { name: 'click', description: 'Click it', parameters } });
    expect(JSON.stringify(tool)).not.toContain('mutates');
  });

  it('does not share or mutate the input schema', () => {
    const spec: ToolSpec = { name: 't', description: '', parameters: { type: 'object', properties: { a: { type: 'string' } } } };
    const [tool] = toOpenAiTools([spec]);
    tool!.function.parameters.properties!.a!.type = 'number';
    expect(spec.parameters.properties!.a!.type).toBe('string');
  });

  it('normalises: adds empty properties, drops $schema, empty or unknown required entries', () => {
    const [a, b] = toOpenAiTools([
      { name: 'a', description: 'x', parameters: { type: 'object' } },
      {
        name: 'b',
        description: 'y',
        parameters: { type: 'object', $schema: 'http://json-schema.org/draft-07/schema#', properties: { q: { type: 'string' } }, required: ['q', 'missing'] },
      },
    ]);
    expect(a!.function.parameters).toEqual({ type: 'object', properties: {} });
    expect(b!.function.parameters).toEqual({ type: 'object', properties: { q: { type: 'string' } }, required: ['q'] });
  });

  it('converts several tools in order', () => {
    const tools = toOpenAiTools(['x', 'y', 'z'].map((name) => ({ name, description: name, parameters: { type: 'object' as const } })));
    expect(tools.map((t) => t.function.name)).toEqual(['x', 'y', 'z']);
  });
});

describe('parseToolArguments', () => {
  it('parses objects', () => {
    expect(parseToolArguments('{"a":1,"b":{"c":[1,2]}}')).toEqual({ a: 1, b: { c: [1, 2] } });
  });
  it('treats empty, whitespace and null as {}', () => {
    expect(parseToolArguments('')).toEqual({});
    expect(parseToolArguments('  \n')).toEqual({});
    expect(parseToolArguments('null')).toEqual({});
  });
  it('unwraps double-encoded JSON', () => {
    expect(parseToolArguments(JSON.stringify('{"a":1}'))).toEqual({ a: 1 });
  });
  it('throws CcError(invalid) for bad JSON and non-objects', () => {
    for (const bad of ['{"a":', '[1,2]', '42', '"text"']) {
      expect(() => parseToolArguments(bad)).toThrow(CcError);
      try {
        parseToolArguments(bad);
      } catch (err) {
        expect((err as CcError).code).toBe('invalid');
      }
    }
  });
});
