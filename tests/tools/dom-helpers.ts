/**
 * jsdom has no layout: every element has a zero-size rect, so "visible" checks would fail. This
 * gives elements a fake rect (hidden ones via `display:none` are still filtered by computed style).
 * `data-test-top="2000"` moves an element below the fold.
 */
export function installFakeLayout(): void {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const top = Number(this.getAttribute('data-test-top') ?? 10);
    return { x: 10, y: top, top, left: 10, width: 100, height: 20, right: 110, bottom: top + 20, toJSON: () => ({}) };
  };
  Element.prototype.getClientRects = function (this: Element): DOMRectList {
    const rect = this.getBoundingClientRect();
    return Object.assign([rect], { item: (i: number) => (i === 0 ? rect : null) });
  };
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = function () {};
}

/** Clear the isolated-world ref registry between tests. */
export function resetRefs(): void {
  delete (window as unknown as Record<symbol, unknown>)[Symbol.for('carbon-commander.element-refs')];
}
