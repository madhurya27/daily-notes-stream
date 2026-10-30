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
 * iOS slows a glide to about a pixel a frame before ending it, however fast it
 * started: 0.05-0.06 px/ms on an iPad. Glides cut short ended at 0.43 px/ms
 * and faster (D-186).
 */
const SLOWED_PX_PER_MS = 0.2;
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
            // Against the scroll, while it was still moving, and owing: the
            // stream set its stop.
            if (before.owing && last) return "at an edge";
            break;
        }
        // Since the last move, not the last frame: at the end of a glide, a
        // pixel's move can land on a frame 2 ms after the one before.
        const sinceMove = now.at - (last?.at.at ?? before.at);
        steps.push({ speed: Math.abs(step) / sinceMove, at: now, stalled: ms >= STALL_MS });
    }
    const last = steps.at(-1);
    if (!last) return "cut short";
    if (last.at.top <= 0 || last.at.top >= last.at.bottom - 1) return "at an edge";
    if (last.stalled) return "ended in a stall";
    return last.speed <= SLOWED_PX_PER_MS ? "slowed" : "cut short";
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

/**
 * Each kind of change to each element during a stroke and its glide: how many
 * times, and the first and last, in ms from the lift. Small enough to keep for
 * every glide, so a cut glide's changes can be compared with a full one's.
 */
export type GlideChange = { kind: string; what: string; count: number; first: number; last: number };

export function changesDuring(events: GlideEvent[], lift: number): GlideChange[] {
    const changes = new Map<string, GlideChange>();
    for (const { at, kind, what } of events) {
        const since = Math.round(at - lift);
        const key = `${kind} ${what}`;
        const change = changes.get(key);
        if (change) {
            change.count++;
            change.last = since;
        } else changes.set(key, { kind, what, count: 1, first: since, last: since });
    }
    return [...changes.values()].sort((a, b) => a.first - b.first);
}

/** How many screens beyond the pane the stream renders (`RENDER_VIEWPORTS`). */
const RENDERED_SCREENS = 1.5;

/**
 * How many days from where a glide starts, `depth` px into a note, to put what
 * it should meet: the nearest day that starts rendering only after a screen of
 * scrolling. A stroke scrolls 0.7 of a screen, so the day draws after the lift,
 * and a glide scrolls further than this, so it draws before the glide ends.
 * Flicking up, the day renders as its top nears the pane's bottom. Flicking
 * down, as its bottom nears the pane's top. On an iPad, the day first drew only
 * 50-104 ms after the lift, so it could draw too early (D-191).
 */
export function daysAhead(
    direction: "up" | "down",
    { screen, note, depth }: { screen: number; note: number; depth: number }
): number {
    return direction === "up"
        ? Math.ceil(((2 + RENDERED_SCREENS) * screen + depth) / note)
        : Math.ceil(((1 + RENDERED_SCREENS) * screen - depth) / note) + 1;
}

/**
 * Whether `note` was drawn during the glide: nodes changed in it from the lift
 * on, so what it holds rendered while the stream was moving.
 */
export function drewDuringGlide(changes: GlideChange[], note: string): boolean {
    return changes.some(({ kind, what, last }) => kind === "nodes" && last >= 0 && what.includes(` in ${note}`));
}

/**
 * Something the stream did that ends a glide on iOS: a write to the pane's
 * scroll position (`how` names the call), or `freeze` for the pane frozen for a
 * frame (`is-scroll-frozen`). `owing` is whether the stream owed a shift then.
 */
export type ScrollStop = { at: number; how: string; owing: boolean };

/**
 * The stream's writes wait `HAND_OVER_MS` from the last scroll event. A frame
 * is read just after its scroll event, so the wait measured from the frame can
 * be this much shorter.
 */
const FRAME_SLACK_MS = 20;

/**
 * What the stream did during a stroke and its glide that ends a glide on iOS,
 * each named: a scroll stop sooner after the scroll last moved than the stream
 * waits before its own writes, and a box that could scroll (ADR 0008). iOS
 * fires no `scrollend` for many glides, so the wait is the only sign that a
 * glide is over (D-188). How the glide ended, and how late its frames were,
 * depend on the device too, so they are not among them. `frames` start at the
 * lift; `stops` and `events` are on the same clock.
 */
export function glideFaults({
    frames,
    stops,
    events,
}: {
    frames: Heard[];
    stops: ScrollStop[];
    events: GlideEvent[];
}): string[] {
    const lift = frames[0]?.at ?? 0;
    const lastMove = (at: number) =>
        frames.filter((now, i) => i > 0 && now.at <= at && now.top !== frames[i - 1]!.top).at(-1)?.at ?? lift;
    const early = stops.flatMap(({ at, how, owing }) => {
        if (owing) return [];
        if (at < lift) return [`${how} ${Math.round(lift - at)} ms before the lift, during the stroke`];
        const still = at - lastMove(at);
        return still < HAND_OVER_MS - FRAME_SLACK_MS
            ? [`${how} ${Math.round(at - lift)} ms after the lift, ${Math.round(still)} ms after the scroll last moved`]
            : [];
    });
    const boxes = events.filter(({ kind }) => kind === "scroll box");
    return [...early, ...boxes.map(({ what }) => `a box that could scroll: ${what}`)];
}
