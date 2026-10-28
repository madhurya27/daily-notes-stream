import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StillClock } from "../../src/stream/still-clock";
import { SCROLL_IDLE_MS } from "../../src/stream/scroll-anchor";

let clock: StillClock;

beforeEach(() => {
    vi.useFakeTimers();
    clock = new StillClock();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("StillClock", () => {
    it("runs a task asked for while still in the next task, not at once", async () => {
        const task = vi.fn();

        clock.whenStill(task);

        expect(task).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(task).toHaveBeenCalledOnce();
    });

    it("runs a task asked for while moving once the pane has been still for the wait", async () => {
        const task = vi.fn();
        clock.moved();
        clock.whenStill(task);

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(task).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(task).toHaveBeenCalledOnce();
    });

    it("waits again from each move", async () => {
        const task = vi.fn();
        clock.moved();
        clock.whenStill(task);

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        clock.moved();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(task).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(task).toHaveBeenCalledOnce();
    });

    it("waits from the last move, not from when the task was asked for", async () => {
        const task = vi.fn();
        clock.moved();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 100);

        clock.whenStill(task);

        await vi.advanceTimersByTimeAsync(100);
        expect(task).toHaveBeenCalledOnce();
    });

    it("holds back a task asked for while still if the pane moves before it runs", async () => {
        const task = vi.fn();
        clock.whenStill(task);
        clock.moved();

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(task).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(task).toHaveBeenCalledOnce();
    });

    it("runs a task asked for twice before it runs once", async () => {
        const task = vi.fn();
        clock.moved();

        clock.whenStill(task);
        clock.whenStill(task);

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);
        expect(task).toHaveBeenCalledOnce();
    });

    it("runs the waiting tasks together, in the order asked", async () => {
        const ran: string[] = [];
        clock.moved();
        clock.whenStill(() => ran.push("first"));
        clock.whenStill(() => ran.push("second"));

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

        expect(ran).toEqual(["first", "second"]);
    });

    it("runs a task asked for by a running task in the next task, the pane being still", async () => {
        const later = vi.fn();
        let ranInside = true;
        clock.moved();
        clock.whenStill(() => {
            clock.whenStill(later);
            ranInside = later.mock.calls.length > 0;
        });

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);
        await vi.runOnlyPendingTimersAsync();

        expect(ranInside).toBe(false);
        expect(later).toHaveBeenCalledOnce();
    });

    it("runs each task only once per ask", async () => {
        const task = vi.fn();
        clock.whenStill(task);
        await vi.advanceTimersByTimeAsync(0);

        clock.whenStill(() => {});
        await vi.advanceTimersByTimeAsync(0);

        expect(task).toHaveBeenCalledOnce();
    });

    // A scroll moves on every frame, so the wait must cost nothing per event.
    it("sets one timer for the whole wait, however often the pane moves", async () => {
        const timers = vi.spyOn(window, "setTimeout");
        clock.moved();
        clock.whenStill(() => {});

        for (let t = 0; t < 100; t += 10) {
            await vi.advanceTimersByTimeAsync(10);
            clock.moved();
        }
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

        // The first wait, and one for what was left of it after the last move.
        expect(timers).toHaveBeenCalledTimes(2);
    });

    it("does not run a cancelled task", async () => {
        const task = vi.fn();
        const kept = vi.fn();
        clock.moved();
        clock.whenStill(task);
        clock.whenStill(kept);

        clock.cancel(task);

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);
        expect(task).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledOnce();
    });

    it("leaves no timer once every waiting task is cancelled", () => {
        const task = vi.fn();
        clock.whenStill(task);

        clock.cancel(task);

        expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves no timer once nothing waits", async () => {
        clock.moved();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

        expect(vi.getTimerCount()).toBe(0);
    });
});
