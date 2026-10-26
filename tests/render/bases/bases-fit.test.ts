import { describe, it, expect, beforeEach } from "vitest";
import { fitBaseToWidth } from "../../../src/render/bases/bases-fit";

const MAX = "--bases-table-column-max-width";
const MIN = "--bases-table-column-min-width";

let view: HTMLElement;
let thead: HTMLElement;
let scrolls: number;

/**
 * A `.bases-view` `available` wide, whose table Bases laid out `tableWidth`
 * wide.
 */
function makeView(available: number, tableWidth: string): void {
    view = document.createElement("div");
    view.addClass("bases-view");
    Object.defineProperty(view, "clientWidth", { get: () => available });
    thead = view.createDiv({ cls: "bases-thead" });
    thead.setAttribute("style", `width: ${tableWidth}`);
    scrolls = 0;
    view.addEventListener("scroll", () => scrolls++);
}

beforeEach(() => makeView(300, "600px"));

describe("fitBaseToWidth", () => {
    // Bases' own minimum would keep a phone's columns wider than the maximum.
    it("shrinks the column cap by how far the table overruns", () => {
        fitBaseToWidth(view);

        expect(view.style.getPropertyValue(MAX)).toBe("150px");
        expect(view.style.getPropertyValue(MIN)).toBe("40px");
    });

    // Bases reads the maximum when it lays out, which a scroll event on the
    // view triggers.
    it("asks Bases to lay the table out again", () => {
        fitBaseToWidth(view);

        expect(scrolls).toBe(1);
    });

    // Bases' minimum widths can keep the table as wide as it was.
    it("shrinks from the cap it set before", () => {
        fitBaseToWidth(view);

        fitBaseToWidth(view);

        expect(view.style.getPropertyValue(MAX)).toBe("75px");
    });

    it("never shrinks a column below the floor", () => {
        makeView(100, "1000px");

        fitBaseToWidth(view);

        expect(view.style.getPropertyValue(MAX)).toBe("40px");
    });

    // Below the minimum, the table is clipped. A column resized by hand ignores
    // the maximum.
    it("stops at the floor", () => {
        makeView(100, "1000px");
        fitBaseToWidth(view);
        scrolls = 0;

        fitBaseToWidth(view);

        expect(view.style.getPropertyValue(MAX)).toBe("40px");
        expect(scrolls).toBe(0);
    });

    it.each([
        ["fits", 300, "300px"],
        ["has no width yet", 300, ""],
        ["is not laid out", 0, "600px"],
    ])("leaves a Base alone when its table %s", (_case, available, width) => {
        makeView(available, width);

        fitBaseToWidth(view);

        expect(view.style.getPropertyValue(MAX)).toBe("");
        expect(scrolls).toBe(0);
    });

    it("leaves a Base with no table alone", () => {
        thead.remove();

        fitBaseToWidth(view);

        expect(scrolls).toBe(0);
    });
});
