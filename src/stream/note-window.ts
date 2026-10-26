import { Component, TFile, debounce, type Debouncer } from "obsidian";
import { DRAWING_FROM_END, type DrawOrder, type NoteRenderer, type RenderedNote } from "../render/note-renderer";
import type { NoteHeights } from "./note-heights";
import { SCROLL_IDLE_MS, ScrollAnchor } from "./scroll-anchor";
import { HeightHold, SETTLE_MS } from "./height-hold";
import { Reservations, type Reserving } from "./reservations";
import { FarRunWatch } from "./far-run-watch";
import { blockAt } from "./stream-blocks";
import { warnIfStalled } from "./stall-warning";

/**
 * The height a block keeps, in pane heights, before anything has been measured
 * in this layout. Too tall is safe (D-092), and the notes on screen are
 * measured within moments.
 */
export const UNMEASURED_PANES = 2;

/**
 * The distances are in pane heights, not pixels, so the stream works the same
 * distance ahead of the reader on a phone and on a tall monitor.
 */
const RENDER_VIEWPORTS = 1.5;
/**
 * Well past the distance at which notes are drawn, so a block near that edge is
 * not drawn and hidden over and over.
 */
const HIDE_VIEWPORTS = 4;
/**
 * How far away a hidden note stays drawn. Further away, it is emptied once
 * scrolling stops (ADR 0023).
 */
const UNLOAD_VIEWPORTS = 12;
/**
 * A drawn note taken out of the layout: its content gets `display: none`, and
 * the block keeps its fixed height (ADR 0023).
 */
const FAR = "is-far";
/**
 * A pane dragged to zero height, or not laid out yet, still gets distances to
 * work with.
 */
const MIN_VIEWPORT_PX = 400;

interface NoteWindow extends Reserving {
    /** Not null exactly while the block holds drawn content. */
    component: Component | null;
    /** Stops a second render from starting while the first one is waiting. */
    rendering: boolean;
    /**
     * Draw from the start, where a jump lands. Null draws it in the order the
     * reader reaches it.
     */
    order: DrawOrder | null;
    /**
     * The block went out of range while its render was queued or running. An
     * observer only reports changes, so this is the only request to empty it
     * until it comes back into view. Doing it later is what stops a fast scroll
     * from leaving drawn notes behind.
     */
    unloadWanted: boolean;
    /**
     * Keeps the drawn note at `height` until it stops changing. Null once
     * released.
     */
    hold: HeightHold | null;
    /** What was drawn in the block. */
    watched: Element[];
    /**
     * Remembers the height once the drawn note stops changing size. Null while
     * the block is empty.
     */
    keepOnceSettled: Debouncer<[], void> | null;
}

/**
 * Limits how much of the stream is drawn. Every loaded note has a block, but
 * only blocks near the screen hold content. An empty block keeps its height, so
 * the scroll position stays the same when it is emptied and drawn again.
 */
export class NoteWindowManager {
    private readonly windows = new Map<HTMLElement, NoteWindow>();

    /**
     * How many notes were drawn or emptied since loading. Both move everything
     * below them, so code that keeps a scroll position watches this to know
     * when the stream has stopped changing.
     */
    private changes = 0;
    private renderObserver: IntersectionObserver | null = null;
    private hideObserver: IntersectionObserver | null = null;
    private unloadObserver: IntersectionObserver | null = null;
    private screenObserver: IntersectionObserver | null = null;
    /** The blocks inside the pane now, not just near it. */
    private readonly onScreen = new Set<HTMLElement>();
    /**
     * For each block with a fixed height: how far below its top its content
     * ended when the height was fixed.
     */
    private readonly pinnedEnds = new WeakMap<HTMLElement, number>();
    /**
     * Renders queued but not started. A note on screen among them may go first.
     */
    private readonly waiting = new Map<HTMLElement, NoteWindow>();
    /**
     * Drawing or emptying a note moves everything below it. Above the pane,
     * that would move the reader's place.
     */
    private readonly anchor = new ScrollAnchor();
    private scrollRoot: HTMLElement | null = null;
    private stream: HTMLElement | null = null;
    /**
     * The layout that heights are read and saved for. It is read once and kept
     * until the current task ends.
     */
    private currentLayout: string | null = null;
    /** The pane height the current distances were computed from. */
    private rootHeight = 0;
    /**
     * Drawn blocks past the distance at which they are emptied, waiting for
     * scrolling to stop.
     */
    private readonly leaving = new Set<HTMLElement>();
    /**
     * Every block past the distance at which blocks are emptied, as last
     * reported. A note that finishes drawing there is emptied too.
     */
    private readonly beyond = new Set<HTMLElement>();
    private readonly unloadOnceStill = debounce(() => this.unloadLeaving(), SCROLL_IDLE_MS, true);
    private readonly reserveOnceStill = debounce(() => this.reserve(), SCROLL_IDLE_MS, true);
    /**
     * Parts of long notes, hidden when they are further away than the hiding
     * distance (ADR 0023).
     */
    private readonly runs: FarRunWatch;
    private readonly reservations: Reservations;
    /**
     * Watches drawn notes: a Base that is filling in, or an image that is
     * loading, is too short until it is done.
     */
    private resizes: ResizeObserver | null = null;

    constructor(
        private readonly renderer: NoteRenderer,
        /**
         * Renders run through the stream's queue, like every other change (ADR
         * 0004). The view chains its promise; nothing here waits for it.
         */
        private readonly enqueue: (task: () => Promise<void>) => unknown,
        /** Every height measured, kept between sessions (ADR 0010). */
        private readonly heights: NoteHeights,
        /**
         * The stream's current layout. A height is only correct in the layout
         * it was measured in.
         */
        private readonly layoutOf: () => string,
        /** jsdom has no layout, so tests replace this function to measure. */
        private readonly measure: (el: HTMLElement) => number = (el) => el.getBoundingClientRect().height,
        /**
         * The height for a note not measured in a layout. By default, based on
         * what the vault's notes measured (D-092).
         */
        estimate: (layout: string, path: string) => number | undefined = (layout, path) =>
            heights.estimate(layout, path, this.unmeasured())
    ) {
        this.reservations = new Reservations(heights, estimate);
        // Stryker disable next-line OptionalChaining: only asked about a part shown in one of the stream's blocks.
        this.runs = new FarRunWatch(renderer, (block) => !!this.windows.get(block)?.component);
    }

    /**
     * `stream` holds the blocks. `loadedToEnd` says whether every note is
     * loaded, so nothing more comes below the end.
     */
    attach(scrollRoot: HTMLElement, stream: HTMLElement, loadedToEnd: () => boolean): void {
        this.detachObservers();
        this.scrollRoot = scrollRoot;
        this.stream = stream;
        this.observeMargins(scrollRoot);
        this.screenObserver = new IntersectionObserver(
            (entries) => {
                for (const { target, isIntersecting } of entries) {
                    if (isIntersecting) this.onScreen.add(target as HTMLElement);
                    else this.onScreen.delete(target as HTMLElement);
                }
            },
            { root: scrollRoot }
        );
        // The anchor needs these reports too. A note with a fixed height hides
        // changes inside it from anything watching the note's size. Told only
        // after the height is fixed again, the anchor would read the note
        // already grown.
        this.resizes = new ResizeObserver((entries) => {
            const { heard, told } = this.contentResized(entries.map(({ target }) => target));
            if (heard && !told) this.anchor.resized();
        });
        this.anchor.attach(scrollRoot, stream, loadedToEnd);

        for (const [block, window] of this.windows) {
            this.observe(block);
            if (block.hasClass("is-pinned")) this.anchor.pinned(block);
            this.watch(window.watched);
        }
    }

    /** The distances are multiples of the pane's height, measured now. */
    private observeMargins(scrollRoot: HTMLElement): void {
        this.rootHeight = Math.max(scrollRoot.clientHeight, MIN_VIEWPORT_PX);

        this.renderObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const target = entry.target as HTMLElement;
                    if (this.windows.has(target)) this.queue(target, null);
                    else this.runs.show(target);
                }
            },
            { root: scrollRoot, rootMargin: `${Math.round(this.rootHeight * RENDER_VIEWPORTS)}px` }
        );

        this.hideObserver = new IntersectionObserver(
            (entries) => {
                const left = entries.filter(({ isIntersecting }) => !isIntersecting);
                for (const { target } of left) {
                    const window = this.windows.get(target as HTMLElement);
                    if (window) this.hide(target as HTMLElement, window);
                }
                this.runs.reported(left);
            },
            { root: scrollRoot, rootMargin: `${Math.round(this.rootHeight * HIDE_VIEWPORTS)}px` }
        );

        this.unloadObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const block = entry.target as HTMLElement;
                    if (entry.isIntersecting) {
                        this.leaving.delete(block);
                        this.beyond.delete(block);
                    } else {
                        this.beyond.add(block);
                        this.unload(block);
                    }
                }
            },
            { root: scrollRoot, rootMargin: `${Math.round(this.rootHeight * UNLOAD_VIEWPORTS)}px` }
        );
        this.runs.observeWith(this.renderObserver, this.hideObserver);
    }

    /** Obsidian reports that a pane was resized or the device was turned. */
    onResize(): void {
        this.refreshMargins();
        this.expectLayout();
        this.reserveOnceStill();
    }

    /**
     * Computes the distances again for the pane's new height. Does nothing when
     * the height did not change, so dragging a split costs nothing. The anchor
     * is kept (D-055).
     */
    private refreshMargins(): void {
        if (!this.scrollRoot) return;
        if (Math.max(this.scrollRoot.clientHeight, MIN_VIEWPORT_PX) === this.rootHeight) return;
        this.renderObserver!.disconnect();
        this.hideObserver!.disconnect();
        this.unloadObserver!.disconnect();
        this.observeMargins(this.scrollRoot);
        for (const block of this.windows.keys()) {
            this.renderObserver!.observe(block);
            this.hideObserver!.observe(block);
            this.unloadObserver!.observe(block);
        }
    }

    /**
     * The saved heights were cleared. Once scrolling stops, every empty note,
     * measured or not, gets the height it would have in a session that never
     * measured anything.
     */
    forgetHeights(): void {
        const layout = this.layout();
        for (const window of this.windows.values()) {
            if (window.component) continue;
            window.height = this.unmeasured();
            this.reservations.expect(window, layout);
        }
        this.reserveOnceStill();
    }

    private unmeasured(): number {
        return UNMEASURED_PANES * Math.max(this.rootHeight, MIN_VIEWPORT_PX);
    }

    /** A scroll restarts the wait for blocks that went out of range. */
    onScroll(): void {
        this.repinAtTop();
        this.anchor.onScroll();
        if (this.leaving.size > 0) this.unloadOnceStill();
        if (this.reservations.owed) this.reserveOnceStill();
    }

    /**
     * Fixes the height of the note at the top of the pane again, if its content
     * moved inside the fixed height, as when a Base filling in moves what is
     * below it. Its resize report would come after this scroll, and the anchor
     * would read its place in the moved text first (D-145).
     */
    private repinAtTop(): void {
        // A scroll queued while the view closed arrives after detach.
        if (!this.scrollRoot) return;
        const block = blockAt(this.stream!, this.scrollRoot.getBoundingClientRect().top) as HTMLElement | null;
        const end = block && this.pinnedEnds.get(block);
        if (block && end !== undefined && end !== this.contentEnd(block)) this.repin(block);
    }

    /**
     * How far below the top of `block`, which has a fixed height, its drawn
     * content ends.
     */
    private contentEnd(block: HTMLElement): number {
        return block.lastElementChild!.getBoundingClientRect().bottom - block.getBoundingClientRect().top;
    }

    /**
     * A Base in a note set its height, so the note's height is fixed again in
     * this task (D-108).
     */
    onBaseResized(target: EventTarget | null): void {
        this.contentResized([target]);
    }

    /**
     * A touch is the reader's own change, such as folding a section, so no held
     * height may hide it.
     */
    onTouch(target: EventTarget | null): void {
        const window = this.windowOf(target);
        if (window) this.releaseHold(window);
    }

    onFingerDown(): void {
        this.anchor.fingerDown();
    }

    onFingerUp(): void {
        this.anchor.fingerUp();
    }

    /** Scrolls the pane smoothly to its top, the newest note. */
    scrollToTop(): void {
        this.anchor.headForTop();
        this.scrollRoot?.scrollTo({ top: 0, behavior: "smooth" });
    }

    /**
     * Creates an empty block for `file`, with the height it last measured, or
     * the estimate.
     */
    add(file: TFile): HTMLElement {
        const block = this.renderer.createBlock(file);
        const window: NoteWindow = {
            file,
            component: null,
            rendering: false,
            order: null,
            unloadWanted: false,
            height: this.unmeasured(),
            // Stryker disable next-line BooleanLiteral: reservations.add sets it.
            measured: false,
            hold: null,
            watched: [],
            keepOnceSettled: null,
        };
        this.windows.set(block, window);
        this.reservations.add(window, this.layout());
        this.markUnloaded(block, window.height);
        this.observe(block);
        return block;
    }

    /**
     * Read once per task. Reading it lays the stream out, and a batch adds a
     * block between one call and the next.
     */
    private layout(): string {
        if (this.currentLayout === null) {
            this.currentLayout = this.layoutOf();
            queueMicrotask(() => (this.currentLayout = null));
        }
        return this.currentLayout;
    }

    get layoutChanges(): number {
        return this.changes;
    }

    /** The scroll was just set to a place, for the stream as it is now. */
    placed(): void {
        this.anchor.placed();
    }

    /**
     * Moves what the anchor owes into the scroll now, and draws the notes where
     * it puts them.
     */
    handOver(): void {
        this.anchor.handOver();
    }

    /**
     * Draws a drawn block's content again. An empty block is drawn when it
     * comes back near the screen. Until then, once scrolling stops, its height
     * is estimated again, because the edit removed its saved height (ADR 0017).
     */
    async refresh(block: HTMLElement): Promise<void> {
        const window = this.windows.get(block);
        if (!window) return;
        // A hidden note is not drawn again while nobody can see it. It is
        // emptied, keeping its height, and drawn when it comes back.
        if (block.hasClass(FAR)) this.empty(block, window);
        if (!window.component) {
            if (window.rendering) return;
            this.reservations.expect(window, this.layout());
            this.reserveOnceStill();
            return;
        }
        if (await this.updateInPlace(block, window, window.component)) return;

        this.measureInto(block, window);
        this.stopSettling(window);
        this.discard(block, window);
        block.empty();
        // There is no component until the render finishes, so without this flag
        // a note coming into view would be drawn twice.
        window.rendering = true;
        try {
            const rendered = await this.renderer.renderInto(block, window.file);
            if (rendered) this.filled(block, window, rendered);
        } finally {
            this.changes++;
            window.rendering = false;
            window.unloadWanted = false;
        }
    }

    /**
     * Draws again only what the save changed (ADR 0019), while the rest stays
     * drawn. Returns false when the whole note must be drawn again. A request
     * to empty the note made in the meantime waits for the result.
     */
    private async updateInPlace(block: HTMLElement, window: NoteWindow, component: Component): Promise<boolean> {
        window.rendering = true;
        let updated: boolean;
        try {
            updated = await this.renderer.update(block, window.file, component);
        } finally {
            window.rendering = false;
        }
        if (!updated) return false;
        this.changes++;
        this.runs.updated(block);
        window.keepOnceSettled?.();
        this.landed(block, window, component);
        window.unloadWanted = false;
        return true;
    }

    remove(block: HTMLElement): void {
        const window = this.windows.get(block);
        if (!window) return;
        this.unobserve(block);
        this.leaving.delete(block);
        // Stryker disable next-line CallExpression: only frees memory; a block removed from the stream never finishes drawing again.
        this.beyond.delete(block);
        this.onScreen.delete(block);
        this.stopSettling(window);
        this.discard(block, window);
        this.windows.delete(block);
    }

    detach(): void {
        this.detachObservers();
        this.unloadOnceStill.cancel();
        this.reserveOnceStill.cancel();
        this.leaving.clear();
        // Stryker disable next-line CallExpression: only frees memory; the blocks are removed with the windows below.
        this.beyond.clear();
        this.waiting.clear();
        this.scrollRoot = null;
        for (const [block, window] of this.windows) {
            this.stopSettling(window);
            this.discard(block, window);
        }
        this.windows.clear();
    }

    /**
     * Draws `block` for a jump, which goes to the note's start, so it is drawn
     * from there (ADR 0022). A caller that needs the content at once must wait
     * for the queue to empty.
     */
    render(block: HTMLElement): void {
        this.queue(block, "from-start");
    }

    /**
     * Queues a render of `block` in `order`, or in the order the reader reaches
     * it. If it already holds content, shows it if hidden instead. If it is
     * already drawing, does nothing. The observer calls this when the block
     * comes into range.
     */
    private queue(block: HTMLElement, order: DrawOrder | null): void {
        const window = this.windows.get(block);
        if (!window) return;
        if (window.component) {
            block.removeClass(FAR);
            return;
        }
        if (window.rendering) {
            // It came back into view before its render finished. Emptying it as
            // asked would leave it blank, and an observer only reports changes,
            // so no second event would come to fill it.
            window.unloadWanted = false;
            // A jump's render draws from where the jump goes, if it has not
            // started yet.
            if (order) window.order = order;
            return;
        }
        window.order = order;
        window.rendering = true;
        this.waiting.set(block, window);
        this.enqueue(() => this.renderWaiting(block));
    }

    /**
     * Draws `block` if it is still waiting. A note on screen may have been
     * drawn before its turn.
     */
    private async renderWaiting(block: HTMLElement): Promise<void> {
        const window = this.waiting.get(block);
        if (!window) return;
        this.waiting.delete(block);
        try {
            // It scrolled past before its turn came. Drawing it would hold up
            // the queue, which every vault event also uses, for nothing.
            if (window.unloadWanted) return;

            // Between the slices of a long note, it stops if it has gone out of
            // range, so the note the reader stopped on is drawn next. And a
            // note on screen is drawn before one that is only near it (ADR
            // 0020).
            const rendered = await warnIfStalled(`Drawing ${window.file.path}`, () =>
                this.renderer.renderInto(
                    block,
                    window.file,
                    async (note) => {
                        // Drawn from its end, it grows at its top, so its top
                        // part may still grow.
                        if (block.hasClass(DRAWING_FROM_END))
                            this.hideFarRunsOf(block, this.renderer.runsOf(note).slice(1));
                        if (!this.onScreen.has(block)) await this.renderWaitingOnScreen();
                        return !window.unloadWanted;
                    },
                    window.order ?? this.orderFor(block)
                )
            );
            // Read the place again over what it drew: nothing scrolled or
            // changed size while it drew.
            if (rendered && block.hasClass(DRAWING_FROM_END)) this.anchor.readPlace(block);
            // Whether it was drawn or given up, it is laid out from its start
            // again in this task.
            block.removeClass(DRAWING_FROM_END);
            if (!rendered) {
                this.runs.forgetSpacers(block);
                return;
            }
            // close() empties the container while renders run, outside the
            // queue, so after the await the block may no longer have a parent.
            if (!block.isConnected || !this.windows.has(block)) {
                this.renderer.discard(rendered.component);
                block.empty();
                this.runs.forgetSpacers(block);
                return;
            }
            this.filled(block, window, rendered);
        } finally {
            this.changes++;
            window.rendering = false;
            window.unloadWanted = false;
        }
    }

    /** `rendered` was drawn into `block`, which shows it from now on. */
    private filled(block: HTMLElement, window: NoteWindow, { component, footer }: RenderedNote): void {
        window.component = component;
        block.removeClass("is-unloaded");
        block.style.removeProperty("--daily-note-placeholder-height");
        this.watchSettling(block, window, footer);
        this.landed(block, window, component);
    }

    /**
     * After drawing: fix the height again, watch the note's parts, and take it
     * out of the layout if it went out of range meanwhile.
     */
    private landed(block: HTMLElement, window: NoteWindow, component: Component): void {
        this.repin(block);
        this.runs.watch(block, component);
        if (window.unloadWanted) this.landedFar(block);
    }

    /**
     * Draw from the end when the reader scrolls up into the note, that is, when
     * its middle is above the pane's middle.
     */
    private orderFor(block: HTMLElement): DrawOrder {
        // Only reached while attached: detach drops every waiting render.
        const root = this.scrollRoot!.getBoundingClientRect();
        const note = block.getBoundingClientRect();
        return note.top + note.bottom < root.top + root.bottom ? "from-end" : "from-start";
    }
    /**
     * Still inside the queue's task, so no other change runs meanwhile (ADR
     * 0004).
     */
    private async renderWaitingOnScreen(): Promise<void> {
        for (const block of [...this.waiting.keys()]) {
            if (this.onScreen.has(block)) await this.renderWaiting(block);
        }
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /**
     * Further than the hiding distance: a drawn note is taken out of the layout
     * now, even while scrolling (ADR 0023).
     */
    private hide(block: HTMLElement, window: NoteWindow): void {
        if (window.rendering) {
            window.unloadWanted = true;
            return;
        }
        if (window.component) this.conceal(block);
    }

    /**
     * Without a fixed height, the block's height is its content's, so hiding it
     * would collapse it. Then it is emptied once scrolling stops instead.
     */
    private conceal(block: HTMLElement): void {
        if (block.hasClass("is-pinned")) block.addClass(FAR);
        else this.leave(block);
    }

    /**
     * It went past the hiding distance while it drew, and also past the
     * emptying distance if that was reported.
     */
    private landedFar(block: HTMLElement): void {
        this.conceal(block);
        if (this.beyond.has(block)) this.leave(block);
    }

    private unload(block: HTMLElement): void {
        const window = this.windows.get(block);
        if (!window) return;
        if (window.rendering) {
            window.unloadWanted = true;
            return;
        }
        if (!window.component) return;

        this.leave(block);
    }

    private leave(block: HTMLElement): void {
        this.leaving.add(block);
        this.unloadOnceStill();
    }

    private unloadLeaving(): void {
        for (const block of this.leaving) {
            const window = this.windows.get(block)!;
            // A refresh that is running waits until scrolling stops again.
            if (!window.component || window.rendering) continue;
            this.empty(block, window);
        }
    }

    /**
     * Empties the block. A block that was never laid out measures zero. Using
     * that height would collapse a note the reader has scrolled past, and move
     * the scroll position with it, so it keeps the height it had.
     */
    private empty(block: HTMLElement, window: NoteWindow): void {
        this.leaving.delete(block);
        this.stopSettling(window);
        this.measureInto(block, window);
        this.discard(block, window);
        block.empty();
        block.removeClass(FAR);
        this.unpin(block);
        this.markUnloaded(block, window.height);
        this.changes++;
    }

    /**
     * A height is only correct at the width it was measured at. At a new width,
     * nothing is held at a height from the old width, and a note drawn again is
     * held at the height it measured at the new width. Empty blocks get their
     * new heights once scrolling stops. If the width is the same, nothing is
     * read again.
     */
    private expectLayout(): void {
        const layout = this.layout();
        if (!this.reservations.expectLayout(layout)) return;
        for (const [block, window] of this.windows) {
            // Its fixed height was measured at the old width. Empty it, so it
            // gets a height like the other empty blocks.
            if (block.hasClass(FAR)) this.empty(block, window);
            // The spacers' heights were measured at the old width. The parts
            // are hidden again when scrolling next stops.
            this.runs.showAll(block);
            this.releaseHold(window);
            // Stryker disable next-line ConditionalExpression: a drawn note's height is measured again when it is emptied.
            if (!window.component) this.reservations.expect(window, layout);
        }
    }

    /**
     * Gives each empty note the height it is now expected to have: its height
     * at a new width, or a better estimate made since. The anchor first shows
     * the notes above the pane moving, which keeps the scroll range (ADR 0015).
     */
    private reserve(): void {
        const root = this.scrollRoot;
        if (!root) return;
        // Moving the shift into the scroll now would stop keeping the place
        // read before the screen turned, while what the turn draws again is
        // still moving (D-160).
        if (this.anchor.holdsReflow()) {
            this.reserveOnceStill();
            return;
        }
        const unloaded = [...this.windows].filter(([, window]) => !window.component && !window.rendering);
        const plan = this.reservations.plan(
            unloaded,
            this.layout(),
            root.getBoundingClientRect().top,
            root.scrollHeight - root.scrollTop - root.clientHeight
        );
        if (!plan || plan.changed.length === 0) return;
        this.anchor.anticipate(plan.movedAbove);
        for (const [block, window] of plan.changed) this.markUnloaded(block, window.height);
        this.changes++;
        this.anchor.resized();
        // This only runs once scrolling has stopped. If it waited longer, a
        // scroll started in the meantime would carry the shift to the top (ADR
        // 0015).
        this.anchor.handOver();
    }

    /**
     * A note drawn from its end hides, between slices, the parts it drew that
     * are far away.
     */
    private hideFarRunsOf(block: HTMLElement, runs: Element[][]): void {
        const root = this.scrollRoot;
        if (!root) return;
        const { top, bottom } = root.getBoundingClientRect();
        const margin = this.rootHeight * HIDE_VIEWPORTS;
        this.runs.hideDrawnOutside(block, runs, { top: top - margin, bottom: bottom + margin });
    }

    /**
     * While its height is held, the block cannot shrink, so a dip only shows in
     * what was drawn inside it. Waiting for the note to stop changing starts
     * once `footer` is drawn: the linked mentions read other notes first, and a
     * pause while they do does not mean the note is done.
     */
    private watchSettling(block: HTMLElement, window: NoteWindow, footer: Promise<void>): void {
        if (window.measured) {
            const hold = new HeightHold(block, window.height, () => {
                // Released while the note is still drawn. The fixed height hid
                // the drop until now.
                if (window.hold !== hold) return;
                window.hold = null;
                this.repin(block);
                this.anchor.released(block);
            });
            window.hold = hold;
        }
        window.watched = Array.from(block.children);
        this.watch(window.watched);
        const { component } = window;
        void footer.then(() => {
            // Emptied or drawn again while the footer was drawing. That render
            // waits for its own note to stop changing.
            if (window.component !== component) return;
            window.keepOnceSettled = debounce(() => this.keepHeight(block, window), SETTLE_MS, true);
            window.keepOnceSettled();
        });
    }

    private watch(rendered: Element[]): void {
        for (const el of rendered) this.resizes?.observe(el);
    }

    /**
     * The note will be emptied or drawn again next. Its held height is
     * released, and the fixed height keeps it meanwhile.
     */
    private stopSettling(window: NoteWindow): void {
        const { hold } = window;
        window.hold = null;
        hold?.release();
        window.keepOnceSettled?.cancel();
        window.keepOnceSettled = null;
        for (const el of window.watched) this.resizes?.unobserve(el);
        window.watched = [];
    }

    /** Releases the held height, so the block takes its own height. */
    private releaseHold(window: NoteWindow): void {
        window.hold?.release();
    }

    /** The note that `target` is in, or that `target` is. */
    private windowOf(target: EventTarget | null): NoteWindow | undefined {
        const block = this.blockOf(target);
        return block ? this.windows.get(block) : undefined;
    }

    /**
     * Fixes the height again of each drawn note in which something changed
     * size. `heard`: one of them was in the layout. `told`: fixing one of them
     * told the anchor.
     */
    private contentResized(targets: (EventTarget | null)[]): { heard: boolean; told: boolean } {
        let heard = false;
        let told = false;
        for (const block of new Set(targets.map((target) => this.blockOf(target)))) {
            const window = block ? this.windows.get(block) : undefined;
            if (!block || !window) continue;
            if (window.component && !block.hasClass(FAR)) {
                heard = true;
                told = this.repin(block) || told;
            }
            window.keepOnceSettled?.();
        }
        return { heard, told };
    }

    private blockOf(target: EventTarget | null): HTMLElement | null {
        return target instanceof Element ? target.closest<HTMLElement>(".daily-note-block") : null;
    }

    /**
     * Fixes `block` at the height it lays out at, and tells the anchor in the
     * same task if the height changed. Nothing drawn inside a block with a
     * fixed height moves the stream. While scrolling, iOS draws a resize before
     * it reports it, so the shift would come one frame late (ADR 0013). A block
     * with no height, in a hidden tab, gets no fixed height. Returns true if it
     * told the anchor.
     */
    private repin(block: HTMLElement): boolean {
        // A hidden note's content has no height, so its fixed height stays.
        // Stryker disable next-line BooleanLiteral: only contentResized reads the result, and it never fixes the height of a hidden block.
        if (block.hasClass(FAR)) return false;
        const before = block.style.getPropertyValue("--daily-note-pinned-height");
        block.style.removeProperty("--daily-note-pinned-height");
        const height = this.measure(block);
        if (height > 0) {
            // Read this before setting the height changes the layout that the
            // measure just made.
            this.pinnedEnds.set(block, this.contentEnd(block));
            block.style.setProperty("--daily-note-pinned-height", `${height}px`);
            this.anchor.pinned(block);
        } else {
            this.pinnedEnds.delete(block);
            this.anchor.unpinned(block);
        }
        block.toggleClass("is-pinned", height > 0);
        const changed = block.style.getPropertyValue("--daily-note-pinned-height") !== before;
        if (changed) this.anchor.resized();
        return changed;
    }

    private unpin(block: HTMLElement): void {
        this.pinnedEnds.delete(block);
        this.anchor.unpinned(block);
        block.removeClass("is-pinned");
        block.style.removeProperty("--daily-note-pinned-height");
    }

    /**
     * Saves the block's height now. A block never laid out measures zero, and
     * keeps the height it had.
     */
    private measureInto(block: HTMLElement, window: NoteWindow): void {
        const measured = this.measure(block);
        if (measured <= 0) return;
        window.height = measured;
        window.measured = true;
    }

    /**
     * Remembers the block's height. A block not laid out, in a hidden tab,
     * measures zero, so there is nothing to remember.
     */
    private keepHeight(block: HTMLElement, window: NoteWindow): void {
        this.releaseHold(window);
        const measured = this.measure(block);
        if (measured > 0) this.heights.keep(this.layout(), window.file.path, measured);
        // The heights for the other empty blocks may have changed. They get
        // them when scrolling next stops (ADR 0014).
        if (this.reservations.owed) this.reserveOnceStill();
    }

    /**
     * styles.css turns the custom property into the block's height. The name is
     * written out here, not shared with the code that removes it, because the
     * compliance rule searches the source text for it (D-003).
     */
    private markUnloaded(block: HTMLElement, height: number): void {
        block.addClass("is-unloaded");
        block.style.setProperty("--daily-note-placeholder-height", `${height}px`);
    }

    private discard(block: HTMLElement, window: NoteWindow): void {
        this.runs.forget(block);
        if (!window.component) return;
        this.renderer.discard(window.component);
        window.component = null;
    }

    private observe(block: HTMLElement): void {
        this.screenObserver?.observe(block);
        this.renderObserver?.observe(block);
        this.hideObserver?.observe(block);
        this.unloadObserver?.observe(block);
        this.anchor.observe(block);
    }

    private unobserve(block: HTMLElement): void {
        this.screenObserver?.unobserve(block);
        this.renderObserver?.unobserve(block);
        this.hideObserver?.unobserve(block);
        this.unloadObserver?.unobserve(block);
        this.anchor.unobserve(block);
    }

    private detachObservers(): void {
        this.screenObserver?.disconnect();
        this.renderObserver?.disconnect();
        this.hideObserver?.disconnect();
        this.unloadObserver?.disconnect();
        this.anchor.detach();
        this.resizes?.disconnect();
        this.screenObserver = null;
        this.renderObserver = null;
        this.hideObserver = null;
        this.unloadObserver = null;
        // Stryker disable next-line CallExpression: a disconnected observer watches nothing.
        this.runs.observeWith(null, null);
        this.resizes = null;
        // Stryker disable next-line CallExpression: the next observer's first report sets every block's entry again.
        this.onScreen.clear();
    }
}
