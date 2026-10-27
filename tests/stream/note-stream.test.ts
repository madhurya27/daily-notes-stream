import { describe, it, expect, beforeEach, afterEach, vi, type Mocked } from "vitest";
import { Notice, Platform, TAbstractFile, TFile, moment } from "../mocks/obsidian";
import { NoteStream } from "../../src/stream/note-stream";
import type { NoteRenderer } from "../../src/render/note-renderer";
import type { NoteWindowManager } from "../../src/stream/note-window";
import type { InfiniteScrollController } from "../../src/stream/infinite-scroll";
import type { ScrollBoxGuard } from "../../src/stream/scroll-box-guard";
import type { FrameDeferral } from "../../src/stream/frame-deferral";
import { DailyNoteService, type NoteFilter } from "../../src/notes/daily-note-service";
import { ParsedDates } from "../../src/notes/parsed-dates";
import { __mockSettings, __setMockSettings } from "../mocks/daily-notes";
import { NoteHeights } from "../../src/stream/note-heights";
import { youtubeThumbnail } from "../../src/render/video-thumbnails";
import { webPageLink } from "../../src/render/web-page-links";
import { BASE_SLOT_CLASS } from "../../src/render/bases/bases-as-cards";
import { flushPromises } from "../stream-view-fixture";
import { SCROLL_IDLE_MS } from "../../src/stream/scroll-anchor";
import { STALL_MS } from "../../src/stream/stall-warning";

/** What the stream created its window with, besides what it calls on it. */
type FakeWindow = Omit<Mocked<NoteWindowManager>, "enqueue" | "layoutChanges"> & {
    /** The stream's queue, which the window's renders run through. */
    enqueue: (task: () => Promise<void>) => Promise<void>;
    /** A getter on the real one. A test counts a render by hand. */
    layoutChanges: number;
    memory: {
        heights: NoteHeights;
        layoutOf: () => string;
    };
};
type FakeScroll = Mocked<InfiniteScrollController>;
type FakeGuard = Mocked<ScrollBoxGuard>;
type FakeFrames = Mocked<FrameDeferral>;
/** What the stream created each one with, besides what it calls on it. */
const fakes = vi.hoisted(() => ({
    windows: [] as FakeWindow[],
    scrolls: [] as FakeScroll[],
    guards: [] as FakeGuard[],
    frames: [] as FakeFrames[],
}));

// Both need a layout, which jsdom does not have, and have their own tests. The
// window manager returns empty blocks with the same keys the renderer uses.
vi.mock("../../src/stream/note-window", () => ({
    NoteWindowManager: class {
        attach = vi.fn();
        detach = vi.fn();
        remove = vi.fn();
        render = vi.fn();
        onResize = vi.fn();
        forgetHeights = vi.fn();
        onScroll = vi.fn();
        onTouch = vi.fn();
        onFingerDown = vi.fn();
        onFingerUp = vi.fn();
        refresh = vi.fn().mockResolvedValue(undefined);
        placed = vi.fn();
        handOver = vi.fn();
        layoutChanges = 0;
        memory: unknown;
        add = vi.fn((file: { path: string }) => placeholder(file.path));
        constructor(
            _renderer: unknown,
            readonly enqueue: (task: () => Promise<void>) => Promise<void>,
            heights: NoteHeights,
            layoutOf: () => string
        ) {
            this.memory = { heights, layoutOf };
            fakes.windows.push(this as unknown as FakeWindow);
        }
    },
}));

vi.mock("../../src/stream/infinite-scroll", () => ({
    InfiniteScrollController: class {
        attach = vi.fn();
        detach = vi.fn();
        recheck = vi.fn();
        getSentinel = vi.fn().mockReturnValue(null);
        constructor() {
            fakes.scrolls.push(this as unknown as FakeScroll);
        }
    },
}));

// Reads computed styles and Bases' layout, and has its own tests.
vi.mock("../../src/stream/scroll-box-guard", () => ({
    ScrollBoxGuard: class {
        attach = vi.fn();
        detach = vi.fn();
        onScroll = vi.fn();
        onTouch = vi.fn();
        constructor(readonly onBaseLayout: (view: HTMLElement) => void) {
            fakes.guards.push(this as unknown as FakeGuard);
        }
    },
}));

// Watches the DOM for frames, and has its own tests.
vi.mock("../../src/stream/frame-deferral", () => ({
    FrameDeferral: class {
        attach = vi.fn();
        detach = vi.fn();
        onScroll = vi.fn();
        constructor(
            readonly standIn: unknown,
            readonly wrapper: unknown
        ) {
            fakes.frames.push(this as unknown as FakeFrames);
        }
    },
}));

function placeholder(path: string): HTMLElement {
    const block = document.createElement("div");
    block.dataset.sourcePath = path;
    return block;
}

const note = (date: string) => new TFile(`Notes/${date}.md`);

/** `count` notes, newest first, one per day back from 2025-01-30. */
function makeNotes(count = 30): TFile[] {
    return Array.from({ length: count }, (_, i) => note(moment("2025-01-30").subtract(i, "days").format("YYYY-MM-DD")));
}

/** A frame, at the fake clock's 60 fps. */
const FRAME_MS = 16;

/**
 * A Base that `file` draws as it renders, before its query has run. Uses the
 * fake clock from here on.
 */
function loadingBase(file: TFile): HTMLElement {
    vi.useFakeTimers();
    const view = document.createElement("div");
    view.addClass("bases-cards-container", "is-loading");
    noteWindow.render.mockImplementation((block: HTMLElement) => {
        if (block.dataset.sourcePath === file.path) block.createDiv({ cls: BASE_SLOT_CLASS }).appendChild(view);
    });
    return view;
}

/**
 * Obsidian renames the TFile object itself, name included, before the event
 * arrives.
 */
function renameInPlace(file: TFile, path: string): TFile {
    const { name, basename, extension } = new TFile(path);
    return Object.assign(file, { path, name, basename, extension });
}

/** The vault's markdown files. */
let vault: TFile[];
/**
 * Paths the filter hides, except today's, as the real filter does. Hiding
 * another path lists the notes again.
 */
let hidden: Set<string>;
let service: DailyNoteService;
let stream: NoteStream;
let pane: HTMLElement;
let container: HTMLElement;
let noteWindow: FakeWindow;
let infiniteScroll: FakeScroll;
let guard: FakeGuard;
let frames: FakeFrames;
let renderer: { onBaseLayout: ReturnType<typeof vi.fn> };
let heights: NoteHeights;
let notesChanged: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
    Notice.reset();
    __setMockSettings({ format: "YYYY-MM-DD", folder: "Notes" });
    vault = [];
    hidden = new Set();
    const filter: NoteFilter = {
        prepare: () => Promise.resolve(),
        recheck: () => Promise.resolve(),
        isHidden: (file, date) => hidden.has(file.path) && !date.isSame(Date.now(), "day"),
        signature: () => [...hidden].join("\n"),
    };
    service = new DailyNoteService(() => vault, __mockSettings, new ParsedDates(), filter);
    renderer = { onBaseLayout: vi.fn() };
    heights = new NoteHeights();
    notesChanged = vi.fn<() => void>();
    stream = new NoteStream(service, renderer as unknown as NoteRenderer, { notes: heights }, notesChanged);
    noteWindow = fakes.windows.at(-1)!;
    infiniteScroll = fakes.scrolls.at(-1)!;
    guard = fakes.guards.at(-1)!;
    frames = fakes.frames.at(-1)!;
    pane = document.createElement("div");
    container = pane.createDiv();
    stream.open(pane, container);
});

/** The vault holds `files`, and the service lists them. */
async function listed(...files: TFile[]) {
    vault = files;
    await service.initialize();
}

/** Lists `files` and loads the first batch, then forgets every call it made. */
async function load(...files: TFile[]) {
    await listed(...files);
    await stream.loadMoreNotes();
    vi.clearAllMocks();
}

/** The filter hides `files` from now on. */
const hide = (...files: TFile[]) => files.forEach((file) => hidden.add(file.path));

/** The paths of the stream's blocks, in order. */
const shown = () => [...container.querySelectorAll<HTMLElement>("[data-source-path]")].map((b) => b.dataset.sourcePath);

const emptyState = () => container.querySelector(".daily-notes-empty-state");

/**
 * Lays out the blocks as the browser stacks them, each 540px tall, with the
 * first one's top at `top`.
 */
function stack(top: number) {
    container.querySelectorAll<HTMLElement>("[data-source-path]").forEach((block, i) => {
        block.getBoundingClientRect = () => ({ top: top + i * 540, bottom: top + (i + 1) * 540 }) as DOMRect;
    });
}

afterEach(() => {
    // Clears its midnight timer.
    stream.close();
    vi.useRealTimers();
});

describe("loading a batch", () => {
    it("places a block per note and holds them for the next batch", async () => {
        await load(note("2025-01-03"), note("2025-01-01"));

        expect(shown()).toEqual(["Notes/2025-01-03.md", "Notes/2025-01-01.md"]);
        expect(service.streamLength).toBe(2);
    });

    it("tells the window once every note is loaded", async () => {
        const loadedToEnd = noteWindow.attach.mock.calls.at(-1)![2];

        await load(...makeNotes(15));
        expect(loadedToEnd()).toBe(false);
        await stream.loadMoreNotes();
        expect(loadedToEnd()).toBe(true);
    });

    it("shows the empty state when the first batch is empty", async () => {
        await load();
        expect(emptyState()).not.toBeNull();
    });

    it("says so when there are daily notes, but every one is hidden", async () => {
        const file = note("2025-01-01");
        hide(file);
        await load(file);
        expect(emptyState()?.textContent).toMatch(/hidden/);
    });

    it("says there are no daily notes when none is hidden", async () => {
        await load();
        expect(emptyState()?.textContent).toMatch(/No daily notes found/);
    });

    it("shows no empty state when the stream simply ran out", async () => {
        await load(note("2025-01-01"));
        await stream.loadMoreNotes();
        expect(emptyState()).toBeNull();
    });

    it("clears the empty state once notes exist", async () => {
        await load();
        stream.onFileCreate(note("2025-01-01"));
        await stream.loadMoreNotes();
        expect(emptyState()).toBeNull();
    });

    it("does not double-load when the observer fires again while a load is in flight", async () => {
        await listed(...makeNotes());

        await Promise.all([stream.loadMoreNotes(), stream.loadMoreNotes()]);

        expect(service.streamLength).toBe(10);
    });

    it("keeps a note deleted mid-load out of the stream", async () => {
        const kept = note("2025-01-03");
        const doomed = note("2025-01-02");
        await listed(kept, doomed);

        const loading = stream.loadMoreNotes();
        stream.onFileDelete(doomed);
        await loading;
        await flushPromises();

        expect(shown()).toEqual([kept.path]);
        expect(service.streamLength).toBe(1);
    });

    it("rechecks the sentinel after a non-empty batch so a short batch keeps loading", async () => {
        await listed(note("2025-01-01"));
        await stream.loadMoreNotes();
        expect(infiniteScroll.recheck).toHaveBeenCalledOnce();
    });

    it("does not recheck after an empty batch (would loop forever)", async () => {
        await stream.loadMoreNotes();
        expect(infiniteScroll.recheck).not.toHaveBeenCalled();
    });

    it("places the blocks above the sentinel", async () => {
        const sentinel = container.createDiv();
        infiniteScroll.getSentinel.mockReturnValue(sentinel);

        await load(note("2025-01-02"), note("2025-01-01"));

        expect(container.lastElementChild).toBe(sentinel);
    });

    it("arms the sentinel to load the next batch", async () => {
        await listed(note("2025-01-01"));
        const [, , onTrigger] = infiniteScroll.attach.mock.calls.at(-1)!;
        await onTrigger();
        expect(shown()).toEqual(["Notes/2025-01-01.md"]);
    });
});

describe("a note created", () => {
    it("does nothing for a non-TFile argument", async () => {
        const insert = vi.spyOn(service, "insertSorted");
        stream.onFileCreate(new TAbstractFile("not-a-tfile"));
        await flushPromises();
        expect(insert).not.toHaveBeenCalled();
    });

    it("ignores files that are not daily notes", async () => {
        stream.onFileCreate(new TFile("Notes/Template.md"));
        await flushPromises();

        expect(shown()).toEqual([]);
        expect(service.length).toBe(0);
    });

    it("lands in its place within the loaded range, and the next batch starts after it", async () => {
        await load(note("2025-01-04"), note("2025-01-03"));

        stream.onFileCreate(note("2025-01-05"));
        await flushPromises();

        expect(shown()).toEqual(["Notes/2025-01-05.md", "Notes/2025-01-04.md", "Notes/2025-01-03.md"]);
        expect(service.streamLength).toBe(3);
    });

    it("is left to the sentinel when it lands beyond the loaded range", async () => {
        await load(...makeNotes());

        stream.onFileCreate(note("2024-12-01"));
        await flushPromises();

        expect(shown()).toHaveLength(10);
        expect(infiniteScroll.recheck).toHaveBeenCalledOnce();
    });

    it("inserts two rapidly created notes in order, each seeing the previous insert", async () => {
        await load(note("2025-01-01"));

        stream.onFileCreate(note("2025-01-03"));
        stream.onFileCreate(note("2025-01-02"));
        await flushPromises();

        expect(shown()).toEqual(["Notes/2025-01-03.md", "Notes/2025-01-02.md", "Notes/2025-01-01.md"]);
    });

    it("is left to the sentinel when it is the first note in an empty stream", async () => {
        stream.onFileCreate(note("2025-01-01"));
        await flushPromises();

        expect(shown()).toEqual([]);
        expect(infiniteScroll.recheck).toHaveBeenCalledOnce();
    });

    it("logs when its placeholder cannot be built", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await load(note("2025-01-04"));
        noteWindow.add.mockImplementation(() => {
            throw new Error("create failed");
        });

        stream.onFileCreate(note("2025-01-05"));
        await flushPromises();

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

describe("an event before the stream opens", () => {
    // The view listens while its notes are listed. What it hears waits until
    // there is a container to change.
    it("waits for open, then applies", async () => {
        const unopened = new NoteStream(service, renderer as unknown as NoteRenderer, {
            notes: heights,
        });
        const doomed = note("2025-01-01");
        await listed(doomed);

        unopened.onFileDelete(doomed);
        await flushPromises();
        expect(service.length).toBe(1);

        unopened.open(document.createElement("div"), document.createElement("div"));
        await flushPromises();
        expect(service.length).toBe(0);
    });
});

describe("a note deleted", () => {
    it("does nothing for a non-TFile argument", async () => {
        const remove = vi.spyOn(service, "removeSorted");
        stream.onFileDelete(new TAbstractFile("not-a-tfile"));
        await flushPromises();
        expect(remove).not.toHaveBeenCalled();
    });

    it("leaves the stream when it was loaded", async () => {
        const doomed = note("2025-01-01");
        await load(doomed);
        const block = stream.blockOf(doomed);

        stream.onFileDelete(doomed);
        await flushPromises();

        expect(noteWindow.remove).toHaveBeenCalledExactlyOnceWith(block);
        expect(shown()).toEqual([]);
        expect(service.length).toBe(0);
        expect(service.streamLength).toBe(0);
    });

    it("leaves the loaded notes alone when it was beyond them", async () => {
        const notes = makeNotes();
        await load(...notes);

        stream.onFileDelete(notes[25]!);
        await flushPromises();

        expect(noteWindow.remove).not.toHaveBeenCalled();
        expect(shown()).toEqual(notes.slice(0, 10).map((n) => n.path));
        expect(service.streamLength).toBe(10);
    });

    it("shows the empty state when it was the vault's last daily note", async () => {
        const last = note("2025-01-01");
        await load(last);

        stream.onFileDelete(last);
        await flushPromises();

        expect(emptyState()).not.toBeNull();
    });

    it("shows no empty state while other daily notes remain", async () => {
        const doomed = note("2025-01-01");
        await load(doomed, note("2024-12-31"));

        stream.onFileDelete(doomed);
        await flushPromises();

        expect(emptyState()).toBeNull();
    });
});

describe("a note renamed", () => {
    it("does nothing for a non-TFile argument", async () => {
        const remove = vi.spyOn(service, "removeSorted");
        stream.onFileRename(new TAbstractFile("x"), "old.md");
        await flushPromises();
        expect(remove).not.toHaveBeenCalled();
    });

    // The block was indexed by the old path when it was added.
    it("moves to its new sorted position, found by its old path", async () => {
        const renamed = note("2025-01-01");
        await load(note("2025-01-02"), renamed);

        stream.onFileRename(renameInPlace(renamed, "Notes/2025-01-05.md"), "Notes/2025-01-01.md");
        await flushPromises();

        expect(shown()).toEqual(["Notes/2025-01-05.md", "Notes/2025-01-02.md"]);
        expect(service.streamLength).toBe(2);
    });

    it("leaves the stream when renamed out of the daily-note format", async () => {
        const renamed = note("2025-01-01");
        await load(renamed);

        stream.onFileRename(renameInPlace(renamed, "Notes/Template.md"), "Notes/2025-01-01.md");
        await flushPromises();

        expect(shown()).toEqual([]);
        expect(service.streamLength).toBe(0);
    });
});

describe("a note modified", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("does nothing for a non-TFile argument", async () => {
        stream.onFileModify(new TAbstractFile("not-a-tfile"));
        await vi.runAllTimersAsync();
        expect(noteWindow.refresh).not.toHaveBeenCalled();
    });

    it("renders nothing until the window elapses", async () => {
        await load(note("2025-01-01"));
        stream.onFileModify(note("2025-01-01"));
        vi.advanceTimersByTime(299);
        expect(noteWindow.refresh).not.toHaveBeenCalled();
    });

    it("collapses a burst of saves into one re-render", async () => {
        const file = note("2025-01-01");
        await load(file);
        for (let i = 0; i < 5; i++) {
            stream.onFileModify(file);
            vi.advanceTimersByTime(100);
        }
        await vi.runAllTimersAsync();
        expect(noteWindow.refresh).toHaveBeenCalledTimes(1);
    });

    it("re-renders every file touched during the window", async () => {
        await load(note("2025-01-02"), note("2025-01-01"));
        stream.onFileModify(note("2025-01-01"));
        stream.onFileModify(note("2025-01-02"));
        await vi.runAllTimersAsync();
        expect(noteWindow.refresh).toHaveBeenCalledTimes(2);
    });

    it("re-renders a note saved once, not again for the next note saved", async () => {
        const [first, second] = [note("2025-01-02"), note("2025-01-01")];
        await load(first, second);

        stream.onFileModify(first);
        await vi.runAllTimersAsync();
        stream.onFileModify(second);
        await vi.runAllTimersAsync();

        expect(noteWindow.refresh).toHaveBeenCalledTimes(2);
    });

    // Every change waits for its turn, so one that never finishes holds back
    // every note (D-164).
    it("logs a change still running after the stall time", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        await load(note("2025-01-01"));

        void noteWindow.enqueue(() => new Promise(() => {}));
        await vi.advanceTimersByTimeAsync(STALL_MS);

        expect(logged).toHaveBeenCalledWith(expect.stringContaining("A change to the stream has run for"));
        logged.mockRestore();
    });

    it("drops a pending re-render when the stream closes", async () => {
        await load(note("2025-01-01"));
        stream.onFileModify(note("2025-01-01"));
        stream.close();
        await vi.runAllTimersAsync();
        expect(noteWindow.refresh).not.toHaveBeenCalled();
    });

    it("drops renders still queued when the stream closes", async () => {
        await load(note("2025-01-01"));
        const render = vi.fn().mockResolvedValue(undefined);
        void noteWindow.enqueue(render);
        stream.close();
        await vi.runAllTimersAsync();
        expect(render).not.toHaveBeenCalled();
    });

    it("does nothing for a note that is not loaded", async () => {
        const notes = makeNotes();
        await load(...notes);
        stream.onFileModify(notes[20]!);
        await vi.runAllTimersAsync();
        expect(noteWindow.refresh).not.toHaveBeenCalled();
    });

    // The block stays. Only its content is re-rendered, so the note can still
    // be found by its path, and an empty note is rendered when it comes back.
    it("refreshes the note's own block rather than replacing it", async () => {
        const file = note("2025-01-01");
        await load(file);
        const block = stream.blockOf(file);

        stream.onFileModify(file);
        await vi.runAllTimersAsync();

        expect(noteWindow.refresh).toHaveBeenCalledWith(block);
        expect(stream.blockOf(file)).toBe(block);
    });

    it("takes out a loaded note that is hidden now", async () => {
        const [kept, doomed] = [note("2025-01-02"), note("2025-01-01")];
        await load(kept, doomed);
        hide(doomed);

        stream.onFileModify(doomed);
        await vi.runAllTimersAsync();

        expect(shown()).toEqual([kept.path]);
        expect(noteWindow.refresh).not.toHaveBeenCalled();
        expect(service.streamLength).toBe(1);
    });

    it("says every note is hidden once the last one is", async () => {
        const file = note("2025-01-01");
        await load(file);
        hide(file);

        stream.onFileModify(file);
        await vi.runAllTimersAsync();

        expect(emptyState()?.textContent).toMatch(/hidden/);
    });

    it("puts back a note no longer hidden, in its place", async () => {
        const shownAgain = note("2025-01-02");
        hide(shownAgain);
        await load(note("2025-01-03"), shownAgain, note("2025-01-01"));
        hidden.clear();

        stream.onFileModify(shownAgain);
        await vi.runAllTimersAsync();

        expect(shown()).toEqual(["Notes/2025-01-03.md", "Notes/2025-01-02.md", "Notes/2025-01-01.md"]);
        expect(service.streamLength).toBe(3);
        expect(noteWindow.refresh).not.toHaveBeenCalled();
    });

    it("logs when the re-render rejects", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await load(note("2025-01-01"));
        noteWindow.refresh.mockRejectedValue(new Error("render failed"));

        stream.onFileModify(note("2025-01-01"));
        await vi.runAllTimersAsync();

        expect(consoleSpy).toHaveBeenCalledWith("DailyNotesStream: Failed to update the stream", expect.any(Error));
        consoleSpy.mockRestore();
    });
});

describe("links to daily notes changed", () => {
    it("takes out a loaded note that is hidden now, rendering nothing", async () => {
        const [kept, unlinked] = [note("2025-01-02"), note("2025-01-01")];
        await load(kept, unlinked);
        hide(unlinked);

        await stream.onLinksChanged([unlinked]);

        expect(shown()).toEqual([kept.path]);
        expect(service.streamLength).toBe(1);
    });

    it("puts back a note no longer hidden, in its place", async () => {
        const linked = note("2025-01-02");
        hide(linked);
        await load(note("2025-01-03"), linked, note("2025-01-01"));
        hidden.clear();

        await stream.onLinksChanged([linked]);

        expect(shown()).toEqual(["Notes/2025-01-03.md", "Notes/2025-01-02.md", "Notes/2025-01-01.md"]);
    });

    // Its linked mentions render themselves again on `resolved`.
    it("leaves a note that stays alone", async () => {
        const file = note("2025-01-01");
        await load(file);

        await stream.onLinksChanged([file]);

        expect(noteWindow.refresh).not.toHaveBeenCalled();
        expect(shown()).toEqual([file.path]);
    });
});

// Nothing runs at midnight: the next change catches up (ADR 0011).
describe("the day's turn", () => {
    const [older, yesterday, ahead] = [note("2025-01-01"), note("2025-01-02"), note("2025-01-03")];

    beforeEach(() => vi.useFakeTimers({ now: new Date(2025, 0, 2, 12), toFake: ["Date"] }));

    it("leaves the day's empty note shown past midnight, and hides it on the next change", async () => {
        hide(yesterday);
        await load(yesterday, older);

        vi.setSystemTime(new Date(2025, 0, 3, 0, 30));
        expect(shown()).toEqual([yesterday.path, older.path]);

        await stream.onLinksChanged([]);

        expect(shown()).toEqual([older.path]);
    });

    // The reader's own scrolling moves nothing at the top under them.
    it("leaves the day's empty note to a vault change or midnight, not a load or render the scroll asks for", async () => {
        hide(yesterday);
        await load(yesterday, older);

        vi.setSystemTime(new Date(2025, 0, 3, 0, 30));
        await stream.loadMoreNotes();
        await noteWindow.enqueue(async () => {});

        expect(shown()).toEqual([yesterday.path, older.path]);
    });

    it("shows an empty note made ahead on the first change of its day", async () => {
        hide(ahead);
        await load(ahead, yesterday);
        expect(shown()).toEqual([yesterday.path]);

        vi.setSystemTime(new Date(2025, 0, 3, 0, 30));
        await stream.refresh();

        expect(shown()).toEqual([ahead.path, yesterday.path]);
    });

    describe("with the stream open and still at midnight", () => {
        /**
         * Opens a stream again with the fake clock, so its midnight timer is
         * fake.
         */
        beforeEach(() => {
            stream.close();
            vi.useFakeTimers({ now: new Date(2025, 0, 2, 12) });
            stream = new NoteStream(service, renderer as unknown as NoteRenderer, { notes: heights }, notesChanged);
            noteWindow = fakes.windows.at(-1)!;
            infiniteScroll = fakes.scrolls.at(-1)!;
            stream.open(pane, container);
        });

        const HOURS = 60 * 60 * 1000;

        it("shows a note made ahead shortly after midnight, with no change to prompt it", async () => {
            hide(ahead);
            await load(ahead, yesterday);

            await vi.advanceTimersByTimeAsync(12 * HOURS - 1000);
            expect(shown()).toEqual([yesterday.path]);
            await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

            expect(shown()).toEqual([ahead.path, yesterday.path]);
        });

        it("waits while the reader scrolls, touches or wheels, and catches up once they stop", async () => {
            hide(ahead);
            await load(ahead, yesterday);
            // Midnight's timer has fired, and the catch-up waits for the
            // reader.
            await vi.advanceTimersByTimeAsync(12 * HOURS + 60 * 1000);

            for (const interact of [() => stream.onScroll(), () => stream.onTouch(null), () => stream.onWheel()]) {
                await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 100);
                interact();
            }
            await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
            expect(shown()).toEqual([yesterday.path]);
            await vi.advanceTimersByTimeAsync(1);

            expect(shown()).toEqual([ahead.path, yesterday.path]);
        });

        it("catches up on nothing while the reader moves before midnight", async () => {
            const catchUp = vi.spyOn(service, "catchUpDay");

            stream.onScroll();
            await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

            expect(catchUp).not.toHaveBeenCalled();
        });

        it("catches up once a midnight, not again as the reader moves after", async () => {
            await vi.advanceTimersByTimeAsync(12 * HOURS + 60 * 1000 + SCROLL_IDLE_MS);
            const catchUp = vi.spyOn(service, "catchUpDay");

            stream.onScroll();
            await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

            expect(catchUp).not.toHaveBeenCalled();
        });

        it("leaves no timer running once closed", async () => {
            await load(note("2025-01-01"));
            // Midnight's timer has fired, and the catch-up waits for the
            // reader.
            await vi.advanceTimersByTimeAsync(12 * HOURS + 60 * 1000);
            stream.onFileModify(note("2025-01-01"));
            stream.onDailyNoteSettingsChange();

            stream.close();

            expect(vi.getTimerCount()).toBe(0);
        });

        it("catches up again the next midnight", async () => {
            const after = note("2025-01-04");
            hide(ahead, after);
            await load(after, ahead, yesterday);

            await vi.advanceTimersByTimeAsync(36 * HOURS + 2 * 60 * 1000);

            expect(shown()).toEqual([after.path, yesterday.path]);
        });
    });
});

describe("what the stream announces", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("announces a daily note created, once the service lists it", async () => {
        await load(note("2025-01-01"));
        const file = note("2025-01-02");
        const indexes: number[] = [];
        notesChanged.mockImplementation(() => indexes.push(service.indexOf(file.path)));

        stream.onFileCreate(file);
        await vi.runAllTimersAsync();

        expect(indexes).toEqual([0]);
    });

    it("announces a daily note created beyond the loaded range", async () => {
        await load(...makeNotes());

        stream.onFileCreate(note("2024-12-01"));
        await vi.runAllTimersAsync();

        expect(notesChanged).toHaveBeenCalledOnce();
    });

    it("announces nothing for a file that is not a daily note", async () => {
        await load(note("2025-01-01"));

        stream.onFileCreate(new TFile("Notes/Template.md"));
        stream.onFileModify(new TFile("Notes/Template.md"));
        stream.onFileDelete(new TFile("Notes/Template.md"));
        await vi.runAllTimersAsync();

        expect(notesChanged).not.toHaveBeenCalled();
    });

    it("announces a listed note deleted, once the service drops it", async () => {
        const file = note("2025-01-01");
        await load(file, note("2024-12-31"));
        const indexes: number[] = [];
        notesChanged.mockImplementation(() => indexes.push(service.indexOf(file.path)));

        stream.onFileDelete(file);
        await vi.runAllTimersAsync();

        expect(indexes).toEqual([-1]);
    });

    it("announces a listed note renamed", async () => {
        const file = note("2025-01-01");
        await load(file);

        stream.onFileRename(renameInPlace(file, "Notes/2025-01-05.md"), "Notes/2025-01-01.md");
        await vi.runAllTimersAsync();

        expect(notesChanged).toHaveBeenCalled();
    });

    it("announces a listed note saved, after its re-render", async () => {
        const file = note("2025-01-01");
        await load(file);
        const rendered: boolean[] = [];
        notesChanged.mockImplementation(() => rendered.push(noteWindow.refresh.mock.calls.length > 0));

        stream.onFileModify(file);
        await vi.runAllTimersAsync();

        expect(rendered).toEqual([true]);
    });

    it("announces a listed note saved beyond the loaded range", async () => {
        const notes = makeNotes();
        await load(...notes);

        stream.onFileModify(notes[20]!);
        await vi.runAllTimersAsync();

        expect(notesChanged).toHaveBeenCalledOnce();
    });

    it("announces a save that hides a note once", async () => {
        const file = note("2025-01-01");
        await load(file, note("2024-12-31"));
        hide(file);

        stream.onFileModify(file);
        await vi.runAllTimersAsync();

        expect(notesChanged).toHaveBeenCalledOnce();
    });

    it("announces a note links show again, and nothing for one that stays", async () => {
        const shownAgain = note("2025-01-02");
        const stays = note("2025-01-01");
        hide(shownAgain);
        await load(shownAgain, stays);
        hidden.clear();

        await stream.onLinksChanged([stays]);
        expect(notesChanged).not.toHaveBeenCalled();
        await stream.onLinksChanged([shownAgain]);
        expect(notesChanged).toHaveBeenCalledOnce();
    });

    it("announces a reload under new daily-notes settings, and nothing when they are unchanged", async () => {
        await load(note("2025-01-01"));

        stream.onDailyNoteSettingsChange();
        await vi.runAllTimersAsync();
        expect(notesChanged).not.toHaveBeenCalled();

        __setMockSettings({ format: "YYYY-MM-DD", folder: "Journal" });
        vault = [new TFile("Journal/2025-01-01.md")];
        stream.onDailyNoteSettingsChange();
        await vi.runAllTimersAsync();
        expect(notesChanged).toHaveBeenCalledOnce();
    });
});

describe("refresh", () => {
    it("rebuilds a placeholder for every loaded note, keeping them loaded", async () => {
        const files = [note("2025-01-03"), note("2025-01-01")];
        await load(...files);
        const before = files.map((f) => stream.blockOf(f));

        await stream.refresh();

        expect(shown()).toEqual(files.map((f) => f.path));
        expect(files.map((f) => stream.blockOf(f))).not.toContain(before[0]);
        expect(service.streamLength).toBe(2);
    });

    // Rebuilt empty blocks get the heights the store remembers. Otherwise the
    // stream's scroll height would collapse as soon as a refresh runs.
    it("rebuilds each placeholder at the height the store remembers", async () => {
        const file = note("2025-01-03");
        await load(file);
        noteWindow.add.mockClear();

        await stream.refresh();

        expect(noteWindow.add).toHaveBeenCalledExactlyOnceWith(file);
    });

    it("keeps the note at the top of the pane where it was", async () => {
        const file = note("2025-01-01");
        await load(file);
        pane.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        stream.blockOf(file)!.getBoundingClientRect = () => ({ top: 100, bottom: 200 }) as DOMRect;
        noteWindow.add.mockImplementationOnce((f: TFile) => {
            const rebuilt = placeholder(f.path);
            rebuilt.getBoundingClientRect = () => ({ top: 150, bottom: 250 }) as DOMRect;
            return rebuilt;
        });
        pane.scrollTop = 0;

        await stream.refresh();

        expect(pane.scrollTop).toBe(50);
    });

    it("reloads the stream instead when what the service lists changed", async () => {
        const newest = note("2025-01-03");
        await load(newest, note("2025-01-01"));
        hide(newest);

        await stream.refresh();

        expect(shown()).toEqual(["Notes/2025-01-01.md"]);
    });

    it("re-arms the sentinel against the rebuilt stream", async () => {
        await listed(note("2025-01-01"));
        await stream.refresh();
        expect(infiniteScroll.detach.mock.invocationCallOrder[0]).toBeLessThan(
            infiniteScroll.attach.mock.invocationCallOrder.at(-1)!
        );

        const [, , onTrigger] = infiniteScroll.attach.mock.calls.at(-1)!;
        await onTrigger();

        expect(shown()).toEqual(["Notes/2025-01-01.md"]);
    });
});

describe("the pane", () => {
    it("hands the window the blocks' container, on open and after a refresh", async () => {
        expect(noteWindow.attach).toHaveBeenCalledWith(pane, container, expect.any(Function));
        await load(note("2025-01-01"));

        await stream.refresh();

        expect(noteWindow.detach).toHaveBeenCalledOnce();
        expect(noteWindow.attach).toHaveBeenCalledWith(pane, container, expect.any(Function));
        expect(noteWindow.detach.mock.invocationCallOrder[0]).toBeLessThan(
            noteWindow.attach.mock.invocationCallOrder[0]!
        );
    });

    it("rebuilds a stream with no note in the pane without error", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await load(note("2025-01-01"));
        pane.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        stack(-1000);

        await stream.refresh();

        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it("reloads an empty stream without returning to any place", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const file = note("2025-01-01");
        await load(file);
        stream.blockOf(file)!.remove();
        hide(file);

        await stream.refresh();

        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it("passes a scroll on to the window, which waits for it to stop before unloading", () => {
        stream.onScroll();
        expect(noteWindow.onScroll).toHaveBeenCalled();
    });

    it("passes a touch on to the window, which lets that note's hold go", () => {
        const target = document.createElement("div");
        stream.onTouch(target);
        expect(noteWindow.onTouch).toHaveBeenCalledWith(target);
    });

    it("forgets its blocks on close", async () => {
        const file = note("2025-01-01");
        await load(file);

        stream.close();

        expect(stream.blockOf(file)).toBeNull();
    });

    it("stops observing on close", () => {
        stream.close();
        expect(infiniteScroll.detach).toHaveBeenCalled();
        expect(noteWindow.detach).toHaveBeenCalled();
        expect(guard.detach).toHaveBeenCalled();
        expect(frames.detach).toHaveBeenCalled();
    });

    // On iOS, a frame that starts loading its page while scrolling stops the
    // scroll (D-087).
    it("holds back frames' pages in the notes it holds on mobile", () => {
        Platform.isMobile = true;
        try {
            stream.open(pane, container);
        } finally {
            Platform.isMobile = false;
        }
        expect(frames.attach).toHaveBeenCalledWith(container);
    });

    // The player does not work inside the app, and its page would stop
    // scrolling (D-088).
    it("shows a YouTube embed as its thumbnail", () => {
        expect((frames as unknown as { standIn: unknown }).standIn).toBe(youtubeThumbnail);
    });

    // A page in a frame would catch the flick that should scroll the stream.
    it("links a web page's frame to the page", () => {
        expect((frames as unknown as { wrapper: unknown }).wrapper).toBe(webPageLink);
    });

    it("lets desktop's frames load at once", () => {
        expect(frames.attach).not.toHaveBeenCalled();
    });

    it("passes a scroll on to the frames held back", () => {
        stream.onScroll();
        expect(frames.onScroll).toHaveBeenCalled();
    });

    // A scrolling box stops iOS's scrolling early. Android follows the same
    // rule (ADR 0008).
    it("keeps scroll boxes out of the notes it holds on mobile", () => {
        Platform.isMobile = true;
        try {
            stream.open(pane, container);
        } finally {
            Platform.isMobile = false;
        }
        expect(guard.attach).toHaveBeenCalledWith(container);
    });

    it("leaves desktop's scroll boxes alone", () => {
        expect(guard.attach).not.toHaveBeenCalled();
    });

    // The renderer rendered the Base, so it decides between cards and fitted
    // columns.
    it("hands a Base's layout to the renderer", () => {
        const view = document.createElement("div");

        (guard as unknown as { onBaseLayout: (view: HTMLElement) => void }).onBaseLayout(view);

        expect(renderer.onBaseLayout).toHaveBeenCalledWith(view);
    });

    // Reading styles waits for scrolling to stop, like unloading notes.
    it("passes a scroll on to the scroll box guard", () => {
        stream.onScroll();
        expect(guard.onScroll).toHaveBeenCalled();
    });
});

describe("Obsidian's daily-notes settings changed", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /**
     * Runs the debounced check and drains the mutation queue.
     */
    async function settingsChanged() {
        stream.onDailyNoteSettingsChange();
        await vi.runAllTimersAsync();
    }

    /**
     * From now on, Obsidian's daily notes are in `Journal/`, and the vault
     * holds `files`.
     */
    function movedToJournal(...files: TFile[]) {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "Journal" });
        vault = files;
    }

    const journal = (date: string) => new TFile(`Journal/${date}.md`);

    it("reloads the stream when the format or folder changed", async () => {
        await load(note("2025-01-01"));
        movedToJournal(journal("2025-01-01"));

        await settingsChanged();

        expect(shown()).toEqual(["Journal/2025-01-01.md"]);
    });

    it("leaves the stream untouched when the settings are unchanged", async () => {
        const file = note("2025-01-01");
        await load(file);
        const block = stream.blockOf(file);

        await settingsChanged();

        expect(stream.blockOf(file)).toBe(block);
    });

    it("collapses a burst of config writes into one check", async () => {
        const check = vi.spyOn(service, "refreshIfSettingsChanged");

        stream.onDailyNoteSettingsChange();
        stream.onDailyNoteSettingsChange();
        await settingsChanged();

        expect(check).toHaveBeenCalledTimes(1);
    });

    it("waits for the config writes to stop before checking", async () => {
        const check = vi.spyOn(service, "refreshIfSettingsChanged");

        stream.onDailyNoteSettingsChange();
        await vi.advanceTimersByTimeAsync(900);
        stream.onDailyNoteSettingsChange();
        await vi.advanceTimersByTimeAsync(900);
        expect(check).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(100);
        expect(check).toHaveBeenCalledOnce();
    });

    it("drops notes loaded under the old format before loading the new ones", async () => {
        await load(note("2025-01-01"));
        movedToJournal();

        await settingsChanged();

        expect(shown()).toEqual([]);
        expect(emptyState()).not.toBeNull();
    });

    it("re-arms infinite scroll against the reloaded stream", async () => {
        const files = Array.from({ length: 15 }, (_, i) => journal(`2025-02-${String(15 - i).padStart(2, "0")}`));
        movedToJournal(...files);
        await settingsChanged();
        expect(infiniteScroll.detach.mock.invocationCallOrder[0]).toBeLessThan(
            infiniteScroll.attach.mock.invocationCallOrder.at(-1)!
        );

        const [, , onTrigger] = infiniteScroll.attach.mock.calls.at(-1)!;
        await onTrigger();

        expect(shown()).toEqual(files.map((f) => f.path));
    });

    // The old notes' windows are removed with them.
    it("lets the window manager go of the old notes, and attaches it anew", async () => {
        await load(note("2025-01-01"));
        movedToJournal(journal("2025-01-01"));
        noteWindow.detach.mockClear();
        noteWindow.attach.mockClear();

        await settingsChanged();

        expect(noteWindow.detach).toHaveBeenCalledOnce();
        expect(noteWindow.detach.mock.invocationCallOrder[0]).toBeLessThan(
            noteWindow.attach.mock.invocationCallOrder[0]!
        );
    });

    it("logs, and keeps the stream working, when rebuilding the cache throws", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(service, "refreshIfSettingsChanged").mockRejectedValue(new Error("daily notes folder missing"));

        await settingsChanged();
        expect(consoleSpy).toHaveBeenCalled();
        await load(note("2025-01-01"));

        expect(shown()).toEqual(["Notes/2025-01-01.md"]);
        consoleSpy.mockRestore();
    });

    it("cancels the pending check on close", async () => {
        const check = vi.spyOn(service, "refreshIfSettingsChanged");

        stream.onDailyNoteSettingsChange();
        stream.close();
        await vi.runAllTimersAsync();

        expect(check).not.toHaveBeenCalled();
    });
});

describe("jumping to a date", () => {
    let notes: TFile[];

    beforeEach(async () => {
        // jsdom has no layout, so every block is at the pane's top at once.
        HTMLElement.prototype.scrollIntoView = vi.fn();
        notes = makeNotes(45);
        await listed(...notes);
    });

    const jump = (date: string) => stream.jumpToDate(moment(date, "YYYY-MM-DD", true));

    it("notices and loads nothing when no note is on or before the date", async () => {
        await jump("2024-01-01");

        expect(Notice.shown).toEqual(["No daily note on or before that date."]);
        expect(service.streamLength).toBe(0);
    });

    it("loads just enough batches to reach the target note", async () => {
        await jump("2025-01-06");

        // The 25th note: three batches of ten.
        expect(service.streamLength).toBe(30);
    });

    it("loads the batch the target note starts", async () => {
        await jump("2025-01-20");

        expect(service.streamLength).toBe(20);
        expect(Notice.shown).toEqual([]);
    });

    it("jumps to the stream's second note", async () => {
        await jump("2025-01-29");

        expect(Notice.shown).toEqual([]);
        expect(stream.blockOf(notes[1]!)!.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    });

    it("scrolls again when the stream renders while it waits", async () => {
        const target = placeholder(notes[3]!.path);
        let first = true;
        target.scrollIntoView = vi.fn(() => {
            if (!first) return;
            first = false;
            // Longer than the two frames the scroll waits for observers.
            void noteWindow.enqueue(async () => {
                for (let frame = 0; frame < 3; frame++) await new Promise((resolve) => requestAnimationFrame(resolve));
                noteWindow.layoutChanges++;
            });
        });
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[3] ? target : placeholder(f.path)));

        await jump("2025-01-27");

        expect(target.scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it("loads no batch when the target note is already loaded", async () => {
        await stream.loadMoreNotes();

        await jump("2025-01-27");

        expect(service.streamLength).toBe(10);
    });

    it("scrolls the target note to the top of the view", async () => {
        const target = placeholder(notes[12]!.path);
        target.scrollIntoView = vi.fn();
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[12] ? target : placeholder(f.path)));

        await jump("2025-01-18");

        expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
        expect(Notice.shown).toEqual([]);
    });

    it("scrolls to the target note once its Bases fill in", async () => {
        const target = placeholder(notes[3]!.path);
        target.scrollIntoView = vi.fn();
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[3] ? target : placeholder(f.path)));
        const base = loadingBase(notes[3]!);

        void jump("2025-01-27");
        await vi.advanceTimersByTimeAsync(10 * FRAME_MS);
        expect(target.scrollIntoView).not.toHaveBeenCalled();

        base.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(FRAME_MS);
        expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    });

    it("scrolls nowhere when the target was renamed before its block caught up", async () => {
        await stream.loadMoreNotes();
        renameInPlace(notes[3]!, "Notes/Renamed.md");

        await jump("2025-01-27");

        expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
        expect(Notice.shown).toEqual(["No daily note on or before that date."]);
    });

    it("stops loading when the stream runs out before the target index", async () => {
        // The list got shorter in the meantime, so the index can no longer be
        // reached.
        vi.spyOn(service, "indexForDate").mockReturnValue(99);

        await jump("2025-01-01");

        expect(service.streamLength).toBe(45);
        expect(Notice.shown).toEqual(["No daily note on or before that date."]);
    });
});

describe("what a search moves through", () => {
    let notes: TFile[];
    const observers: { callback: () => void; disconnected: boolean }[] = [];
    /** Reports a resize to every observer that is still connected. */
    const resized = () => observers.filter((o) => !o.disconnected).forEach((o) => o.callback());

    beforeEach(async () => {
        observers.length = 0;
        vi.stubGlobal(
            "ResizeObserver",
            class {
                disconnected = false;
                constructor(readonly callback: () => void) {
                    observers.push(this);
                }
                observe() {}
                disconnect() {
                    this.disconnected = true;
                }
            }
        );
        notes = makeNotes();
        await listed(...notes);
    });

    afterEach(() => vi.unstubAllGlobals());

    const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;

    // The step scrolls once, to the match. Centering it is the search's job.
    it("loads a note past the loaded range without scrolling to it", async () => {
        const target = placeholder(notes[24]!.path);
        target.scrollIntoView = vi.fn();
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[24] ? target : placeholder(f.path)));

        expect(await stream.ready(notes[24]!)).toBe(target);
        expect(service.streamLength).toBe(30);
        expect(target.scrollIntoView).not.toHaveBeenCalled();
    });

    // A search reads the note's highlights as soon as it arrives.
    it("renders the note before handing it back", async () => {
        let rendered = false;
        noteWindow.render.mockImplementation(() => void noteWindow["enqueue"](async () => void (rendered = true)));

        const block = await stream.ready(notes[3]!);

        expect(noteWindow.render).toHaveBeenCalledWith(block);
        expect(rendered).toBe(true);
    });

    // If it were scrolled to first, its Bases would show empty, then fill in.
    it("hands the note back once its Bases fill in", async () => {
        const base = loadingBase(notes[3]!);
        let handed = false;

        void stream.ready(notes[3]!).then(() => (handed = true));
        await vi.advanceTimersByTimeAsync(10 * FRAME_MS);
        expect(handed).toBe(false);

        base.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(FRAME_MS);
        expect(handed).toBe(true);
    });

    // While still far away, a note may be hidden while it waits (ADR 0023). The
    // caller needs it shown.
    it("shows the note again once its Bases fill in, as it hands it back", async () => {
        const base = loadingBase(notes[3]!);
        let filled = false;
        const filledAtRender: boolean[] = [];
        const drawBase = noteWindow.render.getMockImplementation()!;
        noteWindow.render.mockImplementation((block: HTMLElement) => {
            filledAtRender.push(filled);
            drawBase(block);
        });

        const ready = stream.ready(notes[3]!);
        await vi.advanceTimersByTimeAsync(FRAME_MS);
        filled = true;
        base.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(FRAME_MS);
        await ready;

        expect(filledAtRender).toEqual([false, true]);
    });

    /**
     * A match over text in the stream, 20px tall, `top` px down. It moves as
     * the pane scrolls.
     */
    function matchAt(top: number): Range {
        const range = document.createRange();
        range.selectNodeContents(container.createSpan().appendChild(document.createTextNode("milk")));
        range.getBoundingClientRect = () => rect(top - pane.scrollTop, top + 20 - pane.scrollTop);
        return range;
    }

    it("centers a match and keeps it there while the stream renders", async () => {
        pane.getBoundingClientRect = () => rect(0, 800);
        pane.scrollTop = 0;

        await stream.center(matchAt(1390));

        expect(pane.scrollTop).toBe(1000);
    });

    describe("a centered match, as the stream settles around it", () => {
        let match: Range;

        beforeEach(async () => {
            document.body.appendChild(pane);
            HTMLElement.prototype.scrollIntoView = vi.fn();
            pane.getBoundingClientRect = () => rect(0, 800);
            pane.scrollTop = 0;
            match = matchAt(390);
            await stream.center(match);
            // A Base above it fills in.
            match.getBoundingClientRect = () => rect(6390 - pane.scrollTop, 6410 - pane.scrollTop);
        });
        afterEach(() => pane.remove());

        it("is centered again when a Base above it fills in", () => {
            resized();

            expect(pane.scrollTop).toBe(6000);
        });

        it("is let go once another is readied", async () => {
            await stream.ready(notes[3]!);
            resized();

            expect(pane.scrollTop).toBe(0);
        });

        // There is nothing to show, so nothing changes.
        it("is kept through readying a note no longer listed", async () => {
            await stream.ready(note("1990-01-01"));
            resized();

            expect(pane.scrollTop).toBe(6000);
        });

        it("is kept through a jump to before every note", async () => {
            await stream.jumpToDate(moment("1990-01-01", "YYYY-MM-DD", true));
            resized();

            expect(pane.scrollTop).toBe(6000);
        });

        it("is let go once another is centered", async () => {
            await stream.center(matchAt(390));
            resized();

            expect(pane.scrollTop).toBe(0);
            // If it were also kept in place, it would pull the pane to it first
            // on every resize.
            expect(observers.filter((o) => !o.disconnected)).toHaveLength(1);
        });

        it("is let go once the reader touches the pane", () => {
            stream.onTouch(null);
            resized();

            expect(pane.scrollTop).toBe(0);
        });

        it("is let go once the reader wheels", () => {
            stream.onWheel();
            resized();

            expect(pane.scrollTop).toBe(0);
        });

        it("is let go when the stream closes", () => {
            stream.close();
            resized();

            expect(pane.scrollTop).toBe(0);
        });
    });

    describe("tells a match the reader sees", () => {
        const range = (top: number, bottom: number) =>
            ({ getBoundingClientRect: () => ({ top, bottom, left: 0, width: 100 }) as DOMRect }) as Range;
        // The screen: the pane's text, with a navbar over it from 700 down.
        const navbar = document.createElement("div");
        const screenAt = (y: number) => (y < 700 ? container : navbar);

        beforeEach(() => {
            document.elementFromPoint = vi.fn((_x: number, y: number) => screenAt(y));
            vi.stubGlobal("visualViewport", { offsetTop: 0, height: 900 });
        });

        afterEach(() => vi.unstubAllGlobals());

        it("when nothing covers it", () => {
            expect(stream.isOnScreen(range(400, 420))).toBe(true);
        });

        it("from one with either edge under something else", () => {
            expect(stream.isOnScreen(range(690, 710))).toBe(false);
            expect(stream.isOnScreen(range(710, 730))).toBe(false);
        });

        it("from one at the middle of its line, inside the pane", () => {
            stream.isOnScreen(range(400, 420));

            expect(document.elementFromPoint).toHaveBeenCalledWith(50, 401);
            expect(document.elementFromPoint).toHaveBeenCalledWith(50, 419);
        });

        // iOS's keyboard is not in the page. It shrinks the visual viewport.
        it("from one outside the visual viewport", () => {
            vi.stubGlobal("visualViewport", { offsetTop: 100, height: 400 });

            expect(stream.isOnScreen(range(150, 170))).toBe(true);
            expect(stream.isOnScreen(range(90, 110))).toBe(false);
            expect(stream.isOnScreen(range(490, 510))).toBe(false);
        });

        // The viewport shows the rows from offsetTop up to, not including,
        // offsetTop + height.
        it("from one just past the visual viewport's edges", () => {
            vi.stubGlobal("visualViewport", { offsetTop: 100, height: 400 });

            expect(stream.isOnScreen(range(99, 120))).toBe(true);
            expect(stream.isOnScreen(range(98, 120))).toBe(false);
            expect(stream.isOnScreen(range(480, 500))).toBe(true);
            expect(stream.isOnScreen(range(480, 501))).toBe(false);
        });

        it("with no visual viewport, from what covers it alone", () => {
            vi.stubGlobal("visualViewport", null);

            expect(stream.isOnScreen(range(400, 420))).toBe(true);
            expect(stream.isOnScreen(range(710, 730))).toBe(false);
        });

        it("from one off the window, where nothing is found", () => {
            document.elementFromPoint = vi.fn(() => null);

            expect(stream.isOnScreen(range(400, 420))).toBe(false);
        });
    });

    it("readies the stream's second note", async () => {
        const block = await stream.ready(notes[1]!);

        expect(block).not.toBeNull();
        expect(block).toBe(stream.blockOf(notes[1]!));
    });

    it("readies nothing for a note no longer in the vault", async () => {
        expect(await stream.ready(note("2024-06-01"))).toBeNull();
        expect(service.streamLength).toBe(0);
    });

    it("hands back a loaded note's block, and none for one not loaded", async () => {
        await stream.loadMoreNotes();

        expect(stream.blockOf(notes[0]!)?.dataset.sourcePath).toBe(notes[0]!.path);
        expect(stream.blockOf(notes[20]!)).toBeNull();
    });

    it("names the first note whose block reaches into the pane", async () => {
        await stream.loadMoreNotes();
        pane.getBoundingClientRect = () => rect(0, 800);
        stack(-540);

        expect(stream.firstVisibleNote()).toBe(notes[1]);
    });

    it("names no note in an empty stream", () => {
        expect(stream.firstVisibleNote()).toBeNull();
    });
});

describe("the heights the stream reserves", () => {
    // Every view reads from and adds to one store (ADR 0010).
    it("are the plugin's, measured in the column the notes sit in", () => {
        Object.defineProperty(container, "clientWidth", { value: 612 });

        expect(noteWindow.memory.heights).toBe(heights);
        expect(noteWindow.memory.layoutOf()).toBe("612:");
    });
});

describe("the stream's place", () => {
    let notes: TFile[];

    beforeEach(async () => {
        HTMLElement.prototype.scrollIntoView = vi.fn();
        notes = makeNotes();
        await listed(...notes);
        pane.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
    });

    it("is the first note reaching into the pane, and how far above the pane it starts", async () => {
        await stream.loadMoreNotes();
        stack(-690);

        expect(stream.place()).toMatchObject({ path: notes[1]!.path, offset: -150 });
    });

    // Back builds the view again, which gives notes the heights the plugin
    // remembers (ADR 0010).
    it("holds only the place", async () => {
        await stream.loadMoreNotes();
        stack(-150);

        expect(stream.place()).toEqual({ path: notes[0]!.path, offset: -150 });
    });

    it("is nowhere in an empty stream", () => {
        expect(stream.place()).toBeNull();
    });

    it("is returned to in one step", async () => {
        const target = placeholder(notes[24]!.path);
        target.getBoundingClientRect = () => ({ top: 10, bottom: 600 }) as DOMRect;
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[24] ? target : placeholder(f.path)));
        Object.defineProperty(pane, "scrollHeight", { value: 20000, configurable: true });
        pane.getBoundingClientRect = () => ({ top: 100, bottom: 900 }) as DOMRect;
        pane.scrollTop = 1000;

        await stream.restorePlace({ path: notes[24]!.path, offset: -150 });

        expect(service.streamLength).toBe(30);
        expect(target.scrollIntoView).not.toHaveBeenCalled();
        expect(pane.scrollTop).toBe(1060);
    });

    it("tells the window the scroll was set to the place, once it is", async () => {
        pane.scrollTop = 0;
        noteWindow.placed.mockImplementation(() => expect(pane.scrollTop).toBe(900));
        const target = placeholder(notes[1]!.path);
        target.getBoundingClientRect = () => ({ top: 900, bottom: 1400 }) as DOMRect;
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[1] ? target : placeholder(f.path)));

        await stream.restorePlace({ path: notes[1]!.path, offset: 0 });

        expect(noteWindow.placed).toHaveBeenCalledOnce();
    });

    // If notes were only loaded up to the place's note, the stream could end
    // too soon below it for the pane to scroll there, and the scroll would stop
    // short.
    it("loads past the place until the pane can scroll to it", async () => {
        Object.defineProperty(pane, "clientHeight", { value: 800, configurable: true });
        Object.defineProperty(pane, "scrollHeight", { get: () => shown().length * 400, configurable: true });
        const target = placeholder(notes[9]!.path);
        target.getBoundingClientRect = () => ({ top: 3600, bottom: 4000 }) as DOMRect;
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[9] ? target : placeholder(f.path)));
        pane.scrollTop = 0;

        await stream.restorePlace({ path: notes[9]!.path, offset: -300 });

        expect(service.streamLength).toBe(20);
        expect(pane.scrollTop).toBe(3900);
    });

    it("loads no more once the pane can scroll exactly to the place", async () => {
        Object.defineProperty(pane, "clientHeight", { value: 800, configurable: true });
        Object.defineProperty(pane, "scrollHeight", { get: () => shown().length * 400, configurable: true });
        const target = placeholder(notes[9]!.path);
        target.getBoundingClientRect = () => ({ top: 2900, bottom: 3300 }) as DOMRect;
        noteWindow.add.mockImplementation((f: TFile) => (f === notes[9] ? target : placeholder(f.path)));
        pane.scrollTop = 0;

        await stream.restorePlace({ path: notes[9]!.path, offset: -300 });

        expect(service.streamLength).toBe(10);
        expect(pane.scrollTop).toBe(3200);
    });

    it("stops loading past the place when the notes run out", async () => {
        Object.defineProperty(pane, "clientHeight", { value: 800, configurable: true });
        Object.defineProperty(pane, "scrollHeight", { get: () => 0, configurable: true });

        await stream.restorePlace({ path: notes[9]!.path, offset: -300 });

        expect(service.streamLength).toBe(30);
    });

    it("stays at the top when the note it was at is gone", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        pane.scrollTop = 0;

        await stream.restorePlace({ path: "Notes/2024-06-01.md", offset: -150 });

        expect(pane.scrollTop).toBe(0);
        expect(Notice.shown).toEqual([]);
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it("stays at the top when the stream runs out before its note", async () => {
        // The list got shorter in the meantime, so the index can no longer be
        // reached.
        vi.spyOn(service, "indexOf").mockReturnValue(99);
        pane.scrollTop = 0;

        await stream.restorePlace({ path: "Notes/2025-01-01.md", offset: -150 });

        expect(pane.scrollTop).toBe(0);
    });

    // A setting that changes what is listed, such as "Hide empty notes",
    // reloads the stream, and the reader stays where they were reading.
    describe("after a setting changes what is listed", () => {
        beforeEach(async () => {
            Object.defineProperty(pane, "scrollHeight", { value: 20000, configurable: true });
            await stream.loadMoreNotes();
            // Notes[5] starts 150px above the pane's top.
            stack(-2850);
            pane.scrollTop = 1000;
        });

        /**
         * The reload starts at the top, with `file`'s new block 3000px down.
         */
        function rebuildsAt(file: TFile) {
            noteWindow.add.mockImplementation((f: TFile) => {
                const block = placeholder(f.path);
                if (f === file) block.getBoundingClientRect = () => ({ top: 3000, bottom: 3540 }) as DOMRect;
                return block;
            });
        }

        it("returns to the note it was at", async () => {
            hide(notes[20]!);
            rebuildsAt(notes[5]!);

            await stream.refresh();

            expect(pane.scrollTop).toBe(3150);
        });

        // While the stream is shifted, the notes may all be above the pane,
        // until what the anchor owes is moved into the scroll.
        it("reads the place once the scroll holds what the anchor owed", async () => {
            hide(notes[20]!);
            rebuildsAt(notes[5]!);
            const block = stream.blockOf(notes[5]!)!;
            const settled = block.getBoundingClientRect;
            block.getBoundingClientRect = () => ({ top: -1500, bottom: -960 }) as DOMRect;
            noteWindow.handOver.mockImplementation(() => (block.getBoundingClientRect = settled));

            await stream.refresh();

            expect(pane.scrollTop).toBe(3150);
        });

        it("lands on the next older note when the one it was at is now hidden", async () => {
            const older = notes[6]!;
            hide(notes[5]!);
            rebuildsAt(older);

            await stream.refresh();

            expect(pane.scrollTop).toBe(3000);
        });

        it("lands on the stream's second note when the one before it is now hidden", async () => {
            stack(-690);
            hide(notes[1]!);
            rebuildsAt(notes[2]!);

            await stream.refresh();

            expect(pane.scrollTop).toBe(3000);
        });

        it("goes to the end of the stream when no older note is left", async () => {
            hide(...notes.slice(5));

            await stream.refresh();

            expect(service.streamLength).toBe(5);
            expect(pane.scrollTop).toBe(20000);
            expect(noteWindow.placed).toHaveBeenCalledOnce();
        });

        it("stays at the top when every note is now hidden", async () => {
            hide(...notes);

            await stream.refresh();

            expect(pane.scrollTop).toBe(0);
        });
    });
});
