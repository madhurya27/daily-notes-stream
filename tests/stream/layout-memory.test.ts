import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    LAYOUT_MEMORY_KEY,
    LayoutMemory,
    SAVED_SIZE_LIMIT,
    SAVE_DELAY_MS,
    layoutOf,
} from "../../src/stream/layout-memory";
import { asApp } from "../stream-view-fixture";

/**
 * `mtimes` stands in for the vault: a note's change time, missing once the note
 * is gone.
 */
function makeApp(saved: unknown = null, mtimes = new Map<string, number>()) {
    return {
        loadLocalStorage: vi.fn((_key: string): unknown => saved),
        saveLocalStorage: vi.fn((_key: string, _value: unknown) => {}),
        vault: {
            getFileByPath: vi.fn((path: string) => {
                const mtime = mtimes.get(path);
                return mtime === undefined ? null : { path, stat: { mtime } };
            }),
        },
    };
}

/** What `NoteHeights` saves: heights by layout, and no mtimes. */
const saved = (heights: unknown[]) => ({ heights, mtimes: [] });

describe("LayoutMemory", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("comes back with the heights a last session saved", () => {
        const app = makeApp({ version: 5, notes: saved([["600:16px", [["a.md", 300]]]]) });
        const memory = new LayoutMemory(asApp(app));

        expect(app.loadLocalStorage).toHaveBeenCalledWith(LAYOUT_MEMORY_KEY);
        expect(memory.notes.heightOf("600:16px", "a.md")).toBe(300);
    });

    it("comes back with what Bases measured in a last session", () => {
        const bases = [["600:16px", [["a.md\nb1", { tooWide: true }]]]];
        const memory = new LayoutMemory(asApp(makeApp({ version: 5, notes: saved([]), bases })));
        expect(memory.bases.isTooWide({ layout: "600:16px", path: "a.md", base: "b1" })).toBe(true);
    });

    // Version 1 used a Base's whole text as its key. Version 2 saved Bases'
    // heights. Version 3 had no templates. Version 4 saved no change times, and
    // saved templates.
    it("starts empty from another version's save", () => {
        const memory = new LayoutMemory(asApp(makeApp({ version: 4, notes: [["600:16px", [["a.md", 300]]]] })));
        expect(memory.notes.toJSON().heights).toEqual([]);
        // Even one that looks like this version's format.
        const shaped = new LayoutMemory(asApp(makeApp({ version: 4, notes: saved([["600:16px", [["a.md", 300]]]]) })));
        expect(shaped.notes.toJSON().heights).toEqual([]);
        expect(memory.bases.toJSON()).toEqual([]);
        expect(new LayoutMemory(asApp(makeApp())).notes.toJSON().heights).toEqual([]);
    });

    // Scrolling measures one note after another, so it saves once a second, not
    // once per note.
    it("saves a burst of changes once, a moment after the first", () => {
        const app = makeApp();
        const memory = new LayoutMemory(asApp(app));
        memory.notes.keep("600:16px", "a.md", 300);
        memory.notes.keep("600:16px", "b.md", 200);
        memory.bases.markTooWide({ layout: "600:16px", path: "a.md", base: "b1" });
        expect(app.saveLocalStorage).not.toHaveBeenCalled();

        vi.advanceTimersByTime(SAVE_DELAY_MS);
        expect(app.saveLocalStorage).toHaveBeenCalledTimes(1);
        expect(app.saveLocalStorage).toHaveBeenCalledWith(LAYOUT_MEMORY_KEY, {
            version: 5,
            notes: saved([
                [
                    "600:16px",
                    [
                        ["a.md", 300],
                        ["b.md", 200],
                    ],
                ],
            ]),
            bases: [["600:16px", [["a.md\nb1", { tooWide: true }]]]],
        });
    });

    it("saves what Bases measured, on its own", () => {
        const app = makeApp();
        const memory = new LayoutMemory(asApp(app));

        memory.bases.markTooWide({ layout: "600:16px", path: "a.md", base: "b1" });
        vi.advanceTimersByTime(SAVE_DELAY_MS);

        expect(app.saveLocalStorage).toHaveBeenCalledOnce();
    });

    describe("past its size limit", () => {
        /** What was last saved, and its size as localStorage holds it. */
        const lastSaved = (app: ReturnType<typeof makeApp>) => app.saveLocalStorage.mock.lastCall![1];
        const savedSize = (app: ReturnType<typeof makeApp>) => JSON.stringify(lastSaved(app)).length;

        /** A size that fits what `fill` saved, less `over` characters. */
        function limitBelow(fill: (memory: LayoutMemory) => void, mtimes: Map<string, number>, over = 1): number {
            const memory = new LayoutMemory(asApp(makeApp(null, mtimes)));
            fill(memory);
            return memory.savedSize() - over;
        }

        it("saves everything that exactly fits", () => {
            const mtimes = new Map([["a.md", 1]]);
            const fill = (memory: LayoutMemory) => memory.notes.keep("600:16px", "a.md", 300);
            const app = makeApp(null, mtimes);
            const memory = new LayoutMemory(asApp(app), limitBelow(fill, mtimes, 0));

            fill(memory);
            memory.flush();

            expect(memory.notes.heightOf("600:16px", "a.md")).toBe(300);
        });

        it("forgets the layout used longest ago first", () => {
            const mtimes = new Map([["a.md", 1]]);
            const fill = (memory: LayoutMemory) => {
                memory.notes.keep("old", "a.md", 100);
                memory.bases.markTooWide({ layout: "old", path: "a.md", base: "b1" });
                memory.notes.keep("now", "a.md", 300);
                memory.bases.markTooWide({ layout: "now", path: "a.md", base: "b1" });
            };
            const app = makeApp(null, mtimes);
            const memory = new LayoutMemory(asApp(app), limitBelow(fill, mtimes));

            fill(memory);
            memory.flush();

            expect(memory.notes.heightOf("old", "a.md")).toBeUndefined();
            expect(memory.bases.toJSON().map(([layout]) => layout)).toEqual(["now"]);
            expect(memory.notes.heightOf("now", "a.md")).toBe(300);
        });

        // Daily notes are mostly changed on their own day, so the notes changed
        // longest ago are the ones furthest from where people read.
        it("in its last layout, forgets the notes changed longest ago, and their Bases", () => {
            const paths = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, "0")}.md`);
            const mtimes = new Map(paths.map((path, i) => [path, 100 - i]));
            const fill = (memory: LayoutMemory) => {
                for (const path of paths) {
                    memory.notes.keep("now", path, 300);
                    memory.bases.markTooWide({ layout: "now", path, base: `${path}-base` });
                }
            };
            const app = makeApp(null, mtimes);
            const memory = new LayoutMemory(asApp(app), limitBelow(fill, mtimes));

            fill(memory);
            memory.flush();

            expect(memory.notes.entries("now").map(([path]) => path)).toEqual(paths.slice(0, 18));
            expect(memory.bases.isTooWide({ layout: "now", path: "x", base: "17.md-base" })).toBe(true);
            expect(memory.bases.isTooWide({ layout: "now", path: "x", base: "18.md-base" })).toBe(false);
        });

        // Building the string to measure it takes 35 times as long, every save.
        it("counts its size to within 5% of what is saved, without going under", () => {
            const paths = Array.from({ length: 500 }, (_, i) => `Journal/2026/2026-10-${i}.md`);
            const mtimes = new Map(paths.map((path) => [path, 1793318400000]));
            const app = makeApp(null, mtimes);
            const memory = new LayoutMemory(asApp(app));
            for (const path of paths) {
                memory.notes.keep("402:16px", path, 412.515625);
                memory.bases.markTooWide({ layout: "402:16px", path, base: `${path}-base` });
            }

            memory.flush();

            expect(memory.savedSize()).toBeGreaterThanOrEqual(savedSize(app));
            expect(memory.savedSize()).toBeLessThan(savedSize(app) * 1.05);
        });

        it("holds 600,000 characters at most, however large the vault", () => {
            const paths = Array.from({ length: 12000 }, (_, i) => `Journal/${i}.md`);
            const mtimes = new Map(paths.map((path, i) => [path, i]));
            const app = makeApp(null, mtimes);
            const memory = new LayoutMemory(asApp(app));
            for (const path of paths) memory.notes.keep("now", path, 412.515625);

            memory.flush();

            expect(SAVED_SIZE_LIMIT).toBe(600_000);
            expect(savedSize(app)).toBeLessThanOrEqual(SAVED_SIZE_LIMIT);
            expect(memory.notes.heightOf("now", "Journal/11999.md")).toBe(412.515625);
        });
    });

    it("forgets a deleted note's heights and what its Bases measured", () => {
        const memory = new LayoutMemory(asApp(makeApp()));
        for (const path of ["gone.md", "kept.md"]) {
            memory.notes.keep("600:16px", path, 300);
            memory.bases.markTooWide({ layout: "600:16px", path, base: `${path}-base` });
        }

        memory.forget("gone.md");

        expect(memory.notes.toJSON().heights).toEqual([["600:16px", [["kept.md", 300]]]]);
        expect(memory.bases.toJSON()).toEqual([["600:16px", [["kept.md\nkept.md-base", { tooWide: true }]]]]);
    });

    it("carries a note's measurements across a rename, and forgets a deleted note's", () => {
        const memory = new LayoutMemory(asApp(makeApp()));
        const base = (path: string) => ({ layout: "600:16px", path, base: `${path}-base` });
        for (const path of ["old.md", "gone.md", "stale.md"]) {
            memory.notes.keep("600:16px", path, 300);
            memory.bases.markTooWide(base(path));
        }

        memory.rename("old.md", "new.md");
        memory.forget("gone.md");
        memory.retainOnly(new Set(["new.md"]));

        expect(memory.notes.toJSON().heights).toEqual([["600:16px", [["new.md", 300]]]]);
        expect(memory.bases.toJSON()).toEqual([["600:16px", [["new.md\nold.md-base", { tooWide: true }]]]]);
    });

    // Edited while the plugin was off, or on another device, so it is estimated
    // from its text again (ADR 0017).
    it("forgets a note changed since it was measured, by the vault's mtimes", () => {
        const mtimes = new Map([
            ["a.md", 1],
            ["b.md", 1],
        ]);
        const memory = new LayoutMemory(asApp(makeApp(null, mtimes)));
        memory.notes.keep("600:16px", "a.md", 300);
        memory.notes.keep("600:16px", "b.md", 200);
        mtimes.set("a.md", 2);

        memory.retainOnly(new Set(mtimes.keys()));

        expect(memory.notes.heightOf("600:16px", "a.md")).toBeUndefined();
        expect(memory.notes.heightOf("600:16px", "b.md")).toBe(200);
    });

    it("forgets everything it measured, and saves that", () => {
        const app = makeApp();
        const memory = new LayoutMemory(asApp(app));
        const base = { layout: "600:16px", path: "a.md", base: "b1" };
        memory.notes.keep("600:16px", "a.md", 300);
        memory.bases.markTooWide(base);
        vi.advanceTimersByTime(SAVE_DELAY_MS);

        memory.forgetAll();
        vi.advanceTimersByTime(SAVE_DELAY_MS);

        expect(memory.notes.heightOf("600:16px", "a.md")).toBeUndefined();
        expect(memory.bases.isTooWide(base)).toBe(false);
        expect(app.saveLocalStorage).toHaveBeenCalledTimes(2);
        const saved = new LayoutMemory(asApp(makeApp(app.saveLocalStorage.mock.lastCall![1])));
        expect(saved.notes.heightOf("600:16px", "a.md")).toBeUndefined();
    });

    // localStorage holds a few megabytes, shared by every vault in the app.
    it("logs a save refused, once, and keeps measuring", () => {
        const app = makeApp();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        app.saveLocalStorage.mockImplementation(() => {
            throw new DOMException("full", "QuotaExceededError");
        });
        const memory = new LayoutMemory(asApp(app));

        memory.notes.keep("600:16px", "a.md", 300);
        expect(() => memory.flush()).not.toThrow();
        memory.notes.keep("600:16px", "b.md", 300);
        memory.flush();

        expect(app.saveLocalStorage).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledWith("DailyNotesStream: Failed to save layout memory", expect.any(DOMException));
        expect(memory.notes.heightOf("600:16px", "b.md")).toBe(300);
        error.mockRestore();
    });

    it("saves what is pending at once when the plugin unloads", () => {
        const app = makeApp();
        const memory = new LayoutMemory(asApp(app));
        memory.flush();
        expect(app.saveLocalStorage).not.toHaveBeenCalled();

        memory.notes.keep("600:16px", "a.md", 300);
        memory.flush();
        expect(app.saveLocalStorage).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(SAVE_DELAY_MS);
        expect(app.saveLocalStorage).toHaveBeenCalledTimes(1);
    });
});

describe("layoutOf", () => {
    // Obsidian's font size and line width both affect the column's width or
    // text size. On a phone, so does iOS's text size setting.
    it("names a layout by the stream column's width and the text size notes are drawn at", () => {
        const column = document.createElement("div");
        Object.defineProperty(column, "clientWidth", { value: 612 });
        column.style.setProperty("--font-preferred-size", " calc(16px * 1.25)");
        document.body.appendChild(column);

        expect(layoutOf(column)).toBe("612:calc(16px * 1.25)");
        // A Base asks about the width it is checked against.
        expect(layoutOf(column, 500)).toBe("500:calc(16px * 1.25)");
        column.remove();
    });
});
