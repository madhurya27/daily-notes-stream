/** A scroll the page heard: when, where, whether the stream owed a shift then, and how far it could scroll. */
export type Heard = { at: number; top: number; owing: boolean; bottom: number };

/**
 * How a glide ended: slowing to a crawl, as iOS ends one; at the top or the
 * stream's end, its scroll run out or stopped there by the stream (D-091,
 * D-143); or at speed anywhere else, as something in the stream stalls it
 * (ADR 0008).
 */
export type GlideEnding = "slowed" | "at an edge" | "cut short";

/** iOS slows a glide from its fastest step to under this share before ending it: measured 1/180. */
const SLOWED = 0.1;
/** The stream writes the scroll at rest once still this long (`SCROLL_IDLE_MS`): no step of a glide. */
const HAND_OVER_MS = 300;

/** Judges a glide by the scrolls heard from the finger's lift on, the first of them the scroll at the lift. */
export function glideEnding(heard: Heard[]): GlideEnding {
    const steps: { size: number; at: Heard }[] = [];
    let direction = 0;
    for (const [i, now] of heard.entries()) {
        const before = heard[i - 1];
        if (!before || now.top === before.top) continue;
        // Still since: the glide had ended, and the stream wrote the scroll at rest.
        if (now.at - before.at >= HAND_OVER_MS) break;
        const step = now.top - before.top;
        direction ||= Math.sign(step);
        if (Math.sign(step) !== direction) {
            // Against the glide, a frame on, owing: the stream wrote its stop.
            const last = steps.at(-1);
            if (before.owing && last && now.at - last.at.at < HAND_OVER_MS) return "at an edge";
            break;
        }
        steps.push({ size: Math.abs(step), at: now });
    }
    const last = steps.at(-1);
    if (!last) return "cut short";
    if (last.at.top <= 0 || last.at.top >= last.at.bottom - 1) return "at an edge";
    const fastest = Math.max(...steps.map((step) => step.size));
    return last.size <= fastest * SLOWED ? "slowed" : "cut short";
}
