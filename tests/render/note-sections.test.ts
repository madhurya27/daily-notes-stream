import { describe, it, expect } from "vitest";
import type { CachedMetadata } from "obsidian";
import { changedSpan, noteChunks, noteSections } from "../../src/render/note-sections";

/**
 * The cache's sections for `parts`, joined by blank lines, as Obsidian records
 * them.
 */
function indexed(parts: { type: string; text: string }[], extra: Partial<CachedMetadata> = {}) {
    let offset = 0;
    const sections = parts.map(({ type, text }) => {
        const start = offset;
        offset += text.length + 2;
        return {
            type,
            position: {
                start: { line: 0, col: 0, offset: start },
                end: { line: 0, col: 0, offset: start + text.length },
            },
        };
    });
    return { markdown: parts.map((p) => p.text).join("\n\n"), cache: { sections, ...extra } as CachedMetadata };
}

/** A paragraph of a journal. */
const paragraph = (i: number) => ({ type: "paragraph", text: `Day ${i}. Ran 5 km.` });
const journal = (count = 10) => Array.from({ length: count }, (_, i) => paragraph(i));

describe("noteSections", () => {
    it("is each section's source, in order", () => {
        const parts = [{ type: "heading", text: "## Morning" }, ...journal()];
        const { markdown, cache } = indexed(parts);
        expect(noteSections(markdown, cache)).toEqual(parts.map((p) => p.text));
    });

    it("leaves out the frontmatter, which renders as properties", () => {
        const { markdown, cache } = indexed([{ type: "yaml", text: "---\nmood: ok\n---" }, ...journal()]);
        expect(noteSections(markdown, cache)).toHaveLength(10);
    });

    it("splits a short note as well", () => {
        const { markdown, cache } = indexed([{ type: "paragraph", text: "Ran 5 km." }]);
        expect(noteSections(markdown, cache)).toEqual(["Ran 5 km."]);
    });

    it("is null with no sections indexed", () => {
        const { markdown } = indexed(journal());
        expect(noteSections(markdown, null)).toBeNull();
        expect(noteSections(markdown, {})).toBeNull();
    });

    it.each([
        ["footnotes", { footnotes: [{ id: "1" }] }],
        ["footnote references", { footnoteRefs: [{ id: "1" }] }],
        ["reference links", { referenceLinks: [{ link: "a" }] }],
    ])("is null with %s, which span sections", (_, extra) => {
        const { markdown, cache } = indexed(journal(), extra as Partial<CachedMetadata>);
        expect(noteSections(markdown, cache)).toBeNull();
    });

    it("is null with an inline footnote, drawn at the note's end", () => {
        const { markdown, cache } = indexed([...journal(), { type: "paragraph", text: "A fact.^[Source]" }]);
        expect(noteSections(markdown, cache)).toBeNull();
    });
});

describe("changedSpan", () => {
    it("is the run between what stayed the same at either end", () => {
        expect(changedSpan(["a", "b", "c", "d"], ["a", "x", "y", "d"])).toEqual({
            start: 1,
            endBefore: 3,
            endAfter: 3,
        });
    });

    it("covers an insertion and a deletion", () => {
        expect(changedSpan(["a", "c"], ["a", "b", "c"])).toEqual({ start: 1, endBefore: 1, endAfter: 2 });
        expect(changedSpan(["a", "b", "c"], ["a", "c"])).toEqual({ start: 1, endBefore: 2, endAfter: 1 });
    });

    it("is empty when nothing changed", () => {
        expect(changedSpan(["a", "b"], ["a", "b"])).toEqual({ start: 2, endBefore: 2, endAfter: 2 });
    });

    it("never lets the shared ends overlap: a repeated section counts once", () => {
        expect(changedSpan(["a", "a"], ["a", "a", "a"])).toEqual({ start: 2, endBefore: 2, endAfter: 3 });
        expect(changedSpan(["a", "a"], ["a"])).toEqual({ start: 1, endBefore: 2, endAfter: 1 });
    });
});

describe("noteChunks", () => {
    it("runs consecutive sections together up to the size, cut from the note's own text", () => {
        const { markdown, cache } = indexed(journal(4));
        // Each paragraph is 16 characters. Two of them and the blank line
        // between are 34.
        expect(noteChunks(markdown, cache, 34)).toEqual([
            "Day 0. Ran 5 km.\n\nDay 1. Ran 5 km.",
            "Day 2. Ran 5 km.\n\nDay 3. Ran 5 km.",
        ]);
    });

    it("leaves a section longer than the size whole, on its own", () => {
        const long = { type: "paragraph", text: "x".repeat(50) };
        const { markdown, cache } = indexed([paragraph(0), long, paragraph(1)]);
        expect(noteChunks(markdown, cache, 34)).toEqual(["Day 0. Ran 5 km.", "x".repeat(50), "Day 1. Ran 5 km."]);
    });

    it("is one chunk for a note shorter than the size", () => {
        const { markdown, cache } = indexed(journal(3));
        expect(noteChunks(markdown, cache, 1000)).toEqual([markdown]);
    });

    it("leaves out the frontmatter", () => {
        const { markdown, cache } = indexed([{ type: "yaml", text: "---\nmood: ok\n---" }, ...journal(2)]);
        expect(noteChunks(markdown, cache, 1000)).toEqual(["Day 0. Ran 5 km.\n\nDay 1. Ran 5 km."]);
    });

    it("is null where the note renders whole", () => {
        const { markdown, cache } = indexed(journal(), { footnotes: [{ id: "1" }] } as Partial<CachedMetadata>);
        expect(noteChunks(markdown, cache, 34)).toBeNull();
        expect(noteChunks(markdown, null, 34)).toBeNull();
    });
});
