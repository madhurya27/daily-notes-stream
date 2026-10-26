import { describe, it, expect } from "vitest";
import { pickFrames, webpArgs } from "../../scripts/recording.mjs";

const at = (...timestamps: number[]) => timestamps.map((timestamp) => ({ timestamp }));
const options = { minInterval: 0.1, hold: 2 };

describe("pickFrames", () => {
    it("holds a lone frame", () => {
        expect(pickFrames(at(5), options)).toEqual([{ index: 0, delay: 2 }]);
    });

    it("keeps spaced frames, each shown until the next", () => {
        expect(pickFrames(at(0, 0.5, 1.5), options)).toEqual([
            { index: 0, delay: 0.5 },
            { index: 1, delay: 1 },
            { index: 2, delay: 2 },
        ]);
    });

    it("drops a frame superseded within the interval, keeping the settled one", () => {
        expect(pickFrames(at(0, 0.01, 0.02, 1), options)).toEqual([
            { index: 0, delay: 0.02 },
            { index: 2, delay: 0.98 },
            { index: 3, delay: 2 },
        ]);
    });

    it("thins continuous motion to about one frame per interval", () => {
        const motion = at(...Array.from({ length: 26 }, (_, i) => i * 0.02));
        const kept = pickFrames(motion, options);
        expect(kept.length).toBeGreaterThanOrEqual(5);
        expect(kept.length).toBeLessThanOrEqual(7);
        for (const frame of kept.slice(0, -1)) expect(frame.delay).toBeGreaterThanOrEqual(0.1 - 1e-9);
    });

    it("returns nothing for no frames", () => {
        expect(pickFrames([], options)).toEqual([]);
    });
});

describe("webpArgs", () => {
    const frames = [
        { path: "a.png", delay: 0.5 },
        { path: "b.png", delay: 2 },
    ];

    it("loops forever, lossless, each frame shown for its delay in ms", () => {
        expect(webpArgs(frames, "out.webp")).toEqual([
            ...["-loop", "0", "-lossless"],
            ...["-d", "500", "a.png", "-d", "2000", "b.png"],
            ...["-o", "out.webp"],
        ]);
    });

    it("encodes lossy at `quality` when given one", () => {
        expect(webpArgs(frames, "out.webp", { quality: 80 }).slice(0, 5)).toEqual(["-loop", "0", "-lossy", "-q", "80"]);
    });

    it("rounds each delay so the whole runs as long as the frames do", () => {
        // Three 0.1234 s frames, each rounded on its own, add up to 369 ms, not
        // 370.
        const thirds = [0.1234, 0.1234, 0.1234].map((delay, i) => ({ path: `${i}.png`, delay }));
        const ms = webpArgs(thirds, "out.webp").flatMap((arg, i, all) => (all[i - 1] === "-d" ? [Number(arg)] : []));
        expect(ms.reduce((sum, each) => sum + each, 0)).toBe(370);
    });
});
