import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlideCarry, ScrollSpeed } from "../../src/stream/glide-carry";

/** A pane at `top` that keeps whole pixels if `whole`, as iOS's does. */
function makeRoot(top: number, whole = false) {
    const root = document.createElement("div");
    let scrollTop = top;
    Object.defineProperty(root, "scrollTop", {
        get: () => scrollTop,
        set: (value: number) => (scrollTop = whole ? Math.round(value) : value),
    });
    return root;
}

/** Runs frames until the carry ends. Returns each frame's scroll position. */
function framesOf(root: HTMLElement, carry: GlideCarry): number[] {
    const tops: number[] = [];
    while (carry.carrying) {
        vi.advanceTimersToNextFrame();
        tops.push(root.scrollTop);
    }
    return tops;
}

describe("GlideCarry", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("travels as far as iOS's friction takes its speed, when that stops short of the top", () => {
        const root = makeRoot(6000);
        const carry = new GlideCarry(root, () => {});

        carry.start(2);
        const tops = framesOf(root, carry);

        for (const [i, top] of tops.slice(1).entries()) expect(top).toBeLessThanOrEqual(tops[i]!);
        // 90% of 2 px/ms at iOS's friction, down to the speed it ends at.
        expect(root.scrollTop).toBeGreaterThan(5100);
        expect(root.scrollTop).toBeLessThan(5125);
        expect(vi.getTimerCount()).toBe(0);
    });

    // Carrying on at full speed showed the stop as a stall, then a restart.
    it("starts at 90% of the speed it was given", () => {
        const root = makeRoot(6000);
        const carry = new GlideCarry(root, () => {});

        carry.start(6);
        vi.advanceTimersToNextFrame();

        const ms = 16;
        expect(6000 - root.scrollTop).toBeGreaterThan(5.4 * ms * 0.9);
        expect(6000 - root.scrollTop).toBeLessThanOrEqual(5.4 * ms);
    });

    it("slows onto the top when its speed would carry it past", () => {
        const root = makeRoot(1000);
        const carry = new GlideCarry(root, () => {});

        carry.start(10);
        const tops = framesOf(root, carry);

        expect(root.scrollTop).toBe(0);
        const steps = tops.slice(1).map((top, i) => tops[i]! - top);
        expect(steps[0]).toBeGreaterThan(50);
        // Whole pixels written, so a step may differ by up to 2 from the last.
        for (const [i, step] of steps.slice(1).entries()) expect(step).toBeLessThanOrEqual(steps[i]! + 2);
        expect(Math.min(...tops)).toBe(0);
    });

    it("goes on from where a note above growing moved the scroll, before each step", () => {
        const root = makeRoot(1000);
        let grown = false;
        const growth: number[] = [];
        const carry = new GlideCarry(root, () => {
            growth.push(root.scrollTop);
            if (!grown) root.scrollTop += 500;
            grown = true;
        });

        carry.start(20);
        vi.advanceTimersToNextFrame();

        expect(growth).toEqual([1000]);
        expect(root.scrollTop).toBeGreaterThan(1000);
        framesOf(root, carry);
        expect(root.scrollTop).toBe(0);
    });

    it("does not start at a speed too slow to see", () => {
        const carry = new GlideCarry(makeRoot(1000), () => {});

        carry.start(0.01);

        expect(carry.carrying).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("starts at the slowest speed it can see", () => {
        const carry = new GlideCarry(makeRoot(1000), () => {});

        carry.start(0.02);

        expect(carry.carrying).toBe(true);
    });

    it("steps as far as the time since the last frame, however late it is", () => {
        vi.advanceTimersByTime(1000);
        const root = makeRoot(5000);
        const carry = new GlideCarry(root, () => {});
        const frame = vi.spyOn(window, "requestAnimationFrame");
        carry.start(10);
        const step = frame.mock.calls.at(-1)![0];

        step(performance.now() + 8);

        expect(5000 - root.scrollTop).toBeGreaterThan(60);
        expect(5000 - root.scrollTop).toBeLessThanOrEqual(9 * 8);
    });

    it("takes a frame stamped as it started for one frame", () => {
        const root = makeRoot(5000);
        const carry = new GlideCarry(root, () => {});
        const frame = vi.spyOn(window, "requestAnimationFrame");
        carry.start(4);
        const step = frame.mock.calls.at(-1)![0];

        step(performance.now());

        expect(5000 - root.scrollTop).toBeGreaterThan(40);
    });

    it("stops writing the scroll once cancelled", () => {
        const root = makeRoot(5000);
        const carry = new GlideCarry(root, () => {});
        carry.start(5);
        vi.advanceTimersToNextFrame();
        const at = root.scrollTop;

        carry.cancel();
        vi.advanceTimersToNextFrame();

        expect(root.scrollTop).toBe(at);
        expect(carry.carrying).toBe(false);
    });

    it("starts over from a new speed, with one frame waiting", () => {
        const carry = new GlideCarry(makeRoot(5000), () => {});

        carry.start(5);
        carry.start(5);

        expect(vi.getTimerCount()).toBe(1);
    });

    // iOS keeps whole pixels. A step under half a pixel, written alone, moves
    // nothing, so the last of the glide was lost.
    it("adds up steps too small for a scroll that keeps whole pixels", () => {
        const exact = makeRoot(6000);
        const exactCarry = new GlideCarry(exact, () => {});
        exactCarry.start(0.2);
        framesOf(exact, exactCarry);
        const whole = makeRoot(6000, true);
        const wholeCarry = new GlideCarry(whole, () => {});

        wholeCarry.start(0.2);
        framesOf(whole, wholeCarry);

        expect(Math.abs(whole.scrollTop - exact.scrollTop)).toBeLessThanOrEqual(1);
    });

    // A slow frame's whole time, written as one step, moved the text by more
    // than 1,000 px in one frame.
    it("counts a slow frame as no more than two", () => {
        const root = makeRoot(50000);
        const carry = new GlideCarry(root, () => {});
        const frame = vi.spyOn(window, "requestAnimationFrame");
        carry.start(20);
        const step = frame.mock.calls.at(-1)![0];

        step(performance.now() + 200);

        expect(50000 - root.scrollTop).toBeGreaterThan(18 * 33 * 0.9);
        expect(50000 - root.scrollTop).toBeLessThanOrEqual(18 * 33);
    });

    // A frame's time can be from just before the carry started. Counting that
    // as no time left the text still for one frame more.
    it("takes a frame from before it started for one frame", () => {
        const root = makeRoot(5000);
        const carry = new GlideCarry(root, () => {});
        const frame = vi.spyOn(window, "requestAnimationFrame");
        carry.start(4);
        const step = frame.mock.calls.at(-1)![0];

        step(performance.now() - 16);

        expect(5000 - root.scrollTop).toBeGreaterThan(40);
        expect(5000 - root.scrollTop).toBeLessThanOrEqual(3.6 * 16);
    });
});

describe("ScrollSpeed", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Hears `moved` px every `ms`, `times` times. */
    function hear(speed: ScrollSpeed, moved: number, ms: number, times: number) {
        for (let i = 0; i < times; i++) {
            vi.advanceTimersByTime(ms);
            speed.heard(moved);
        }
    }

    it("knows no speed before two steps", () => {
        const speed = new ScrollSpeed();
        expect(speed.pxPerMs()).toBe(0);
        hear(speed, 100, 10, 1);
        expect(speed.pxPerMs()).toBe(0);
    });

    it("averages uneven steps", () => {
        const speed = new ScrollSpeed();
        hear(speed, 50, 10, 1);
        hear(speed, 340, 40, 1);
        hear(speed, 60, 10, 1);

        expect(speed.pxPerMs()).toBe(8);
    });

    it("forgets steps older than the last 100 ms, but for the one it measures from", () => {
        const speed = new ScrollSpeed();
        hear(speed, 1000, 10, 5);
        hear(speed, 20, 10, 10);
        hear(speed, 20, 10, 1);

        expect(speed.pxPerMs()).toBe(2);
    });

    it("knows no speed from steps heard at the same time", () => {
        const speed = new ScrollSpeed();
        speed.heard(10);
        speed.heard(10);

        expect(speed.pxPerMs()).toBe(0);
    });

    it("measures from a step exactly 100 ms old", () => {
        const speed = new ScrollSpeed();
        hear(speed, 1000, 10, 1);
        hear(speed, 10, 10, 1);
        hear(speed, 20, 100, 1);

        expect(speed.pxPerMs()).toBe(0.2);
    });

    it("measures across a gap longer than 100 ms", () => {
        const speed = new ScrollSpeed();
        hear(speed, 10, 10, 1);
        hear(speed, 500, 250, 1);

        expect(speed.pxPerMs()).toBe(2);
    });
});
