import { describe, it, expect } from "vitest";
import { BacklinkIndex } from "../../src/notes/backlink-index";

type ResolvedLinks = Record<string, Record<string, number>>;

/** An index of `links`, which counts how often it read them. */
function indexOver(links: ResolvedLinks) {
    let reads = 0;
    const index = new BacklinkIndex(() => {
        reads++;
        return links;
    });
    return { index, reads: () => reads };
}

describe("BacklinkIndex", () => {
    it("lists the notes that link to a path, sorted", () => {
        const { index } = indexOver({
            "b.md": { "day.md": 1 },
            "a.md": { "day.md": 2, "other.md": 1 },
            "c.md": { "other.md": 1 },
        });

        expect(index.sourcesOf("day.md")).toEqual(["a.md", "b.md"]);
        expect(index.sourcesOf("other.md")).toEqual(["a.md", "c.md"]);
    });

    it("lists nothing for a path no note links to", () => {
        const { index } = indexOver({ "a.md": { "day.md": 1 } });

        expect(index.sourcesOf("nowhere.md")).toEqual([]);
    });

    it("leaves out a note's links to itself", () => {
        const { index } = indexOver({ "day.md": { "day.md": 1 }, "a.md": { "day.md": 1 } });

        expect(index.sourcesOf("day.md")).toEqual(["a.md"]);
    });

    it("inverts the links once, however many lookups follow", () => {
        const { index, reads } = indexOver({ "a.md": { "day.md": 1 } });

        index.sourcesOf("day.md");
        index.sourcesOf("a.md");

        expect(reads()).toBe(1);
    });

    it("reads the links again on the lookup after an invalidation, not before", () => {
        const links: ResolvedLinks = { "a.md": { "day.md": 1 } };
        const { index, reads } = indexOver(links);
        index.sourcesOf("day.md");

        links["b.md"] = { "day.md": 1 };
        index.invalidate();
        expect(reads()).toBe(1);

        expect(index.sourcesOf("day.md")).toEqual(["a.md", "b.md"]);
        expect(reads()).toBe(2);
    });
});
