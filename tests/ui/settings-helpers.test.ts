import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/shared/defaults';
import type { ProviderStatus } from '../../src/shared/types';
import { needsSetup } from '../../src/ui/chat/setup';
import { parseTabId } from '../../src/ui/env';
import { describeError, formatPricing, formatUsage } from '../../src/ui/format';
import { normaliseHost } from '../../src/ui/settings/general';
import { parseHeaders, validateServer } from '../../src/ui/settings/mcp';
import { filterModels, MAX_LISTED_MODELS, modelCountText } from '../../src/ui/settings/model-picker';
import { toggleDisabled } from '../../src/ui/settings/tools';

const status = (id: ProviderStatus['id'], needsKey: boolean, hasKey: boolean): ProviderStatus => ({ id, label: id, baseUrl: '', needsKey, hasKey });

describe('setup detection', () => {
  it('needs setup when the chat provider lacks a key or a model', () => {
    const s = defaultSettings();
    expect(needsSetup(s, [status('openrouter', true, false)])).toBe(true);
    expect(needsSetup(s, [status('openrouter', true, true)])).toBe(false);
    s.models.chat = { provider: 'ollama', model: '' };
    expect(needsSetup(s, [status('ollama', false, false)])).toBe(true);
    s.models.chat = { provider: 'ollama', model: 'llama3' };
    expect(needsSetup(s, [status('ollama', false, false)])).toBe(false);
    s.models.chat = { provider: 'custom', model: 'm' };
    expect(needsSetup(s, [status('custom', false, false)])).toBe(true);
  });
});

describe('MCP form helpers', () => {
  it('parses header lines', () => {
    expect(parseHeaders('X-API-Key: abc\n\nX-Other:  v:w ')).toEqual({ 'X-API-Key': 'abc', 'X-Other': 'v:w' });
    expect(parseHeaders('no colon')).toMatch(/Line 1/);
    expect(parseHeaders('Bad Header: x')).toMatch(/Line 1/);
  });

  it('validates name and URL', () => {
    expect(validateServer('github', 'https://example.com/mcp')).toEqual({ name: 'github', url: 'https://example.com/mcp', enabled: true });
    expect(validateServer('bad name', 'https://example.com')).toMatch(/Name/);
    expect(validateServer('ok', 'javascript:alert(1)')).toMatch(/http/);
    expect(validateServer('ok', 'not a url')).toMatch(/not valid/);
  });
});

describe('misc helpers', () => {
  it('filters models by terms and tool support', () => {
    const models = [
      { id: 'a/claude', name: 'Claude', supportsTools: true },
      { id: 'b/llama', name: 'Llama', supportsTools: false },
      { id: 'c/mystery', name: 'Mystery' },
    ];
    expect(filterModels(models, 'cla', false).map((m) => m.id)).toEqual(['a/claude']);
    expect(filterModels(models, '', true).map((m) => m.id)).toEqual(['a/claude', 'c/mystery']);
  });

  it('toggles disabled tools', () => {
    expect(toggleDisabled(['b'], 'a', false)).toEqual(['a', 'b']);
    expect(toggleDisabled(['a', 'b'], 'a', true)).toEqual(['b']);
  });

  it('normalises site hosts', () => {
    expect(normaliseHost('https://www.Example.com/path')).toBe('www.example.com');
    expect(normaliseHost('example.com')).toBe('example.com');
    expect(normaliseHost('  ')).toBeNull();
  });

  it('parses tabId strictly', () => {
    expect(parseTabId('?tabId=12')).toBe(12);
    expect(parseTabId('?tabId=-1')).toBeUndefined();
    expect(parseTabId('?tabId=1e3')).toBeUndefined();
    expect(parseTabId('')).toBeUndefined();
  });

  it('formats usage, pricing and errors', () => {
    expect(formatUsage({ promptTokens: 1500, completionTokens: 20, totalTokens: 1520, cost: 0.0042 })).toBe('1.5k in · 20 out · $0.0042');
    expect(formatPricing({ prompt: 3, completion: 15 })).toBe('$3 / $15 per M');
    expect(describeError({ code: 'no-key', message: '' }).action).toBe('setup');
    expect(describeError({ code: 'no-model', message: '' }).action).toBe('settings');
  });

  it('model list count line says when the list is capped', () => {
    expect(modelCountText(470, 470)).toBe(`Showing ${MAX_LISTED_MODELS} of 470 models; type to filter.`);
    expect(modelCountText(12, 470)).toBe('12 of 470 models match');
    expect(modelCountText(5, 5)).toBe('5 models');
    expect(modelCountText(0, 0)).toBe('');
  });
});
