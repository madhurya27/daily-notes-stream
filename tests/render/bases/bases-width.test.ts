import { describe, it, expect } from "vitest";
import { narrowestTableWidth } from "../../../src/render/bases/bases-width";

const lines = (...l: string[]) => l.join("\n");

/** Ten pixels a character, and Bases' 34px of padding, icon and gap. */
const headers = { chrome: 34, textWidth: (label: string) => label.length * 10 };

function table(order: string[], ...extra: string[]): string {
    return lines(
        "views:",
        "  - type: table",
        "    name: T",
        "    order:",
        ...order.map((c) => `      - ${c}`),
        ...extra
    );
}

describe("narrowestTableWidth", () => {
    // Bases makes a column as wide as its header or its longest value,
    // whichever is wider, plus one. So the header alone gives the minimum.
    it("sums each column's header", () => {
        expect(narrowestTableWidth(table(["mood", "energy"]), undefined, headers)).toBe(40 + 34 + 1 + (60 + 34 + 1));
    });

    it.each([
        ["file.name", "file name"],
        ["file.ctime", "created time"],
        ["file.ext", "file extension"],
        ["file.tags", "tags"],
        ["note.mood", "mood"],
        ["formula.pace", "pace"],
    ])("reads %s as Bases labels it: %s", (column, label) => {
        expect(narrowestTableWidth(table([column]), undefined, headers)).toBe(label.length * 10 + 35);
    });

    it.each([
        ["its own key", "mood"],
        ["its note. key", "note.mood"],
    ])("labels a property with the display name under %s", (_case, key) => {
        const definition = lines("properties:", `  ${key}:`, "    displayName: How I felt", table(["mood"]));

        expect(narrowestTableWidth(definition, undefined, headers)).toBe(100 + 35);
    });

    it("labels a property by its name when its display name is not text", () => {
        const definition = lines("properties:", "  mood:", "    displayName: 5", table(["mood"]));

        expect(narrowestTableWidth(definition, undefined, headers)).toBe(40 + 35);
    });

    // Only a note., formula. or file. at the start says where the column comes
    // from.
    it("keeps the whole name of a property with one inside it", () => {
        expect(narrowestTableWidth(table(["trip.note.length"]), undefined, headers)).toBe(160 + 35);
    });

    it("keeps a column at least Bases' minimum", () => {
        expect(narrowestTableWidth(table(["a"]), undefined, { chrome: 0, textWidth: () => 0 })).toBe(40);
    });

    it("caps a column at Bases' maximum", () => {
        expect(narrowestTableWidth(table(["a".repeat(50)]), undefined, headers)).toBe(300);
    });

    it("takes a hand-sized column at its size", () => {
        const definition = table(["mood", "energy"], "    columnSize:", "      mood: 500", "      energy: 10");

        expect(narrowestTableWidth(definition, undefined, headers)).toBe(500 + 40);
    });

    it("measures the named view", () => {
        const definition = lines(table(["mood"]), "  - type: table", "    name: Wide", "    order:", "      - energy");

        expect(narrowestTableWidth(definition, "Wide", headers)).toBe(60 + 35);
    });

    it("measures the first view when the named one is missing", () => {
        expect(narrowestTableWidth(table(["mood"]), "Gone", headers)).toBe(40 + 35);
    });

    it.each([
        ["a view that is not a table", lines("views:", "  - type: cards", "    order:", "      - mood")],
        ["no columns", lines("views:", "  - type: table")],
        ["columns that are not a list", lines("views:", "  - type: table", "    order: mood")],
        ["no views", "filters: x"],
        ["invalid YAML", "views: [unclosed"],
    ])("claims nothing for %s", (_case, definition) => {
        expect(narrowestTableWidth(definition, undefined, headers)).toBe(0);
    });
});
