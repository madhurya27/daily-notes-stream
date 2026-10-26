import { describe, it, expect, beforeEach } from "vitest";
import { FarRuns, type Box } from "../../src/render/far-runs";

/**
 * jsdom has no layout, so each element's box is read from its data attributes.
 */
function box(el: Element): Box | null {
    const { top, bottom, mt, mb } = (el as HTMLElement).dataset;
    if (top === undefined) return null;
    return { top: Number(top), bottom: Number(bottom), marginTop: Number(mt ?? 0), marginBottom: Number(mb ?? 0) };
}

function content(html: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.append(el);
    return el;
}

const children = (el: HTMLElement) => Array.from(el.children);
const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);

describe("FarRuns", () => {
    let runs: FarRuns;

    beforeEach(() => {
        document.body.empty();
        runs = new FarRuns(box);
    });

    it("hides a run behind one spacer standing where it stood", () => {
        const note = content(`
            <h2 data-top="0" data-bottom="30" data-mt="20" data-mb="10">A</h2>
            <p data-top="40" data-bottom="100" data-mt="16" data-mb="16">one</p>
            <p data-top="116" data-bottom="200" data-mt="16" data-mb="16">two</p>
            <p data-top="216" data-bottom="300">three</p>`);
        const [, one, two, three] = children(note);

        const spacer = runs.hide([one!, two!])!;

        expect(children(note)).toEqual([note.children[0], spacer, one, two, three]);
        expect(spacer.hasClass("daily-note-far-run")).toBe(true);
        expect(one!.hasClass("is-far") && two!.hasClass("is-far")).toBe(true);
        expect(three!.hasClass("is-far")).toBe(false);
        // From the first one's border box to the last one's, with their outer
        // margins, so they combine with neighbours' margins as before.
        expect(prop(spacer, "--daily-note-far-height")).toBe("160px");
        expect(prop(spacer, "--daily-note-far-margin-top")).toBe("16px");
        expect(prop(spacer, "--daily-note-far-margin-bottom")).toBe("16px");
    });

    it("measures from the first and last of a run shown, past those a collapse hid", () => {
        const note = content(`
            <p class="is-hidden">gone</p>
            <p data-top="10" data-bottom="50" data-mt="4" data-mb="6">one</p>
            <p data-top="60" data-bottom="90" data-mt="8" data-mb="12">two</p>
            <p class="is-hidden">gone</p>`);

        const spacer = runs.hide(children(note))!;

        expect(prop(spacer, "--daily-note-far-height")).toBe("80px");
        expect(prop(spacer, "--daily-note-far-margin-top")).toBe("4px");
        expect(prop(spacer, "--daily-note-far-margin-bottom")).toBe("12px");
    });

    it("leaves a run with nothing shown as it is: it takes no room already", () => {
        const note = content(`<p class="is-hidden">gone</p><p class="is-hidden">gone</p>`);

        expect(runs.hide(children(note))).toBeNull();
        expect(note.querySelector(".daily-note-far-run, .is-far")).toBeNull();
    });

    it("measures a run from its first shown element's top to its last one's bottom", () => {
        const note = content(`
            <p class="is-hidden">gone</p>
            <p data-top="10" data-bottom="50">one</p>
            <p data-top="60" data-bottom="90">two</p>`);

        expect(runs.measure(children(note))).toMatchObject({ top: 10, bottom: 90 });
        expect(runs.measure([children(note)[0]!])).toBeNull();
    });

    it("reads boxes from the layout by default, and none from an element not laid out", () => {
        const note = content(`<p style="margin: 3px 0 5px">shown</p><p>not laid out</p>`);
        const [shown, unlaid] = children(note);
        shown!.getClientRects = () => [{}] as unknown as DOMRectList;
        shown!.getBoundingClientRect = () => ({ top: 10, bottom: 40 }) as DOMRect;
        const layout = new FarRuns();

        expect(layout.measure([unlaid!])).toBeNull();
        const spacer = layout.hide([shown!, unlaid!])!;

        expect(prop(spacer, "--daily-note-far-height")).toBe("30px");
        expect(prop(spacer, "--daily-note-far-margin-top")).toBe("3px");
        expect(prop(spacer, "--daily-note-far-margin-bottom")).toBe("5px");
    });

    it("tells which nodes a hidden run holds", () => {
        const note = content(
            `<p data-top="0" data-bottom="10">one <em>two</em></p><p data-top="10" data-bottom="20">three</p>`
        );
        const [one, three] = children(note);
        runs.hide([one!]);

        expect(runs.hides(one!.querySelector("em")!.firstChild!)).toBe(true);
        expect(runs.hides(one!)).toBe(true);
        expect(runs.hides(three!.firstChild!)).toBe(false);
        expect(runs.hides(note)).toBe(false);
    });

    it("reveals the whole run holding a node, its spacer gone", () => {
        const note = content(
            `<p data-top="0" data-bottom="10">one <em>x</em></p><p data-top="10" data-bottom="20">two</p>`
        );
        const [one, two] = children(note);
        runs.hide([one!, two!]);

        runs.reveal(one!.querySelector("em")!.firstChild!);

        expect(children(note)).toEqual([one, two]);
        expect(one!.hasClass("is-far") || two!.hasClass("is-far")).toBe(false);
        expect(runs.hides(two!)).toBe(false);
    });

    it("reveals the run a spacer stands for", () => {
        const note = content(`<p data-top="0" data-bottom="10">one</p>`);
        const spacer = runs.hide(children(note))!;

        runs.reveal(spacer);

        expect(note.querySelector(".daily-note-far-run, .is-far")).toBeNull();
    });

    // Shown again by a scroll, a fold, a search step or a save, it is watched
    // again (ADR 0023).
    it("tells who listens which run it showed, once per run", () => {
        const note = content(`<p data-top="0" data-bottom="10">one</p><p data-top="10" data-bottom="20">two</p>`);
        const [one, two] = children(note);
        const shown: Element[][] = [];
        runs.onShown = (run) => shown.push(run);
        const spacer = runs.hide([one!, two!])!;

        runs.reveal(two!);
        runs.reveal(spacer);

        expect(shown).toEqual([[one, two]]);
    });

    it("reveals nothing for a node no run holds", () => {
        const note = content(`<p data-top="0" data-bottom="10">one</p><p data-top="10" data-bottom="20">two</p>`);
        const [one, two] = children(note);
        runs.hide([one!]);

        runs.reveal(two!);

        expect(one!.hasClass("is-far")).toBe(true);
    });

    it("lists the spacers in a note, top to bottom, and reveals every run in it", () => {
        const note = content(
            `<p data-top="0" data-bottom="10">1</p><p data-top="10" data-bottom="20">2</p><p data-top="20" data-bottom="30">3</p>`
        );
        const [a, b, c] = children(note);
        const first = runs.hide([a!])!;
        const last = runs.hide([c!])!;

        expect(runs.spacersIn(note)).toEqual([first, last]);

        runs.revealAll(note);

        expect(children(note)).toEqual([a, b, c]);
        expect(runs.spacersIn(note)).toEqual([]);
    });
});
