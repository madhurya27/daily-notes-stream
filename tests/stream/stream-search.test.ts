import { describe, it, expect, beforeEach, vi } from "vitest";
import { Component, TFile } from "obsidian";
import { SearchHighlighter } from "../../src/render/search-highlights";
import { StreamSearch } from "../../src/stream/stream-search";

/** Five notes, newest first, and what each says. */
const SOURCES: [string, string][] = [
    ["Notes/2025-01-05.md", "milk and more milk"],
    ["Notes/2025-01-04.md", "bread"],
    ["Notes/2025-01-03.md", "milk"],
    ["Notes/2025-01-02.md", "bread"],
    ["Notes/2025-01-01.md", "milk, milk, milk"],
];

describe("StreamSearch", () => {
    let notes: TFile[];
    let blocks: Map<TFile, HTMLElement>;
    let highlighter: SearchHighlighter;
    let status: string;
    let readied: TFile[];
    let centered: Range[];
    let top: TFile | null;
    let shown: (range: Range) => boolean;
    let onScreen: (range: Range) => boolean;
    let folded: (node: Node) => boolean;
    let unfolded: Node[];
    let search: StreamSearch;

    beforeEach(() => {
        CSS.highlights.clear();
        notes = SOURCES.map(([path]) => new TFile(path));
        highlighter = new SearchHighlighter();
        // Every note is drawn, as in a short stream near the screen.
        blocks = new Map(
            notes.map((file, i) => {
                const block = document.createElement("div");
                block.createEl("p", { text: SOURCES[i]![1] });
                const component = new Component();
                component.load();
                highlighter.track(block, component);
                return [file, block];
            })
        );
        status = "";
        readied = [];
        centered = [];
        top = notes[0]!;
        shown = () => true;
        onScreen = () => false;
        folded = () => false;
        unfolded = [];
        search = new StreamSearch(
            {
                notes: () => notes,
                read: (file) => Promise.resolve(SOURCES.find(([path]) => path === file.path)![1]),
            },
            {
                ready: (file) => {
                    readied.push(file);
                    return Promise.resolve(blocks.get(file) ?? null);
                },
                blockOf: (file) => blocks.get(file) ?? null,
                firstVisibleNote: () => top,
                center: (range) => {
                    centered.push(range);
                    return Promise.resolve();
                },
                isOnScreen: (range) => onScreen(range),
            },
            highlighter,
            { folds: (node) => folded(node), unfold: (node) => void unfolded.push(node) },
            (text) => (status = text),
            (range) => shown(range)
        );
    });

    const current = () => [...(CSS.highlights.get("daily-notes-search-current") ?? [])] as Range[];
    const currentNote = () => notes.find((f) => blocks.get(f)!.contains(current()[0]!.startContainer));

    it("counts the matching notes, not the matches", async () => {
        await search.search("milk");
        expect(status).toBe("3 notes");

        await search.search("bread");
        expect(status).toBe("2 notes");
    });

    it("says so when nothing matches, and nothing for a blank query", async () => {
        await search.search("cheese");
        expect(status).toBe("No results");

        await search.search("");
        expect(status).toBe("");
        await search.search("  ");
        expect(status).toBe("");
    });

    // Obsidian's own search bar selects a match as you type. The stream only
    // does so where the reader already is, so a half-typed word never scrolls
    // away.
    it("marks the topmost match already on screen, moving nothing", async () => {
        const inNote = (i: number) => (range: Range) => blocks.get(notes[i]!)!.contains(range.startContainer);
        onScreen = (range) => inNote(2)(range) || (inNote(0)(range) && range.startOffset === 14);

        await search.search("milk");

        expect(current()[0]!.startOffset).toBe(14);
        expect(currentNote()).toBe(notes[0]);
        expect(status).toBe("1 / 3");
        expect(readied).toEqual([]);
        expect(centered).toEqual([]);
    });

    it("keeps no match marked from the search before when none is on screen", async () => {
        await search.search("milk");
        await search.next();
        expect(current()).toHaveLength(1);

        await search.search("bread");

        expect(current()).toEqual([]);
    });

    it("steps on from the match it marked", async () => {
        onScreen = (range) => blocks.get(notes[2]!)!.contains(range.startContainer);
        await search.search("milk");

        await search.next();

        expect(readied).toEqual([notes[4]]);
        expect(status).toBe("3 / 3");
    });

    it("marks no match the reader cannot see, even inside the pane", async () => {
        onScreen = () => true;
        shown = () => false;

        await search.search("milk");

        expect(current()).toEqual([]);
        expect(status).toBe("3 notes");
    });

    it("marks no folded match as you type, unfolding nothing", async () => {
        onScreen = () => true;
        shown = () => false;
        folded = () => true;

        await search.search("milk");

        expect(current()).toEqual([]);
        expect(unfolded).toEqual([]);
    });

    it("counts one note in the singular", async () => {
        await search.search("more");
        expect(status).toBe("1 note");
    });

    it("starts from the note at the top of the pane", async () => {
        top = notes[1]!;
        await search.search("milk");

        await search.next();

        expect(readied).toEqual([notes[2]]);
        expect(status).toBe("2 / 3");
    });

    it("starts from the first match when nothing is on screen", async () => {
        top = null;
        await search.search("milk");

        await search.next();

        expect(readied).toEqual([notes[0]]);
    });

    it("steps through a note's highlights before moving to the next note", async () => {
        await search.search("milk");

        await search.next();
        const first = current()[0]!;
        await search.next();
        const second = current()[0]!;
        await search.next();

        expect([first.startOffset, second.startOffset]).toEqual([0, 14]);
        expect(readied).toEqual([notes[0], notes[2]]);
        expect(currentNote()).toBe(notes[2]);
        expect(status).toBe("2 / 3");
    });

    // Not the element holding it: centering a code block taller than the pane
    // would move the match off screen.
    it("centers the current highlight itself in the pane", async () => {
        await search.search("milk");

        await search.next();
        await search.next();

        expect(centered.map((range) => range.startOffset)).toEqual([0, 14]);
        expect(centered[1]).toBe(current()[0]);
    });

    it("wraps from the last note to the first", async () => {
        await search.search("bread");

        await search.next();
        await search.next();
        await search.next();

        expect(readied).toEqual([notes[1], notes[3], notes[1]]);
        expect(status).toBe("1 / 2");
    });

    it("enters a note at its last highlight going backwards", async () => {
        top = notes[4]!;
        await search.search("milk");

        await search.previous();

        expect(readied).toEqual([notes[4]]);
        expect(current()[0]!.startOffset).toBe(12);
        expect(status).toBe("3 / 3");
    });

    it("steps back through a note, then to the note before it, wrapping", async () => {
        await search.search("milk");

        await search.next();
        await search.next();
        await search.previous();
        await search.previous();

        expect(readied).toEqual([notes[0], notes[4]]);
        expect(status).toBe("3 / 3");
    });

    it("goes back from the top note to the last match above it, wrapping", async () => {
        top = notes[3]!;
        await search.search("milk");

        await search.previous();

        expect(readied).toEqual([notes[2]]);
    });

    it("skips highlights the reader cannot see, as under a collapsed heading", async () => {
        shown = (range) => range.startOffset !== 0;
        await search.search("milk");

        await search.next();

        expect(current()[0]!.startOffset).toBe(14);
    });

    it("unfolds a folded highlight on the step that reaches it", async () => {
        shown = (range) => range.startOffset !== 0;
        folded = () => true;
        await search.search("milk");

        await search.next();

        expect(current()[0]!.startOffset).toBe(0);
        expect(unfolded).toEqual([current()[0]!.startContainer]);
        expect(status).toBe("1 / 3");

        await search.next();

        expect(current()[0]!.startOffset).toBe(14);
        expect(unfolded).toHaveLength(1);
    });

    it("reads what the reader can see off the layout", async () => {
        // jsdom has no layout for ranges. Chromium gives a hidden range no
        // boxes.
        const boxes = vi.fn(function (this: Range) {
            return this.startOffset === 0 ? [] : [{}];
        });
        Object.defineProperty(Range.prototype, "getClientRects", { value: boxes, configurable: true });
        try {
            search = new StreamSearch(
                { notes: () => notes, read: (file) => Promise.resolve(SOURCES[notes.indexOf(file)]![1]) },
                {
                    ready: (file) => Promise.resolve(blocks.get(file)!),
                    blockOf: () => null,
                    firstVisibleNote: () => null,
                    center: () => Promise.resolve(),
                    isOnScreen: () => false,
                },
                highlighter,
                { folds: () => false, unfold: () => {} },
                () => {}
            );
            await search.search("milk");

            await search.next();

            expect(current()[0]!.startOffset).toBe(14);
        } finally {
            Reflect.deleteProperty(Range.prototype, "getClientRects");
        }
    });

    it("still visits a note whose matches are all out of sight", async () => {
        shown = () => false;
        await search.search("milk");

        await search.next();
        await search.next();

        expect(readied).toEqual([notes[0], notes[2]]);
        expect(current()).toEqual([]);
        expect(status).toBe("2 / 3 · hidden");
    });

    // Drawn again since, as after a save, so its matches can be seen.
    it("steps into a hidden note's first match once it shows", async () => {
        shown = () => false;
        await search.search("milk");
        await search.next();
        shown = () => true;

        await search.next();

        expect(readied).toEqual([notes[0]]);
        expect(currentNote()).toBe(notes[0]);
    });

    it("moves on from a hidden note no longer drawn", async () => {
        shown = () => false;
        await search.search("milk");
        await search.next();
        blocks.delete(notes[0]!);

        await search.next();

        expect(readied).toEqual([notes[0], notes[2]]);
    });

    it("moves nowhere before any search", async () => {
        await search.next();

        expect(readied).toEqual([]);
    });

    it("moves nowhere when nothing matches", async () => {
        await search.search("cheese");

        await search.next();
        await search.previous();

        expect(readied).toEqual([]);
    });

    it("finds the notes a vault change adds, staying on the current one", async () => {
        await search.search("milk");
        await search.next();
        await search.next();
        await search.next();
        SOURCES[1]![1] = "milk";

        try {
            await search.refresh();
            expect(status).toBe("3 / 4");
        } finally {
            SOURCES[1]![1] = "bread";
        }
    });

    it("drops the current note once it stops matching", async () => {
        await search.search("bread");
        await search.next();
        notes.splice(1, 1);

        await search.refresh();

        expect(status).toBe("1 note");
    });

    it("reads nothing on a vault change while no search is open", async () => {
        const read = vi.fn();
        search["source"].read = read;

        await search.refresh();

        expect(read).not.toHaveBeenCalled();
    });

    it("clears the highlights and the count on close", async () => {
        await search.search("milk");
        await search.next();

        await search.close();

        expect(status).toBe("");
        expect(current()).toEqual([]);
        expect([...CSS.highlights.get("daily-notes-search-match")!]).toEqual([]);
    });

    it("logs a failed read and keeps answering", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        search["source"].read = () => Promise.reject(new Error("gone"));

        await search.search("milk");
        search["source"].read = () => Promise.resolve("milk");
        await search.search("milk");

        expect(error).toHaveBeenCalledWith("DailyNotesStream: Search failed", expect.any(Error));
        expect(status).toBe("5 notes");
        error.mockRestore();
    });

    it("runs a step only after the search typed before it", async () => {
        const typed = search.search("bread");
        const stepped = search.next();

        await Promise.all([typed, stepped]);

        expect(readied).toEqual([notes[1]]);
    });
});
