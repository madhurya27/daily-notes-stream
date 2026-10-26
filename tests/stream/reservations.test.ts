import { describe, it, expect, beforeEach } from "vitest";
import { TFile } from "../mocks/obsidian";
import { NoteHeights } from "../../src/stream/note-heights";
import { Reservations, type Reserving } from "../../src/stream/reservations";

const LAYOUT = "600:16px";
const TURNED = "900:16px";

/** A note with the height `height`, as the window manager tracks it. */
function reserving(path: string, height = 500, measured = false): Reserving {
    return { file: new TFile(path), height, measured };
}

/** An empty block `reserved`px tall, drawn from `top` in the window. */
function placeholder(reserved: number, top: number): HTMLElement {
    const block = document.createElement("div");
    block.style.setProperty("--daily-note-placeholder-height", `${reserved}px`);
    block.getBoundingClientRect = () => ({ top, bottom: top + reserved, height: reserved }) as DOMRect;
    return block;
}

describe("Reservations", () => {
    let heights: NoteHeights;
    let estimated: number | undefined;
    let reservations: Reservations;

    beforeEach(() => {
        heights = new NoteHeights();
        estimated = 900;
        reservations = new Reservations(heights, () => estimated);
    });

    describe("what a note is expected at", () => {
        it("is what it measured at the layout", () => {
            heights.keep(LAYOUT, "Notes/a.md", 320);
            const note = reserving("Notes/a.md");

            reservations.expect(note, LAYOUT);

            expect(note).toMatchObject({ height: 320, measured: true });
        });

        it("is the estimate where it measured nothing", () => {
            heights.keep(TURNED, "Notes/a.md", 320);
            const note = reserving("Notes/a.md", 500, true);

            reservations.expect(note, LAYOUT);

            expect(note).toMatchObject({ height: 900, measured: false });
        });

        it("is what it reserves when there is no estimate either", () => {
            estimated = undefined;
            const note = reserving("Notes/a.md", 500);

            reservations.expect(note, LAYOUT);

            expect(note).toMatchObject({ height: 500, measured: false });
        });
    });

    describe("whether a re-reserve is owed", () => {
        it("is not, once a note is added with nothing owed", () => {
            reservations.add(reserving("Notes/a.md"), LAYOUT);

            expect(reservations.owed).toBe(false);
        });

        it("is, once a height is kept", () => {
            reservations.add(reserving("Notes/a.md"), LAYOUT);

            heights.keep(LAYOUT, "Notes/b.md", 320);

            expect(reservations.owed).toBe(true);
        });

        // A new note gets a height from what is known now. That does not do the
        // update the other notes still need.
        it("stays owed across a note added", () => {
            reservations.add(reserving("Notes/a.md"), LAYOUT);
            heights.keep(LAYOUT, "Notes/b.md", 320);

            reservations.add(reserving("Notes/c.md"), LAYOUT);

            expect(reservations.owed).toBe(true);
        });

        it("is, at a new layout, and the same layout again changes nothing", () => {
            reservations.add(reserving("Notes/a.md"), LAYOUT);

            expect(reservations.expectLayout(LAYOUT)).toBe(false);
            expect(reservations.owed).toBe(false);
            expect(reservations.expectLayout(TURNED)).toBe(true);
            expect(reservations.owed).toBe(true);
        });
    });

    describe("a re-reserve at rest", () => {
        const PANE_TOP = 0;
        const ROOM_BELOW = 10_000;

        beforeEach(() => reservations.add(reserving("Notes/seed.md"), LAYOUT));

        it("changes only the notes reserving other than they are expected at", () => {
            const same = reserving("Notes/a.md", 900);
            const grown = reserving("Notes/b.md", 900);
            const sameBlock = placeholder(900, 100);
            const grownBlock = placeholder(500, 1000);

            const plan = reservations.plan(
                [
                    [sameBlock, same],
                    [grownBlock, grown],
                ],
                LAYOUT,
                PANE_TOP,
                ROOM_BELOW
            );

            expect(plan?.changed).toEqual([[grownBlock, grown]]);
        });

        it("re-expects a note never measured, and leaves a measured one as it is", () => {
            estimated = 1100;
            const guessed = reserving("Notes/a.md", 900);
            const measured = reserving("Notes/b.md", 400, true);

            reservations.plan(
                [
                    [placeholder(900, 100), guessed],
                    [placeholder(400, 1000), measured],
                ],
                LAYOUT,
                PANE_TOP,
                ROOM_BELOW
            );

            expect(guessed.height).toBe(1100);
            expect(measured.height).toBe(400);
        });

        it("sums how far the notes wholly above the pane move", () => {
            const above = placeholder(500, -600);
            const crossing = placeholder(500, -100);

            const plan = reservations.plan(
                [
                    [above, reserving("Notes/a.md")],
                    [crossing, reserving("Notes/b.md")],
                ],
                LAYOUT,
                PANE_TOP,
                ROOM_BELOW
            );

            expect(plan?.movedAbove).toBe(400);
        });

        it("counts a block ending at the pane's top as above it", () => {
            const plan = reservations.plan(
                [[placeholder(500, PANE_TOP - 500), reserving("Notes/a.md")]],
                LAYOUT,
                PANE_TOP,
                ROOM_BELOW
            );

            expect(plan?.movedAbove).toBe(400);
        });

        // In a hidden tab, nothing is laid out, and nothing is above the pane.
        it("counts a block not laid out as below the pane", () => {
            const hidden = placeholder(500, -600);
            hidden.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 0 }) as DOMRect;

            const plan = reservations.plan([[hidden, reserving("Notes/a.md")]], LAYOUT, PANE_TOP, ROOM_BELOW);

            expect(plan?.movedAbove).toBe(0);
        });

        it("is settled, owing nothing", () => {
            heights.keep(LAYOUT, "Notes/b.md", 320);

            reservations.plan([], LAYOUT, PANE_TOP, ROOM_BELOW);

            expect(reservations.owed).toBe(false);
        });

        // The browser would pull the scroll back.
        it("is put off while the notes below would shrink the stream by more than lies below the pane", () => {
            estimated = 300;
            heights.keep(LAYOUT, "Notes/b.md", 320);

            const plan = reservations.plan([[placeholder(900, 1000), reserving("Notes/a.md")]], LAYOUT, PANE_TOP, 599);

            expect(plan).toBeNull();
            expect(reservations.owed).toBe(true);
        });

        it("goes ahead when the notes below shrink the stream by just what lies below the pane", () => {
            estimated = 300;
            heights.keep(LAYOUT, "Notes/b.md", 320);

            const plan = reservations.plan([[placeholder(900, 1000), reserving("Notes/a.md")]], LAYOUT, PANE_TOP, 600);

            expect(plan).not.toBeNull();
        });
    });
});
