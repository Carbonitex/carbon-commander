/** Formatting helpers for the UI (pure). */
import type { ErrorInfo, ModelInfo, Usage } from '../shared/types';

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatUsage(usage: Usage): string {
  const parts = [`${formatTokens(usage.promptTokens)} in`, `${formatTokens(usage.completionTokens)} out`];
  if (usage.cost !== undefined) parts.push(formatCost(usage.cost));
  return parts.join(' · ');
}

/** "$3 / $15 per M" from per-million pricing. */
export function formatPricing(pricing: ModelInfo['pricing']): string {
  if (!pricing) return '';
  const p = (v: number): string => (v === 0 ? 'free' : `$${v < 1 ? v.toFixed(2) : v.toFixed(v % 1 === 0 ? 0 : 2)}`);
  return `${p(pricing.prompt)} / ${p(pricing.completion)} per M`;
}

export function describeModel(model: ModelInfo): string {
  const bits: string[] = [];
  if (model.contextLength) bits.push(`${formatTokens(model.contextLength)} ctx`);
  const price = formatPricing(model.pricing);
  if (price) bits.push(price);
  if (model.supportsTools === true) bits.push('tools');
  if (model.supportsTools === false) bits.push('no tools');
  if (model.supportsImages === true) bits.push('images');
  return bits.join(' · ');
}

/** Pretty JSON for tool args (text only). Never throws. */
export function formatJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type ErrorAction = 'settings' | 'setup' | null;

/** Human text + the action the error view should offer. */
export function describeError(error: ErrorInfo): { title: string; detail: string; action: ErrorAction } {
  switch (error.code) {
    case 'no-key':
      return { title: 'No API key', detail: 'Add an API key for the selected provider to start chatting.', action: 'setup' };
    case 'no-model':
      return { title: 'No model selected', detail: 'Choose a chat model in Settings → Models.', action: 'settings' };
    case 'busy':
      return { title: 'Still working', detail: 'A run is already in progress. Stop it first (Esc).', action: null };
    case 'no-tab':
      return { title: 'Tab unavailable', detail: error.message || 'The target tab is gone or cannot be scripted.', action: null };
    case 'max-steps':
      return { title: 'Step limit reached', detail: 'The agent hit the maximum number of steps. You can raise it in Settings.', action: 'settings' };
    case 'aborted':
      return { title: 'Stopped', detail: error.message || 'The run was stopped.', action: null };
    case 'http':
      return {
        title: error.status === 401 || error.status === 403 ? 'Provider rejected the request' : 'Provider error',
        detail: `${error.status ? `HTTP ${error.status}: ` : ''}${error.message}`,
        action: error.status === 401 || error.status === 403 ? 'settings' : null,
      };
    case 'network':
      return { title: 'Network error', detail: error.message || 'The endpoint is unreachable.', action: 'settings' };
    case 'not-implemented':
      return { title: 'Not available', detail: error.message, action: null };
    default:
      return { title: 'Error', detail: error.message, action: null };
  }
}
