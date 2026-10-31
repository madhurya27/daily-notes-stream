import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ViewTimers } from "../../src/stream/view-timers";

describe("ViewTimers", () => {
    let timers: ViewTimers;

    beforeEach(() => {
        vi.useFakeTimers();
        timers = new ViewTimers();
    });

    afterEach(() => vi.useRealTimers());

    it("runs a timer when it is due, and not before", () => {
        const run = vi.fn();
        timers.start(run, 100);

        vi.advanceTimersByTime(99);
        expect(run).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(run).toHaveBeenCalledOnce();
    });

    it("cancels one timer and leaves the others", () => {
        const cancelled = vi.fn();
        const kept = vi.fn();
        const id = timers.start(cancelled, 100);
        timers.start(kept, 100);

        timers.cancel(id);
        vi.advanceTimersByTime(100);

        expect(cancelled).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledOnce();
    });

    it("cancels every timer it holds", () => {
        const run = vi.fn();
        timers.start(run, 100);
        timers.start(run, 200);

        timers.cancelAll();

        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(200);
        expect(run).not.toHaveBeenCalled();
    });
});
