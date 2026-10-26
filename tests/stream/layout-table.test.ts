import { describe, expect, it, vi } from "vitest";
import { LayoutTable } from "../../src/stream/layout-table";

const isNumber = (value: unknown): value is number => typeof value === "number";
const table = (changed = vi.fn(), limit?: number) => new LayoutTable(isNumber, changed, limit);

describe("LayoutTable", () => {
    it("keeps a value per layout and key", () => {
        const values = table();
        values.set("600:16px", "a.md", 300);
        values.set("600:16px", "a.md", 320);

        expect(values.get("600:16px", "a.md")).toBe(320);
        expect(values.get("400:16px", "a.md")).toBeUndefined();
        expect(values.entries("600:16px")).toEqual([["a.md", 320]]);
        expect(values.entries("400:16px")).toEqual([]);
    });

    // Every pane width and font size is a separate layout.
    it("forgets the layout used longest ago, past its limit", () => {
        const values = table(undefined, 2);
        values.set("a", "x.md", 1);
        values.set("b", "x.md", 2);
        values.get("a", "x.md");
        values.entries("b");
        values.set("c", "x.md", 3);

        expect(values.get("b", "x.md")).toBeUndefined();
        expect(values.get("a", "x.md")).toBe(1);
        expect(values.get("c", "x.md")).toBe(3);
    });

    // A Base's key is its note's path, a newline, and what makes it unique.
    it("carries a note's entries across a rename, in every layout", () => {
        const values = table();
        values.set("a", "old.md", 1);
        values.set("b", "old.md\nbase", 2);
        values.set("b", "old.md.bak", 3);
        values.rename("old.md", "new.md");

        expect(values.get("a", "new.md")).toBe(1);
        expect(values.get("b", "new.md\nbase")).toBe(2);
        expect(values.get("b", "old.md.bak")).toBe(3);
        expect(values.get("a", "old.md")).toBeUndefined();
    });

    it("forgets a deleted note, and notes no longer in the vault", () => {
        const values = table();
        values.set("a", "x.md", 1);
        values.set("a", "x.md\nbase", 1);
        values.set("a", "y.md", 2);
        values.set("b", "z.md\nbase", 3);
        values.forget("x.md");
        expect(values.toJSON()).toEqual([
            ["a", [["y.md", 2]]],
            ["b", [["z.md\nbase", 3]]],
        ]);

        values.retainOnly(new Set(["z.md"]));
        expect(values.toJSON()).toEqual([
            ["a", []],
            ["b", [["z.md\nbase", 3]]],
        ]);
    });

    it("says which layout changed, and only when one did", () => {
        const changed = vi.fn();
        const values = table(changed);
        values.set("a", "x.md", 1);
        values.set("b", "x.md", 1);
        changed.mockClear();

        values.get("a", "x.md");
        values.rename("absent.md", "y.md");
        values.forget("absent.md");
        values.retainOnly(new Set(["x.md"]));
        expect(changed).not.toHaveBeenCalled();

        values.rename("x.md", "y.md");
        expect(changed.mock.calls.flat().sort()).toEqual(["a", "b"]);
    });

    it("comes back from what it saved, oldest layout still first to go", () => {
        const saved = table(undefined, 2);
        saved.set("a", "x.md", 1);
        saved.set("b", "y.md", 2);
        saved.get("a", "x.md");

        const restored = table(undefined, 2);
        restored.restore(JSON.parse(JSON.stringify(saved.toJSON())));
        restored.set("c", "z.md", 3);

        expect(restored.get("a", "x.md")).toBe(1);
        expect(restored.get("b", "y.md")).toBeUndefined();
    });

    it("restores nothing from what it did not save", () => {
        const values = table();
        for (const junk of [
            null,
            3,
            {},
            [["a"]],
            [["a", [["x.md", "1"]]]],
            [[1, []]],
            [["a", [[1, 1]]]],
            [["a", 5]],
            // One bad entry spoils the rest, because a half-restored table is
            // not what was saved.
            [["a", [["x.md", 1]]], ["b"]],
            [
                [
                    "a",
                    [
                        ["x.md", 1],
                        ["y.md", "2"],
                    ],
                ],
            ],
        ]) {
            values.restore(junk);
            expect(values.toJSON()).toEqual([]);
        }
    });
});
