/**
 * The timers a view has running, so it can cancel them all as it closes. A
 * closed view's render may never end, and nothing waits for it (D-199).
 */
export class ViewTimers {
    private readonly running = new Set<number>();

    start(run: () => void, ms: number): number {
        const id = window.setTimeout(() => {
            // Stryker disable next-line all: only frees memory; cancelling a finished timer does nothing.
            this.running.delete(id);
            run();
        }, ms);
        this.running.add(id);
        return id;
    }

    cancel(id: number): void {
        window.clearTimeout(id);
        // Stryker disable next-line all: only frees memory; cancelling a finished timer does nothing.
        this.running.delete(id);
    }

    cancelAll(): void {
        for (const id of this.running) window.clearTimeout(id);
    }
}
