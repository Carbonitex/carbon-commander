// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createOverlay, OVERLAY_TAG, type Overlay } from '../../src/content/overlay';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
describe('createOverlay', () => {
  let overlay: Overlay | null = null;
  afterEach(() => {
    overlay?.dispose();
    overlay = null;
    document.body.replaceChildren();
    document.querySelectorAll(OVERLAY_TAG).forEach((e) => e.remove());
  });

  const make = () => (overlay = createOverlay({ extensionOrigin: ORIGIN, barUrl: `${ORIGIN}/bar.html` }));
  const host = () => document.querySelector<HTMLElement>(OVERLAY_TAG);

  it('creates one host lazily, shows / hides / toggles, and keeps the iframe while hidden', () => {
    const o = make();
    expect(host()).toBeNull();
    o.show();
    expect(document.querySelectorAll(OVERLAY_TAG)).toHaveLength(1);
    expect(o.isOpen()).toBe(true);
    expect(host()?.style.getPropertyValue('display')).toBe('block');
    expect(host()?.style.getPropertyValue('z-index')).toBe('2147483647');
    o.toggle();
    expect(o.isOpen()).toBe(false);
    expect(host()?.style.getPropertyValue('display')).toBe('none');
    expect(document.querySelectorAll(OVERLAY_TAG)).toHaveLength(1); // still in the DOM
    o.toggle();
    expect(o.isOpen()).toBe(true);
    expect(document.querySelectorAll(OVERLAY_TAG)).toHaveLength(1);
  });

  it('uses a closed shadow root (page cannot reach the iframe)', () => {
    make().show();
    expect(host()?.shadowRoot).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('ignores synthetic Escape key events from the page (only real key presses close it)', () => {
    const o = make();
    o.show();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(o.isOpen()).toBe(true);
  });

  it('restores focus on hide', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const o = make();
    o.show();
    o.hide();
    expect(o.isOpen()).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('lives on <html>, so replacing <body> keeps it; a removed host is re-attached on show', () => {
    const o = make();
    o.show();
    expect(host()?.parentElement).toBe(document.documentElement);
    document.body.replaceWith(document.createElement('body'));
    expect(host()?.isConnected).toBe(true);
    o.hide();
    host()?.remove();
    expect(host()).toBeNull();
    o.show();
    expect(host()?.parentElement).toBe(document.documentElement);
    expect(o.isOpen()).toBe(true);
  });

  it('ignores window messages that do not come from its iframe', () => {
    const o = make();
    o.show();
    window.dispatchEvent(new MessageEvent('message', { data: { cc: 'close' }, origin: ORIGIN, source: window }));
    window.dispatchEvent(new MessageEvent('message', { data: { cc: 'close' }, origin: 'https://page.example' }));
    expect(o.isOpen()).toBe(true);
  });

  it('suspend hides an open overlay without closing it; resume restores it', async () => {
    const o = make();
    expect(await o.suspend()).toBe(false); // not open: nothing to hide
    o.show();
    expect(await o.suspend()).toBe(true);
    expect(host()?.style.getPropertyValue('visibility')).toBe('hidden');
    expect(o.isOpen()).toBe(true);
    expect(host()?.style.getPropertyValue('display')).toBe('block');
    o.resume();
    expect(host()?.style.getPropertyValue('visibility')).toBe('');
  });

  it('dispose removes the host and its listeners', () => {
    const o = make();
    o.show();
    o.dispose();
    expect(host()).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
});
