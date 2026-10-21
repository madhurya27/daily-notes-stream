import { describe, it, expect } from "vitest";
import { glideEnding, type Heard } from "../../e2e-tests/ios/glide";

/** What the page heard from the lift on, every `every` ms: the scroll at each, owing or not. */
function heard(tops: number[], { every = 8, owing = [] as number[], bottom = 100_000 } = {}): Heard[] {
    return tops.map((top, i) => ({ at: i * every, top, owing: owing.includes(i), bottom }));
}

// Shapes measured on an iPhone 16 Pro, scrolling up the stream.
describe("glideEnding", () => {
    it("tells a glide that slows to a crawl, as iOS ends one", () => {
        expect(glideEnding(heard([5000, 4820, 4650, 4500, 4400, 4340, 4320, 4319, 4318]))).toBe("slowed");
    });

    it("tells a glide ended at speed, away from any edge", () => {
        expect(glideEnding(heard([5000, 4820, 4650, 4500, 4380]))).toBe("cut short");
    });

    it("tells a glide the stream stopped, owing, as its scroll ran out", () => {
        const stopped = heard([1000, 820, 650, 600, 550, 3550, 3550], { owing: [1, 2, 3, 4] });

        expect(glideEnding(stopped)).toBe("at an edge");
    });

    it("tells a glide ended at speed, owing, from the hand-over once the scroll is still", () => {
        const cut = [
            ...heard([1000, 820, 650], { owing: [0, 1, 2] }),
            { at: 16 + 300, top: 3650, owing: false, bottom: 100_000 },
        ];

        expect(glideEnding(cut)).toBe("cut short");
    });

    it("ends a glide at the hand-over once the scroll is still, whichever way it moves", () => {
        const slowed = [
            ...heard([1000, 1180, 1340, 1450, 1500, 1501], { owing: [0, 1, 2, 3, 4, 5] }),
            { at: 40 + 300, top: 2100, owing: false, bottom: 100_000 },
        ];

        expect(glideEnding(slowed)).toBe("slowed");
    });

    it("ends a glide at a write once the scroll is still, owing nothing before it", () => {
        const slowed = [
            ...heard([1000, 1180, 1340, 1450, 1500, 1501]),
            { at: 40 + 300, top: 16000, owing: false, bottom: 100_000 },
        ];

        expect(glideEnding(slowed)).toBe("slowed");
    });

    it("tells a glide that ran into the top", () => {
        expect(glideEnding(heard([600, 400, 200, 0]))).toBe("at an edge");
    });

    it("tells a glide that bounced past the top, then settled", () => {
        expect(glideEnding(heard([600, 300, 50, -40, -10, 0]))).toBe("at an edge");
    });

    it("tells a glide that ran into the stream's end", () => {
        expect(glideEnding(heard([9000, 9200, 9400, 9600], { bottom: 9600 }))).toBe("at an edge");
    });

    it("tells a glide down the stream that slows", () => {
        expect(glideEnding(heard([1000, 1180, 1340, 1450, 1500, 1501]))).toBe("slowed");
    });

    it("calls a stroke that never glided cut short", () => {
        expect(glideEnding(heard([1000, 1000, 1000]))).toBe("cut short");
    });
});
