/**
 * One swipe of the explore tests: `strokes` strokes, each caught while the
 * last still glides, `share` of the screen tall and taking `ms`. `up` moves
 * down the stream, as in `Phone.flick`.
 */
export type Swipe = { kind: "swipe"; direction: "up" | "down"; strokes: number; share: number; ms: number };

/** A swipe, or a tap on Scroll to top from wherever the swipes left it. */
export type Gesture = Swipe | { kind: "to top" };

/** How often a gesture is a tap on Scroll to top. */
const TO_TOP_SHARE = 0.1;

/**
 * What one explore run does, all of it from its seed: where it starts, as a
 * fraction of the way down the dated notes, whether heights are forgotten
 * first, and its gestures.
 */
export type ExplorePlan = { seed: number; start: number; forgetHeights: boolean; gestures: Gesture[] };

/** From a slow drag to a hard flick, as a thumb makes them. */
export const GESTURE_LIMITS = {
    strokes: { min: 1, max: 3 },
    share: { min: 0.1, max: 0.7 },
    ms: { min: 40, max: 500 },
} as const;

/** The explore run `seed` names, with `count` gestures. */
export function explorePlan(seed: number, count: number): ExplorePlan {
    const next = mulberry32(seed);
    const between = ({ min, max }: { min: number; max: number }) => min + next() * (max - min);
    const start = next();
    const forgetHeights = next() < 0.5;
    const gestures = Array.from({ length: count }, (): Gesture => {
        if (next() < TO_TOP_SHARE) return { kind: "to top" };
        const { strokes } = GESTURE_LIMITS;
        return {
            kind: "swipe",
            direction: next() < 0.5 ? "up" : "down",
            strokes: strokes.min + Math.floor(next() * (strokes.max - strokes.min + 1)),
            share: round(between(GESTURE_LIMITS.share), 2),
            ms: Math.round(between(GESTURE_LIMITS.ms)),
        };
    });
    return { seed, start, forgetHeights, gestures };
}

/** `EXPLORE_SEED`, to run a failure's gestures again, or a new seed. */
export function seedFrom(env: NodeJS.ProcessEnv, random: () => number = Math.random): number {
    const given = env.EXPLORE_SEED;
    if (given === undefined) return Math.floor(random() * 2 ** 32);
    if (!/^\d+$/.test(given)) throw new Error(`EXPLORE_SEED must be a whole number, not ${given}`);
    return Number(given);
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** A small seeded random number generator: the same seed, the same numbers. */
function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
}
