/**
 * The README recordings: which frames to keep, and the animated WebP they make.
 * Movement arrives at up to 60 frames a second, and stillness as few frames or
 * none. Every frame kept takes space in the file.
 */
import { execFileSync } from "child_process";

/** Timestamps are decimal numbers, so 5 × 0.02 must count as exactly 0.1. */
const EPSILON = 1e-9;

/**
 * Chooses which frames to keep, and how long each one shows, in seconds. A
 * frame is kept when it stays on screen for `minInterval`, or when that long
 * has passed since the last frame kept. So movement has fewer frames, without
 * losing the state it ends in. The last frame shows for `hold` before the loop
 * starts again.
 * @param {{ timestamp: number }[]} frames
 * @param {{ minInterval: number, hold: number }} options
 * @returns {{ index: number, delay: number }[]}
 */
export function pickFrames(frames, { minInterval, hold }) {
    /** @type {number[]} */
    const kept = [];
    frames.forEach(({ timestamp }, index) => {
        const next = frames[index + 1];
        const last = kept.length > 0 ? frames[kept[kept.length - 1]] : undefined;
        if (
            next === undefined ||
            last === undefined ||
            next.timestamp - timestamp >= minInterval - EPSILON ||
            timestamp - last.timestamp >= minInterval - EPSILON
        ) {
            kept.push(index);
        }
    });
    return kept.map((index, position) => {
        const following = kept[position + 1];
        const delay = following === undefined ? hold : frames[following].timestamp - frames[index].timestamp;
        return { index, delay };
    });
}

/**
 * `img2webp`'s arguments for `frames`, each shown for its delay in seconds. It
 * loops forever, and is lossless unless given a `quality` for lossy. Delays are
 * rounded using their running total, so the whole recording lasts as long as
 * the frames.
 * @param {{ path: string, delay: number }[]} frames
 * @param {string} output
 * @param {{ quality?: number }} [options]
 * @returns {string[]}
 */
export function webpArgs(frames, output, { quality } = {}) {
    const mode = quality === undefined ? ["-lossless"] : ["-lossy", "-q", String(quality)];
    let elapsed = 0;
    const timed = frames.flatMap(({ path, delay }) => {
        const from = Math.round(elapsed * 1000);
        elapsed += delay;
        return ["-d", String(Math.round(elapsed * 1000) - from), path];
    });
    return ["-loop", "0", ...mode, ...timed, "-o", output];
}

/**
 * Writes `frames`, image files with times in seconds, to `output` as an
 * animated WebP, with at most one frame every `minInterval` seconds. Needs
 * `img2webp` (`brew install webp`).
 * @param {{ timestamp: number, path: string }[]} frames
 * @param {string} output
 * @param {{ quality?: number, minInterval?: number }} [options]
 */
export function writeWebp(frames, output, { minInterval = 0.1, ...options } = {}) {
    const kept = pickFrames(frames, { minInterval, hold: 2 }).map(({ index, delay }) => ({
        path: frames[index].path,
        delay,
    }));
    execFileSync("img2webp", webpArgs(kept, output, options), { stdio: ["ignore", "ignore", "inherit"] });
}
