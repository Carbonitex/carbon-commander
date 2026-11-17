// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ARM_DELAY_MS, ConfirmView, RAISE_INTERVAL_MS, type ConfirmReply, type VisibilityEntry } from '../../src/ui/chat/confirm';
import type { ConfirmRequest } from '../../src/shared/types';

const request = (over: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
  id: 'c1',
  toolCallId: 'k1',
  toolName: 'click',
  args: { ref: 'e1' },
  sourceLabel: 'Built-in',
  ...over,
});

function setup(options: { embedded?: boolean; typing?: boolean; tracking?: boolean } = {}) {
  let now = 1_000;
  const replies: ConfirmReply[] = [];
  const announced: string[] = [];
  let raised = 0;
  let report: ((entries: VisibilityEntry[]) => void) | null = null;
  const view = new ConfirmView({
    onReply: (_id, reply) => replies.push(reply),
    embedded: options.embedded ?? true,
    isTyping: () => options.typing ?? false,
    announce: (t) => announced.push(t),
    onRaise: () => raised++,
    now: () => now,
    observeVisibility:
      options.tracking === false
        ? () => null
        : (cb) => {
            report = cb;
            return { observe: () => undefined, disconnect: () => (report = null) };
          },
  });
  document.body.append(view.el);
  const button = (name: string): HTMLButtonElement =>
    [...view.el.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name)) as HTMLButtonElement;
  return {
    view,
    replies,
    announced,
    raised: () => raised,
    button,
    advance: (ms: number) => (now += ms),
    visible: (isVisible: boolean) => report?.([{ isIntersecting: true, isVisible }]),
  };
}

afterEach(() => document.body.replaceChildren());

describe('ConfirmView', () => {
  it('ignores activation during the arming delay', () => {
    const t = setup();
    t.view.show(request());
    t.visible(true);
    t.button('Allow').click();
    expect(t.replies).toEqual([]);
    expect(t.view.el.textContent).toContain('Just a moment');
    t.advance(ARM_DELAY_MS);
    t.button('Allow').click();
    expect(t.replies).toEqual([{ allow: true }]);
  });

  it('accepts clicks only while the browser reports the buttons visible (clickjacking guard)', () => {
    const t = setup();
    t.view.show(request());
    t.advance(ARM_DELAY_MS + 1);
    t.button('Allow').click(); // no visibility report yet
    expect(t.replies).toEqual([]);
    t.visible(false); // covered by something
    t.button('Allow').click();
    expect(t.replies).toEqual([]);
    expect(t.view.el.textContent).toContain('not fully visible');
    t.visible(true);
    t.button('Deny').click();
    expect(t.replies).toEqual([{ allow: false }]);
  });

  it('without visibility tracking (or in a tab) only the arming delay applies', () => {
    for (const opts of [{ tracking: false }, { embedded: false }]) {
      const t = setup(opts);
      t.view.show(request());
      t.advance(ARM_DELAY_MS);
      t.button('Allow').click();
      expect(t.replies).toEqual([{ allow: true }]);
      document.body.replaceChildren();
    }
  });

  it('re-arms when the overlay is shown again', () => {
    const t = setup();
    t.view.show(request());
    t.visible(true);
    t.advance(ARM_DELAY_MS + 1);
    t.view.rearm();
    t.button('Allow').click();
    expect(t.replies).toEqual([]);
  });

  it('does not steal focus while the user is typing; announces a keyboard path instead', () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    const t = setup({ typing: true });
    t.view.show(request());
    expect(document.activeElement).toBe(input);
    expect(t.announced.at(-1)).toMatch(/Shift\+Tab/);
  });

  it('raises the overlay only when the prompt is reported covered (raising can drop focus), throttled', () => {
    const t = setup();
    t.view.show(request());
    t.visible(true);
    expect(t.raised()).toBe(0); // nothing covers it: leave the top layer (and the focus) alone
    t.visible(false);
    expect(t.raised()).toBe(1);
    t.visible(true);
    t.visible(false);
    expect(t.raised()).toBe(1); // within RAISE_INTERVAL_MS
    t.advance(RAISE_INTERVAL_MS);
    t.visible(false);
    expect(t.raised()).toBe(2);
  });

  it('raises once when visibility cannot be tracked, never in an extension tab', () => {
    const untracked = setup({ tracking: false });
    untracked.view.show(request());
    expect(untracked.raised()).toBe(1);
    document.body.replaceChildren();
    const tab = setup({ embedded: false });
    tab.view.show(request());
    expect(tab.raised()).toBe(0);
  });

  it('otherwise focuses the prompt itself (not Allow) and has no letter shortcuts', () => {
    const t = setup();
    t.view.show(request());
    expect(document.activeElement?.getAttribute('role')).toBe('alertdialog');
    t.advance(ARM_DELAY_MS);
    t.visible(true);
    for (const key of ['a', 'A', 'd', 'D', 'Enter']) {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(t.replies).toEqual([]);
  });

  it('describes egress and argument-triggered prompts, and scopes "always" to the origin', () => {
    const t = setup();
    t.view.show(request({ toolName: 'fetch_url', reason: 'egress', egressHost: 'evil.example', origin: 'https://shop.example' }));
    expect(t.view.el.textContent).toContain('It sends a request to evil.example.');
    expect(t.button('Always allow on shop.example')).toBeTruthy();
    t.view.show(request({ id: 'c2', toolName: 'list_tabs', reason: 'args', triggerArgs: ['all_windows'] }));
    expect(t.view.el.textContent).toContain('all_windows');
  });
});
