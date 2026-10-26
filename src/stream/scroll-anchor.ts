import { Platform, debounce } from "obsidian";
import { BASE_SLOT_CLASS } from "../render/bases/bases-as-cards";
import { NOTE_CONTENT_CLASS } from "../render/note-renderer";
import { blockAt } from "./stream-blocks";

/**
 * How long the scroll must stay still before the stream treats it as stopped
 * (D-032).
 */
export const SCROLL_IDLE_MS = 300;

/**
 * WebKit's layout unit: no layout moves anything by less than this. A smaller
 * amount owed is only a rounding error from adding fractions, as 0.1 + 0.2 -
 * 0.3 gives 5.6e-17.
 */
const LAYOUT_UNIT = 1 / 64;

/**
 * The elements from a block down to one inside it, each with its position in
 * the pane and its height.
 */
type Place = { el: Element; top: number; height: number }[];

/**
 * Keeps the reader's place where the platform does not. Chromium keeps it
 * itself; iOS's WebKit does not. The place is the element at the top of the
 * pane. Anything that moves it is above the screen, where the reader did not
 * touch, so the move is undone. A fold arrow tapped on screen only changes what
 * is below it.
 *
 * A change is first shown by shifting the stream. Once scrolling stops, the
 * shift is moved into the scroll position. While iOS is scrolling, it ignores
 * or undoes a change to the scroll position, and setting the scroll position
 * directly made the page jump on a phone.
 */
export class ScrollAnchor {
    private observer: ResizeObserver | null = null;
    private scrollRoot: HTMLElement | null = null;
    /**
     * The element that holds the blocks. It is shifted while a change is owed
     * to the scroll.
     */
    private stream: HTMLElement | null = null;
    /** The blocks being watched. */
    private readonly watched = new Set<Element>();
    /**
     * Watched blocks whose size is not observed: their height only changes when
     * it is re-pinned, and the anchor is told.
     */
    private readonly pins = new Set<Element>();
    /**
     * The elements from a block down to the element at the top of the pane,
     * each with its position. Re-rendering the note may replace the deeper
     * ones; then the deepest one left is used instead.
     */
    // Stryker disable next-line ArrayDeclaration: attach calls detach first,
    // which unloads it.
    private place: Place = [];
    /**
     * The same, for the first element that starts inside the pane. This one is
     * kept instead once the pane's width changes (D-057).
     */
    // Stryker disable next-line ArrayDeclaration: only read while the text reflows, and no element of an old one is in the pane.
    private reflowPlace: Place = [];
    /**
     * What is rendered by the Base at the top of the pane. It fills in after it
     * is rendered, inside a box kept at a fixed height.
     */
    private drawnBase: Element | null = null;
    /**
     * The scroll position when `place` was read. A script may change it before
     * a resize is reported.
     */
    private placeScroll = 0;
    /**
     * The last scroll position heard, or set by the anchor. Each step of a
     * scroll is measured from it. `placeScroll` can't be used: a resize
     * reported at the position of the next scroll event reads the place there,
     * so that step would measure as zero.
     */
    private stepFrom = 0;
    /** The pane's width when `place` was read. */
    private placeWidth = 0;
    /**
     * The width changed since the shift was last moved into the scroll. The
     * text reflows over several frames, and `reflowPlace`, as read before, is
     * kept through all of them. Read again during the reflow, it was whatever
     * was being re-rendered.
     */
    // Stryker disable next-line BooleanLiteral: attach calls detach first, which resets it.
    private reflowing = false;
    /**
     * How far the scroll must move to keep the place. Until scrolling stops, it
     * is shown as a shift.
     */
    private owed = 0;
    /** The blocks' parent, shifted while `owed` is not zero. */
    private shifted: HTMLElement | null = null;
    /** The page is scrolling to the top, so nothing above is owed. */
    private headedForTop = false;
    /**
     * The scroll went past the top: iOS bounces a scroll that reaches the top.
     */
    // Stryker disable next-line BooleanLiteral: attach calls detach first, which resets it.
    private bouncing = false;
    /**
     * A finger is on the pane. During a bounce under a finger, the scroll is at
     * the top for one frame, then goes past it again.
     */
    // Stryker disable next-line BooleanLiteral: attach calls detach first, which resets it.
    private touching = false;
    private readonly settleOnceStill = debounce(() => this.settle(), SCROLL_IDLE_MS, true);
    /**
     * Every note is loaded, so nothing more will come below the stream's end to
     * fill space a shift leaves empty there.
     */
    private loadedToEnd!: () => boolean;

    /**
     * Starts keeping the place of `stream`'s blocks, which scroll in
     * `scrollRoot`.
     */
    attach(scrollRoot: HTMLElement, stream: HTMLElement, loadedToEnd: () => boolean): void {
        this.detach();
        this.loadedToEnd = loadedToEnd;
        // iOS's WebKit understands overflow-anchor, so CSS.supports says yes,
        // but it keeps no place. A trace on a phone showed it never turns on.
        if (!Platform.isIosApp && CSS.supports("overflow-anchor", "auto")) return;
        this.scrollRoot = scrollRoot;
        this.stream = stream;
        this.placeWidth = scrollRoot.clientWidth;
        this.stepFrom = scrollRoot.scrollTop;
        // styles.css sets overflow-anchor to none, so the browser's own partial
        // anchoring does not correct the scroll a second time.
        scrollRoot.addClass("is-scroll-anchored");
        this.observer = new ResizeObserver(() => this.hold());
    }

    observe(block: HTMLElement): void {
        if (!this.observer) return;
        this.observer.observe(block);
        this.watched.add(block);
    }

    unobserve(block: HTMLElement): void {
        this.observer?.unobserve(block);
        this.watched.delete(block);
        this.pins.delete(block);
    }

    /**
     * `block`'s height only changes when it is re-pinned, which calls
     * `resized()` (ADR 0013). If it were observed, its report would come one
     * round after the report of the content that caused it, and WebKit logs
     * that as an error.
     */
    pinned(block: HTMLElement): void {
        if (!this.watched.has(block)) return;
        this.pins.add(block);
        this.observer!.unobserve(block);
    }

    /**
     * `block` was unloaded, or has no height: observe its size again.
     */
    unpinned(block: HTMLElement): void {
        if (this.pins.delete(block)) this.observer!.observe(block);
    }

    /**
     * A block's height changed in this task. The change is owed now, and shown
     * in the same frame: while scrolling, iOS draws a resize before it reports
     * it (ADR 0013).
     */
    resized(): void {
        if (this.scrollRoot) this.hold();
    }

    /**
     * `block`'s height is no longer held. A place read while it was held stops
     * at the block itself, and a reflow would move the text inside it. So read
     * the place again, as a resize would; letting go at the same height reports
     * no resize.
     */
    released(block: HTMLElement): void {
        if (this.place.at(-1)?.el === block) this.hold();
    }

    /**
     * What is at the top of the pane is about to move inside its block, which
     * has not scrolled or changed height since the place was last read. So read
     * the place now. `drawn` is a note rendered from its end. If its top is in
     * the upper half of the pane, its text is what the reader is reading, so
     * its text is kept in place. The top of the pane is then in the note above,
     * which rendering this note never moves (ADR 0022). With the scroll at the
     * top, there is no note above, so the stream's top is kept.
     */
    readPlace(drawn?: HTMLElement): void {
        if (!this.scrollRoot) return;
        this.hold();
        if (drawn && this.scrollRoot.scrollTop > 0) this.pickIn(drawn);
    }

    /**
     * The text at the top of `block`, if the block's top is in the upper half
     * of the pane.
     */
    private pickIn(block: HTMLElement): void {
        const { top } = block.getBoundingClientRect();
        const pane = this.scrollRoot!.getBoundingClientRect();
        const content = block.querySelector(`:scope > .${NOTE_CONTENT_CLASS}`);
        if (top <= pane.top || top > pane.top + pane.height / 2 || !content) return;
        this.place = this.placeOf(this.stream!, this.belowGap(content, top));
        this.reflowPlace = this.place;
    }

    /**
     * The blocks above the place are about to move it by `moved`. Show the
     * shift now, before a layout sees the shorter stream and pulls the scroll
     * back. When the resize is reported afterwards, nothing more is owed (ADR
     * 0015).
     */
    anticipate(moved: number): void {
        const stream = this.stream;
        // Stryker disable next-line LogicalOperator: attach and detach always set and clear both together.
        if (!this.scrollRoot || !stream || moved === 0) return;
        this.setOwed(this.owed + moved);
        this.shift(stream);
        this.settleOnceStill();
    }

    /**
     * Whether the place read before the width changed is being kept. It is kept
     * until the anchor moves the shift into the scroll itself (D-057). A width
     * change that no resize has reported yet starts keeping it.
     */
    holdsReflow(): boolean {
        if (this.scrollRoot) this.hold();
        return this.reflowing;
    }

    fingerDown(): void {
        this.touching = true;
    }

    /**
     * A finger that lifts above the top dragged the stream back down, so what
     * follows is not a bounce, and may be a scroll.
     */
    fingerUp(): void {
        this.touching = false;
        if (this.scrollRoot && this.scrollRoot.scrollTop >= 0) this.bouncing = false;
    }

    /**
     * Scrolling has stopped now. Move what is owed into the scroll at once,
     * without waiting.
     */
    handOver(): void {
        if (!this.scrollRoot) return;
        this.settleOnceStill.cancel();
        this.settle();
    }

    /**
     * A scroll moves the place, and delays moving the shift into the scroll
     * until scrolling stops. A bounce at the top ends a scroll. The shift is
     * moved into the scroll then, not once everything is still, so a flick in
     * the meantime finds room above. During a bounce, iOS undoes any change to
     * the scroll position, including a bounce under a finger, which ends when
     * the finger lifts. If the stream is shifted, and a scroll is about to
     * bring the stream's top or end into the pane, the scroll is stopped there,
     * before the empty space past it.
     */
    onScroll(): void {
        if (!this.scrollRoot) return;
        // When the browser pulls the scroll back to the stream's end, that is
        // not a step of a scroll.
        const moved = this.clamped(this.stepFrom) ? 0 : this.stepFrom - this.scrollRoot.scrollTop;
        this.stepFrom = this.scrollRoot.scrollTop;
        this.hold();
        const bounced = this.bouncing && this.scrollRoot.scrollTop >= 0 && !this.touching;
        this.bouncing = this.scrollRoot.scrollTop < 0 || (this.bouncing && this.touching);
        if (this.owed !== 0 && bounced) this.handOver();
        else if (this.topDueInView(moved)) this.stopGlide(0);
        // One step further: iOS paints one step past the scroll position it
        // reports, and stopping there moved the text back against the scroll.
        else if (this.owed !== 0 && (this.endDueInView(moved) || this.scrollRunsOutAbove(moved)))
            this.stopGlide(this.scrollRoot.scrollTop + this.owed - moved);
        else if (this.owed !== 0) this.settleOnceStill();
        else if (this.scrollRoot.scrollTop === 0) this.headedForTop = false;
    }

    /**
     * Stops a scroll at `scrollTop`, where the stream's top or end is rendered,
     * by making its last step shorter. iOS keeps scrolling after the scroll
     * position is set, and undoes it in the next frame. If nothing can scroll
     * for that frame, the scroll ends where it was set.
     */
    private stopGlide(scrollTop: number): void {
        const root = this.scrollRoot!;
        root.addClass("is-scroll-frozen");
        window.requestAnimationFrame(() => root.removeClass("is-scroll-frozen"));
        this.settleOnceStill.cancel();
        root.scrollTop = scrollTop;
        this.stepFrom = root.scrollTop;
        this.headedForTop = false;
        this.unshift();
        this.pick();
    }

    /**
     * The stream is shifted down, and its top will be inside the pane within
     * two more steps of `moved`. Above it is empty space. Stopping only once
     * the top is visible was too late: iOS had already drawn one frame past it.
     * Two steps, because a dropped frame doubles a step.
     */
    private topDueInView(moved: number): boolean {
        const stream = this.stream;
        return this.owed < 0 && !!stream && this.topInPane(stream) + 2 * Math.max(moved, 0) >= 0;
    }

    /**
     * Every note is loaded, the stream is shifted up, and its end will be
     * inside the pane within two more steps of a downward scroll of `moved`.
     * Below the end is empty space until scrolling stops. While notes are still
     * loading, they may arrive below first. When the browser pulls the scroll
     * back, as when the screen is turned, nothing moved, so it is not a scroll.
     */
    private endDueInView(moved: number): boolean {
        // Stryker disable next-line EqualityOperator: only asked while something is owed.
        return moved < 0 && this.owed > 0 && this.loadedToEnd() && this.below() - this.owed <= -2 * moved;
    }

    /**
     * An upward scroll will reach a scroll position of zero within two more
     * steps of `moved`, before the stream's top, which is shifted up. Only
     * asked when `topDueInView` is false (D-143). A bounce that has started is
     * left to `handOver`. A scroll to the top lands on it and owes nothing.
     */
    private scrollRunsOutAbove(moved: number): boolean {
        const { scrollTop } = this.scrollRoot!;
        return !this.headedForTop && scrollTop > 0 && scrollTop <= 2 * moved;
    }

    /**
     * The page is scrolling to the top. Blocks above the reader grow on the
     * way, and moving that into the scroll on arrival would stop below the top.
     */
    headForTop(): void {
        this.headedForTop = true;
    }

    /**
     * The scroll was just set for the current layout, as Back sets it. It
     * already includes earlier changes, even though their reports arrive one
     * frame later.
     */
    placed(): void {
        this.settleOnceStill.cancel();
        this.unshift();
        this.pick();
    }

    detach(): void {
        this.settleOnceStill.cancel();
        this.observer?.disconnect();
        this.observer = null;
        this.watched.clear();
        this.pins.clear();
        this.drawnBase = null;
        this.bouncing = false;
        this.touching = false;
        // Stryker disable next-line ArrayDeclaration: before the next pick, no element of an old place is in the pane.
        this.place = [];
        this.scrollRoot?.removeClass("is-scroll-anchored");
        this.scrollRoot = null;
        this.stream = null;
        this.unshift();
    }

    /**
     * Something changed size: shift the stream so the place goes back where it
     * was.
     */
    private hold(): void {
        if (this.owe()) this.settleOnceStill();
        if (this.reflowing) this.watchBase();
        else this.pick();
    }

    /**
     * Adds to what is owed how far the place moved since it was read, minus any
     * scrolling. Run it before the place is read again: its layout may include
     * a change that no resize has reported yet.
     */
    private owe(): boolean {
        if (this.scrollRoot!.clientWidth !== this.placeWidth && !this.reflowing) {
            this.reflowing = true;
            this.settleOnceStill();
            // A change of scroll from turning the screen is not the reader's. A
            // pane turned taller pulls the scroll back, and the stream may grow
            // again before that is read (D-101).
            this.placeScroll = this.scrollRoot!.scrollTop;
        }
        const place = this.reflowing ? this.reflowPlace : this.place;
        const point = this.pointOf(place);
        // When the browser pulls the scroll back, that is not the reader's
        // scrolling, now or once the stream grows again. Nor is it a step of a
        // scroll.
        if (this.clamped()) this.placeScroll = this.stepFrom = this.scrollRoot!.scrollTop;
        const scrolled = this.scrollRoot!.scrollTop - this.placeScroll;
        const moved = point ? this.movedSince(point, scrolled) : 0;
        if (moved === 0) return false;
        this.setOwed(this.owed + moved);
        // A shift past the end would be lost anyway when it is moved into the
        // scroll. But not during a bounce past the end: the space below is the
        // bounce's, and limiting the shift to it lost what grew above, and the
        // text dropped.
        if (this.loadedToEnd() && this.below() >= 0) this.setOwed(Math.min(this.owed, this.below()));
        this.shift(this.stream!);
        return true;
    }

    /**
     * The deepest element of `place` still in the stream. Not a note's content
     * element once the element inside it is gone, as a spacer goes when the
     * hidden part it stands for is shown. A note rendered from its end has a
     * content top that rises with every slice rendered (ADR 0022).
     */
    private pointOf(place: Place): Place[number] | undefined {
        const kept = place.filter(({ el }) => this.scrollRoot!.contains(el));
        const point = kept.at(-1);
        if (point !== place.at(-1) && point?.el.hasClass(NOTE_CONTENT_CLASS)) return kept.at(-2);
        return point;
    }

    /**
     * Reads the place: the element rendered at the top of the pane, ignoring
     * anything on top of the stream, and the elements up to its block. It stops
     * at an element whose height is held, because its text is not yet where it
     * will be, and at a Base, because a Base reflows and is re-rendered as a
     * whole.
     */
    private pick(): void {
        this.place = [];
        // Stryker disable next-line ArrayDeclaration: only read while the text reflows, and no element of an old one is in the pane.
        this.reflowPlace = [];
        const stream = this.stream;
        if (!stream) return;
        const pane = this.scrollRoot!.getBoundingClientRect();
        this.placeScroll = this.scrollRoot!.scrollTop;
        this.placeWidth = this.scrollRoot!.clientWidth;
        const drawn = document
            .elementsFromPoint(pane.left + pane.width / 2, pane.top + 1)
            .find((el) => el !== stream && stream.contains(el));
        const hit = drawn ?? blockAt(stream, pane.top);
        if (!hit) return;
        const crossing = this.belowGap(hit, pane.top);

        this.place = this.placeOf(stream, crossing);
        this.watchBase();
        // A Base is kept by how far down it the top of the pane is, whether the
        // text reflows or not.
        if (this.place.some(({ el }) => el.hasClass(BASE_SLOT_CLASS))) {
            this.reflowPlace = this.place;
            return;
        }
        const starting = this.startingIn(pane, stream, crossing);
        // Stryker disable next-line ConditionalExpression: reading it again gives the same place.
        this.reflowPlace = starting === crossing ? this.place : this.placeOf(stream, starting);
    }

    /**
     * If the top of the pane is in a gap in a note's content, the text below
     * it. The content element's own top rises as a note rendered from its end
     * grows above it (ADR 0022), but its text does not move. If the top of the
     * pane is in the gap at a note's end, the next note: a Base filling in
     * above moves the next note, not the top of this one.
     */
    private belowGap(el: Element, paneTop: number): Element {
        if (el.parentElement === this.stream && this.endsAbove(el, paneTop)) return el.nextElementSibling ?? el;
        if (!el.hasClass(NOTE_CONTENT_CLASS)) return el;
        return Array.from(el.children).find((child) => child.getBoundingClientRect().bottom > paneTop) ?? el;
    }

    /**
     * Whether everything rendered in `block` ends above `paneTop`. An empty
     * block has nothing rendered, so it doesn't.
     */
    private endsAbove(block: Element, paneTop: number): boolean {
        const drawn = Array.from(block.children);
        return drawn.length > 0 && drawn.every((child) => child.getBoundingClientRect().bottom <= paneTop);
    }

    /**
     * The elements from `el`'s block down to `el`, with their positions. Stops
     * at an element whose height is held, or at a Base.
     */
    private placeOf(stream: HTMLElement, el: Element): Place {
        const path: Element[] = [];
        // Stryker disable next-line ConditionalExpression: above the stream, elements only move with the scroll and the shift, which are subtracted.
        for (let at: Element | null = el; at && at !== stream; at = at.parentElement) path.unshift(at);
        const place: Place = [];
        for (const at of path) {
            place.push({ el: at, top: this.topInPane(at), height: this.heightOf(at) });
            if (at.hasClass(BASE_SLOT_CLASS)) break;
            if ((at as HTMLElement).style.getPropertyValue("--daily-note-held-height")) break;
        }
        return place;
    }

    /** How much further down the page can scroll. */
    private below(): number {
        const root = this.scrollRoot!;
        return root.scrollHeight - root.clientHeight - root.scrollTop;
    }

    /**
     * Whether the browser pulled the scroll back to the stream's new end since
     * `from`, which is the place's scroll position unless given. This happens
     * when the stream gets shorter by more than there was below the pane, as
     * below a note that was jumped to. A reader never scrolls up onto the end.
     */
    private clamped(from = this.placeScroll): boolean {
        // Stryker disable next-line EqualityOperator: pulling the scroll back to where it already was moves nothing.
        return this.scrollRoot!.scrollTop < from && this.below() <= 1;
    }

    /**
     * How far `point` moved, minus `scrolled`. For a Base at the top of the
     * pane, the top stays the same fraction of the way down the Base. When a
     * Base changes between cards and a table, its entries keep their order, but
     * not their heights (D-056).
     */
    private movedSince(point: Place[number], scrolled: number): number {
        const now = this.topInPane(point.el) + scrolled;
        // Stryker disable next-line EqualityOperator: a place is read 1 px below the top of the pane, so it never starts or ends exactly at the top.
        const crossed = point.top < 0 && point.top + point.height > 0;
        if (!crossed || !point.el.hasClass(BASE_SLOT_CLASS)) return now - point.top;
        const through = -point.top / point.height;
        return now + through * this.heightOf(point.el);
    }

    /**
     * A Base's height is the height of what it renders, not of the box kept at
     * a fixed height for it.
     */
    private heightOf(el: Element): number {
        const drawn = el.hasClass(BASE_SLOT_CLASS) ? (el.lastElementChild ?? el) : el;
        return drawn.getBoundingClientRect().height;
    }

    /**
     * Watches the Base at the top of the pane as it fills in. While its box is
     * held, no watched element changes size.
     */
    private watchBase(): void {
        const base = this.place.find(({ el }) => el.hasClass(BASE_SLOT_CLASS))?.el;
        const drawn = base?.lastElementChild ?? null;
        // Stryker disable next-line ConditionalExpression: stopping and starting to observe the same Base changes nothing.
        if (drawn === this.drawnBase) return;
        if (this.drawnBase) this.observer!.unobserve(this.drawnBase);
        this.drawnBase = drawn;
        if (drawn) this.observer!.observe(drawn);
    }

    /**
     * Measured from the pane, not the window. A phone turned on its side hides
     * the status bar, which moves the pane and everything in it.
     */
    private topInPane(el: Element): number {
        return el.getBoundingClientRect().top - this.scrollRoot!.getBoundingClientRect().top;
    }

    /**
     * The first block element after `crossing`, or after one of its parents,
     * that starts inside the pane: the paragraph or note title below the text
     * at the top. Not a span inside text, which reflows with the text. Returns
     * `crossing` when the next element starts below the pane.
     */
    private startingIn(pane: DOMRect, stream: HTMLElement, crossing: Element): Element {
        // Stryker disable next-line ConditionalExpression: nothing above the stream starts inside the pane.
        for (let el: Element | null = crossing; el && el !== stream; el = el.parentElement) {
            if (getComputedStyle(el).display.startsWith("inline")) continue;
            const next = this.nextDrawn(el);
            if (!next) continue;
            const { top } = next.getBoundingClientRect();
            if (top >= pane.bottom) return crossing;
            // Stryker disable next-line EqualityOperator: an element that starts at the top of the pane is `crossing` itself, since it is read 1 px below the top.
            if (top >= pane.top) return next;
        }
        return crossing;
    }

    /**
     * The next sibling that takes up space. A collapsed section takes up none.
     */
    private nextDrawn(el: Element): Element | null {
        let next = el.nextElementSibling;
        while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
        return next;
    }

    /**
     * Moves the shift into the scroll position, in the same frame. If nothing
     * is owed, the scroll is not set, because setting it to the same value
     * still stops a scroll in progress.
     */
    private settle(): void {
        const root = this.scrollRoot!;
        this.owe();
        if (this.owed !== 0 && !(this.headedForTop && root.scrollTop === 0)) root.scrollTop += this.owed;
        this.stepFrom = root.scrollTop;
        this.headedForTop = false;
        this.unshift();
        this.pick();
    }

    /**
     * styles.css turns the custom property into a transform, which moves what
     * is rendered without changing the scroll. The names are written out in
     * full in both places, because the compliance rule searches the source text
     * for them.
     */
    private shift(content: HTMLElement): void {
        this.shifted = content;
        content.addClass("is-scroll-shifted");
        content.style.setProperty("--daily-notes-scroll-shift", `${-this.owed}px`);
    }

    /**
     * Sets what is owed to `amount`, or to zero when it is smaller than any
     * layout can move.
     */
    private setOwed(amount: number): void {
        this.owed = Math.abs(amount) < LAYOUT_UNIT ? 0 : amount;
    }

    /** Clears what is owed, and the reflow it came from. */
    private unshift(): void {
        this.reflowing = false;
        this.owed = 0;
        this.shifted?.removeClass("is-scroll-shifted");
        this.shifted?.style.removeProperty("--daily-notes-scroll-shift");
        this.shifted = null;
    }
}
