/** Bases' own maximum width for a column sized automatically. */
const DEFAULT_MAX_COLUMN_PX = 300;
/**
 * A column narrower than this shows nothing useful, so the table is clipped
 * instead.
 */
const MIN_COLUMN_PX = 40;

/** The maximum column width last set on each view. */
const caps = new WeakMap<HTMLElement, number>();

/**
 * Lowers the maximum width Bases gives columns sized automatically, until the
 * table fits its view, which must not scroll sideways (ADR 0008). Bases reads
 * this maximum from a CSS variable when it lays out. A column resized by hand
 * ignores it.
 */
export function fitBaseToWidth(view: HTMLElement): void {
    const width = tableWidth(view);
    const available = view.clientWidth;
    // Stryker disable next-line EqualityOperator: for a table exactly as wide as its view, the maximum stays where it is.
    if (!(width > available) || available <= 0) return;

    const current = caps.get(view) ?? DEFAULT_MAX_COLUMN_PX;
    const next = Math.max(MIN_COLUMN_PX, Math.floor((current * available) / width));
    if (next >= current) return;

    caps.set(view, next);
    view.style.setProperty("--bases-table-column-max-width", `${next}px`);
    view.style.setProperty("--bases-table-column-min-width", `${MIN_COLUMN_PX}px`);
    // Bases lays the table out again when its view gets a scroll event.
    view.dispatchEvent(new Event("scroll"));
}

/**
 * Where Bases sets the width it laid out a view at: a table's header row, or a
 * kanban's board.
 */
export const LAID_OUT = ".bases-thead, .bases-kanban-container";

/** The width Bases laid out the view at. NaN before it is laid out. */
export function laidOutWidth(view: HTMLElement): number {
    const laidOut = view.querySelector<HTMLElement>(LAID_OUT);
    return laidOut ? parseFloat(laidOut.style.width) : NaN;
}

/**
 * The width Bases laid out the view's table at, set on its header row. NaN
 * before it is laid out.
 */
function tableWidth(view: HTMLElement): number {
    const thead = view.querySelector<HTMLElement>(".bases-thead");
    return thead ? parseFloat(thead.style.width) : NaN;
}
