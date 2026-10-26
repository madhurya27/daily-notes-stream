import { describe, it, expect } from "vitest";
import { glideEnding, longestStall, type Heard } from "../../e2e-tests/ios/glide";

type Frames = { at: number; top: number; owing?: boolean }[];

/**
 * A frame every `every` ms from `from`, with the scroll position at each, and
 * whether it owes.
 */
function frames(tops: number[], { from = 0, every = 16, owing = false } = {}): Frames {
    return tops.map((top, i) => ({ at: from + i * every, top, owing }));
}

/**
 * Frames with the scroll staying at `top` for `ms` after `from`: the page still
 * draws, and the scroll is over.
 */
function still(top: number, from: number, ms: number, owing = false): Frames {
    return frames(Array<number>(Math.floor(ms / 16)).fill(top), { from: from + 16, owing });
}

function heard(...runs: Frames[]): Heard[] {
    return runs.flat().map(({ at, top, owing = false }) => ({ at, top, owing, bottom: 100_000 }));
}

// Patterns measured on an iPhone 16 Pro and an iPad Air, frame by frame from
// when the finger lifts.
describe("glideEnding", () => {
    it("tells a glide that slows to a crawl, as iOS ends one", () => {
        const slowed = frames([5000, 4820, 4650, 4500, 4400, 4340, 4320, 4319, 4318]);

        expect(glideEnding(heard(slowed, still(4318, 128, 400)))).toBe("slowed");
    });

    it("tells a glide stopped at speed while the page drew every frame", () => {
        const cut = frames([5000, 4820, 4650, 4500, 4380]);

        expect(glideEnding(heard(cut, still(4380, 64, 400)))).toBe("cut short");
    });

    // The page was blocked for 370 ms by Bases drawn mid-glide, and iOS kept
    // scrolling meanwhile.
    it("tells a glide that carried on through a stall, then slowed", () => {
        const before = frames([1000, 1180, 1340, 1480]);
        const after = frames([2280, 2300, 2316, 2328, 2336, 2340, 2341], { from: 48 + 370 });

        expect(glideEnding(heard(before, after, still(2341, 418 + 96, 400)))).toBe("slowed");
    });

    it("tells a glide whose end a stall hid", () => {
        const before = frames([1000, 1180, 1340, 1480]);
        const across = frames([2280], { from: 48 + 370 });

        expect(glideEnding(heard(before, across, still(2280, 418, 400)))).toBe("ended in a stall");
    });

    it("tells a glide stopped at speed, the scroll unmoved across a stall", () => {
        const before = frames([1000, 1180, 1340, 1480]);
        const after = frames([1480], { from: 48 + 370 });

        expect(glideEnding(heard(before, after, still(1480, 418, 400)))).toBe("cut short");
    });

    it("judges a glide drawn at 120 Hz by its speed, not its steps", () => {
        const slowed = frames([1000, 1090, 1170, 1240, 1290, 1320, 1335, 1340, 1342, 1343], { every: 8 });

        expect(glideEnding(heard(slowed, still(1343, 72, 400)))).toBe("slowed");
    });

    it("ends a glide once still on live frames, before the stream's write at rest", () => {
        const slowed = frames([1000, 1180, 1340, 1450, 1500, 1501], { owing: true });
        const rest = still(1501, 80, 320, true);
        const write = frames([16000], { from: 80 + 336 });

        expect(glideEnding(heard(slowed, rest, write))).toBe("slowed");
    });

    // Setting the scroll position takes work, which makes its frame late.
    it("ends a glide once still on live frames, before a write at rest that stalls", () => {
        const slowed = frames([1000, 1180, 1340, 1450, 1500, 1501], { owing: true });
        const rest = still(1501, 80, 320, true);
        const write = frames([2133], { from: 80 + 320 + 208 });

        expect(glideEnding(heard(slowed, rest, write))).toBe("slowed");
    });

    // As on an iPad: the stream's wait starts from the last scroll event, one
    // frame before the last frame drawn, so the frame before a late write can
    // come before the wait ends.
    it("ends a glide before a late write at rest, still a frame short of the hand-over", () => {
        const crawl = frames([3000, 3010, 3016, 3019, 3020]);
        const rest = still(3020, 64, 299);
        const write = frames([3652], { from: 64 + 288 + 109 });

        expect(glideEnding(heard(crawl, rest, write))).toBe("slowed");
    });

    it("tells a glide stopped at speed, owing, before the stream's write at rest", () => {
        const cut = frames([1000, 820, 650], { owing: true });
        const rest = still(650, 32, 320, true);
        const write = frames([3650], { from: 32 + 336 });

        expect(glideEnding(heard(cut, rest, write))).toBe("cut short");
    });

    it("tells a glide the stream stopped, owing, as its scroll ran out", () => {
        const stopped = frames([1000, 820, 650, 600, 550], { owing: true });
        const write = frames([3550, 3550], { from: 80 });

        expect(glideEnding(heard(stopped, write, still(3550, 96, 400)))).toBe("at an edge");
    });

    it("tells a glide that ran into the top", () => {
        expect(glideEnding(heard(frames([600, 400, 200, 0]), still(0, 48, 400)))).toBe("at an edge");
    });

    it("tells a glide that bounced past the top, then settled", () => {
        expect(glideEnding(heard(frames([600, 300, 50, -40, -10, 0]), still(0, 80, 400)))).toBe("at an edge");
    });

    it("tells a glide that ran into the stream's end", () => {
        const end = heard(frames([9000, 9200, 9400, 9600]), still(9600, 48, 400)).map((f) => ({ ...f, bottom: 9600 }));

        expect(glideEnding(end)).toBe("at an edge");
    });

    it("tells a glide down the stream that slows", () => {
        expect(glideEnding(heard(frames([1000, 1180, 1340, 1450, 1500, 1501]), still(1501, 80, 400)))).toBe("slowed");
    });

    it("calls a stroke that never glided cut short", () => {
        expect(glideEnding(heard(frames([1000, 1000, 1000])))).toBe("cut short");
    });
});

describe("longestStall", () => {
    it("is the longest wait between frames", () => {
        const stalled = heard(frames([1000, 1180, 1340]), frames([1900, 1950], { from: 32 + 370 }));

        expect(longestStall(stalled)).toBe(370);
    });

    it("is none for a single frame", () => {
        expect(longestStall(heard(frames([1000])))).toBe(0);
    });
});
