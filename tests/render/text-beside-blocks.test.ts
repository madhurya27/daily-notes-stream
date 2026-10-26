import { describe, it, expect } from "vitest";
import { wrapTextBesideBlocks } from "../../src/render/text-beside-blocks";

/** A root holding `html`, wrapped. */
function wrapped(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    wrapTextBesideBlocks(root);
    return root;
}

describe("wrapTextBesideBlocks", () => {
    // WebKit paints no highlight on text that shares its parent with a block
    // element.
    it("wraps a list item's own text when a sub-list follows it", () => {
        const li = wrapped("<ul><li>Standing pancake<ul><li>Head to floor</li></ul></li></ul>").querySelector("li")!;

        const [first] = li.childNodes;
        expect((first as HTMLElement).outerHTML).toBe('<span class="daily-note-text-run">Standing pancake</span>');
        expect(li.textContent).toBe("Standing pancakeHead to floor");
    });

    it("wraps each bare run, before and after the block", () => {
        const div = wrapped("<div>Before<p>para</p>after</div>").firstElementChild!;

        expect([...div.children].map((el) => el.outerHTML)).toEqual([
            '<span class="daily-note-text-run">Before</span>',
            "<p>para</p>",
            '<span class="daily-note-text-run">after</span>',
        ]);
    });

    it("leaves text alone where no block shares its parent", () => {
        const html = "<ul><li>Elephant <strong>walk</strong></li></ul><p>Plain</p>";
        expect(wrapped(html).innerHTML).toBe(html);
    });

    it("leaves inline elements beside a block alone: WebKit paints inside them", () => {
        const html = "<ul><li><a>Link</a><ul><li>x</li></ul></li></ul>";
        expect(wrapped(html).innerHTML).toBe(html);
    });

    it("leaves whitespace between blocks alone", () => {
        const html = "<div>\n<p>a</p>\n<p>b</p>\n</div>";
        expect(wrapped(html).innerHTML).toBe(html);
    });

    it("reaches text nested at any depth", () => {
        const root = wrapped("<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li></ul>");
        expect([...root.querySelectorAll(".daily-note-text-run")].map((el) => el.textContent)).toEqual(["a", "b"]);
    });
});
