/** A frame the page drew: when, the scroll then, whether the stream owed a shift, and how far it could scroll. */
export type Heard = { at: number; top: number; owing: boolean; bottom: number };

/**
 * How a glide ended: slowing to a crawl, as iOS ends one; at the top or the
 * stream's end, its scroll run out or stopped there by the stream (D-091,
 * D-143); at speed anywhere else, as something in the stream stalls it
 * (ADR 0008); or behind a stall, the page too blocked to see it end.
 */
export type GlideEnding = "slowed" | "at an edge" | "cut short" | "ended in a stall";

/** iOS slows a glide from its fastest to under this share before ending it: measured 1/180. */
const SLOWED = 0.1;
/** The stream writes the scroll at rest once still this long (`SCROLL_IDLE_MS`): no step of a glide. */
const HAND_OVER_MS = 300;
/** A frame this late is a stall: the page was blocked, while iOS glides on without it. */
const STALL_MS = 100;

type Step = { speed: number; at: Heard; stalled: boolean };

/**
 * Judges a glide by the frames drawn from the finger's lift on, the first at
 * the lift. A frame proves the page alive: a scroll still over live frames
 * has stopped, one unmoved over a stall says nothing of the glide.
 */
export function glideEnding(frames: Heard[]): GlideEnding {
    const steps: Step[] = [];
    let direction = 0;
    for (const [i, now] of frames.entries()) {
        const before = frames[i - 1];
        if (!before || now.top === before.top) continue;
        const ms = now.at - before.at;
        const last = steps.at(-1);
        // Still on live frames since: the glide had ended, and the stream wrote the scroll at rest.
        // A late frame, as the write's own work makes it, counts as due a stall after the one before.
        if (last && Math.min(now.at, before.at + STALL_MS) - last.at.at >= HAND_OVER_MS) break;
        const step = now.top - before.top;
        direction ||= Math.sign(step);
        if (Math.sign(step) !== direction) {
            // Against the glide, a frame on, owing: the stream wrote its stop.
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

/** The longest wait between two frames, in ms: how long the page was blocked. */
export function longestStall(frames: Heard[]): number {
    return Math.max(0, ...frames.slice(1).map((now, i) => now.at - frames[i]!.at));
}
