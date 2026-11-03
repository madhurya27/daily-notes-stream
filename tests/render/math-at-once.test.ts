import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { MarkdownPostProcessorContext } from "obsidian";
import { mathJax } from "../mocks/obsidian";
import { drawMathAtOnce } from "../../src/render/math-at-once";

const ctx = {} as MarkdownPostProcessorContext;
/** MathJax's stylesheet, as far as the code reads it: an element. */
let sheet: HTMLElement;

beforeEach(() => {
    Object.assign(mathJax, { fails: null, finishes: 0 });
    sheet = document.createElement("div");
    (window as unknown as { MathJax?: unknown }).MathJax = { chtmlStylesheet: () => sheet, tex2chtml: () => null };
});

afterEach(() => {
    sheet.remove();
    delete (window as unknown as { MathJax?: unknown }).MathJax;
});

/** A section of a note in the stream, holding `html`. */
function section(html: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
}

const everywhere = () => true;

describe("drawMathAtOnce", () => {
    it("draws each math element, so Obsidian's own step finds none to wait for", () => {
        const el = section('<span class="math">x^2</span> and <div class="math math-block">\\sum x</div>');

        const waited = drawMathAtOnce(everywhere)(el, ctx) as unknown;

        expect(waited).toBeUndefined();
        const drawn = [...el.querySelectorAll(".math")].map((math) => ({
            loaded: math.classList.contains("is-loaded"),
            source: math.querySelector("mjx-container")?.getAttribute("data-source"),
            display: math.querySelector("mjx-container")?.getAttribute("data-display"),
        }));
        expect(drawn).toEqual([
            { loaded: true, source: "x^2", display: "false" },
            { loaded: true, source: "\\sum x", display: "true" },
        ]);
    });

    it("draws the TeX as written, with the HTML's escapes undone", () => {
        const el = section('<span class="math">a &lt; b</span>');

        void drawMathAtOnce(everywhere)(el, ctx);

        expect(el.querySelector("mjx-container")?.getAttribute("data-source")).toBe("a < b");
        expect(el.querySelector(".math")?.childElementCount).toBe(1);
    });

    it("sizes the math at once, and still lets Obsidian finish its own way", () => {
        const el = section('<span class="math">x</span>');

        void drawMathAtOnce(everywhere)(el, ctx);

        expect(sheet.isConnected).toBe(true);
        expect(mathJax.finishes).toBe(1);
    });

    it("shows math MathJax can't read as its text, as Obsidian does", () => {
        mathJax.fails = "\\bad{";
        const el = section('<span class="math">\\bad{</span>');

        void drawMathAtOnce(everywhere)(el, ctx);

        const math = el.querySelector(".math")!;
        expect(math.textContent).toBe("\\bad{");
        expect(math.querySelector("mjx-container")).toBeNull();
        expect(math.classList.contains("is-loaded")).toBe(true);
    });

    it("leaves math drawn already alone", () => {
        const el = section('<span class="math is-loaded"><mjx-container data-source="old"></mjx-container></span>');

        void drawMathAtOnce(everywhere)(el, ctx);

        expect(el.querySelector("mjx-container")?.getAttribute("data-source")).toBe("old");
        expect(mathJax.finishes).toBe(0);
    });

    it("does nothing in a section without math", () => {
        void drawMathAtOnce(everywhere)(section("<p>Words</p>"), ctx);

        expect(sheet.isConnected).toBe(false);
        expect(mathJax.finishes).toBe(0);
    });

    it("leaves math outside the stream to Obsidian", () => {
        const el = section('<span class="math">x</span>');

        void drawMathAtOnce((target) => target !== el)(el, ctx);

        expect(el.querySelector(".math")!.classList.contains("is-loaded")).toBe(false);
        expect(mathJax.finishes).toBe(0);
    });

    it("leaves math to Obsidian until MathJax has loaded", () => {
        (window as unknown as { MathJax?: unknown }).MathJax = {};
        const el = section('<span class="math">x</span>');

        void drawMathAtOnce(everywhere)(el, ctx);

        expect(el.querySelector(".math")!.classList.contains("is-loaded")).toBe(false);
        expect(mathJax.finishes).toBe(0);
    });
});
