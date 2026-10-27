import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    isStreamPlace,
    keepInPlace,
    readPlace,
    scrollBlockTo,
    scrollIntoPlace,
} from "../../src/stream/scroll-position";
import { SETTLE_MS } from "../../src/stream/height-hold";
/**
 * Creates a minimal fake HTMLElement whose getBoundingClientRect the test
 * controls.
 */
function makeEl(rect: { top: number; bottom: number }): HTMLElement {
    return {
        getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, left: 0, right: 0, width: 0, height: 0 }),
    } as unknown as HTMLElement;
}

describe("readPlace", () => {
    /**
     * A pane from `top` to 800, holding blocks at `rects`, and the empty
     * element that loads more after them.
     */
    function streamIn(top: number, ...rects: [path: string, top: number, bottom: number][]) {
        const pane = makeEl({ top, bottom: 800 });
        const stream = document.createElement("div");
        for (const [path, blockTop, bottom] of rects) {
            const block = stream.createDiv();
            block.dataset.sourcePath = path;
            block.getBoundingClientRect = () => ({ top: blockTop, bottom }) as DOMRect;
        }
        const last = rects.at(-1)?.[2] ?? 0;
        stream.createDiv().getBoundingClientRect = () => ({ top: last, bottom: last + 1 }) as DOMRect;
        return { pane, stream };
    }

    it("is the first note reaching into the pane, and how far above the pane's top it starts", () => {
        const { pane, stream } = streamIn(200, ["Notes/a.md", 0, 100], ["Notes/b.md", 100, 300]);

        expect(readPlace(stream, pane)).toEqual({ path: "Notes/b.md", offset: -100 });
    });

    it("is the first note when the stream starts inside the pane", () => {
        const { pane, stream } = streamIn(0, ["Notes/a.md", 10, 200], ["Notes/b.md", 200, 400]);

        expect(readPlace(stream, pane)).toEqual({ path: "Notes/a.md", offset: 10 });
    });

    it("is nowhere once the pane is past every note, or in an empty stream", () => {
        expect(readPlace(streamIn(500, ["Notes/a.md", 0, 100]).stream, makeEl({ top: 500, bottom: 800 }))).toBeNull();
        expect(readPlace(streamIn(0).stream, makeEl({ top: 0, bottom: 800 }))).toBeNull();
    });
});

describe("isStreamPlace", () => {
    it("is a note's path and its offset, and nothing else", () => {
        expect(isStreamPlace({ path: "a.md", offset: 0 })).toBe(true);
        expect(isStreamPlace(null)).toBe(false);
        expect(isStreamPlace("a.md")).toBe(false);
        expect(isStreamPlace({ path: "a.md" })).toBe(false);
    });
});

describe("scrollBlockTo", () => {
    it("measures the block from the pane's top, wherever the pane sits", () => {
        const scrollEl = { getBoundingClientRect: () => ({ top: 100, bottom: 600 }), scrollTop: 200 } as HTMLElement;

        scrollBlockTo(makeEl({ top: 180, bottom: 400 }), 50, scrollEl);

        expect(scrollEl.scrollTop).toBe(230);
    });

    it("scrolls by however far the block moved from the offset", () => {
        const scrollEl = { getBoundingClientRect: () => ({ top: 0, bottom: 500 }), scrollTop: 200 } as HTMLElement;

        scrollBlockTo(makeEl({ top: 80, bottom: 300 }), 50, scrollEl);

        expect(scrollEl.scrollTop).toBe(230);
    });
});

describe("scrollIntoPlace", () => {
    /** The pane the block is scrolled into, with its top at 0. */
    const pane = Object.assign(makeEl({ top: 0, bottom: 800 }), { scrollTop: 0 });

    /** Scrolls the pane, unless it is `stuck`, already as far as it can go. */
    const scrolling = (stuck: boolean) =>
        vi.fn(() => {
            if (!stuck) pane.scrollTop += 100;
        });

    /** A block whose top follows `tops`, then keeps the last value. */
    function blockMoving(tops: number[], { stuck = false } = {}) {
        const block = document.createElement("div");
        block.scrollIntoView = scrolling(stuck);
        let pass = 0;
        block.getBoundingClientRect = vi.fn(() => ({ top: tops[Math.min(pass++, tops.length - 1)] }) as DOMRect);
        return block;
    }

    /**
     * A layout whose number of changes follows `counts`, read twice per try.
     */
    function layoutCounting(counts: number[] = [0]) {
        let read = 0;
        return {
            layoutChanges: () => counts[Math.min(read++, counts.length - 1)]!,
            drain: vi.fn().mockResolvedValue(undefined),
            placed: vi.fn(),
        };
    }

    it("stops after one pass when the block lands at the top of a quiet stream", async () => {
        const block = blockMoving([0]);
        const layout = layoutCounting();

        await scrollIntoPlace(block, "start", pane, layout);

        expect(block.scrollIntoView).toHaveBeenCalledOnce();
        expect(block.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
        expect(layout.drain).toHaveBeenCalledOnce();
    });

    it("waits two frames for the observers after each scroll", async () => {
        const frame = vi.spyOn(window, "requestAnimationFrame");

        await scrollIntoPlace(blockMoving([0]), "start", pane, layoutCounting());

        expect(frame).toHaveBeenCalledTimes(2);
        frame.mockRestore();
    });

    it("counts a block within two pixels of its place as arrived", async () => {
        const block = blockMoving([2]);

        await scrollIntoPlace(block, "start", pane, layoutCounting());

        expect(block.scrollIntoView).toHaveBeenCalledOnce();
    });

    it("measures from the top of a pane lower in the window", async () => {
        const lower = Object.assign(makeEl({ top: 100, bottom: 900 }), { scrollTop: 0 });
        const block = blockMoving([100]);
        block.scrollIntoView = vi.fn(() => void (lower.scrollTop += 100));

        await scrollIntoPlace(block, "start", lower, layoutCounting());

        expect(block.scrollIntoView).toHaveBeenCalledOnce();
    });

    it("scrolls again while renders above the block keep pushing it down", async () => {
        // Each render above it moves the block. The third try puts it in place.
        const block = blockMoving([300, 80, 1]);

        await scrollIntoPlace(block, "start", pane, layoutCounting());

        expect(block.scrollIntoView).toHaveBeenCalledTimes(3);
    });

    // On iOS, the scroll anchor keeps the place it read before. Once the note
    // left behind is hidden for being far away, the anchor measured nothing
    // there and shifted the stream (D-180).
    it("tells the stream its scroll was placed after each scroll, before anything renders", async () => {
        const block = blockMoving([300, 80, 1]);
        const layout = layoutCounting();

        await scrollIntoPlace(block, "start", pane, layout);

        expect(layout.placed).toHaveBeenCalledTimes(3);
        const scrolls = vi.mocked(block.scrollIntoView).mock.invocationCallOrder;
        const placings = layout.placed.mock.invocationCallOrder;
        const drains = layout.drain.mock.invocationCallOrder;
        for (let pass = 0; pass < 3; pass++) {
            expect(placings[pass]).toBeGreaterThan(scrolls[pass]!);
            expect(placings[pass]).toBeLessThan(drains[pass]!);
        }
    });

    it("keeps scrolling while the stream is still rendering, top or not", async () => {
        // It is at the top from the first try, but notes are still being
        // rendered, and each one above the block will move it again. Three
        // tries see the count change, and the fourth sees it stay the same.
        const block = blockMoving([0]);

        await scrollIntoPlace(block, "start", pane, layoutCounting([0, 1, 1, 2, 2, 3, 3, 3]));

        expect(block.scrollIntoView).toHaveBeenCalledTimes(4);
    });

    it("gives up rather than chase a block that never arrives", async () => {
        // Scrolled on every try, and pushed away again on every try.
        const block = blockMoving([500]);

        await scrollIntoPlace(block, "start", pane, layoutCounting());

        expect(block.scrollIntoView).toHaveBeenCalledTimes(8); // MAX_SCROLL_PASSES
    });

    /** An element 20px tall whose center follows `centers`. */
    function elementCenteredAt(centers: number[]) {
        const el = document.createElement("span");
        el.scrollIntoView = scrolling(false);
        let pass = 0;
        el.getBoundingClientRect = vi.fn(() => {
            const center = centers[Math.min(pass++, centers.length - 1)]!;
            return { top: center - 10, bottom: center + 10 } as DOMRect;
        });
        return el;
    }

    it("centers an element on the pane", async () => {
        const el = elementCenteredAt([400]);

        await scrollIntoPlace(el, "center", pane, layoutCounting());

        expect(el.scrollIntoView).toHaveBeenCalledOnce();
        expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    });

    it("centers it on a pane lower in the window", async () => {
        const lower = Object.assign(makeEl({ top: 100, bottom: 900 }), { scrollTop: 0 });
        const el = elementCenteredAt([500]);
        el.scrollIntoView = vi.fn(() => void (lower.scrollTop += 100));

        await scrollIntoPlace(el, "center", lower, layoutCounting());

        expect(el.scrollIntoView).toHaveBeenCalledOnce();
    });

    it("centers it again once the stream around it shifts it", async () => {
        const el = elementCenteredAt([1400, 400]);

        await scrollIntoPlace(el, "center", pane, layoutCounting());

        expect(el.scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it("centers a range on the pane, however tall the element holding it", async () => {
        const scrolled = Object.assign(makeEl({ top: 100, bottom: 900 }), { scrollTop: 0 });
        const range = document.createRange();
        range.getBoundingClientRect = () =>
            ({ top: 1390 - scrolled.scrollTop, bottom: 1410 - scrolled.scrollTop }) as DOMRect;

        await scrollIntoPlace(range, "center", scrolled, layoutCounting());

        expect(scrolled.scrollTop).toBe(900);
    });

    // A note too short to reach the top of a tall pane. The scroll moves
    // nothing, so no observer has anything new to report.
    it("stops once a scroll moves nothing on a quiet stream", async () => {
        const block = blockMoving([500], { stuck: true });

        await scrollIntoPlace(block, "start", pane, layoutCounting());

        expect(block.scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it("keeps waiting on a stuck scroll while renders are still landing", async () => {
        // A render finishes between the first two tries, and the third sees
        // none.
        const block = blockMoving([500], { stuck: true });

        await scrollIntoPlace(block, "start", pane, layoutCounting([0, 1, 2, 2, 2, 2]));

        expect(block.scrollIntoView).toHaveBeenCalledTimes(3);
    });
});

describe("keepInPlace", () => {
    class FakeResizeObserver {
        static last: FakeResizeObserver;
        disconnected = false;
        readonly observed = new Set<Element>();
        constructor(readonly callback: () => void) {
            FakeResizeObserver.last = this;
        }
        observe(el: Element) {
            this.observed.add(el);
        }
        disconnect() {
            this.disconnected = true;
            this.observed.clear();
        }
    }
    // A real observer only reports what it observes, and nothing once it is
    // disconnected.
    const resized = (el: Element = stream) =>
        FakeResizeObserver.last.observed.has(el) && FakeResizeObserver.last.callback();

    const pane = document.createElement("div");
    pane.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
    const stream = document.createElement("div");
    pane.appendChild(stream);
    document.body.appendChild(pane);

    /** A match 20px tall, centered at `center.at`, which a test can move. */
    function match(center: { at: number }) {
        const el = document.createElement("span");
        stream.appendChild(el);
        el.scrollIntoView = vi.fn();
        el.getBoundingClientRect = () => ({ top: center.at - 10, bottom: center.at + 10 }) as DOMRect;
        return el;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    // A Base above the match fills in after the match was centered.
    it("centers it again when the stream grows above it", () => {
        const center = { at: 400 };
        const el = match(center);
        keepInPlace(el, "center", pane, stream);

        center.at = 6400;
        resized();

        expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    });

    // A note with a remembered height is held at its full height. A Base
    // filling in inside it moves the match, but changes the size of nothing
    // outside the note.
    it("centers it again when a Base above it in its note fills in", () => {
        const center = { at: 400 };
        const block = stream.createDiv({ cls: "daily-note-block" });
        const section = block.createDiv();
        const base = section.createDiv();
        const heading = section.createDiv().createEl("h3");
        heading.scrollIntoView = vi.fn();
        heading.getBoundingClientRect = () => ({ top: center.at - 10, bottom: center.at + 10 }) as DOMRect;
        keepInPlace(heading, "center", pane, stream);

        center.at = 1300;
        resized(base);

        expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    });

    it("centers a range again, watching what lies above its text", () => {
        const center = { at: 400 };
        const block = stream.createDiv({ cls: "daily-note-block" });
        const base = block.createDiv();
        const text = block.createEl("pre").appendChild(document.createTextNode("Wombat"));
        const range = document.createRange();
        range.selectNodeContents(text);
        range.getBoundingClientRect = () => ({ top: center.at - 10, bottom: center.at + 10 }) as DOMRect;
        pane.scrollTop = 0;
        keepInPlace(range, "center", pane, stream);

        center.at = 1300;
        resized(base);

        expect(pane.scrollTop).toBe(900);
        expect([...FakeResizeObserver.last.observed]).toEqual([stream, base]);
    });

    it("leaves it alone while it is still in place", () => {
        const el = match({ at: 401 });
        keepInPlace(el, "center", pane, stream);

        resized();

        expect(el.scrollIntoView).not.toHaveBeenCalled();
    });

    it("leaves it alone within two pixels of its place", () => {
        const el = match({ at: 402 });
        keepInPlace(el, "center", pane, stream);

        resized();

        expect(el.scrollIntoView).not.toHaveBeenCalled();
    });

    it("watches the stream and what lies above it in its note, nothing beyond", () => {
        const block = stream.createDiv({ cls: "daily-note-block" });
        const section = block.createDiv();
        const base = section.createDiv();
        const heading = section.createDiv().createEl("h3");
        heading.getBoundingClientRect = () => ({ top: 390, bottom: 410 }) as DOMRect;

        keepInPlace(heading, "center", pane, stream);

        expect([...FakeResizeObserver.last.observed]).toEqual([stream, base]);
    });

    it("lets go once the stream is still", () => {
        keepInPlace(match({ at: 400 }), "center", pane, stream);

        vi.advanceTimersByTime(SETTLE_MS);

        expect(FakeResizeObserver.last.disconnected).toBe(true);
    });

    it("keeps holding while the stream keeps resizing", () => {
        keepInPlace(match({ at: 400 }), "center", pane, stream);

        vi.advanceTimersByTime(SETTLE_MS - 1);
        resized();
        vi.advanceTimersByTime(SETTLE_MS - 1);

        expect(FakeResizeObserver.last.disconnected).toBe(false);
    });

    it("lets go when stopped", () => {
        const stop = keepInPlace(match({ at: 400 }), "center", pane, stream);

        stop();

        expect(FakeResizeObserver.last.disconnected).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("lets go of an element no longer in the stream", () => {
        const center = { at: 400 };
        const el = match(center);
        keepInPlace(el, "center", pane, stream);

        el.remove();
        center.at = 6400;
        resized();

        expect(el.scrollIntoView).not.toHaveBeenCalled();
        expect(FakeResizeObserver.last.disconnected).toBe(true);
    });
});
