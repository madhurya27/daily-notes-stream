import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileView, TFile } from "../mocks/obsidian";
import { makeApp, makeViewSetup } from "../stream-view-fixture";
import { SCROLL_IDLE_MS } from "../../src/stream/scroll-anchor";
import type { ReadingNote } from "../../src/stream/reading-notes";
import { moment } from "../../src/notes/moment";

// When the watch reports is tested in reading-note-watch.test.ts. This tests
// what the view connects to it (ADR 0024).
describe("DailyNotesStreamView — the note being read", () => {
    const note = new TFile("Notes/2026-03-11.md");

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    async function openView() {
        const app = makeApp();
        const setup = await makeViewSetup(app);
        const { view, plugin } = setup;
        vi.spyOn(view["stream"], "readingNote").mockReturnValue(note);
        const heard: ReadingNote[] = [];
        plugin.readingNotes.subscribe((r) => heard.push(r));
        const on = (name: string) =>
            [...app.workspace.on.mock.calls, ...app.vault.on.mock.calls].find(([n]) => n === name)![1];
        return { view, heard, on, service: setup.service };
    }

    it("is a file view that has no file, so Obsidian sees no open file (D-029)", async () => {
        const { view } = await openView();

        expect(view).toBeInstanceOf(FileView);
        expect(view.allowNoFile).toBe(true);
        expect(view.file).toBeNull();
    });

    it("keeps no file in its state, so Back and the layout reopen the stream", async () => {
        const { view } = await openView();

        expect(view.getState()).not.toHaveProperty("file");
    });

    it("reports the note under the line as the stream scrolls", async () => {
        const { view, heard } = await openView();

        view.contentEl.dispatchEvent(new Event("scroll"));

        expect(heard).toEqual([{ view, note, date: null, scrolling: true }]);
    });

    it("reports the note's date, read with the vault's own format", async () => {
        const { view, heard, service } = await openView();
        const date = moment("2026-03-11", "YYYY-MM-DD", true);
        vi.mocked(service.parseNoteDate).mockImplementation((text) => (text === "2026-03-11" ? date : null));

        view.contentEl.dispatchEvent(new Event("scroll"));

        expect(heard[0]!.date).toBe(date);
    });

    it("announces the note once it has opened", async () => {
        const { view, heard } = await openView();

        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(heard).toEqual([{ view, note, date: null, scrolling: false }]);
    });

    it("announces the note again when its tab becomes active, and not for another tab", async () => {
        const { view, heard, on } = await openView();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        on("active-leaf-change")({});
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        expect(heard).toHaveLength(1);

        on("active-leaf-change")(view.leaf);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        expect(heard).toHaveLength(2);
    });

    it.each(["delete", "rename"])("announces the note again after a %s", async (event) => {
        const { heard, on } = await openView();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        on(event)(note, "Notes/old.md");
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(heard).toHaveLength(2);
    });

    it("announces the note again after a refresh", async () => {
        const { view, heard } = await openView();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        vi.spyOn(view["stream"], "refresh").mockResolvedValue();

        await view.refresh();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(heard).toHaveLength(2);
    });
});
