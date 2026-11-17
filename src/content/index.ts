/**
 * Content script: hosts `bar.html` in a top-layer overlay (see overlay.ts) and toggles it on
 * worker messages or the optional fallback keybind. Bundled as an IIFE (classic content script).
 * Must stay tiny: no app logic, no secrets, nothing from the page rendered.
 *
 * It does not read extension storage (the worker restricts `chrome.storage.local` to extension
 * pages where Chrome supports it): the fallback keybind comes from the worker by message.
 * Everything lives in the extension's isolated world, so nothing here is visible to the page.
 */
import { BAR_PAGE, isSwToContentMessage, type ContentToSwMessage, type KeybindRequestMessage } from '../shared/protocol';
import type { Keybind } from '../shared/types';
import { isKeybind, matchesKeybind } from './keybind';
import { createOverlay } from './overlay';

interface ContentInstance {
  /** False once the extension context that created it is gone (extension reloaded / updated). */
  alive(): boolean;
  dispose(): void;
}

declare global {
  var __carbonCommanderContent: ContentInstance | undefined;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function install(): ContentInstance {
  // Keep this instance's own runtime binding: after an extension reload it is invalidated
  // (`id` becomes undefined) even if a newer binding exists in the same world.
  const runtime = chrome.runtime;
  const contextAlive = (): boolean => {
    try {
      return !!runtime.id;
    } catch {
      return false;
    }
  };
  const overlay = createOverlay({
    // The real origin of our documents. (`getURL` returns the per-session dynamic URL, see
    // `use_dynamic_url` in the manifest, whose host is not the origin the bar ends up with.)
    extensionOrigin: `chrome-extension://${runtime.id}`,
    barUrl: chrome.runtime.getURL(BAR_PAGE),
    registerToken: async (token) => {
      const message: ContentToSwMessage = { cc: 'bar.token', token };
      const reply: unknown = await runtime.sendMessage(message);
      return typeof reply === 'object' && reply !== null && (reply as { ok?: unknown }).ok === true;
    },
  });

  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: { ok: boolean }) => void,
  ): true | undefined => {
    if (sender.id !== chrome.runtime.id || !isSwToContentMessage(message)) return undefined;
    switch (message.cc) {
      case 'overlay.toggle':
        overlay.toggle();
        break;
      case 'overlay.open':
        overlay.show();
        break;
      case 'overlay.close':
        overlay.hide();
        break;
      case 'overlay.suspend':
        overlay.suspend().then(
          (ok) => sendResponse({ ok }),
          () => sendResponse({ ok: false }),
        );
        return true; // async reply
      case 'overlay.resume':
        overlay.resume();
        break;
      case 'keybind':
        keybind = isKeybind(message.keybind) ? message.keybind : null;
        break;
    }
    sendResponse({ ok: true });
    return undefined;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // Optional fallback keybind (Settings.keybind): asked from the worker once, then pushed by it
  // (`{ cc: 'keybind' }`) whenever it changes.
  let keybind: Keybind | null = null;
  const request: KeybindRequestMessage = { cc: 'keybind.get' };
  runtime.sendMessage(request).then(
    (reply: unknown) => {
      const value = (reply as { keybind?: unknown } | undefined)?.keybind;
      keybind = isKeybind(value) ? value : null;
    },
    () => undefined,
  );

  const onKeyDown = (event: KeyboardEvent): void => {
    // Pages can dispatch synthetic key events: only real key presses toggle the overlay.
    if (!event.isTrusted) return;
    if (!keybind || !matchesKeybind(event, keybind)) return;
    // Keybinds always carry Ctrl/Cmd/Alt; still leave plain typing in fields alone.
    if (isEditable(event.target) && !keybind.ctrl && !keybind.meta) return;
    if (!contextAlive()) return;
    event.preventDefault();
    event.stopPropagation();
    overlay.toggle();
  };
  window.addEventListener('keydown', onKeyDown, true);

  return {
    alive: contextAlive,
    dispose() {
      overlay.dispose();
      window.removeEventListener('keydown', onKeyDown, true);
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // Context already invalidated.
      }
    },
  };
}

// The worker injects this file again when the content script did not answer (tab opened before
// install, or an old instance orphaned by an extension reload). Keep a live instance; replace a
// dead one so there is only ever one overlay.
// Not in documents whose root is not HTML (SVG, other XML): the overlay's host element cannot be
// created or shown there; the toolbar button then opens the bar as a tab instead.
const existing = globalThis.__carbonCommanderContent;
if (document.documentElement instanceof HTMLElement && !existing?.alive()) {
  existing?.dispose();
  globalThis.__carbonCommanderContent = install();
}
