import { vi } from "vitest";
import { DailyNotesStreamView } from "../src/ui/stream-view";
import type DailyNotesStreamPlugin from "../src/main";
import type { DailyNoteService } from "../src/notes/daily-note-service";
import type { NoteRenderer } from "../src/render/note-renderer";
import type { CollapsibleManager } from "../src/render/collapsible";
import type { NoteWindowManager } from "../src/stream/note-window";
import type { InfiniteScrollController } from "../src/stream/infinite-scroll";
import { Component, WorkspaceLeaf, type App, type EventRef, type TFile } from "./mocks/obsidian";
import { __setMockNotes } from "./mocks/daily-notes";
import { CollapsibleStateStore } from "../src/render/collapse-store";
import { BacklinkIndex } from "../src/notes/backlink-index";
import { LinkChanges } from "../src/notes/link-changes";
import { LayoutMemory } from "../src/stream/layout-memory";

/** A fake `T`, holding only the members a test uses. */
export function fake<T>(members: Partial<T>): T {
    return members as T;
}

/** A fake app, passed to code that expects the real `App` type. */
export function asApp(stub: object): App {
    return stub as App;
}

/** A fake service holding no notes. */
export function makeService(): DailyNoteService {
    return fake<DailyNoteService>({
        getBatch: vi.fn().mockReturnValue([]),
        extendStream: vi.fn().mockReturnValue([]),
        streamedNotes: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
        refreshIfSettingsChanged: vi.fn().mockResolvedValue(false),
        catchUpDay: vi.fn().mockReturnValue([]),
        insertSorted: vi.fn().mockReturnValue(null),
        removeSorted: vi.fn().mockReturnValue(-1),
        indexOf: vi.fn().mockReturnValue(-1),
        isToday: vi.fn().mockReturnValue(false),
        belongs: vi.fn().mockResolvedValue(false),
        hidesAny: vi.fn().mockReturnValue(false),
        indexForDate: vi.fn().mockReturnValue(-1),
        dates: vi.fn().mockReturnValue([]),
        formatDate: vi.fn().mockReturnValue(""),
        parseNoteDate: vi.fn().mockReturnValue(null),
        length: 0,
        streamLength: 0,
    });
}

/**
 * A minimal fake plugin, with what DailyNotesStreamView's constructor needs.
 */
export function makePlugin(): DailyNotesStreamPlugin {
    const app = makeApp();
    return fake<DailyNotesStreamPlugin>({
        settings: {
            showProperties: false,
            propertiesCollapsed: false,
            showLinkedMentions: false,
            linkedMentionsCollapsed: false,
            hideEmptyNotes: false,
            oneCardPerRow: false,
        },
        collapseStore: new CollapsibleStateStore(asApp(app)),
        layoutMemory: new LayoutMemory(asApp(app)),
        backlinks: new BacklinkIndex(() => ({})),
        linkChanges: new LinkChanges(
            () => ({}),
            () => ""
        ),
    });
}

/**
 * An event source's `on`, which records each callback so the test can call it.
 */
const events = () => vi.fn((_name: string, _callback: (...args: unknown[]) => unknown): EventRef => ({}));

/** A minimal fake App, with what the view and NoteRenderer use. */
export function makeApp() {
    return {
        vault: {
            configDir: ".obsidian",
            on: events(),
            cachedRead: vi.fn((_file: TFile) => Promise.resolve("")),
            getFileByPath: vi.fn((_path: string): TFile | null => null),
        },
        workspace: {
            on: events(),
            openLinkText: vi.fn().mockResolvedValue(undefined),
            getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) }),
        },
        metadataCache: {
            getFileCache: vi.fn().mockReturnValue({ frontmatter: null }),
            on: events(),
        },
        loadLocalStorage: vi.fn().mockReturnValue(null),
        saveLocalStorage: vi.fn(),
    };
}

/** Runs all waiting microtasks, so .then() callbacks run. */
export function flushPromises(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A view whose renderer, scroll controller and DOM lookups are fakes, not yet
 * opened. For tests that must do something between creating the view and
 * onOpen.
 */
export function makeStubbedView(app: object = makeApp()) {
    __setMockNotes([]);
    const plugin = makePlugin();
    const service = makeService();
    const view = new DailyNotesStreamView(new WorkspaceLeaf(asApp(app)), plugin, service);
    view["renderer"] = fake<NoteRenderer>({
        createBlock: vi.fn(() => document.createElement("div")),
        renderInto: vi.fn().mockResolvedValue({ component: new Component(), footer: Promise.resolve() }),
        discard: vi.fn(),
        delegate: vi.fn(),
        onBaseModified: vi.fn().mockResolvedValue(undefined),
    });
    // The window manager returns empty blocks. Rendering is its job.
    Object.assign(view["stream"], {
        window: fake<NoteWindowManager>({
            attach: vi.fn(),
            detach: vi.fn(),
            add: vi.fn(() => document.createElement("div")),
            remove: vi.fn(),
            refresh: vi.fn().mockResolvedValue(undefined),
            render: vi.fn(),
            onResize: vi.fn(),
            onScroll: vi.fn(),
            onTouch: vi.fn(),
            onFingerDown: vi.fn(),
            onBaseResized: vi.fn(),
            onFingerUp: vi.fn(),
            scrollToTop: vi.fn(),
            forgetHeights: vi.fn(),
            handOver: vi.fn(),
            layoutChanges: 0,
        }),
    });
    view["collapsible"] = fake<CollapsibleManager>({ delegate: vi.fn() });
    view["stream"]["scroll"] = fake<InfiniteScrollController>({
        attach: vi.fn(),
        detach: vi.fn(),
        recheck: vi.fn(),
        getSentinel: vi.fn().mockReturnValue(null),
    });
    return { view, plugin, service };
}

/** A view with fakes, opened. */
export async function makeViewSetup(app: object = makeApp()) {
    const setup = makeStubbedView(app);
    await setup.view.onOpen();
    return setup;
}
