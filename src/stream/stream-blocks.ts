/**
 * Where the stream's blocks are: in note order, before the sentinel that loads
 * more notes, and indexed by the path each was rendered with. A block's
 * children may be unloaded (ADR 0006), so blocks are always found through the
 * index, never through a DOM query.
 */
export class StreamBlocks {
    private container!: HTMLElement;
    private readonly byPath = new Map<string, HTMLElement>();

    /**
     * The sentinel is created again each time scrolling is attached, so it is
     * looked up each time.
     */
    constructor(private readonly sentinel: () => HTMLElement | null) {}

    get el(): HTMLElement {
        return this.container;
    }

    attach(container: HTMLElement): void {
        this.container = container;
    }

    get(path: string): HTMLElement | null {
        return this.byPath.get(path) ?? null;
    }

    /** Every indexed block, by path. */
    entries(): IterableIterator<[string, HTMLElement]> {
        return this.byPath.entries();
    }

    /** Puts `block` after the last note. */
    append(path: string, block: HTMLElement): void {
        this.byPath.set(path, block);
        this.insertBeforeSentinel(block);
    }

    /** Puts `block` before the note at `nextPath`, or last if there is none. */
    insertBefore(path: string, block: HTMLElement, nextPath: string | undefined): void {
        this.byPath.set(path, block);
        // Stryker disable next-line ConditionalExpression: no note has an undefined path, so get finds none either.
        const next = nextPath === undefined ? null : this.get(nextPath);
        if (next) {
            this.container.insertBefore(block, next);
        } else {
            this.insertBeforeSentinel(block);
        }
    }

    /** Removes the block at `path` from the stream. Null if there is none. */
    remove(path: string): HTMLElement | null {
        const block = this.get(path);
        if (!block) return null;
        block.remove();
        this.byPath.delete(path);
        return block;
    }

    /** Forgets every block without touching the DOM. */
    clear(): void {
        this.byPath.clear();
    }

    /** Empties the container and forgets every block. */
    empty(): void {
        this.container.empty();
        this.clear();
    }

    /** Shows `text` as the only message, instead of the stream's notes. */
    showEmptyState(text: string): void {
        const shown = this.findEmptyState();
        if (shown) shown.setText(text);
        else this.insertBeforeSentinel(this.container.createDiv({ cls: "daily-notes-empty-state", text }));
    }

    hideEmptyState(): void {
        this.findEmptyState()?.remove();
    }

    private findEmptyState(): HTMLElement | null {
        return this.container.querySelector(".daily-notes-empty-state");
    }

    /**
     * The sentinel must stay the last child, so everything is put before it.
     */
    private insertBeforeSentinel(el: HTMLElement): void {
        // Inserting before null puts the element last.
        this.container.insertBefore(el, this.sentinel());
    }
}

/**
 * The block at `paneTop`, found by binary search: blocks are stacked in order,
 * and a stream can hold thousands.
 */
export function blockAt(stream: HTMLElement, paneTop: number): Element | null {
    const blocks = stream.children;
    let low = 0;
    let high = blocks.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (blocks[mid]!.getBoundingClientRect().bottom > paneTop) high = mid;
        else low = mid + 1;
    }
    return blocks[low] ?? null;
}
