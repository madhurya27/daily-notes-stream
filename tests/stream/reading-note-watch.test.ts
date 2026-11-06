import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TFile } from "obsidian";
import { ReadingNoteWatch } from "../../src/stream/reading-note-watch";
import { SCROLL_IDLE_MS } from "../../src/stream/scroll-anchor";
import { ViewTimers } from "../../src/stream/view-timers";

describe("ReadingNoteWatch", () => {
    const a = new TFile("Notes/2026-03-12.md");
    const b = new TFile("Notes/2026-03-11.md");
    let under: TFile | null;
    let reports: [path: string, scrolling: boolean][];
    let watch: ReadingNoteWatch;

    beforeEach(() => {
        vi.useFakeTimers();
        under = a;
        reports = [];
        watch = new ReadingNoteWatch(
            () => under,
            (note, scrolling) => reports.push([note.path, scrolling]),
            new ViewTimers()
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("reports a new note under the line at once, while scrolling", () => {
        watch.onScroll();
        under = b;
        watch.onScroll();

        expect(reports).toEqual([
            [a.path, true],
            [b.path, true],
        ]);
    });

    it("reports nothing more while the same note stays under the line", () => {
        watch.onScroll();
        watch.onScroll();

        expect(reports).toEqual([[a.path, true]]);
    });

    it("reports the note again once scrolling has stopped, and only then", () => {
        watch.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
        watch.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
        expect(reports).toEqual([[a.path, true]]);

        vi.advanceTimersByTime(1);
        expect(reports).toEqual([
            [a.path, true],
            [a.path, false],
        ]);
    });

    it("reports nothing when scrolling stops on the note it last stopped on", () => {
        watch.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        watch.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(reports).toEqual([
            [a.path, true],
            [a.path, false],
        ]);
    });

    it("reports when scrolling stops on a note that changed after the last scroll", () => {
        watch.onScroll();
        under = b;
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(reports).toEqual([
            [a.path, true],
            [b.path, false],
        ]);
    });

    it("announces the same note again, once things are still, when asked", () => {
        watch.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        watch.announceSoon();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(reports).toEqual([
            [a.path, true],
            [a.path, false],
            [a.path, false],
        ]);
    });

    it("reports nothing while no note is under the line", () => {
        under = null;
        watch.onScroll();
        watch.announceSoon();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(reports).toEqual([]);
    });
});
