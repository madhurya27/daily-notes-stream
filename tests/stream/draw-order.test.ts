import { describe, expect, it } from "vitest";
import { nextToDraw } from "../../src/stream/draw-order";

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
