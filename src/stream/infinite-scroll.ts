/**
 * Loads more notes when an empty element at the end comes into view. The
 * element is added again as the last child on every attach.
 */
export class InfiniteScrollController {
    private sentinel: HTMLElement | null = null;
    private observer: IntersectionObserver | null = null;

    attach(scrollRoot: HTMLElement, container: HTMLElement, onTrigger: () => Promise<void>): void {
        this.detach();

        this.sentinel = createDiv();
        this.sentinel.addClass("daily-notes-stream-sentinel");
        container.appendChild(this.sentinel);

        this.observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry?.isIntersecting) {
                    onTrigger().catch((error) => {
                        console.error("DailyNotesStream: Failed to load more notes", error);
                    });
                }
            },
            {
                root: scrollRoot,
                rootMargin: "200px",
            }
        );

        this.observer.observe(this.sentinel);
    }

    /**
     * Forces a new callback, because IntersectionObserver only fires on
     * *changes*.
     */
    recheck(): void {
        // Stryker disable next-line LogicalOperator: attach and detach always set and clear both together.
        if (!this.observer || !this.sentinel) return;
        this.observer.unobserve(this.sentinel);
        this.observer.observe(this.sentinel);
    }

    detach(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.sentinel) {
            this.sentinel.remove();
            this.sentinel = null;
        }
    }

    /**
     * Returns the empty element at the end, which is always the container's
     * last child.
     */
    getSentinel(): HTMLElement | null {
        return this.sentinel;
    }
}
