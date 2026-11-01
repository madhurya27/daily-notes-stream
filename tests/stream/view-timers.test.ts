import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ViewTimers } from "../../src/stream/view-timers";
import { Component } from "../mocks/obsidian";

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

    it("cancels its timers as the component that owns it unloads", () => {
        const run = vi.fn();
        const view = new Component();
        view.addChild(timers as never);
        view.load();
        timers.start(run, 100);

        view.unload();
        vi.advanceTimersByTime(100);

        expect(run).not.toHaveBeenCalled();
    });

    describe("debounce", () => {
        it("runs once, with the last arguments, a wait after the first call", () => {
            const run = vi.fn();
            const debounced = timers.debounce(run, 100);

            debounced("a");
            vi.advanceTimersByTime(60);
            debounced("b");
            vi.advanceTimersByTime(39);
            expect(run).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);

            expect(run).toHaveBeenCalledExactlyOnceWith("b");
        });

        it("starts the wait again at each call when told to", () => {
            const run = vi.fn();
            const debounced = timers.debounce(run, 100, true);

            debounced();
            vi.advanceTimersByTime(60);
            debounced();
            vi.advanceTimersByTime(99);
            expect(run).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);

            expect(run).toHaveBeenCalledOnce();
        });

        it("waits again after it has run", () => {
            const run = vi.fn();
            const debounced = timers.debounce(run, 100);
            debounced();
            vi.advanceTimersByTime(100);

            debounced();
            vi.advanceTimersByTime(100);

            expect(run).toHaveBeenCalledTimes(2);
        });

        it("cancels what is waiting, and can wait again", () => {
            const run = vi.fn();
            const debounced = timers.debounce(run, 100);
            debounced();

            debounced.cancel();
            vi.advanceTimersByTime(100);
            expect(run).not.toHaveBeenCalled();

            debounced();
            vi.advanceTimersByTime(100);
            expect(run).toHaveBeenCalledOnce();
        });

        it("runs what is waiting at once, and only once", () => {
            const run = vi.fn();
            const debounced = timers.debounce(run, 100);
            debounced("a");

            debounced.run();
            expect(run).toHaveBeenCalledExactlyOnceWith("a");
            vi.advanceTimersByTime(100);
            expect(run).toHaveBeenCalledOnce();
        });

        it("runs nothing at once when nothing is waiting", () => {
            const run = vi.fn();

            timers.debounce(run, 100).run();

            expect(run).not.toHaveBeenCalled();
        });

        it("hands itself back from a call and from cancelling", () => {
            const debounced = timers.debounce(() => {}, 100);

            expect(debounced()).toBe(debounced);
            expect(debounced.cancel()).toBe(debounced);
        });

        it("is cancelled with the rest of the timers", () => {
            const run = vi.fn();
            timers.debounce(run, 100)();

            timers.cancelAll();
            vi.advanceTimersByTime(100);

            expect(run).not.toHaveBeenCalled();
        });
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
