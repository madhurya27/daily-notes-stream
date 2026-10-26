import { describe, it, expect } from "vitest";
import { parseYaml } from "obsidian";
import { asCards, extractBases } from "../../../src/render/bases/bases-as-cards";

const lines = (...l: string[]) => l.join("\n");

const TABLE = lines("views:", "  - type: table", "    name: Files", "    order:", "      - file.name");

interface View {
    type: string;
    name: string;
}

const views = (definition: string | null): View[] => (parseYaml(definition!) as { views: View[] }).views;

describe("asCards", () => {
    // YAML reads a "-" on its own as null.
    it("passes over an empty view", () => {
        const [, view] = views(asCards(lines("views:", "  -", "  - type: table", "    name: Files")));

        expect(view).toEqual({ type: "cards", name: "Files" });
    });

    it("draws a table view as cards, keeping the rest of it", () => {
        const [view] = views(asCards(TABLE));

        expect(view).toEqual({ type: "cards", name: "Files", order: ["file.name"] });
    });

    // A kanban's columns are its groups, and cards keep them as headings.
    it("draws a kanban view as cards, keeping its grouping", () => {
        const groupBy = ["    groupBy:", "      property: status", "      direction: ASC"];
        const definition = lines("views:", "  - type: kanban", "    name: Board", ...groupBy);

        const [view] = views(asCards(definition));

        expect(view).toEqual({ type: "cards", name: "Board", groupBy: { property: "status", direction: "ASC" } });
    });

    it("keeps what the definition holds besides views", () => {
        const definition = lines("filters: file.hasTag('daily')", TABLE);

        expect(parseYaml(asCards(definition)!)).toMatchObject({ filters: "file.hasTag('daily')" });
    });

    it("leaves a view that is not a table", () => {
        const definition = lines(TABLE, "  - type: map", "    name: Places");

        expect(views(asCards(definition)).map((v) => v.type)).toEqual(["cards", "map"]);
    });

    // An embed names its view, and a Base shows its first view.
    it("moves the named view first", () => {
        const definition = lines(TABLE, "  - type: table", "    name: Second");

        expect(views(asCards(definition, "Second")).map((v) => v.name)).toEqual(["Second", "Files"]);
    });

    it("keeps the order when the named view is missing", () => {
        const definition = lines(TABLE, "  - type: table", "    name: Second");

        expect(views(asCards(definition, "Gone")).map((v) => v.name)).toEqual(["Files", "Second"]);
    });

    it("sizes the cards it draws at the size given", () => {
        const [view] = views(asCards(TABLE, undefined, 800));

        expect(view).toEqual({ type: "cards", name: "Files", order: ["file.name"], cardSize: 800 });
    });

    // Bases keeps a view's card size when the view switches to a table and
    // back.
    it("keeps the card size a table view holds when given none", () => {
        const [view] = views(asCards(lines(TABLE, "    cardSize: 150")));

        expect(view).toEqual({ type: "cards", name: "Files", order: ["file.name"], cardSize: 150 });
    });

    // A cards view written in the note keeps the size it chose.
    it("leaves a view already cards at its own size", () => {
        const definition = lines(TABLE, "  - type: cards", "    name: Mine", "    cardSize: 150");

        const [, view] = views(asCards(definition, undefined, 800));

        expect(view).toEqual({ type: "cards", name: "Mine", cardSize: 150 });
    });

    it.each([
        ["no table or kanban view", lines("views:", "  - type: cards", "    name: C")],
        ["no views", "filters: file.hasTag('daily')"],
        ["views that are not a list", "views: nope"],
        ["a view that is not a map", lines("views:", "  - table")],
        ["invalid YAML", "views: [unclosed"],
        ["nothing", ""],
    ])("leaves a definition with %s alone", (_case, definition) => {
        expect(asCards(definition)).toBeNull();
    });
});

describe("extractBases", () => {
    const SLOT = '<div class="daily-note-base"></div>';

    it("swaps a base block for a placeholder the Base renders into", () => {
        const markdown = lines("Before", "```base", TABLE, "```", "After");

        const { markdown: rest, bases } = extractBases(markdown);

        // The blank line ends the HTML block. Without it, "After" would become
        // part of the block.
        expect(rest).toBe(lines("Before", SLOT, "", "After"));
        expect(bases).toEqual([{ kind: "block", definition: TABLE, markdown: lines("```base", TABLE, "```") }]);
    });

    it("reads an embed indented less than a code block as written, without its indent", () => {
        const { bases } = extractBases("   ![[Views.base]]");

        expect(bases).toEqual([{ kind: "embed", link: "Views.base", view: undefined, markdown: "![[Views.base]]" }]);
    });

    it("keeps a block's indent on its placeholder, and reads it without", () => {
        const indented = TABLE.split("\n").map((l) => `  ${l}`);

        const { markdown, bases } = extractBases(lines("- item", "  ~~~~ base", ...indented, "  ~~~~"));

        expect(markdown).toBe(lines("- item", `  ${SLOT}`, ""));
        expect(bases).toEqual([{ kind: "block", definition: TABLE, markdown: lines("~~~~ base", TABLE, "~~~~") }]);
    });

    // CommonMark removes up to the fence's indent from each line, and a line
    // may have less.
    it("reads a line indented less than its fence", () => {
        const { bases } = extractBases(lines("  ```base", "filters: x", "  ```"));

        expect(bases[0]).toMatchObject({ definition: "filters: x" });
    });

    it("swaps an embed alone on its line, naming its view", () => {
        const { markdown, bases } = extractBases(lines("Hi", "![[Views.base#Second|300]]"));

        expect(markdown).toBe(lines("Hi", SLOT, ""));
        expect(bases).toEqual([
            { kind: "embed", link: "Views.base", view: "Second", markdown: "![[Views.base#Second|300]]" },
        ]);
    });

    it("keeps the Bases in the order they appear", () => {
        const { bases } = extractBases(lines("![[A.base]]", "```base", TABLE, "```", "![[B.base]]"));

        expect(bases.map((b) => (b.kind === "embed" ? b.link : b.kind))).toEqual(["A.base", "block", "B.base"]);
    });

    it.each([
        ["quoted inside another fence", lines("````md", "```base", TABLE, "```", "````")],
        ["never closed", lines("```base", TABLE)],
        // A shorter fence, or one with another character, is content, not the
        // end of the block.
        ["closed only by a mismatched fence", lines("````base", TABLE, "```", "~~~~")],
        ["not alone on its line", "See ![[Views.base]]"],
        ["in a list item", "- ![[Views.base]]"],
        ["indented as code", "    ![[Views.base]]"],
        ["an embed quoted inside a fence", lines("```", "![[Views.base]]", "```")],
        ["an embed of a note", "![[Views.md]]"],
    ])("leaves a Base %s where it is", (_case, markdown) => {
        expect(extractBases(markdown)).toEqual({ markdown, bases: [] });
    });
});
