/**
 * A shown element's border box, and the margins it shares with its neighbours.
 */
export interface Box {
    top: number;
    bottom: number;
    marginTop: number;
    marginBottom: number;
}

/** Null if the element is not shown, for example because a fold hid it. */
function boxOf(el: Element): Box | null {
    if (el.getClientRects().length === 0) return null;
    const { top, bottom } = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { top, bottom, marginTop: parseFloat(style.marginTop), marginBottom: parseFloat(style.marginBottom) };
}

const SPACER = "daily-note-far-run";

interface Run {
    spacer: HTMLElement;
    elements: Element[];
}

/**
 * Runs (groups of a long note's elements) taken out of the layout, each
 * replaced by a spacer as tall as the run was (ADR 0021). The elements stay in
 * the note, so folding, search and an update in place still find them.
 */
export class FarRuns {
    /** Maps each hidden element, and each spacer, to its run. */
    private readonly runs = new WeakMap<Element, Run>();
    /**
     * Called for each run shown again, whatever showed it, so it is watched
     * again (ADR 0023).
     */
    onShown: (run: Element[]) => void = () => {};

    /** jsdom has no layout, so tests replace this function to measure. */
    constructor(private readonly box: (el: Element) => Box | null = boxOf) {}

    /**
     * Hides `elements`, which are siblings next to each other, behind one
     * spacer. Returns null if none of them is shown. The spacer has the outer
     * margins of the first and last shown element, so they combine with the
     * neighbours' margins as before. A caller hiding several runs must measure
     * each one first: hiding one between two measurements lays the note out
     * again.
     */
    hide(elements: Element[], box: Box | null = this.measure(elements)): HTMLElement | null {
        if (!box) return null;

        const spacer = createDiv();
        spacer.addClass(SPACER);
        spacer.style.setProperty("--daily-note-far-height", `${box.bottom - box.top}px`);
        spacer.style.setProperty("--daily-note-far-margin-top", `${box.marginTop}px`);
        spacer.style.setProperty("--daily-note-far-margin-bottom", `${box.marginBottom}px`);
        elements[0]!.before(spacer);

        const run: Run = { spacer, elements };
        this.runs.set(spacer, run);
        for (const el of elements) {
            el.addClass("is-far");
            this.runs.set(el, run);
        }
        return spacer;
    }

    /**
     * Where `elements` are, from the first shown one to the last, with the
     * outer margins of those two. Null if none is shown.
     */
    measure(elements: Element[]): Box | null {
        const boxes = elements.map((el) => this.box(el)).filter((box): box is Box => box !== null);
        if (boxes.length === 0) return null;
        const [first, last] = [boxes[0]!, boxes[boxes.length - 1]!];
        return { top: first.top, bottom: last.bottom, marginTop: first.marginTop, marginBottom: last.marginBottom };
    }

    /** Whether a hidden run holds `node`. */
    hides(node: Node): boolean {
        return this.runOf(node) !== undefined;
    }

    /**
     * Shows again the run that holds `node`, or the run whose spacer `node` is.
     */
    reveal(node: Node): void {
        const run = this.runOf(node);
        if (!run) return;
        run.spacer.remove();
        this.runs.delete(run.spacer);
        for (const el of run.elements) {
            el.removeClass("is-far");
            this.runs.delete(el);
        }
        this.onShown(run.elements);
    }

    /** The spacers in `root`, top to bottom. */
    spacersIn(root: Element): HTMLElement[] {
        return Array.from(root.querySelectorAll<HTMLElement>(`.${SPACER}`));
    }

    revealAll(root: Element): void {
        for (const spacer of this.spacersIn(root)) this.reveal(spacer);
    }

    private runOf(node: Node): Run | undefined {
        for (let el = node.instanceOf(Element) ? node : node.parentElement; el; el = el.parentElement) {
            const run = this.runs.get(el);
            if (run) return run;
        }
        return undefined;
    }
}
