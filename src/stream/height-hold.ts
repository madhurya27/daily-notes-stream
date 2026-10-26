/**
 * If nothing changes size for this long, it counts as done, because Bases gives
 * no sign that it is.
 */
export const SETTLE_MS = 300;

/**
 * Long enough for Bases to fill a view, and short enough that a real shrink
 * still shows.
 */
export const HOLD_LIMIT_MS = 2000;

/**
 * Keeps an element at least `height` tall while its contents fill in again, so
 * a dip is never drawn. On iOS, which does not keep the scroll position, the
 * text below would jump away and back. The owner releases it once the contents
 * settle, or the time limit does if they never stop.
 */
export class HeightHold {
    private readonly timer: number;
    private held = true;

    /**
     * styles.css turns the property into a note's `min-height`. `released` runs
     * once the hold ends.
     */
    constructor(
        private readonly el: HTMLElement,
        height: number,
        private readonly released: () => void = () => {}
    ) {
        el.style.setProperty("--daily-note-held-height", `${height}px`);
        this.timer = window.setTimeout(() => this.release(), HOLD_LIMIT_MS);
    }

    get holding(): boolean {
        return this.held;
    }

    release(): void {
        if (!this.held) return;
        this.held = false;
        window.clearTimeout(this.timer);
        this.el.style.removeProperty("--daily-note-held-height");
        this.released();
    }
}
