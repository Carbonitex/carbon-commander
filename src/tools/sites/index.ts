/**
 * Light site toolsets, examples of the `matches(url)` pattern. Each uses a stable public API
 * from the service worker rather than CSS selectors, so they do not break on redesigns.
 */
import type { ToolDefinition } from '../../shared/types';
import type { ToolDeps } from '../deps';
import { createGitHubTools } from './github';
import { createHackerNewsTools } from './hackernews';

export function createSiteTools(deps: Pick<ToolDeps, 'fetch'>): ToolDefinition[] {
  return [...createHackerNewsTools(deps), ...createGitHubTools(deps)];
}
