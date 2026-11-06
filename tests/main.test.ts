import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import DailyNotesStreamPlugin from "../src/main";
import { DailyNotesStreamView, VIEW_TYPE_DAILY_NOTES_STREAM } from "../src/ui/stream-view";
import { EMPTY_NOTES_KEY } from "../src/notes/empty-notes";
import { DEFAULT_SETTINGS } from "../src/settings";
import { COLLAPSE_STATE_KEY, CollapsibleStateStore } from "../src/render/collapse-store";
import { BaseMeasurements } from "../src/render/bases/base-measurements";
import { LAYOUT_MEMORY_KEY, LayoutMemory } from "../src/stream/layout-memory";
import {
    Menu,
    Notice,
    TFile,
    WorkspaceLeaf,
    moment,
    type FileView,
    type MarkdownPostProcessorContext,
    type PluginManifest,
    type WorkspaceLeaf as Leaf,
} from "./mocks/obsidian";
import { asApp, fake, makeService } from "./stream-view-fixture";
import { __mockSettings, __mockMarkdownFiles, __setMockNotes, __setMockSettings } from "./mocks/daily-notes";

function makeApp() {
    return {
        internalPlugins: { getPluginById: () => ({ instance: { options: __mockSettings() } }) },
        vault: {
            on: vi.fn().mockReturnValue({}),
            cachedRead: vi.fn().mockResolvedValue(""),
            getMarkdownFiles: __mockMarkdownFiles,
            getFileByPath: (path: string) => __mockMarkdownFiles().find((file) => file.path === path) ?? null,
        },
        workspace: {
            on: vi.fn().mockReturnValue({}),
            offref: vi.fn(),
            getLeavesOfType: vi.fn().mockReturnValue([]),
            getLeaf: vi.fn(),
            getMostRecentLeaf: vi.fn().mockReturnValue(null),
            getActiveFile: vi.fn().mockReturnValue(null),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
            setActiveLeaf: vi.fn(),
            onLayoutReady: vi.fn((callback: () => unknown) => void callback()),
        },
        metadataCache: {
            on: vi.fn().mockReturnValue({}),
            getFileCache: vi.fn().mockReturnValue(null),
            getCache: vi.fn().mockReturnValue(null),
            getFirstLinkpathDest: vi.fn().mockReturnValue(null),
            resolvedLinks: {} as Record<string, Record<string, number>>,
        },
        loadLocalStorage: vi.fn().mockReturnValue(null),
        saveLocalStorage: vi.fn(),
    };
}

/** Every callback onload() gave `source.on(name)`. */
function handlers(source: { on: { mock: { calls: unknown[][] } } }, name: string) {
    return source.on.mock.calls
        .filter(([event]) => event === name)
        .map(([, callback]) => callback as (...args: unknown[]) => void);
}

/**
 * Calls every callback that onload() gave `source.on` for `name`, as Obsidian
 * does.
 */
function fire(source: { on: { mock: { calls: unknown[][] } } }, name: string, ...args: unknown[]): void {
    for (const handler of handlers(source, name)) handler(...args);
}

/** A leaf that records the view state it was asked to open. */
function makeLeaf(app: ReturnType<typeof makeApp>) {
    return { app, setViewState: vi.fn().mockResolvedValue(undefined) };
}

async function loadPlugin(data: unknown = null) {
    const app = makeApp();
    const plugin = new DailyNotesStreamPlugin(asApp(app), { id: "daily-notes-stream" } as PluginManifest);
    plugin.data = data;
    // Obsidian marks a plugin as loaded before onload runs, so it even unloads
    // one whose onload failed.
    plugin.load();
    await plugin.onload();
    return { plugin, app };
}

/**
 * A leaf whose view is not the stream, for callers that only need a leaf back.
 */
const leafWithoutStream = { view: {} } as unknown as Leaf;

/**
 * Runs waiting microtasks, so the .catch() on a promise nobody waits for runs.
 */
function flushPromises(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
    __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
    __setMockNotes([]);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("DailyNotesStreamPlugin — onload", () => {
    it("falls back to defaults when no settings are saved", async () => {
        const { plugin } = await loadPlugin(null);
        expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it("merges saved settings over the defaults", async () => {
        const { plugin } = await loadPlugin({ showProperties: true });
        expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, showProperties: true });
    });

    it("registers a view factory that builds a stream view", async () => {
        const { plugin, app } = await loadPlugin();

        const factory = plugin.views[VIEW_TYPE_DAILY_NOTES_STREAM]!;
        const view = factory(new WorkspaceLeaf(asApp(app)));

        expect(view).toBeInstanceOf(DailyNotesStreamView);
    });

    // Each view still has its own service (.claude/rules/invariants.md). Only
    // the dates read from file names are shared, so opening a second view reads
    // no date it has already read.
    it("hands every view one date cache, so a later open parses no name again", async () => {
        __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md"]);
        const { plugin, app } = await loadPlugin();
        const open = () => {
            const view = plugin.views[VIEW_TYPE_DAILY_NOTES_STREAM]!(new WorkspaceLeaf(asApp(app)));
            return (view as DailyNotesStreamView)["service"].initialize();
        };
        await open();
        let reads = 0;
        for (const file of __mockMarkdownFiles()) {
            const { basename } = file;
            Object.defineProperty(file, "basename", { get: () => (reads++, basename) });
        }

        await open();

        expect(reads).toBe(0);
    });

    it("lists the stream in Page preview's settings, previewing on Mod+hover like Obsidian's views", async () => {
        const { plugin } = await loadPlugin();

        expect(plugin.hoverLinkSources[VIEW_TYPE_DAILY_NOTES_STREAM]).toEqual({
            display: "Daily Notes Stream",
            defaultMod: true,
        });
    });

    it("registers the ribbon icon, command and settings tab", async () => {
        const { plugin } = await loadPlugin();

        expect(plugin.ribbonIcons.map(({ icon, title }) => ({ icon, title }))).toEqual([
            { icon: "gallery-vertical-end", title: "Open daily notes stream" },
        ]);
        expect(plugin.commands.map((c) => c.id)).toEqual([
            "open-stream",
            "jump-to-date",
            "show-in-stream",
            "scroll-to-top",
        ]);
        // The README tells readers to run these commands by these names.
        expect(plugin.commands.map((c) => c.name)).toEqual([
            "Open stream",
            "Jump to date",
            "Show in stream",
            "Scroll to top",
        ]);
        // The same icons as the ribbon and the view's header buttons.
        expect(plugin.commands.map((c) => c.icon)).toEqual([
            "gallery-vertical-end",
            "calendar-1",
            "gallery-vertical-end",
            "arrow-up-to-line",
        ]);
        expect(plugin.settingTabs).toHaveLength(1);
    });

    it("builds a collapse store bound to the app", async () => {
        const { plugin } = await loadPlugin();
        expect(plugin.collapseStore).toBeInstanceOf(CollapsibleStateStore);
    });

    it("keeps what Bases measured for every view", async () => {
        const { plugin } = await loadPlugin();
        expect(plugin.layoutMemory.bases).toBeInstanceOf(BaseMeasurements);
    });

    it("keeps one backlink index for every view, inverted from the cache's resolved links", async () => {
        const { plugin, app } = await loadPlugin();
        Object.assign(app.metadataCache, { resolvedLinks: { "Notes/a.md": { "Notes/2025-01-01.md": 1 } } });

        expect(plugin.backlinks.sourcesOf("Notes/2025-01-01.md")).toEqual(["Notes/a.md"]);
    });

    it("inverts the links afresh once the cache has resolved again", async () => {
        const { plugin, app } = await loadPlugin();
        const invalidate = vi.spyOn(plugin.backlinks, "invalidate");
        const resolved = app.metadataCache.on.mock.calls.find(([event]) => event === "resolved")![1] as () => void;

        resolved();

        expect(invalidate).toHaveBeenCalledOnce();
    });
});

describe("DailyNotesStreamPlugin — math", () => {
    afterEach(() => {
        delete (window as unknown as { MathJax?: unknown }).MathJax;
    });

    /**
     * Runs every post-processor onload() registered, lowest sort order first,
     * on `html` inside `parent`, as Obsidian does, and returns the section.
     */
    async function process(parentClass: string, html: string): Promise<HTMLElement> {
        const sheet = document.createElement("div");
        (window as unknown as { MathJax?: unknown }).MathJax = { chtmlStylesheet: () => sheet, tex2chtml: () => null };
        const { plugin } = await loadPlugin();
        const parent = document.body.createDiv({ cls: parentClass });
        const section = parent.createDiv();
        section.innerHTML = html;
        for (const processor of plugin.postProcessors) void processor(section, {} as MarkdownPostProcessorContext);
        parent.remove();
        sheet.remove();
        return section;
    }

    it("draws math in a stream note before Obsidian's own step, which runs at 0", async () => {
        const { plugin } = await loadPlugin();
        expect(plugin.postProcessors.map((processor) => processor.sortOrder! < 0)).toEqual([true]);

        const section = await process("daily-note-content", '<span class="math">x</span>');

        expect(section.querySelector(".math")!.classList.contains("is-loaded")).toBe(true);
    });

    it("leaves math in Obsidian's own views alone", async () => {
        const section = await process("markdown-preview-view", '<span class="math">x</span>');

        expect(section.querySelector(".math")!.classList.contains("is-loaded")).toBe(false);
    });
});

describe("DailyNotesStreamPlugin — empty notes", () => {
    const HIDING = { hideEmptyNotes: true };

    /** The daily notes a newly opened view lists. */
    async function listed(plugin: DailyNotesStreamPlugin, app: ReturnType<typeof makeApp>) {
        const view = plugin.views[VIEW_TYPE_DAILY_NOTES_STREAM]!(new WorkspaceLeaf(asApp(app)));
        const service = (view as DailyNotesStreamView)["service"];
        await service.initialize();
        return service.getBatch(0, service.length).map((file) => file.path);
    }

    beforeEach(() => __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md"]));

    it("leaves out of every view a daily note holding only its template", async () => {
        const { plugin, app } = await loadPlugin(HIDING);
        app.vault.cachedRead.mockImplementation((file: TFile) =>
            Promise.resolve(file.path === "Notes/2025-01-02.md" ? "Written." : "")
        );

        expect(await listed(plugin, app)).toEqual(["Notes/2025-01-02.md"]);
        expect(await listed(plugin, app)).toEqual(["Notes/2025-01-02.md"]);
        expect(app.vault.cachedRead).toHaveBeenCalledTimes(2);
    });

    it("finds the template as the daily-notes plugin does", async () => {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes", template: "Templates/Daily" });
        const { plugin, app } = await loadPlugin(HIDING);

        await listed(plugin, app);

        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Templates/Daily", "");
    });

    it("keeps an empty note another note links to, for its linked mentions", async () => {
        const { plugin, app } = await loadPlugin(HIDING);
        app.metadataCache.resolvedLinks = { "Meeting.md": { "Notes/2025-01-01.md": 1 } };

        expect(await listed(plugin, app)).toEqual(["Notes/2025-01-01.md"]);
    });

    // A later session only reads what changed since (D-072).
    it("keeps which notes are empty on this device, saving them as the plugin unloads", async () => {
        const { plugin, app } = await loadPlugin(HIDING);
        await listed(plugin, app);

        plugin.unload();

        expect(app.saveLocalStorage).toHaveBeenCalledWith(
            EMPTY_NOTES_KEY,
            expect.objectContaining({
                empty: [
                    ["Notes/2025-01-01.md", 0],
                    ["Notes/2025-01-02.md", 0],
                ],
            })
        );
    });

    it("reads no note unchanged since the last session", async () => {
        const first = await loadPlugin(HIDING);
        await listed(first.plugin, first.app);
        first.plugin.unload();
        const saved: unknown = first.app.saveLocalStorage.mock.calls.find(([key]) => key === EMPTY_NOTES_KEY)![1];

        const app = makeApp();
        app.loadLocalStorage.mockImplementation((key: string) => (key === EMPTY_NOTES_KEY ? saved : null));
        const plugin = new DailyNotesStreamPlugin(asApp(app), { id: "daily-notes-stream" } as PluginManifest);
        plugin.data = HIDING;
        await plugin.onload();

        expect(await listed(plugin, app)).toEqual([]);
        expect(app.vault.cachedRead).not.toHaveBeenCalled();
    });

    it("leaves out nothing with the setting off", async () => {
        const { plugin, app } = await loadPlugin({ hideEmptyNotes: false });

        expect(await listed(plugin, app)).toEqual(["Notes/2025-01-02.md", "Notes/2025-01-01.md"]);
        expect(app.vault.cachedRead).not.toHaveBeenCalled();
    });

    it("carries a note's verdict across a rename, and forgets a deleted note's", async () => {
        const { plugin, app } = await loadPlugin(HIDING);
        const rename = vi.spyOn(plugin.emptyNotes, "rename");
        const forget = vi.spyOn(plugin.emptyNotes, "forget");
        fire(app.vault, "rename", { path: "Notes/new.md" }, "Notes/old.md");
        fire(app.vault, "delete", { path: "Notes/gone.md" });

        expect(rename).toHaveBeenCalledWith("Notes/old.md", "Notes/new.md");
        expect(forget).toHaveBeenCalledWith("Notes/gone.md");
    });
});

describe("DailyNotesStreamPlugin — link changes", () => {
    it("follows the cache's resolves, and the vault's deletes and renames, for every view", async () => {
        const { plugin, app } = await loadPlugin();
        const changes = plugin.linkChanges;
        const spies = (["onResolve", "onResolved", "onDelete", "onRename"] as const).map((name) =>
            vi.spyOn(changes, name)
        );

        fire(app.metadataCache, "resolve", { path: "Meeting.md" });
        fire(app.metadataCache, "resolved");
        fire(app.vault, "delete", { path: "Gone.md" });
        fire(app.vault, "rename", { path: "New.md" }, "Old.md");

        expect(spies.map((spy) => spy.mock.calls)).toEqual([
            [["Meeting.md"]],
            [[]],
            [["Gone.md"]],
            [["Old.md", "New.md"]],
        ]);
    });

    // A view's footers and hidden notes both read the backlink index on
    // `resolved`.
    it("tells the views only after the backlink index is told the links changed", async () => {
        const { plugin, app } = await loadPlugin();
        const order: string[] = [];
        vi.spyOn(plugin.backlinks, "invalidate").mockImplementation(() => void order.push("index"));
        vi.spyOn(plugin.linkChanges, "onResolved").mockImplementation(() => void order.push("views"));

        fire(app.metadataCache, "resolved");

        expect(order).toEqual(["index", "views"]);
    });

    it("follows links to every note when no daily-notes folder is set", async () => {
        __setMockSettings({ format: "YYYY-MM-DD" });
        const { plugin, app } = await loadPlugin();
        const heard: string[][] = [];
        plugin.linkChanges.subscribe((paths) => heard.push(paths));
        app.metadataCache.resolvedLinks = { "Meeting.md": { "2025-01-01.md": 1 } };

        plugin.linkChanges.onResolve("Meeting.md");
        plugin.linkChanges.onResolved();

        expect(heard).toEqual([["2025-01-01.md"]]);
    });

    it("follows links into the daily-notes folder", async () => {
        const { plugin, app } = await loadPlugin();
        const heard: string[][] = [];
        plugin.linkChanges.subscribe((paths) => heard.push(paths));
        app.metadataCache.resolvedLinks = { "Meeting.md": { "Notes/2025-01-01.md": 1, "Elsewhere/2025-01-01.md": 1 } };

        plugin.linkChanges.onResolve("Meeting.md");
        plugin.linkChanges.onResolved();

        expect(heard).toEqual([["Notes/2025-01-01.md"]]);
    });
});

describe("DailyNotesStreamPlugin — collapse state", () => {
    // Handled by the plugin, not a view. When no stream was open, a rename lost
    // the note's folds and left its old keys behind.
    it("carries a note's collapse state across a rename, and forgets a deleted note's, with no view open", async () => {
        const { plugin, app } = await loadPlugin();
        const migrate = vi.spyOn(plugin.collapseStore, "migrate");
        const clear = vi.spyOn(plugin.collapseStore, "clearForFile");
        fire(app.vault, "rename", { path: "Notes/new.md" }, "Notes/old.md");
        fire(app.vault, "delete", { path: "Notes/gone.md" });

        expect(migrate).toHaveBeenCalledWith("Notes/old.md", "Notes/new.md");
        expect(clear).toHaveBeenCalledWith("Notes/gone.md");
    });

    // A note deleted while the plugin was off, or on another device, was never
    // seen.
    it("forgets notes no longer in the vault once it is indexed", async () => {
        __setMockNotes(["Notes/2025-01-01.md"]);
        const app = makeApp();
        app.loadLocalStorage.mockImplementation((key: string) =>
            key === COLLAPSE_STATE_KEY
                ? {
                      version: 1,
                      files: [
                          ["Notes/2025-01-01.md", [["intro", true]]],
                          ["Notes/gone.md", [["intro", true]]],
                      ],
                  }
                : null
        );
        const plugin = new DailyNotesStreamPlugin(asApp(app), { id: "daily-notes-stream" } as PluginManifest);

        await plugin.onload();

        expect(plugin.collapseStore.isCollapsed("Notes/2025-01-01.md", "intro")).toBe(true);
        expect(plugin.collapseStore.isCollapsed("Notes/gone.md", "intro")).toBe(false);
    });
});

describe("DailyNotesStreamPlugin — layout memory", () => {
    it("keeps what the stream measured for every view", async () => {
        const { plugin } = await loadPlugin();
        expect(plugin.layoutMemory).toBeInstanceOf(LayoutMemory);
    });

    it("carries a note's measurements across a rename, and forgets a deleted note's", async () => {
        const { plugin, app } = await loadPlugin();
        const memory = plugin.layoutMemory;
        const rename = vi.spyOn(memory, "rename");
        const forget = vi.spyOn(memory, "forget");

        fire(app.vault, "rename", { path: "Notes/new.md" }, "Notes/old.md");
        fire(app.vault, "delete", { path: "Notes/gone.md" });

        expect(rename).toHaveBeenCalledWith("Notes/old.md", "Notes/new.md");
        expect(forget).toHaveBeenCalledWith("Notes/gone.md");
    });

    // A note deleted while the plugin was off, or on another device, was never
    // seen.
    it("forgets notes no longer in the vault once it is indexed", async () => {
        __setMockNotes(["Notes/2025-01-01.md"]);
        const app = makeApp();
        app.loadLocalStorage.mockReturnValue({
            version: 5,
            notes: {
                heights: [
                    [
                        "600:16px",
                        [
                            ["Notes/2025-01-01.md", 300],
                            ["Notes/2024-01-01.md", 200],
                        ],
                    ],
                ],
                mtimes: [
                    ["Notes/2025-01-01.md", 0],
                    ["Notes/2024-01-01.md", 0],
                ],
            },
        });
        const plugin = new DailyNotesStreamPlugin(asApp(app), { id: "daily-notes-stream" } as PluginManifest);
        await plugin.onload();

        expect(plugin.layoutMemory.notes.toJSON().heights).toEqual([["600:16px", [["Notes/2025-01-01.md", 300]]]]);
    });

    // Measured before the edit, so it is estimated from its text until it is
    // re-rendered (ADR 0017).
    it("forgets a note's heights as it is edited, before any view hears of it", async () => {
        const { plugin, app } = await loadPlugin();
        plugin.layoutMemory.notes.keep("600:16px", "Notes/a.md", 300);

        fire(app.vault, "modify", { path: "Notes/a.md" });

        expect(plugin.layoutMemory.notes.heightOf("600:16px", "Notes/a.md")).toBeUndefined();
    });

    it("saves what it measured when the plugin unloads", async () => {
        const { plugin, app } = await loadPlugin();
        plugin.layoutMemory.notes.keep("600:16px", "Notes/a.md", 300);

        plugin.unload();

        expect(app.saveLocalStorage).toHaveBeenCalledWith(LAYOUT_MEMORY_KEY, expect.anything());
    });

    it("unloads cleanly when its settings failed to load", async () => {
        const plugin = new DailyNotesStreamPlugin(asApp(makeApp()), { id: "daily-notes-stream" } as PluginManifest);
        plugin.loadData = () => Promise.reject(new Error("data.json unreadable"));
        plugin.load();
        await expect(plugin.onload()).rejects.toThrow("data.json unreadable");

        expect(() => plugin.unload()).not.toThrow();
    });
});

describe("DailyNotesStreamPlugin — Calendar", () => {
    it("shows Calendar each stream's note being read, until the plugin unloads", async () => {
        const { plugin, app } = await loadPlugin();
        const calendar = {
            containerEl: document.createElement("div"),
            updateActiveFile: vi.fn(),
            revealActiveNote: vi.fn(),
        };
        app.workspace.getLeavesOfType.mockImplementation((type: string) =>
            type === "calendar" ? [{ view: calendar }] : []
        );
        const view = fake<FileView>({ file: null });
        Object.assign(app.workspace, { getActiveFile: () => view.file });
        const report = () =>
            plugin.readingNotes.report({
                view,
                note: new TFile("Notes/2026-03-11.md"),
                date: null,
                scrolling: false,
            });

        report();
        plugin.unload();
        report();

        expect(calendar.updateActiveFile).toHaveBeenCalledOnce();
    });

    /** Calendar's view, with its day click as `click`. */
    function calendarWithClicks(app: ReturnType<typeof makeApp>) {
        const view = {
            openOrCreateDailyNote: vi.fn(() => Promise.resolve()),
            click: null as null | ((date: unknown, inNewSplit: boolean) => Promise<void>),
            calendar: { $set: vi.fn() },
        };
        view.calendar.$set.mockImplementation((props: { onClickDay: typeof view.click }) => {
            view.click = props.onClickDay;
        });
        app.workspace.getLeavesOfType.mockImplementation((type: string) => (type === "calendar" ? [{ view }] : []));
        fire(app.workspace, "layout-change");
        return view;
    }

    it("scrolls the stream in the active tab to the day clicked in Calendar", async () => {
        const { plugin, app } = await loadPlugin();
        const calendar = calendarWithClicks(app);
        const stream = Object.create(DailyNotesStreamView.prototype) as DailyNotesStreamView;
        stream.showDay = vi.fn().mockResolvedValue(true);
        app.workspace.getMostRecentLeaf.mockReturnValue({ view: stream });
        const day = moment("2026-03-11", "YYYY-MM-DD", true);

        await calendar.click!(day, false);

        expect(stream.showDay).toHaveBeenCalledWith(day);
        expect(calendar.openOrCreateDailyNote).not.toHaveBeenCalled();
        plugin.unload();
        expect(calendar.click).toBe(calendar.openOrCreateDailyNote);
    });

    // A click makes Calendar's tab the active one, and Calendar highlights only
    // the active tab's file.
    it("makes the stream the active tab again once it shows the day", async () => {
        const { app } = await loadPlugin();
        const calendar = calendarWithClicks(app);
        const stream = Object.create(DailyNotesStreamView.prototype) as DailyNotesStreamView;
        const leaf = { view: stream };
        app.workspace.getMostRecentLeaf.mockReturnValue(leaf);
        const day = moment("2026-03-11", "YYYY-MM-DD", true);

        stream.showDay = vi.fn().mockResolvedValue(false);
        await calendar.click!(day, false);
        expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();

        stream.showDay = vi.fn().mockResolvedValue(true);
        await calendar.click!(day, false);
        expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
    });

    // As Show in stream does (D-218): opening it would replace the stream.
    it("says why, and stays in the stream, for a day whose note the stream hides", async () => {
        __setMockNotes(["Notes/2025-01-01.md", "Notes/2025-01-02.md"]);
        const { plugin, app } = await loadPlugin({ hideEmptyNotes: true });
        vi.spyOn(plugin.emptyNotes, "isEmpty").mockImplementation((file) => file.path === "Notes/2025-01-01.md");
        const calendar = calendarWithClicks(app);
        const stream = Object.create(DailyNotesStreamView.prototype) as DailyNotesStreamView;
        stream.showDay = vi.fn().mockResolvedValue(false);
        app.workspace.getMostRecentLeaf.mockReturnValue({ view: stream });
        Notice.reset();

        await calendar.click!(moment("2025-01-02", "YYYY-MM-DD", true), false);
        expect(Notice.shown).toEqual([]);
        expect(calendar.openOrCreateDailyNote).toHaveBeenCalledOnce();

        await calendar.click!(moment("2025-01-01", "YYYY-MM-DD", true), false);
        expect(calendar.openOrCreateDailyNote).toHaveBeenCalledOnce();
        expect(Notice.shown).toEqual([
            "This note is hidden from the stream because it's empty. To show it, turn off \"Hide empty notes\" in Daily Notes Stream's settings.",
        ]);
    });

    it("leaves a click to Calendar when the active tab is not a stream", async () => {
        const { app } = await loadPlugin();
        const calendar = calendarWithClicks(app);
        app.workspace.getMostRecentLeaf.mockReturnValue({ view: {} });

        await calendar.click!(moment("2026-03-11", "YYYY-MM-DD", true), false);

        expect(calendar.openOrCreateDailyNote).toHaveBeenCalledOnce();
    });

    it("leaves a click to Calendar when no tab is open", async () => {
        const { app } = await loadPlugin();
        const calendar = calendarWithClicks(app);

        await calendar.click!(moment("2026-03-11", "YYYY-MM-DD", true), false);

        expect(calendar.openOrCreateDailyNote).toHaveBeenCalledOnce();
    });
});

// A build put on a phone for testing shows its name, so you know the right one
// is running.
describe("DailyNotesStreamPlugin — build label", () => {
    beforeEach(() => Notice.reset());
    afterEach(() => vi.unstubAllGlobals());

    it("names the build on load when it was built with a label", async () => {
        vi.stubGlobal("BUILD_LABEL", "amber otter");

        await loadPlugin();

        expect(Notice.shown).toEqual(["Daily Notes Stream: amber otter"]);
    });

    it("says nothing on load in a release build", async () => {
        vi.stubGlobal("BUILD_LABEL", "");

        await loadPlugin();

        expect(Notice.shown).toEqual([]);
    });

    it("says nothing on load when nothing defined a label", async () => {
        await loadPlugin();

        expect(Notice.shown).toEqual([]);
    });
});

describe("DailyNotesStreamPlugin — ribbon icon", () => {
    it.each([
        ["a click", new MouseEvent("click"), false],
        ["a mod-click", new MouseEvent("click", { metaKey: true }), "tab"],
    ] as const)("opens the pane %s asks for", async (_label, evt, pane) => {
        const { plugin } = await loadPlugin();
        const activate = vi.spyOn(plugin, "activateView").mockResolvedValue(leafWithoutStream);

        plugin.ribbonIcons[0]!.callback(evt);

        expect(activate).toHaveBeenCalledWith(pane);
    });
});

describe.each([
    ["ribbon icon", (p: DailyNotesStreamPlugin) => p.ribbonIcons[0]!.callback(new MouseEvent("click"))],
    ["command", (p: DailyNotesStreamPlugin) => void p.commands[0]!.callback!()],
])("DailyNotesStreamPlugin — %s", (_label, trigger) => {
    it("activates the view", async () => {
        const { plugin } = await loadPlugin();
        const activate = vi.spyOn(plugin, "activateView").mockResolvedValue(leafWithoutStream);

        trigger(plugin);

        expect(activate).toHaveBeenCalledTimes(1);
    });

    it("logs when activation fails instead of leaving an unhandled rejection", async () => {
        const { plugin } = await loadPlugin();
        vi.spyOn(plugin, "activateView").mockRejectedValue(new Error("no leaf"));

        trigger(plugin);
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith("DailyNotesStream: Failed to activate view", expect.any(Error));
    });
});

describe("DailyNotesStreamPlugin — jump-to-date command", () => {
    const trigger = (p: DailyNotesStreamPlugin) => void p.commands.find((c) => c.id === "jump-to-date")!.callback!();

    /** A leaf holding a stream view, without creating the real one. */
    function makeViewLeaf() {
        const view = Object.create(DailyNotesStreamView.prototype) as DailyNotesStreamView;
        view.promptJumpToDate = vi.fn();
        // The mock ItemView is not a View to the type checker, though main.ts
        // treats it as one.
        return { leaf: { view } as unknown as Leaf, view };
    }

    it("prompts on the view it activated", async () => {
        const { plugin } = await loadPlugin();
        const { leaf, view } = makeViewLeaf();
        vi.spyOn(plugin, "activateView").mockResolvedValue(leaf);

        trigger(plugin);
        await flushPromises();

        expect(view.promptJumpToDate).toHaveBeenCalledTimes(1);
    });

    it("prompts nothing when the leaf holds no stream view", async () => {
        const { plugin } = await loadPlugin();
        vi.spyOn(plugin, "activateView").mockResolvedValue(leafWithoutStream);

        trigger(plugin);
        await flushPromises();

        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs when activation fails instead of leaving an unhandled rejection", async () => {
        const { plugin } = await loadPlugin();
        vi.spyOn(plugin, "activateView").mockRejectedValue(new Error("no leaf"));

        trigger(plugin);
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith("DailyNotesStream: Failed to activate view", expect.any(Error));
    });
});

describe("DailyNotesStreamPlugin — show in stream", () => {
    const shown = "Notes/2025-01-02.md";

    /** A leaf holding a stream view, without creating the real one. */
    function makeViewLeaf() {
        const view = Object.create(DailyNotesStreamView.prototype) as DailyNotesStreamView;
        view.showNote = vi.fn().mockResolvedValue(undefined);
        return { leaf: { view } as unknown as Leaf, view };
    }

    const command = (p: DailyNotesStreamPlugin) => p.commands.find((c) => c.id === "show-in-stream")!;

    /** The items the plugin adds to the menu of `file`. */
    function fileMenu(app: ReturnType<typeof makeApp>, file: TFile) {
        const menu = new Menu();
        fire(app.workspace, "file-menu", menu, file, "file-explorer-context-menu");
        return menu.items;
    }

    beforeEach(() => __setMockNotes(["Notes/2025-01-01.md", shown, "Notes/Ideas.md"]));

    it("is a command named for the README, with the stream's icon", async () => {
        const { plugin } = await loadPlugin();

        expect(command(plugin).name).toBe("Show in stream");
        expect(command(plugin).icon).toBe("gallery-vertical-end");
    });

    // Whether a note is empty is only known once it is read (D-218).
    it("is offered for the active file when it is a daily note, even one the stream hides", async () => {
        const { plugin, app } = await loadPlugin({ hideEmptyNotes: true });
        vi.spyOn(plugin.emptyNotes, "isEmpty").mockImplementation((file) => file.path === "Notes/2025-01-01.md");
        const offered = (path: string | null) => {
            app.workspace.getActiveFile.mockReturnValue(path === null ? null : new TFile(path));
            return command(plugin).checkCallback!(true);
        };

        expect(offered(shown)).toBe(true);
        expect(offered("Notes/2025-01-01.md")).toBe(true);
        expect(offered("Notes/Ideas.md")).toBe(false);
        expect(offered(null)).toBe(false);
    });

    it("says why, and stays on the note, when the stream hides it", async () => {
        const { plugin, app } = await loadPlugin({ hideEmptyNotes: true });
        const activate = vi.spyOn(plugin, "activateView").mockResolvedValue(leafWithoutStream);
        app.vault.cachedRead.mockResolvedValue("");
        app.workspace.getActiveFile.mockReturnValue(new TFile(shown));

        command(plugin).checkCallback!(false);
        await flushPromises();

        expect(activate).not.toHaveBeenCalled();
        expect(Notice.shown).toEqual([
            "This note is hidden from the stream because it's empty. To show it, turn off \"Hide empty notes\" in Daily Notes Stream's settings.",
        ]);
    });

    it("opens nothing while the palette only asks whether it is offered", async () => {
        const { plugin, app } = await loadPlugin();
        const activate = vi.spyOn(plugin, "activateView").mockResolvedValue(leafWithoutStream);
        app.workspace.getActiveFile.mockReturnValue(new TFile(shown));

        command(plugin).checkCallback!(true);

        expect(activate).not.toHaveBeenCalled();
    });

    it("opens the stream in the current tab, at the active file", async () => {
        const { plugin, app } = await loadPlugin();
        const { leaf, view } = makeViewLeaf();
        const activate = vi.spyOn(plugin, "activateView").mockResolvedValue(leaf);
        const file = new TFile(shown);
        app.workspace.getActiveFile.mockReturnValue(file);

        command(plugin).checkCallback!(false);
        await flushPromises();

        expect(activate).toHaveBeenCalledWith(false);
        expect(view.showNote).toHaveBeenCalledWith(file);
    });

    it("adds an item to the menu of a daily note, and none to other notes", async () => {
        const { app } = await loadPlugin();

        expect(fileMenu(app, new TFile(shown)).map((item) => [item.title, item.icon, item.section])).toEqual([
            ["Show in stream", "gallery-vertical-end", "open"],
        ]);
        expect(fileMenu(app, new TFile("Notes/Ideas.md"))).toEqual([]);
    });

    it("adds nothing to the menu of a note's title in the stream, which already shows it", async () => {
        const { app } = await loadPlugin();
        const menu = new Menu();

        fire(app.workspace, "file-menu", menu, new TFile(shown), "daily-notes-stream");

        expect(menu.items).toEqual([]);
    });

    it("opens the stream at the menu's note, in the pane a Ctrl/Cmd-click asks for", async () => {
        const { plugin, app } = await loadPlugin();
        const { leaf, view } = makeViewLeaf();
        const activate = vi.spyOn(plugin, "activateView").mockResolvedValue(leaf);
        const file = new TFile(shown);
        const [item] = fileMenu(app, file);

        item!.click();
        await flushPromises();
        expect(activate).toHaveBeenLastCalledWith(false);
        expect(view.showNote).toHaveBeenCalledWith(file);

        item!.click(new MouseEvent("click", { metaKey: true }));
        await flushPromises();
        expect(activate).toHaveBeenLastCalledWith("tab");
    });

    it("shows nothing when the leaf holds no stream view", async () => {
        const { plugin, app } = await loadPlugin();
        vi.spyOn(plugin, "activateView").mockResolvedValue(leafWithoutStream);
        app.workspace.getActiveFile.mockReturnValue(new TFile(shown));

        command(plugin).checkCallback!(false);
        await flushPromises();

        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs when activation fails instead of leaving an unhandled rejection", async () => {
        const { plugin, app } = await loadPlugin();
        vi.spyOn(plugin, "activateView").mockRejectedValue(new Error("no leaf"));
        app.workspace.getActiveFile.mockReturnValue(new TFile(shown));

        command(plugin).checkCallback!(false);
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith("DailyNotesStream: Failed to activate view", expect.any(Error));
    });
});

describe("DailyNotesStreamPlugin — activateView", () => {
    it("hands back the leaf it opened, for callers that drive the view", async () => {
        const { plugin, app } = await loadPlugin();
        const leaf = makeLeaf(app);
        app.workspace.getLeaf.mockReturnValue(leaf);

        expect(await plugin.activateView()).toBe(leaf);
    });

    it("opens in the current tab, as the graph does", async () => {
        const { plugin, app } = await loadPlugin();
        const leaf = makeLeaf(app);
        app.workspace.getLeaf.mockReturnValue(leaf);

        await plugin.activateView();

        expect(app.workspace.getLeaf).toHaveBeenCalledWith(false);
        expect(leaf.setViewState).toHaveBeenCalledWith({
            type: VIEW_TYPE_DAILY_NOTES_STREAM,
            active: true,
        });
        expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    });

    it("opens in the pane it is asked for", async () => {
        const { plugin, app } = await loadPlugin();
        app.workspace.getLeaf.mockReturnValue(makeLeaf(app));

        await plugin.activateView("tab");

        expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
    });

    it("opens in the current tab even when another tab holds a stream", async () => {
        const { plugin, app } = await loadPlugin();
        const other = makeLeaf(app);
        const current = makeLeaf(app);
        app.workspace.getLeavesOfType.mockReturnValue([other]);
        app.workspace.getLeaf.mockReturnValue(current);

        await plugin.activateView();

        expect(current.setViewState).toHaveBeenCalled();
        expect(other.setViewState).not.toHaveBeenCalled();
        expect(app.workspace.revealLeaf).toHaveBeenCalledWith(current);
    });
});

describe("DailyNotesStreamPlugin — saveSettings", () => {
    it("persists the settings", async () => {
        const { plugin } = await loadPlugin();
        plugin.settings.showLinkedMentions = false;

        await plugin.saveSettings();

        expect(plugin.data).toEqual({ ...DEFAULT_SETTINGS, showLinkedMentions: false });
    });

    it("refreshes every open stream view", async () => {
        const { plugin, app } = await loadPlugin();
        const view = new DailyNotesStreamView(new WorkspaceLeaf(asApp(app)), plugin, makeService());
        const refresh = vi.spyOn(view, "refresh").mockResolvedValue(undefined);
        app.workspace.getLeavesOfType.mockReturnValue([{ view }]);

        await plugin.saveSettings();

        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("skips leaves holding some other view", async () => {
        const { plugin, app } = await loadPlugin();
        const refresh = vi.fn();
        app.workspace.getLeavesOfType.mockReturnValue([{ view: { refresh } }]);

        await plugin.saveSettings();

        expect(refresh).not.toHaveBeenCalled();
    });

    it("logs when a refresh fails", async () => {
        const { plugin, app } = await loadPlugin();
        const view = new DailyNotesStreamView(new WorkspaceLeaf(asApp(app)), plugin, makeService());
        vi.spyOn(view, "refresh").mockRejectedValue(new Error("render blew up"));
        app.workspace.getLeavesOfType.mockReturnValue([{ view }]);

        await plugin.saveSettings();
        await flushPromises();

        expect(errorSpy).toHaveBeenCalledWith(
            "DailyNotesStream: Failed to refresh view on settings change",
            expect.any(Error)
        );
    });
});

describe("DailyNotesStreamPlugin — two open streams", () => {
    beforeEach(() => {
        const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
        for (const name of ["IntersectionObserver", "ResizeObserver"])
            vi.stubGlobal(
                name,
                vi.fn(function () {
                    return observer;
                })
            );
    });
    afterEach(() => vi.unstubAllGlobals());

    /** Two views of one plugin, each opened with its first batch loaded. */
    async function openTwoViews() {
        const { plugin, app } = await loadPlugin();
        app.vault.cachedRead.mockResolvedValue("Written.");
        const factory = plugin.views[VIEW_TYPE_DAILY_NOTES_STREAM]!;
        const views = [factory(new WorkspaceLeaf(asApp(app))), factory(new WorkspaceLeaf(asApp(app)))];
        const streams = views.map((view) => (view as DailyNotesStreamView)["stream"]);
        for (const [i, view] of views.entries()) {
            await (view as DailyNotesStreamView).onOpen();
            await streams[i]!.loadMoreNotes();
        }
        return streams;
    }

    it("shows a created note in both, as Obsidian tells each", async () => {
        __setMockNotes(["Notes/2026-08-27.md"]);
        const streams = await openTwoViews();

        const created = new TFile("Notes/2026-08-28.md");
        __setMockNotes(["Notes/2026-08-27.md", created.path]);
        for (const stream of streams) stream.onFileCreate(created);
        await Promise.all(streams.map((stream) => stream.refresh()));

        expect(streams.map((stream) => stream.blockOf(created) !== null)).toEqual([true, true]);
    });

    it("drops a deleted note from both, so neither pages past a note", async () => {
        __setMockNotes(["Notes/2026-08-28.md", "Notes/2026-08-27.md"]);
        const streams = await openTwoViews();

        const deleted = streams[0]!["service"].streamedNotes()[0]!;
        for (const stream of streams) stream.onFileDelete(deleted);
        await Promise.all(streams.map((stream) => stream.refresh()));

        expect(streams.map((stream) => stream["service"].streamedNotes().map((f) => f.path))).toEqual([
            ["Notes/2026-08-27.md"],
            ["Notes/2026-08-27.md"],
        ]);
    });
});

describe("DailyNotesStreamPlugin — scroll-to-top command", () => {
    const check = (p: DailyNotesStreamPlugin, checking: boolean) =>
        p.commands.find((c) => c.id === "scroll-to-top")!.checkCallback!(checking);

    it.each([
        ["no leaf", null],
        ["a leaf holding another view", leafWithoutStream],
    ])("is not offered with %s", async (_label, leaf) => {
        const { plugin, app } = await loadPlugin();
        app.workspace.getMostRecentLeaf.mockReturnValue(leaf);

        expect(check(plugin, true)).toBe(false);
    });

    it("scrolls the stream in the most recent leaf to the top", async () => {
        const { plugin, app } = await loadPlugin();
        const view = Object.create(DailyNotesStreamView.prototype) as DailyNotesStreamView;
        view.scrollToTop = vi.fn();
        app.workspace.getMostRecentLeaf.mockReturnValue({ view });

        expect(check(plugin, true)).toBe(true);
        expect(view.scrollToTop).not.toHaveBeenCalled();

        check(plugin, false);
        expect(view.scrollToTop).toHaveBeenCalledTimes(1);
    });
});

// A help for testing, which only a build put on a device offers.
describe("DailyNotesStreamPlugin — forget-note-heights command", () => {
    afterEach(() => vi.unstubAllGlobals());
    const offered = (p: DailyNotesStreamPlugin) => p.commands.some((c) => c.id === "forget-note-heights");

    it.each([
        ["a release build", ""],
        ["an unbundled run", undefined],
    ])("is not offered in %s", async (_label, label) => {
        if (label !== undefined) vi.stubGlobal("BUILD_LABEL", label);
        const { plugin } = await loadPlugin();
        expect(offered(plugin)).toBe(false);
    });

    it("offers the testing aids by name in a build put on a device", async () => {
        vi.stubGlobal("BUILD_LABEL", "amber otter");
        const { plugin } = await loadPlugin();

        expect(plugin.commands.map((c) => c.name)).toEqual(
            expect.arrayContaining(["Forget measured note heights", "Forget collapse state"])
        );
    });

    it("empties the layout memory and re-estimates every open stream", async () => {
        vi.stubGlobal("BUILD_LABEL", "amber otter");
        const { plugin, app } = await loadPlugin();
        const view = new DailyNotesStreamView(new WorkspaceLeaf(asApp(app)), plugin, makeService());
        const forgetHeights = vi.spyOn(view, "forgetHeights").mockImplementation(() => {});
        const other = { forgetHeights: vi.fn() };
        app.workspace.getLeavesOfType.mockReturnValue([{ view }, { view: other }]);
        plugin.layoutMemory.notes.keep("600:16px", "Notes/2025-01-01.md", 300);

        plugin.commands.find((c) => c.id === "forget-note-heights")!.callback!();

        expect(plugin.layoutMemory.notes.heightOf("600:16px", "Notes/2025-01-01.md")).toBeUndefined();
        expect(forgetHeights).toHaveBeenCalledTimes(1);
        expect(other.forgetHeights).not.toHaveBeenCalled();
    });
});

// A help for testing, to start with nothing folded. Only a build put on a
// device offers it.
describe("DailyNotesStreamPlugin — forget-collapse-state command", () => {
    /** The browser's localStorage, which jsdom does not provide here. */
    const stored = new Map<string, string>();
    beforeEach(() => {
        Notice.reset();
        stored.clear();
        vi.stubGlobal("localStorage", {
            get length() {
                return stored.size;
            },
            key: (index: number) => [...stored.keys()][index] ?? null,
            removeItem: (key: string) => void stored.delete(key),
        });
    });
    afterEach(() => vi.unstubAllGlobals());
    const offered = (p: DailyNotesStreamPlugin) => p.commands.some((c) => c.id === "forget-collapse-state");
    const forget = (p: DailyNotesStreamPlugin) => {
        p.commands.find((c) => c.id === "forget-collapse-state")!.callback!();
    };

    it("is not offered in a release build", async () => {
        vi.stubGlobal("BUILD_LABEL", "");
        const { plugin } = await loadPlugin();
        expect(offered(plugin)).toBe(false);
    });

    it("forgets every fold, and removes this vault's keys from before D-121, leaving other vaults'", async () => {
        vi.stubGlobal("BUILD_LABEL", "amber otter");
        const { plugin, app } = await loadPlugin();
        Object.assign(app, { appId: "vault1" });
        plugin.collapseStore.setCollapsed("Notes/2025-01-01.md", "intro", true);
        stored.set("vault1-collapse:Notes/2025-01-01.md:intro", "true");
        stored.set("vault1-collapse-idx:Notes/2025-01-01.md", '["intro"]');
        stored.set("vault2-collapse:Notes/2025-01-01.md:intro", "true");

        forget(plugin);

        expect(plugin.collapseStore.isCollapsed("Notes/2025-01-01.md", "intro")).toBe(false);
        expect(app.saveLocalStorage).toHaveBeenLastCalledWith(COLLAPSE_STATE_KEY, null);
        expect([...stored.keys()]).toEqual(["vault2-collapse:Notes/2025-01-01.md:intro"]);
    });

    it("redraws every open stream, so what was folded shows open", async () => {
        vi.stubGlobal("BUILD_LABEL", "amber otter");
        const { plugin, app } = await loadPlugin();
        const view = new DailyNotesStreamView(new WorkspaceLeaf(asApp(app)), plugin, makeService());
        const refresh = vi.spyOn(view, "refresh").mockResolvedValue();
        const other = { refresh: vi.fn() };
        app.workspace.getLeavesOfType.mockReturnValue([{ view }, { view: other }]);

        forget(plugin);

        expect(refresh).toHaveBeenCalledOnce();
        expect(other.refresh).not.toHaveBeenCalled();
    });
    it("logs a stream that fails to redraw", async () => {
        vi.stubGlobal("BUILD_LABEL", "amber otter");
        const { plugin, app } = await loadPlugin();
        const view = new DailyNotesStreamView(new WorkspaceLeaf(asApp(app)), plugin, makeService());
        vi.spyOn(view, "refresh").mockRejectedValue(new Error("gone"));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        app.workspace.getLeavesOfType.mockReturnValue([{ view }]);

        forget(plugin);
        await flushPromises();

        expect(error).toHaveBeenCalledWith(expect.stringMatching(/^DailyNotesStream: /), expect.any(Error));
        error.mockRestore();
    });
});
