/**
 * Auto-scroll that does not fight the user: content changes keep the view pinned to the bottom
 * only while the user is (near) the bottom. Scrolling up unpins; scrolling back down re-pins.
 */
const PIN_THRESHOLD_PX = 24;

export class StickyScroller {
  private pinned = true;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('scroll', () => {
      this.pinned = this.distanceFromBottom() <= PIN_THRESHOLD_PX;
    }, { passive: true });
  }

  private distanceFromBottom(): number {
    return this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight;
  }

  /** Call after content changed. */
  update(): void {
    if (this.pinned) this.el.scrollTop = this.el.scrollHeight;
  }

  /** Force to the bottom (e.g. the user sent a message). */
  pin(): void {
    this.pinned = true;
    this.el.scrollTop = this.el.scrollHeight;
  }
}
