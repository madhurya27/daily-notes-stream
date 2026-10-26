import type { Component } from "obsidian";
import type { Box, FarRuns } from "../render/far-runs";
import type { NoteRenderer } from "../render/note-renderer";

/**
 * What is watched of a drawn note's runs (groups of elements that are hidden
 * together).
 */
interface Watched {
    /**
     * The spacers of its runs hidden because they are far away, each watched at
     * the drawing distance (ADR 0021).
     */
    spacers: Set<HTMLElement>;
    /**
     * The first and last element of each shown run, watched at the hiding
     * distance (ADR 0023).
     */
    edges: Set<Element>;
}

function blockOf(el: Element): HTMLElement | null {
    return el.closest<HTMLElement>(".daily-note-block");
}

/** Where the hiding distance is, in the viewport's coordinates. */
export interface Bounds {
    top: number;
    bottom: number;
}

/**
 * Hides a long note's runs when they are further away than the hiding distance,
 * and shows them when they come within the drawing distance, even while
 * scrolling (ADR 0023). A run is a group of a note's elements, hidden or shown
 * together. The stream's observers watch the runs as well as its blocks:
 * anything they report that is not a block belongs to a run.
 */
export class FarRunWatch {
    private readonly notes = new Map<HTMLElement, Watched>();
    /**
     * Maps each watched first or last element of a shown run to its run and
     * note.
     */
    private readonly edges = new Map<Element, { block: HTMLElement; run: Element[] }>();
    private renderObserver: IntersectionObserver | null = null;
    private hideObserver: IntersectionObserver | null = null;

    constructor(
        private readonly renderer: Pick<NoteRenderer, "farRuns" | "runsOf">,
        /**
         * Whether `block` holds a drawn note. A run shown in one is watched
         * again.
         */
        private readonly isDrawn: (block: HTMLElement) => boolean
    ) {
        this.farRuns.onShown = (run) => this.runShown(run);
    }

    private get farRuns(): FarRuns {
        return this.renderer.farRuns;
    }

    /**
     * The stream's new observers. From now on, they watch every spacer and
     * edge.
     */
    observeWith(render: IntersectionObserver | null, hide: IntersectionObserver | null): void {
        this.renderObserver = render;
        this.hideObserver = hide;
        for (const { spacers, edges } of this.notes.values()) {
            for (const spacer of spacers) render?.observe(spacer);
            for (const edge of edges) hide?.observe(edge);
        }
    }

    /**
     * Watches the first and last element of each shown run of a drawn note. The
     * observer's first report hides the runs that are far away. The note's
     * height is fixed before this, so the anchor has already put the reader
     * back, and "far away" is measured from there.
     */
    watch(block: HTMLElement, component: Component): void {
        this.unwatchEdges(block);
        for (const run of this.renderer.runsOf(component)) if (!this.farRuns.hides(run[0]!)) this.watchRun(block, run);
    }

    /**
     * Hides the runs whose edges were reported past the hiding distance, a
     * whole run at a time.
     */
    reported(entries: IntersectionObserverEntry[]): void {
        const far = new Set<{ block: HTMLElement; run: Element[] }>();
        for (const entry of entries) {
            const edge = this.edges.get(entry.target);
            if (edge && this.pastMargin(entry, edge.run)) far.add(edge);
        }
        // Measure every run before hiding any: hiding one between two
        // measurements lays the note out again.
        this.hide([...far].map((edge) => ({ ...edge, box: this.farRuns.measure(edge.run) })));
    }

    /**
     * A note drawn from its end hides, between slices, the runs it drew outside
     * `bounds`.
     */
    hideDrawnOutside(block: HTMLElement, runs: Element[][], bounds: Bounds): void {
        // Measure every run before hiding any: hiding one between two
        // measurements lays the note out again.
        const far = runs.flatMap((run) => {
            if (this.farRuns.hides(run[0]!)) return [];
            const box = this.farRuns.measure(run);
            return box && (box.bottom <= bounds.top || box.top >= bounds.bottom) ? [{ block, run, box }] : [];
        });
        this.hide(far);
    }

    /** A hidden run's spacer came within the drawing distance. */
    show(spacer: HTMLElement): void {
        const block = blockOf(spacer);
        this.farRuns.reveal(spacer);
        this.renderObserver?.unobserve(spacer);
        // Stryker disable next-line ConditionalExpression: a spacer that is in no block is in no note's set either.
        if (block) this.notes.get(block)?.spacers.delete(spacer);
    }

    /**
     * Shows every run of `block`, because its spacers were measured at another
     * width.
     */
    showAll(block: HTMLElement): void {
        this.farRuns.revealAll(block);
        this.forgetSpacers(block);
    }

    /**
     * A save drew `block` again in place. The runs it changed are shown, and
     * their spacers removed.
     */
    updated(block: HTMLElement): void {
        const watched = this.notes.get(block);
        if (!watched) return;
        for (const spacer of watched.spacers) {
            if (spacer.isConnected) continue;
            this.renderObserver?.unobserve(spacer);
            watched.spacers.delete(spacer);
        }
    }

    /** `block` was emptied, so nothing in it is watched. */
    forget(block: HTMLElement): void {
        this.forgetSpacers(block);
        this.unwatchEdges(block);
        // Stryker disable next-line all: only frees memory; the entry's sets are emptied above.
        this.notes.delete(block);
    }

    /**
     * `block` was emptied while drawing, together with any runs it hid between
     * slices.
     */
    forgetSpacers(block: HTMLElement): void {
        const watched = this.notes.get(block);
        if (!watched) return;
        for (const spacer of watched.spacers) this.renderObserver?.unobserve(spacer);
        watched.spacers.clear();
    }

    /**
     * If the run's last element is past the hiding distance above, or its first
     * element past it below, the whole run is. A run with no height, because it
     * is folded or in a hidden note, is nowhere: Chromium reports an empty box
     * in empty root bounds.
     */
    private pastMargin(entry: IntersectionObserverEntry, run: Element[]): boolean {
        const { boundingClientRect: box, target } = entry;
        if (box.width === 0 && box.height === 0) return false;
        // The root is the pane, in this document, so its bounds are always
        // given.
        const margin = entry.rootBounds!;
        return (target === run.at(-1) && box.bottom <= margin.top) || (target === run[0] && box.top >= margin.bottom);
    }

    /**
     * Hides each far run, measured at `box`, behind a spacer that is watched so
     * it can be shown again (ADR 0023).
     */
    private hide(far: { block: HTMLElement; run: Element[]; box: Box | null }[]): void {
        for (const { block, run, box } of far) {
            this.unwatchRun(block, run);
            const spacer = this.farRuns.hide(run, box);
            if (!spacer) continue;
            this.watched(block).spacers.add(spacer);
            this.renderObserver?.observe(spacer);
        }
    }

    /**
     * A run shown again, by a scroll, a fold, a search step or a save, is
     * watched again.
     */
    private runShown(run: Element[]): void {
        const block = blockOf(run[0]!);
        if (block && this.isDrawn(block)) this.watchRun(block, run);
    }

    private watchRun(block: HTMLElement, run: Element[]): void {
        for (const edge of new Set([run[0]!, run.at(-1)!])) {
            this.edges.set(edge, { block, run });
            this.watched(block).edges.add(edge);
            this.hideObserver?.observe(edge);
        }
    }

    private unwatchRun(block: HTMLElement, run: Element[]): void {
        for (const edge of new Set([run[0]!, run.at(-1)!])) {
            this.edges.delete(edge);
            this.notes.get(block)?.edges.delete(edge);
            this.hideObserver?.unobserve(edge);
        }
    }

    private unwatchEdges(block: HTMLElement): void {
        const watched = this.notes.get(block);
        if (!watched) return;
        for (const edge of watched.edges) {
            this.edges.delete(edge);
            this.hideObserver?.unobserve(edge);
        }
        watched.edges.clear();
    }

    private watched(block: HTMLElement): Watched {
        let watched = this.notes.get(block);
        if (!watched) this.notes.set(block, (watched = { spacers: new Set(), edges: new Set() }));
        return watched;
    }
}
