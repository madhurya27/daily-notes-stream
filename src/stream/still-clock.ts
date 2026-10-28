import { SCROLL_IDLE_MS } from "./scroll-anchor";

/**
 * Runs work that must wait for the pane to stop scrolling or resizing. All of
 * it shares one wait, from the last move: work asked for once the pane has
 * been still for `SCROLL_IDLE_MS` runs in the next task, without waiting
 * again. Separate waits, each started when the one before ended, added up.
 */
export class StillClock {
    /** When the pane last moved. */
    private movedAt = -Infinity;
    /** What runs once the pane is still, in the order asked. */
    private readonly due = new Set<() => void>();
    private timer: number | null = null;

    /**
     * The pane scrolled or was resized. Only noted: a wait under way checks
     * when it ends, which costs nothing per scroll event.
     */
    moved(): void {
        this.movedAt = performance.now();
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
        this.timer = window.setTimeout(() => this.run(), left);
    }

    private run(): void {
        this.timer = null;
        if (performance.now() - this.movedAt < SCROLL_IDLE_MS) {
            this.waitOut();
            return;
        }
        const tasks = [...this.due];
        this.due.clear();
        for (const task of tasks) task();
    }

    private clear(): void {
        window.clearTimeout(this.timer ?? undefined);
        this.timer = null;
    }
}
