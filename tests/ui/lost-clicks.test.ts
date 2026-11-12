import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { Component } from "obsidian";
import { ViewTimers } from "../../src/stream/view-timers";
import { sendLostClicks } from "../../src/ui/lost-clicks";

type Pointer = { type?: string; id?: number; x?: number; y?: number };

const pointer = (el: Element, event: string, { type = "touch", id = 1, x = 50, y = 20 }: Pointer = {}) =>
    el.dispatchEvent(
        new PointerEvent(event, { pointerType: type, pointerId: id, clientX: x, clientY: y, bubbles: true })
    );

/**
 * A root sending lost clicks, a button inside it, and each click the button
 * got.
 */
function setUp() {
    const root = document.body.appendChild(document.createElement("div"));
    const button = root.appendChild(document.createElement("span"));
    const clicks: MouseEvent[] = [];
    button.addEventListener("click", (evt) => clicks.push(evt));
    sendLostClicks(new Component(), root, new ViewTimers());
    return { root, button, clicks };
}

/** A finger down, then lifted `ms` later at `up`. */
function tap(el: Element, { ms = 60, up = {} }: { ms?: number; up?: Pointer } = {}) {
    pointer(el, "pointerdown");
    vi.advanceTimersByTime(ms);
    pointer(el, "pointerup", up);
}

describe("sendLostClicks", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    // While iOS handles a tap, something tappable drawn on the page makes it
    // send no click (D-209).
    it("clicks a tap's target when no click comes for 300 ms", () => {
        const { button, clicks } = setUp();

        tap(button);
        vi.advanceTimersByTime(299);
        expect(clicks).toHaveLength(0);
        vi.advanceTimersByTime(1);

        expect(clicks).toHaveLength(1);
        expect(clicks[0]).toMatchObject({ bubbles: true, cancelable: true, clientX: 50, clientY: 20 });
    });

    it("leaves a tap whose click came", () => {
        const { button, clicks } = setUp();

        tap(button);
        button.click();
        vi.advanceTimersByTime(1000);

        expect(clicks).toHaveLength(1);
    });

    // It would act twice, and follow a link twice.
    it("drops the platform's click when it comes after the one sent", () => {
        const { button, clicks } = setUp();

        tap(button);
        vi.advanceTimersByTime(300);
        const late = new MouseEvent("click", { bubbles: true, cancelable: true });
        button.dispatchEvent(late);

        expect(clicks).toHaveLength(1);
        expect(late.defaultPrevented).toBe(true);
    });

    // A throw in a listener would log an error in the console.
    it("ignores a cancel with no tap", () => {
        const { root } = setUp();
        const errors: unknown[] = [];
        const onError = (evt: ErrorEvent) => errors.push(evt.error);
        window.addEventListener("error", onError);
        onTestFinished(() => window.removeEventListener("error", onError));

        pointer(root, "pointercancel");

        expect(errors).toEqual([]);
    });

    // Another finger's touch, cancelled while the tap waits for its click.
    it("still sees a tap's own click after a cancel", () => {
        const { button, clicks } = setUp();

        tap(button);
        pointer(button, "pointercancel", { id: 2 });
        button.click();
        vi.advanceTimersByTime(1000);

        expect(clicks).toHaveLength(1);
    });

    // As VoiceOver or a mouse sends it.
    it("lets a click with no tap before it through", () => {
        const { button, clicks } = setUp();

        button.click();

        expect(clicks).toHaveLength(1);
    });

    it("drops only one late click", () => {
        const { button, clicks } = setUp();

        tap(button);
        vi.advanceTimersByTime(300);
        button.click();
        button.click();

        expect(clicks).toHaveLength(2);
    });

    it("lets a click through once another tap starts", () => {
        const { button, clicks } = setUp();

        tap(button);
        vi.advanceTimersByTime(300);
        tap(button);
        button.click();

        expect(clicks).toHaveLength(2);
    });

    it("waits for each tap's own click", () => {
        const { button, clicks } = setUp();

        tap(button);
        vi.advanceTimersByTime(200);
        tap(button);
        vi.advanceTimersByTime(200);
        expect(clicks).toHaveLength(0);
        vi.advanceTimersByTime(100);

        expect(clicks).toHaveLength(1);
    });

    // A long press selects text, and sends no click.
    it("leaves a press of 400 ms or more", () => {
        const { button, clicks } = setUp();

        tap(button, { ms: 399 });
        vi.advanceTimersByTime(300);
        expect(clicks).toHaveLength(1);
        tap(button, { ms: 400 });
        vi.advanceTimersByTime(1000);

        expect(clicks).toHaveLength(1);
    });

    it("clicks for a finger that moved up to 10px", () => {
        const { button, clicks } = setUp();

        tap(button, { up: { x: 56, y: 28 } });
        vi.advanceTimersByTime(300);

        expect(clicks).toHaveLength(1);
    });

    it("leaves a finger that moved further, as a swipe", () => {
        const { button, clicks } = setUp();

        tap(button, { up: { x: 50, y: 31 } });
        tap(button, { up: { x: 39, y: 20 } });
        vi.advanceTimersByTime(1000);

        expect(clicks).toHaveLength(0);
    });

    // The page took the touch, to scroll it.
    it("leaves a touch the platform cancelled", () => {
        const { button, clicks } = setUp();

        pointer(button, "pointerdown");
        pointer(button, "pointercancel");
        pointer(button, "pointerup");
        vi.advanceTimersByTime(1000);

        expect(clicks).toHaveLength(0);
    });

    // Only a finger's tap is taken for a hover.
    it("leaves a mouse or a pen", () => {
        const { button, clicks } = setUp();

        for (const type of ["mouse", "pen"]) {
            pointer(button, "pointerdown", { type });
            pointer(button, "pointerup", { type });
        }
        vi.advanceTimersByTime(1000);

        expect(clicks).toHaveLength(0);
    });

    it("leaves a lift with no finger down", () => {
        const { button, clicks } = setUp();
        const errors: unknown[] = [];
        const onError = (evt: ErrorEvent) => errors.push(evt.error);
        window.addEventListener("error", onError);
        onTestFinished(() => window.removeEventListener("error", onError));

        pointer(button, "pointerup");
        vi.advanceTimersByTime(1000);

        expect(errors).toEqual([]);
        expect(clicks).toHaveLength(0);
    });

    it("clicks for the finger that went down, not a second one", () => {
        const { button, clicks } = setUp();

        pointer(button, "pointerdown", { id: 1 });
        pointer(button, "pointerup", { id: 2 });
        vi.advanceTimersByTime(300);
        expect(clicks).toHaveLength(0);
        pointer(button, "pointerup", { id: 1 });
        vi.advanceTimersByTime(300);

        expect(clicks).toHaveLength(1);
    });

    it("clicks once for a finger lifted twice", () => {
        const { button, clicks } = setUp();

        tap(button);
        pointer(button, "pointerup");
        vi.advanceTimersByTime(1000);

        expect(clicks).toHaveLength(1);
    });

    // A note re-rendered under the finger.
    it("clicks nothing once the target is gone", () => {
        const { button, clicks } = setUp();

        tap(button);
        button.remove();
        vi.advanceTimersByTime(300);

        expect(clicks).toHaveLength(0);
    });

    it("leaves taps outside its root", () => {
        const { clicks } = setUp();
        const outside = document.body.appendChild(document.createElement("span"));
        const outsideClicks = vi.fn();
        outside.addEventListener("click", outsideClicks);

        tap(outside);
        vi.advanceTimersByTime(1000);

        expect(outsideClicks).not.toHaveBeenCalled();
        expect(clicks).toHaveLength(0);
    });

    it("stops waiting once its view's timers end", () => {
        const root = document.body.appendChild(document.createElement("div"));
        const button = root.appendChild(document.createElement("span"));
        const clicks = vi.fn();
        button.addEventListener("click", clicks);
        const timers = new ViewTimers();
        timers.load();
        sendLostClicks(new Component(), root, timers);

        tap(button);
        timers.unload();
        vi.advanceTimersByTime(1000);

        expect(clicks).not.toHaveBeenCalled();
    });
});
