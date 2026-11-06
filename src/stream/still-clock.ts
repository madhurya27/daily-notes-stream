import { SCROLL_IDLE_MS } from "./scroll-anchor";
import type { ViewTimers } from "./view-timers";

/**
 * Runs work that must wait for the pane to stop scrolling or resizing. All of
 * it shares one wait, from the last move: work asked for once the pane has
 * been still for `SCROLL_IDLE_MS` runs in the next task, without waiting
 * again. Separate waits, each started when the one before ended, added up.
 */
export class StillClock {
    /** When the pane last moved. */
    private movedAt = -Infinity;
    /** The scroll position when the pane last moved; null before it has. */
    private movedTo: number | null = null;
    /** What runs once the pane is still, in the order asked. */
    private readonly due = new Set<() => void>();
    private timer: number | null = null;

    /** `scrollTop` reads the pane's scroll position. */
    constructor(
        private readonly timers: ViewTimers,
        private readonly scrollTop: () => number
    ) {}

    /**
     * The pane scrolled or was resized. Only noted: a wait under way checks
     * when it ends, which costs nothing per scroll event.
     */
    moved(): void {
        this.movedAt = performance.now();
        this.movedTo = this.scrollTop();
    }

    /** Whether the pane has not moved for `SCROLL_IDLE_MS`. */
    isStill(): boolean {
        return performance.now() - this.movedAt >= SCROLL_IDLE_MS;
    }

    /** Runs `task` once the pane is still. Asked again before then, once. */
    whenStill(task: () => void): void {
        this.due.add(task);
        if (this.timer === null) this.waitOut();
    }

    cancel(task: () => void): void {
        this.due.delete(task);
        if (this.due.size === 0) this.clear();
    }

    /** Waits out what is left of the wait from the last move. */
    private waitOut(): void {
        const left = Math.max(this.movedAt + SCROLL_IDLE_MS - performance.now(), 0);
        this.timer = this.timers.start(() => this.run(), left);
    }

    private run(): void {
        this.timer = null;
        // A busy page can hold back iOS's scroll events for longer than the
        // wait, while a glide goes on. Setting the scroll then is undone.
        if (this.movedTo !== null && this.scrollTop() !== this.movedTo) this.moved();
        if (!this.isStill()) {
            this.waitOut();
            return;
        }
        const tasks = [...this.due];
        this.due.clear();
        for (const task of tasks) task();
    }

    private clear(): void {
        // Stryker disable next-line ConditionalExpression: clearing a timer that does not exist does nothing.
        if (this.timer !== null) this.timers.cancel(this.timer);
        this.timer = null;
    }
}
