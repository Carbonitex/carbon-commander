/**
 * Tool call card: name, source label, status, collapsible args + result. Everything from the
 * tool / model / MCP server is rendered as text; result images become `data:` thumbnails.
 */
import type { ToolItem, ToolItemStatus } from '../../shared/types';
import { h, replaceChildren } from '../dom';
import { formatJson, truncate } from '../format';

const STATUS_LABEL: Record<ToolItemStatus, string> = {
  'pending-confirm': 'needs approval',
  running: 'running',
  ok: 'done',
  error: 'error',
  denied: 'denied',
  aborted: 'stopped',
};

const STATUS_ICON: Record<ToolItemStatus, string> = {
  'pending-confirm': '?',
  running: '…',
  ok: '✓',
  error: '!',
  denied: '✕',
  aborted: '■',
};

const SAFE_IMAGE_MIME = /^image\/(?:png|jpeg|gif|webp)$/;
const MAX_RESULT_CHARS = 20_000;

export interface ToolCardHandle {
  el: HTMLElement;
  update(item: ToolItem): void;
}

export function createToolCard(item: ToolItem): ToolCardHandle {
  const status = h('span', { class: 'cc-tool-status', role: 'status' });
  const icon = h('span', { class: 'cc-tool-icon', 'aria-hidden': 'true' });
  const summary = h(
    'summary',
    { class: 'cc-tool-summary' },
    icon,
    h('span', { class: 'cc-tool-name' }, item.name),
    h('span', { class: 'cc-tool-source' }, item.sourceLabel),
    status,
  );
  const body = h('div', { class: 'cc-tool-body' });
  const details = h('details', { class: 'cc-tool' }, summary, body);
  const el = h('div', { class: 'cc-item cc-item-tool' }, details);

  let lastKey = '';
  const update = (next: ToolItem): void => {
    const key = `${next.status}|${next.result ? 'r' : ''}`;
    if (key === lastKey) return;
    lastKey = key;
    details.dataset.status = next.status;
    status.textContent = STATUS_LABEL[next.status];
    icon.textContent = STATUS_ICON[next.status];
    summary.setAttribute('aria-label', `Tool ${next.name} from ${next.sourceLabel}: ${STATUS_LABEL[next.status]}`);

    const sections: HTMLElement[] = [
      h('div', { class: 'cc-tool-section' }, h('div', { class: 'cc-tool-label' }, 'Arguments'), h('pre', { class: 'cc-tool-pre' }, formatJson(next.args))),
    ];
    if (next.result) {
      const text = truncate(next.result.content, MAX_RESULT_CHARS);
      sections.push(
        h(
          'div',
          { class: `cc-tool-section ${next.result.ok ? '' : 'cc-tool-failed'}` },
          h('div', { class: 'cc-tool-label' }, next.result.ok ? 'Result' : 'Error'),
          h('pre', { class: 'cc-tool-pre' }, text || '(empty)'),
        ),
      );
      const images = (next.result.images ?? []).filter((img) => SAFE_IMAGE_MIME.test(img.mime) && /^[a-z0-9+/=\s]+$/i.test(img.base64));
      if (images.length) {
        sections.push(
          h(
            'div',
            { class: 'cc-tool-images' },
            images.map((img, i) =>
              h('img', { class: 'cc-tool-thumb', src: `data:${img.mime};base64,${img.base64}`, alt: `${next.name} image ${i + 1}` }),
            ),
          ),
        );
      }
    }
    replaceChildren(body, sections);
  };
  update(item);
  return { el, update };
}
