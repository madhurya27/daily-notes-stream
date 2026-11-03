/** Which way the pane is scrolling: up the stream, down it, or neither. */
export type ScrollDirection = -1 | 0 | 1;

type Span = Pick<DOMRect, "top" | "bottom">;

/**
 * The note the reader needs next: those on screen from the top down, then those
 * the scroll is heading for, then those it has passed, each nearest first.
 * With the pane still, nothing is ahead or behind, so distance alone decides.
 * Among equals, the first in `waiting`, which must not be empty (D-201).
 */
export function nextToDraw(waiting: HTMLElement[], pane: Span, direction: ScrollDirection): HTMLElement {
    const ranked = waiting.map((block) => ({
        block,
        ...standing(block.getBoundingClientRect(), pane, direction),
    }));
    // `sort` keeps equals in their order.
    ranked.sort(byNeed);
    return ranked[0]!.block;
}

/** Whether the reader needs `block` before `other`, as `nextToDraw` ranks. */
export function goesBefore(block: HTMLElement, other: HTMLElement, pane: Span, direction: ScrollDirection): boolean {
    const a = standing(block.getBoundingClientRect(), pane, direction);
    const b = standing(other.getBoundingClientRect(), pane, direction);
    return byNeed(a, b) < 0;
}

type Standing = { group: number; within: number };

const byNeed = (a: Standing, b: Standing) => a.group - b.group || a.within - b.within;

/** Whether `block` is inside the pane, not just touching its edge. */
export function isOnScreen(block: HTMLElement, pane: Span): boolean {
    return overlaps(block.getBoundingClientRect(), pane);
}

const overlaps = ({ top, bottom }: Span, pane: Span) => bottom > pane.top && top < pane.bottom;

/** Which group a note is in, and where it stands in that group. */
function standing(note: Span, pane: Span, direction: ScrollDirection): Standing {
    if (overlaps(note, pane)) return { group: 0, within: note.top };
    const below = note.top >= pane.bottom;
    const distance = below ? note.top - pane.bottom : pane.top - note.bottom;
    const behind = direction === (below ? -1 : 1);
    return { group: behind ? 2 : 1, within: distance };
}
