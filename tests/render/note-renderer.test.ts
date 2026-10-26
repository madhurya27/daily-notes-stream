import { describe, it, expect, afterEach, beforeEach, onTestFinished, vi } from "vitest";
import { BaseMeasurements } from "../../src/render/bases/base-measurements";
import { SearchHighlighter } from "../../src/render/search-highlights";
import { youtubeThumbnail } from "../../src/render/video-thumbnails";
import { NoteRenderer } from "../../src/render/note-renderer";
import { BacklinkIndex } from "../../src/notes/backlink-index";
import { NoteBases } from "../../src/render/bases/note-bases";
import { Component, MarkdownRenderer, MarkdownView, TFile } from "obsidian";
import { Menu, Platform } from "../mocks/obsidian";
import { CollapsibleManager } from "../../src/render/collapsible";
import { CollapsibleStateStore } from "../../src/render/collapse-store";
import type { DailyNotesStreamSettings } from "../../src/settings";
import { asApp } from "../stream-view-fixture";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(opts: { readResult?: string; fileCache?: unknown; leaves?: unknown[] } = {}) {
    const { readResult = "", fileCache = null, leaves = [] } = opts;
    const mockOpenFile = vi.fn().mockResolvedValue(undefined);
    // One leaf is used for both: opening a note, and holding a search pane.
    const searchView = { setQuery: vi.fn() };
    const mockLeaf = {
        openFile: mockOpenFile,
        view: searchView,
        setViewState: vi.fn().mockResolvedValue(undefined),
    };
    const openGlobalSearch = vi.fn();
    return {
        vault: {
            cachedRead: vi.fn().mockResolvedValue(readResult),
            getFileByPath: vi.fn((path: string): TFile | null => new TFile(path)),
        },
        metadataCache: {
            getFileCache: vi.fn().mockReturnValue(fileCache),
            getFirstLinkpathDest: vi.fn().mockReturnValue(null),
            on: vi.fn((_name: string, _callback: () => unknown) => ({})),
        },
        internalPlugins: { getPluginById: vi.fn().mockReturnValue({ instance: { openGlobalSearch } }) },
        _openGlobalSearch: openGlobalSearch,
        workspace: {
            getLeavesOfType: vi.fn().mockReturnValue(leaves),
            getLeaf: vi.fn().mockReturnValue(mockLeaf),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
            setActiveLeaf: vi.fn(),
            trigger: vi.fn(),
            openLinkText: vi.fn().mockResolvedValue(undefined),
        },
        _mockLeaf: mockLeaf,
        _searchLeaf: mockLeaf,
    };
}

/**
 * A Markdown leaf view. `instanceof` rules out deferred views, which are not
 * loaded.
 */
function makeMarkdownView(file: TFile | null): MarkdownView {
    const view = new MarkdownView();
    view.file = file;
    return view;
}

function makeStore() {
    const storage = new Map<string, unknown>();
    return {
        loadLocalStorage: vi.fn((key: string) => storage.get(key) ?? null),
        saveLocalStorage: vi.fn((key: string, value: unknown) => {
            if (value === null) storage.delete(key);
            else storage.set(key, value);
        }),
    };
}

/**
 * A real manager (the properties panel uses its toggle), with rendering
 * replaced by a fake.
 */
/** The component part of the view, which owns the shared listeners. */
const delegateComponent = Object.assign(new Component(), {
    hoverPopover: null,
    getViewType: () => "daily-notes-stream-view",
});

/** The two-step API the window manager uses: create the block, then fill it. */
async function renderNote(renderer: NoteRenderer, file: TFile): Promise<HTMLElement> {
    const block = renderer.createBlock(file);
    await renderer.renderInto(block, file);
    return block;
}

/**
 * The manager the renderer under test was created with, so mount() can connect
 * it.
 */
let lastCollapsible: CollapsibleManager | null = null;

/**
 * Puts a rendered note under a root with shared listeners, as the stream's
 * container is.
 */
function mount(renderer: NoteRenderer, el: HTMLElement): HTMLElement {
    const root = document.createElement("div");
    renderer.delegate(delegateComponent, root);
    lastCollapsible?.delegate(delegateComponent, root);
    root.appendChild(el);
    document.body.appendChild(root);
    return el;
}

function makeCollapsible(store = makeStore()): CollapsibleManager {
    const manager = new CollapsibleManager(new CollapsibleStateStore(asApp(store)));
    vi.spyOn(manager, "makeCollapsible").mockReturnValue([]);
    lastCollapsible = manager;
    return manager;
}

function makeSettings(overrides: Partial<DailyNotesStreamSettings> = {}): () => DailyNotesStreamSettings {
    const settings = {
        showProperties: false,
        propertiesCollapsed: false,
        showLinkedMentions: false,
        linkedMentionsCollapsed: false,
        hideEmptyNotes: false,
        oneCardPerRow: false,
        ...overrides,
    };
    return () => settings;
}

// ---------------------------------------------------------------------------
// renderInto
// ---------------------------------------------------------------------------

async function renderWithProperties(app: ReturnType<typeof makeApp>) {
    const renderer = new NoteRenderer(
        asApp(app),
        new Component(),
        makeCollapsible(),
        makeSettings({ showProperties: true }),
        new SearchHighlighter(),
        new BaseMeasurements(),
        new BacklinkIndex(() => ({}))
    );
    return mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
}

describe("NoteRenderer.renderInto", () => {
    let app: ReturnType<typeof makeApp>;
    let renderer: NoteRenderer;

    beforeEach(() => {
        app = makeApp();
        renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
    });

    it("includes .daily-note-title with the file basename as text", async () => {
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".daily-note-title")?.textContent).toBe("2025-01-01");
    });

    it("sets dataset.sourcePath on the block, which outlives its content", () => {
        const block = renderer.createBlock(new TFile("Notes/2025-01-01.md"));
        expect(block.dataset.sourcePath).toBe("Notes/2025-01-01.md");
    });

    it("renders the body without its frontmatter", async () => {
        const render = vi.spyOn(MarkdownRenderer, "render");
        app.vault.cachedRead = vi.fn().mockResolvedValue("---\ntitle: Test\n---\nBody text");
        app.metadataCache.getFileCache = vi.fn().mockReturnValue({
            frontmatterPosition: { end: { offset: 19 } },
        });
        await renderNote(renderer, new TFile("Notes/2025-01-01.md"));
        expect(render).toHaveBeenCalledWith(
            app,
            "Body text",
            expect.anything(),
            "Notes/2025-01-01.md",
            expect.anything()
        );
    });

    it("reads through the cache — the view only displays notes", async () => {
        await renderNote(renderer, new TFile("Notes/2025-01-01.md"));
        expect(app.vault.cachedRead).toHaveBeenCalledOnce();
    });

    it("reads the settings on each render, so a reloaded settings object is picked up", async () => {
        let settings: DailyNotesStreamSettings = {
            showProperties: false,
            propertiesCollapsed: false,
            showLinkedMentions: false,
            linkedMentionsCollapsed: false,
            hideEmptyNotes: false,
            oneCardPerRow: false,
        };
        app.metadataCache.getFileCache = vi.fn().mockReturnValue({ frontmatter: { title: "Test" } });
        renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            () => settings,
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );

        settings = {
            showProperties: true,
            propertiesCollapsed: false,
            showLinkedMentions: false,
            linkedMentionsCollapsed: false,
            hideEmptyNotes: false,
            oneCardPerRow: false,
        }; // as loadSettings() would
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        expect(el.querySelector(".metadata-container")).not.toBeNull();
    });

    // Before folding, which reads a list item's own text for its key.
    it("wraps text beside a block before making sections collapsible", async () => {
        vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, _md, el) => {
            el.innerHTML = "<ul><li>Standing pancake<ul><li>Head to floor</li></ul></li></ul>";
        });
        const collapsible = makeCollapsible();
        let wrappedFirst = false;
        vi.mocked(collapsible.makeCollapsible).mockImplementation((el) => {
            wrappedFirst = el.querySelector(".daily-note-text-run")?.textContent === "Standing pancake";
            return [];
        });
        renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            collapsible,
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );

        await renderNote(renderer, new TFile("Notes/2025-01-01.md"));

        expect(wrappedFirst).toBe(true);
    });

    it("calls makeCollapsible after rendering content", async () => {
        const collapsible = makeCollapsible();
        renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            collapsible,
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        await renderNote(renderer, new TFile("Notes/2025-01-01.md"));
        expect(collapsible.makeCollapsible).toHaveBeenCalledOnce();
    });

    it("forgets the sections the rendered note no longer has", async () => {
        const collapsible = makeCollapsible();
        vi.mocked(collapsible.makeCollapsible).mockReturnValue(["meeting"]);
        const forget = vi.spyOn(collapsible, "forgetRemovedSections").mockImplementation(() => {});
        renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            collapsible,
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");

        await renderNote(renderer, file);

        expect(forget).toHaveBeenCalledWith(file, ["meeting"]);
    });

    it("forgets nothing when the note failed to render: no section was seen", async () => {
        app.vault.cachedRead = vi.fn().mockRejectedValue(new Error("read failed"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const collapsible = makeCollapsible();
        const forget = vi.spyOn(collapsible, "forgetRemovedSections");
        renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            collapsible,
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );

        await renderNote(renderer, new TFile("Notes/2025-01-01.md"));

        expect(forget).not.toHaveBeenCalled();
    });

    it("leaves the block empty when the header or properties throw, so a retry draws one header", async () => {
        app.metadataCache.getFileCache.mockImplementationOnce(() => {
            throw new Error("cache failed");
        });
        const view = new Component();
        renderer = new NoteRenderer(
            asApp(app),
            view,
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");
        const block = renderer.createBlock(file);

        await expect(renderer.renderInto(block, file)).rejects.toThrow("cache failed");
        expect(block.childElementCount).toBe(0);
        expect(view.children).toHaveLength(0);

        await renderer.renderInto(block, file);
        expect(block.querySelectorAll(".daily-note-header")).toHaveLength(1);
    });

    it("shows 'Error rendering note' text when the read rejects", async () => {
        app.vault.cachedRead = vi.fn().mockRejectedValue(new Error("read failed"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".daily-note-content")?.textContent).toBe("Error rendering note");
        expect(console.error).toHaveBeenCalledWith(
            "DailyNotesStream: Failed to render note Notes/2025-01-01.md:",
            expect.any(Error)
        );
    });

    it("leaves the block of a note deleted mid-read empty, reporting nothing", async () => {
        app.vault.cachedRead = vi.fn().mockRejectedValue(new Error("ENOENT"));
        app.vault.getFileByPath.mockReturnValue(null);
        const error = vi
            .spyOn(console, "error")
            .mockClear()
            .mockImplementation(() => {});
        const view = new Component();
        renderer = new NoteRenderer(
            asApp(app),
            view,
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");
        const block = renderer.createBlock(file);

        expect(await renderer.renderInto(block, file)).toBeNull();
        expect(block.childElementCount).toBe(0);
        expect(view.children).toHaveLength(0);
        expect(error).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// How long each note's component lives
// ---------------------------------------------------------------------------

describe("NoteRenderer component lifetime", () => {
    it("createBlock returns an empty .daily-note-block", () => {
        const renderer = new NoteRenderer(
            asApp(makeApp()),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const block = renderer.createBlock(new TFile("Notes/2025-01-01.md"));
        expect(block.classList.contains("daily-note-block")).toBe(true);
        expect(block.childElementCount).toBe(0);
    });

    it("renders into a child component of the view, not the view itself", async () => {
        const owner = new Component();
        const renderer = new NoteRenderer(
            asApp(makeApp()),
            owner,
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");

        const { component: child } = (await renderer.renderInto(renderer.createBlock(file), file))!;

        expect(owner.children).toContain(child);
        expect(child.loaded).toBe(true);
    });

    // Removing only the DOM leaves what MarkdownRenderer.render() registered
    // active on the view until the view unloads. That is the leak that
    // unloading a note exists to fix.
    it("discard unloads the note's component and drops it from the view", async () => {
        const owner = new Component();
        const renderer = new NoteRenderer(
            asApp(makeApp()),
            owner,
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");
        const { component: child } = (await renderer.renderInto(renderer.createBlock(file), file))!;

        renderer.discard(child);

        expect(owner.children).not.toContain(child);
        expect(child.loaded).toBe(false);
    });

    // Tracked once the note is complete, so the title and body are searched,
    // and forgotten with the component, so an unloaded note keeps no ranges.
    it("highlights the search in the rendered note until it is discarded", async () => {
        const app = makeApp();
        app.vault.cachedRead = vi.fn().mockResolvedValue("body");
        const highlighter = new SearchHighlighter();
        highlighter.setQuery("2025");
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            highlighter,
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");
        const block = renderer.createBlock(file);

        const { component: child } = (await renderer.renderInto(block, file))!;
        expect(highlighter.rangesIn(block).map((r) => r.toString())).toEqual(["2025"]);

        renderer.discard(child);
        expect(highlighter.rangesIn(block)).toEqual([]);
    });

    it("a failed render still yields a component the caller can discard", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const app = makeApp();
        app.vault.cachedRead = vi.fn().mockRejectedValue(new Error("read failed"));
        const owner = new Component();
        const renderer = new NoteRenderer(
            asApp(app),
            owner,
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");

        const { component: child } = (await renderer.renderInto(renderer.createBlock(file), file))!;
        renderer.discard(child);

        expect(owner.children).not.toContain(child);
    });
});

describe("NoteRenderer linked mentions", () => {
    const DAY = new TFile("Notes/2025-01-01.md");
    const SOURCE = new TFile("Ideas/a.md");

    /**
     * A vault where Ideas/a.md links to the day, and reading it waits until
     * `release`.
     */
    function linkedVault() {
        const app = makeApp({ readResult: "body" });
        let release!: () => void;
        app.vault.cachedRead = vi.fn((file: TFile) =>
            file === SOURCE
                ? new Promise<string>((resolve) => (release = () => resolve("See [[2025-01-01]]")))
                : Promise.resolve("body")
        );
        Object.assign(app.vault, { getFileByPath: (path: string) => (path === SOURCE.path ? SOURCE : null) });
        app.metadataCache.getFileCache = vi.fn((file: TFile) =>
            file === SOURCE
                ? { links: [{ link: "2025-01-01", original: "[[2025-01-01]]", position: at(4, 18) }] }
                : null
        );
        app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(DAY);
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showLinkedMentions: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({ [SOURCE.path]: { [DAY.path]: 1 } }))
        );
        return { app, renderer, release: () => release() };
    }

    function at(start: number, end: number) {
        return { start: { line: 0, col: 0, offset: start }, end: { line: 0, col: 0, offset: end } };
    }

    it("ends a note with the notes linking to it", async () => {
        const { renderer, release } = linkedVault();
        const block = renderer.createBlock(DAY);

        const { footer } = (await renderer.renderInto(block, DAY))!;
        release();
        await footer;

        expect(block.lastElementChild!.hasClass("daily-note-mentions")).toBe(true);
        expect(block.querySelector(".daily-note-mention")?.getAttribute("data-link-source")).toBe(SOURCE.path);
    });

    it("fades a link in a linked mention to a note not yet created", async () => {
        const { app, renderer, release } = linkedVault();
        const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, el) => {
            if (markdown.includes("2025-01-01"))
                el.createEl("a", { cls: "internal-link" }).setAttribute("data-href", "Someday");
        });
        onTestFinished(() => render.mockRestore());
        app.metadataCache.getFirstLinkpathDest = vi.fn((path: string) => (path === "Someday" ? null : DAY));
        const block = renderer.createBlock(DAY);

        const { footer } = (await renderer.renderInto(block, DAY))!;
        release();
        await footer;

        expect(block.querySelector(".daily-note-mention-excerpt .internal-link")?.hasClass("is-unresolved")).toBe(true);
    });

    // The queue that renders notes also handles vault events, so it must not
    // wait while another note is read.
    it("hands the note back before its linked mentions are read", async () => {
        const { renderer, release } = linkedVault();
        const block = renderer.createBlock(DAY);

        const { footer } = (await renderer.renderInto(block, DAY))!;
        let filled = false;
        void footer.then(() => (filled = true));
        await Promise.resolve();

        expect(block.querySelector(".daily-note-content")).not.toBeNull();
        expect(filled).toBe(false);
        release();
        await footer;
        expect(filled).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Title click — revealLeaf vs openFile
// ---------------------------------------------------------------------------

describe("NoteRenderer title link", () => {
    it("is keyboard focusable and does not navigate", async () => {
        const app = makeApp({ leaves: [] });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const link = el.querySelector(".daily-note-title") as HTMLAnchorElement;

        expect(link.getAttribute("href")).toBe("#");

        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        link.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
});

describe("NoteRenderer title click", () => {
    it("opens the note in the stream's own tab, as a link in a note does", async () => {
        const file = new TFile("Notes/2025-01-01.md");
        const app = makeApp();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, file));

        (el.querySelector(".daily-note-title") as HTMLElement).click();

        expect(app.workspace.getLeaf).toHaveBeenCalledWith(false);
        expect(app._mockLeaf.openFile).toHaveBeenCalledWith(file);
    });

    it("opens it there even when another tab shows the note", async () => {
        const file = new TFile("Notes/2025-01-01.md");
        const app = makeApp({ leaves: [{ view: makeMarkdownView(file) }] });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, file));

        (el.querySelector(".daily-note-title") as HTMLElement).click();

        expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
        expect(app.workspace.getLeaf).toHaveBeenCalledWith(false);
    });

    it("logs error when openFile rejects", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const file = new TFile("Notes/2025-01-01.md");
        const failLeaf = { openFile: vi.fn().mockRejectedValue(new Error("open failed")) };
        const app = makeApp({ leaves: [] });
        app.workspace.getLeaf = vi.fn().mockReturnValue(failLeaf);
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, file));
        (el.querySelector(".daily-note-title") as HTMLElement).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(consoleSpy).toHaveBeenCalledWith("DailyNotesStream: Failed to open file", expect.any(Error));
        consoleSpy.mockRestore();
    });
});

describe("NoteRenderer title open targets", () => {
    async function renderTitle(app: ReturnType<typeof makeApp>) {
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");
        const el = mount(renderer, await renderNote(renderer, file));
        return { file, title: el.querySelector(".daily-note-title") as HTMLElement };
    }

    it("opens a new tab on mod-click, even when the note is already open", async () => {
        const file = new TFile("Notes/2025-01-01.md");
        const app = makeApp({ leaves: [{ view: makeMarkdownView(file) }] });
        const { title } = await renderTitle(app);

        title.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));

        expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
        expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(app._mockLeaf.openFile).toHaveBeenCalledWith(file);
    });

    it("opens a split on mod-alt-click", async () => {
        const app = makeApp();
        const { title } = await renderTitle(app);

        title.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true, altKey: true }));

        expect(app.workspace.getLeaf).toHaveBeenCalledWith("split");
    });

    it("opens a new tab on middle-click", async () => {
        // A middle click fires auxclick, never click.
        const app = makeApp();
        const { title } = await renderTitle(app);

        const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
        title.dispatchEvent(event);

        expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(event.defaultPrevented).toBe(true);
    });

    it("leaves other auxiliary buttons alone", async () => {
        const app = makeApp();
        const { title } = await renderTitle(app);

        title.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 2 }));

        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });

    it("ignores a middle-click that missed a title", async () => {
        const app = makeApp();
        const { title } = await renderTitle(app);

        title.parentElement!.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));

        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });
});

describe("NoteRenderer title menu", () => {
    async function rightClickTitle(app: ReturnType<typeof makeApp>) {
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");
        const el = mount(renderer, await renderNote(renderer, file));
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        el.querySelector(".daily-note-title")!.dispatchEvent(event);
        const menu = app.workspace.trigger.mock.calls[0]?.[1] as Menu | undefined;
        return { file, event, menu };
    }

    it("hands the note to Obsidian's file menu, shown where the click was", async () => {
        const app = makeApp();
        const { file, event, menu } = await rightClickTitle(app);

        expect(app.workspace.trigger).toHaveBeenCalledWith("file-menu", menu, file, "daily-notes-stream");
        expect(menu?.shownAt).toBe(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("leads with the places the note can open", async () => {
        const { menu } = await rightClickTitle(makeApp());

        expect(menu?.items.map((item) => [item.title, item.icon, item.section])).toEqual([
            ["Open in new tab", "file-plus", "open"],
            ["Open to the right", "separator-vertical", "open"],
        ]);
    });

    it.each([
        [0, "tab"],
        [1, "split"],
    ])("opens the note from item %i in a %s", async (index, target) => {
        const app = makeApp();
        const { file, menu } = await rightClickTitle(app);

        menu?.items[index]?.click();

        expect(app.workspace.getLeaf).toHaveBeenCalledWith(target);
        expect(app._mockLeaf.openFile).toHaveBeenCalledWith(file);
    });

    it("leaves a right-click off the title to the page", async () => {
        const app = makeApp();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

        el.dispatchEvent(event);

        expect(app.workspace.trigger).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });
});

describe("NoteRenderer internal links", () => {
    /**
     * Internal links come from MarkdownRenderer, which is faked here. This is
     * its output.
     */
    async function renderLink(app: ReturnType<typeof makeApp>, href: string | null = "Reading list") {
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const link = el.querySelector(".daily-note-content")!.createEl("a", { cls: "internal-link" });
        if (href !== null) link.setAttribute("data-href", href);
        return { el, link, label: link.createEl("em", { text: href ?? "" }) };
    }

    function dispatch(el: HTMLElement, type: string, init: MouseEventInit = {}) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
        el.dispatchEvent(event);
        return event;
    }

    it("opens the linked note from the note it was written in", async () => {
        const app = makeApp();
        const { link } = await renderLink(app);

        const event = dispatch(link, "click");

        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list", "Notes/2025-01-01.md", false);
        expect(event.defaultPrevented).toBe(true);
    });

    // A linked mention's excerpt was written in another note, so
    // `[[Reading list]]` is resolved from there.
    it("opens a link in a linked mention from the note the excerpt came from", async () => {
        const app = makeApp();
        const { el } = await renderLink(app);
        const group = el.createDiv({ cls: "daily-note-mention" });
        group.dataset.linkSource = "Ideas/a.md";
        const link = group.createEl("a", { cls: "internal-link", attr: { "data-href": "Reading list" } });

        link.click();

        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list", "Ideas/a.md", false);
    });

    it("opens it there even when another tab shows the linked note", async () => {
        const target = new TFile("Reading list.md");
        const app = makeApp({ leaves: [{ view: makeMarkdownView(target) }] });
        app.metadataCache.getFirstLinkpathDest.mockReturnValue(target);
        const { link } = await renderLink(app);

        link.click();

        expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list", "Notes/2025-01-01.md", false);
    });

    it("hands the heading on with the link, for Obsidian to scroll to", async () => {
        const app = makeApp();
        const { link } = await renderLink(app, "Reading list#Later");

        link.click();

        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list#Later", "Notes/2025-01-01.md", false);
    });

    it("opens another tab when mod-clicked, though the note is open", async () => {
        const target = new TFile("Reading list.md");
        const app = makeApp({ leaves: [{ view: makeMarkdownView(target) }] });
        app.metadataCache.getFirstLinkpathDest.mockReturnValue(target);
        const { link } = await renderLink(app);

        dispatch(link, "click", { metaKey: true });

        expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list", "Notes/2025-01-01.md", "tab");
    });

    it("opens the link from a click on its formatted text", async () => {
        const app = makeApp();
        const { label } = await renderLink(app);

        label.click();

        expect(app.workspace.openLinkText).toHaveBeenCalled();
    });

    it.each([
        [{ metaKey: true }, "tab"],
        [{ metaKey: true, altKey: true }, "split"],
    ])("opens the link where %o asks: %s", async (modifiers, pane) => {
        const app = makeApp();
        const { link } = await renderLink(app);

        dispatch(link, "click", modifiers);

        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list", "Notes/2025-01-01.md", pane);
    });

    it("opens a new tab on middle-click", async () => {
        const app = makeApp();
        const { link } = await renderLink(app);

        dispatch(link, "auxclick", { button: 1 });

        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list", "Notes/2025-01-01.md", "tab");
    });

    it("ignores a link that names no note", async () => {
        const app = makeApp();
        const { link } = await renderLink(app, null);

        const event = dispatch(link, "click");

        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it("ignores a link outside any note, which no note could resolve", async () => {
        const app = makeApp();
        const { el } = await renderLink(app);
        const stray = el.parentElement!.createEl("a", { cls: "internal-link" });
        stray.setAttribute("data-href", "Reading list");

        stray.click();

        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("logs a link that fails to open", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const app = makeApp();
        app.workspace.openLinkText.mockRejectedValue(new Error("open failed"));
        const { link } = await renderLink(app);

        link.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(consoleSpy).toHaveBeenCalledWith("DailyNotesStream: Failed to open link", expect.any(Error));
        consoleSpy.mockRestore();
    });

    it("hands the linked note, heading stripped, to Obsidian's file menu", async () => {
        const app = makeApp();
        const target = new TFile("Reading list.md");
        app.metadataCache.getFirstLinkpathDest.mockReturnValue(target);
        const { link } = await renderLink(app, "Reading list#Fiction");

        const event = dispatch(link, "contextmenu");

        const menu = app.workspace.trigger.mock.calls[0]?.[1] as Menu;
        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Reading list", "Notes/2025-01-01.md");
        expect(app.workspace.trigger).toHaveBeenCalledWith("file-menu", menu, target, "link-context-menu");
        expect(menu.shownAt).toBe(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("opens the link, heading kept, from its menu", async () => {
        const app = makeApp();
        app.metadataCache.getFirstLinkpathDest.mockReturnValue(new TFile("Reading list.md"));
        const { link } = await renderLink(app, "Reading list#Fiction");
        dispatch(link, "contextmenu");
        const menu = app.workspace.trigger.mock.calls[0]?.[1] as Menu;

        menu.items[1]?.click();

        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Reading list#Fiction", "Notes/2025-01-01.md", "split");
    });

    it("offers only the open items for a note not yet created", async () => {
        const app = makeApp();
        const shown = vi.spyOn(Menu.prototype, "showAtMouseEvent");
        const { link } = await renderLink(app, "Someday");

        dispatch(link, "contextmenu");

        expect(app.workspace.trigger).not.toHaveBeenCalled();
        const menu = shown.mock.contexts[0] as Menu;
        expect(menu.items.map((item) => item.title)).toEqual(["Open in new tab", "Open to the right"]);
        shown.mockRestore();
    });

    it("asks Page preview to show the linked note on hover", async () => {
        const app = makeApp();
        const { link, label } = await renderLink(app);

        const event = dispatch(label, "mouseover");

        expect(app.workspace.trigger).toHaveBeenCalledWith("hover-link", {
            event,
            source: "daily-notes-stream-view",
            hoverParent: delegateComponent,
            targetEl: link,
            linktext: "Reading list",
            sourcePath: "Notes/2025-01-01.md",
        });
    });

    it("previews nothing when the pointer is not over a link", async () => {
        const app = makeApp();
        const { el } = await renderLink(app);

        dispatch(el, "mouseover");

        expect(app.workspace.trigger).not.toHaveBeenCalled();
    });
});

// On a phone a PDF is a preview of its first page (D-083).
describe("NoteRenderer PDF embeds", () => {
    async function renderPdf(app: ReturnType<typeof makeApp>) {
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const embed = el
            .querySelector(".daily-note-content")!
            .createSpan({ cls: "internal-embed pdf-embed", attr: { src: "Doc.pdf#page=2" } });
        return embed.createDiv({ cls: "pdf-container" }).createEl("canvas");
    }

    afterEach(() => {
        Platform.isMobile = false;
        vi.unstubAllGlobals();
    });

    it("opens the PDF, page kept, on a tap on mobile", async () => {
        Platform.isMobile = true;
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            }
        );
        const app = makeApp();
        const page = await renderPdf(app);

        page.click();

        expect(app.workspace.openLinkText).toHaveBeenCalledWith("Doc.pdf#page=2", "Notes/2025-01-01.md", false);
    });

    it("leaves a click to the PDF's own viewer on desktop", async () => {
        const app = makeApp();
        const page = await renderPdf(app);

        page.click();

        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// renderProperties
// ---------------------------------------------------------------------------

describe("NoteRenderer tables", () => {
    beforeEach(() => {
        Platform.isMobile = true;
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            }
        );
        return () => {
            Platform.isMobile = false;
            vi.unstubAllGlobals();
        };
    });

    /**
     * A rendered note holding one table.
     */
    async function renderTable(): Promise<HTMLElement> {
        vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce((_app, _md, el) => {
            const table = el.createEl("table");
            table.createEl("thead").createEl("tr").createEl("th", { text: "Pace" });
            table.createEl("tbody").createEl("tr").createEl("td", { text: "5:12" });
            return Promise.resolve();
        });
        const renderer = new NoteRenderer(
            asApp(makeApp()),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        return mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
    }

    // On desktop, a table scrolls sideways, as Obsidian's tables do (ADR 0008).
    it("leaves a table to Obsidian on desktop", async () => {
        Platform.isMobile = false;

        const el = await renderTable();

        expect(el.querySelector("td")?.dataset.column).toBeUndefined();
    });

    // A table too wide for a phone is stacked as cards, with each cell under
    // its column's name.
    it("names each rendered cell after its column", async () => {
        const el = await renderTable();

        expect(el.querySelector("td")?.dataset.column).toBe("Pace");
    });
});

describe("NoteRenderer equations", () => {
    beforeEach(() => {
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            }
        );
        return () => {
            Platform.isMobile = false;
            vi.unstubAllGlobals();
        };
    });

    /**
     * A rendered note holding one display equation twice as wide as the 400px
     * note. Returns its math element.
     */
    async function renderEquation(): Promise<HTMLElement> {
        vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce((_app, _md, el) => {
            const container = el.createEl("mjx-container" as "div", { attr: { display: "true" } });
            Object.defineProperty(container, "clientWidth", { value: 400 });
            Object.defineProperty(container.createEl("mjx-math" as "div"), "offsetWidth", { value: 800 });
            return Promise.resolve();
        });
        const renderer = new NoteRenderer(
            asApp(makeApp()),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        return el.querySelector<HTMLElement>("mjx-math")!;
    }

    it("shrinks a wide equation to fit on mobile", async () => {
        Platform.isMobile = true;

        const math = await renderEquation();

        expect(math.style.getPropertyValue("--daily-note-equation-zoom")).toBe("0.5");
    });

    // Desktop draws it as Obsidian does, scrolling in its own box.
    it("leaves a wide equation to Obsidian on desktop", async () => {
        const math = await renderEquation();

        expect(math.style.getPropertyValue("--daily-note-equation-zoom")).toBe("");
    });
});

describe("NoteRenderer Bases", () => {
    const BASE = "```base\nviews:\n  - type: table\n    name: T\n```";
    let renderer: NoteRenderer;

    beforeEach(() => {
        Platform.isMobile = true;
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            }
        );
        renderer = new NoteRenderer(
            asApp(makeApp({ readResult: `Before\n${BASE}\nAfter` })),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        return () => {
            Platform.isMobile = false;
            vi.unstubAllGlobals();
        };
    });

    it("leaves a Base to Obsidian on desktop", async () => {
        Platform.isMobile = false;
        const render = vi.spyOn(MarkdownRenderer, "render").mockClear();

        await renderNote(renderer, new TFile("Notes/2025-01-01.md"));

        expect(render).toHaveBeenCalledOnce();
        expect(render.mock.calls[0]![1]).toBe(`Before\n${BASE}\nAfter`);
    });

    // Each Base is drawn into its own placeholder, so it can be drawn again on
    // its own.
    it("draws each Base into a placeholder of its own", async () => {
        const render = vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce((_app, markdown, el) => {
            el.createDiv({ cls: "daily-note-base" });
            expect(markdown).toBe('Before\n<div class="daily-note-base"></div>\n\nAfter');
            return Promise.resolve();
        });

        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        expect(render).toHaveBeenLastCalledWith(
            expect.anything(),
            BASE,
            el.querySelector(".daily-note-base"),
            "Notes/2025-01-01.md",
            expect.any(Component)
        );
    });

    it("hands a changed Base file to the note's Bases", async () => {
        const spy = vi.spyOn(NoteBases.prototype, "onBaseModified").mockResolvedValue();
        const file = new TFile("Bases/Views.base");

        await renderer.onBaseModified(file);

        expect(spy).toHaveBeenCalledWith(file);
    });

    it("draws a Base's cards one to a row when the settings ask", async () => {
        renderer = new NoteRenderer(
            asApp(makeApp({ readResult: BASE })),
            new Component(),
            makeCollapsible(),
            makeSettings({ oneCardPerRow: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        // The note draws its placeholder, and the Base draws a table twice the
        // note's width.
        const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation((_app, _md, el) => {
            if (!el.matches(".daily-note-base")) el.createDiv({ cls: "daily-note-base" });
            else {
                const view = el.createDiv({ cls: "bases-view" });
                Object.defineProperty(view, "clientWidth", { get: () => 300 });
                view.createDiv({ cls: "bases-thead" }).setAttribute("style", "width: 600px");
            }
            return Promise.resolve();
        });
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        renderer.onBaseLayout(el.querySelector<HTMLElement>(".bases-view")!);

        await vi.waitFor(() => expect(render.mock.lastCall?.[1]).toContain("cardSize: 800"));
    });

    it("fits a Base it did not draw", () => {
        const view = document.createElement("div");
        Object.defineProperty(view, "clientWidth", { get: () => 300 });
        view.createDiv({ cls: "bases-thead" }).setAttribute("style", "width: 600px");

        renderer.onBaseLayout(view);

        expect(view.style.getPropertyValue("--bases-table-column-max-width")).toBe("150px");
    });
});

describe("NoteRenderer unresolved links", () => {
    /**
     * MarkdownRenderer's output for `[[Reading list]] [[Someday]]`, as the real
     * one renders it.
     */
    async function renderLinks(app: ReturnType<typeof makeApp>) {
        vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce((_app, _md, el) => {
            for (const href of ["Reading list", "Someday#Later"]) {
                el.createEl("a", { cls: "internal-link", text: href }).setAttribute("data-href", href);
            }
            el.createEl("a", { cls: "internal-link" });
            return Promise.resolve();
        });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const [existing, missing, hrefless] = [...el.querySelectorAll(".internal-link")];
        return { existing: existing!, missing: missing!, hrefless: hrefless! };
    }

    /** The cache knows these notes, and no others. */
    function resolveOnly(app: ReturnType<typeof makeApp>, ...paths: string[]) {
        app.metadataCache.getFirstLinkpathDest.mockImplementation((path: string) =>
            paths.includes(path) ? new TFile(`${path}.md`) : null
        );
    }

    it("fades a link to a note not yet created, and only that one", async () => {
        const app = makeApp();
        resolveOnly(app, "Reading list");

        const { existing, missing } = await renderLinks(app);

        expect(missing.hasClass("is-unresolved")).toBe(true);
        expect(existing.hasClass("is-unresolved")).toBe(false);
        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Someday", "Notes/2025-01-01.md");
    });

    it("leaves alone a link that names no note", async () => {
        const app = makeApp();

        const { hrefless } = await renderLinks(app);

        expect(hrefless.hasClass("is-unresolved")).toBe(false);
        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
    });

    it("unfades a link once the cache resolves the note it names", async () => {
        const app = makeApp();
        resolveOnly(app, "Reading list");
        const { missing } = await renderLinks(app);

        resolveOnly(app, "Reading list", "Someday");
        const [event, onResolved] = app.metadataCache.on.mock.calls[0]!;
        onResolved();

        expect(event).toBe("resolved");
        expect(missing.hasClass("is-unresolved")).toBe(false);
    });
});

describe("NoteRenderer renderProperties", () => {
    it("renders nothing when showProperties is false", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tags: ["daily"] } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: false }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-container")).toBeNull();
    });

    it("renders nothing when fileCache is null", async () => {
        const app = makeApp({ fileCache: null });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-container")).toBeNull();
    });

    it("renders nothing when frontmatter is null", async () => {
        const app = makeApp({ fileCache: { frontmatter: null } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-container")).toBeNull();
    });

    it("renders nothing when frontmatter has only the 'position' key", async () => {
        const app = makeApp({ fileCache: { frontmatter: { position: {} } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-container")).toBeNull();
    });

    it("renders .metadata-container when showProperties is true and frontmatter has keys", async () => {
        const app = makeApp({ fileCache: { frontmatter: { mood: "happy" } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-container")).not.toBeNull();
    });

    // Obsidian's stylesheet styles the panel by its own class names.
    it("draws each property in Obsidian's own rows, key beside value", async () => {
        const app = makeApp({ fileCache: { frontmatter: { mood: "happy" } } });
        const el = await renderWithProperties(app);
        const row = el.querySelector(".metadata-content > .metadata-properties > .metadata-property");
        expect(row?.querySelector(":scope > .metadata-property-key > .metadata-property-key-input")?.textContent).toBe(
            "mood"
        );
    });

    it("renders list values as Obsidian's pills, one per item", async () => {
        const app = makeApp({ fileCache: { frontmatter: { aliases: ["work", "daily"] } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const pills = el.querySelectorAll(".metadata-property-value .multi-select-container .multi-select-pill");
        expect([...pills].map((p) => p.textContent)).toEqual(["work", "daily"]);
        expect(el.querySelector(".multi-select-pill > .multi-select-pill-content")).not.toBeNull();
    });

    // Obsidian colors a pill as a tag based on the value's type, not its key.
    it("types a tags property so its pills take the tag colors", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tags: ["work"], aliases: ["w"] } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const values = el.querySelectorAll<HTMLElement>(".metadata-property-value");
        expect(values[0]?.dataset.propertyType).toBe("tags");
        expect(values[1]?.dataset.propertyType).toBeUndefined();
    });

    // Obsidian never splits a single value: `tags: work, daily` is one pill,
    // and not a valid tag name.
    it("shows a scalar tags value as one invalid pill, as Obsidian does", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tags: "work, daily" } } });
        const el = await renderWithProperties(app);
        const pills = [...el.querySelectorAll<HTMLElement>(".multi-select-pill")];
        expect(pills.map((p) => p.textContent)).toEqual(["work, daily"]);
        expect(pills[0]?.hasClass("is-invalid")).toBe(true);
        expect(pills[0]?.getAttribute("aria-label")).toBe("Invalid tag name");
    });

    it("marks only the tag pills that are no tag name invalid", async () => {
        const tags = ["work", "1a", "a1", "a/b", "-a_b", "é日本", "💡", "a，b", "123", "a b", "a.b", "a!", "a…", "a⸗b"];
        const app = makeApp({ fileCache: { frontmatter: { tags } } });
        const el = await renderWithProperties(app);
        const invalid = [...el.querySelectorAll(".multi-select-pill.is-invalid")].map((p) => p.textContent);
        expect(invalid).toEqual(["123", "a b", "a.b", "a!", "a…", "a⸗b"]);
    });

    it("drops a tag's leading # from its pill, but marks it invalid", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tags: ["#work", "a#b"] } } });
        const el = await renderWithProperties(app);
        const pills = [...el.querySelectorAll<HTMLElement>(".multi-select-pill")];
        expect(pills.map((p) => p.textContent)).toEqual(["work", "a#b"]);
        expect(pills[0]!.hasClass("is-invalid")).toBe(true);
    });

    it("draws a tags value that is a number as text", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tags: 2025 } } });
        const el = await renderWithProperties(app);
        expect(el.querySelector(".multi-select-pill")).toBeNull();
        expect(el.querySelector(".metadata-property-value-text")?.textContent).toBe("2025");
    });

    it("draws a 'tag' key as text, as Obsidian no longer reads it as tags", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tag: "work" } } });
        const el = await renderWithProperties(app);
        expect(el.querySelector(".multi-select-pill")).toBeNull();
        expect(el.querySelector(".metadata-property-value-text")?.textContent).toBe("work");
    });

    it("never marks a pill invalid outside a tags property", async () => {
        const app = makeApp({ fileCache: { frontmatter: { aliases: ["a b"] } } });
        const el = await renderWithProperties(app);
        expect(el.querySelector(".multi-select-pill.is-invalid")).toBeNull();
    });

    it("renders object values as JSON string", async () => {
        const app = makeApp({ fileCache: { frontmatter: { meta: { key: "val" } } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-property-value-text")?.textContent).toBe('{"key":"val"}');
    });

    it("renders boolean values as strings", async () => {
        const app = makeApp({ fileCache: { frontmatter: { published: true } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-property-value-text")?.textContent).toBe("true");
    });

    it("renders number values as strings", async () => {
        const app = makeApp({ fileCache: { frontmatter: { priority: 3 } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-property-value-text")?.textContent).toBe("3");
    });

    it("starts collapsed when propertiesCollapsed is true", async () => {
        const app = makeApp({ fileCache: { frontmatter: { x: 1 } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true, propertiesCollapsed: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-container")!.classList.contains("is-collapsed")).toBe(true);
    });

    it("unfolds a collapsed panel for a search match inside it, but not for its title", async () => {
        const app = makeApp({ fileCache: { frontmatter: { mood: "calm" } } });
        const collapsible = makeCollapsible();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            collapsible,
            makeSettings({ showProperties: true, propertiesCollapsed: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const value = el.querySelector(".metadata-property-value-text")!.firstChild!;
        const title = el.querySelector(".metadata-properties-title")!.firstChild!;

        expect(collapsible.folds(title)).toBe(false);
        collapsible.unfold(value);

        expect(el.querySelector(".metadata-container")!.classList.contains("is-collapsed")).toBe(false);
    });

    it("remembers an expanded panel across re-renders, overriding the setting", async () => {
        const app = makeApp({ fileCache: { frontmatter: { x: 1 } } });
        const collapsible = makeCollapsible();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            collapsible,
            makeSettings({ showProperties: true, propertiesCollapsed: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const file = new TFile("Notes/2025-01-01.md");

        const first = mount(renderer, await renderNote(renderer, file));
        (first.querySelector(".metadata-properties-heading > .collapse-indicator") as HTMLElement).click();

        const second = mount(renderer, await renderNote(renderer, file));
        expect(second.querySelector(".metadata-container")!.classList.contains("is-collapsed")).toBe(false);
    });

    it("toggles from the chevron", async () => {
        const app = makeApp({ fileCache: { frontmatter: { x: 1 } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        (el.querySelector(".metadata-properties-heading > .collapse-indicator") as HTMLElement).click();

        expect(el.querySelector(".metadata-container")!.classList.contains("is-collapsed")).toBe(true);
    });

    it("toggles from the heading row, as Obsidian's own panel does", async () => {
        const app = makeApp({ fileCache: { frontmatter: { x: 1 } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const container = el.querySelector(".metadata-container")!;

        // Obsidian hides this arrow unless the pointer is over the row, and a
        // phone has no pointer, so the row itself has to be the target.
        (el.querySelector(".metadata-properties-title") as HTMLElement).click();

        expect(container.classList.contains("is-collapsed")).toBe(true);
    });

    it("puts the heading outside the box, as Obsidian's own panel does", async () => {
        const app = makeApp({ fileCache: { frontmatter: { x: 1 } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        const heading = el.querySelector(".metadata-properties-heading")!;

        // The grey box is `.metadata-content`, and the heading is its sibling
        // above it.
        expect(heading.parentElement!.className).toBe("metadata-container");
        expect(heading.nextElementSibling!.className).toBe("metadata-content");
    });

    it("leaves the heading unfocusable, so clicking it draws no focus ring", async () => {
        const app = makeApp({ fileCache: { frontmatter: { x: 1 } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        // Obsidian renders a ring around this heading on :focus, and a tabindex
        // makes a click focus it. The ring then stayed around the row until
        // something else took focus. So the arrow is what the keyboard uses
        // instead.
        expect(el.querySelector(".metadata-properties-heading")!.hasAttribute("tabindex")).toBe(false);
        expect(el.querySelector(".metadata-properties-heading > .collapse-indicator")!.getAttribute("tabindex")).toBe(
            "0"
        );
    });

    async function renderIcons(
        frontmatter: Record<string, unknown>,
        metadataTypeManager?: unknown
    ): Promise<(string | undefined)[]> {
        const app = { ...makeApp({ fileCache: { frontmatter } }), metadataTypeManager };
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        return Array.from(el.querySelectorAll<HTMLElement>(".metadata-property-icon")).map((i) => i.dataset.icon);
    }

    it("takes each icon off the property type Obsidian resolves for the key", async () => {
        const getTypeInfo = vi.fn((key: string) => ({
            expected: key === "created" ? { icon: "lucide-calendar" } : null,
            inferred: { icon: "lucide-text" },
        }));
        expect(await renderIcons({ created: "2026-09-22", note: "x" }, { getTypeInfo })).toEqual([
            "lucide-calendar",
            "lucide-text",
        ]);
        expect(getTypeInfo).toHaveBeenCalledWith("created", "2026-09-22");
    });

    // The guesses from property names below are used when Obsidian no longer
    // gives access to the type manager.
    it("uses the 'tags' icon for 'tags' and 'aliases' keys", async () => {
        expect(await renderIcons({ tags: ["a"], aliases: ["c"] })).toEqual(["tags", "tags"]);
    });

    // Obsidian 1.9.10 replaced `tag` with `tags`, and now treats `tag` as text.
    it("gives a 'tag' key no tag icon", async () => {
        expect(await renderIcons({ tag: "b" })).toEqual(["file-text"]);
    });

    it("uses the 'calendar' icon for date/time/created/updated keys", async () => {
        expect(await renderIcons({ startDate: "x", bedtime: "x", created: "x", updated: "x" })).toEqual([
            "calendar",
            "calendar",
            "calendar",
            "calendar",
        ]);
    });

    it("uses the 'link' icon for 'link' and 'url' keys", async () => {
        expect(await renderIcons({ link: "http://a.com", url: "http://b.com" })).toEqual(["link", "link"]);
    });

    it("uses the 'image' icon for 'image' and 'cover' keys", async () => {
        expect(await renderIcons({ image: "img.jpg", cover: "bg.jpg" })).toEqual(["image", "image"]);
    });

    it("falls back to the 'file-text' icon for unknown keys", async () => {
        expect(await renderIcons({ customField: "value" })).toEqual(["file-text"]);
    });

    it("keeps the icon lookup case-insensitive", async () => {
        expect(await renderIcons({ Tags: ["a"] })).toEqual(["tags"]);
    });

    it("renders a null value as empty text", async () => {
        const app = makeApp({ fileCache: { frontmatter: { nullField: null } } });
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings({ showProperties: true }),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        expect(el.querySelector(".metadata-property-value-text")?.textContent).toBe("");
    });
});

describe("NoteRenderer — delegated listeners", () => {
    async function render(app: ReturnType<typeof makeApp>, delegate: boolean) {
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const root = document.createElement("div");
        document.body.appendChild(root);
        if (delegate) renderer.delegate(delegateComponent, root);
        root.appendChild(await renderNote(renderer, new TFile("Notes/2025-01-01.md")));
        return { root, link: root.querySelector(".daily-note-title") as HTMLElement };
    }

    it("binds nothing to the title itself", async () => {
        // One listener for each note would pile up on the view as notes are
        // re-rendered.
        const app = makeApp();
        const { root, link } = await render(app, false);
        link.click();
        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
        root.remove();
    });

    it("opens the note from a delegated click", async () => {
        const app = makeApp();
        const { root, link } = await render(app, true);
        link.click();
        expect(app._mockLeaf.openFile).toHaveBeenCalled();
        root.remove();
    });

    // load and error events do not bubble, so the root catches them on the way
    // down.
    it("falls a video's missing large thumbnail back to the small one", async () => {
        const { root } = await render(makeApp(), true);
        const thumbnail = youtubeThumbnail(
            document.createElement("iframe"),
            "https://www.youtube.com/embed/aqz-KE-bpKQ"
        )!;
        root.querySelector(".daily-note-content")!.appendChild(thumbnail);
        const img = thumbnail.querySelector("img")!;

        img.dispatchEvent(new Event("error"));

        expect(img.getAttribute("src")).toBe("https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg");
        root.remove();
    });

    // When the large thumbnail is missing, YouTube sends a 120px placeholder,
    // which loads.
    it("falls a video's placeholder large thumbnail back to the small one as it loads", async () => {
        const { root } = await render(makeApp(), true);
        const thumbnail = youtubeThumbnail(
            document.createElement("iframe"),
            "https://www.youtube.com/embed/aqz-KE-bpKQ"
        )!;
        root.querySelector(".daily-note-content")!.appendChild(thumbnail);
        const img = thumbnail.querySelector("img")!;

        img.dispatchEvent(new Event("load"));

        expect(img.getAttribute("src")).toBe("https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg");
        root.remove();
    });

    it("ignores a delegated click that missed a title", async () => {
        const app = makeApp();
        const { root } = await render(app, true);
        root.click();
        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
        root.remove();
    });
});

describe("NoteRenderer tag click", () => {
    /**
     * Inline tags come from MarkdownRenderer, which is faked here. This is its
     * output.
     */
    function addInlineTag(block: HTMLElement, tag: string): HTMLElement {
        const link = block.querySelector(".daily-note-content")!.createEl("a", { cls: "tag", text: tag });
        link.setAttribute("href", tag);
        return link;
    }

    it("searches for an inline tag the click landed on", async () => {
        const app = makeApp();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        addInlineTag(el, "#work").click();

        expect(app._openGlobalSearch).toHaveBeenCalledWith("tag:#work");
    });

    it("keeps the href from navigating the view away", async () => {
        const app = makeApp();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        addInlineTag(el, "#work").dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });

    it("searches for a tag pill in the properties panel", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tags: ["work", "daily"] } } });
        const el = await renderWithProperties(app);

        (el.querySelectorAll(".multi-select-pill")[1] as HTMLElement).click();

        expect(app._openGlobalSearch).toHaveBeenCalledWith("tag:#daily");
    });

    it("does not search on an invalid tag pill", async () => {
        const app = makeApp({ fileCache: { frontmatter: { tags: "work, daily" } } });
        const el = await renderWithProperties(app);

        (el.querySelector(".multi-select-pill") as HTMLElement).click();

        expect(app._openGlobalSearch).not.toHaveBeenCalled();
    });

    it("leaves a pill of a property Obsidian does not type as a tag alone", async () => {
        const app = makeApp({ fileCache: { frontmatter: { aliases: ["w"] } } });
        const el = await renderWithProperties(app);

        (el.querySelector(".multi-select-pill") as HTMLElement).click();

        expect(app._openGlobalSearch).not.toHaveBeenCalled();
    });

    it("opens the search in a new tab when the tag is cmd-clicked", async () => {
        const app = makeApp();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        addInlineTag(el, "#work").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
        await Promise.resolve();

        expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
        expect(app._searchLeaf.setViewState).toHaveBeenCalledWith({ type: "search", active: true });
        expect(app._searchLeaf.view.setQuery).toHaveBeenCalledWith("tag:#work");
    });

    it("splits the pane when the tag is cmd-alt-clicked", async () => {
        const app = makeApp();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        addInlineTag(el, "#work").dispatchEvent(
            new MouseEvent("click", { bubbles: true, metaKey: true, altKey: true })
        );

        expect(app.workspace.getLeaf).toHaveBeenCalledWith("split");
    });

    it("does not open the note when the click was on one of its tags", async () => {
        const app = makeApp();
        const renderer = new NoteRenderer(
            asApp(app),
            new Component(),
            makeCollapsible(),
            makeSettings(),
            new SearchHighlighter(),
            new BaseMeasurements(),
            new BacklinkIndex(() => ({}))
        );
        const el = mount(renderer, await renderNote(renderer, new TFile("Notes/2025-01-01.md")));

        addInlineTag(el, "#work").click();

        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });
});
