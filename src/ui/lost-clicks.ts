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
 * Sends the click that iOS dropped for a finger's tap inside `root` (D-209).
 * While iOS handles a tap, something tappable drawn on the page, as a note
 * drawing on screen draws links or checkboxes, makes iOS take the tap for a
 * hover that revealed it, and send no click. A tap that gets its click is left
 * alone. A tap that stops a glide reaches the page as no event at all.
 */
export function sendLostClicks(component: Component, root: HTMLElement, timers: ViewTimers): void {
    let down: { id: number; x: number; y: number; at: number; target: Element } | null = null;
    let waiting: number | null = null;
    const sent = new WeakSet<Event>();
    /**
     * A click was sent for this tap, so the platform's, if it comes late, is
     * dropped.
     */
    let clicked = false;
    const stopWaiting = () => {
        // Stryker disable next-line ConditionalExpression: cancelling no timer does nothing.
        if (waiting !== null) timers.cancel(waiting);
        waiting = null;
    };

    component.registerDomEvent(root, "pointerdown", (evt) => {
        stopWaiting();
        clicked = false;
        down =
            evt.pointerType === "touch"
                ? {
                      id: evt.pointerId,
                      x: evt.clientX,
                      y: evt.clientY,
                      at: evt.timeStamp,
                      target: evt.target as Element,
                  }
                : null;
    });
    component.registerDomEvent(root, "pointercancel", () => (down = null));
    component.registerDomEvent(root, "pointerup", (evt) => {
        const tap = down;
        if (tap?.id !== evt.pointerId) return;
        down = null;
        const moved = Math.hypot(evt.clientX - tap.x, evt.clientY - tap.y);
        if (moved > TAP_SLOP_PX || evt.timeStamp - tap.at >= LONG_PRESS_MS) return;
        waiting = timers.start(() => {
            waiting = null;
            if (!tap.target.isConnected) return;
            const click = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                detail: 1,
                clientX: evt.clientX,
                clientY: evt.clientY,
            });
            sent.add(click);
            clicked = true;
            tap.target.dispatchEvent(click);
        }, CLICK_WAIT_MS);
    });
    // Captured, so a late click is dropped before anything acts on it.
    component.registerDomEvent(
        root,
        "click",
        (evt) => {
            stopWaiting();
            if (sent.has(evt) || !clicked) return;
            clicked = false;
            evt.preventDefault();
            evt.stopImmediatePropagation();
        },
        { capture: true }
    );
}
