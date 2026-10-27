import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DailyNotesStreamView } from "../../src/ui/stream-view";
import { Platform, TFile } from "../mocks/obsidian";
import { makeApp, makeViewSetup } from "../stream-view-fixture";

const NOTES = ["Notes/2025-01-03.md", "Notes/2025-01-02.md", "Notes/2025-01-01.md"].map((p) => new TFile(p));
const SOURCES: Record<string, string> = {
    "Notes/2025-01-03.md": "dentist",
    "Notes/2025-01-02.md": "nothing",
    "Notes/2025-01-01.md": "dentist again",
};

describe("DailyNotesStreamView — search", () => {
    let view: DailyNotesStreamView;
    let app: ReturnType<typeof makeApp> & { hotkeyManager?: unknown };

    beforeEach(async () => {
        vi.useFakeTimers();
        // The bar watches its count's width once it opens.
        vi.stubGlobal(
            "ResizeObserver",
            vi.fn(function () {
                return { observe: vi.fn(), disconnect: vi.fn() };
            })
        );
        Platform.isMacOS = true;
        app = makeApp();
        app.vault.cachedRead = vi.fn((file: TFile) => Promise.resolve(SOURCES[file.path]!));
        const setup = await makeViewSetup(app);
        view = setup.view;
        setup.service.getBatch = vi.fn((offset: number, limit: number) => NOTES.slice(offset, offset + limit));
        Object.assign(setup.service, { length: NOTES.length });
        document.body.appendChild(view.containerEl);
    });

    afterEach(() => {
        view.containerEl.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const bar = () => view.containerEl.querySelector<HTMLElement>(".daily-notes-search")!;
    const input = () => bar().querySelector("input")!;
    const count = () => bar().querySelector(".document-search-count")!.textContent;
    /**
     * What the view's scope does with a key press, when Obsidian's keymap asks
     * it.
     */
    const press = (init: KeyboardEventInit) => {
        const handler = view.scope!.registered.find((h) => h.key === null && h.modifiers === null)!;
        return handler.callback(new KeyboardEvent("keydown", init), { key: null, modifiers: null, vkey: "" });
    };
    /**
     * Waits past every delay, and lets the reads and the queue after them
     * finish.
     */
    const settle = () => vi.advanceTimersByTimeAsync(1000);

    // Obsidian's own search is a plain magnifying glass icon, in the phone's
    // navigation bar just under the header.
    it("draws its header action as text with a magnifier, not Obsidian's search icon", () => {
        expect(view.actions.find((a) => a.title === "Search")?.icon).toBe("text-search");
    });

    it("sits above the scrolling notes, not inside them", () => {
        expect(bar().nextElementSibling).toBe(view.contentEl);
    });

    it("opens on Obsidian's search hotkey, and takes the key", () => {
        expect(press({ key: "f", metaKey: true })).toBe(false);

        expect(bar().hasClass("is-closed")).toBe(false);
        expect(document.activeElement).toBe(input());
    });

    it("leaves every other key to Obsidian", () => {
        expect(press({ key: "p", metaKey: true })).toBeUndefined();

        expect(bar().hasClass("is-closed")).toBe(true);
    });

    /**
     * Fires the vault's undocumented "raw" event, as Obsidian saving
     * hotkeys.json would.
     */
    const writeHotkeys = () => {
        for (const [name, callback] of app.vault.on.mock.calls) {
            if (name === "raw") (callback as (p: string) => void)(".obsidian/hotkeys.json");
        }
    };

    it("reads the binding once, not on every key", () => {
        const getHotkeys = vi.fn(() => [{ modifiers: ["Mod"], key: "F" }]);
        app.hotkeyManager = { getHotkeys, getDefaultHotkeys: () => undefined };
        writeHotkeys();

        press({ key: "a" });
        press({ key: "b" });

        expect(getHotkeys).toHaveBeenCalledOnce();
    });

    it("follows a rebind once the vault's config is written", () => {
        app.hotkeyManager = {
            getHotkeys: () => [{ modifiers: ["Mod", "Shift"], key: "S" }],
            getDefaultHotkeys: () => [{ modifiers: ["Mod"], key: "F" }],
        };
        writeHotkeys();

        expect(press({ key: "f", metaKey: true })).toBeUndefined();
        expect(press({ key: "S", metaKey: true, shiftKey: true })).toBe(false);
    });

    it("opens on any of the bindings the search has", () => {
        app.hotkeyManager = {
            getHotkeys: () => [
                { modifiers: ["Mod", "Shift"], key: "S" },
                { modifiers: ["Mod"], key: "F" },
            ],
            getDefaultHotkeys: () => undefined,
        };
        writeHotkeys();

        expect(press({ key: "f", metaKey: true })).toBe(false);
    });

    it("opens from the header, where a phone has no hotkey", () => {
        view.actions.find((a) => a.title === "Search")!.callback(new MouseEvent("click"));

        expect(bar().hasClass("is-closed")).toBe(false);
    });

    it("counts the matching notes as the query is typed", async () => {
        input().value = "dentist";
        input().dispatchEvent(new Event("input"));
        await settle();

        expect(count()).toBe("2 notes");
    });

    /**
     * The stream tells the view its notes changed, as it does once a change is
     * applied.
     */
    const notesChanged = () => view["stream"]["notesChanged"]();

    it("recounts once the stream's notes change under an open search", async () => {
        input().value = "dentist";
        input().dispatchEvent(new Event("input"));
        await settle();
        SOURCES["Notes/2025-01-02.md"] = "dentist";

        try {
            notesChanged();
            await settle();

            expect(count()).toBe("3 notes");
        } finally {
            SOURCES["Notes/2025-01-02.md"] = "nothing";
        }
    });

    it("recounts once the stream's notes stop changing for a while", async () => {
        const refresh = vi.spyOn(view["search"], "refresh");

        notesChanged();
        await vi.advanceTimersByTimeAsync(400);
        notesChanged();
        await vi.advanceTimersByTimeAsync(400);
        expect(refresh).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(100);
        expect(refresh).toHaveBeenCalledOnce();
    });

    it("re-reads nothing for a change outside the daily notes", async () => {
        input().value = "dentist";
        input().dispatchEvent(new Event("input"));
        await settle();
        const reads = app.vault.cachedRead.mock.calls.length;
        const changed = app.metadataCache.on.mock.calls.find(([name]) => name === "changed")![1];

        changed(new TFile("Meeting.md"));
        await settle();

        expect(app.vault.cachedRead.mock.calls.length).toBe(reads);
    });

    it("drops a recount still waiting when the view closes", async () => {
        input().value = "dentist";
        input().dispatchEvent(new Event("input"));
        await settle();
        const reads = app.vault.cachedRead.mock.calls.length;

        notesChanged();
        await view.onClose();
        await settle();

        expect(app.vault.cachedRead.mock.calls.length).toBe(reads);
    });

    it("steps to the next matching note on Enter", async () => {
        const ready = vi.spyOn(view["stream"], "ready").mockResolvedValue(null);
        input().value = "dentist";
        input().dispatchEvent(new Event("input"));

        // Before the typing pause: Enter searches first, then moves to the next
        // match.
        input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        await settle();

        expect(ready).toHaveBeenCalledWith(NOTES[0]);
        // The fake `ready` draws no block, so the match is hidden.
        expect(count()).toBe("1 / 2 · hidden");
    });

    it("steps back on the Previous button", async () => {
        const ready = vi.spyOn(view["stream"], "ready").mockResolvedValue(null);
        input().value = "dentist";
        input().dispatchEvent(new Event("input"));
        await settle();

        bar().querySelector<HTMLElement>('[aria-label="Previous"]')!.click();
        await settle();

        expect(ready).toHaveBeenCalledWith(NOTES[0]);
    });

    it("clears the count when closed", async () => {
        input().value = "dentist";
        input().dispatchEvent(new Event("input"));
        await settle();

        input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await settle();

        expect(count()).toBe("");
    });
});
