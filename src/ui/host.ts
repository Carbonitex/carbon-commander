/**
 * The bar's side of the private iframe <-> content-script channel. The content script hands the bar
 * one end of a `MessageChannel` in its origin-pinned `init` message (see `bar.ts` and
 * `shared/protocol.ts`); everything goes over that port. The bar never posts to `window.parent`,
 * so the page receives nothing from it. When the bar is opened as a normal extension tab there is
 * no host: everything here becomes a no-op.
 */
import { isHostToFrameMessage, type FrameToHostMessage, type HostToFrameMessage } from '../shared/protocol';

export function isEmbedded(): boolean {
  return window.parent !== window;
}

let hostPort: MessagePort | null = null;
const listeners = new Set<(message: HostToFrameMessage) => void>();
/** Messages that arrived before anyone listened (the app starts after the handshake). */
const early: HostToFrameMessage[] = [];

/** Adopt the channel port received with `init` (once per bar document). */
export function setHostPort(port: MessagePort): void {
  if (hostPort) return;
  hostPort = port;
  port.onmessage = (event: MessageEvent) => {
    if (!isHostToFrameMessage(event.data)) return;
    if (listeners.size === 0) early.push(event.data);
    for (const listener of listeners) listener(event.data);
  };
}

export function postToHost(message: FrameToHostMessage): void {
  hostPort?.postMessage(message);
}

/** Messages from the host (only ever from the channel port). */
export function onHostMessage(listener: (message: HostToFrameMessage) => void): () => void {
  listeners.add(listener);
  for (const message of early.splice(0)) listener(message);
  return () => listeners.delete(listener);
}

const px = (value: string): number => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The height a scroll container's content needs, in fractional CSS pixels: its in-flow children's
 * heights with their vertical margins (adjacent ones collapse, as in block layout), plus its own
 * padding and borders. Unlike `scrollHeight` / `clientHeight` (each rounded on its own, so their
 * difference can be 1 when nothing overflows, or 0 when 0.4 px does) this does not depend on how
 * tall the container currently is. Child heights, not positions: a transform on a child (an
 * appearing item slides in) must not change the answer.
 */
export function contentHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  let total = px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  let previousMargin: number | null = null;
  for (const child of el.children) {
    const cs = getComputedStyle(child);
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
    const top = px(cs.marginTop);
    total += child.getBoundingClientRect().height;
    // Positive adjoining margins collapse to the larger one (the only kind the bar's CSS uses).
    total += previousMargin === null ? top : Math.max(previousMargin, top);
    previousMargin = px(cs.marginBottom);
  }
  return total + (previousMargin ?? 0);
}

/**
 * The height the bar would take if nothing clamped it (its border box), independent of the
 * iframe's current height. While the iframe is smaller, the bar is clamped and its scroll area
 * shrinks: the scroll area's box is replaced by the height of its content. Once the scroll area
 * is squeezed to nothing, the fixed parts (header, input, footer) overflow the bar itself, which
 * is added as well (otherwise a bar opened at a small initial height would never grow).
 *
 * The result must not depend on the current height, or the host's resize and the next
 * measurement can feed each other: measuring with rounded values (`offsetHeight`, `scrollHeight -
 * clientHeight`) asked for 379 px at 378 and 378 px at 379 when the natural height was fractional,
 * and the iframe then changed height on every frame for good.
 */
export function naturalHeight(bar: HTMLElement, scroller: HTMLElement | null): number {
  const barHeight = bar.getBoundingClientRect().height;
  if (!scroller || !bar.contains(scroller)) return barHeight + Math.max(0, bar.scrollHeight - bar.clientHeight);
  const box = scroller.getBoundingClientRect().height;
  const squeezed = box < 1 ? Math.max(0, bar.scrollHeight - bar.clientHeight) : 0;
  return barHeight - box + contentHeight(scroller) + squeezed;
}

/** A height report is sent at the latest this long after it was asked for (rAF can be throttled). */
export const RESIZE_FALLBACK_MS = 100;

export interface ResizeReporter {
  /** Report if the height changed (coalesced to one measurement per frame). */
  (): void;
  /** Report the current height even if it is unchanged (e.g. the overlay was shown again). */
  force(): void;
}

/**
 * Report the height the bar would like (content height) to the host, coalesced per frame and
 * only when it changed. The measurement runs on the next animation frame, or after
 * `RESIZE_FALLBACK_MS` if no frame comes first: animation frames of a cross-origin iframe can be
 * throttled (for example while the overlay is being shown), and a report that never runs would
 * leave the overlay at its initial height for good. `force()` re-sends the current height, so a
 * report the host missed is repaired every time the overlay is shown.
 */
export function createResizeReporter(
  measure: () => number,
  post: (height: number) => void = (height) => postToHost({ cc: 'resize', height }),
): ResizeReporter {
  let last = -1;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = null;
    timer = null;
    const height = Math.ceil(measure());
    if (height !== last && Number.isFinite(height) && height > 0) {
      last = height;
      post(height);
    }
  };
  const report = (): void => {
    if (frame !== null || timer !== null) return;
    frame = requestAnimationFrame(run);
    timer = setTimeout(run, RESIZE_FALLBACK_MS);
  };
  return Object.assign(report, {
    force(): void {
      last = -1;
      report();
    },
  });
}
