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
    ranked.sort((a, b) => a.group - b.group || a.within - b.within);
    return ranked[0]!.block;
}

/** Which group a note is in, and where it stands in that group. */
function standing({ top, bottom }: Span, pane: Span, direction: ScrollDirection): { group: number; within: number } {
    if (bottom > pane.top && top < pane.bottom) return { group: 0, within: top };
    const below = top >= pane.bottom;
    const distance = below ? top - pane.bottom : pane.top - bottom;
    const behind = direction === (below ? -1 : 1);
    return { group: behind ? 2 : 1, within: distance };
}
