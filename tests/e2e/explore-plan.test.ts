import { describe, it, expect } from "vitest";
import { explorePlan, seedFrom, GESTURE_LIMITS } from "../../e2e-tests/ios/explore-plan";

describe("explorePlan", () => {
    it("is the same for the same seed, so a failure's gestures can be run again", () => {
        expect(explorePlan(42, 30)).toEqual(explorePlan(42, 30));
    });

    it("differs between seeds", () => {
        expect(explorePlan(1, 30).gestures).not.toEqual(explorePlan(2, 30).gestures);
    });

    it("has as many gestures as asked", () => {
        expect(explorePlan(7, 12).gestures).toHaveLength(12);
    });

    it("keeps every gesture within a thumb's reach", () => {
        const { strokes, share, ms } = GESTURE_LIMITS;
        for (let seed = 0; seed < 50; seed++)
            for (const g of explorePlan(seed, 40).gestures) {
                expect(Number.isInteger(g.strokes)).toBe(true);
                expect(g.strokes).toBeGreaterThanOrEqual(strokes.min);
                expect(g.strokes).toBeLessThanOrEqual(strokes.max);
                expect(g.share).toBeGreaterThanOrEqual(share.min);
                expect(g.share).toBeLessThanOrEqual(share.max);
                expect(g.ms).toBeGreaterThanOrEqual(ms.min);
                expect(g.ms).toBeLessThanOrEqual(ms.max);
            }
    });

    it("reaches both ends of every range, both directions and both starts", () => {
        const plans = Array.from({ length: 50 }, (_, seed) => explorePlan(seed, 40));
        const gestures = plans.flatMap((p) => p.gestures);
        const { strokes, share, ms } = GESTURE_LIMITS;
        expect(new Set(gestures.map((g) => g.direction))).toEqual(new Set(["up", "down"]));
        expect(new Set(gestures.map((g) => g.strokes))).toEqual(
            new Set(Array.from({ length: strokes.max - strokes.min + 1 }, (_, i) => strokes.min + i))
        );
        const near = (values: number[], { min, max }: { min: number; max: number }) => {
            const span = max - min;
            return [Math.min(...values) < min + span * 0.05, Math.max(...values) > max - span * 0.05];
        };
        expect(
            near(
                gestures.map((g) => g.share),
                share
            )
        ).toEqual([true, true]);
        expect(
            near(
                gestures.map((g) => g.ms),
                ms
            )
        ).toEqual([true, true]);
        expect(new Set(plans.map((p) => p.forgetHeights))).toEqual(new Set([true, false]));
        const starts = plans.map((p) => p.start);
        expect(Math.min(...starts)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...starts)).toBeLessThan(1);
        expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.8);
    });
});

describe("seedFrom", () => {
    it("takes EXPLORE_SEED, to run a failure's gestures again", () => {
        expect(seedFrom({ EXPLORE_SEED: "1234" }, () => 0.5)).toBe(1234);
    });

    it("rejects an EXPLORE_SEED that is not a whole number", () => {
        expect(() => seedFrom({ EXPLORE_SEED: "abc" }, () => 0.5)).toThrow("EXPLORE_SEED must be a whole number");
        expect(() => seedFrom({ EXPLORE_SEED: "1.5" }, () => 0.5)).toThrow("EXPLORE_SEED must be a whole number");
    });

    it("picks a new seed otherwise", () => {
        expect(seedFrom({}, () => 0)).toBe(0);
        expect(seedFrom({}, () => 0.5)).toBe(2 ** 31);
    });
});
