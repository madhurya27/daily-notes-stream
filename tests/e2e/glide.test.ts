import { describe, it, expect } from "vitest";
import {
    changesDuring,
    glideEnding,
    glideFaults,
    longestStall,
    neverScrolled,
    type Heard,
} from "../../e2e-tests/ios/glide";

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

    // On an iPad, a fast flick over Base tables, each text cell a scroll box,
    // stopped at 1.5 px/ms, under a tenth of its fastest. iOS slows a glide to
    // about a pixel a frame before ending it.
    it("tells a fast glide stopped at under a tenth of its fastest speed", () => {
        const cut = frames([5000, 5320, 5600, 5800, 5900, 5950, 5974]);

        expect(glideEnding(heard(cut, still(5974, 96, 400)))).toBe("cut short");
    });

    it("tells a slow glide that slows to a crawl", () => {
        const slowed = frames([5000, 5008, 5015, 5020, 5023, 5024]);

        expect(glideEnding(heard(slowed, still(5024, 80, 400)))).toBe("slowed");
    });

    // On an iPhone, the end of a glide moved a pixel every 50-90 ms, the last
    // one on a frame 2 ms after the one before.
    it("tells a glide that crawls to its end, its last pixel on a frame just after another", () => {
        const slowing = frames([5000, 4900, 4820, 4760, 4720, 4700, 4690]);
        const crawl = [
            { at: 150, top: 4689 },
            { at: 210, top: 4688 },
            { at: 268, top: 4688 },
            { at: 270, top: 4687 },
        ];

        expect(glideEnding(heard(slowing, crawl, still(4687, 270, 400)))).toBe("slowed");
    });

    // On an iPad, the frame at the lift and the next were 1 ms apart: one is
    // heard on the touch, the next as that frame is drawn.
    it("tells a glide stopped at speed when its first two frames came together", () => {
        const cut = [
            { at: 0, top: 169 },
            { at: 1, top: 330 },
            { at: 18, top: 500 },
            { at: 33, top: 649 },
            { at: 50, top: 649 },
            { at: 70, top: 934 },
            { at: 84, top: 1069 },
        ];

        expect(glideEnding(heard(cut, still(1069, 84, 400)))).toBe("cut short");
    });

    it("tells a glide stopped at speed at 60 Hz, its first two frames together", () => {
        const cut = [{ at: 0, top: 1000 }, ...frames([1200, 1360, 1500, 1600, 1660, 1680], { from: 1 })];

        expect(glideEnding(heard(cut, still(1680, 81, 400)))).toBe("cut short");
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
        const crawl = frames([2980, 3000, 3010, 3016, 3019, 3020]);
        const rest = still(3020, 80, 299);
        const write = frames([3652], { from: 80 + 288 + 109 });

        expect(glideEnding(heard(crawl, rest, write))).toBe("slowed");
    });

    it("tells a glide stopped at speed, owing, before the stream's write at rest", () => {
        const cut = frames([1000, 820, 650], { owing: true });
        const rest = still(650, 32, 320, true);
        const write = frames([3650], { from: 32 + 336 });

        expect(glideEnding(heard(cut, rest, write))).toBe("cut short");
    });

    // On an iPhone after a jump: the page stalled for 408 ms as the glide
    // neared the top, then the stream set its stop, and the glide bounced at
    // the top.
    it("tells a glide the stream stopped, owing, just after a stall", () => {
        const before = [
            { at: 0, top: 2163 },
            { at: 8, top: 2107 },
            { at: 17, top: 2051 },
            { at: 25, top: 1997 },
            { at: 34, top: 1891 },
            { at: 42, top: 1839 },
            { at: 50, top: 1788 },
            { at: 66, top: 1738 },
            { at: 75, top: 1689 },
        ].map((frame) => ({ ...frame, owing: true }));
        const after = [
            { at: 483, top: 2052 },
            { at: 526, top: -39, owing: true },
            { at: 540, top: -60, owing: true },
            { at: 555, top: -73, owing: true },
            { at: 661, top: -77, owing: true },
            { at: 681, top: -62, owing: true },
            { at: 694, top: -59, owing: true },
        ];

        expect(glideEnding(heard(before, after, still(-59, 694, 400, true)))).toBe("at an edge");
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

describe("neverScrolled", () => {
    it("is true when no frame moved from where the stroke started", () => {
        expect(neverScrolled(1000, heard(frames([1000, 1000, 1000])))).toBe(true);
    });

    // The drag moved it before the lift, and the glide stopped there.
    it("is false when the drag moved it, though nothing moved after the lift", () => {
        expect(neverScrolled(1000, heard(frames([1180, 1180, 1180])))).toBe(false);
    });

    it("is false when a later frame moved", () => {
        expect(neverScrolled(1000, heard(frames([1000, 1000, 1020])))).toBe(false);
    });
});

describe("changesDuring", () => {
    const rows = "div.bases-tbody in Journal/2026-08-30.md, Base 1";
    const cards = "div.bases-cards-group in Journal/2026-08-30.md, Base 2";

    it("counts each kind of change to each element, from the lift", () => {
        const events = [
            { at: 1000, kind: "nodes", what: rows },
            { at: 1040, kind: "style", what: cards },
            { at: 1100, kind: "nodes", what: rows },
        ];

        expect(changesDuring(events, 1000)).toEqual([
            { kind: "nodes", what: rows, count: 2, first: 0, last: 100 },
            { kind: "style", what: cards, count: 1, first: 40, last: 40 },
        ]);
    });

    it("lists the changes in the order they first came, the stroke's before the lift", () => {
        const events = [
            { at: 1100, kind: "style", what: cards },
            { at: 960, kind: "touchmove", what: "1 at y 300" },
            { at: 1050, kind: "nodes", what: rows },
        ];

        expect(changesDuring(events, 1000).map(({ first }) => first)).toEqual([-40, 50, 100]);
    });

    it("is none without events", () => {
        expect(changesDuring([], 1000)).toEqual([]);
    });
});

describe("glideFaults", () => {
    // From the lift at 0, slowing to a stop at 112 ms, then still.
    const glide = () => heard(frames([5000, 4800, 4650, 4550, 4500, 4480, 4475, 4474]), still(4474, 112, 600));
    const faults = (over: Partial<Parameters<typeof glideFaults>[0]>) =>
        glideFaults({ frames: glide(), stops: [], events: [], ...over });

    it("is none for a glide the stream left alone", () => {
        expect(faults({})).toEqual([]);
    });

    // How late a frame is depends on the device.
    it("is none for a glide the page was too busy to draw in time", () => {
        const late = heard(frames([5000, 4800, 4650]), frames([4300, 4290], { from: 332 }), still(4290, 348, 600));

        expect(faults({ frames: late })).toEqual([]);
    });

    it("names a write to the scroll position while the glide moved", () => {
        const stops = [{ at: 40, how: "scrollTop", owing: false }];

        expect(faults({ stops })).toEqual(["scrollTop 40 ms after the lift, 8 ms after the scroll last moved"]);
    });

    it("names a write during the stroke, before the lift", () => {
        const stops = [{ at: -30, how: "scrollTop", owing: false }];

        expect(faults({ stops })).toEqual(["scrollTop 30 ms before the lift, during the stroke"]);
    });

    it("names a freeze of the pane that ended the glide", () => {
        const stops = [{ at: 112, how: "freeze", owing: false }];

        expect(faults({ stops })).toEqual(["freeze 112 ms after the lift, 0 ms after the scroll last moved"]);
    });

    // The stream waits until the scroll has been still for SCROLL_IDLE_MS,
    // counted from the scroll event, which comes just before the frame.
    it("allows a write once the scroll has been still as long as the stream waits", () => {
        const stops = [{ at: 112 + 285, how: "scrollTop", owing: false }];

        expect(faults({ stops })).toEqual([]);
    });

    it("names a write sooner than the stream waits", () => {
        const stops = [{ at: 112 + 250, how: "scrollTop", owing: false }];

        expect(faults({ stops })).toEqual(["scrollTop 362 ms after the lift, 250 ms after the scroll last moved"]);
    });

    // What the stream owes is handed over at an edge on purpose (D-090,
    // D-091, D-143). Their own tests check them.
    it("allows a write while the stream owes a shift", () => {
        const stops = [{ at: 40, how: "scrollTop", owing: true }];

        expect(faults({ stops })).toEqual([]);
    });

    it("names a box that could scroll", () => {
        const events = [
            { at: 50, kind: "scroll box", what: "div.callout in Journal/2026-07-30.md (auto visible)" },
            { at: 80, kind: "nodes", what: "div.daily-note-block" },
        ];

        expect(faults({ events })).toEqual([
            "a box that could scroll: div.callout in Journal/2026-07-30.md (auto visible)",
        ]);
    });
});
