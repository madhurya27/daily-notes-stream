/**
 * A frame the page drew: when, the scroll position then, whether the stream
 * owed a shift, and how far it could scroll.
 */
export type Heard = { at: number; top: number; owing: boolean; bottom: number };

/**
 * Something that happened during a stroke and its glide, on the frames' clock:
 * a touch event, or a change to the pane or anything in it (`nodes`, `class`,
 * `style`). `what` names the touch or the element.
 */
export type GlideEvent = { at: number; kind: string; what: string };

/**
 * How a scroll ended: slowing down almost to a stop, as iOS ends one; at the
 * top or the stream's end, because it ran out of scroll or the stream stopped
 * it there (D-091, D-143); while still fast, anywhere else, because something
 * in the stream stopped it (ADR 0008); or during a stall, with the page too
 * busy to see it end.
 */
export type GlideEnding = "slowed" | "at an edge" | "cut short" | "ended in a stall";

/**
 * iOS slows a glide from its fastest speed to below this fraction before ending
 * it. Measured: 1/180.
 */
const SLOWED = 0.1;
/**
 * The stream sets the scroll position after it has been still this long
 * (`SCROLL_IDLE_MS`). That is not a step of a scroll.
 */
const HAND_OVER_MS = 300;
/**
 * A frame this late is a pause: the page was busy, while iOS kept scrolling
 * without it.
 */
const STALL_MS = 100;

type Step = { speed: number; at: Heard; stalled: boolean };

/**
 * Judges a scroll by the frames drawn from when the finger lifts, the first
 * frame being at the lift. A frame proves the page is running. A scroll that
 * does not move over running frames has stopped, but one that does not move
 * during a pause says nothing about the scroll.
 */
export function glideEnding(frames: Heard[]): GlideEnding {
    const steps: Step[] = [];
    let direction = 0;
    for (const [i, now] of frames.entries()) {
        const before = frames[i - 1];
        if (!before || now.top === before.top) continue;
        const ms = now.at - before.at;
        const last = steps.at(-1);
        // Still over running frames since: the scroll had ended, and the stream
        // set the scroll position while still. A late frame, which setting the
        // scroll can itself cause, counts as arriving no later than STALL_MS
        // after the frame before it.
        if (last && Math.min(now.at, before.at + STALL_MS) - last.at.at >= HAND_OVER_MS) break;
        const step = now.top - before.top;
        direction ||= Math.sign(step);
        if (Math.sign(step) !== direction) {
            // Against the scroll, one frame later, and owing: the stream set
            // its stop.
            if (before.owing && last && now.at - last.at.at < HAND_OVER_MS) return "at an edge";
            break;
        }
        steps.push({ speed: Math.abs(step) / ms, at: now, stalled: ms >= STALL_MS });
    }
    const last = steps.at(-1);
    if (!last) return "cut short";
    if (last.at.top <= 0 || last.at.top >= last.at.bottom - 1) return "at an edge";
    if (last.stalled) return "ended in a stall";
    const fastest = Math.max(...steps.map((step) => step.speed));
    return last.speed <= fastest * SLOWED ? "slowed" : "cut short";
}

/** The longest wait between two frames, in ms: how long the page was busy. */
export function longestStall(frames: Heard[]): number {
    return Math.max(0, ...frames.slice(1).map((now, i) => now.at - frames[i]!.at));
}

/**
 * Whether no frame from the lift on moved from `before`, the scroll position
 * when the stroke started: the touch never scrolled the stream, which is not a
 * glide that stopped.
 */
export function neverScrolled(before: number, frames: Heard[]): boolean {
    return frames.every((frame) => frame.top === before);
}
