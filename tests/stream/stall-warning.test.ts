import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { STALL_MS, warnIfStalled } from "../../src/stream/stall-warning";

describe("warnIfStalled", () => {
    let logged: MockInstance<typeof console.error>;

    beforeEach(() => {
        vi.useFakeTimers();
        logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        logged.mockRestore();
        vi.useRealTimers();
    });

    /** A task that runs until `finish` is called. */
    function pending() {
        let finish!: () => void;
        const task = () => new Promise<void>((resolve) => (finish = resolve));
        return { task, finish: () => finish() };
    }

    it("says nothing of a task that ends in time", async () => {
        const { task, finish } = pending();
        const watched = warnIfStalled("Drawing Notes/2026-03-14.md", task);
        await vi.advanceTimersByTimeAsync(STALL_MS - 1);
        finish();
        await watched;
        await vi.advanceTimersByTimeAsync(STALL_MS);

        expect(logged).not.toHaveBeenCalled();
    });

    it("logs once a task has run for 5 seconds, naming it", async () => {
        const { task } = pending();
        void warnIfStalled("Drawing Notes/2026-03-14.md", task);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(logged).toHaveBeenCalledOnce();
        expect(logged).toHaveBeenCalledWith(
            "DailyNotesStream: Drawing Notes/2026-03-14.md has run for 5 s; no note draws until it ends"
        );
    });

    it("hands back what the task returns", async () => {
        expect(await warnIfStalled("Drawing Notes/2026-03-14.md", async () => 42)).toBe(42);
    });

    it("says when a stalled task ends, and after how long", async () => {
        // Timed from when the task started, not from when the page loaded.
        await vi.advanceTimersByTimeAsync(60_000);
        const { task, finish } = pending();
        const watched = warnIfStalled("Drawing Notes/2026-03-14.md", task);
        await vi.advanceTimersByTimeAsync(25_000);
        finish();
        await watched;

        expect(logged).toHaveBeenLastCalledWith("DailyNotesStream: Drawing Notes/2026-03-14.md ended after 25 s");
    });

    it("says when a stalled task fails, and passes its error on", async () => {
        const watched = warnIfStalled("Loading more notes", async () => {
            await new Promise((resolve) => setTimeout(resolve, STALL_MS));
            throw new Error("gone");
        });
        const failed = expect(watched).rejects.toThrow("gone");
        await vi.advanceTimersByTimeAsync(STALL_MS);
        await failed;

        expect(logged).toHaveBeenLastCalledWith("DailyNotesStream: Loading more notes ended after 5 s");
    });
});
