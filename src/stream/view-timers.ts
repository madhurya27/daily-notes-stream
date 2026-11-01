import { Component, type Debouncer } from "obsidian";

/**
 * The timers of one view, started through here so that they end with it: the
 * view adds this as a child component, and unloading cancels whatever is still
 * waiting (D-199). Lint stops the view's code from starting a timer any other
 * way. A timer of one note belongs to that note's component instead.
 */
export class ViewTimers extends Component {
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

    /** Works as Obsidian's `debounce`, on this view's timers. */
    debounce<T extends unknown[]>(run: (...args: T) => unknown, ms: number, restart = false): Debouncer<T, void> {
        let waiting: number | null = null;
        let lastArgs: T;
        const stop = () => {
            this.cancel(waiting!);
            waiting = null;
        };
        const debounced = ((...args: T) => {
            lastArgs = args;
            if (waiting !== null && !restart) return debounced;
            if (waiting !== null) stop();
            waiting = this.start(() => {
                waiting = null;
                run(...lastArgs);
            }, ms);
            return debounced;
        }) as Debouncer<T, void>;
        debounced.cancel = () => {
            // Stryker disable next-line ConditionalExpression: clearing a timer that does not exist does nothing.
            if (waiting !== null) stop();
            return debounced;
        };
        debounced.run = () => {
            if (waiting === null) return;
            stop();
            run(...lastArgs);
        };
        return debounced;
    }

    override onunload(): void {
        this.cancelAll();
    }
}
