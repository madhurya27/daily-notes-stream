import { describe, it, expect } from "vitest";
import { TFile, type FileView } from "obsidian";
import { ReadingNotes, type ReadingNote } from "../../src/stream/reading-notes";

describe("ReadingNotes", () => {
    const report: ReadingNote = {
        view: {} as FileView,
        note: new TFile("Notes/2026-03-11.md"),
        date: null,
        scrolling: true,
    };

    it("passes each report to every listener", () => {
        const notes = new ReadingNotes();
        const first: ReadingNote[] = [];
        const second: ReadingNote[] = [];
        notes.subscribe((r) => first.push(r));
        notes.subscribe((r) => second.push(r));

        notes.report(report);

        expect(first).toEqual([report]);
        expect(second).toEqual([report]);
    });

    it("stops passing reports to a listener once it unsubscribes", () => {
        const notes = new ReadingNotes();
        const heard: ReadingNote[] = [];
        const unsubscribe = notes.subscribe((r) => heard.push(r));

        unsubscribe();
        notes.report(report);

        expect(heard).toEqual([]);
    });
});
