import { describe, expect, it, vi } from "vitest";
import { BaseMeasurements, baseDigest, type BaseKey } from "../../../src/render/bases/base-measurements";

const key = (path: string, base = "b1", layout = "600:16px"): BaseKey => ({ layout, path, base });

// A Base's height is never saved. Its note keeps it (D-054).
describe("BaseMeasurements", () => {
    it("keeps which Bases were too wide for a table, per layout", () => {
        const measured = new BaseMeasurements();
        measured.markTooWide(key("a.md"));

        expect(measured.isTooWide(key("a.md"))).toBe(true);
        expect(measured.isTooWide(key("a.md", "b2"))).toBe(false);
        expect(measured.isTooWide(key("a.md", "b1", "400:16px"))).toBe(false);
        expect(measured.isTooWide(key("b.md"))).toBe(false);
    });

    // The same rule as notes (ADR 0010): nothing to adjust for each vault,
    // however many Bases it has.
    it("forgets the layout used longest ago, past its limit", () => {
        const measured = new BaseMeasurements(undefined, 2);
        measured.markTooWide(key("a.md", "b1", "a"));
        measured.markTooWide(key("a.md", "b1", "b"));
        measured.isTooWide(key("a.md", "b1", "a"));
        measured.markTooWide(key("a.md", "b1", "c"));

        expect(measured.isTooWide(key("a.md", "b1", "b"))).toBe(false);
        expect(measured.isTooWide(key("a.md", "b1", "a"))).toBe(true);
    });

    it("carries a note's Bases across a rename, and forgets a deleted note's", () => {
        const measured = new BaseMeasurements();
        for (const path of ["old.md", "gone.md", "stale.md"]) measured.markTooWide(key(path));

        measured.rename("old.md", "new.md");
        measured.forget("gone.md");
        measured.retainOnly(new Set(["new.md"]));

        expect(measured.toJSON()).toEqual([["600:16px", [["new.md\nb1", { tooWide: true }]]]]);
    });

    it("says when it changed, and only then", () => {
        const changed = vi.fn();
        const measured = new BaseMeasurements(changed);
        measured.markTooWide(key("a.md"));
        measured.markTooWide(key("a.md"));
        measured.isTooWide(key("a.md"));

        expect(changed).toHaveBeenCalledOnce();
    });

    it("comes back from what it saved", () => {
        const saved = new BaseMeasurements();
        saved.markTooWide(key("b.md"));

        const restored = new BaseMeasurements();
        restored.restore(JSON.parse(JSON.stringify(saved.toJSON())));

        expect(restored.isTooWide(key("b.md"))).toBe(true);
    });

    it("restores nothing from what it did not save", () => {
        const measured = new BaseMeasurements();
        for (const junk of [
            null,
            [["k", { tooWide: true }]],
            [["l", [["k", null]]]],
            [["l", [["k", { height: 300 }]]]],
            [["l", [["k", { tooWide: 1 }]]]],
        ]) {
            measured.restore(junk);
            expect(measured.toJSON()).toEqual([]);
        }
    });
});

describe("baseDigest", () => {
    // A key that held a whole .base file was kilobytes long for each Base.
    it("stands for a Base's source in a few characters", () => {
        const definition = "views:\n" + "  - type: table\n".repeat(200);

        expect(baseDigest("![[Reading.base]]", definition)).toMatch(/^[0-9a-z]{1,11}$/);
        expect(baseDigest("![[Reading.base]]", definition)).toBe(baseDigest("![[Reading.base]]", definition));
        expect(baseDigest("![[Reading.base]]", definition)).not.toBe(baseDigest("![[Reading.base#Two]]", definition));
        expect(baseDigest("![[Reading.base]]", definition)).not.toBe(baseDigest("![[Reading.base]]", null));
        expect(baseDigest("![[Reading.base]]", definition)).not.toBe(baseDigest("![[Reading.base]]", "views: []"));
    });
});
