/**
 * Tools about the assistant's own environment. Key and settings management stays in the
 * settings UI on purpose (the model never handles secrets).
 */
import type { ToolDefinition } from '../../shared/types';
import { defineBackgroundTool } from '../define';
import type { ToolDeps } from '../deps';

export function createBuiltinTools(deps: Pick<ToolDeps, 'now'>): ToolDefinition[] {
  const getCurrentTime = defineBackgroundTool({
    name: 'get_current_time',
    description: "Get the current date and time in the user's time zone (and UTC).",
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const now = deps.now();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const local = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: zone }).format(now);
      const offsetMin = -now.getTimezoneOffset();
      const sign = offsetMin >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMin);
      const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
      return {
        ok: true,
        content: `Local: ${local} (${zone}, ${offset})\nUTC: ${now.toISOString()}`,
        data: { iso: now.toISOString(), timeZone: zone, offsetMinutes: offsetMin },
      };
    },
  });
  return [getCurrentTime];
}
