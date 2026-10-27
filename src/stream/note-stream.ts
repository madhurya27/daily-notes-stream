import { basesLoaded } from "../render/bases/bases-loaded";
import { Debouncer, Notice, Platform, TFile, TAbstractFile, debounce } from "obsidian";
import type { DailyNoteService } from "../notes/daily-note-service";
import { moment, type Moment } from "../notes/moment";
import type { NoteRenderer } from "../render/note-renderer";
import { StreamBlocks } from "./stream-blocks";
import { InfiniteScrollController } from "./infinite-scroll";
import { NoteWindowManager } from "./note-window";
import { layoutOf, type LayoutMemory } from "./layout-memory";
import { ScrollBoxGuard } from "./scroll-box-guard";
import { FrameDeferral } from "./frame-deferral";
import { SCROLL_IDLE_MS } from "./scroll-anchor";
import { warnIfStalled } from "./stall-warning";
import { youtubeThumbnail } from "../render/video-thumbnails";
import { webPageLink } from "../render/web-page-links";
import {
    keepInPlace,
    readPlace,
    scrollBlockTo,
    scrollIntoPlace,
    type StreamLayout,
    type StreamPlace,
} from "./scroll-position";

/**
 * Obsidian saves as you type, so re-rendering the note on every save would
 * waste work.
 */
const MODIFY_DEBOUNCE_MS = 300;

/**
 * The date format field saves on every key, and a half-typed format rebuilds
 * the stream.
 */
const CONFIG_DEBOUNCE_MS = 1000;

const BATCH_SIZE = 10;

/**
 * How long after midnight to wait, so a timer that fires early still finds the
 * new day.
 */
const DAY_TURN_DELAY_MS = 60_000;

const NO_NOTES = "No daily notes found. Please check your daily notes settings.";

const ALL_HIDDEN =
    'Every daily note is hidden: each holds only its template. Turn off "Hide empty notes" to show them.';

const NO_NOTE_FOR_DATE = "No daily note on or before that date.";

/**
 * The stream's contents: which notes are loaded, and their blocks. Every change
 * to them, whether a batch, a vault event, a jump or a rebuild, runs one at a
 * time through a single queue (ADR 0004).
 */
export class NoteStream {
    private scroll = new InfiniteScrollController();
    /**
     * What is rendered, and where blocks are. The view passes it the pane's
     * events.
     */
    readonly window: NoteWindowManager;
    private scrollRoot!: HTMLElement;
    private blocks = new StreamBlocks(() => this.scroll.getSentinel());
    private scrollBoxes: ScrollBoxGuard;
    private readonly frames = new FrameDeferral(youtubeThumbnail, webPageLink);

    /** Starts the queue. Until `open`, there is no container to change. */
    private opened!: () => void;
    // Serialized: an event that ran in the middle of a batch would leave the
    // blocks and the service's list out of step.
    private queue: Promise<void> = new Promise((resolve) => (this.opened = resolve));
    private loadPending = false;
    /**
     * Once closed, the queue drops tasks still waiting: each would render, then
     * be thrown away.
     */
    private closed = false;
    private midnight: number | null = null;
    /**
     * The day changed while the reader was moving the pane. The stream catches
     * up once they stop.
     */
    private dayTurnWaiting = false;
    private readonly catchUpDayOnceStill = debounce(
        () => {
            this.dayTurnWaiting = false;
            void this.enqueueChange(async () => {});
        },
        SCROLL_IDLE_MS,
        true
    );
    /**
     * Stops keeping the last centered match in place. Does nothing once it has
     * stopped.
     */
    private letGoOfCentered = () => {};

    /** Notes saved since the last flush, by path. */
    private readonly pendingModified = new Map<string, TFile>();

    constructor(
        private readonly service: DailyNoteService,
        renderer: NoteRenderer,
        /** Every height measured, kept between sessions (ADR 0010). */
        memory: Pick<LayoutMemory, "notes">,
        /**
         * Its daily notes changed (added, removed or saved), and the change has
         * been applied.
         */
        private readonly notesChanged: () => void = () => {}
    ) {
        this.window = new NoteWindowManager(renderer, this.enqueue.bind(this), memory.notes, () =>
            layoutOf(this.blocks.el)
        );
        this.scrollBoxes = new ScrollBoxGuard((view) => renderer.onBaseLayout(view));
    }

    /**
     * Starts watching `container`, inside the pane `scrollRoot`, so it can load
     * the first batch.
     */
    open(scrollRoot: HTMLElement, container: HTMLElement): void {
        this.scrollRoot = scrollRoot;
        this.blocks.attach(container);
        this.window.attach(scrollRoot, container, this.loadedToEnd);
        // iOS stops scrolling early because of a scroll box, or a frame that
        // starts loading its page. Android follows the same rules (ADR 0008,
        // D-087).
        if (Platform.isMobile) {
            this.scrollBoxes.attach(container);
            this.frames.attach(container);
        }
        this.attachScroll();
        this.armMidnight();
        this.opened();
    }

    /**
     * A note made in advance becomes due at midnight, with no vault change to
     * show it. So the stream catches up then, once the reader is still (D-123).
     */
    private armMidnight(): void {
        const untilMidnight = moment().add(1, "day").startOf("day").diff(Date.now());
        this.midnight = window.setTimeout(() => {
            this.dayTurnWaiting = true;
            this.catchUpDayOnceStill();
            this.armMidnight();
        }, untilMidnight + DAY_TURN_DELAY_MS);
    }

    /**
     * The reader moved the pane, so a pending catch-up waits for them to stop.
     */
    private readerMoved(): void {
        if (this.dayTurnWaiting) this.catchUpDayOnceStill();
    }

    close(): void {
        this.closed = true;
        // Stryker disable next-line ConditionalExpression: clearing a timer that does not exist does nothing.
        if (this.midnight !== null) window.clearTimeout(this.midnight);
        this.catchUpDayOnceStill.cancel();
        this.letGoOfCentered();
        this.onDailyNoteSettingsChange.cancel();
        this.flushModified.cancel();
        this.scroll.detach();
        this.window.detach();
        this.scrollBoxes.detach();
        this.frames.detach();
        this.blocks.clear();
    }

    /**
     * Unloading notes, reading styles and loading frames' pages wait for
     * scrolling to stop.
     */
    onScroll(): void {
        this.readerMoved();
        this.window.onScroll();
        this.scrollBoxes.onScroll();
        this.frames.onScroll();
    }

    /**
     * A touch is the reader's own action, so a match kept in place is released.
     */
    onTouch(target: EventTarget | null): void {
        this.readerMoved();
        this.letGoOfCentered();
        this.window.onTouch(target);
    }

    /** The reader scrolls the pane themselves. */
    onWheel(): void {
        this.readerMoved();
        this.letGoOfCentered();
    }

    onFileModify(file: TAbstractFile) {
        // Stryker disable next-line ConditionalExpression: Obsidian only sends modify for files.
        if (!(file instanceof TFile)) return;
        // Keyed by path, so saves to two notes still re-render both, while
        // repeated saves of one note become a single render.
        this.pendingModified.set(file.path, file);
        this.flushModified();
    }

    private flushModified: Debouncer<[], void> = debounce(
        () => {
            const files = [...this.pendingModified.values()];
            this.pendingModified.clear();
            for (const file of files) void this.enqueueChange(() => this.applyModify(file));
        },
        MODIFY_DEBOUNCE_MS,
        true
    );

    /**
     * A save may hide a note, or show it again (ADR 0011). Otherwise the note
     * is re-rendered.
     */
    private async applyModify(file: TFile): Promise<void> {
        if (await this.reconsider(file)) return;
        if (this.service.indexOf(file.path) === -1) return;
        const el = this.blocks.get(file.path);
        if (el) await this.window.refresh(el);
        this.notesChanged();
    }

    /**
     * Links to `files` were added or removed, which may hide or show them (ADR
     * 0011). A note that stays is left alone: its linked mentions render
     * themselves again.
     */
    onLinksChanged(files: TFile[]): Promise<void> {
        return this.enqueueChange(async () => {
            for (const file of files) await this.reconsider(file);
        });
    }

    /**
     * Queues a change the reader did not make. If the day changed, the stream
     * catches up on that first.
     */
    private enqueueChange(task: () => Promise<void>): Promise<void> {
        return this.enqueue(async () => {
            await this.catchUpDay();
            await task();
        });
    }

    /**
     * Today's note shows even if it is empty. Nothing runs at midnight. The
     * next change hides yesterday's empty note, and shows a note made in
     * advance for the new day (ADR 0011).
     */
    private async catchUpDay(): Promise<void> {
        for (const file of this.service.catchUpDay()) await this.reconsider(file);
    }

    /**
     * Removes `file`, or adds it back, if whether it belongs in the stream
     * changed. Returns whether it did.
     */
    private async reconsider(file: TFile): Promise<boolean> {
        const listed = this.service.indexOf(file.path) !== -1;
        const belongs = await this.service.belongs(file);
        if (listed && !belongs) this.removeNote(file, file.path);
        else if (!listed && belongs) this.insertNote(file);
        else return false;
        return true;
    }

    onFileCreate(file: TAbstractFile) {
        if (!(file instanceof TFile)) return;
        void this.enqueueChange(async () => this.insertNote(file));
    }

    private insertNote(file: TFile): void {
        const inserted = this.service.insertSorted(file);
        if (!inserted) return;
        this.notesChanged();
        if (!inserted.inStream) {
            // It is past the loaded notes. If the sentinel is visible, it loads
            // them now.
            this.scroll.recheck();
            return;
        }

        const next = this.service.getBatch(inserted.index + 1, 1)[0];
        // Stryker disable next-line OptionalChaining: a note in the stream always goes before a note already there.
        this.blocks.insertBefore(file.path, this.window.add(file), next?.path);
    }

    /**
     * Finds the block by the path it was rendered with, which differs from
     * `file.path` after a rename, because data-source-path is set when the
     * block is created. Moving or dropping the fold state is the plugin's job.
     */
    private removeNote(file: TFile, renderedPath: string): void {
        const el = this.blocks.remove(renderedPath);
        if (el) this.window.remove(el);

        if (this.service.removeSorted(file.path) === -1) return;
        this.notesChanged();
        if (this.service.length === 0) this.showEmptyState();
    }

    onFileDelete(file: TAbstractFile) {
        if (!(file instanceof TFile)) return;
        void this.enqueueChange(async () => this.removeNote(file, file.path));
    }

    onFileRename(file: TAbstractFile, oldPath: string) {
        if (!(file instanceof TFile)) return;
        void this.enqueueChange(async () => this.removeNote(file, oldPath));
        this.onFileCreate(file);
    }

    loadMoreNotes(): Promise<void> {
        if (this.loadPending) return this.queue;
        this.loadPending = true;
        return this.enqueue(async () => {
            try {
                await this.loadBatch();
            } finally {
                this.loadPending = false;
            }
        });
    }

    private async loadBatch(): Promise<void> {
        const batch = this.service.extendStream(BATCH_SIZE);
        if (batch.length === 0) {
            // No recheck: checking again after an empty batch would loop
            // forever.
            if (this.service.streamLength === 0) this.showEmptyState();
            return;
        }

        this.blocks.hideEmptyState();

        for (const file of batch) {
            this.blocks.append(file.path, this.window.add(file));
        }

        this.scroll.recheck();
    }

    private showEmptyState(): void {
        this.blocks.showEmptyState(this.service.hidesAny() ? ALL_HIDDEN : NO_NOTES);
    }

    /**
     * Scrolls to the newest note dated on or before `target`, loading batches
     * until it is in the stream.
     */
    async jumpToDate(target: Moment): Promise<void> {
        const index = this.service.indexForDate(target);
        const block = index === -1 ? null : await this.revealIndex(index);
        if (!block) new Notice(NO_NOTE_FOR_DATE);
    }

    /**
     * Loads `file` into the stream and draws all of it, without scrolling to
     * it. Returns its block, or null if the note is gone.
     */
    ready(file: TFile): Promise<HTMLElement | null> {
        const index = this.service.indexOf(file.path);
        return index === -1 ? Promise.resolve(null) : this.readyIndex(index);
    }

    private async revealIndex(index: number): Promise<HTMLElement | null> {
        const block = await this.readyIndex(index);
        if (block) await scrollIntoPlace(block, "start", this.scrollRoot, this.layout);
        return block;
    }

    /**
     * Renders the note before scrolling to it, and waits for its Bases. If it
     * were scrolled to first, each Base would show empty, then fill in. Loading
     * is one queued task: mixing with a load started by scrolling would put the
     * blocks out of step with the service's list.
     */
    private async readyIndex(index: number): Promise<HTMLElement | null> {
        this.letGoOfCentered();
        let file: TFile | undefined;
        await this.enqueue(async () => {
            file = await this.loadThrough(index);
        });
        const block = file ? this.blocks.get(file.path) : null;
        if (!block) return null;
        this.window.render(block);
        await this.layout.drain();
        await basesLoaded(block);
        // While still far away, it may have been hidden in the meantime (ADR
        // 0023). The caller needs it shown.
        this.window.render(block);
        return block;
    }

    /**
     * Centers `range`, inside a note, in the pane. Keeps it there while the
     * stream renders and, once centered, while the Bases around it fill in.
     */
    async center(range: Range): Promise<void> {
        this.letGoOfCentered();
        // Stryker disable StringLiteral: any placement except "start" centers.
        // Held from the first scroll: a Base hidden far away lays out again a
        // frame after it is shown, while the scroll is still settling.
        this.letGoOfCentered = keepInPlace(range, "center", this.scrollRoot, this.blocks.el);
        await scrollIntoPlace(range, "center", this.scrollRoot, this.layout);
        // Held again, so it is kept for its full time after the scroll settles.
        this.letGoOfCentered();
        this.letGoOfCentered = keepInPlace(range, "center", this.scrollRoot, this.blocks.el);
        // Stryker restore StringLiteral
    }

    /**
     * Whether the reader sees all of `range`: the pane shows both its top and
     * bottom edges, and nothing covers them, such as a phone's floating header
     * or navbar. iOS's keyboard is not in the page, so the edges must also be
     * in the visual viewport, which shrinks above it (D-179).
     */
    isOnScreen(range: Range): boolean {
        const rect = range.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        // A pixel inside each edge, so the line itself is tested, not the one
        // next to it.
        return this.seesAt(x, rect.top + 1) && this.seesAt(x, rect.bottom - 1);
    }

    private seesAt(x: number, y: number): boolean {
        const viewport = this.scrollRoot.win.visualViewport;
        if (viewport && (y < viewport.offsetTop || y >= viewport.offsetTop + viewport.height)) return false;
        return this.scrollRoot.contains(this.scrollRoot.doc.elementFromPoint(x, y));
    }

    /** The block `file` is shown in; null when it is not loaded. */
    blockOf(file: TFile): HTMLElement | null {
        return this.blocks.get(file.path);
    }

    /**
     * The first note that is at least partly in the pane, or null if there is
     * none.
     */
    firstVisibleNote(): TFile | null {
        const place = this.place();
        const index = place ? this.service.indexOf(place.path) : -1;
        return index === -1 ? null : this.service.getBatch(index, 1)[0]!;
    }

    /**
     * Where the pane is scrolled to, or null if no note is in it. Back builds
     * the view again, and its empty blocks get the heights the notes measured
     * (ADR 0010).
     */
    place(): StreamPlace | null {
        return readPlace(this.blocks.el, this.scrollRoot);
    }

    /**
     * Scrolls back to `place` before a frame is drawn. Does not move if its
     * note is gone. A note never measured in this layout is rendered at a new
     * height, and the scroll anchor keeps the place.
     */
    restorePlace(place: StreamPlace): Promise<void> {
        return this.enqueue(() => this.returnTo(place));
    }

    private async returnTo(place: StreamPlace): Promise<void> {
        const index = this.service.indexOf(place.path);
        // Stryker disable next-line ConditionalExpression: -1 is not a note's index, and loadThrough finds no note there either.
        const file = index === -1 ? undefined : await this.loadThrough(index);
        const block = file && this.blocks.get(file.path);
        if (!block) return;
        const root = this.scrollRoot;
        const scrollTop =
            root.scrollTop + block.getBoundingClientRect().top - root.getBoundingClientRect().top - place.offset;
        await this.loadUntilScrollable(scrollTop);
        root.scrollTop = scrollTop;
        this.window.placed();
    }

    /**
     * Loads batches until the pane can scroll to `scrollTop`. If notes were
     * only loaded up to the place's note, the stream might end too soon below
     * it, and the scroll would stop short. Only empty blocks are added; nothing
     * is rendered here.
     */
    private async loadUntilScrollable(scrollTop: number): Promise<void> {
        const root = this.scrollRoot;
        while (root.scrollHeight - root.clientHeight < scrollTop) {
            const before = this.service.streamLength;
            await this.loadBatch();
            if (this.service.streamLength === before) return;
        }
    }

    /**
     * Counts the window manager's renders, and waits for them through the queue
     * they run on.
     */
    private readonly layout: StreamLayout = {
        layoutChanges: () => this.window.layoutChanges,
        drain: () => this.enqueue(async () => {}),
        placed: () => this.window.placed(),
    };

    /**
     * Loads batches until `index` is loaded, and returns the note there.
     * Undefined if the stream ends first, because the list got shorter during
     * the jump.
     */
    private async loadThrough(index: number): Promise<TFile | undefined> {
        while (this.service.streamLength <= index) {
            const before = this.service.streamLength;
            await this.loadBatch();
            if (this.service.streamLength === before) return undefined;
        }
        return this.service.getBatch(index, 1)[0];
    }

    /**
     * Renders every note again. If a setting changed which notes the service
     * lists, it reloads instead, and returns to the reader's place (D-074).
     */
    refresh(): Promise<void> {
        return this.enqueueChange(async () => {
            // While the stream is shifted, the notes are not where the scroll
            // position says.
            this.window.handOver();
            const place = this.place();
            const date = place && this.service.dates()[this.service.indexOf(place.path)];
            if (!(await this.service.refreshIfSettingsChanged())) return this.rerenderAll();
            await this.reload();
            // Stryker disable next-line LogicalOperator: a place is read from a listed note, which always has a date.
            if (place && date) await this.returnNear(place, date);
        });
    }

    /**
     * Returns to `place`. If its note is no longer listed, goes to the top of
     * the next older note, or to the end of the stream if there is none.
     */
    private async returnNear(place: StreamPlace, date: Moment): Promise<void> {
        if (this.service.indexOf(place.path) !== -1) return this.returnTo(place);
        const index = this.service.indexForDate(date);
        // Stryker disable next-line ConditionalExpression: -1 is not a note's index, and getBatch finds no note there either.
        const older = index === -1 ? undefined : this.service.getBatch(index, 1)[0];
        if (older) return this.returnTo({ path: older.path, offset: 0 });
        await this.returnToEnd();
    }

    /**
     * Loads every note and scrolls to the end. An empty stream stays at the
     * top.
     */
    private async returnToEnd(): Promise<void> {
        if (!(await this.loadThrough(this.service.length - 1))) return;
        this.scrollRoot.scrollTop = this.scrollRoot.scrollHeight;
        this.window.placed();
    }

    /**
     * A change to the settings can change which files are daily notes, so the
     * list and every rendered note may be wrong.
     */
    onDailyNoteSettingsChange: Debouncer<[], void> = debounce(
        () => {
            void this.enqueueChange(async () => {
                if (!(await this.service.refreshIfSettingsChanged())) return;
                await this.reload();
            });
        },
        CONFIG_DEBOUNCE_MS,
        true
    );

    /**
     * Throws away the stream and loads the first batch of the new list of
     * notes.
     */
    private async reload(): Promise<void> {
        this.blocks.empty();
        this.scrollRoot.scrollTop = 0;
        this.scroll.detach();
        this.resetWindow();
        this.attachScroll();
        this.notesChanged();
        await this.loadBatch();
    }

    /**
     * Builds the stream again as empty blocks with the remembered heights, and
     * lets the window manager render what is near the screen. Nothing is
     * rendered here, so a refresh costs the same with ten notes loaded or a
     * thousand.
     */
    private async rerenderAll(): Promise<void> {
        const notes = this.service.streamedNotes();
        const place = this.place();

        this.blocks.empty();
        this.scroll.detach();
        this.resetWindow();

        for (const file of notes) {
            this.blocks.append(file.path, this.window.add(file));
        }

        this.attachScroll();

        const block = place && this.blocks.get(place.path);
        if (block) scrollBlockTo(block, place.offset, this.scrollRoot);
    }

    /**
     * Runs `task` after every queued change, so no two changes mix at an await.
     * The reader's own loads, renders and jumps come here, without catching up
     * on a new day, so the notes at the top do not move while the reader
     * scrolls.
     */
    private enqueue(task: () => Promise<void>): Promise<void> {
        this.queue = this.queue
            .then(() => (this.closed ? undefined : warnIfStalled("A change to the stream", task)))
            .catch((e) => console.error("DailyNotesStream: Failed to update the stream", e));
        return this.queue;
    }

    /**
     * When the sentinel becomes visible, the next batch loads.
     */
    private attachScroll(): void {
        this.scroll.attach(this.scrollRoot, this.blocks.el, () => this.loadMoreNotes());
    }

    private readonly loadedToEnd = () => this.service.streamLength >= this.service.length;

    /** Frees every note and starts the observers again. */
    private resetWindow(): void {
        this.window.detach();
        this.window.attach(this.scrollRoot, this.blocks.el, this.loadedToEnd);
    }
}
