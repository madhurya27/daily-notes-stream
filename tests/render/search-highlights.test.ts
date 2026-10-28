import { describe, it, expect, beforeEach } from "vitest";
import { Component } from "obsidian";
import { SearchHighlighter } from "../../src/render/search-highlights";

/**
 * The registered highlight called `name`, which the stylesheet's
 * `::highlight()` reads.
 */
const highlighted = (name: string) => [...(CSS.highlights.get(name) ?? [])].map((r) => (r as Range).toString());

function renderedBlock(html: string): { block: HTMLElement; component: Component } {
    const block = document.createElement("div");
    // Markup for the test. The rule against writing raw HTML only covers src/.
    block.innerHTML = html;
    const component = new Component();
    component.load();
    return { block, component };
}

/**
 * Stands in for a pop-out window. An iframe has its own window and document,
 * and here its own highlight registry, as each Chromium window does.
 */
function popOutWindow(): { win: Window & typeof globalThis; registry: HighlightRegistry } {
    const frame = document.body.appendChild(document.createElement("iframe"));
    const win = frame.contentWindow as Window & typeof globalThis;
    const registry = new Map() as unknown as HighlightRegistry;
    (win as { CSS: unknown }).CSS = { highlights: registry };
    win.Highlight = Highlight;
    // Obsidian adds its helpers to each window's nodes, including a pop-out's.
    const { doc, win: ownWindow } = Object.getOwnPropertyDescriptors(Node.prototype);
    Object.defineProperties(win.Node.prototype, { doc, win: ownWindow });
    return { win, registry };
}

describe("SearchHighlighter", () => {
    let highlighter: SearchHighlighter;

    beforeEach(() => {
        CSS.highlights.clear();
        highlighter = new SearchHighlighter();
    });

    it("highlights every occurrence in a rendered note, ignoring case", () => {
        const { block, component } = renderedBlock("<p>Ran 5 km. <b>KM</b> again</p>");
        highlighter.setQuery("km");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["km", "KM"]);
        expect(highlighted("daily-notes-search-match")).toEqual(["km", "KM"]);
    });

    it("highlights a match that runs across a link and the text after it", () => {
        const { block, component } = renderedBlock(
            '<p>Updated the <a class="internal-link">Project <b>Atlas</b></a> research doc</p>'
        );
        highlighter.setQuery("atlas research");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["Atlas research"]);
        expect(highlighted("daily-notes-search-match")).toEqual(["Atlas research"]);
    });

    // A range that ended at the start of the next element would take in part
    // of that element's box when it is measured.
    it("starts and ends each range in the text nodes it covers", () => {
        const { block, component } = renderedBlock("<p>Run <b>fast</b> today</p>");
        highlighter.track(block, component);
        const ends = () =>
            highlighter.rangesIn(block).map((r) => [r.startContainer.textContent, r.endContainer.textContent]);

        highlighter.setQuery("run ");
        expect(ends()).toEqual([["Run ", "Run "]]);
        highlighter.setQuery("fast today");
        expect(ends()).toEqual([["fast", " today"]]);
    });

    it("finds nothing in a note that does not hold the query", () => {
        const { block, component } = renderedBlock("<p>milk</p>");
        highlighter.track(block, component);

        for (const query of ["here", "fine"]) {
            highlighter.setQuery(query);
            expect(highlighter.rangesIn(block)).toEqual([]);
        }
    });

    it("matches within a paragraph, list item or cell, never across two", () => {
        const { block, component } = renderedBlock(
            "<h2>Run</h2><p>Route</p><ul><li>Route<ul><li>Run</li></ul></li></ul><table><tr><td>Run</td><td>Route</td></tr></table>"
        );
        highlighter.setQuery("runroute");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block)).toEqual([]);
    });

    it("does not join the text on either side of an embed", () => {
        const { block, component } = renderedBlock('<p>left <span class="internal-embed">x</span> right</p>');
        highlighter.setQuery("left  right");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block)).toEqual([]);
    });

    it("finds matches again in a tracked block changed in place, and none in an untracked one", () => {
        const { block, component } = renderedBlock("<p>Ran 5 km.</p>");
        const untracked = renderedBlock("<p>Ran 9 km.</p>").block;
        highlighter.setQuery("km");
        highlighter.track(block, component);
        block.createEl("p", { text: "Then 2 km more." });

        highlighter.refresh(block);
        highlighter.refresh(untracked);

        expect(highlighter.rangesIn(block)).toHaveLength(2);
        expect(highlighter.rangesIn(untracked)).toHaveLength(0);
        expect(highlighted("daily-notes-search-match")).toEqual(["km", "km"]);
    });

    // Stream search matches a note's own text. Another note's excerpt is not a
    // match in it.
    it("highlights nothing in a note's linked mentions", () => {
        const { block, component } = renderedBlock(
            '<p>Ran 5 km.</p><div class="daily-note-mentions"><p>Ran 10 km.</p></div>'
        );
        highlighter.setQuery("km");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["km"]);
    });

    // The heading is the plugin's own label and is in no note's text, so the
    // count would say "No results".
    it("highlights nothing in the properties heading", () => {
        const { block, component } = renderedBlock(
            '<div class="metadata-properties-heading"><div>Properties</div></div><p>properties of water</p>'
        );
        highlighter.setQuery("properties");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["properties"]);
    });

    // A Base lists other notes, and draws its own toolbar, such as "15
    // results".
    it("highlights nothing in a Base", () => {
        const { block, component } = renderedBlock(
            '<p>Soup results</p><div class="block-language-base bases-embed"><div>15 results</div><div>Soup</div></div>'
        );
        highlighter.setQuery("soup");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["Soup"]);
    });

    it("highlights nothing in an embedded note", () => {
        const { block, component } = renderedBlock(
            // A <div> inside a <p> would close the <p>, because the HTML parser
            // works differently from Obsidian's DOM calls.
            '<div>Ran 5 km.<span class="internal-embed markdown-embed"><div>Ran 10 km.</div></span></div>'
        );
        highlighter.setQuery("km");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["km"]);
    });

    it("highlights nothing in Obsidian's word on a missing attachment", () => {
        const { block, component } = renderedBlock(
            '<p>Found it<span class="internal-embed file-embed">“a.png” could not be found.</span></p>'
        );
        highlighter.setQuery("found");

        highlighter.track(block, component);

        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["Found"]);
    });

    it("re-highlights the rendered notes when the query changes", () => {
        const { block, component } = renderedBlock("<p>milk and bread</p>");
        highlighter.track(block, component);
        expect(highlighter.rangesIn(block)).toEqual([]);

        highlighter.setQuery("bread");

        expect(highlighted("daily-notes-search-match")).toEqual(["bread"]);
    });

    it("drops the current mark when the query changes", () => {
        const { block, component } = renderedBlock("<p>milk and bread</p>");
        highlighter.setQuery("milk");
        highlighter.track(block, component);
        highlighter.setCurrent(highlighter.rangesIn(block)[0]!);

        highlighter.setQuery("bread");

        expect(highlighted("daily-notes-search-current")).toEqual([]);
    });

    it("clears every highlight for a blank query", () => {
        const { block, component } = renderedBlock("<p>milk</p>");
        highlighter.setQuery("milk");
        highlighter.track(block, component);

        highlighter.setQuery("");

        expect(highlighter.rangesIn(block)).toEqual([]);
        expect(highlighted("daily-notes-search-match")).toEqual([]);
    });

    it("drops a note's highlights when its component unloads", () => {
        const { block, component } = renderedBlock("<p>milk</p>");
        highlighter.setQuery("milk");
        highlighter.track(block, component);
        highlighter.setCurrent(highlighter.rangesIn(block)[0]!);

        component.unload();

        expect(highlighter.rangesIn(block)).toEqual([]);
        expect(highlighted("daily-notes-search-match")).toEqual([]);
        expect(highlighted("daily-notes-search-current")).toEqual([]);
    });

    it("marks one range as current, and moves the mark", () => {
        const { block, component } = renderedBlock("<p>one milk, two milk</p>");
        highlighter.setQuery("milk");
        highlighter.track(block, component);
        const [first, second] = highlighter.rangesIn(block);

        highlighter.setCurrent(first!);
        highlighter.setCurrent(second!);

        expect([...CSS.highlights.get("daily-notes-search-current")!]).toEqual([second]);
    });

    // Overlapping ranges are painted by priority: the current match on top of
    // the others.
    it("paints the current match over the other matches", () => {
        const { block, component } = renderedBlock("<p>milk</p>");
        highlighter.setQuery("milk");
        highlighter.track(block, component);
        highlighter.setCurrent(highlighter.rangesIn(block)[0]!);

        expect(CSS.highlights.get("daily-notes-search-current")!.priority).toBe(1);
        expect(CSS.highlights.get("daily-notes-search-match")!.priority).toBe(0);
    });

    it("keeps the current match marked as another note's matches are found again", () => {
        const a = renderedBlock("<p>milk</p>");
        const b = renderedBlock("<p>milk</p>");
        highlighter.setQuery("milk");
        highlighter.track(a.block, a.component);
        highlighter.track(b.block, b.component);
        const [current] = highlighter.rangesIn(a.block);
        highlighter.setCurrent(current!);

        highlighter.refresh(b.block);

        expect([...CSS.highlights.get("daily-notes-search-current")!]).toEqual([current]);
    });

    it("leaves other views' ranges in the shared highlight", () => {
        const other = new SearchHighlighter();
        const a = renderedBlock("<p>milk</p>");
        const b = renderedBlock("<p>milk</p>");
        highlighter.setQuery("milk");
        other.setQuery("milk");
        highlighter.track(a.block, a.component);
        other.track(b.block, b.component);

        highlighter.setQuery("");

        expect(highlighted("daily-notes-search-match")).toEqual(["milk"]);
    });

    it("paints a note in a pop-out window in that window's registry, not the main one's", () => {
        const { win, registry } = popOutWindow();
        const block = win.document.body.appendChild(win.document.createElement("div"));
        block.append(win.document.createTextNode("Ran 5 km"));
        const component = new Component();
        component.load();
        highlighter.setQuery("km");

        highlighter.track(block, component);
        highlighter.setCurrent(highlighter.rangesIn(block)[0]!);

        const painted = (name: string) => [...(registry.get(name) ?? [])].map((r) => (r as Range).toString());
        expect(painted("daily-notes-search-match")).toEqual(["km"]);
        expect(painted("daily-notes-search-current")).toEqual(["km"]);
        expect(highlighted("daily-notes-search-match")).toEqual([]);
        expect(highlighted("daily-notes-search-current")).toEqual([]);

        highlighter.setCurrent(null);
        component.unload();
        expect(painted("daily-notes-search-match")).toEqual([]);
        expect(painted("daily-notes-search-current")).toEqual([]);
    });

    it("tracks ranges without painting where the platform has no highlight API", () => {
        const registry = CSS.highlights;
        (CSS as { highlights?: HighlightRegistry }).highlights = undefined;
        try {
            const { block, component } = renderedBlock("<p>milk</p>");
            highlighter.setQuery("milk");
            highlighter.track(block, component);
            highlighter.setCurrent(highlighter.rangesIn(block)[0]!);
            highlighter.setCurrent(null);
            highlighter.refresh(block);

            expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["milk"]);
        } finally {
            CSS.highlights = registry;
        }
    });
});
