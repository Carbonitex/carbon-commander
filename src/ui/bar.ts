/**
 * Bar page entry. Works inside the content script's iframe (`bar.html`, the worker binds the port
 * to the iframe's tab) and as a standalone extension tab (`bar.html?tabId=N`).
 * Dev builds also support `bar.html?mock=1`: a scripted fake worker, no extension APIs needed.
 *
 * Embedded, the bar first proves to the worker that it sits in the iframe our content script
 * created (token handshake, see `shared/protocol.ts`). A page that frames `bar.html` itself never
 * gets a token, and the bar refuses to do anything there.
 */
import './styles/bar.css';
import { startApp } from './app';
import { chromeEnv, parseTabId, type UiEnv } from './env';
import { isEmbedded, setHostPort } from './host';
import { createMockEnv } from './mock';
import { isHostInitMessage, type BarClaimMessage } from '../shared/protocol';

/** How long an embedded bar waits for its host's token before refusing to start. */
const HANDSHAKE_TIMEOUT_MS = 8_000;
const MAX_CLAIM_ATTEMPTS = 5;

function pickEnv(): UiEnv {
  const params = new URLSearchParams(location.search);
  // `__DEV__` is a build-time constant: in production the mock branch (and module) is dropped.
  if (__DEV__ && params.has('mock')) return createMockEnv();
  return chromeEnv(parseTabId(location.search));
}

/**
 * Wait for `{ cc: 'init', token }` (with the channel port) from the parent and claim it. The page
 * should never hold a reference to this window, but junk `init`s are still tolerated a few times.
 */
function handshake(): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent || !isHostInitMessage(event.data)) return;
      const port = event.ports[0];
      if (!port) return;
      if (++attempts > MAX_CLAIM_ATTEMPTS) return finish(false);
      const claim: BarClaimMessage = { cc: 'bar.claim', token: event.data.token };
      chrome.runtime.sendMessage<BarClaimMessage, { ok?: boolean } | undefined>(claim).then(
        (reply) => {
          if (reply?.ok === true && !settled) {
            // Only the port of the init whose token the worker accepted came from our host.
            setHostPort(port);
            finish(true);
          } else port.close();
        },
        () => undefined,
      );
    };
    const timer = setTimeout(() => finish(false), HANDSHAKE_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
  });
}

async function main(root: HTMLElement): Promise<void> {
  const mock = __DEV__ && new URLSearchParams(location.search).has('mock');
  if (isEmbedded() && !mock && !(await handshake())) {
    root.textContent =
      'Carbon Commander only runs in its own overlay (press its shortcut or click the toolbar button) or in its own tab.';
    return;
  }
  await startApp(root, pickEnv());
}

const root = document.getElementById('cc-root');
if (root) {
  main(root).catch((err: unknown) => {
    root.textContent = `Carbon Commander failed to start: ${err instanceof Error ? err.message : String(err)}`;
  });
}
