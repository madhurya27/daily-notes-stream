import { describe, expect, it } from "vitest";
import { goesBefore, isOnScreen, nextToDraw } from "../../src/stream/draw-order";

const PANE = { top: 0, bottom: 800 };

function noteAt(top: number, height = 100): HTMLElement {
    const block = document.createElement("div");
    block.getBoundingClientRect = () => ({ top, bottom: top + height }) as DOMRect;
    return block;
}

describe("nextToDraw", () => {
    it("does not count a note ending at the pane's top as on screen", () => {
        const onScreen = noteAt(500);

        expect(nextToDraw([noteAt(-100), onScreen], PANE, 0)).toBe(onScreen);
    });

    // Scrolling up, it is behind. On screen, or above the pane, it would be
    // drawn first.
    it("counts a note starting at the pane's bottom as below it", () => {
        const ahead = noteAt(-500);

        expect(nextToDraw([noteAt(800), ahead], PANE, -1)).toBe(ahead);
    });

    it("takes the first of notes that stand equal", () => {
        const first = noteAt(1000);

        expect(nextToDraw([first, noteAt(1000)], PANE, 0)).toBe(first);
    });
});

describe("goesBefore", () => {
    it("puts a note on screen before one off screen", () => {
        expect(goesBefore(noteAt(700), noteAt(900), PANE, 0)).toBe(true);
    });

    it("puts a note on screen higher up first", () => {
        expect(goesBefore(noteAt(-50), noteAt(100), PANE, 0)).toBe(true);
        expect(goesBefore(noteAt(100), noteAt(-50), PANE, 0)).toBe(false);
    });

    it("puts what the scroll is heading for before what it has passed", () => {
        expect(goesBefore(noteAt(2000), noteAt(-150), PANE, 1)).toBe(true);
        expect(goesBefore(noteAt(-150), noteAt(2000), PANE, 1)).toBe(false);
    });

    it("puts the nearer of two notes on the same side first", () => {
        expect(goesBefore(noteAt(900), noteAt(1200), PANE, 1)).toBe(true);
        expect(goesBefore(noteAt(1200), noteAt(900), PANE, 1)).toBe(false);
    });

    // A note never goes before itself, nor before one where it stands.
    it("does not put a note before one standing equal", () => {
        expect(goesBefore(noteAt(1000), noteAt(1000), PANE, 0)).toBe(false);
    });
});

describe("isOnScreen", () => {
    it("counts a note inside the pane", () => {
        expect(isOnScreen(noteAt(700), PANE)).toBe(true);
    });

    it("does not count notes that only touch the pane's edges", () => {
        expect(isOnScreen(noteAt(-100), PANE)).toBe(false);
        expect(isOnScreen(noteAt(800), PANE)).toBe(false);
    });
});
