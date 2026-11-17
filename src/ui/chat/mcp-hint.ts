/**
 * Unobtrusive header chip: "MCP server available" when the current tab's site advertises an MCP
 * server that is not added (or dismissed) yet. Clicking it opens Settings -> MCP (Discovered).
 */
import type { Rpc } from '../connection';
import { h } from '../dom';

export interface McpHint {
  readonly el: HTMLButtonElement;
  /** Ask the worker again (on open / when the bar is shown). Never throws. */
  refresh(): void;
}

export function createMcpHint(options: { rpc: Rpc; tabId: number | undefined; onOpen(): void; onChange?(): void }): McpHint {
  const el = h('button', {
    type: 'button',
    class: 'cc-badge cc-badge-mcp',
    hidden: true,
    title: 'This site offers an MCP server you have not added. Open Settings → MCP to add it.',
    on: { click: () => options.onOpen() },
  });
  let seq = 0;
  return {
    el,
    refresh() {
      const mine = ++seq;
      options
        .rpc('mcp.discovered.forTab', options.tabId === undefined ? {} : { tabId: options.tabId })
        .then(
          (found) => {
            if (mine !== seq) return;
            const first = found[0];
            el.hidden = !first;
            el.textContent = first ? (found.length > 1 ? `${found.length} MCP servers available` : 'MCP server available') : '';
            if (first) el.setAttribute('aria-label', `MCP server available on this site: ${first.name}`);
            options.onChange?.();
          },
          () => {
            if (mine === seq) el.hidden = true;
          },
        );
    },
  };
}
