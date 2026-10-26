import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FrameDeferral } from "../../src/stream/frame-deferral";
import { SCROLL_IDLE_MS } from "../../src/stream/scroll-anchor";

const PAGE = "https://www.youtube.com/embed/aqz-KE-bpKQ";

/** Lets the mutation observer report what was added. */
const observed = () => Promise.resolve();
const still = () => vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

let container: HTMLElement;
let frames: FrameDeferral;
/** What replaces a frame, if anything. Nothing unless a test sets it. */
let standIn: (frame: HTMLIFrameElement, src: string) => HTMLElement | null;
/**
 * What a held frame is wrapped in, if anything. Nothing unless a test sets it.
 */
let wrapper: (frame: HTMLIFrameElement, src: string) => HTMLElement | null;

function frame(src = PAGE): HTMLIFrameElement {
    const el = document.createElement("iframe");
    el.setAttribute("src", src);
    return el;
}

beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    standIn = () => null;
    wrapper = () => null;
    frames = new FrameDeferral(
        (frame, src) => standIn(frame, src),
        (frame, src) => wrapper(frame, src)
    );
    frames.attach(container);
});

afterEach(() => {
    frames.detach();
    container.remove();
    vi.useRealTimers();
});

describe("FrameDeferral", () => {
    it("holds back the page of a frame added to the stream", async () => {
        const added = container.appendChild(frame());

        await observed();

        expect(added.hasAttribute("src")).toBe(false);
    });

    it("holds back a frame nested in what was added", async () => {
        const note = document.createElement("div");
        const nested = note.appendChild(frame());
        container.appendChild(note);

        await observed();

        expect(nested.hasAttribute("src")).toBe(false);
    });

    it("holds back a frame added among text", async () => {
        const added = frame();
        const fragment = document.createDocumentFragment();
        fragment.append("Wider than a phone:", added);
        container.appendChild(fragment);

        await observed();

        expect(added.hasAttribute("src")).toBe(false);
    });

    // Meanwhile, the stylesheet draws a placeholder in its place.
    it("marks a frame held back", async () => {
        const added = container.appendChild(frame());

        await observed();

        expect(added.classList.contains("is-frame-held")).toBe(true);
    });

    it("loads the page once the scroll is still, and unmarks the frame", async () => {
        const added = container.appendChild(frame());
        await observed();

        await still();

        expect(added.getAttribute("src")).toBe(PAGE);
        expect(added.classList.contains("is-frame-held")).toBe(false);
    });

    it("waits out a scroll before loading", async () => {
        const added = container.appendChild(frame());
        await observed();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);

        frames.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);

        expect(added.hasAttribute("src")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(added.getAttribute("src")).toBe(PAGE);
    });

    it("puts a frame's stand-in in its place, and holds nothing", async () => {
        const link = document.createElement("a");
        standIn = (_frame, src) => (src === PAGE ? link : null);
        const note = container.appendChild(document.createElement("div"));
        const added = note.appendChild(frame());

        await observed();
        await still();

        expect(added.isConnected).toBe(false);
        expect(Array.from(note.children)).toEqual([link]);
        expect(link.classList.contains("is-frame-held")).toBe(false);
    });

    it("wraps a frame held back in its wrapper, then loads it there", async () => {
        const link = document.createElement("a");
        wrapper = (_frame, src) => (src === PAGE ? link : null);
        const note = container.appendChild(document.createElement("div"));
        const added = note.appendChild(frame());

        await observed();
        expect(Array.from(note.children)).toEqual([link]);
        expect(Array.from(link.children)).toEqual([added]);
        expect(added.hasAttribute("src")).toBe(false);

        await still();
        expect(added.getAttribute("src")).toBe(PAGE);
    });

    it("leaves a frame with no page alone", async () => {
        const blank = document.createElement("iframe");
        container.appendChild(blank);

        await observed();
        await still();

        expect(blank.hasAttribute("src")).toBe(false);
    });

    it("loads nothing into a frame its note dropped meanwhile", async () => {
        const added = container.appendChild(frame());
        await observed();

        added.remove();
        await still();

        expect(added.hasAttribute("src")).toBe(false);
    });

    it("holds back nothing once detached, and loads nothing it held", async () => {
        const held = container.appendChild(frame());
        await observed();

        frames.detach();
        expect(vi.getTimerCount()).toBe(0);
        const later = container.appendChild(frame());
        await observed();
        await still();

        expect(held.hasAttribute("src")).toBe(false);
        expect(later.getAttribute("src")).toBe(PAGE);
    });

    it("watches only the container it was last attached to", async () => {
        frames.attach(document.createElement("div"));
        const added = container.appendChild(frame());

        await observed();

        expect(added.getAttribute("src")).toBe(PAGE);
    });

    // A note drawn in slices adds to a block already in the stream.
    it("holds back a frame added inside what was already there", async () => {
        const note = container.appendChild(document.createElement("div"));
        await observed();
        const added = note.appendChild(frame());

        await observed();

        expect(added.hasAttribute("src")).toBe(false);
    });

    it("waits on nothing while it holds nothing", async () => {
        container.appendChild(document.createElement("p"));
        await observed();
        frames.onScroll();

        expect(vi.getTimerCount()).toBe(0);
    });

    // When its page is set again, a frame loads the page again.
    it("loads each page once", async () => {
        const first = container.appendChild(frame());
        await observed();
        await still();
        const set = vi.spyOn(first, "setAttribute");

        container.appendChild(frame());
        await observed();
        await still();

        expect(set).not.toHaveBeenCalled();
    });
});
