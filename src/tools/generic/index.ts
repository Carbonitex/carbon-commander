/**
 * The generic, site-agnostic toolset: enough for a capable model to read and operate any page.
 *
 * Page tools (static, injected into the tab): read_page, get_page_info, get_selection,
 * find_elements, click, type_text, select_option, press_key, scroll, hover.
 * Background tools (need `chrome.*` / `fetch`, built from deps): screenshot, navigate, go_back,
 * go_forward, reload, wait, list_tabs, open_tab, switch_tab, fetch_url.
 *
 * There is intentionally no tool that runs model-written JavaScript in the page.
 */
import type { PageToolDefinition, ToolDefinition } from '../../shared/types';
import type { ToolDeps } from '../deps';
import type { PageExecutor } from '../page-exec';
import { createBrowserTools, createFetchUrlTool } from './browser';
import { click, hover, pressKey, scroll, selectOption, typeText } from './page-actions';
import { findElements } from './page-elements';
import { getPageInfo, getSelection, readPage } from './page-read';

/** The page tools of the generic set (exported for injection tests). */
export const genericPageTools: PageToolDefinition[] = [
  readPage,
  getPageInfo,
  getSelection,
  findElements,
  click,
  typeText,
  selectOption,
  pressKey,
  scroll,
  hover,
] as PageToolDefinition[];

export function createGenericTools(deps: ToolDeps, pageExec: PageExecutor): ToolDefinition[] {
  return [...genericPageTools, ...createBrowserTools(deps, pageExec), createFetchUrlTool(deps)];
}
