import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "obsidian";
import { FarRunWatch } from "../../src/stream/far-run-watch";
import { FarRuns, type Box } from "../../src/render/far-runs";

/**
 * jsdom has no layout, so an element's box is read from its data attributes.
 */
function boxFromData(el: Element): Box | null {
    const { top, bottom } = (el as HTMLElement).dataset;
    return top === undefined ? null : { top: Number(top), bottom: Number(bottom), marginTop: 0, marginBottom: 0 };
}

/** The hiding distance, in the viewport's coordinates. */
const MARGIN = { top: 0, bottom: 1000 };

function fakeObserver() {
    return { observe: vi.fn(), unobserve: vi.fn() };
}

/**
 * The elements `fn` was called with. Similar elements compare as equal, so
 * checks compare these by identity.
 */
function calledWith(fn: ReturnType<typeof vi.fn>): unknown[] {
    return fn.mock.calls.map(([el]: unknown[]) => el);
}

describe("FarRunWatch", () => {
    let block: HTMLElement;
    let farRuns: FarRuns;
    let runs: Element[][];
    let drawn: boolean;
    let watch: FarRunWatch;
    let render: ReturnType<typeof fakeObserver>;
    let hide: ReturnType<typeof fakeObserver>;

    /** A run of `count` paragraphs, laid out from `top` to `bottom`. */
    function run(top: number, bottom: number, count = 2): Element[] {
        const step = (bottom - top) / count;
        return Array.from({ length: count }, (_, i) =>
            block.createEl("p", { attr: { "data-top": top + i * step, "data-bottom": top + (i + 1) * step } })
        );
    }

    /** The observers report that `target` is laid out at `box`. */
    function report(target: Element, box: { top: number; bottom: number; width?: number; height?: number }): void {
        const { top, bottom, width = 600, height = bottom - top } = box;
        const entry = { target, boundingClientRect: { top, bottom, width, height }, rootBounds: MARGIN };
        watch.reported([entry as unknown as IntersectionObserverEntry]);
    }

    function observeWith(r: ReturnType<typeof fakeObserver> | null, h: ReturnType<typeof fakeObserver> | null): void {
        watch.observeWith(r as unknown as IntersectionObserver, h as unknown as IntersectionObserver);
    }

    function spacers(): HTMLElement[] {
        return farRuns.spacersIn(block);
    }

    beforeEach(() => {
        block = document.body.createDiv({ cls: "daily-note-block" });
        farRuns = new FarRuns(boxFromData);
        runs = [];
        drawn = true;
        watch = new FarRunWatch({ farRuns, runsOf: () => runs }, () => drawn);
        render = fakeObserver();
        hide = fakeObserver();
        observeWith(render, hide);
    });
    afterEach(() => block.remove());

    describe("watching a drawn note", () => {
        it("watches the first and last element of each run shown", () => {
            const shown = run(0, 300, 3);
            runs = [shown];

            watch.watch(block, new Component());

            expect(calledWith(hide.observe)).toEqual([shown[0], shown[2]]);
        });

        it("leaves a run already hidden unwatched", () => {
            const hidden = run(-3000, -2000);
            farRuns.hide(hidden);
            runs = [hidden, run(0, 300)];

            watch.watch(block, new Component());

            expect(calledWith(hide.observe)).not.toContain(hidden[0]);
        });

        it("drawn again, stops watching the runs it had", () => {
            const before = run(-3000, -2000);
            runs = [before];
            watch.watch(block, new Component());
            const after = run(0, 300);
            runs = [after];

            watch.watch(block, new Component());

            expect(calledWith(hide.unobserve)).toContain(before[0]);
            expect(calledWith(hide.unobserve)).toContain(before[1]);
            report(before[1]!, { top: -2500, bottom: -2000 });
            expect(spacers()).toEqual([]);
            const next = fakeObserver();
            observeWith(render, next);
            expect(calledWith(next.observe)).toEqual(after);
        });
    });

    describe("hiding a run reported far", () => {
        beforeEach(() => {
            runs = [run(-3000, -2000, 3)];
            watch.watch(block, new Component());
        });

        it.each([
            ["its last element ends at the margin above", 2, { top: -100, bottom: MARGIN.top }],
            ["its first element starts at the margin below", 0, { top: MARGIN.bottom, bottom: MARGIN.bottom + 100 }],
        ])("hides it once %s", (_, edge, box) => {
            report(runs[0]![edge]!, box);

            expect(spacers()).toHaveLength(1);
            expect(calledWith(render.observe)).toContain(spacers()[0]);
        });

        it.each([
            ["its last element reaches into the margin", 2, { top: -100, bottom: MARGIN.top + 1 }],
            ["its first element is above the margin, the rest unknown", 0, { top: -200, bottom: -100 }],
            ["its last element is below the margin, the rest unknown", 2, { top: 2000, bottom: 2100 }],
            ["its first element reaches into the margin", 0, { top: MARGIN.bottom - 1, bottom: MARGIN.bottom + 100 }],
        ])("keeps it while %s", (_, edge, box) => {
            report(runs[0]![edge]!, box);

            expect(spacers()).toEqual([]);
        });

        it("keeps a run laid out at nothing, folded or in a hidden note", () => {
            report(runs[0]![2]!, { top: 0, bottom: 0, width: 0, height: 0 });

            expect(spacers()).toEqual([]);
        });

        it.each([
            ["no width", { top: -100, bottom: -50, width: 0 }],
            ["no height", { top: -100, bottom: -100 }],
        ])("hides a far element of %s", (_, box) => {
            report(runs[0]![2]!, box);

            expect(spacers()).toHaveLength(1);
        });

        it("hides it once, however often it is reported", () => {
            report(runs[0]![2]!, { top: -100, bottom: -50 });
            report(runs[0]![2]!, { top: -100, bottom: -50 });

            expect(spacers()).toHaveLength(1);
            expect(calledWith(hide.unobserve)).toContain(runs[0]![0]);
            expect(calledWith(hide.unobserve)).toContain(runs[0]![2]);
        });

        it("keeps a run shown nowhere: nothing to stand a spacer for", () => {
            for (const el of runs[0]!) delete (el as HTMLElement).dataset.top;

            report(runs[0]![2]!, { top: -100, bottom: -50 });

            expect(spacers()).toEqual([]);
            expect(render.observe).not.toHaveBeenCalled();
        });
    });

    describe("hiding the runs drawn outside the bounds", () => {
        it("hides a run ending at the top or starting at the bottom, and keeps one between", () => {
            const above = run(-500, MARGIN.top);
            const within = run(MARGIN.top, MARGIN.bottom);
            const below = run(MARGIN.bottom, MARGIN.bottom + 500);

            watch.hideDrawnOutside(block, [above, within, below], MARGIN);

            expect(spacers().map((spacer) => spacer.nextElementSibling)).toEqual([above[0], below[0]]);
        });

        it("leaves a run already hidden alone", () => {
            const hidden = run(-3000, -2000);
            farRuns.hide(hidden);

            watch.hideDrawnOutside(block, [hidden], MARGIN);

            expect(spacers()).toHaveLength(1);
        });
    });

    describe("a hidden run's spacer", () => {
        let hidden: Element[];
        let spacer: HTMLElement;

        beforeEach(() => {
            hidden = run(-3000, -2000);
            watch.hideDrawnOutside(block, [hidden], MARGIN);
            spacer = spacers()[0]!;
        });

        it("entering the render margin, shows its run and is watched no more", () => {
            watch.show(spacer);

            expect(spacers()).toEqual([]);
            expect(calledWith(render.unobserve)).toContain(spacer);
            const next = fakeObserver();
            observeWith(next, hide);
            expect(calledWith(next.observe)).not.toContain(spacer);
        });

        it("shown, has its run watched again, in a drawn note", () => {
            watch.show(spacer);

            expect(calledWith(hide.observe)).toContain(hidden[0]);
        });

        it("shown in a note no longer drawn, leaves its run unwatched", () => {
            drawn = false;

            watch.show(spacer);

            expect(hide.observe).not.toHaveBeenCalled();
        });

        it("reported after its note was emptied, still shows its run", () => {
            watch.forget(block);
            drawn = false;

            watch.show(spacer);

            expect(spacers()).toEqual([]);
        });

        it("gone in a save, is watched no more; one kept stays watched", () => {
            const kept = run(-5000, -4000);
            watch.hideDrawnOutside(block, [kept], MARGIN);
            const keptSpacer = spacers().find((other) => other !== spacer)!;
            spacer.remove();

            watch.updated(block);

            expect(calledWith(render.unobserve)).toContain(spacer);
            expect(calledWith(render.unobserve)).not.toContain(keptSpacer);
            const next = fakeObserver();
            observeWith(next, hide);
            expect(calledWith(next.observe)).toHaveLength(1);
            expect(calledWith(next.observe)).toContain(keptSpacer);
        });

        it.each([
            ["the note is emptied mid-draw", (w: FarRunWatch) => w.forgetSpacers(block)],
            ["the note is emptied", (w: FarRunWatch) => w.forget(block)],
            ["every run is shown", (w: FarRunWatch) => w.showAll(block)],
        ])("is watched no more once %s", (_, end) => {
            end(watch);

            expect(calledWith(render.unobserve)).toContain(spacer);
            const next = fakeObserver();
            observeWith(next, hide);
            expect(next.observe).not.toHaveBeenCalled();
        });
    });

    it("works with no observers, as before the stream makes them", () => {
        observeWith(null, null);
        const far = run(-3000, -2000);
        const near = run(0, 300);
        const farther = run(-6000, -5000);
        runs = [far, near];

        expect(() => {
            watch.watch(block, new Component());
            report(far[1]!, { top: -2500, bottom: -2000 });
            watch.show(spacers()[0]!);
            watch.hideDrawnOutside(block, [far], MARGIN);
            spacers()[0]!.remove();
            watch.updated(block);
            watch.hideDrawnOutside(block, [farther], MARGIN);
            watch.watch(block, new Component());
            watch.forget(block);
        }).not.toThrow();
    });
});
