import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Platform } from "obsidian";
import { ScrollAnchor, SCROLL_IDLE_MS } from "../../src/stream/scroll-anchor";

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    disconnected = false;
    readonly targets = new Set<Element>();
    constructor(readonly callback: (entries: { target: Element }[]) => void) {
        FakeResizeObserver.instances.push(this);
    }
    observe(target: Element) {
        this.targets.add(FakeResizeObserver.element(target));
    }
    unobserve(target: Element) {
        this.targets.delete(FakeResizeObserver.element(target));
    }
    /** Like the real one, it throws for anything that is not an element. */
    private static element(target: unknown): Element {
        if (!(target instanceof Element)) throw new TypeError("parameter 1 is not of type 'Element'");
        return target;
    }
    disconnect() {
        this.disconnected = true;
    }
    /** Reports that `targets` changed size, in the order given. */
    resized(...targets: Element[]) {
        this.callback(targets.map((target) => ({ target })));
    }
}

const observer = () => FakeResizeObserver.instances[0]!;

/**
 * How far styles.css draws `el` away from its position, through the custom
 * property.
 */
const shift = (el: HTMLElement) =>
    el.hasClass("is-scroll-shifted") ? parseFloat(el.style.getPropertyValue("--daily-notes-scroll-shift")) : 0;

/**
 * A pane that stacks blocks one under the other inside the stream's content, as
 * the stream does. A block given as a list holds elements of those heights.
 * jsdom has no layout, so each rect is computed from the heights above it, the
 * scroll, and the content's transform.
 */
function makePane(layout: (number | number[])[]) {
    const pane = document.createElement("div");
    let scrollTop = 0;
    Object.defineProperty(pane, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => (scrollTop = value),
    });
    /** The pane's height. The anchor looks for text that starts inside it. */
    let paneHeight = 600;
    /** Where the pane is in the window. A turned phone hides its status bar. */
    let paneTop = 0;
    pane.getBoundingClientRect = () =>
        ({ top: paneTop, bottom: paneTop + paneHeight, height: paneHeight, left: 0, width: 400 }) as DOMRect;
    const movePane = (top: number) => (paneTop = top);
    let width = 400;
    Object.defineProperty(pane, "clientWidth", { configurable: true, get: () => width });
    /**
     * Makes the pane wider, as for a phone on its side, and `height` tall, as
     * for a phone turned upright.
     */
    const turn = (height = paneHeight) => {
        width = 700;
        paneHeight = height;
    };
    const content = pane.createDiv();
    Object.defineProperty(pane, "clientHeight", { configurable: true, get: () => paneHeight });
    Object.defineProperty(pane, "scrollHeight", { configurable: true, get: () => heightOf(content) });

    /** A parent is as tall as its children, or the height it is held at. */
    const heightOf = (el: Element): number =>
        el.children.length > 0
            ? Math.max(
                  Array.from(el.children).reduce((sum, child) => sum + heightOf(child), 0),
                  Number((el as HTMLElement).dataset.heldAt ?? 0)
              )
            : Number((el as HTMLElement).dataset.height ?? (el as HTMLElement).dataset.heldAt);
    const topOf = (el: Element): number => {
        if (el === content) return paneTop - scrollTop + shift(content);
        const parent = el.parentElement!;
        const before = Array.from(parent.children).slice(0, Array.from(parent.children).indexOf(el));
        return before.reduce((top, sibling) => top + heightOf(sibling), topOf(parent));
    };
    /** Gives `el` the rect this layout's arithmetic computes for it. */
    const layOut = (el: HTMLElement) => {
        el.getBoundingClientRect = () => {
            const top = topOf(el);
            const height = heightOf(el);
            return { top, height, bottom: top + height } as DOMRect;
        };
        return el;
    };
    layOut(content);
    /** Adds an element `height` tall to `parent`, laid out like the others. */
    const add = (parent: HTMLElement, height?: number) => {
        const el = layOut(parent.createDiv());
        if (height !== undefined) el.dataset.height = String(height);
        return el;
    };

    const blocks = layout.map((spec) => {
        if (!Array.isArray(spec)) return add(content, spec);
        const block = add(content);
        for (const height of spec) add(block, height);
        return block;
    });
    /**
     * What is drawn at `y`, top first: the deepest element there, then its
     * parents.
     */
    const drawnAt = (y: number): Element[] => {
        const hits: Element[] = [];
        if (y < paneTop) return hits;
        for (let level: Element | undefined = content; level;) {
            // Uses this layout's own arithmetic, because a test counts what the
            // anchor reads.
            level = Array.from(level.children).find((child) => {
                const top = topOf(child);
                return top <= y && y < top + heightOf(child);
            });
            if (level) hits.unshift(level);
        }
        return [...hits, content, pane];
    };
    vi.spyOn(document, "elementsFromPoint").mockImplementation((_x, y) => drawnAt(y));
    const resize = (el: Element, height: number) => ((el as HTMLElement).dataset.height = String(height));
    /**
     * A Base in `parent`, drawn into a child element, as `NoteBases` draws it.
     */
    const addBase = (parent: HTMLElement) => {
        const base = add(parent);
        base.addClass("daily-note-base");
        /** Replaces what is drawn with elements of `heights`. */
        const draw = (...heights: number[]) => {
            base.empty();
            const drawn = add(base);
            for (const height of heights) add(drawn, height);
            return drawn;
        };
        /**
         * Holds its box at `height`, as `NoteBases` holds a Base re-rendered.
         */
        const holdAt = (height: number) => {
            base.dataset.heldAt = String(height);
            base.style.setProperty("--daily-note-held-height", `${height}px`);
        };
        return { base, draw, holdAt };
    };
    return { pane, content, blocks, resize, add, addBase, turn, movePane };
}

/** More notes load below the stream's end. */
const moreBelow = () => false;

describe("ScrollAnchor", () => {
    let anchor: ScrollAnchor;

    beforeEach(() => {
        vi.useFakeTimers();
        FakeResizeObserver.instances = [];
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        vi.stubGlobal("CSS", { supports: () => false });
        anchor = new ScrollAnchor();
    });

    afterEach(() => {
        anchor.detach();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    /**
     * Blocks observed and reported for the first time, as ResizeObserver does
     * when it starts.
     */
    function watch(heights: (number | number[])[], scrollTop: number) {
        const layout = makePane(heights);
        anchor.attach(layout.pane, layout.content, moreBelow);
        for (const block of layout.blocks) anchor.observe(block);
        observer().resized(...layout.blocks);
        layout.pane.scrollTop = scrollTop;
        anchor.onScroll();
        return layout;
    }

    /**
     * Where the third block is drawn: under the pane's top, whatever moved
     * above it.
     */
    const readerTop = (blocks: HTMLElement[]) => blocks[2]!.getBoundingClientRect().top;

    // While scrolling, iOS controls the scroll position: setting it then is
    // ignored or undone, and setting it directly made a phone jump. So a change
    // is shown as a shift first.
    it("holds the reader's place when a block above the pane grows, by shifting the content", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);

        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        expect(pane.scrollTop).toBe(900);
        expect(shift(content)).toBe(-900);
        expect(readerTop(blocks)).toBe(-100);
    });

    // While scrolling, iOS paints a resize before it reports it. Told in the
    // task that made the change, the shift is drawn together with it (ADR
    // 0013).
    it("shifts the moment it is told a block resized, before any report of it", () => {
        const { content, blocks, resize } = watch([400, 400, 400], 900);

        resize(blocks[0]!, 1300);
        anchor.resized();

        expect(shift(content)).toBe(-900);
        expect(readerTop(blocks)).toBe(-100);
    });

    // A shrink shown as a shift in the same task that lays it out keeps the
    // scroll range. If the layout is read in between, the stream is shorter,
    // and the browser pulls the scroll back (ADR 0015).
    it("draws a move it is told of before the layout makes it, and owes no more once it does", () => {
        const { content, blocks, resize } = watch([400, 400, 400], 900);

        anchor.anticipate(-300);
        expect(shift(content)).toBe(300);

        resize(blocks[1]!, 100);
        anchor.resized();

        expect(shift(content)).toBe(300);
        expect(readerTop(blocks)).toBe(-100);
    });

    it("hands a move it was told of to the scroll once the scroll is still", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);

        anchor.anticipate(-300);
        resize(blocks[1]!, 100);
        anchor.resized();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(600);
        expect(readerTop(blocks)).toBe(-100);
    });

    // Added up, 0.1 + 0.2 - 0.3 gives 5.6e-17. Still owed, the stream stayed
    // shifted, and moving the shift into the scroll set the scroll position,
    // which stops a scroll.
    it("owes nothing once moves cancel out, though their sum leaves a remainder", () => {
        const { pane, content } = watch([400, 400, 400], 900);
        const write = vi.fn();
        let scrollTop = pane.scrollTop;
        Object.defineProperty(pane, "scrollTop", {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => {
                write(value);
                scrollTop = value;
            },
        });

        anchor.anticipate(0.1);
        anchor.anticipate(0.2);
        anchor.anticipate(-0.3);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(write).not.toHaveBeenCalled();
    });

    // Nothing owed, nothing to draw (D-177).
    it("draws the stream untransformed when a block above grows by less than a layout moves", () => {
        const { content, blocks, resize } = watch([400, 400, 400], 900);

        resize(blocks[0]!, 400 + 1 / 128);
        observer().resized(blocks[0]!);

        expect(content.hasClass("is-scroll-shifted")).toBe(false);
    });

    it("owes a move as small as a layout moves anything", () => {
        const { content } = watch([400, 400, 400], 900);

        anchor.anticipate(1 / 64);

        expect(shift(content)).toBe(-1 / 64);
    });

    // Told that scrolling stopped, it sets the scroll now. If it waited, a
    // scroll started in the meantime would lose the shift.
    it("hands what it owes to the scroll at once when told the scroll is still", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);

        anchor.anticipate(-300);
        resize(blocks[1]!, 100);
        anchor.resized();
        anchor.handOver();

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(600);
        expect(readerTop(blocks)).toBe(-100);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores being told to hand over before it is attached", () => {
        expect(() => anchor.handOver()).not.toThrow();
    });

    it("ignores being told of a move before it is attached", () => {
        expect(() => anchor.anticipate(-300)).not.toThrow();
    });

    it("ignores being told of a resize before it is attached", () => {
        expect(() => anchor.resized()).not.toThrow();
    });

    // Rendered from its end, a note's text appears under the reader without any
    // scroll or resize. When rendering finishes, the rest of it appears above.
    it("holds text drawn in a block since the place was read, once told to read it", () => {
        const { content, blocks, add } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const undrawn = add(note, 500);
        const text = add(note, 500);

        anchor.readPlace();
        undrawn.remove();
        note.prepend(add(note, 50_000));
        anchor.resized();

        expect(shift(content)).toBe(-49_500);
        expect(text.getBoundingClientRect().top).toBe(0);
    });

    // Scrolling further up brought the top of the note's space into the pane.
    // The pane's top is in the note above, which finishing this note never
    // moves.
    it("holds the text a note drew from its end, where the note's top is in the pane", () => {
        const { content, blocks, add } = watch([1000, 1000, 400], 900);
        const note = blocks[1]!;
        const reserved = add(note, 500);
        const body = add(note);
        body.addClass("daily-note-content");
        const text = add(body, 500);

        anchor.readPlace(note);
        reserved.remove();
        body.prepend(add(body, 50_000));
        anchor.resized();

        expect(shift(content)).toBe(-49_500);
        expect(text.getBoundingClientRect().top).toBe(600);
    });

    it("holds the text a note drew from its end, where the note's top is at the pane's middle", () => {
        const { content, blocks, add } = watch([1000, 1000, 400], 700);
        const note = blocks[1]!;
        const reserved = add(note, 500);
        const body = add(note);
        body.addClass("daily-note-content");
        const text = add(body, 500);

        anchor.readPlace(note);
        reserved.remove();
        body.prepend(add(body, 50_000));
        anchor.resized();

        expect(shift(content)).toBe(-49_500);
        expect(text.getBoundingClientRect().top).toBe(800);
    });

    // The reader reads what is in the middle of the pane, which here is the
    // note above.
    it("holds the note above, where a note drawn from its end starts below the pane's middle", () => {
        const { content, blocks, add } = watch([1000, 1000, 400], 600);
        const note = blocks[1]!;
        const reserved = add(note, 500);
        const body = add(note);
        body.addClass("daily-note-content");
        add(body, 500);

        anchor.readPlace(note);
        reserved.remove();
        body.prepend(add(body, 50_000));
        anchor.resized();

        expect(shift(content)).toBe(0);
        expect(blocks[0]!.getBoundingClientRect().top).toBe(-600);
    });

    // Scrolling to the top reached the newest note above the pane, and drew it
    // from its end. When rendering finished, it was 156 px below its title on
    // an iPhone.
    it("holds the stream's top, where a note drawn from its end lands with the scroll at the top", () => {
        // The stream's padding above its newest note.
        const { pane, content, blocks, add } = watch([8, 1000, 400], 0);
        const note = blocks[1]!;
        const reserved = add(note, 500);
        const body = add(note);
        body.addClass("daily-note-content");
        add(body, 500);

        anchor.readPlace(note);
        reserved.remove();
        body.prepend(add(body, 50_000));
        anchor.resized();

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(0);
        expect(note.getBoundingClientRect().top).toBe(8);
    });

    it("holds the pane's top as ever, where a note drawn from its end starts at it", () => {
        const { content, blocks, add } = watch([1000, 1000, 400], 1000);
        const note = blocks[1]!;
        const reserved = add(note, 500);
        const body = add(note);
        body.addClass("daily-note-content");
        add(body, 500);

        anchor.readPlace(note);
        reserved.remove();
        body.prepend(add(body, 50_000));
        anchor.resized();

        expect(shift(content)).toBe(0);
        expect(note.getBoundingClientRect().top).toBe(0);
    });

    it("holds the pane's top as ever, where a note drawn from its end crosses it", () => {
        const { content, blocks, add } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const body = add(note);
        body.addClass("daily-note-content");
        const undrawn = add(body, 500);
        const text = add(body, 500);

        anchor.readPlace(note);
        undrawn.remove();
        body.prepend(add(body, 50_000));
        anchor.resized();

        expect(shift(content)).toBe(-49_500);
        expect(text.getBoundingClientRect().top).toBe(0);
    });

    // Rendered from its end, a note's content grows above the reader. Its top
    // rises with every slice, while the text under the reader stays still.
    it("holds the text below a gap in a note's content, not the content itself", () => {
        const { pane, content, blocks } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const body = note.createDiv({ cls: "daily-note-content" });
        const text = body.createDiv();
        let bodyTop = -500;
        body.getBoundingClientRect = () => ({ top: bodyTop, bottom: 500, height: 500 - bodyTop }) as DOMRect;
        text.getBoundingClientRect = () => ({ top: 100, bottom: 400, height: 300 }) as DOMRect;
        vi.mocked(document.elementsFromPoint).mockReturnValue([body, note, content, pane]);

        anchor.readPlace();
        bodyTop = -20_000;
        anchor.resized();

        expect(shift(content)).toBe(0);
    });

    // Showing a hidden run again removes its spacer. The content's top, which
    // has risen with every slice since, says nothing about where the reader is.
    it("holds the note, not its content, once what it held at the pane's top is gone", () => {
        const { pane, content, blocks, resize } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const body = note.createDiv({ cls: "daily-note-content" });
        const spacer = body.createDiv({ cls: "daily-note-far-run" });
        let bodyTop = -500;
        body.getBoundingClientRect = () => ({ top: bodyTop, bottom: 500, height: 500 - bodyTop }) as DOMRect;
        spacer.getBoundingClientRect = () => ({ top: -100, bottom: 400, height: 500 }) as DOMRect;
        vi.mocked(document.elementsFromPoint).mockReturnValue([spacer, body, note, content, pane]);

        anchor.readPlace();
        spacer.remove();
        bodyTop = -12_500;
        resize(blocks[0]!, 500);
        anchor.resized();

        expect(shift(content)).toBe(-100);
    });

    it("holds the text starting at the pane's top, not the text ending there", () => {
        const { pane, content, blocks } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const body = note.createDiv({ cls: "daily-note-content" });
        const ended = body.createDiv();
        const text = body.createDiv();
        ended.getBoundingClientRect = () => ({ top: -100, bottom: 0, height: 100 }) as DOMRect;
        let textTop = 0;
        text.getBoundingClientRect = () => ({ top: textTop, bottom: textTop + 300, height: 300 }) as DOMRect;
        vi.mocked(document.elementsFromPoint).mockReturnValue([body, note, content, pane]);

        anchor.readPlace();
        textTop = 50;
        anchor.resized();

        expect(shift(content)).toBe(-50);
    });

    // Unloading a note removes the element at the pane's top with it.
    it("holds nothing once the block at the pane's top is gone", () => {
        const { content, blocks } = watch([400, 400, 400], 900);

        blocks[2]!.remove();
        anchor.resized();

        expect(shift(content)).toBe(0);
    });

    // The gap at the end of a note's content, below its last Base. The
    // content's top does not move when that Base fills in; what follows the
    // content dropped 180 px on an iPad.
    it("holds what follows a note's content where the pane's top falls in the gap at its end", () => {
        const { pane, content, blocks } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const body = note.createDiv({ cls: "daily-note-content" });
        const base = body.createDiv();
        const after = note.createDiv();
        let grown = 0;
        body.getBoundingClientRect = () => ({ top: -500, bottom: 30 + grown, height: 530 + grown }) as DOMRect;
        base.getBoundingClientRect = () => ({ top: -400, bottom: -20 + grown, height: 380 + grown }) as DOMRect;
        after.getBoundingClientRect = () => ({ top: 40 + grown, bottom: 140 + grown, height: 100 }) as DOMRect;
        vi.mocked(document.elementsFromPoint).mockReturnValue([body, note, content, pane]);

        anchor.readPlace();
        grown = 180;
        anchor.resized();

        expect(shift(content)).toBe(-180);
    });

    // A note drawn from its end grows at its top (ADR 0022). Holding the
    // content's top moved what is on screen down.
    it("holds what follows a note's content, not its rising top, where no text lies below the pane's top in it", () => {
        const { pane, content, blocks } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const body = note.createDiv({ cls: "daily-note-content" });
        const text = body.createDiv();
        const after = note.createDiv();
        let bodyTop = -500;
        body.getBoundingClientRect = () => ({ top: bodyTop, bottom: 500, height: 500 - bodyTop }) as DOMRect;
        text.getBoundingClientRect = () => ({ top: -500, bottom: -100, height: 400 }) as DOMRect;
        after.getBoundingClientRect = () => ({ top: 500, bottom: 600, height: 100 }) as DOMRect;
        vi.mocked(document.elementsFromPoint).mockReturnValue([body, note, content, pane]);

        anchor.readPlace();
        bodyTop = -600;
        anchor.resized();

        expect(shift(content)).toBe(0);
    });

    // What the view draws after the stream is no part of the stream's place.
    it("holds a note's content where no text lies below the pane's top and no note follows it", () => {
        const { pane, content, blocks } = watch([400, 1000], 900);
        const note = blocks[1]!;
        const body = note.createDiv({ cls: "daily-note-content" });
        const text = body.createDiv();
        pane.createDiv().getBoundingClientRect = () => ({ top: 500, bottom: 600, height: 100 }) as DOMRect;
        let bodyTop = -500;
        body.getBoundingClientRect = () => ({ top: bodyTop, bottom: 500, height: 500 - bodyTop }) as DOMRect;
        text.getBoundingClientRect = () => ({ top: -500, bottom: -100, height: 400 }) as DOMRect;
        vi.mocked(document.elementsFromPoint).mockReturnValue([body, note, content, pane]);

        anchor.readPlace();
        bodyTop = -600;
        anchor.resized();

        expect(shift(content)).toBe(100);
    });

    it("holds the next note where the pane's top falls in the gap at the end of a note's content", () => {
        const { pane, blocks, add, resize } = watch([400, [], 400], 0);
        const body = add(blocks[1]!);
        body.addClass("daily-note-content");
        const base = add(body, 300);
        body.dataset.heldAt = "400";
        pane.scrollTop = 750;
        anchor.onScroll();
        const nextTop = blocks[2]!.getBoundingClientRect().top;

        resize(base, 480);
        anchor.resized();

        expect(blocks[2]!.getBoundingClientRect().top).toBe(nextTop);
    });

    it("holds the part starting exactly at the pane's top where only the note is hit", () => {
        const { pane, content, blocks, resize } = watch([400, [300, 300], 400], 400);
        const note = blocks[1]!;
        vi.mocked(document.elementsFromPoint).mockReturnValue([note, content, pane]);
        pane.scrollTop = 700;
        anchor.onScroll();

        resize(note.firstElementChild!, 500);
        anchor.resized();

        expect(shift(content)).toBe(-200);
    });

    // A note's bottom padding, between its text and the next note. What is
    // drawn there is the note itself, whose top does not move when a Base above
    // fills in. The text below the pane's top did move, by 603 px on an iPhone.
    it("holds the next note where the pane's top falls in the gap at a note's end", () => {
        const { pane, blocks, resize } = watch([400, [500], 400], 400);
        const note = blocks[1]!;
        note.dataset.heldAt = "600";
        pane.scrollTop = 950;
        anchor.onScroll();
        const nextTop = blocks[2]!.getBoundingClientRect().top;

        resize(note.firstElementChild!, 800);
        anchor.resized();

        expect(blocks[2]!.getBoundingClientRect().top).toBe(nextTop);
    });

    it("holds a Base, not what follows it, where the pane's top falls in the box held open for it", () => {
        const { pane, content, blocks, add, addBase } = watch([400, [], 400], 400);
        const note = blocks[1]!;
        const { draw, holdAt } = addBase(note);
        add(note, 100);
        draw(300);
        holdAt(600);
        pane.scrollTop = 750;
        anchor.onScroll();

        draw(900);
        anchor.resized();

        expect(shift(content)).toBe(0);
    });

    // A note rendering from its end hides its title, which is then not found at
    // any point.
    it("holds the note where something in it crosses the pane's top unhit", () => {
        const { pane, content, blocks, resize } = watch([400, [300, 300], 400], 400);
        const note = blocks[1]!;
        vi.mocked(document.elementsFromPoint).mockReturnValue([note, content, pane]);
        pane.scrollTop = 800;
        anchor.onScroll();

        resize(note.firstElementChild!, 500);
        anchor.resized();

        expect(shift(content)).toBe(0);
    });

    // A note's parts have gaps between them: above its title, and between its
    // properties, content and mentions. What is drawn there is the note
    // itself, whose top does not move when a Base above fills in. The text
    // below the gap did, by 180 and 898 px on an iPad.
    it("holds the part below the pane's top where it falls in a gap between a note's parts", () => {
        const { pane, content, blocks } = watch([400, 1000, 400], 900);
        const note = blocks[1]!;
        const above = note.createDiv();
        const below = note.createDiv();
        above.getBoundingClientRect = () => ({ top: -500, bottom: -20, height: 480 }) as DOMRect;
        let belowTop = 20;
        below.getBoundingClientRect = () => ({ top: belowTop, bottom: belowTop + 300, height: 300 }) as DOMRect;
        vi.mocked(document.elementsFromPoint).mockReturnValue([note, content, pane]);

        anchor.readPlace();
        belowTop = 200;
        anchor.resized();

        expect(shift(content)).toBe(-180);
    });

    it("holds the next note where the note's text ends exactly at the pane's top", () => {
        const { pane, blocks, resize } = watch([400, [500], 400], 400);
        blocks[1]!.dataset.heldAt = "600";
        pane.scrollTop = 900;
        anchor.onScroll();
        const nextTop = blocks[2]!.getBoundingClientRect().top;

        resize(blocks[1]!.firstElementChild!, 800);
        anchor.resized();

        expect(blocks[2]!.getBoundingClientRect().top).toBe(nextTop);
    });

    it("holds the note itself where the pane's top falls in the gap at the stream's last note", () => {
        const { pane, content, blocks, resize } = watch([400, [500]], 400);
        blocks[1]!.dataset.heldAt = "600";
        pane.scrollTop = 950;
        anchor.onScroll();

        resize(blocks[1]!.firstElementChild!, 800);
        anchor.resized();

        expect(shift(content)).toBe(0);
    });

    it("has no place to read before it is attached", () => {
        expect(() => anchor.readPlace()).not.toThrow();
    });

    // A phone turned on its side hides the status bar. The pane moves up, and
    // everything in it moves with the pane.
    it("owes nothing for the pane itself moving", () => {
        const { pane, content, blocks, turn, movePane } = watch([400, 400, 400], 900);

        movePane(-47);
        turn();
        observer().resized(...blocks);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(900);
    });

    it("holds it when a block above shrinks", () => {
        const { content, blocks, resize } = watch([400, 400, 400], 900);

        resize(blocks[1]!, 100);
        observer().resized(blocks[1]!);

        expect(shift(content)).toBe(300);
        expect(readerTop(blocks)).toBe(-100);
    });

    it("adds up several blocks above, reported together or apart", () => {
        const { content, blocks, resize } = watch([400, 400, 400], 900);

        resize(blocks[0]!, 500);
        resize(blocks[1]!, 600);
        observer().resized(blocks[0]!, blocks[1]!);
        resize(blocks[0]!, 600);
        observer().resized(blocks[0]!);

        expect(shift(content)).toBe(-400);
        expect(readerTop(blocks)).toBe(-100);
    });

    // Back lays the stream out and scrolls to the place in one task. The growth
    // that the scroll already includes is reported one frame later.
    it("owes nothing for a change the scroll was set to a place after", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 0);

        resize(blocks[0]!, 1300);
        pane.scrollTop = 1800;
        anchor.placed();
        observer().resized(blocks[0]!);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(1800);
    });

    it("drops what it owed when the scroll is set to a place", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        anchor.placed();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(900);
    });

    it("holds the place again for a change after it was set", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 0);
        pane.scrollTop = 900;
        anchor.placed();

        resize(blocks[0]!, 500);
        observer().resized(blocks[0]!);

        expect(shift(content)).toBe(-100);
    });

    it("has nothing to set a place for before it is attached", () => {
        expect(() => anchor.placed()).not.toThrow();
    });

    // A fold arrow tapped in the note at the top of the pane makes it grow
    // below the tap. Moving the scroll would take the note away from the
    // reader.
    it("leaves the place alone when a block reaching into the pane changes", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 300);

        resize(blocks[0]!, 1000);
        observer().resized(blocks[0]!);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(300);
    });

    it("leaves it alone when a block below the pane's top changes", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 300);

        resize(blocks[2]!, 1000);
        observer().resized(blocks[2]!);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBe(300);
    });

    // The first report is a block's size, not a change. Otherwise, a stream
    // restored far down would be pushed by every block above it.
    it("takes a block's first report as its height, not a change", () => {
        const { pane, content, blocks } = makePane([400, 400, 400]);
        pane.scrollTop = 900;
        anchor.attach(pane, content, moreBelow);
        for (const block of blocks) anchor.observe(block);

        observer().resized(...blocks);

        expect(shift(content)).toBe(0);
    });

    // Nothing above the top of the pane was done by the reader, who can only
    // touch what is on screen. So whatever moves the text there is undone.
    describe("at the text at the top of the pane", () => {
        /** The element in the first block that the pane's top is in, at 500. */
        const reading = (blocks: HTMLElement[]) => blocks[0]!.children[1]!;

        it("holds it when something above it grows inside the note reaching into the pane", () => {
            const { content, blocks, resize } = watch([[400, 400, 400], 400], 500);

            resize(blocks[0]!.children[0]!, 1000);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(-600);
            expect(reading(blocks).getBoundingClientRect().top).toBe(-100);
        });

        // A fold arrow tapped on screen changes what is below the reader.
        it("leaves it alone when something below it in that note changes", () => {
            const { content, blocks, resize } = watch([[400, 400, 400], 400], 500);

            resize(blocks[0]!.children[2]!, 1000);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        it("holds the text starting just below the pane's top when the pane's width changes", () => {
            const { content, blocks, resize, turn } = watch([[400, 400, 400], 400], 500);

            turn();
            resize(blocks[0]!.children[1]!, 200);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(200);
            expect(blocks[0]!.children[2]!.getBoundingClientRect().top).toBe(300);
        });

        // The text reflows over several frames, each reported separately.
        it("holds the text below the pane's top until the reflow is handed to the scroll", () => {
            const { pane, content, blocks, resize, turn } = watch([[400, 400, 400], 400], 500);

            turn();
            resize(blocks[0]!.children[1]!, 300);
            observer().resized(blocks[0]!);
            resize(blocks[0]!.children[1]!, 200);
            observer().resized(blocks[0]!);
            expect(blocks[0]!.children[2]!.getBoundingClientRect().top).toBe(300);

            vi.advanceTimersByTime(SCROLL_IDLE_MS);
            expect(pane.scrollTop).toBe(300);
            resize(blocks[0]!.children[1]!, 1000);
            observer().resized(blocks[0]!);
            expect(shift(content)).toBe(0);
        });

        it("says a reflow is held from the width's change until the scroll is still", () => {
            const { blocks, turn } = watch([[400, 400, 400], 400], 500);
            expect(anchor.holdsReflow()).toBe(false);

            turn();
            observer().resized(blocks[0]!);
            expect(anchor.holdsReflow()).toBe(true);

            vi.advanceTimersByTime(SCROLL_IDLE_MS);
            expect(anchor.holdsReflow()).toBe(false);
        });

        // From a phone's log: new heights for empty blocks, due as the phone
        // turned, were set before any resize was reported, and moving the shift
        // into the scroll ended the reflow the turn had started.
        it("holds a reflow from the width's change before any resize is reported", () => {
            const { blocks, resize, turn } = watch([[400, 400, 400], 400], 500);

            turn();
            expect(anchor.holdsReflow()).toBe(true);
            resize(blocks[0]!.children[1]!, 200);
            observer().resized(blocks[0]!);
            expect(blocks[0]!.children[2]!.getBoundingClientRect().top).toBe(300);

            vi.advanceTimersByTime(SCROLL_IDLE_MS);
            expect(anchor.holdsReflow()).toBe(false);
        });

        it("ends a reflow that moved nothing once the scroll is still", () => {
            const { content, blocks, resize, turn } = watch([[400, 400, 400], 400], 500);

            turn();
            observer().resized(blocks[0]!);
            vi.advanceTimersByTime(SCROLL_IDLE_MS);
            resize(blocks[0]!.children[1]!, 1000);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        it("holds the block below text crossing the pane's top, not a span inside that text", () => {
            const { pane, content, blocks, resize, add, turn } = watch([[400, 400, 400], 400], 0);
            const text = blocks[0]!.children[1] as HTMLElement;
            add(text, 200).style.display = "inline";
            const after = add(text, 200);
            pane.scrollTop = 500;
            anchor.onScroll();

            turn();
            resize(after, 100);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(100);
            expect(blocks[0]!.children[2]!.getBoundingClientRect().top).toBe(300);
        });

        it("holds the block below text crossing the pane's top, not an inline block inside that text", () => {
            const { pane, content, blocks, resize, add, turn } = watch([[400, 400, 400], 400], 0);
            const text = blocks[0]!.children[1] as HTMLElement;
            add(text, 200).style.display = "inline-block";
            const after = add(text, 200);
            pane.scrollTop = 500;
            anchor.onScroll();

            turn();
            resize(after, 100);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(100);
        });

        it("climbs past what sits beside the text crossing the pane's top, as cards in a row", () => {
            const { pane, content, blocks, resize, add, turn } = watch([[400, 400, 400], 400], 0);
            const row = blocks[0]!.children[1] as HTMLElement;
            const card = add(row, 200);
            add(row, 200).getBoundingClientRect = () => card.getBoundingClientRect();
            pane.scrollTop = 500;
            anchor.onScroll();

            turn();
            resize(card, 100);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(100);
        });

        // A folded section's body is display: none, so it is not drawn
        // anywhere.
        it("passes over what takes up no space to the block after it", () => {
            const { content, blocks, resize, turn } = watch([[400, 400, 0, 400], 400], 500);
            blocks[0]!.children[2]!.getBoundingClientRect = () => ({ top: 0, height: 0, bottom: 0 }) as DOMRect;
            anchor.onScroll();

            turn();
            resize(blocks[0]!.children[1]!, 200);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(200);
        });

        it("holds the text crossing the pane's top when nothing starts below it in the pane", () => {
            const { content, blocks, resize, turn } = watch([[400, 1200, 400]], 500);

            turn();
            resize(blocks[0]!.children[1]!, 1300);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        it("holds the text crossing the pane's top when what follows starts at the pane's bottom", () => {
            const { content, blocks, resize, turn } = watch([[400, 700, 400]], 500);

            turn();
            resize(blocks[0]!.children[1]!, 800);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        it("follows the reader as they scroll", () => {
            const { pane, content, blocks, resize } = watch([[400, 400, 400], 400], 500);

            pane.scrollTop = 900;
            anchor.onScroll();
            resize(blocks[0]!.children[1]!, 500);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(-100);
        });

        // A note re-rendered replaces what it held, but its own top is still
        // there.
        it("holds the note's top when the text there was replaced", () => {
            const { content, blocks, resize, add } = watch([400, [400, 400]], 500);
            blocks[1]!.empty();
            for (const height of [400, 400]) add(blocks[1]!, height);

            resize(blocks[0]!, 500);
            observer().resized(blocks[0]!, blocks[1]!);

            expect(shift(content)).toBe(-100);
        });

        // A script sets the scroll between a scroll event and the next resize
        // report, as Back and scrolling do. That move was not caused by a
        // resize.
        it("owes nothing for a scroll since it last looked", () => {
            const { pane, content, blocks, resize } = watch([[400, 400, 400], 400], 500);

            pane.scrollTop = 700;
            resize(blocks[1]!, 500);
            observer().resized(blocks[1]!);

            expect(shift(content)).toBe(0);
        });

        // A note is drawn between frames. The next frame's scroll event comes
        // before the resize report, and the layout it reads already includes
        // the growth.
        it("owes a change the scroll hears of before a resize reports it", () => {
            const { pane, content, blocks, resize } = watch([[400, 400, 400], 400], 500);

            resize(blocks[0]!.children[0]!, 1000);
            pane.scrollTop = 450;
            anchor.onScroll();
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(-600);
        });

        it("owes a change made since it last looked before handing over", () => {
            const { pane, blocks, resize } = watch([[400, 400, 400], 400], 500);
            resize(blocks[0]!.children[0]!, 500);
            observer().resized(blocks[0]!);

            resize(blocks[0]!.children[0]!, 600);
            vi.advanceTimersByTime(SCROLL_IDLE_MS);

            expect(pane.scrollTop).toBe(700);
        });

        // Cards and a table list the same entries in the same order, so the
        // reader ends up as far through one as they were through the other.
        it("keeps how far the pane's top was through a Base redrawn under it", () => {
            const { pane, content, blocks, addBase } = makePane([[400], 400]);
            const { base, draw } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            draw(400);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(300);
            expect(base.getBoundingClientRect().top).toBe(-200);
        });

        // From a phone's log: after a turn, the cards reflow wider before the
        // Base is re-rendered, and a card below the pane's top says nothing
        // about the place.
        it("keeps how far the pane's top was through a Base whose cards re-flow as the width changes", () => {
            const { pane, content, blocks, addBase, turn, resize } = makePane([[400], 400]);
            const { base, draw } = addBase(blocks[0]!);
            const drawn = draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            turn();
            for (const card of Array.from(drawn.children)) resize(card, 40);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(300);
            expect(base.getBoundingClientRect().top).toBe(-200);
        });

        // From a phone's log: during a turn, the Base was unloaded to be
        // re-rendered, without a held height. The place read again then was its
        // note, whose top never moved.
        it("keeps the place read before the width changed through a Base emptied and redrawn", () => {
            const { pane, content, blocks, addBase, turn, resize } = makePane([[400], 400]);
            const { base, draw } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            turn();
            resize(blocks[0]!.children[0]!, 563);
            observer().resized(blocks[0]!);
            base.empty();
            base.dataset.height = "0";
            observer().resized(blocks[0]!);
            const redrawn = draw(...Array<number>(4).fill(100));
            observer().resized(blocks[0]!);

            expect(base.getBoundingClientRect().top).toBe(-200);
            vi.advanceTimersToNextFrame();
            expect(observer().targets).toContain(redrawn);
        });

        it("keeps the pane's top in a Base, not the heading starting below it, as the width changes", () => {
            const { pane, content, blocks, add, addBase, turn, resize } = makePane([[400], 400]);
            const { base, draw } = addBase(blocks[0]!);
            const drawn = draw(...Array<number>(10).fill(100));
            add(blocks[0]!, 200);
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 1350;
            anchor.onScroll();

            turn();
            for (const card of Array.from(drawn.children)) resize(card, 40);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(570);
            expect(base.getBoundingClientRect().top).toBe(-380);
        });

        it("holds a Base starting in the pane by its top as the width changes, not how far through it", () => {
            const { pane, content, blocks, addBase, turn, resize } = makePane([[400, 400], 400]);
            const drawn = addBase(blocks[0]!).draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 500;
            anchor.onScroll();

            turn();
            for (const card of Array.from(drawn.children)) resize(card, 40);
            resize(blocks[0]!.children[1]!, 500);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(-100);
        });

        // Held at the cards' height, the Base shows the table at its top and
        // nothing under it. The reader's place is kept in what is drawn.
        it("holds the pane's top in what a held Base draws, not the space held for it", () => {
            const { pane, content, blocks, add, addBase } = makePane([[400], 400]);
            const { base, draw, holdAt } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            holdAt(1000);
            const drawn = draw(100);
            observer().resized(blocks[0]!);
            expect(base.getBoundingClientRect().top).toBe(-50);

            // Bases fills the table after drawing it.
            vi.advanceTimersToNextFrame();
            expect(observer().targets).toContain(drawn);
            add(drawn, 300);
            observer().resized(drawn);
            expect(base.getBoundingClientRect().top).toBe(-200);
        });

        // Between emptying a Base and Bases drawing into it, only the held box
        // is there.
        it("holds the pane's top as far through a held Base that draws nothing yet", () => {
            const { pane, content, blocks, addBase } = makePane([[400], 400]);
            const { base, draw, holdAt } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            holdAt(1000);
            base.empty();
            observer().resized(blocks[0]!);

            expect(base.getBoundingClientRect().top).toBe(-500);
        });

        it("stops hearing a Base once the pane's top leaves it", () => {
            const { pane, content, blocks, addBase } = makePane([[400], 400]);
            const drawn = addBase(blocks[0]!).draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();
            expect(observer().targets).toContain(drawn);

            pane.scrollTop = 1500;
            anchor.onScroll();

            expect(observer().targets).not.toContain(drawn);
        });

        /** A pane whose top is in a Base, watched by the anchor. */
        function watchedBase() {
            const { pane, content, blocks, addBase } = makePane([[400], 400]);
            const { base, draw } = addBase(blocks[0]!);
            const first = draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();
            return { base, draw, first, blocks };
        }

        // Bases swaps its placeholder for what it draws, at the same depth.
        // Observing that during a report left it undelivered, which WebKit logs
        // as an error, and it was reported a frame later anyway.
        it("hears what a Base drew instead one frame after a resize report", () => {
            const { base, draw, first } = watchedBase();

            base.empty();
            const next = draw(...Array<number>(10).fill(100));
            observer().resized(first);

            expect(observer().targets).not.toContain(first);
            expect(observer().targets).not.toContain(next);
            vi.advanceTimersToNextFrame();
            expect(observer().targets).toContain(next);
        });

        it("does not hear what a Base drew once the pane's top has left it", () => {
            const { base, draw, first } = watchedBase();
            base.empty();
            const next = draw(...Array<number>(10).fill(100));
            observer().resized(first);

            base.empty();
            const latest = draw(...Array<number>(10).fill(100));
            anchor.onScroll();
            vi.advanceTimersToNextFrame();

            expect(observer().targets).not.toContain(next);
            expect(observer().targets).toContain(latest);
        });

        it("hears a Base at once when the pane's top reaches it by scrolling", () => {
            const { pane, content, blocks, addBase } = makePane([[400], 400]);
            const drawn = addBase(blocks[0]!).draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);

            pane.scrollTop = 900;
            anchor.onScroll();

            expect(observer().targets).toContain(drawn);
        });

        it("does not hear what a Base drew once detached", () => {
            const { base, draw, first } = watchedBase();
            base.empty();
            draw(...Array<number>(10).fill(100));
            observer().resized(first);
            const heard = observer();

            anchor.detach();
            const targets = heard.targets.size;
            vi.advanceTimersToNextFrame();

            expect(heard.targets.size).toBe(targets);
        });

        // There is little below a note that was jumped to. The stream shrinks
        // by more than that, and the browser pulls the scroll back to its new
        // end.
        it("counts a scroll clamped to the stream's end as no scroll of the reader's", () => {
            const { pane, content, blocks, addBase } = makePane([[400], 200]);
            const { base, draw } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            draw(400);
            pane.scrollTop = pane.scrollHeight - pane.clientHeight;
            observer().resized(blocks[0]!);

            expect(base.getBoundingClientRect().top).toBe(-200);
        });

        it("counts a scroll clamped to within a pixel of the stream's end as no scroll of the reader's", () => {
            const { pane, content, blocks, addBase } = makePane([[400], 201]);
            const { base, draw } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            draw(400);
            pane.scrollTop = pane.scrollHeight - pane.clientHeight - 1;
            observer().resized(blocks[0]!);

            expect(base.getBoundingClientRect().top).toBe(-200);
        });

        // At the stream's end, nothing loads below to fill the space a shift
        // leaves past it, so pulling the scroll back moves the place at once.
        it("draws nothing past the stream's end, all of it loaded, when a clamp moves the place", () => {
            const { pane, content, blocks, addBase } = makePane([[400], 200]);
            const { draw } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, () => true);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            draw(400);
            pane.scrollTop = pane.scrollHeight - pane.clientHeight;
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        it("counts a clamp as no scroll of the reader's once the stream grows back mid-reflow", () => {
            const { pane, content, blocks, addBase, turn } = makePane([[400], 200]);
            const { base, draw } = addBase(blocks[0]!);
            draw(...Array<number>(10).fill(100));
            anchor.attach(pane, content, moreBelow);
            for (const block of blocks) anchor.observe(block);
            observer().resized(...blocks);
            pane.scrollTop = 900;
            anchor.onScroll();

            turn();
            draw(400);
            pane.scrollTop = pane.scrollHeight - pane.clientHeight;
            observer().resized(blocks[0]!);
            draw(...Array<number>(8).fill(100));
            observer().resized(blocks[0]!);

            expect(base.getBoundingClientRect().top).toBe(-400);
        });

        // Turning upright makes the pane taller, and the browser pulls the
        // scroll back. The stream may grow again before anything reads it
        // (D-101).
        it("counts a turn's clamp as no scroll of the reader's when the stream grew back unread", () => {
            const { pane, content, blocks, resize, turn } = watch([400, 400, 400], 500);

            turn(900);
            pane.scrollTop = 300;
            resize(blocks[2]!, 800);
            observer().resized(blocks[2]!);
            expect(readerTop(blocks)).toBe(300);

            vi.advanceTimersByTime(SCROLL_IDLE_MS);
            expect(pane.scrollTop).toBe(500);
            expect(shift(content)).toBe(0);
        });

        // Back restores a place measured against a note's full layout. While
        // its height is held, the note is still filling in, and the text at the
        // top is not yet where it will be.
        it("anchors at a note still held, not at text still settling inside it", () => {
            const { pane, content, blocks, resize } = watch([[400, 400, 400], 400], 0);
            blocks[0]!.style.setProperty("--daily-note-held-height", "1200px");
            pane.scrollTop = 500;
            anchor.onScroll();

            resize(blocks[0]!.children[0]!, 1000);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        // Read while the note's height was held, the place stayed at the note's
        // top. A turn afterwards moved the text at the pane's top by 139 px on
        // an iPhone.
        it("holds the text inside a note once its hold lets go", () => {
            const { pane, content, blocks, resize, turn } = watch([[400, 400, 400], 400], 0);
            blocks[0]!.style.setProperty("--daily-note-held-height", "1200px");
            pane.scrollTop = 500;
            anchor.onScroll();
            blocks[0]!.style.removeProperty("--daily-note-held-height");

            anchor.released(blocks[0]!);
            turn();
            resize(blocks[0]!.children[0]!, 200);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(200);
            expect(blocks[0]!.children[1]!.getBoundingClientRect().top).toBe(-100);
        });

        it("reads nothing when a note it holds no place in lets go", () => {
            const { pane, blocks } = watch([[400, 400, 400], 400], 0);
            blocks[0]!.style.setProperty("--daily-note-held-height", "1200px");
            pane.scrollTop = 500;
            anchor.onScroll();
            vi.mocked(document.elementsFromPoint).mockClear();

            anchor.released(blocks[1]!);

            expect(document.elementsFromPoint).not.toHaveBeenCalled();
        });

        it("asks what is drawn there, reading only it and what starts after it", () => {
            const long = Array.from({ length: 100 }, () => 40);
            const { blocks } = watch([400, long], 500);
            const reads = [...blocks[1]!.children].map((el) => vi.spyOn(el, "getBoundingClientRect"));

            anchor.onScroll();

            expect(document.elementsFromPoint).toHaveBeenLastCalledWith(200, 1);
            expect(reads.filter((read) => read.mock.calls.length > 0)).toHaveLength(2);
        });

        it("looks past anything drawn over the stream, as the search bar is", () => {
            const { pane, content, blocks, resize } = watch([[400, 400, 400], 400], 0);
            const hit = vi.mocked(document.elementsFromPoint);
            const drawn = hit.getMockImplementation()!;
            hit.mockImplementation((x, y) => [document.body, ...drawn(x, y)]);
            pane.scrollTop = 500;
            anchor.onScroll();

            resize(blocks[0]!.children[0]!, 1000);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(-600);
        });

        // Between two notes, or before the stream has been laid out.
        it("finds the note under the pane's top when nothing of it is drawn there", () => {
            const { pane, content, blocks, resize } = watch([400, 400, 400], 0);
            vi.mocked(document.elementsFromPoint).mockReturnValue([content, pane]);
            pane.scrollTop = 900;
            anchor.onScroll();

            resize(blocks[0]!, 500);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(-100);
        });

        it("holds the note found under the pane's top, not the text inside it", () => {
            const { pane, content, blocks, resize } = watch([400, 400, [50, 200, 150]], 0);
            vi.mocked(document.elementsFromPoint).mockReturnValue([content, pane]);
            pane.scrollTop = 900;
            anchor.onScroll();

            resize(blocks[2]!.children[0]!, 150);
            observer().resized(blocks[2]!);

            expect(shift(content)).toBe(0);
        });

        it("holds nothing with the pane's top past every note", () => {
            const { pane, content, blocks, resize } = watch([400, 400], 0);
            pane.scrollTop = 1000;
            anchor.onScroll();

            resize(blocks[0]!, 500);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        it("holds nothing, past every note, as the pane turns", () => {
            const { pane, content, blocks, resize, turn } = watch([400, 400], 0);
            pane.scrollTop = 1000;
            anchor.onScroll();

            turn();
            resize(blocks[0]!, 500);
            observer().resized(blocks[0]!);

            expect(shift(content)).toBe(0);
        });

        it("picks it anew once the change is handed over", () => {
            const { pane, blocks, resize } = watch([[400, 400, 400], 400], 500);
            resize(blocks[0]!.children[0]!, 1000);
            observer().resized(blocks[0]!);
            vi.advanceTimersByTime(SCROLL_IDLE_MS);

            resize(blocks[0]!.children[0]!, 1100);
            observer().resized(blocks[0]!);
            vi.advanceTimersByTime(SCROLL_IDLE_MS);

            expect(pane.scrollTop).toBe(1200);
        });

        it("has nothing to hold in a pane holding no notes", () => {
            const { pane, content } = makePane([]);
            anchor.attach(pane, content, moreBelow);

            anchor.onScroll();

            expect(shift(content)).toBe(0);
        });
    });

    it("hands the shift to the scroll once the scroll is still, in one step", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
        expect(pane.scrollTop).toBe(900);

        vi.advanceTimersByTime(1);
        expect(pane.scrollTop).toBe(1800);
        expect(content.hasClass("is-scroll-shifted")).toBe(false);
        expect(content.style.getPropertyValue("--daily-notes-scroll-shift")).toBe("");
        expect(readerTop(blocks)).toBe(-100);
    });

    it("waits for a scroll to stop before handing it over", () => {
        const { pane, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
        anchor.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
        expect(pane.scrollTop).toBe(900);

        vi.advanceTimersByTime(1);
        expect(pane.scrollTop).toBe(1800);
    });

    // A scroll that reaches the top before what it owes bounces there. iOS
    // undoes any change to the scroll during a bounce. Once the bounce ends,
    // the glide has ended too, and a flick within the idle wait hit the same
    // top again.
    it("hands over the moment a bounce at the top ends", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        pane.scrollTop = -120;
        anchor.onScroll();
        pane.scrollTop = -60;
        anchor.onScroll();
        expect(pane.scrollTop).toBe(-60);
        expect(shift(content)).toBe(-900);

        pane.scrollTop = 0;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(900);
        expect(shift(content)).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    // A finger landing during a bounce reads 0 for one frame, then iOS draws
    // the bounce going on under it. Setting the scroll then is undone, and what
    // was owed was lost with it.
    it("holds the debt through a finger on a bounce, handing it over as the bounce ends", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        pane.scrollTop = -120;
        anchor.onScroll();

        anchor.fingerDown();
        pane.scrollTop = 0;
        anchor.onScroll();
        pane.scrollTop = -90;
        anchor.onScroll();
        anchor.fingerUp();

        expect(pane.scrollTop).toBe(-90);
        expect(shift(content)).toBe(-900);
        pane.scrollTop = 0;
        anchor.onScroll();
        expect(pane.scrollTop).toBe(900);
        expect(shift(content)).toBe(0);
    });

    // The finger dragged the stream back into view. What follows may be a
    // glide, which setting the scroll position would stop.
    it("leaves the hand-over to the rest once a finger lifts from a bounce past the top", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        pane.scrollTop = -120;
        anchor.onScroll();

        anchor.fingerDown();
        pane.scrollTop = 40;
        anchor.onScroll();
        anchor.fingerUp();
        pane.scrollTop = 60;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(60);
        expect(shift(content)).toBe(-900);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        expect(pane.scrollTop).toBe(960);
    });

    // A finger lifting between a frame being drawn and its scroll event.
    it("holds a bounce through a finger's frame at the top, lifted as the bounce goes on", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        pane.scrollTop = -120;
        anchor.onScroll();

        anchor.fingerDown();
        pane.scrollTop = 0;
        anchor.onScroll();
        pane.scrollTop = -90;
        anchor.fingerUp();
        pane.scrollTop = 0;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(900);
        expect(shift(content)).toBe(0);
    });

    it("leaves the hand-over to the rest once a finger lifts from a bounce at the top", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        pane.scrollTop = -120;
        anchor.onScroll();

        anchor.fingerDown();
        pane.scrollTop = 0;
        anchor.onScroll();
        anchor.fingerUp();
        pane.scrollTop = 20;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(20);
        expect(shift(content)).toBe(-900);
    });

    it("takes a scroll that reaches the top and turns back for no bounce", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        pane.scrollTop = 0;
        anchor.onScroll();
        pane.scrollTop = 20;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(20);
        expect(shift(content)).toBe(-900);
    });

    it("forgets a finger on detach", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        anchor.fingerDown();
        anchor.detach();
        anchor.attach(pane, content, moreBelow);
        const again = FakeResizeObserver.instances[1]!;
        for (const block of blocks) anchor.observe(block);
        again.resized(...blocks);
        resize(blocks[0]!, 1300);
        again.resized(blocks[0]!);

        pane.scrollTop = -120;
        anchor.onScroll();
        pane.scrollTop = 0;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(900);
    });

    it("ignores a hold let go before it is attached", () => {
        expect(() => anchor.released(document.createElement("div"))).not.toThrow();
    });

    it("ignores a finger before it is attached", () => {
        expect(() => {
            anchor.fingerDown();
            anchor.fingerUp();
        }).not.toThrow();
    });

    /**
     * Scrolls up `step` px a frame, until `until` or until the anchor stops it.
     * Returns the scroll position it stopped at.
     */
    function glideUp(pane: HTMLElement, step: number, until: number): number | null {
        for (let top = pane.scrollTop - step; top >= until; top -= step) {
            pane.scrollTop = top;
            anchor.onScroll();
            if (pane.hasClass("is-scroll-frozen")) return top;
        }
        return null;
    }

    // Notes above shrinking leave the stream shifted down. Scrolling up reaches
    // the newest note with scroll left, and went on into empty space. Stopping
    // when it arrived was too late: iOS had already drawn one frame past it. So
    // it stops three steps before, because iOS sends scroll events unevenly and
    // the next step may be several frames' (D-176), and the stream's top ends
    // at the pane's top.
    it("stops a glide three steps before the stream's top would come into the pane", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 100);
        observer().resized(blocks[0]!);

        const stopped = glideUp(pane, 20, 0);

        expect(stopped).toBe(360);
        expect(pane.scrollTop).toBe(0);
        expect(content.getBoundingClientRect().top).toBe(0);
        expect(shift(content)).toBe(0);
        vi.advanceTimersToNextFrame();
        expect(vi.getTimerCount()).toBe(0);
    });

    // Notes above growing leave the stream shifted up. Scrolling up reached a
    // scroll position of zero before the newest note's top, and bounced there.
    // On an iPhone, the bounce's pull opened Obsidian's pull-down action. iOS
    // draws one step past the scroll position it reports, so stopping where it
    // reported moved the text back 40–50 px against the scroll.
    it("stops a glide three steps before its scroll runs out, a step on from where it was reported", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);

        const stopped = glideUp(pane, 20, 0);

        expect(stopped).toBe(60);
        expect(pane.scrollTop).toBe(340);
        expect(shift(content)).toBe(0);
    });

    /** Scrolls up `step` px every `ms`, until the anchor stops it. */
    function flickUp(pane: HTMLElement, step: number, ms: number): void {
        for (let top = pane.scrollTop - step; top >= 0; top -= step) {
            vi.advanceTimersByTime(ms);
            pane.scrollTop = top;
            anchor.onScroll();
            if (pane.hasClass("is-scroll-frozen")) return;
        }
        throw new Error("The anchor never stopped the glide.");
    }

    const frames = (count: number) => {
        for (let i = 0; i < count; i++) vi.advanceTimersToNextFrame();
    };

    // The scroll ran out thousands of pixels before the newest note, and the
    // reader had to flick again. The glide goes on from its own speed instead.
    it("carries on a fast glide stopped before its scroll runs out, to the stream's top", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);

        flickUp(pane, 40, 16);
        expect(pane.scrollTop).toBeGreaterThan(0);
        frames(600);

        expect(pane.scrollTop).toBe(0);
        expect(content.getBoundingClientRect().top).toBe(0);
        expect(shift(content)).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("lets a slow glide stopped before its scroll runs out end on the way, as iOS would", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 5000);
        observer().resized(blocks[0]!);

        flickUp(pane, 2, 16);
        const stoppedAt = pane.scrollTop;
        frames(600);

        expect(pane.scrollTop).toBeLessThan(stoppedAt);
        expect(pane.scrollTop).toBeGreaterThan(stoppedAt - 200);
        expect(vi.getTimerCount()).toBe(0);
    });

    // A note above renders taller while the glide carries on. iOS no longer
    // controls the scroll, so that goes into it at the next frame.
    it("moves what a note above owes into the scroll at each frame it carries on", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[1]!, 1400);
        observer().resized(blocks[1]!);
        flickUp(pane, 80, 16);
        vi.advanceTimersToNextFrame();
        const at = pane.scrollTop;

        resize(blocks[0]!, 600);
        observer().resized(blocks[0]!);
        expect(shift(content)).toBe(-200);
        vi.advanceTimersToNextFrame();

        expect(shift(content)).toBe(0);
        expect(pane.scrollTop).toBeGreaterThan(at);
        frames(600);
        expect(pane.scrollTop).toBe(0);
    });

    // A note above renders while it carries on, near the top. Heard as a glide,
    // that stopped it again.
    it("does not stop what it carries on for a note above rendering near the top", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[1]!, 1400);
        observer().resized(blocks[1]!);
        flickUp(pane, 480, 16);
        vi.advanceTimersToNextFrame();
        vi.advanceTimersToNextFrame();

        resize(blocks[0]!, 420);
        observer().resized(blocks[0]!);
        anchor.onScroll();

        expect(pane.hasClass("is-scroll-frozen")).toBe(false);
    });

    // Its own writes are heard as scroll events, and are not a glide to stop.
    it("takes the scroll events of carrying on for no glide", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);
        flickUp(pane, 40, 16);
        vi.advanceTimersToNextFrame();

        const before: number[] = [];
        for (let i = 0; i < 20; i++) {
            vi.advanceTimersToNextFrame();
            before.push(pane.scrollTop);
            anchor.onScroll();
            expect(pane.scrollTop).toBe(before.at(-1));
            expect(pane.hasClass("is-scroll-frozen")).toBe(false);
        }
    });

    it.each([
        ["a finger on the pane", () => anchor.fingerDown()],
        ["a scroll set for the layout", () => anchor.placed()],
        ["a scroll to the top", () => anchor.headForTop()],
    ])("stops carrying on at %s", (_, stop) => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);
        flickUp(pane, 40, 16);
        vi.advanceTimersToNextFrame();
        const at = pane.scrollTop;

        stop();
        frames(10);

        expect(pane.scrollTop).toBe(at);
    });

    it("stops carrying on when detached", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);
        flickUp(pane, 40, 16);
        vi.advanceTimersToNextFrame();
        const at = pane.scrollTop;

        anchor.detach();
        frames(10);

        expect(pane.scrollTop).toBe(at);
        expect(vi.getTimerCount()).toBe(0);
    });

    // On an iPad, a step of 51 px, then 81 px at 168 px from the top, was
    // followed by one of 202 px. Two steps ahead missed it, and the scroll
    // bounced at the top while owing (D-176).
    it("stops a glide whose steps come unevenly before its scroll runs out", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);
        expect(glideUp(pane, 50, 300)).toBeNull();
        pane.scrollTop = 249;
        anchor.onScroll();
        expect(pane.scrollTop).toBe(249);

        pane.scrollTop = 168;
        anchor.onScroll();

        expect(pane.hasClass("is-scroll-frozen")).toBe(true);
        expect(pane.scrollTop).toBe(387);
    });

    // A resize reported, or a note re-pinned, at the position of the next
    // scroll event reads the place there. That step then counted as zero, and
    // the scroll bounced at the top while still owing.
    it("stops a glide whose step is read with a resize, before the scroll hears it", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);
        expect(glideUp(pane, 20, 80)).toBeNull();

        pane.scrollTop = 60;
        resize(blocks[0]!, 750);
        observer().resized(blocks[0]!);
        anchor.onScroll();

        expect(pane.hasClass("is-scroll-frozen")).toBe(true);
        expect(pane.scrollTop).toBe(340);
    });

    // Setting the scroll when moving the shift into it is heard as a scroll one
    // task later, which is not a step of a scroll.
    it("takes its own write for no step of a glide", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 100);
        observer().resized(blocks[0]!);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        expect(pane.scrollTop).toBe(600);

        resize(blocks[1]!, 100);
        observer().resized(blocks[1]!);
        anchor.onScroll();

        expect(pane.scrollTop).toBe(600);
        expect(shift(content)).toBe(300);
    });

    // Empty blocks above and below got shorter heights, and the browser pulls
    // the scroll back to the stream's new end. No scroll makes a drop like
    // that.
    it("takes a scroll clamped to the stream's end for no step of a glide", () => {
        const { pane, blocks, resize } = watch([1000, 1000, 1000, 400, 400], 2100);
        resize(blocks[0]!, 100);
        resize(blocks[1]!, 100);
        resize(blocks[4]!, 100);

        pane.scrollTop = 1100;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(1100);
        expect(pane.hasClass("is-scroll-frozen")).toBe(false);
    });

    // A resize read the pulled-back scroll, and the stream grew again below
    // before the scroll event came. The drop was taken for a step of a scroll,
    // which stopped at the top.
    it("takes a scroll clamped to the stream's end, read by a resize, for no step of a glide once it grows back", () => {
        const { pane, blocks, resize } = watch([1000, 1000, 1000, 400, 400], 2100);
        resize(blocks[0]!, 100);
        resize(blocks[1]!, 100);
        resize(blocks[4]!, 100);
        pane.scrollTop = 1100;
        observer().resized(blocks[0]!, blocks[1]!, blocks[4]!);
        resize(blocks[4]!, 1000);

        anchor.onScroll();

        expect(pane.hasClass("is-scroll-frozen")).toBe(false);
        expect(pane.scrollTop).toBe(1100);
    });

    it("leaves a glide alone while the stream's top is more than a frame away", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 100);
        observer().resized(blocks[0]!);

        expect(glideUp(pane, 20, 380)).toBeNull();

        expect(pane.scrollTop).toBe(380);
        expect(shift(content)).toBe(300);
    });

    it("leaves a glide up owing nothing alone all the way to the top", () => {
        const { pane, content } = watch([400, 400, 400, 400, 400], 900);

        expect(glideUp(pane, 20, 0)).toBeNull();

        expect(pane.scrollTop).toBe(0);
        expect(shift(content)).toBe(0);
    });

    // Stopped before the top, the scroll position is not zero, so the next
    // scroll up is not a scroll to the top.
    it("forgets the top once it stops a glide headed there", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        anchor.headForTop();
        resize(blocks[0]!, 100);
        observer().resized(blocks[0]!);
        expect(glideUp(pane, 20, 0)).toBe(360);
        vi.advanceTimersToNextFrame();

        pane.scrollTop = 900;
        anchor.onScroll();
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);

        expect(glideUp(pane, 20, 0)).toBe(60);
    });

    // iOS keeps scrolling after the scroll position is set, and undoes it in
    // the next frame. With nothing to scroll, the scroll ends where it is, and
    // the new position stays.
    it("freezes the pane's scroll for a frame around the write that stops a glide", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 100);
        observer().resized(blocks[0]!);

        expect(glideUp(pane, 20, 0)).not.toBeNull();
        expect(pane.hasClass("is-scroll-frozen")).toBe(true);

        vi.advanceTimersToNextFrame();
        expect(pane.hasClass("is-scroll-frozen")).toBe(false);
    });

    /**
     * Scrolls down `step` px a frame, until `until` or until the anchor stops
     * it. Returns the scroll position it stopped at.
     */
    function glideDown(pane: HTMLElement, step: number, until: number): number | null {
        for (let top = pane.scrollTop + step; top <= until; top += step) {
            pane.scrollTop = top;
            anchor.onScroll();
            if (pane.hasClass("is-scroll-frozen")) return top;
        }
        return null;
    }

    /**
     * Blocks observed and reported for the first time, with every note loaded.
     */
    function watchToEnd(heights: number[], scrollTop: number) {
        const layout = makePane(heights);
        anchor.attach(layout.pane, layout.content, () => true);
        for (const block of layout.blocks) anchor.observe(block);
        observer().resized(...layout.blocks);
        layout.pane.scrollTop = scrollTop;
        anchor.onScroll();
        return layout;
    }

    // Notes above growing leave the stream shifted up. Scrolling down reached
    // the last note with scroll left, and went on into empty space until
    // scrolling stopped, about 1.8 s on an iPhone.
    it("stops a glide three steps before the stream's end, every note loaded, would come into the pane", () => {
        const { pane, content, blocks, resize } = watchToEnd([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);

        const stopped = glideDown(pane, 20, 1700);

        expect(stopped).toBe(1340);
        expect(pane.scrollTop).toBe(1660);
        expect(shift(content)).toBe(0);
        expect(content.getBoundingClientRect().bottom).toBe(640);
    });

    it("holds the place read where a glide stopped", () => {
        const { pane, content, blocks, resize } = watchToEnd([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);
        expect(glideDown(pane, 20, 1700)).not.toBeNull();

        resize(blocks[1]!, 500);
        observer().resized(blocks[1]!);

        expect(shift(content)).toBe(-100);
    });

    // iOS bounces a glide past the stream's end. A note above got its height
    // re-pinned during the bounce. Shown at the end, the text jumped back by
    // the bounce's depth, 286 px on an iPhone.
    it("draws a change above as it is through a bounce past the stream's end, every note loaded", () => {
        const { pane, content, blocks, resize } = watchToEnd([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 300);
        observer().resized(blocks[0]!);
        pane.scrollTop = 1500;
        anchor.onScroll();

        resize(blocks[1]!, 450);
        observer().resized(blocks[1]!);

        expect(shift(content)).toBe(50);
    });

    // During a bounce, the space below belongs to the bounce, not the stream.
    // Limited by it, a Base filling in above lost what it owed, and the text
    // dropped 355–435 px on an iPhone.
    it("owes all a block above grew through a bounce past the stream's end, every note loaded", () => {
        const { pane, content, blocks, resize } = watchToEnd([400, 400, 400, 400, 400], 900);
        pane.scrollTop = 1500;
        anchor.onScroll();

        // The stream is no taller: the growth is inside a pinned note, before
        // the re-pin.
        resize(blocks[1]!, 700);
        resize(blocks[4]!, 100);
        observer().resized(blocks[1]!, blocks[4]!);

        expect(shift(content)).toBe(-300);
    });

    // Shifted down, the stream's end is further away.
    it("leaves a glide down to the hand-over when notes above shrank, every note loaded", () => {
        const { pane, content, blocks, resize } = watchToEnd([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 100);
        observer().resized(blocks[0]!);

        expect(glideDown(pane, 200, 1100)).toBeNull();

        expect(shift(content)).toBe(300);
    });

    // A phone turned upright pulls the scroll back at the stream's end. That is
    // not a scroll, and setting the scroll there threw the reader 10,388 px
    // from their place.
    it("leaves a scroll at the stream's end that moved nothing to the hand-over, every note loaded", () => {
        const { pane, content, blocks, resize } = watchToEnd([400, 400, 400, 400, 400], 1400);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);

        anchor.onScroll();

        expect(pane.hasClass("is-scroll-frozen")).toBe(false);
        expect(pane.scrollTop).toBe(1400);
        expect(shift(content)).toBe(-300);
    });

    it("leaves a glide down alone while more notes load below the stream's end", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 700);
        observer().resized(blocks[0]!);

        expect(glideDown(pane, 20, 1700)).toBeNull();

        expect(shift(content)).toBe(-300);
    });

    it("waits as usual for a scroll owing a shrink once no block is watched", () => {
        const { pane, blocks, resize } = watch([400, 400, 400, 400, 400], 900);
        resize(blocks[0]!, 100);
        observer().resized(blocks[0]!);
        for (const block of blocks) anchor.unobserve(block);

        pane.scrollTop = 290;
        anchor.onScroll();

        expect(vi.getTimerCount()).toBe(1);
    });

    it("waits as usual after a bounce at the top that owed nothing", () => {
        const { pane, blocks, resize } = watch([400, 400, 400], 900);
        pane.scrollTop = -120;
        anchor.onScroll();
        pane.scrollTop = 0;
        anchor.onScroll();

        pane.scrollTop = 900;
        anchor.onScroll();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        anchor.onScroll();

        expect(pane.scrollTop).toBe(900);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        expect(pane.scrollTop).toBe(1800);
    });

    // After a turn, the text reflows over several frames, with a bounce among
    // them.
    it("holds a reflow through a bounce at the top that owed nothing", () => {
        const { pane, content, blocks, resize, turn } = watch([[400, 400, 400], 400], 0);
        turn();
        observer().resized(...blocks);
        pane.scrollTop = -120;
        anchor.onScroll();
        pane.scrollTop = 0;
        anchor.onScroll();

        resize(blocks[0]!.children[0]!, 200);
        observer().resized(blocks[0]!);

        expect(shift(content)).toBe(200);
        expect(blocks[0]!.children[1]!.getBoundingClientRect().top).toBe(400);
    });

    it("lands a scroll headed for the top at the top through a bounce", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        anchor.headForTop();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        pane.scrollTop = -120;
        anchor.onScroll();
        pane.scrollTop = 0;
        anchor.onScroll();

        expect(pane.scrollTop).toBe(0);
        expect(shift(content)).toBe(0);
    });

    // There is nothing above the top, so what grew above the reader on the way
    // up is not owed. Moving it into the scroll would stop before the top.
    it("lands a scroll headed for the top at the top", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        anchor.headForTop();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        pane.scrollTop = 0;
        anchor.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(pane.scrollTop).toBe(0);
        expect(shift(content)).toBe(0);
    });

    // The glide from a tap on the title stopped before the top, 75,854 px down.
    it("lets a scroll headed for the top glide on to it, owing what grew above", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        anchor.headForTop();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        expect(glideUp(pane, 20, 0)).toBeNull();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(pane.scrollTop).toBe(0);
        expect(shift(content)).toBe(0);
    });

    it("keeps heading for the top through a scroll owing nothing on the way", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        anchor.headForTop();
        pane.scrollTop = 500;
        anchor.onScroll();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        pane.scrollTop = 0;
        anchor.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(pane.scrollTop).toBe(0);
        expect(shift(content)).toBe(0);
    });

    it("hands over as usual when the reader stops the scroll short of the top", () => {
        const { pane, blocks, resize } = watch([400, 400, 400], 900);
        anchor.headForTop();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        pane.scrollTop = 500;
        anchor.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(pane.scrollTop).toBe(1400);
    });

    it("forgets the top once a scroll has settled", () => {
        const { pane, blocks, resize } = watch([400, 400, 400], 900);
        anchor.headForTop();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        pane.scrollTop = 500;
        anchor.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        // The block above grows again, and the reader scrolls up by hand.
        resize(blocks[0]!, 1400);
        observer().resized(blocks[0]!);
        pane.scrollTop = 0;
        anchor.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(pane.scrollTop).toBe(100);
    });

    it("forgets the top once a scroll arrives there owing nothing", () => {
        const { pane, blocks, resize } = watch([400, 400, 400], 900);
        anchor.headForTop();
        pane.scrollTop = 0;
        anchor.onScroll();

        // The reader scrolls down, then back up by hand past a block that grew.
        pane.scrollTop = 900;
        anchor.onScroll();
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        pane.scrollTop = 0;
        anchor.onScroll();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(pane.scrollTop).toBe(900);
    });

    // Setting the scroll position, even to the same value, stops a glide in
    // progress. A title tapped just after the shift was due to move into the
    // glide never left the spot.
    it("leaves the scroll alone when what it owed came back to nothing", () => {
        const { pane, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);
        resize(blocks[0]!, 400);
        observer().resized(blocks[0]!);
        const writes = vi.fn();
        Object.defineProperty(pane, "scrollTop", { get: () => 900, set: writes });

        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(writes).not.toHaveBeenCalled();
    });

    it("draws nothing for a move of nothing", () => {
        const { content } = watch([400, 400, 400], 900);

        anchor.anticipate(0);

        expect(content.hasClass("is-scroll-shifted")).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("sets no timer for a scroll with nothing owed", () => {
        watch([400, 400, 400], 900);

        anchor.onScroll();

        expect(vi.getTimerCount()).toBe(0);
    });

    it("drops the shift, and the wait, on detach", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        resize(blocks[0]!, 1300);
        observer().resized(blocks[0]!);

        anchor.detach();
        vi.advanceTimersByTime(SCROLL_IDLE_MS);

        expect(shift(content)).toBe(0);
        expect(content.style.getPropertyValue("--daily-notes-scroll-shift")).toBe("");
        expect(pane.scrollTop).toBe(900);
    });

    it("stops watching a block unobserved, and everything on detach", () => {
        const { blocks } = watch([400, 400], 0);

        anchor.unobserve(blocks[0]!);
        expect([...observer().targets]).toEqual([blocks[1]]);

        anchor.detach();
        expect(observer().disconnected).toBe(true);
    });

    // A pinned block only changes size when it is re-pinned, which tells the
    // anchor. Its own report, one round later, makes WebKit log an error.
    it("stops watching a pinned block's size, and watches it again once unpinned", () => {
        const { blocks } = watch([400, 400], 0);

        anchor.pinned(blocks[0]!);
        expect([...observer().targets]).toEqual([blocks[1]]);

        anchor.unpinned(blocks[0]!);
        expect(new Set(observer().targets)).toEqual(new Set(blocks));
    });

    it("holds the place for a pinned block it is told resized", () => {
        const { content, blocks, resize } = watch([400, 400, 400], 900);
        for (const block of blocks) anchor.pinned(block);

        resize(blocks[0]!, 1300);
        anchor.resized();

        expect(shift(content)).toBe(-900);
    });

    it("watches no block unpinned after it was unobserved", () => {
        const { blocks } = watch([400, 400], 0);
        anchor.pinned(blocks[0]!);
        anchor.unobserve(blocks[0]!);

        anchor.unpinned(blocks[0]!);

        expect([...observer().targets]).toEqual([blocks[1]]);
    });

    it("pins no block it does not watch", () => {
        const { blocks } = watch([400, 400], 0);
        anchor.unobserve(blocks[0]!);

        anchor.pinned(blocks[0]!);
        anchor.unpinned(blocks[0]!);

        expect([...observer().targets]).toEqual([blocks[1]]);
    });

    it("forgets what it watched and pinned on detach", () => {
        const { pane, content, blocks } = watch([400, 400], 0);
        anchor.pinned(blocks[0]!);
        anchor.detach();
        anchor.attach(pane, content, moreBelow);
        const again = FakeResizeObserver.instances[1]!;

        anchor.unpinned(blocks[0]!);
        anchor.pinned(blocks[1]!);
        anchor.unpinned(blocks[1]!);

        expect([...again.targets]).toEqual([]);
    });

    it("ignores a pin before it is attached", () => {
        const block = document.createElement("div");
        expect(() => {
            anchor.pinned(block);
            anchor.unpinned(block);
        }).not.toThrow();
    });

    it("forgets a bounce on detach", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        pane.scrollTop = -120;
        anchor.onScroll();
        anchor.detach();

        pane.scrollTop = 900;
        anchor.attach(pane, content, moreBelow);
        const again = FakeResizeObserver.instances[1]!;
        for (const block of blocks) anchor.observe(block);
        again.resized(...blocks);
        resize(blocks[0]!, 1300);
        again.resized(blocks[0]!);
        anchor.onScroll();

        expect(pane.scrollTop).toBe(900);
        vi.advanceTimersByTime(SCROLL_IDLE_MS);
        expect(pane.scrollTop).toBe(1800);
    });

    it("reads no place held before it was attached again", () => {
        const { pane, content, blocks, resize } = watch([400, 400, 400], 900);
        anchor.detach();
        resize(blocks[0]!, 1300);

        anchor.attach(pane, content, moreBelow);
        const again = FakeResizeObserver.instances[1]!;
        for (const block of blocks) anchor.observe(block);
        again.resized(...blocks);

        expect(shift(content)).toBe(0);
    });

    it("drops the old watch when attached again", () => {
        const { pane, content } = watch([400, 400], 0);

        anchor.attach(pane, content, moreBelow);

        expect(observer().disconnected).toBe(true);
        expect(FakeResizeObserver.instances).toHaveLength(2);
    });

    // A platform that keeps the place itself would correct the scroll a second
    // time.
    it("turns the platform's own anchoring off while it anchors", () => {
        const { pane } = watch([400], 0);
        expect(pane.hasClass("is-scroll-anchored")).toBe(true);

        anchor.detach();
        expect(pane.hasClass("is-scroll-anchored")).toBe(false);
    });

    it("leaves the anchoring to a platform that has its own", () => {
        const supports = vi.fn(() => true);
        vi.stubGlobal("CSS", { supports });
        const { pane, content, blocks } = makePane([400]);

        anchor.attach(pane, content, moreBelow);
        anchor.observe(blocks[0]!);
        anchor.onScroll();

        expect(supports).toHaveBeenCalledWith("overflow-anchor", "auto");
        expect(FakeResizeObserver.instances).toEqual([]);
        expect(pane.hasClass("is-scroll-anchored")).toBe(false);
    });

    // iOS's WebKit understands overflow-anchor but keeps no place. A trace from
    // a phone showed the anchor never turned on, and the text jumped.
    it("anchors in the iOS app, whatever CSS.supports claims", () => {
        vi.stubGlobal("CSS", { supports: () => true });
        Platform.isIosApp = true;
        try {
            const empty = makePane([]);
            anchor.attach(empty.pane, empty.content, moreBelow);
        } finally {
            Platform.isIosApp = false;
        }

        expect(FakeResizeObserver.instances).toHaveLength(1);
    });
});
