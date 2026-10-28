import { describe, it, expect } from "vitest";
import { TFile } from "obsidian";
import { findNotes, searchPattern } from "../../src/notes/note-search";

describe("searchPattern", () => {
    it("is null for a blank query, which matches nothing", () => {
        expect(searchPattern("")).toBeNull();
        expect(searchPattern("   ")).toBeNull();
    });

    it("matches the query anywhere, ignoring case", () => {
        const pattern = searchPattern("Run")!;
        expect("went for a run, then RUNNING".match(pattern)).toEqual(["run", "RUN"]);
    });

    it("reads the query literally, not as a regular expression", () => {
        const pattern = searchPattern("a.c (1+1)")!;
        expect(pattern.test("abc (11)")).toBe(false);
        pattern.lastIndex = 0;
        expect(pattern.test("a.c (1+1)")).toBe(true);
    });
});

describe("findNotes", () => {
    const notes = ["Notes/2025-01-03.md", "Notes/2025-01-02.md", "Notes/2025-01-01.md"].map((p) => new TFile(p));
    const sources: Record<string, string> = {
        "Notes/2025-01-03.md": "Dentist at 9",
        "Notes/2025-01-02.md": "Nothing much",
        "Notes/2025-01-01.md": "---\ntags: dentist\n---\nNew year",
    };
    const read = (file: TFile) => Promise.resolve(sources[file.path]!);

    it("returns the notes whose source holds the query, in stream order", async () => {
        expect(await findNotes(notes, read, "DENTIST")).toEqual([notes[0], notes[2]]);
    });

    it("matches the title, which the stream shows above every note", async () => {
        expect(await findNotes(notes, read, "01-02")).toEqual([notes[1]]);
    });

    // Obsidian's own search matches the text as shown, so formatting between
    // two words does not stop a match.
    it("matches the text as shown, across links and formatting", async () => {
        const shown: Record<string, string> = {
            "Notes/2025-01-03.md": "Updated the [[Project Atlas]] research doc",
            "Notes/2025-01-02.md": "Read [[Atlas/Plan|the plan]] twice, then [the docs](https://x.org) page",
            "Notes/2025-01-01.md": "A **bold** move, _lean_ times, ~~old~~ ==new== `code` here",
        };
        const reading = (file: TFile) => Promise.resolve(shown[file.path]!);

        expect(await findNotes(notes, reading, "project atlas research")).toEqual([notes[0]]);
        expect(await findNotes(notes, reading, "the plan twice")).toEqual([notes[1]]);
        expect(await findNotes(notes, reading, "docs page")).toEqual([notes[1]]);
        expect(await findNotes(notes, reading, "bold move, lean times, old new code here")).toEqual([notes[2]]);
    });

    it("does not match a link's hidden target, or join a word with an underscore", async () => {
        const shown: Record<string, string> = {
            "Notes/2025-01-03.md": "Read [[Atlas/Plan|the plan]] twice",
            "Notes/2025-01-02.md": "Renamed file_name",
            "Notes/2025-01-01.md": "",
        };
        const reading = (file: TFile) => Promise.resolve(shown[file.path]!);

        expect(await findNotes(notes, reading, "Atlas/Plan twice")).toEqual([]);
        expect(await findNotes(notes, reading, "filename")).toEqual([]);
    });

    // A note found by its Markdown before still is, so no query finds less.
    it("still matches the Markdown itself", async () => {
        const shown: Record<string, string> = {
            "Notes/2025-01-03.md": "Updated the [[Project Atlas]] research doc",
            "Notes/2025-01-02.md": "",
            "Notes/2025-01-01.md": "",
        };
        const reading = (file: TFile) => Promise.resolve(shown[file.path]!);

        expect(await findNotes(notes, reading, "[[Project")).toEqual([notes[0]]);
    });

    it("finds nothing for a blank query, without reading a note", async () => {
        const reads: TFile[] = [];
        const counting = (file: TFile) => (reads.push(file), read(file));

        expect(await findNotes(notes, counting, " ")).toEqual([]);
        expect(reads).toEqual([]);
    });
});
