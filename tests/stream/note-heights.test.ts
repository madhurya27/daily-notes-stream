import { describe, expect, it, vi } from "vitest";
import { NoteHeights } from "../../src/stream/note-heights";

describe("NoteHeights", () => {
    it("keeps a note's last height, per layout", () => {
        const heights = new NoteHeights();
        heights.keep("600:16px", "a.md", 300);
        heights.keep("600:16px", "a.md", 320);

        expect(heights.heightOf("600:16px", "a.md")).toBe(320);
        expect(heights.heightOf("400:16px", "a.md")).toBeUndefined();
        expect(heights.heightOf("600:16px", "b.md")).toBeUndefined();
    });

    // Rounded to whole pixels, an empty block's height is up to half a pixel
    // off, and the scroll then stops one pixel before the top (D-105). Layout
    // works in 1/64ths of a pixel, so keeping that keeps everything, and a
    // smaller wobble changes nothing.
    it("keeps a height to the 1/64 pixel the browser lays out in", () => {
        const changed = vi.fn();
        const heights = new NoteHeights(changed);
        heights.keep("600:16px", "a.md", 933.84375);
        heights.keep("600:16px", "a.md", 933.84376);

        expect(heights.heightOf("600:16px", "a.md")).toBe(933.84375);
        expect(changed).toHaveBeenCalledOnce();
    });

    // Leaning tall: scrolling up past notes taller than their estimate runs out
    // of scroll before the top (D-092).
    it("estimates a layout's unmeasured note at the 0.9 quantile of its measured ones", () => {
        const heights = new NoteHeights();
        expect(heights.estimate("600:16px", "new.md")).toBeUndefined();

        for (let i = 1; i <= 11; i++) heights.keep("600:16px", `n${i}.md`, i * 100);
        expect(heights.estimate("600:16px", "new.md")).toBe(1000);

        // Every empty block in a batch asks, so the heights are sorted only
        // once per change.
        const sort = vi.spyOn(Array.prototype, "sort");
        expect(heights.estimate("600:16px", "new.md")).toBe(1000);
        expect(sort).not.toHaveBeenCalled();
        sort.mockRestore();

        heights.keep("600:16px", "n12.md", 5000);
        expect(heights.estimate("600:16px", "new.md")).toBe(1100);
    });

    // With few notes measured, the height that 90% are below is the tallest
    // one. One 10,000-line note would give every empty block its 235,612px.
    it("estimates at the 0.9 quantile of a layout with many measured notes", () => {
        const heights = new NoteHeights();
        for (let i = 1; i <= 30; i++) heights.keep("600:16px", `n${i}.md`, i * 100);

        expect(heights.estimate("600:16px", "new.md")).toBe(2800);
    });

    it("never estimates at the one tallest note alone", () => {
        const heights = new NoteHeights();
        heights.keep("600:16px", "long.md", 235_612);
        expect(heights.estimate("600:16px", "new.md")).toBe(235_612);

        for (const [i, height] of [700, 600, 900].entries()) heights.keep("600:16px", `n${i}.md`, height);
        expect(heights.estimate("600:16px", "new.md")).toBe(900);

        for (let i = 3; i < 9; i++) heights.keep("600:16px", `n${i}.md`, 800);
        expect(heights.estimate("600:16px", "new.md")).toBe(900);
    });

    // One long note among few measured made its height the estimate for every
    // empty block: 235,612px each, and scrolling flew through empty space
    // (D-135).
    describe("with each note's size", () => {
        const sizes = new Map([
            ["long.md", 500_000],
            ["longer.md", 400_000],
            ["short.md", 1_000],
            ["tiny.md", 7],
            ["base.md", 100],
            ["empty.md", 0],
        ]);
        const statOf = (path: string) => {
            const size = sizes.get(path);
            return size === undefined ? undefined : { mtime: 1, size };
        };

        it("caps a note's estimate at its size, at the densest rate measured", () => {
            const heights = new NoteHeights(undefined, statOf);
            heights.keep("a", "long.md", 235_612);

            expect(heights.estimate("a", "short.md")).toBeCloseTo(471.224);
            expect(heights.estimate("a", "unsized.md")).toBe(235_612);
        });

        // A note's title and frame take space but no bytes, so by size alone, a
        // short note comes out shorter than it is drawn.
        it("never caps below the floor given", () => {
            const heights = new NoteHeights(undefined, statOf);
            heights.keep("a", "long.md", 235_612);
            expect(heights.estimate("a", "tiny.md", 1_700)).toBe(1_700);

            for (let i = 0; i < 10; i++) heights.keep("a", `n${i}.md`, 900);
            expect(heights.estimate("a", "tiny.md", 1_700)).toBe(900);
        });

        // A Base is drawn tall from a few bytes, so the limit leans tall, as
        // D-092 wants.
        it("rates by the densest note, so a note never comes out shorter than any measured would at its size", () => {
            const heights = new NoteHeights(undefined, statOf);
            heights.keep("a", "long.md", 235_612);
            heights.keep("a", "longer.md", 200_000);
            heights.keep("a", "base.md", 600);
            // No bytes to divide by, so it is left out instead of giving an
            // infinite rate.
            heights.keep("a", "empty.md", 150);

            expect(heights.estimate("a", "short.md")).toBe(6_000);
        });
    });

    // Just after a turn, the notes on screen are measured at the new width
    // within moments, so the old width gives no estimate.
    it("caps no estimate where no note measured had bytes to rate", () => {
        const heights = new NoteHeights(undefined, (path) => ({ mtime: 1, size: path === "new.md" ? 10 : 0 }));
        heights.keep("600:16px", "blank.md", 300);

        expect(heights.estimate("600:16px", "new.md")).toBe(300);
    });

    it("learns its estimates again from what it comes back from", () => {
        const heights = new NoteHeights();
        heights.keep("a", "x.md", 100);
        expect(heights.estimate("a", "new.md")).toBe(100);
        const saved = new NoteHeights();
        saved.keep("a", "x.md", 700);

        heights.restore(JSON.parse(JSON.stringify(saved.toJSON())));

        expect(heights.estimate("a", "new.md")).toBe(700);
    });

    it("estimates nothing at a width that measured nothing, whatever others did", () => {
        const heights = new NoteHeights();
        heights.keep("400:16px", "a.md", 900);

        expect(heights.estimate("380:16px", "new.md")).toBeUndefined();
    });

    it("forgets a deleted note, and notes no longer in the vault", () => {
        const heights = new NoteHeights();
        heights.keep("a", "x.md", 1);
        heights.keep("a", "y.md", 2);
        heights.keep("b", "z.md", 3);
        heights.forget("x.md");
        expect(heights.heightOf("a", "x.md")).toBeUndefined();

        heights.retainOnly(new Set(["z.md"]));
        expect(heights.heightOf("a", "y.md")).toBeUndefined();
        expect(heights.heightOf("b", "z.md")).toBe(3);
        expect(heights.estimate("a", "new.md")).toBeUndefined();
    });

    it("says when it changed, and only then", () => {
        const changed = vi.fn();
        const heights = new NoteHeights(changed);
        heights.keep("a", "x.md", 1);
        heights.keep("a", "x.md", 1);
        heights.heightOf("a", "x.md");
        heights.rename("absent.md", "y.md");
        heights.forget("absent.md");
        heights.retainOnly(new Set(["x.md"]));
        expect(changed).toHaveBeenCalledTimes(1);

        heights.rename("x.md", "y.md");
        heights.forget("y.md");
        heights.keep("a", "z.md", 1);
        heights.retainOnly(new Set());
        expect(changed).toHaveBeenCalledTimes(5);
    });

    // An estimate reads other layouts. That does not count as using them, and
    // they are still forgotten first.
    it("lists what it holds, by note and by layout, without counting as a use", () => {
        const heights = new NoteHeights(undefined, undefined, 2);
        heights.keep("a", "x.md", 1);
        heights.keep("a", "y.md", 2);
        heights.keep("b", "x.md", 3);

        expect(heights.heightsOf("x.md")).toEqual([
            ["a", 1],
            ["b", 3],
        ]);
        expect(heights.layouts()).toEqual(["a", "b"]);
        expect(heights.entries("a")).toEqual([
            ["x.md", 1],
            ["y.md", 2],
        ]);
        expect(heights.entries("c")).toEqual([]);

        heights.keep("c", "z.md", 4);
        expect(heights.layouts()).toEqual(["b", "c"]);
    });

    // What is worked out from all the heights is only computed again once one
    // changed.
    it("counts its changes", () => {
        const heights = new NoteHeights();
        const start = heights.revision;
        heights.keep("a", "x.md", 1);
        heights.keep("a", "x.md", 1);
        expect(heights.revision).toBe(start + 1);

        heights.restore([]);
        expect(heights.revision).toBe(start + 2);
    });

    it("comes back from what it saved, oldest layout still first to go", () => {
        const saved = new NoteHeights(undefined, undefined, 2);
        saved.keep("a", "x.md", 1);
        saved.keep("b", "y.md", 2);
        saved.heightOf("a", "x.md");

        const restored = new NoteHeights(undefined, undefined, 2);
        restored.restore(JSON.parse(JSON.stringify(saved.toJSON())));
        restored.keep("c", "z.md", 3);

        expect(restored.heightOf("a", "x.md")).toBe(1);
        expect(restored.heightOf("b", "y.md")).toBeUndefined();
        expect(restored.estimate("a", "new.md")).toBe(1);
    });

    // Edited on another device, or while the plugin was off, so it is estimated
    // again from its text, not kept at its old height.
    describe("with each note's mtime", () => {
        const statOf = (mtimes: Map<string, number>) => (path: string) => {
            const mtime = mtimes.get(path);
            return mtime === undefined ? undefined : { mtime, size: 1 };
        };

        function setup() {
            const mtimes = new Map([
                ["x.md", 1],
                ["y.md", 1],
                ["gone.md", 1],
            ]);
            const heights = new NoteHeights(undefined, statOf(mtimes));
            heights.keep("a", "x.md", 100);
            heights.keep("b", "x.md", 200);
            heights.keep("a", "y.md", 300);
            heights.keep("a", "gone.md", 400);
            return { mtimes, heights };
        }

        it("forgets a note changed since it was measured, as it forgets one deleted", () => {
            const { mtimes, heights } = setup();
            mtimes.set("x.md", 2);
            mtimes.delete("gone.md");

            heights.retainOnly(new Set(["x.md", "y.md"]));

            expect(heights.heightsOf("x.md")).toEqual([]);
            expect(heights.heightOf("a", "y.md")).toBe(300);
            expect(heights.heightOf("a", "gone.md")).toBeUndefined();
        });

        it("keeps when each note was measured through a save", () => {
            const { mtimes, heights } = setup();
            const restored = new NoteHeights(undefined, statOf(mtimes));
            restored.restore(JSON.parse(JSON.stringify(heights.toJSON())));
            mtimes.set("x.md", 2);

            restored.retainOnly(new Set(["x.md", "y.md", "gone.md"]));

            expect(restored.heightsOf("x.md")).toEqual([]);
            expect(restored.heightOf("a", "y.md")).toBe(300);
        });

        it("carries a note's mtime across a rename, and forgets a deleted note's", () => {
            const { mtimes, heights } = setup();
            heights.rename("x.md", "moved.md");
            mtimes.set("moved.md", 1);
            heights.forget("y.md");
            heights.keep("a", "y.md", 300);

            heights.retainOnly(new Set(["moved.md", "y.md"]));

            expect(heights.heightOf("a", "moved.md")).toBe(100);
            expect(heights.heightOf("a", "y.md")).toBe(300);
        });

        it("saves the mtime of only the notes it holds, under their paths now", () => {
            const { mtimes, heights } = setup();
            heights.rename("x.md", "moved.md");
            heights.rename("never.md", "elsewhere.md");
            heights.forget("y.md");
            mtimes.set("moved.md", 1);
            expect(heights.toJSON().mtimes).toEqual([
                ["gone.md", 1],
                ["moved.md", 1],
            ]);

            heights.retainOnly(new Set(["moved.md"]));

            expect(heights.toJSON().mtimes).toEqual([["moved.md", 1]]);
        });

        it("comes back empty from a save whose mtimes are of another shape", () => {
            const { heights } = setup();
            const { heights: table } = heights.toJSON();
            for (const mtimes of [[["x.md", "1"]], [[1, 1]], ["x.md"]]) {
                const restored = new NoteHeights();
                restored.restore({ heights: table, mtimes });
                expect(restored.heightOf("a", "x.md")).toBeUndefined();
            }
        });

        it("comes back without a height that is no number", () => {
            const restored = new NoteHeights();

            restored.restore({ heights: [["a", [["x.md", "tall"]]]], mtimes: [] });

            expect(restored.heightOf("a", "x.md")).toBeUndefined();
        });

        it("comes back empty from a save of another shape", () => {
            const { heights } = setup();
            for (const saved of [{ heights: [["a", [["x.md", 100]]]] }, { mtimes: [["x.md", "1"]] }, null]) {
                heights.restore(saved);
                expect(heights.heightOf("a", "x.md")).toBeUndefined();
            }
        });
    });
});
