/**
 * Keyed transcript renderer: one DOM node per `TranscriptItem`, updated in place. Assistant
 * markdown is re-rendered at most once per animation frame while it streams.
 */
import type { AssistantItem, ErrorItem, TranscriptItem } from '../../shared/types';
import { h, replaceChildren, setSanitizedHtml } from '../dom';
import { describeError, type ErrorAction } from '../format';
import { enhanceCodeBlocks, renderMarkdown } from '../markdown';
import { createToolCard, type ToolCardHandle } from './tool-card';

interface Rendered {
  kind: TranscriptItem['kind'];
  el: HTMLElement;
  update(item: TranscriptItem): void;
}

export interface TranscriptOptions {
  onErrorAction(action: Exclude<ErrorAction, null>): void;
  /** Called after DOM changes (scroll pinning, resize). */
  onChange(): void;
}

export class TranscriptView {
  readonly el: HTMLElement;
  private readonly nodes = new Map<string, Rendered>();
  private order: string[] = [];

  constructor(private readonly options: TranscriptOptions) {
    this.el = h('div', { class: 'cc-transcript', role: 'log', 'aria-label': 'Conversation' });
  }

  render(items: readonly TranscriptItem[]): void {
    const ids = items.map((i) => i.id);
    const seen = new Set(ids);
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.el.remove();
        this.nodes.delete(id);
      }
    }
    let changedOrder = ids.length !== this.order.length || ids.some((id, i) => this.order[i] !== id);
    for (const item of items) {
      let node = this.nodes.get(item.id);
      if (node && node.kind !== item.kind) {
        node.el.remove();
        this.nodes.delete(item.id);
        node = undefined;
      }
      if (!node) {
        node = this.create(item);
        this.nodes.set(item.id, node);
        changedOrder = true;
      }
      node.update(item);
    }
    if (changedOrder) {
      // Append in order (moves existing nodes only when needed).
      let prev: Element | null = null;
      for (const id of ids) {
        const el = (this.nodes.get(id) as Rendered).el;
        const expected: Element | null = prev ? prev.nextElementSibling : this.el.firstElementChild;
        if (expected !== el) {
          if (prev) prev.after(el);
          else this.el.prepend(el);
        }
        prev = el;
      }
      this.order = ids;
    }
    this.options.onChange();
  }

  private create(item: TranscriptItem): Rendered {
    switch (item.kind) {
      case 'user': {
        const el = h('div', { class: 'cc-item cc-item-user' });
        return { kind: 'user', el, update: (i) => i.kind === 'user' && (el.textContent = i.text) };
      }
      case 'assistant':
        return this.createAssistant(item);
      case 'tool': {
        const card: ToolCardHandle = createToolCard(item);
        return { kind: 'tool', el: card.el, update: (i) => i.kind === 'tool' && card.update(i) };
      }
      case 'error':
        return this.createError(item);
    }
  }

  private createAssistant(item: AssistantItem): Rendered {
    const el = h('div', { class: 'cc-item cc-item-assistant cc-markdown' });
    let rendered: string | null = null;
    let pending = item.text;
    let frame = 0;
    const flush = (): void => {
      frame = 0;
      if (pending === rendered) return;
      rendered = pending;
      setSanitizedHtml(el, renderMarkdown(pending));
      enhanceCodeBlocks(el);
      this.options.onChange();
    };
    return {
      kind: 'assistant',
      el,
      update: (i) => {
        if (i.kind !== 'assistant') return;
        pending = i.text;
        if (rendered === null) flush();
        else if (!frame && pending !== rendered) frame = requestAnimationFrame(flush);
      },
    };
  }

  private createError(_item: ErrorItem): Rendered {
    const el = h('div', { class: 'cc-item cc-item-error', role: 'alert' });
    let key = '';
    return {
      kind: 'error',
      el,
      update: (i) => {
        if (i.kind !== 'error') return;
        const nextKey = `${i.error.code}|${i.error.message}`;
        if (nextKey === key) return;
        key = nextKey;
        const { title, detail, action } = describeError(i.error);
        replaceChildren(
          el,
          h('strong', { class: 'cc-error-title' }, title),
          h('span', { class: 'cc-error-detail' }, detail),
          action
            ? h(
                'button',
                { type: 'button', class: 'cc-button cc-button-small', on: { click: () => this.options.onErrorAction(action) } },
                action === 'setup' ? 'Set up a provider' : 'Open settings',
              )
            : null,
        );
      },
    };
  }

  /** Latest assistant text (for screen reader announcements). */
  static lastAssistantText(items: readonly TranscriptItem[]): string {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item?.kind === 'assistant') return item.text;
      if (item?.kind === 'user') return '';
    }
    return '';
  }
}
