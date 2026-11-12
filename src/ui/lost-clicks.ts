import type { Component } from "obsidian";
import type { ViewTimers } from "../stream/view-timers";

/** How far a finger may move between down and lift and still tap. */
const TAP_SLOP_PX = 10;
/** A press this long is a long press, which selects text and sends no click. */
const LONG_PRESS_MS = 400;
/**
 * How long a tap waits for its click. On an iPad, the click comes 72 ms after
 * the lift.
 */
const CLICK_WAIT_MS = 300;

/**
 * Where a finger's tap is; null when there is none. A tap that gets its own
 * click ends. In `click-sent`, the platform's late click is dropped.
 */
type Tap =
    | { state: "pressed"; id: number; x: number; y: number; at: number; target: Element }
    | { state: "awaiting-click"; timer: number }
    | { state: "click-sent" };

/**
 * Sends the click that iOS dropped for a finger's tap inside `root` (D-209).
 * While iOS handles a tap, something tappable drawn on the page, as a note
 * drawing on screen draws links or checkboxes, makes iOS take the tap for a
 * hover that revealed it, and send no click. A tap that gets its click is left
 * alone. A tap that stops a glide reaches the page as no event at all.
 */
export function sendLostClicks(component: Component, root: HTMLElement, timers: ViewTimers): void {
    let tap: Tap | null = null;
    const sent = new WeakSet<Event>();
    component.registerDomEvent(root, "pointerdown", (evt) => {
        if (tap?.state === "awaiting-click") timers.cancel(tap.timer);
        tap =
            evt.pointerType === "touch"
                ? {
                      state: "pressed",
                      id: evt.pointerId,
                      x: evt.clientX,
                      y: evt.clientY,
                      at: evt.timeStamp,
                      target: evt.target as Element,
                  }
                : null;
    });
    component.registerDomEvent(root, "pointercancel", () => {
        if (tap?.state === "pressed") tap = null;
    });
    component.registerDomEvent(root, "pointerup", (evt) => {
        if (tap?.state !== "pressed" || tap.id !== evt.pointerId) return;
        const { x, y, at, target } = tap;
        tap = null;
        const moved = Math.hypot(evt.clientX - x, evt.clientY - y);
        if (moved > TAP_SLOP_PX || evt.timeStamp - at >= LONG_PRESS_MS) return;
        const timer = timers.start(() => {
            if (!target.isConnected) {
                tap = null;
                return;
            }
            tap = { state: "click-sent" };
            const click = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                detail: 1,
                clientX: evt.clientX,
                clientY: evt.clientY,
            });
            sent.add(click);
            target.dispatchEvent(click);
        }, CLICK_WAIT_MS);
        tap = { state: "awaiting-click", timer };
    });
    // Captured, so a late click is dropped before anything acts on it.
    component.registerDomEvent(
        root,
        "click",
        (evt) => {
            if (sent.has(evt)) return;
            if (tap?.state === "awaiting-click") {
                // Its own click came.
                timers.cancel(tap.timer);
                tap = null;
            } else if (tap?.state === "click-sent") {
                tap = null;
                evt.preventDefault();
                evt.stopImmediatePropagation();
            }
        },
        { capture: true }
    );
}
