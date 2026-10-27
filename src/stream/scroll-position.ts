import { SETTLE_MS } from "./height-hold";
import { blockAt } from "./stream-blocks";

/**
 * Where the stream is scrolled to, in a form Obsidian's history can keep: the
 * first note that is at least partly in the pane, and how far its top is from
 * the pane's top.
 */
export interface StreamPlace {
    path: string;
    offset: number;
}

export function isStreamPlace(value: unknown): value is StreamPlace {
    if (typeof value !== "object" || value === null) return false;
    const { path, offset } = value as Partial<StreamPlace>;
    return typeof path === "string" && typeof offset === "number";
}

/**
 * Where `stream` is scrolled to in `scrollEl`, or null if no note is in the
 * pane.
 */
export function readPlace(stream: HTMLElement, scrollEl: HTMLElement): StreamPlace | null {
    const paneTop = scrollEl.getBoundingClientRect().top;
    const block = blockAt(stream, paneTop);
    // Below the last note is the empty element that loads more notes; it is not
    // a note.
    const path = block instanceof HTMLElement ? block.dataset.sourcePath : undefined;
    if (path === undefined) return null;
    return { path, offset: block!.getBoundingClientRect().top - paneTop };
}

/**
 * Scrolls `scrollEl` so that `block`'s top is `offset` below the pane's top.
 */
export function scrollBlockTo(block: HTMLElement, offset: number, scrollEl: HTMLElement): void {
    scrollEl.scrollTop += block.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - offset;
}

/** How many times to try the scroll before leaving it where it is. */
const MAX_SCROLL_PASSES = 8;

/** How close to its place in the pane counts as arrived. */
const SCROLL_TOLERANCE_PX = 2;

/**
 * Waits two frames. In the first, the scroll is painted. By the second, the
 * IntersectionObserver's callback for it has run.
 */
async function observersDelivered(): Promise<void> {
    for (let frame = 0; frame < 2; frame++) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
}

/** What can move a block after it has been scrolled to. */
export interface StreamLayout {
    /**
     * How many notes were rendered or unloaded so far. If it does not change
     * during a try, the stream has stopped changing.
     */
    layoutChanges(): number;
    /** Resolves once the renders already queued have run. */
    drain(): Promise<void>;
    /**
     * The scroll was just set here. The scroll anchor keeps its place from
     * now on, not from where the reader was (D-180).
     */
    placed(): void;
}

/**
 * Where in the pane an element is placed: its top at the pane's top, or its
 * center at the pane's center.
 */
export type Placement = "start" | "center";

/**
 * What a scroll places: a block, or a search match, whose element may be taller
 * than the pane.
 */
export type Placed = HTMLElement | Range;

/** How far `placed` is from its place in `scrollEl`. */
function offsetFromPlace(placed: Placed, placement: Placement, scrollEl: HTMLElement): number {
    const rect = placed.getBoundingClientRect();
    const pane = scrollEl.getBoundingClientRect();
    if (placement === "start") return rect.top - pane.top;
    return (rect.top + rect.bottom - pane.top - pane.bottom) / 2;
}

/**
 * Scrolls `placed` to its place. A range has no `scrollIntoView`, so the pane
 * is moved by the distance instead.
 */
function scrollToPlace(placed: Placed, placement: Placement, scrollEl: HTMLElement): void {
    if (placed instanceof Range) scrollEl.scrollTop += offsetFromPlace(placed, placement, scrollEl);
    else placed.scrollIntoView({ block: placement });
}

/** The element `placed` is in. A match's text is always in one. */
function elementOf(placed: Placed): Element {
    return placed instanceof Range ? placed.startContainer.parentElement! : placed;
}

/**
 * Moves `placed` to its place in `scrollEl` and keeps it there. Scrolling to it
 * makes the window manager render the notes around it. A note rendered *above*
 * it can grow taller than its estimated height and push it down (ADR 0006). So
 * the scroll is set again until `placed` is in place and the stream has stopped
 * rendering.
 */
export async function scrollIntoPlace(
    placed: Placed,
    placement: Placement,
    scrollEl: HTMLElement,
    layout: StreamLayout
): Promise<void> {
    /**
     * The number of changes when the last try ended. Null before the first try.
     */
    let settled: number | null = null;
    for (let pass = 0; pass < MAX_SCROLL_PASSES; pass++) {
        const changes = layout.layoutChanges();
        const scrollTop = scrollEl.scrollTop;
        scrollToPlace(placed, placement, scrollEl);
        layout.placed();
        // If the scroll moved nothing, and the stream has not changed since the
        // last try, it cannot get any closer. No observer will report anything,
        // and waiting a frame for one could wait forever when no frame is
        // drawn.
        if (scrollEl.scrollTop === scrollTop && changes === settled) return;
        await observersDelivered();
        await layout.drain();

        // It is in place the moment it is scrolled to; the renders that will
        // push it down finish later. So it has only arrived when it is in place
        // *and* nothing was rendered or unloaded during this try.
        const offset = offsetFromPlace(placed, placement, scrollEl);
        settled = layout.layoutChanges();
        if (Math.abs(offset) <= SCROLL_TOLERANCE_PX && settled === changes) return;
    }
    // No tries left: something kept pushing it away.
}

/**
 * Keeps `placed` at its place in `scrollEl` while what is above it changes
 * size, until nothing changes for `SETTLE_MS`. Returns a function that stops
 * sooner, which the reader moving the pane must call. A Base fills in after it
 * is drawn, which `scrollIntoPlace` does not count, and a Base above `placed`
 * pushes it off screen. It is put back in the same frame it moved, because a
 * resize is reported before the frame is painted.
 */
export function keepInPlace(
    placed: Placed,
    placement: Placement,
    scrollEl: HTMLElement,
    stream: HTMLElement
): () => void {
    const holder = elementOf(placed);
    let settle = 0;
    const waitForStill = () => {
        window.clearTimeout(settle);
        settle = window.setTimeout(letGo, SETTLE_MS);
    };
    const observer = new ResizeObserver(() => {
        if (!holder.isConnected) return letGo();
        if (Math.abs(offsetFromPlace(placed, placement, scrollEl)) > SCROLL_TOLERANCE_PX)
            scrollToPlace(placed, placement, scrollEl);
        waitForStill();
    });
    function letGo(): void {
        window.clearTimeout(settle);
        observer.disconnect();
    }
    observer.observe(stream);
    for (const above of aboveInBlock(holder, stream)) observer.observe(above);
    waitForStill();
    return letGo;
}

/**
 * The elements above `el` inside its block. While a note's height is held, a
 * Base filling in inside it changes nothing outside the note, so these are
 * watched. The blocks above change the stream's size, which is watched too.
 */
function aboveInBlock(el: Element, stream: HTMLElement): Element[] {
    const above: Element[] = [];
    for (let at = el; at.parentElement && at.parentElement !== stream; at = at.parentElement) {
        for (let sibling = at.previousElementSibling; sibling; sibling = sibling.previousElementSibling)
            above.push(sibling);
    }
    return above;
}
