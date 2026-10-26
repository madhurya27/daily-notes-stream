import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DailyNoteService, type NoteFilter } from "../../src/notes/daily-note-service";
import { ParsedDates } from "../../src/notes/parsed-dates";
import {
    __mockMarkdownFiles,
    __setMockNotes,
    __setMockSettings,
    __getSettingsCallCount,
    __mockSettings,
    __resetSettingsCallCount,
} from "../mocks/daily-notes";
import { TFile, moment } from "obsidian";

/** Counts reads of each file's name. Every date read starts with one. */
function countNameReads(files: TFile[]): () => number {
    let reads = 0;
    for (const file of files) {
        const { basename } = file;
        Object.defineProperty(file, "basename", { get: () => (reads++, basename) });
    }
    return () => reads;
}

describe("DailyNoteService", () => {
    beforeEach(() => {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
        __setMockNotes([]);
    });

    describe("initialize + getBatch: building the sorted cache", () => {
        async function buildSorted(): Promise<TFile[]> {
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            return svc.getBatch(0, svc.length);
        }

        it("parses daily notes in root folder", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-03.md", "Notes/2025-01-02.md"]);

            const sorted = await buildSorted();

            expect(sorted.length).toBe(3);
            expect(sorted[0]?.basename).toBe("2025-01-03");
            expect(sorted[1]?.basename).toBe("2025-01-02");
            expect(sorted[2]?.basename).toBe("2025-01-01");
        });

        it("parses daily notes in nested folders", async () => {
            __setMockSettings({ format: "YYYY/MM/YYYY-MM-DD", folder: "Notes" });
            __setMockNotes([
                "Notes/2025/01/2025-01-01.md",
                "Notes/2025/01/2025-01-10.md",
                "Notes/2025/01/2025-01-05.md",
            ]);

            const sorted = await buildSorted();

            expect(sorted.length).toBe(3);
            expect(sorted[0]?.basename).toBe("2025-01-10");
            expect(sorted[1]?.basename).toBe("2025-01-05");
            expect(sorted[2]?.basename).toBe("2025-01-01");
        });

        it("never parses the name of a file outside the daily-notes folder", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            const outside = new TFile("Pages/2025-01-02.md");
            const reads = countNameReads([outside]);
            const svc = new DailyNoteService(() => [...__mockMarkdownFiles(), outside], __mockSettings);

            await svc.initialize();
            svc.insertSorted(outside);

            expect(reads()).toBe(0);
        });

        it("ignores files that do not match the format", async () => {
            __setMockSettings({ format: "YYYY/MM/YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025/01/2025-01-01.md", "Notes/2025/01/Template.md", "Notes/SomeOtherFile.md"]);

            const sorted = await buildSorted();

            expect(sorted.length).toBe(1);
            expect(sorted[0]?.basename).toBe("2025-01-01");
        });

        it("drops a date-named note in a subfolder the format does not name, as a live create would", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-02.md", "Notes/archive/2025-01-01.md"]);

            expect((await buildSorted()).map((f) => f.path)).toEqual(["Notes/2025-01-02.md"]);
        });

        it("keeps a note whose date an attachment shares", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-01.png"]);

            expect((await buildSorted()).map((f) => f.path)).toEqual(["Notes/2025-01-01.md"]);
        });

        it("handles compact date format without slashes", async () => {
            __setMockSettings({ format: "YYYYMMDD", folder: "Notes" });
            __setMockNotes(["Notes/20250101.md"]);

            const sorted = await buildSorted();

            expect(sorted.length).toBe(1);
            expect(sorted[0]?.basename).toBe("20250101");
        });
    });

    describe("instance: initialize + getBatch", () => {
        it("returns a batch starting at offset 0", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-03.md", "Notes/2025-01-02.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            const batch = svc.getBatch(0, 2);
            expect(batch.length).toBe(2);
            expect(batch[0]?.basename).toBe("2025-01-03");
            expect(batch[1]?.basename).toBe("2025-01-02");
        });

        it("returns empty batch when offset exceeds length", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.getBatch(5, 10)).toEqual([]);
        });
    });

    describe("the stream: the newest notes, as many as it has loaded", () => {
        async function serviceOf(...dates: string[]): Promise<DailyNoteService> {
            __setMockNotes(dates.map((date) => `Notes/${date}.md`));
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            return svc;
        }

        const basenames = (files: TFile[]) => files.map((file) => file.basename);

        it("starts empty", async () => {
            const svc = await serviceOf("2025-01-01");

            expect(svc.streamLength).toBe(0);
            expect(svc.streamedNotes()).toEqual([]);
        });

        it("extends by the next newest notes, and returns them", async () => {
            const svc = await serviceOf("2025-01-01", "2025-01-02", "2025-01-03");

            expect(basenames(svc.extendStream(2))).toEqual(["2025-01-03", "2025-01-02"]);
            expect(basenames(svc.extendStream(2))).toEqual(["2025-01-01"]);
            expect(svc.streamLength).toBe(3);
            expect(basenames(svc.streamedNotes())).toEqual(["2025-01-03", "2025-01-02", "2025-01-01"]);
        });

        it("extends by nothing past the last note", async () => {
            const svc = await serviceOf("2025-01-01");
            svc.extendStream(1);

            expect(svc.extendStream(1)).toEqual([]);
            expect(svc.streamLength).toBe(1);
        });

        it("takes in a note inserted inside it", async () => {
            const svc = await serviceOf("2025-01-01", "2025-01-05");
            svc.extendStream(1);

            expect(svc.insertSorted(new TFile("Notes/2025-01-06.md"))).toEqual({ index: 0, inStream: true });
            expect(basenames(svc.streamedNotes())).toEqual(["2025-01-06", "2025-01-05"]);
        });

        it("leaves out a note inserted at or past its end", async () => {
            const svc = await serviceOf("2025-01-01", "2025-01-05");
            svc.extendStream(1);

            expect(svc.insertSorted(new TFile("Notes/2025-01-03.md"))).toEqual({ index: 1, inStream: false });
            expect(basenames(svc.streamedNotes())).toEqual(["2025-01-05"]);
            expect(basenames(svc.extendStream(1))).toEqual(["2025-01-03"]);
        });

        it("drops a note removed inside it", async () => {
            const svc = await serviceOf("2025-01-01", "2025-01-02", "2025-01-03");
            svc.extendStream(2);

            svc.removeSorted("Notes/2025-01-03.md");

            expect(basenames(svc.streamedNotes())).toEqual(["2025-01-02"]);
            expect(basenames(svc.extendStream(1))).toEqual(["2025-01-01"]);
        });

        it("keeps its length when a note past its end is removed", async () => {
            const svc = await serviceOf("2025-01-01", "2025-01-02", "2025-01-03");
            svc.extendStream(1);

            svc.removeSorted("Notes/2025-01-01.md");

            expect(svc.streamLength).toBe(1);
        });

        it("keeps its length when the first note past its end is removed", async () => {
            const svc = await serviceOf("2025-01-01", "2025-01-02", "2025-01-03");
            svc.extendStream(1);

            svc.removeSorted("Notes/2025-01-02.md");

            expect(svc.streamLength).toBe(1);
        });

        it("empties when the list is built again", async () => {
            const svc = await serviceOf("2025-01-01");
            svc.extendStream(1);

            __setMockSettings({ format: "YYYY-MM-DD", folder: "Journal" });
            __setMockNotes(["Journal/2025-01-01.md"]);
            await svc.refreshIfSettingsChanged();

            expect(svc.streamLength).toBe(0);
        });

        it("stays as it is when the list is not built again", async () => {
            const svc = await serviceOf("2025-01-01");
            svc.extendStream(1);

            await svc.refreshIfSettingsChanged();

            expect(svc.streamLength).toBe(1);
        });
    });

    describe("instance: insertSorted", () => {
        it("inserts a newer note at index 0", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            const newFile = new TFile("Notes/2025-01-05.md");
            const inserted = svc.insertSorted(newFile);

            expect(inserted?.index).toBe(0);
            expect(svc.getBatch(0, 10)[0]?.basename).toBe("2025-01-05");
        });

        it("returns null for a path already in the cache", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.insertSorted(new TFile("Notes/2025-01-01.md"))).toBeNull();
            expect(svc.length).toBe(2);
        });

        // A change to the settings refreshes the service
        // (refreshIfSettingsChanged), so the list's format is up to date.
        it("reads no daily-note settings once built", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            __resetSettingsCallCount();

            svc.insertSorted(new TFile("Notes/2025-01-05.md"));
            await svc.belongs(new TFile("Notes/2025-01-06.md"));
            svc.hidesAny();
            svc.formatDate(moment("2025-01-03", "YYYY-MM-DD", true));
            svc.parseNoteDate("2025-01-03");

            expect(__getSettingsCallCount()).toBe(0);
        });

        it("inserts a note between a newer and an older one", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-05.md", "Notes/2025-01-01.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            const mid = new TFile("Notes/2025-01-03.md");
            const inserted = svc.insertSorted(mid);

            expect(inserted?.index).toBe(1);
            expect(svc.getBatch(0, 3)[1]?.basename).toBe("2025-01-03");
        });
    });

    describe("instance: removeSorted", () => {
        it("removes a file by path and returns its index", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-03.md", "Notes/2025-01-01.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            const idx = svc.removeSorted("Notes/2025-01-03.md");
            expect(idx).toBe(0);
            expect(svc.length).toBe(1);
        });

        it("returns -1 when path not found", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);

            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.removeSorted("Notes/nonexistent.md")).toBe(-1);
            expect(svc.length).toBe(1);
        });
    });

    describe("instance: insertSorted — invalid date", () => {
        // A vault event fires for every file, including attachments and copies.
        it.each(["Notes/2025-01-02.pdf", "Notes/2025-01-02 copy.md"])("returns null for %s", async (path) => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.insertSorted(new TFile(path))).toBeNull();
        });

        it("logs, and lists nothing, when listing the notes fails", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => {});
            const failure = new Error("vault unavailable");
            const svc = new DailyNoteService(() => {
                throw failure;
            }, __mockSettings);

            await svc.initialize();

            expect(svc.length).toBe(0);
            expect(error).toHaveBeenCalledWith("DailyNotesStream: Failed to list the daily notes", failure);
            error.mockRestore();
        });

        it("returns null for a file with no parseable date", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            const noDate = new TFile("Notes/Template.md");
            expect(svc.insertSorted(noDate)).toBeNull();
        });
    });

    describe("instance: insertSorted — non-daily-note files", () => {
        async function serviceWith(paths: string[]): Promise<DailyNoteService> {
            __setMockNotes(paths);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            return svc;
        }

        it("rejects a non-markdown file whose basename matches the date format", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            const svc = await serviceWith(["Notes/2025-01-01.md"]);

            expect(svc.insertSorted(new TFile("Notes/2025-01-05.png"))).toBeNull();
            expect(svc.length).toBe(1);
        });

        it("rejects a date-named note outside the daily notes folder", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            const svc = await serviceWith(["Notes/2025-01-01.md"]);

            expect(svc.insertSorted(new TFile("Archive/2025-01-05.md"))).toBeNull();
            expect(svc.length).toBe(1);
        });

        it("accepts a note in a nested-format subfolder", async () => {
            __setMockSettings({ format: "YYYY/MM/YYYY-MM-DD", folder: "Notes" });
            const svc = await serviceWith(["Notes/2025/01/2025-01-01.md"]);

            expect(svc.insertSorted(new TFile("Notes/2025/01/2025-01-05.md"))?.index).toBe(0);
        });

        it("rejects a note that sits outside its nested-format subfolder", async () => {
            __setMockSettings({ format: "YYYY/MM/YYYY-MM-DD", folder: "Notes" });
            const svc = await serviceWith(["Notes/2025/01/2025-01-01.md"]);

            expect(svc.insertSorted(new TFile("Notes/2025-01-05.md"))).toBeNull();
        });

        it("accepts a root-folder note when the folder setting is empty", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "" });
            const svc = await serviceWith(["2025-01-01.md"]);

            expect(svc.insertSorted(new TFile("2025-01-05.md"))?.index).toBe(0);
        });

        it("accepts a note when the folder setting has a trailing slash", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes/" });
            const svc = await serviceWith(["Notes/2025-01-01.md"]);

            expect(svc.insertSorted(new TFile("Notes/2025-01-05.md"))?.index).toBe(0);
        });

        it("accepts a note when the folder setting is absent entirely", async () => {
            __setMockSettings({ format: "YYYY-MM-DD" });
            const svc = await serviceWith(["2025-01-01.md"]);

            expect(svc.insertSorted(new TFile("2025-01-05.md"))?.index).toBe(0);
        });
    });

    describe("a missing or folder-only format", () => {
        // An empty moment format reads any ISO 8601 date, including week and
        // ordinal forms.
        it("lists only notes named YYYY-MM-DD when no format is set", async () => {
            __setMockSettings({ format: "", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md", "Notes/20250102.md", "Notes/2025-W01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            expect(svc.getBatch(0, 3).map((f) => f.basename)).toEqual(["2025-01-01"]);
        });

        it("lists nothing when the format ends in a folder, as no path can match it", async () => {
            __setMockSettings({ format: "YYYY/MM/", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025/01/.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            expect(svc.length).toBe(0);
        });

        it("accepts a new YYYY-MM-DD note when no format is set", async () => {
            __setMockSettings({ format: "", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            const newFile = new TFile("Notes/2025-01-05.md");
            const inserted = svc.insertSorted(newFile);
            expect(inserted?.index).toBe(0);
        });

        it("rejects a new note when the format ends in a folder, as no path can match it", async () => {
            __setMockSettings({ format: "YYYY/MM/", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            const newFile = new TFile("Notes/2025-01-05.md");
            expect(svc.insertSorted(newFile)).toBeNull();
        });
    });
    describe("refreshIfSettingsChanged: reacting to the daily-notes config", () => {
        it("rebuilds and reports true when the date format changed", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            __setMockSettings({ format: "YYYY/MM/YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025/01/2025-01-01.md", "Notes/2025/01/2025-01-02.md"]);

            expect(await svc.refreshIfSettingsChanged()).toBe(true);
            expect(svc.length).toBe(2);
            expect(svc.getBatch(0, 1)[0]?.path).toBe("Notes/2025/01/2025-01-02.md");
        });

        it("rebuilds and reports true when the folder changed", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            __setMockSettings({ format: "YYYY-MM-DD", folder: "Journal" });
            __setMockNotes(["Journal/2025-01-01.md", "Journal/2025-01-02.md"]);

            expect(await svc.refreshIfSettingsChanged()).toBe(true);
            expect(svc.length).toBe(2);
        });

        it("reports false and leaves the cache alone when the settings are unchanged", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            const before = svc.getBatch(0, svc.length);

            // A note appearing on disk is handled by vault events, not by a
            // rebuild.
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md"]);

            expect(await svc.refreshIfSettingsChanged()).toBe(false);
            expect(svc.getBatch(0, svc.length)).toEqual(before);
        });

        // A note made between the settings change and the refresh stays in the
        // list it was added to.
        it("dates notes by the format the list was built with until a refresh rebuilds it", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            __setMockSettings({ format: "DD-MM-YYYY", folder: "Notes" });

            expect(svc.insertSorted(new TFile("Notes/2025-01-03.md"))?.index).toBe(0);
            expect(svc.formatDate(moment("2025-01-03", "YYYY-MM-DD", true))).toBe("2025-01-03");
            await svc.refreshIfSettingsChanged();
            expect(svc.formatDate(moment("2025-01-03", "YYYY-MM-DD", true))).toBe("03-01-2025");
        });

        it("reports true on the first call when initialize() never ran", async () => {
            __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
            __setMockNotes(["Notes/2025-01-01.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);

            expect(await svc.refreshIfSettingsChanged()).toBe(true);
            expect(svc.length).toBe(1);
        });
    });

    describe("instance: isToday", () => {
        beforeEach(() => vi.useFakeTimers({ now: new Date(2025, 0, 5, 12) }));
        afterEach(() => vi.useRealTimers());

        /** Yesterday's note, today's, and one made in advance. */
        async function svc(): Promise<DailyNoteService> {
            __setMockNotes(["Notes/2025-01-04.md", "Notes/2025-01-05.md", "Notes/2025-01-10.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            return svc;
        }

        it("is true for today's note only", async () => {
            const service = await svc();
            expect(service.isToday("Notes/2025-01-05.md")).toBe(true);
            expect(service.isToday("Notes/2025-01-04.md")).toBe(false);
            expect(service.isToday("Notes/2025-01-10.md")).toBe(false);
            expect(service.isToday("Notes/Reading list.md")).toBe(false);
        });

        it("moves to the next day's note at midnight", async () => {
            const service = await svc();
            vi.setSystemTime(new Date(2025, 0, 6, 0, 30));
            expect(service.isToday("Notes/2025-01-05.md")).toBe(false);
        });

        it("is false with no note before today", async () => {
            __setMockNotes(["Notes/2025-01-10.md"]);
            const service = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await service.initialize();
            expect(service.isToday("Notes/2025-01-10.md")).toBe(false);
        });
    });

    describe("instance: indexForDate", () => {
        /** Three notes, newest first: 2025-01-10, 2025-01-05, 2025-01-01. */
        async function svcWithGaps(): Promise<DailyNoteService> {
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-05.md", "Notes/2025-01-10.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            return svc;
        }

        it("finds the note for an exact date", async () => {
            expect((await svcWithGaps()).indexForDate(moment("2025-01-05", "YYYY-MM-DD", true))).toBe(1);
        });

        it("falls back to the next note older than a date with no note", async () => {
            expect((await svcWithGaps()).indexForDate(moment("2025-01-07", "YYYY-MM-DD", true))).toBe(1);
        });

        it("returns the newest note when the date is newer than all of them", async () => {
            expect((await svcWithGaps()).indexForDate(moment("2026-01-01", "YYYY-MM-DD", true))).toBe(0);
        });

        it("returns -1 when every note is newer than the date", async () => {
            expect((await svcWithGaps()).indexForDate(moment("2024-12-31", "YYYY-MM-DD", true))).toBe(-1);
        });

        it("returns -1 for an empty stream", async () => {
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.indexForDate(moment("2025-01-05", "YYYY-MM-DD", true))).toBe(-1);
        });

        it("ignores the time of day: any moment within the day hits that day's note", async () => {
            const midday = moment("2025-01-05", "YYYY-MM-DD", true);
            midday.add(13, "hours");

            expect((await svcWithGaps()).indexForDate(midday)).toBe(1);
        });
    });

    describe("instance: indexOf", () => {
        it("finds a note by path", async () => {
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.indexOf("Notes/2025-01-01.md")).toBe(1);
            expect(svc.indexOf("Notes/2025-01-09.md")).toBe(-1);
        });
    });

    describe("dates parsed once, when the list is built", () => {
        const built = async () => {
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md", "Notes/2025-01-03.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            return { svc, reads: countNameReads(__mockMarkdownFiles()) };
        };

        it("lists the dates without parsing a name again", async () => {
            const { svc, reads } = await built();

            svc.dates();

            expect(reads()).toBe(0);
        });

        it("finds a date's place without parsing a name again", async () => {
            const { svc, reads } = await built();

            svc.indexForDate(moment("2025-01-02", "YYYY-MM-DD", true));

            expect(reads()).toBe(0);
        });

        it("parses only the new note's name on insert", async () => {
            const { svc } = await built();
            const created = new TFile("Notes/2025-01-04.md");
            const reads = countNameReads([...__mockMarkdownFiles(), created]);

            svc.insertSorted(created);

            expect(reads()).toBe(1);
        });
    });

    describe("dates remembered between builds", () => {
        const NOTES = ["Notes/2025-01-01.md", "Notes/2025-01-02.md", "Notes/2025-01-03.md"];
        const buildWith = async (dates: ParsedDates) => {
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, dates);
            await svc.initialize();
            return svc;
        };

        it("parses no name a service sharing the cache already parsed", async () => {
            __setMockNotes(NOTES);
            const dates = new ParsedDates();
            await buildWith(dates);
            const reads = countNameReads(__mockMarkdownFiles());

            const svc = await buildWith(dates);

            expect(reads()).toBe(0);
            expect(svc.dates().map((d) => d.format("YYYY-MM-DD"))).toEqual(["2025-01-03", "2025-01-02", "2025-01-01"]);
        });

        it("parses only a note the cache has not seen", async () => {
            __setMockNotes(NOTES);
            const dates = new ParsedDates();
            await buildWith(dates);
            __setMockNotes([...NOTES, "Notes/2025-01-04.md"]);
            const reads = countNameReads(__mockMarkdownFiles());

            const svc = await buildWith(dates);

            expect(reads()).toBe(1);
            expect(svc.length).toBe(4);
        });

        it("parses every name again once the format changes", async () => {
            __setMockNotes(NOTES);
            const dates = new ParsedDates();
            await buildWith(dates);
            __setMockSettings({ format: "DD-MM-YYYY", folder: "Notes" });
            const reads = countNameReads(__mockMarkdownFiles());

            const svc = await buildWith(dates);

            expect(reads()).toBe(3);
            expect(svc.length).toBe(0);
        });
    });

    describe("dates + formatDate: what the jump suggester offers", () => {
        it("lists every note's date, newest first", async () => {
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-03.md", "Notes/2025-01-02.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.dates().map((d) => d.format("YYYY-MM-DD"))).toEqual(["2025-01-03", "2025-01-02", "2025-01-01"]);
        });

        // The jump list shows dates the way the reader's own file names write
        // them, so a vault that names its notes DD-MM-YYYY must not be shown
        // ISO dates.
        it("writes a date the way this vault names its notes", async () => {
            __setMockSettings({ format: "DD-MM-YYYY", folder: "Notes" });
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.formatDate(moment("2025-01-03", "YYYY-MM-DD", true))).toBe("03-01-2025");
        });

        it("reads a date back out of the way this vault writes it", async () => {
            __setMockSettings({ format: "DD-MM-YYYY", folder: "Notes" });
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.parseNoteDate("03-01-2025")?.format("YYYY-MM-DD")).toBe("2025-01-03");
            expect(svc.parseNoteDate("2025-01-03")).toBeNull();
        });

        // Between a settings change and the rebuild after it, the jump list
        // shows what the stream still shows, because a jump goes there.
        it("offers the notes the stream shows until a format change rebuilds it", async () => {
            __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-31.md"]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();
            __setMockSettings({ format: "MMMM D, YYYY", folder: "Notes" });

            expect(svc.dates().map((d) => d.format("YYYY-MM-DD"))).toEqual(["2025-01-31", "2025-01-01"]);
        });

        // With a nested format, the file is named after the last part only.
        it("writes only the segment the filename carries", async () => {
            __setMockSettings({ format: "YYYY/MM/YYYY-MM-DD", folder: "Notes" });
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
            await svc.initialize();

            expect(svc.formatDate(moment("2025-01-03", "YYYY-MM-DD", true))).toBe("2025-01-03");
        });
    });
});

describe("DailyNoteService: hidden notes", () => {
    /** A filter that hides `hidden`, and records what it was prepared with. */
    function filterHiding(hidden: string[]) {
        const prepared: string[][] = [];
        const rechecked: string[] = [];
        let signature = "a";
        const filter: NoteFilter = {
            recheck: (file) => {
                rechecked.push(file.path);
                return Promise.resolve();
            },
            prepare: (files) => {
                prepared.push(files.map((file) => file.path));
                return Promise.resolve();
            },
            isHidden: (file) => hidden.includes(file.path),
            signature: () => signature,
        };
        return { filter, prepared, rechecked, hidden, resign: (next: string) => (signature = next) };
    }

    beforeEach(() => {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
        __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md", "Notes/2025-01-03.md", "Notes/Ideas.md"]);
    });

    const paths = (svc: DailyNoteService) => svc.getBatch(0, svc.length).map((file) => file.path);

    it("prepares the filter with the daily notes, then leaves out what it hides", async () => {
        const { filter, prepared } = filterHiding(["Notes/2025-01-02.md"]);
        const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, new ParsedDates(), filter);

        await svc.initialize();

        expect(prepared).toEqual([["Notes/2025-01-01.md", "Notes/2025-01-02.md", "Notes/2025-01-03.md"]]);
        expect(paths(svc)).toEqual(["Notes/2025-01-03.md", "Notes/2025-01-01.md"]);
    });

    it("lists nothing when listing fails, and lists again on the next refresh", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const { filter } = filterHiding([]);
        const prepare = vi.spyOn(filter, "prepare").mockRejectedValueOnce(new Error("ENOENT"));
        const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, new ParsedDates(), filter);

        await svc.initialize();
        expect(svc.length).toBe(0);
        expect(error).toHaveBeenCalledOnce();

        expect(await svc.refreshIfSettingsChanged()).toBe(true);
        expect(prepare).toHaveBeenCalledTimes(2);
        expect(svc.length).toBe(3);
        error.mockRestore();
    });

    it("inserts no hidden note", async () => {
        const { filter } = filterHiding(["Notes/2025-01-04.md"]);
        const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, new ParsedDates(), filter);
        await svc.initialize();

        expect(svc.insertSorted(new TFile("Notes/2025-01-04.md"))).toBeNull();
        expect(svc.length).toBe(3);
    });

    it("lists the notes again, prepared afresh, when the filter's signature changes", async () => {
        const { filter, prepared, hidden, resign } = filterHiding([]);
        const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, new ParsedDates(), filter);
        await svc.initialize();
        expect(await svc.refreshIfSettingsChanged()).toBe(false);

        hidden.push("Notes/2025-01-03.md");
        resign("b");

        expect(await svc.refreshIfSettingsChanged()).toBe(true);
        expect(prepared).toHaveLength(2);
        expect(paths(svc)).toEqual(["Notes/2025-01-02.md", "Notes/2025-01-01.md"]);
    });

    it("tells whether a note belongs in the list, preparing the filter for a daily note alone", async () => {
        const { filter, prepared, rechecked, hidden } = filterHiding([]);
        const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, new ParsedDates(), filter);
        await svc.initialize();
        hidden.push("Notes/2025-01-02.md");

        expect(await svc.belongs(new TFile("Notes/2025-01-02.md"))).toBe(false);
        expect(await svc.belongs(new TFile("Notes/2025-01-01.md"))).toBe(true);
        expect(await svc.belongs(new TFile("Notes/Ideas.md"))).toBe(false);
        expect(prepared).toHaveLength(1);
        expect(rechecked).toEqual(["Notes/2025-01-02.md", "Notes/2025-01-01.md"]);
    });

    it("with no filter, finds every daily note belongs", async () => {
        const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
        await svc.initialize();

        expect(await svc.belongs(new TFile("Notes/2025-01-02.md"))).toBe(true);
    });

    it("tells whether it hides any daily note", async () => {
        const { filter, hidden } = filterHiding([]);
        const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, new ParsedDates(), filter);
        await svc.initialize();
        expect(svc.hidesAny()).toBe(false);

        hidden.push("Notes/2025-01-02.md");

        expect(svc.hidesAny()).toBe(true);
    });

    // Nothing runs at midnight: the next change asks (ADR 0011).
    describe("the day's turn", () => {
        beforeEach(() => vi.useFakeTimers({ now: new Date(2025, 0, 2, 12) }));
        afterEach(() => vi.useRealTimers());

        async function built() {
            const { filter } = filterHiding([]);
            const svc = new DailyNoteService(__mockMarkdownFiles, __mockSettings, new ParsedDates(), filter);
            await svc.initialize();
            return svc;
        }

        it("names no note, walking no vault, while the day stands", async () => {
            const svc = await built();
            const walk = vi.spyOn(svc as unknown as { datedNotes: () => unknown }, "datedNotes");

            vi.setSystemTime(new Date(2025, 0, 2, 23, 59));

            expect(svc.catchUpDay()).toEqual([]);
            expect(walk).not.toHaveBeenCalled();
        });

        it("names the day's note before and the one made ahead for the new day, once", async () => {
            const svc = await built();

            vi.setSystemTime(new Date(2025, 0, 3, 0, 30));

            expect(svc.catchUpDay().map((file) => file.path)).toEqual(["Notes/2025-01-02.md", "Notes/2025-01-03.md"]);
            expect(svc.catchUpDay()).toEqual([]);
        });

        it("names nothing after a list built since: it was built for the new day", async () => {
            const svc = await built();

            vi.setSystemTime(new Date(2025, 0, 3, 0, 30));
            await svc.initialize();

            expect(svc.catchUpDay()).toEqual([]);
        });
    });
});
