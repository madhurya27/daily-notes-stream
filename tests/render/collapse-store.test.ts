import { describe, it, expect, beforeEach, vi } from "vitest";
import { COLLAPSE_STATE_KEY, CollapsibleStateStore, isOldCollapseKey } from "../../src/render/collapse-store";
import { asApp } from "../stream-view-fixture";

function makeApp() {
    const storage = new Map<string, unknown>();
    return {
        loadLocalStorage: vi.fn((key: string) => storage.get(key) ?? null),
        saveLocalStorage: vi.fn((key: string, value: unknown) => {
            if (value === null) storage.delete(key);
            else storage.set(key, value);
        }),
    };
}

describe("CollapsibleStateStore", () => {
    let app: ReturnType<typeof makeApp>;
    let store: CollapsibleStateStore;

    beforeEach(() => {
        app = makeApp();
        store = new CollapsibleStateStore(asApp(app));
    });

    const saved = (): unknown => app.loadLocalStorage(COLLAPSE_STATE_KEY);

    it("isCollapsed returns false when key not set", () => {
        expect(store.isCollapsed("file.md", "heading-1")).toBe(false);
    });

    it("setCollapsed(true) persists state and isCollapsed returns true", () => {
        store.setCollapsed("file.md", "heading-1", true);
        expect(store.isCollapsed("file.md", "heading-1")).toBe(true);
    });

    it("setCollapsed(false) removes the key and isCollapsed returns false", () => {
        store.setCollapsed("file.md", "heading-1", true);
        store.setCollapsed("file.md", "heading-1", false);
        expect(store.isCollapsed("file.md", "heading-1")).toBe(false);
    });

    it("collapsedOr returns the fallback when the section has no saved state", () => {
        expect(store.collapsedOr("file.md", "properties", true)).toBe(true);
        expect(store.collapsedOr("file.md", "properties", false)).toBe(false);
    });

    it("collapsedOr prefers a saved expanded state over a collapsed fallback", () => {
        store.setCollapsed("file.md", "properties", false);

        expect(store.collapsedOr("file.md", "properties", true)).toBe(false);
    });

    describe("retainSections", () => {
        it("forgets the sections not kept, and keeps the rest", () => {
            store.setCollapsed("file.md", "meeting", true);
            store.setCollapsed("file.md", "old-heading", false);

            store.retainSections("file.md", new Set(["meeting"]));

            expect(store.isCollapsed("file.md", "meeting")).toBe(true);
            expect(store.collapsedOr("file.md", "old-heading", true)).toBe(true);
        });

        it("drops the note once no section is left", () => {
            store.setCollapsed("file.md", "old-heading", true);

            store.retainSections("file.md", new Set());

            expect(saved()).toEqual({ version: 1, files: [] });
        });

        it("writes nothing when every stored section is kept", () => {
            store.setCollapsed("file.md", "meeting", true);
            app.saveLocalStorage.mockClear();

            store.retainSections("file.md", new Set(["meeting", "unstored"]));

            expect(app.saveLocalStorage).not.toHaveBeenCalled();
        });

        it("writes nothing for a note with no saved sections", () => {
            store.retainSections("file.md", new Set());

            expect(app.saveLocalStorage).not.toHaveBeenCalled();
        });

        it("leaves other files alone", () => {
            store.setCollapsed("other.md", "old-heading", true);

            store.retainSections("file.md", new Set());

            expect(store.isCollapsed("other.md", "old-heading")).toBe(true);
        });
    });

    describe("retainOnly", () => {
        // A note deleted while the plugin was off, or on another device, was
        // never seen.
        it("forgets every note not in the vault", () => {
            store.setCollapsed("kept.md", "intro", true);
            store.setCollapsed("gone.md", "intro", true);

            store.retainOnly(new Set(["kept.md", "unstored.md"]));

            expect(store.isCollapsed("kept.md", "intro")).toBe(true);
            expect(saved()).toEqual({ version: 1, files: [["kept.md", [["intro", true]]]] });
        });

        it("writes nothing when every stored note is kept", () => {
            store.setCollapsed("kept.md", "intro", true);
            app.saveLocalStorage.mockClear();

            store.retainOnly(new Set(["kept.md"]));

            expect(app.saveLocalStorage).not.toHaveBeenCalled();
        });
    });

    it("forgetAll forgets every note's sections, and the key that held them", () => {
        store.setCollapsed("a.md", "intro", true);
        store.setCollapsed("b.md", "properties", false);

        store.forgetAll();

        expect(store.isCollapsed("a.md", "intro")).toBe(false);
        expect(store.collapsedOr("b.md", "properties", true)).toBe(true);
        expect(saved()).toBeNull();
    });

    it("clearForFile removes all entries for that file", () => {
        store.setCollapsed("file.md", "heading-1", true);
        store.setCollapsed("file.md", "heading-2", true);
        store.clearForFile("file.md");
        expect(store.isCollapsed("file.md", "heading-1")).toBe(false);
        expect(store.isCollapsed("file.md", "heading-2")).toBe(false);
    });

    it("clearForFile does not affect other files", () => {
        store.setCollapsed("file-a.md", "heading-1", true);
        store.setCollapsed("file-b.md", "heading-1", true);
        store.clearForFile("file-a.md");
        expect(store.isCollapsed("file-b.md", "heading-1")).toBe(true);
    });

    it("clearForFile is safe when no entries exist", () => {
        expect(() => store.clearForFile("nonexistent.md")).not.toThrow();
    });

    it("migrate moves every collapsed section to the new path", () => {
        store.setCollapsed("old.md", "heading-1", true);
        store.setCollapsed("old.md", "heading-2", true);

        store.migrate("old.md", "new.md");

        expect(store.isCollapsed("new.md", "heading-1")).toBe(true);
        expect(store.isCollapsed("new.md", "heading-2")).toBe(true);
        expect(store.isCollapsed("old.md", "heading-1")).toBe(false);
        expect(store.isCollapsed("old.md", "heading-2")).toBe(false);
    });

    it("migrate leaves the new path for a later clearForFile to clean up", () => {
        store.setCollapsed("old.md", "heading-1", true);

        store.migrate("old.md", "new.md");
        store.clearForFile("new.md");

        expect(store.isCollapsed("new.md", "heading-1")).toBe(false);
    });

    it("migrate carries an explicitly expanded section over", () => {
        store.setCollapsed("old.md", "properties", false);

        store.migrate("old.md", "new.md");

        expect(store.collapsedOr("new.md", "properties", true)).toBe(false);
    });

    it("migrate is safe when the file has no collapsed sections", () => {
        expect(() => store.migrate("old.md", "new.md")).not.toThrow();
    });

    it("writes nothing when a section's state is unchanged", () => {
        store.setCollapsed("file.md", "heading-1", true);
        app.saveLocalStorage.mockClear();

        store.setCollapsed("file.md", "heading-1", true);

        expect(app.saveLocalStorage).not.toHaveBeenCalled();
    });

    it("clearForFile also drops explicitly expanded sections", () => {
        store.setCollapsed("file.md", "key-a", false);

        store.clearForFile("file.md");

        expect(store.collapsedOr("file.md", "key-a", true)).toBe(true);
    });

    it("saves every note's sections under one key of the plugin's own", () => {
        store.setCollapsed("notes/2025-01-01.md", "intro", true);
        store.setCollapsed("notes/2025-01-01.md", "properties", false);

        expect(app.saveLocalStorage.mock.calls.every(([key]) => key === COLLAPSE_STATE_KEY)).toBe(true);
        expect(COLLAPSE_STATE_KEY).toMatch(/^daily-notes-stream:/);
        expect(saved()).toEqual({
            version: 1,
            files: [
                [
                    "notes/2025-01-01.md",
                    [
                        ["intro", true],
                        ["properties", false],
                    ],
                ],
            ],
        });
    });

    it("restores what the last session saved", () => {
        store.setCollapsed("file.md", "intro", true);
        store.setCollapsed("file.md", "properties", false);

        const next = new CollapsibleStateStore(asApp(app));

        expect(next.isCollapsed("file.md", "intro")).toBe(true);
        expect(next.collapsedOr("file.md", "properties", true)).toBe(false);
    });

    // Each heading asks every time a note is drawn, so reading and parsing on
    // every lookup added up.
    it("reads storage once, not per lookup", () => {
        store.isCollapsed("file.md", "a");
        store.collapsedOr("file.md", "b", true);
        store.isCollapsed("other.md", "a");

        expect(app.loadLocalStorage).toHaveBeenCalledOnce();
    });

    it.each([
        ["nothing", null],
        ["another version", { version: 2, files: [["file.md", [["intro", true]]]] }],
        ["no list of files", { version: 1, files: "bad" }],
        ["a malformed note", { version: 1, files: [["file.md", "bad"]] }],
        ["a non-boolean state", { version: 1, files: [["file.md", [["intro", "yes"]]]] }],
        ["a note that is no pair", { version: 1, files: [["file.md", [["intro", true]]], "file.md"] }],
        [
            "a note under no path",
            {
                version: 1,
                files: [
                    ["file.md", [["intro", true]]],
                    [1, []],
                ],
            },
        ],
        ["a state that is no pair", { version: 1, files: [["file.md", [["intro", true], "outro"]]] }],
        [
            "a state under no key",
            {
                version: 1,
                files: [
                    [
                        "file.md",
                        [
                            ["intro", true],
                            [1, true],
                        ],
                    ],
                ],
            },
        ],
    ])("starts empty from %s stored", (_, value) => {
        app.saveLocalStorage(COLLAPSE_STATE_KEY, value);

        const next = new CollapsibleStateStore(asApp(app));

        expect(next.collapsedOr("file.md", "intro", false)).toBe(false);
    });

    it("logs a refused save once, and throws from none", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        store.setCollapsed("file.md", "heading-1", true);
        app.saveLocalStorage.mockImplementation(() => {
            throw new DOMException("full", "QuotaExceededError");
        });

        expect(() => store.setCollapsed("file.md", "heading-2", true)).not.toThrow();
        expect(() => store.retainSections("file.md", new Set())).not.toThrow();
        expect(() => store.retainOnly(new Set())).not.toThrow();
        expect(() => store.clearForFile("file.md")).not.toThrow();
        expect(() => store.migrate("file.md", "moved.md")).not.toThrow();

        expect(error).toHaveBeenCalledExactlyOnceWith(
            "DailyNotesStream: Failed to save collapse state",
            expect.any(DOMException)
        );
        error.mockRestore();
    });

    it("saves a migration and a clear for the next session", () => {
        store.setCollapsed("file.md", "intro", true);
        store.setCollapsed("other.md", "intro", true);

        store.migrate("file.md", "moved.md");
        const migrated = new CollapsibleStateStore(asApp(app));
        store.clearForFile("other.md");
        const cleared = new CollapsibleStateStore(asApp(app));

        expect(migrated.isCollapsed("moved.md", "intro")).toBe(true);
        expect(migrated.isCollapsed("file.md", "intro")).toBe(false);
        expect(cleared.isCollapsed("other.md", "intro")).toBe(false);
    });

    it("multiple files maintain independent state", () => {
        store.setCollapsed("a.md", "section", true);
        store.setCollapsed("b.md", "section", true);
        store.clearForFile("a.md");
        expect(store.isCollapsed("a.md", "section")).toBe(false);
        expect(store.isCollapsed("b.md", "section")).toBe(true);
    });
});

describe("isOldCollapseKey", () => {
    it.each([
        ["collapse:Notes/2025-01-01.md:intro", true],
        ["collapse:Notes/a: b.md:li-0-milk", true],
        ["collapse-idx:Notes/2025-01-01.md", true],
        ["daily-notes-stream:collapse", false],
        ["collapse:sidebar", false],
        ["collapse-idx:sidebar", false],
        ["other-collapse:Notes/a.md:intro", false],
    ])("%s is %s", (name, old) => {
        expect(isOldCollapseKey(name)).toBe(old);
    });
});
