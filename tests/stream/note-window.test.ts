import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi, type MockInstance } from "vitest";
import { Component, TFile } from "obsidian";
import { NoteWindowManager, UNMEASURED_PANES } from "../../src/stream/note-window";
import { SCROLL_IDLE_MS, ScrollAnchor } from "../../src/stream/scroll-anchor";
import { NoteHeights } from "../../src/stream/note-heights";
import { HOLD_LIMIT_MS, SETTLE_MS } from "../../src/stream/height-hold";
import { STALL_MS } from "../../src/stream/stall-warning";
import { FarRuns, type Box } from "../../src/render/far-runs";
import type { DrawOrder } from "../../src/render/note-renderer";

/**
 * jsdom has no layout, so a rendered element's box is read from its data
 * attributes.
 */
function boxFromData(el: Element): Box | null {
    const { top, bottom } = (el as HTMLElement).dataset;
    return top === undefined ? null : { top: Number(top), bottom: Number(bottom), marginTop: 0, marginBottom: 0 };
}

/**
 * The observers, by the rootMargin they were created with. The rendering one
 * reaches less far than the hiding one, so a block near the edge is not
 * rendered and hidden over and over. The unloading one reaches furthest. The
 * screen one has none.
 */
interface Observers {
    render: IntersectionObserverCallback;
    hide: IntersectionObserverCallback;
    unload: IntersectionObserverCallback;
    screen: IntersectionObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    margins: string[];
}

let observers: Observers;

function stubObservers(): void {
    const callbacks: IntersectionObserverCallback[] = [];
    observers = {
        render: () => {},
        hide: () => {},
        unload: () => {},
        screen: () => {},
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        margins: [],
    };
    vi.stubGlobal(
        "IntersectionObserver",
        // A regular function, so it can be called with `new`.
        vi.fn(function (cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
            if (init?.rootMargin === undefined) observers.screen = cb;
            else {
                callbacks.push(cb);
                observers.margins.push(init.rootMargin);
                observers.render = callbacks[0]!;
                observers.hide = callbacks[1] ?? callbacks[0]!;
                observers.unload = callbacks[2] ?? callbacks[0]!;
            }
            return {
                observe: observers.observe,
                unobserve: observers.unobserve,
                disconnect: observers.disconnect,
            };
        })
    );
}

/**
 * Every ResizeObserver's callback, so a test can report that a block changed
 * size.
 */
let resizeCallbacks: ResizeObserverCallback[];
/** What the last ResizeObserver created was told to watch. */
let lastResizeObserve: ReturnType<typeof vi.fn>;
/** What the last ResizeObserver created was told to stop watching. */
let lastResizeUnobserve: ReturnType<typeof vi.fn>;
/** What each ResizeObserver created was told to watch, in order. */
let resizeObserves: ReturnType<typeof vi.fn>[];

/** Like the real one, it throws for anything that is not an element. */
function element(target: unknown): void {
    if (!(target instanceof Element)) throw new TypeError("parameter 1 is not of type 'Element'");
}

function stubResizeObservers(): void {
    resizeCallbacks = [];
    resizeObserves = [];
    vi.stubGlobal(
        "ResizeObserver",
        vi.fn(function (cb: ResizeObserverCallback) {
            resizeCallbacks.push(cb);
            lastResizeObserve = vi.fn(element);
            lastResizeUnobserve = vi.fn(element);
            resizeObserves.push(lastResizeObserve);
            return { observe: lastResizeObserve, unobserve: lastResizeUnobserve, disconnect: vi.fn() };
        })
    );
}

/** Tells every ResizeObserver that `block` changed size. */
function resize(block: HTMLElement): void {
    const entries = [{ target: block } as unknown as ResizeObserverEntry];
    for (const cb of resizeCallbacks) cb(entries, {} as ResizeObserver);
}

/** Calls one observer's callback for a block. */
function fire(cb: IntersectionObserverCallback, block: HTMLElement, isIntersecting: boolean): void {
    cb([{ target: block, isIntersecting } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
}

/**
 * A fake renderer that records what it rendered and threw away. `footer` stands
 * in for the linked mentions.
 */
function makeRenderer(
    opts: { render?: (block: HTMLElement) => void | Promise<void>; footer?: () => Promise<void> } = {}
) {
    const discarded: Component[] = [];
    return {
        createBlock: vi.fn((file: TFile) => {
            const block = document.createElement("div");
            block.addClass("daily-note-block");
            block.dataset.sourcePath = file.path;
            return block;
        }),
        renderInto: vi.fn(
            async (
                block: HTMLElement,
                _file: TFile,
                _goOn?: (note: Component) => Promise<boolean>,
                order?: DrawOrder
            ): Promise<{ component: Component; footer: Promise<void> } | null> => {
                // Like a long note rendered in slices. A note rendered all at
                // once is never marked.
                if (order === "from-end") block.addClass("is-drawing-from-end");
                await opts.render?.(block);
                block.createDiv({ cls: "daily-note-content" });
                return { component: new Component(), footer: opts.footer?.() ?? Promise.resolve() };
            }
        ),
        discard: vi.fn((component: Component) => {
            discarded.push(component);
        }),
        /**
         * After a save, a short note is rendered all at once again; a long one
         * may be updated in place (ADR 0019).
         */
        update: vi.fn(async (_block: HTMLElement, _file: TFile, _component: Component) => false),
        /**
         * A note rendered all at once has no runs.
         */
        runsOf: vi.fn((_component: Component): Element[][] => []),
        farRuns: new FarRuns(boxFromData),
        discarded,
    };
}

/**
 * The view's queue: one task at a time, in the order they arrive (ADR 0004).
 */
function makeQueue() {
    let queue = Promise.resolve();
    return (task: () => Promise<void>) => {
        queue = queue.then(task);
    };
}

/** jsdom has no layout, so a scroll root is given its height directly. */
function makeScrollRoot(clientHeight: number): HTMLElement {
    const root = document.createElement("div");
    Object.defineProperty(root, "clientHeight", { value: clientHeight, configurable: true });
    return root;
}

/**
 * The height a note gets before anything is measured, in the 800px panes these
 * tests scroll in.
 */
const UNMEASURED = `${UNMEASURED_PANES * 800}px`;

/** The layout every test here measures in, unless the test changes it. */
const LAYOUT = "600:16px";
/** More notes load below the stream's end. */
const moreBelow = () => false;

function makeManager(
    renderer = makeRenderer(),
    measure: (el: HTMLElement) => number = () => 500,
    scrollRoot = makeScrollRoot(800),
    heights = new NoteHeights()
) {
    const manager = new NoteWindowManager(renderer as never, makeQueue(), heights, () => LAYOUT, measure);
    const stream = document.createElement("div");
    manager.attach(scrollRoot, stream, moreBelow);
    return { manager, renderer, scrollRoot, stream, heights };
}

/**
 * Lets the chain of render promises finish. Timers are fake, so this only runs
 * what is due.
 */
const settle = () => vi.advanceTimersByTimeAsync(0);

/**
 * Keeps the scroll still long enough for waiting unloads to run.
 */
const still = () => vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

/**
 * Runs the next task. A timer set for 0 ms from inside another runs 1 ms later
 * under fake timers.
 */
const nextTask = () => vi.advanceTimersByTimeAsync(1);

/** An empty block keeps only its height. */
const isRendered = (block: HTMLElement) => !block.classList.contains("is-unloaded");

const FILE = new TFile("Notes/2025-01-01.md");

/** The empty block's height, which styles.css turns into a real height. */
const placeholderHeight = (block: HTMLElement) => block.style.getPropertyValue("--daily-note-placeholder-height");

beforeEach(() => {
    stubObservers();
    stubResizeObservers();
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

describe("NoteWindowManager measurement", () => {
    it("measures the laid-out box by default", () => {
        const manager = new NoteWindowManager(makeRenderer() as never, makeQueue(), new NoteHeights(), () => LAYOUT);
        manager.attach(document.createElement("div"), document.createElement("div"), moreBelow);
        const block = manager.add(FILE);
        block.getBoundingClientRect = () => ({ height: 321 }) as DOMRect;
        document.body.appendChild(block);

        fire(observers.render, block, true);
        return settle().then(async () => {
            fire(observers.unload, block, false);
            await still();
            expect(placeholderHeight(block)).toBe("321px");
        });
    });
});

// ---------------------------------------------------------------------------
// Empty blocks
// ---------------------------------------------------------------------------

describe("NoteWindowManager.add", () => {
    // Too tall is safe: scrolling up past it ends at D-091's stop (D-092).
    it("returns an unloaded block reserving two panes before anything is measured", () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        expect(block.classList.contains("is-unloaded")).toBe(true);
        expect(placeholderHeight(block)).toBe(UNMEASURED);
        expect(block.childElementCount).toBe(0);
    });

    it("renders nothing itself — appending a batch stays O(1) DOM per note", () => {
        const { manager, renderer } = makeManager();
        manager.add(FILE);
        expect(renderer.renderInto).not.toHaveBeenCalled();
    });

    it("observes the block with all four observers", () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        expect(observers.observe).toHaveBeenCalledWith(block);
        expect(observers.observe).toHaveBeenCalledTimes(4);
    });
});

// ---------------------------------------------------------------------------
// Remembered heights
// ---------------------------------------------------------------------------

/**
 * An empty block gets the height its note last measured, in this session or an
 * earlier one (ADR 0010). A note never measured gets a height based on what its
 * neighbours measured.
 */
describe("NoteWindowManager remembered heights", () => {
    /**
     * Renders a block for `file`, which measures `px`.
     */
    async function renderAt(px: number, file = FILE) {
        const setup = makeManager(makeRenderer(), () => px);
        const block = setup.manager.add(file);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return { ...setup, block };
    }

    it("reserves the height the note last measured", () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        heights.keep("400:16px", FILE.path, 1200);
        const { manager } = makeManager(undefined, undefined, undefined, heights);

        expect(placeholderHeight(manager.add(FILE))).toBe("812px");
    });

    // Leaning tall: the height that 90% of heights are below (D-092).
    it("reserves what the layout's notes measured for a note never measured", () => {
        const heights = new NoteHeights();
        for (const [path, px] of [
            ["a.md", 700],
            ["b.md", 9000],
            ["c.md", 710],
        ] as const)
            heights.keep(LAYOUT, path, px);
        const { manager } = makeManager(undefined, undefined, undefined, heights);

        // The height that 90% of heights are below, but never just the tallest
        // (D-132).
        expect(placeholderHeight(manager.add(FILE))).toBe("710px");
    });

    // Even when limited by its size, a small note still gets the pane heights a
    // note never measured gets (D-135).
    it("caps a note's estimate at its size, never below what an unmeasured note reserves", () => {
        const heights = new NoteHeights(undefined, (path) => ({ mtime: 1, size: path === "long.md" ? 500_000 : 10 }));
        heights.keep(LAYOUT, "long.md", 235_612);
        const { manager } = makeManager(undefined, undefined, undefined, heights);

        expect(placeholderHeight(manager.add(FILE))).toBe(UNMEASURED);
    });

    describe("with an estimate given", () => {
        function makeEstimating(heights: NoteHeights) {
            const estimate = vi.fn((_layout: string, _path: string): number | undefined => 950);
            const manager = new NoteWindowManager(
                makeRenderer() as never,
                makeQueue(),
                heights,
                () => LAYOUT,
                () => 500,
                estimate
            );
            manager.attach(makeScrollRoot(800), document.createElement("div"), moreBelow);
            return { manager, estimate };
        }

        it("reserves it for a note not measured here, and the default when it has none", () => {
            const heights = new NoteHeights();
            const { manager, estimate } = makeEstimating(heights);

            expect(placeholderHeight(manager.add(FILE))).toBe("950px");
            expect(estimate).toHaveBeenCalledWith(LAYOUT, FILE.path);
            estimate.mockReturnValueOnce(undefined);
            expect(placeholderHeight(manager.add(new TFile("b.md")))).toBe(UNMEASURED);

            heights.keep(LAYOUT, FILE.path, 812);
            expect(placeholderHeight(manager.add(FILE))).toBe("812px");
        });

        // A guessed height is not a height to hold a note at while it renders.
        it("holds nothing at it", async () => {
            const { manager } = makeEstimating(new NoteHeights());
            const block = manager.add(FILE);
            document.body.appendChild(block);

            fire(observers.render, block, true);
            await settle();

            expect(block.style.getPropertyValue("--daily-note-held-height")).toBe("");
            block.remove();
        });
    });

    it("reserves two panes for a note never measured, before anything is", () => {
        const { manager } = makeManager();
        expect(placeholderHeight(manager.add(FILE))).toBe(UNMEASURED);
    });

    // iOS closes an app without unloading the plugin, so a note still on screen
    // must be remembered before then.
    it("remembers a note's height once nothing in it has resized for a while", async () => {
        const { heights } = await renderAt(640);

        await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
        expect(heights.heightOf(LAYOUT, FILE.path)).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(heights.heightOf(LAYOUT, FILE.path)).toBe(640);
    });

    // A Base that is filling in, or an image that is loading, is too short
    // until it is done.
    it("keeps the height it had while the note is still changing", async () => {
        const { heights, block } = await renderAt(640);
        heights.keep(LAYOUT, FILE.path, 700);

        await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);
        resize(block);
        await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
        expect(heights.heightOf(LAYOUT, FILE.path)).toBe(700);

        await vi.advanceTimersByTimeAsync(1);
        expect(heights.heightOf(LAYOUT, FILE.path)).toBe(640);
    });

    it("keeps watching a rendered note when the pane's height changes", async () => {
        const { manager, scrollRoot, block } = await renderAt(640);
        const unrendered = manager.add(new TFile("Notes/2025-01-02.md"));

        Object.defineProperty(scrollRoot, "clientHeight", { value: 1600, configurable: true });
        manager.onResize();

        expect(lastResizeObserve).toHaveBeenCalledWith(block.firstElementChild);
        expect(lastResizeObserve).not.toHaveBeenCalledWith(unrendered);
    });

    it("reserves what an unsettled note unloads at, and remembers none of it", async () => {
        const { heights, block } = await renderAt(640);
        await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);
        fire(observers.unload, block, false);
        resize(block);

        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);
        expect(placeholderHeight(block)).toBe("640px");
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(heights.heightOf(LAYOUT, FILE.path)).toBeUndefined();
    });

    it("remembers nothing of a block measuring nothing, and keeps what it reserved", async () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 700);
        const { manager } = makeManager(makeRenderer(), () => 0, undefined, heights);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        fire(observers.unload, block, false);
        await still();

        expect(heights.heightOf(LAYOUT, FILE.path)).toBe(700);
        expect(placeholderHeight(block)).toBe("700px");
    });

    // Reading the layout lays the stream out, and a batch adds blocks between
    // calls to add.
    it("reads the layout once for a batch of placeholders", async () => {
        const layoutOf = vi.fn(() => LAYOUT);
        const manager = new NoteWindowManager(makeRenderer() as never, makeQueue(), new NoteHeights(), layoutOf);
        manager.attach(makeScrollRoot(800), document.createElement("div"), moreBelow);

        for (let day = 1; day <= 3; day++) manager.add(new TFile(`Notes/2025-01-0${day}.md`));
        expect(layoutOf).toHaveBeenCalledOnce();

        await settle();
        manager.add(new TFile("Notes/2025-01-04.md"));
        expect(layoutOf).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// Holding a note's height while it fills in
// ---------------------------------------------------------------------------

/**
 * A note is drawn short and then fills in: Bases are drawn empty, and images
 * load late. Held at a height it measured before, it never shows the dip
 * (D-054).
 */
describe("NoteWindowManager holds a rendered note until it settles", () => {
    const heldHeight = (block: HTMLElement) => block.style.getPropertyValue("--daily-note-held-height");

    /**
     * Renders a block for FILE, which measured `remembered` before, if given.
     */
    async function renderRemembering(remembered: number | undefined, measure: (el: HTMLElement) => number = () => 640) {
        const heights = new NoteHeights();
        if (remembered !== undefined) heights.keep(LAYOUT, FILE.path, remembered);
        const setup = makeManager(makeRenderer(), measure, undefined, heights);
        const block = setup.manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return { ...setup, block };
    }

    afterEach(() => document.body.empty());

    it("holds it at the height it measured before", async () => {
        const { block } = await renderRemembering(812);

        expect(heldHeight(block)).toBe("812px");
        expect(placeholderHeight(block)).toBe("");
    });

    // Holding a guessed height would leave a gap after a short note until it
    // settles.
    it("holds nothing on a note never measured", async () => {
        const { block } = await renderRemembering(undefined);

        expect(heldHeight(block)).toBe("");
    });

    it("lets go once it settles, remembering what it measures without the hold", async () => {
        const { block, heights } = await renderRemembering(812, (el) =>
            el.style.getPropertyValue("--daily-note-held-height") ? 812 : 640
        );

        await vi.advanceTimersByTimeAsync(SETTLE_MS);

        expect(heldHeight(block)).toBe("");
        expect(heights.heightOf(LAYOUT, FILE.path)).toBe(640);
    });

    // While held, the block cannot shrink, so only its contents report a dip.
    it("waits on its contents, which move under the hold", async () => {
        const { block } = await renderRemembering(812);

        await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);
        resize(block.firstElementChild as HTMLElement);
        await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

        expect(heldHeight(block)).toBe("812px");
        expect(lastResizeObserve).toHaveBeenCalledWith(block.firstElementChild);
    });

    it("lets go of a note that never settles, and remembers nothing of it", async () => {
        const { block, heights } = await renderRemembering(812);

        for (let t = 0; t < HOLD_LIMIT_MS; t += SETTLE_MS / 2) {
            resize(block);
            await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
        }

        expect(heldHeight(block)).toBe("");
        expect(heights.heightOf(LAYOUT, FILE.path)).toBe(812);
    });

    // A note measured in this session is held at the height it had when it was
    // unloaded.
    it("holds a note coming back at what it unloaded at", async () => {
        const { manager, block } = await renderRemembering(undefined);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        fire(observers.unload, block, false);
        await still();

        manager.render(block);
        await settle();

        expect(heldHeight(block)).toBe("640px");
    });

    it("holds a note re-rendered in place at the height it showed", async () => {
        const { manager, block } = await renderRemembering(undefined);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);

        await manager.refresh(block);

        expect(heldHeight(block)).toBe("640px");
    });

    // The footer reads other notes before it draws, so a pause before then does
    // not mean the note is done.
    it("holds it until its linked mentions are drawn, then settles as before", async () => {
        let drawn!: () => void;
        const renderer = makeRenderer({ footer: () => new Promise((resolve) => (drawn = resolve)) });
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const { manager } = makeManager(renderer, () => 640, undefined, heights);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        resize(block);
        await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
        expect(heldHeight(block)).toBe("812px");

        drawn();
        await settle();
        expect(heldHeight(block)).toBe("812px");
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        expect(heldHeight(block)).toBe("");
        expect(heights.heightOf(LAYOUT, FILE.path)).toBe(640);
    });

    it("renders the next note while one's linked mentions are still drawing", async () => {
        const renderer = makeRenderer({ footer: () => new Promise(() => {}) });
        const { manager } = makeManager(renderer);
        const first = manager.add(FILE);
        const second = manager.add(new TFile("Notes/2025-01-02.md"));
        document.body.append(first, second);

        fire(observers.render, first, true);
        fire(observers.render, second, true);
        await settle();

        expect(second.querySelector(".daily-note-content")).not.toBeNull();
    });

    it("settles nothing for a note unloaded before its linked mentions are drawn", async () => {
        let drawn!: () => void;
        const renderer = makeRenderer({ footer: () => new Promise((resolve) => (drawn = resolve)) });
        const heights = new NoteHeights();
        const { manager } = makeManager(renderer, () => 640, undefined, heights);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        manager.remove(block);
        drawn();
        await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);

        expect(heights.heightOf(LAYOUT, FILE.path)).toBeUndefined();
    });

    // Folding a section is the reader's own change, so holding the height would
    // leave a gap.
    it("lets go the moment the reader touches the note", async () => {
        const { manager, block } = await renderRemembering(812);

        manager.onTouch(block.firstElementChild);

        expect(heldHeight(block)).toBe("");
    });

    // A finger on a bounce at the top keeps the bounce going, so the anchor
    // only moves the shift into the scroll once the finger lifts.
    it("tells the anchor when a finger goes down and lifts", () => {
        const { manager } = makeManager();
        const anchor = manager["anchor"];
        const down = vi.spyOn(anchor, "fingerDown");
        const up = vi.spyOn(anchor, "fingerUp");

        manager.onFingerDown();
        expect(down).toHaveBeenCalled();
        manager.onFingerUp();
        expect(up).toHaveBeenCalled();
    });

    it("keeps holding through a touch elsewhere", async () => {
        const { manager, block } = await renderRemembering(812);

        manager.onTouch(document.body);
        manager.onTouch(null);

        expect(heldHeight(block)).toBe("812px");
    });

    it("unloads at what it measures without the hold", async () => {
        const { block } = await renderRemembering(812, (el) =>
            el.style.getPropertyValue("--daily-note-held-height") ? 812 : 640
        );

        fire(observers.unload, block, false);
        await still();

        expect(placeholderHeight(block)).toBe("640px");
    });
});

// ---------------------------------------------------------------------------
// A new width
// ---------------------------------------------------------------------------

/**
 * A height is only correct at the width it was measured at, and turning the
 * screen changes the width.
 */
describe("NoteWindowManager after the pane's width changes", () => {
    const NARROW = "400:16px";
    const heldHeight = (block: HTMLElement) => block.style.getPropertyValue("--daily-note-held-height");

    /**
     * A manager whose layout the test changes. FILE measured 812 in LAYOUT.
     * `below` is how much of the stream is below the pane.
     */
    function makeResizable({
        estimate = (_layout: string): number | undefined => undefined,
        below = 10_000,
        render = (_block: HTMLElement): void | Promise<void> => undefined,
    } = {}) {
        let layout = LAYOUT;
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const manager = new NoteWindowManager(
            makeRenderer({ render }) as never,
            makeQueue(),
            heights,
            () => layout,
            () => 640,
            estimate
        );
        const root = makeScrollRoot(800);
        Object.defineProperty(root, "scrollTop", { value: 2000, configurable: true });
        Object.defineProperty(root, "scrollHeight", { value: 2000 + 800 + below, configurable: true });
        manager.attach(root, document.createElement("div"), moreBelow);
        /**
         * The layout is read once per task, so the width changes in the next
         * one.
         */
        const narrow = async () => {
            await settle();
            layout = NARROW;
            manager.onResize();
        };
        /** Another note was measured, so what the estimates use changed. */
        const learn = () => heights.keep(LAYOUT, "learned.md", 700);
        return { manager, heights, narrow, learn };
    }

    afterEach(() => document.body.empty());

    it("holds a note rendering after the turn at what it measured at the new width", async () => {
        const { manager, heights, narrow } = makeResizable();
        heights.keep(NARROW, FILE.path, 1200);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        await narrow();
        fire(observers.render, block, true);
        await settle();
        expect(heldHeight(block)).toBe("1200px");
    });

    // The text reflows for several frames after the screen turns, and nothing
    // else moves meanwhile.
    it("re-reserves an unloaded note at the new width once the scroll is still", async () => {
        const { manager, heights, narrow } = makeResizable();
        heights.keep(NARROW, FILE.path, 1200);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        await narrow();
        expect(placeholderHeight(block)).toBe("812px");

        await still();
        expect(placeholderHeight(block)).toBe("1200px");
    });

    // Just after a turn, the notes on screen are measured at the new width
    // within moments.
    it("keeps what a note reserves where the new width has measured nothing yet", async () => {
        const { manager, narrow } = makeResizable({ estimate: (layout) => (layout === LAYOUT ? 900 : undefined) });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);

        await narrow();
        await still();

        expect(placeholderHeight(block)).toBe("900px");
    });

    // ADR 0014: after a turn, nothing scrolls, but what the notes on screen
    // measured still reaches the others.
    it("re-reserves as soon as a height is kept, the scroll being still", async () => {
        let estimated = 900;
        const { manager } = makeResizable({ estimate: () => estimated });
        const placeholder = manager.add(new TFile("b.md"));
        const rendered = manager.add(new TFile("c.md"));
        for (const block of [placeholder, rendered]) document.body.appendChild(block);
        await still();

        fire(observers.render, rendered, true);
        await settle();
        estimated = 1100;
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        await nextTask();

        expect(placeholderHeight(placeholder)).toBe("1100px");
    });

    it("re-reserves a height kept mid-scroll once the scroll is still", async () => {
        let estimated = 900;
        const { manager } = makeResizable({ estimate: () => estimated });
        const placeholder = manager.add(new TFile("b.md"));
        const rendered = manager.add(new TFile("c.md"));
        for (const block of [placeholder, rendered]) document.body.appendChild(block);
        await still();

        fire(observers.render, rendered, true);
        await settle();
        estimated = 1100;
        await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
        manager.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(placeholderHeight(placeholder)).toBe("900px");

        await vi.advanceTimersByTimeAsync(1);
        expect(placeholderHeight(placeholder)).toBe("1100px");
    });

    // The stream learns from every note rendered. An empty block made earlier
    // gets the height known at that time.
    it("re-estimates a note never measured here once the scroll comes to rest", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);
        expect(placeholderHeight(block)).toBe("900px");

        estimated = 1100;
        learn();
        manager.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(placeholderHeight(block)).toBe("900px");

        await still();
        expect(placeholderHeight(block)).toBe("1100px");
    });

    it("waits again after a resize before re-reserving", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);

        estimated = 1100;
        learn();
        manager.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        manager.onResize();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(placeholderHeight(block)).toBe("900px");

        await vi.advanceTimersByTimeAsync(1);
        expect(placeholderHeight(block)).toBe("1100px");
    });

    it("waits again after every scroll before re-reserving", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);

        estimated = 1100;
        learn();
        manager.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        manager.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(placeholderHeight(block)).toBe("900px");

        await vi.advanceTimersByTimeAsync(1);
        expect(placeholderHeight(block)).toBe("1100px");
    });

    it("counts a re-reservation as a layout change", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        document.body.appendChild(manager.add(new TFile("b.md")));
        const before = manager.layoutChanges;

        estimated = 1100;
        learn();
        manager.onScroll();
        await still();

        expect(manager.layoutChanges).toBe(before + 1);
    });

    it("tells the anchor in the task it re-reserves, and only then", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        document.body.appendChild(manager.add(new TFile("b.md")));
        const told = vi.spyOn(ScrollAnchor.prototype, "resized");
        onTestFinished(() => told.mockRestore());

        manager.onScroll();
        await still();
        expect(told).not.toHaveBeenCalled();

        estimated = 1100;
        learn();
        manager.onScroll();
        await still();
        expect(told).toHaveBeenCalledTimes(1);
    });

    it("leaves rendered notes, and notes already right, as they are", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({
            estimate: () => estimated,
            // Its render never finishes.
            render: (block) => (block.dataset.sourcePath === "rendering.md" ? new Promise(() => {}) : undefined),
        });
        const rendered = manager.add(new TFile("rendered.md"));
        const rendering = manager.add(new TFile("rendering.md"));
        const measured = manager.add(FILE);
        for (const block of [rendered, rendering, measured]) document.body.appendChild(block);
        fire(observers.render, rendered, true);
        await settle();
        fire(observers.render, rendering, true);

        estimated = 1100;
        learn();
        manager.onScroll();
        await still();

        expect(placeholderHeight(rendered)).toBe("");
        expect(placeholderHeight(rendering)).toBe("900px");
        expect(placeholderHeight(measured)).toBe("812px");
    });

    // The edit made it forget its saved height (ADR 0017).
    it("re-estimates an unloaded note refreshed after an edit, once the scroll is still", async () => {
        const { manager, heights } = makeResizable({ estimate: () => 900 });
        const block = manager.add(FILE);
        document.body.appendChild(block);

        heights.forget(FILE.path);
        await manager.refresh(block);
        expect(placeholderHeight(block)).toBe("812px");

        await still();
        expect(placeholderHeight(block)).toBe("900px");
    });

    // Its render reads the cache as it is now, and it is held at what it
    // measured until it stops changing.
    it("leaves a note rendering as it is when refreshed", async () => {
        let rendered = () => {};
        const { manager, heights } = makeResizable({
            estimate: () => 900,
            render: () => new Promise<void>((resolve) => (rendered = resolve)),
        });
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);

        heights.forget(FILE.path);
        await manager.refresh(block);
        rendered();
        await settle();

        expect(heldHeight(block)).toBe("812px");
    });

    // Like a session that never measured anything: the forget command is for
    // testing with nothing saved.
    it("reserves two panes for every unloaded note once all heights are forgotten", async () => {
        const { manager, heights } = makeResizable();
        const block = manager.add(FILE);
        document.body.appendChild(block);

        heights.retainOnly(new Set());
        manager.forgetHeights();
        await still();

        expect(placeholderHeight(block)).toBe(UNMEASURED);
    });

    it("re-estimates every unloaded note once its heights are forgotten, and the scroll is still", async () => {
        const { manager, heights } = makeResizable({ estimate: () => 900 });
        const stored = manager.add(FILE);
        const unloaded = manager.add(new TFile("b.md"));
        const rendered = manager.add(new TFile("c.md"));
        for (const block of [stored, unloaded, rendered]) document.body.appendChild(block);
        fire(observers.render, unloaded, true);
        fire(observers.render, rendered, true);
        await settle();
        fire(observers.unload, unloaded, false);
        await still();
        expect(placeholderHeight(unloaded)).toBe("640px");

        heights.retainOnly(new Set());
        manager.forgetHeights();
        expect(placeholderHeight(stored)).toBe("812px");

        await still();
        expect(placeholderHeight(stored)).toBe("900px");
        expect(placeholderHeight(unloaded)).toBe("900px");
        expect(placeholderHeight(rendered)).toBe("");
    });

    it("tells nobody when what it learned moves no placeholder, and waits for the next lesson", async () => {
        const { manager, learn } = makeResizable({ estimate: () => 900 });
        document.body.appendChild(manager.add(new TFile("b.md")));
        const told = vi.spyOn(ScrollAnchor.prototype, "resized");
        onTestFinished(() => told.mockRestore());

        learn();
        manager.onScroll();
        await still();
        manager.onScroll();

        expect(told).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps a shrink owed when a note is added meanwhile", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated, below: 300 });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);
        estimated = 500;
        learn();
        manager.onScroll();
        await still();

        document.body.appendChild(manager.add(new TFile("c.md")));
        manager.onScroll();

        expect(vi.getTimerCount()).toBe(1);
    });

    /** Lays out `block` `top` px from the pane's top, `height` tall. */
    const layOut = (block: HTMLElement, top: number, height: number) =>
        (block.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect);

    // ADR 0014: a stream made shorter than the pane's bottom first pulls the
    // scroll back.
    it("puts off a shrink below the pane's top larger than the stream below the pane", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated, below: 300 });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);
        layOut(block, 700, 900);

        estimated = 500;
        learn();
        manager.onScroll();
        await still();
        expect(placeholderHeight(block)).toBe("900px");

        // Still needed: the next time scrolling stops, it tries again, with
        // nothing new learned.
        estimated = 700;
        manager.onScroll();
        await still();
        expect(placeholderHeight(block)).toBe("700px");
    });

    // ADR 0015: shown as a shift first, a shrink above the pane keeps the
    // scroll range.
    it("re-reserves a shrink above the pane larger than the stream below it", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated, below: 300 });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);
        layOut(block, -1000, 900);

        estimated = 500;
        learn();
        manager.onScroll();
        await still();

        expect(placeholderHeight(block)).toBe("500px");
    });

    it("tells the anchor how far the notes above move before moving them", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        const above = manager.add(new TFile("a.md"));
        const below = manager.add(new TFile("b.md"));
        document.body.append(above, below);
        layOut(above, -1000, 900);
        layOut(below, 700, 900);
        const reservedWhenTold: string[] = [];
        const told = vi
            .spyOn(ScrollAnchor.prototype, "anticipate")
            .mockImplementation(() => reservedWhenTold.push(placeholderHeight(above)));
        onTestFinished(() => told.mockRestore());

        estimated = 500;
        learn();
        manager.onScroll();
        await still();

        expect(told).toHaveBeenCalledExactlyOnceWith(-400);
        expect(reservedWhenTold).toEqual(["900px"]);
    });

    // ADR 0015: it only runs once scrolling stops, which is when moving the
    // shift into the scroll happens.
    it("hands the move to the scroll in the task it re-reserves", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);
        const reservedAtHandOver: string[] = [];
        const handedOver = vi
            .spyOn(ScrollAnchor.prototype, "handOver")
            .mockImplementation(() => reservedAtHandOver.push(placeholderHeight(block)));
        onTestFinished(() => handedOver.mockRestore());

        estimated = 500;
        learn();
        manager.onScroll();
        await still();

        expect(reservedAtHandOver).toEqual(["500px"]);
    });

    // From a phone's log: it ran as the phone turned, moving the shift into the
    // scroll stopped keeping the place read before the turn, and a Base
    // re-rendered during the turn lost the place.
    it("re-reserves once the anchor has handed over a reflow, not during it", async () => {
        let estimated = 900;
        const { manager, learn } = makeResizable({ estimate: () => estimated });
        const block = manager.add(new TFile("b.md"));
        document.body.appendChild(block);
        let reflowing = true;
        vi.spyOn(ScrollAnchor.prototype, "holdsReflow").mockImplementation(() => reflowing);
        const handedOver = vi.spyOn(ScrollAnchor.prototype, "handOver").mockImplementation(() => {});
        onTestFinished(() => void vi.restoreAllMocks());

        estimated = 500;
        learn();
        manager.onScroll();
        await still();
        expect(handedOver).not.toHaveBeenCalled();
        expect(placeholderHeight(block)).toBe("900px");

        reflowing = false;
        await still();
        await nextTask();
        expect(handedOver).toHaveBeenCalledOnce();
        expect(placeholderHeight(block)).toBe("500px");
    });

    it("drops a re-reserve held back by a reflow once detached", async () => {
        const { manager, learn } = makeResizable({ estimate: () => 500 });
        document.body.appendChild(manager.add(new TFile("b.md")));
        vi.spyOn(ScrollAnchor.prototype, "holdsReflow").mockReturnValue(true);
        onTestFinished(() => void vi.restoreAllMocks());
        learn();
        manager.onScroll();
        await still();

        manager.detach();

        expect(vi.getTimerCount()).toBe(0);
    });

    it("holds nothing on a note never measured at the new width", async () => {
        const { manager, narrow } = makeResizable();
        const block = manager.add(FILE);
        document.body.appendChild(block);

        await narrow();
        fire(observers.render, block, true);
        await settle();

        expect(heldHeight(block)).toBe("");
    });

    it("lets go of a note held at the old width's height", async () => {
        const { manager, narrow } = makeResizable();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        expect(heldHeight(block)).toBe("812px");

        await narrow();

        expect(heldHeight(block)).toBe("");
        expect(placeholderHeight(block)).toBe("");
    });

    // Dragging a split resizes on every frame, so thousands of blocks must not
    // be rewritten each time. Its pinned height was measured at the old width,
    // so it is unloaded and gets a height like other empty notes.
    it("empties a note hidden at the old width", async () => {
        const { manager, narrow } = makeResizable();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        fire(observers.hide, block, false);

        await narrow();

        expect(block.hasClass("is-far")).toBe(false);
        expect(block.hasClass("is-unloaded")).toBe(true);
    });

    it("rereads no heights when the width did not change", async () => {
        const { manager, heights } = makeResizable();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        heights.keep(LAYOUT, FILE.path, 900);

        await settle();
        manager.onResize();
        fire(observers.render, block, true);
        await settle();

        expect(heldHeight(block)).toBe("812px");
    });
});

// ---------------------------------------------------------------------------
// Distances in pane heights
// ---------------------------------------------------------------------------

describe("NoteWindowManager margins", () => {
    const marginsPx = () => observers.margins.slice(-3).map((m) => parseInt(m, 10));

    it("hides further out than it renders, so a block on the edge cannot thrash, and unloads further still", () => {
        makeManager();
        const [render, hide, unload] = marginsPx();
        expect(render).toBeLessThan(hide!);
        expect(hide).toBeLessThan(unload!);
    });

    // A distance in pixels is a different number of screens on a phone than on
    // a tall monitor. What matters is how far ahead of the reader it is.
    it("measures both margins in viewports", () => {
        makeManager(makeRenderer(), () => 500, makeScrollRoot(1000));
        expect(marginsPx()).toEqual([1500, 4000, 12000]);
    });

    it("scales with a shorter scroll root", () => {
        makeManager(makeRenderer(), () => 500, makeScrollRoot(600));
        expect(marginsPx()).toEqual([900, 2400, 7200]);
    });

    // Otherwise, a pane dragged to zero height, or not laid out yet, would
    // render and unload the same block on every scroll.
    it("holds a floor under a scroll root with no height", () => {
        makeManager(makeRenderer(), () => 500, makeScrollRoot(0));
        expect(marginsPx()).toEqual([600, 1600, 4800]);
    });

    it("recomputes the margins when the pane is resized", () => {
        const root = makeScrollRoot(800);
        const { manager } = makeManager(makeRenderer(), () => 500, root);
        observers.disconnect.mockClear();

        Object.defineProperty(root, "clientHeight", { value: 1600, configurable: true });
        manager.onResize();

        expect(marginsPx()).toEqual([2400, 6400, 19200]);
        // The old observers for rendering, hiding and unloading.
        expect(observers.disconnect).toHaveBeenCalledTimes(3);
    });

    // Turning a phone changes the height too (D-055).
    it("keeps the scroll anchor when the pane is resized", () => {
        const root = makeScrollRoot(800);
        const { manager } = makeManager(makeRenderer(), () => 500, root);
        const detach = vi.spyOn(ScrollAnchor.prototype, "detach");
        onTestFinished(() => detach.mockRestore());

        Object.defineProperty(root, "clientHeight", { value: 1600, configurable: true });
        manager.onResize();

        expect(detach).not.toHaveBeenCalled();
    });

    it("reserves nothing when resized before it is attached", async () => {
        const manager = new NoteWindowManager(makeRenderer() as never, makeQueue(), new NoteHeights(), () => LAYOUT);
        const block = manager.add(FILE);
        const reserved = placeholderHeight(block);

        manager.onResize();
        await still();

        expect(placeholderHeight(block)).toBe(reserved);
    });

    it("watches the blocks again with the new margins when the pane is resized", () => {
        const root = makeScrollRoot(800);
        const { manager } = makeManager(makeRenderer(), () => 500, root);
        const block = manager.add(FILE);
        observers.observe.mockClear();

        Object.defineProperty(root, "clientHeight", { value: 1600, configurable: true });
        manager.onResize();

        expect(observers.observe.mock.calls.filter(([el]) => el === block)).toHaveLength(3);
    });

    it("watches what is on screen in the pane itself", () => {
        const { scrollRoot } = makeManager();

        expect(IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), { root: scrollRoot });
    });

    it("leaves the observers alone when a resize did not change the height", () => {
        const { manager } = makeManager();
        observers.disconnect.mockClear();

        manager.onResize();

        expect(observers.disconnect).not.toHaveBeenCalled();
    });

    it("ignores a resize before the view is attached", () => {
        const manager = new NoteWindowManager(
            makeRenderer() as never,
            makeQueue(),
            new NoteHeights(),
            () => LAYOUT,
            () => 0
        );
        expect(() => manager.onResize()).not.toThrow();
        expect(observers.margins).toHaveLength(0);
    });

    it("leaves a block rendered between the two margins", async () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await settle();
        // Past the rendering distance but not the unloading distance: the
        // rendering observer stops intersecting, and nothing reacts to that.
        fire(observers.render, block, false);
        await settle();

        expect(block.classList.contains("is-unloaded")).toBe(false);
        expect(renderer.discard).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Rendering and unloading
// ---------------------------------------------------------------------------

describe("NoteWindowManager render", () => {
    it("fills the block and releases the fixed height", async () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await settle();

        expect(block.querySelector(".daily-note-content")).not.toBeNull();
        expect(block.classList.contains("is-unloaded")).toBe(false);
        expect(placeholderHeight(block)).toBe("");
    });

    // Each note waits for its turn, so one that never finishes leaves every
    // other note undrawn (D-164).
    it("names a note still drawing after the stall time in the console", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        onTestFinished(() => logged.mockRestore());
        const { manager } = makeManager(makeRenderer({ render: () => new Promise(() => {}) }));
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await vi.advanceTimersByTimeAsync(STALL_MS);

        expect(logged).toHaveBeenCalledWith(expect.stringContaining(`Drawing ${FILE.path} has run for`));
    });

    it("renders a block only once while it stays in view", async () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        fire(observers.render, block, true);
        await settle();

        expect(renderer.renderInto).toHaveBeenCalledTimes(1);
    });

    it("renders nothing for a block reported outside the render margin", async () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, false);
        await settle();

        expect(renderer.renderInto).not.toHaveBeenCalled();
    });

    it("ignores an entry for a block it does not own", async () => {
        const { manager, renderer } = makeManager();
        manager.add(FILE);

        fire(observers.render, document.createElement("div"), true);
        await settle();

        expect(renderer.renderInto).not.toHaveBeenCalled();
    });

    // reload() and rerenderAll() empty the container while renders run, so
    // after the await the block may no longer be in the document.
    it("discards the component when the block was detached during the render", async () => {
        const renderer = makeRenderer({ render: (block) => void block.remove() });
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await settle();

        expect(renderer.discard).toHaveBeenCalledTimes(1);
        expect(block.classList.contains("is-unloaded")).toBe(true);
        expect(block.childElementCount).toBe(0);
    });

    describe("in the order the reader meets it", () => {
        /**
         * An 800px pane at the top of the page, and a block that goes from
         * `top` to `bottom`.
         */
        function placed(top: number, bottom: number) {
            const root = makeScrollRoot(800);
            root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
            const { manager, renderer } = makeManager(makeRenderer(), () => 500, root);
            const block = manager.add(FILE);
            block.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
            document.body.appendChild(block);
            return { manager, renderer, block };
        }

        const orderOf = (renderer: ReturnType<typeof makeRenderer>) => renderer.renderInto.mock.calls[0]![3];

        it("draws a note the reader comes up into from its end", async () => {
            const { renderer, block } = placed(-9000, 300);
            fire(observers.render, block, true);
            await settle();
            expect(orderOf(renderer)).toBe("from-end");
        });

        // A jump goes to the note's start. Rendered from its end, it ended up
        // with the scroll kept on the end's text, 130–286 px past its title.
        it("draws a note a jump readies from its start, wherever it is", async () => {
            const { manager, renderer, block } = placed(-9000, 300);
            manager.render(block);
            await settle();
            expect(orderOf(renderer)).toBe("from-start");
        });

        it("draws a note from its start where a jump readies it while it waits to be drawn as met", async () => {
            const { manager, renderer, block } = placed(-9000, 300);
            fire(observers.render, block, true);
            manager.render(block);
            await settle();
            expect(orderOf(renderer)).toBe("from-start");
        });

        it("draws a note from its start where it comes into view while a jump's render of it waits", async () => {
            const { manager, renderer, block } = placed(-9000, 300);
            manager.render(block);
            fire(observers.render, block, true);
            await settle();
            expect(orderOf(renderer)).toBe("from-start");
        });

        it("draws a note the reader comes back up into from its end, after a jump drew it", async () => {
            const { manager, renderer, block } = placed(-9000, 300);
            manager.render(block);
            await settle();
            fire(observers.unload, block, false);
            await still();
            fire(observers.render, block, true);
            await settle();
            expect(renderer.renderInto.mock.calls[1]![3]).toBe("from-end");
        });

        it("draws a note the reader comes down into from its start", async () => {
            const { renderer, block } = placed(500, 9800);
            fire(observers.render, block, true);
            await settle();
            expect(orderOf(renderer)).toBe("from-start");
        });

        it("draws a note whose middle is the pane's from its start", async () => {
            const { renderer, block } = placed(-400, 1200);
            fire(observers.render, block, true);
            await settle();
            expect(orderOf(renderer)).toBe("from-start");
        });

        it("compares a note's middle with that of a pane lower in the window", async () => {
            const root = makeScrollRoot(800);
            root.getBoundingClientRect = () => ({ top: 100, bottom: 900 }) as DOMRect;
            const { manager, renderer } = makeManager(makeRenderer(), () => 500, root);
            const block = manager.add(FILE);
            block.getBoundingClientRect = () => ({ top: -500, bottom: 400 }) as DOMRect;
            document.body.appendChild(block);

            fire(observers.render, block, true);
            await settle();

            expect(orderOf(renderer)).toBe("from-end");
        });

        it("lays a note drawn from its end out from its top again as it lands", async () => {
            const { block } = placed(-9000, 300);

            fire(observers.render, block, true);
            await settle();

            expect(block.hasClass("is-unloaded")).toBe(false);
            expect(block.hasClass("is-drawing-from-end")).toBe(false);
        });

        it("has the anchor read nothing for a note drawn whole, though met from below", async () => {
            const readPlace = vi.spyOn(ScrollAnchor.prototype, "readPlace");
            onTestFinished(() => readPlace.mockRestore());
            const { renderer, block } = placed(-9000, 300);
            renderer.renderInto.mockImplementationOnce(async (drawing: HTMLElement) => {
                drawing.createDiv({ cls: "daily-note-content" });
                return { component: new Component(), footer: Promise.resolve() };
            });

            fire(observers.render, block, true);
            await settle();

            expect(readPlace).not.toHaveBeenCalled();
        });

        // Nothing scrolled or changed size while it rendered, and the place was
        // last read over an empty block.
        it("has the anchor read its place over what it drew, before it lands", async () => {
            const readPlace = vi.spyOn(ScrollAnchor.prototype, "readPlace");
            onTestFinished(() => readPlace.mockRestore());
            const { block } = placed(-9000, 300);
            const drawing: boolean[] = [];
            readPlace.mockImplementation(() => void drawing.push(block.hasClass("is-drawing-from-end")));

            fire(observers.render, block, true);
            await settle();

            expect(drawing).toEqual([true]);
        });

        // By then its top may be in the pane, and the pane's top in the note
        // above.
        it("has the anchor read its place in the note it drew", async () => {
            const readPlace = vi.spyOn(ScrollAnchor.prototype, "readPlace");
            onTestFinished(() => readPlace.mockRestore());
            const { block } = placed(-9000, 300);

            fire(observers.render, block, true);
            await settle();

            expect(readPlace.mock.calls[0]![0]).toBe(block);
        });

        it("has the anchor read nothing for a note drawn from its start", async () => {
            const readPlace = vi.spyOn(ScrollAnchor.prototype, "readPlace");
            onTestFinished(() => readPlace.mockRestore());
            const { block } = placed(500, 9800);

            fire(observers.render, block, true);
            await settle();

            expect(readPlace).not.toHaveBeenCalled();
        });

        it("unmarks a note given up mid-draw", async () => {
            const { renderer, block } = placed(-9000, 300);
            renderer.renderInto.mockImplementationOnce(async (drawing: HTMLElement) => {
                drawing.addClass("is-drawing-from-end");
                return null;
            });

            fire(observers.render, block, true);
            await settle();

            expect(block.hasClass("is-drawing-from-end")).toBe(false);
            expect(block.hasClass("is-unloaded")).toBe(true);
        });
    });
});

/**
 * While scrolling, iOS draws a resize one frame before it reports it. So a
 * note's height only changes where the anchor is told in the same task (ADR
 * 0013).
 */
describe("NoteWindowManager pins a rendered note", () => {
    const pinned = (block: HTMLElement) => block.style.getPropertyValue("--daily-note-pinned-height");
    let told: MockInstance<() => void>;

    beforeEach(() => {
        told = vi.spyOn(ScrollAnchor.prototype, "resized");
    });
    afterEach(() => document.body.empty());

    /**
     * Renders FILE. `measure` sees the block as laid out, pinned or not.
     */
    async function rendered(measure: (block: HTMLElement) => number, heights = new NoteHeights()) {
        const setup = makeManager(makeRenderer(), () => measure(block), undefined, heights);
        const block = setup.manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return { ...setup, block };
    }

    /**
     * The natural height without a pin; otherwise the pinned height.
     */
    const natural = (height: () => number) => (block: HTMLElement) => parseFloat(pinned(block)) || height();

    it("pins it at the height it lays out at, and tells the anchor in that task", async () => {
        const { block } = await rendered(natural(() => 640));

        expect(pinned(block)).toBe("640px");
        expect(block.hasClass("is-pinned")).toBe(true);
        expect(told).toHaveBeenCalledOnce();
    });

    it("takes a new height only as its content reports a resize, telling the anchor at once", async () => {
        let height = 640;
        const { block } = await rendered(natural(() => height));
        told.mockClear();

        height = 900;
        expect(pinned(block)).toBe("640px");
        resize(block.lastElementChild as HTMLElement);

        expect(pinned(block)).toBe("900px");
        expect(told).toHaveBeenCalledOnce();
    });

    // When told first, the anchor read the place where the grown note was still
    // clipped, in the note below it.
    it("tells the anchor of a resize inside it once it is re-pinned", async () => {
        let height = 640;
        const { block } = await rendered(natural(() => height));
        const seen: string[] = [];
        told.mockImplementation(() => void seen.push(pinned(block)));
        height = 900;

        resize(block.lastElementChild as HTMLElement);

        expect(seen).toEqual(["900px"]);
    });

    // Its pinned height hides a change inside it from anything watching the
    // note's size.
    it("tells the anchor of a resize inside it that its pin holds", async () => {
        const { block } = await rendered(natural(() => 640));
        told.mockClear();

        resize(block.lastElementChild as HTMLElement);

        expect(pinned(block)).toBe("640px");
        expect(told).toHaveBeenCalledOnce();
    });

    it("watches what it rendered with one ResizeObserver, the anchor's included", async () => {
        // No built-in scroll anchoring, as on iOS, so the anchor attaches its
        // own observer.
        vi.stubGlobal("CSS", { supports: () => false });
        const { block } = await rendered(natural(() => 640));

        const watching = resizeObserves.filter((observe) =>
            observe.mock.calls.some(([el]) => el === block.lastElementChild)
        );
        expect(watching).toHaveLength(1);
    });

    // A height a Base set with its hold is told at once, not by a report one
    // frame late.
    it("takes a new height as a Base in it says it set one, telling the anchor at once", async () => {
        let height = 640;
        const { manager, block } = await rendered(natural(() => height));
        const slot = block.createDiv();
        told.mockClear();

        height = 900;
        manager.onBaseResized(slot);

        expect(pinned(block)).toBe("900px");
        expect(told).toHaveBeenCalledOnce();
    });

    describe("at the pane's top as it scrolls", () => {
        /**
         * Renders FILE at the pane's top, with its content ending `end()` below
         * its top.
         */
        async function atTop(height: () => number, end: () => number) {
            const setup = await rendered(natural(height));
            setup.stream.append(setup.block);
            setup.block.getBoundingClientRect = () => ({ top: -100, bottom: 540 }) as DOMRect;
            const content = setup.block.lastElementChild as HTMLElement;
            content.getBoundingClientRect = () => ({ bottom: end() - 100 }) as DOMRect;
            setup.manager.onScroll();
            return setup;
        }

        // A Base filling in moved the text below it inside the pin, and the
        // report that fixes the note's height again comes after this scroll. If
        // the place were read first, it would be in the moved text, and the
        // note below would drop.
        it("re-pins it before the anchor reads the place, once its content ends elsewhere", async () => {
            let height = 640;
            let end = 600;
            const { manager, block } = await atTop(
                () => height,
                () => end
            );
            const seen: string[] = [];
            told.mockImplementation(() => void seen.push(`told at ${pinned(block)}`));
            const read = vi.spyOn(ScrollAnchor.prototype, "onScroll").mockImplementation(() => void seen.push("read"));

            height = 1243;
            end = 1203;
            manager.onScroll();
            read.mockRestore();

            expect(seen).toEqual(["told at 1243px", "read"]);
        });

        it("reads nothing on a scroll that comes once it is detached", async () => {
            const { manager } = await atTop(
                () => 640,
                () => 600
            );
            manager.detach();

            expect(() => manager.onScroll()).not.toThrow();
        });

        it("leaves it pinned while its content ends where it did, however far it scrolled", async () => {
            const measured = vi.fn(() => 640);
            const { manager, block } = await atTop(measured, () => 600);
            measured.mockClear();

            block.getBoundingClientRect = () => ({ top: -150, bottom: 490 }) as DOMRect;
            (block.lastElementChild as HTMLElement).getBoundingClientRect = () => ({ bottom: 450 }) as DOMRect;
            manager.onScroll();

            expect(measured).not.toHaveBeenCalled();
        });

        it("measures nothing once it unloaded", async () => {
            const measured = vi.fn(() => 640);
            const { manager, block } = await atTop(measured, () => 600);
            fire(observers.unload, block, false);
            await still();
            measured.mockClear();

            manager.onScroll();

            expect(measured).not.toHaveBeenCalled();
        });

        // In a hidden tab, a pin at zero would make the note disappear.
        it("measures nothing once it laid out at nothing and let go of its pin", async () => {
            let height = 640;
            let end = 600;
            const measured = vi.fn(() => height);
            const { manager, block } = await atTop(measured, () => end);
            height = 0;
            resize(block.lastElementChild as HTMLElement);
            measured.mockClear();

            end = 900;
            manager.onScroll();

            expect(measured).not.toHaveBeenCalled();
        });
    });

    // A hold is a min-height, which the pin hides, so its release only shows at
    // the re-pin.
    it("takes its own height once the reader touches it out of its hold", async () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const heldOr = (height: number) => (block: HTMLElement) =>
            block.style.getPropertyValue("--daily-note-held-height") ? 812 : height;
        const { manager, block } = await rendered(heldOr(640), heights);
        expect(pinned(block)).toBe("812px");

        manager.onTouch(block.firstElementChild);

        expect(pinned(block)).toBe("640px");
    });

    it("tells the anchor a hold let go once the block is re-pinned", async () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const heldOr = (height: number) => (block: HTMLElement) =>
            block.style.getPropertyValue("--daily-note-held-height") ? 812 : height;
        const { manager, block } = await rendered(heldOr(640), heights);
        const pins: string[] = [];
        const released = vi
            .spyOn(ScrollAnchor.prototype, "released")
            .mockImplementation((b) => void pins.push(pinned(b)));
        onTestFinished(() => released.mockRestore());

        manager.onTouch(block.firstElementChild);

        expect(released).toHaveBeenCalledExactlyOnceWith(block);
        expect(pins).toEqual(["640px"]);
    });

    it("tells the anchor nothing when a hold lets go at the height it held", async () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const { manager, block } = await rendered(() => 812, heights);
        told.mockClear();

        manager.onTouch(block.firstElementChild);

        expect(pinned(block)).toBe("812px");
        expect(told).not.toHaveBeenCalled();
    });

    it("keeps the pin of a hidden note whose hold lets go", async () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const { manager, block } = await rendered(
            (b) => (b.hasClass("is-far") ? 0 : b.style.getPropertyValue("--daily-note-held-height") ? 812 : 640),
            heights
        );
        fire(observers.hide, block, false);

        manager.onTouch(block.firstElementChild);

        expect(pinned(block)).toBe("812px");
    });

    it("takes its own height when the hold's limit passes", async () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const { block } = await rendered(
            (b) => (b.style.getPropertyValue("--daily-note-held-height") ? 812 : 640),
            heights
        );
        // It keeps changing size, so it never stops changing.
        for (let t = 0; t < HOLD_LIMIT_MS; t += SETTLE_MS / 2) {
            resize(block.lastElementChild as HTMLElement);
            await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
        }

        expect(pinned(block)).toBe("640px");
    });

    it("stays pinned while it re-renders in place, then takes its new height", async () => {
        let height = 640;
        const pinnedWhileRendering: string[] = [];
        const renderer = makeRenderer({ render: (b) => void pinnedWhileRendering.push(pinned(b)) });
        const { manager } = makeManager(renderer, () => parseFloat(pinned(block)) || height);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        height = 700;

        await manager.refresh(block);

        expect(pinnedWhileRendering).toEqual(["", "640px"]);
        expect(pinned(block)).toBe("700px");
    });

    // Half rendered, it would be pinned too short, then grow back as the render
    // finished.
    it("keeps the pin through a resize reported while it re-renders", async () => {
        let height = 640;
        let mid: () => void = () => {};
        const renderer = makeRenderer({ render: () => mid() });
        const { manager } = makeManager(renderer, () => parseFloat(pinned(block)) || height);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        const pinnedMidRender: string[] = [];
        mid = () => {
            height = 100;
            resize(block);
            pinnedMidRender.push(pinned(block));
            height = 700;
        };

        await manager.refresh(block);

        expect(pinnedMidRender).toEqual(["640px"]);
        expect(pinned(block)).toBe("700px");
    });

    it("ignores a resize reported for a note it no longer has", async () => {
        const { manager, block } = await rendered(natural(() => 640));
        manager.remove(block);
        told.mockClear();

        resize(block);
        resize(document.body);

        expect(told).not.toHaveBeenCalled();
    });

    // It is unloaded or re-rendered next. Pinning it short now would shift the
    // stream for nothing.
    it("keeps its height as a hold stops with the note", async () => {
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const { manager, block } = await rendered(
            (b) => (b.style.getPropertyValue("--daily-note-held-height") ? 812 : 640),
            heights
        );
        told.mockClear();

        manager.remove(block);

        expect(told).not.toHaveBeenCalled();
        expect(pinned(block)).toBe("812px");
    });

    it("lets go of the pin as it unloads, reserving its height as a placeholder", async () => {
        const { block } = await rendered(natural(() => 640));

        fire(observers.unload, block, false);
        await still();

        expect(pinned(block)).toBe("");
        expect(block.hasClass("is-pinned")).toBe(false);
        expect(placeholderHeight(block)).toBe("640px");
    });

    // In a hidden tab nothing is laid out, and a pin at zero would make the
    // note disappear.
    it("pins nothing while the block lays out at nothing", async () => {
        const { block } = await rendered(() => 0);

        expect(block.hasClass("is-pinned")).toBe(false);
        expect(pinned(block)).toBe("");
    });
});

describe("NoteWindowManager unload", () => {
    async function rendered(measure = () => 500) {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer, measure);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return { manager, renderer, block };
    }

    it("empties the block and pins its measured height", async () => {
        const { block } = await rendered(() => 640);

        fire(observers.unload, block, false);
        await still();

        expect(block.childElementCount).toBe(0);
        expect(placeholderHeight(block)).toBe("640px");
        expect(block.classList.contains("is-unloaded")).toBe(true);
    });

    it("discards the note's component, not just its DOM", async () => {
        const { renderer, block } = await rendered();
        fire(observers.unload, block, false);
        await still();
        expect(renderer.discard).toHaveBeenCalledTimes(1);
    });

    it("does nothing to an already unloaded block", async () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);

        fire(observers.unload, block, false);

        expect(renderer.discard).not.toHaveBeenCalled();
        expect(placeholderHeight(block)).toBe(UNMEASURED);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores a still-intersecting entry", async () => {
        const { renderer, block } = await rendered();
        fire(observers.unload, block, true);
        expect(renderer.discard).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Unloading waits for scrolling to stop
// ---------------------------------------------------------------------------

/**
 * On iOS, unloading a note while scrolling stops the scroll (D-032).
 */
describe("NoteWindowManager.scrollToTop", () => {
    it("glides the pane to its top", () => {
        const { manager, scrollRoot } = makeManager();
        scrollRoot.scrollTo = vi.fn();

        manager.scrollToTop();

        expect(scrollRoot.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });

    it("tells the anchor where the scroll is headed first", () => {
        const headForTop = vi.spyOn(ScrollAnchor.prototype, "headForTop");
        const { manager, scrollRoot } = makeManager();
        scrollRoot.scrollTo = vi.fn(() => expect(headForTop).toHaveBeenCalledOnce());

        manager.scrollToTop();

        expect(scrollRoot.scrollTo).toHaveBeenCalledOnce();
    });

    it("does nothing before the view is attached", () => {
        const manager = new NoteWindowManager(makeRenderer() as never, makeQueue(), new NoteHeights(), () => LAYOUT);
        expect(() => manager.scrollToTop()).not.toThrow();
    });
});

describe("NoteWindowManager while scrolling", () => {
    async function rendered() {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return { manager, renderer, block };
    }

    it("keeps a block that left the margin rendered until the scroll is still", async () => {
        const { block } = await rendered();

        fire(observers.unload, block, false);
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(isRendered(block)).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        expect(isRendered(block)).toBe(false);
    });

    it("waits again after every scroll", async () => {
        const { manager, block } = await rendered();

        fire(observers.unload, block, false);
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        manager.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);
        expect(isRendered(block)).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        expect(isRendered(block)).toBe(false);
    });

    it("keeps a block that came back before the scroll stopped", async () => {
        const { renderer, block } = await rendered();

        fire(observers.unload, block, false);
        fire(observers.unload, block, true);
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

        expect(isRendered(block)).toBe(true);
        expect(renderer.discard).not.toHaveBeenCalled();
    });

    it("unloads every block that left, once the scroll is still", async () => {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const blocks = [FILE, new TFile("Notes/2025-01-02.md")].map((file) => manager.add(file));
        document.body.append(...blocks);
        for (const block of blocks) fire(observers.render, block, true);
        await settle();

        for (const block of blocks) fire(observers.unload, block, false);
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

        expect(blocks.map(isRendered)).toEqual([false, false]);
    });

    it("forgets a waiting block that was removed", async () => {
        const { manager, renderer, block } = await rendered();

        fire(observers.unload, block, false);
        manager.remove(block);
        renderer.discard.mockClear();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

        expect(renderer.discard).not.toHaveBeenCalled();
    });

    it("stops waiting on detach", async () => {
        const { manager, renderer, block } = await rendered();

        fire(observers.unload, block, false);
        manager.detach();
        renderer.discard.mockClear();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

        expect(renderer.discard).not.toHaveBeenCalled();
    });

    // The stream resets the window on its own, and its frames and scroll boxes
    // wait on the same clock.
    it("keeps what the stream waits for on its clock across a detach", async () => {
        const { manager } = await rendered();
        const loadFrames = vi.fn();
        manager.clock.whenStill(loadFrames);

        manager.detach();
        await still();

        expect(loadFrames).toHaveBeenCalledOnce();
    });

    // A note saved while it waits is re-rendered. During a refresh, there is
    // nothing to unload.
    it("unloads a block whose refresh was in flight on the next still scroll", async () => {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        fire(observers.unload, block, false);
        renderer.renderInto.mockImplementationOnce(async (el: HTMLElement) => {
            await new Promise((resolve) => setTimeout(resolve, SCROLL_IDLE_MS * 2));
            el.createDiv({ cls: "daily-note-content" });
            return { component: new Component(), footer: Promise.resolve() };
        });
        void manager.refresh(block);
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS * 2);
        expect(isRendered(block)).toBe(true);

        manager.onScroll();
        await still();
        expect(isRendered(block)).toBe(false);
    });

    it("sets no unload timer for a scroll with nothing waiting", async () => {
        const { manager } = await rendered();
        manager.onScroll();
        // The only timer left remembers the rendered notes' heights.
        expect(vi.getTimerCount()).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Hiding a note far away
// ---------------------------------------------------------------------------

/**
 * Past the hiding distance, a note leaves the layout at once, even mid-glide,
 * because WebKit stalls for longer the more is laid out (ADR 0023). It keeps
 * its content and its pinned height, so its height does not change. Unloading
 * it waits until scrolling stops past the unloading distance (D-032).
 */
describe("NoteWindowManager hides a far note", () => {
    const pinned = (block: HTMLElement) => block.style.getPropertyValue("--daily-note-pinned-height");
    const isHidden = (block: HTMLElement) => block.hasClass("is-far");
    /**
     * A block's height is its pinned height. Without one, a hidden note's
     * content takes no space.
     */
    const laidOut = (block: HTMLElement) => parseFloat(pinned(block)) || (isHidden(block) ? 0 : 640);

    async function rendered(measure: (el: HTMLElement) => number = laidOut) {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer, measure);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return { manager, renderer, block };
    }

    afterEach(() => document.body.empty());

    it("hides a note past the hide margin at once, without waiting for the scroll to stop", async () => {
        const { block } = await rendered();

        fire(observers.hide, block, false);

        expect(isHidden(block)).toBe(true);
        expect(isRendered(block)).toBe(true);
    });

    it("keeps its content, its component and its pin", async () => {
        const { renderer, block } = await rendered();

        fire(observers.hide, block, false);
        await still();

        expect(block.querySelector(".daily-note-content")).not.toBeNull();
        expect(renderer.discard).not.toHaveBeenCalled();
        expect(pinned(block)).toBe("640px");
    });

    it("tells the anchor nothing: its height did not change", async () => {
        const { block } = await rendered();
        const resized = vi.spyOn(ScrollAnchor.prototype, "resized");
        resized.mockClear();

        fire(observers.hide, block, false);
        resize(block);

        expect(resized).not.toHaveBeenCalled();
        expect(pinned(block)).toBe("640px");
    });

    it("shows it again within the render margin, drawing nothing anew", async () => {
        const { renderer, block } = await rendered();

        fire(observers.hide, block, false);
        fire(observers.render, block, true);
        await settle();

        expect(isHidden(block)).toBe(false);
        expect(renderer.renderInto).toHaveBeenCalledTimes(1);
    });

    // A jump or search step asks for a note's content directly.
    it("shows it when asked to render it", async () => {
        const { manager, renderer, block } = await rendered();

        fire(observers.hide, block, false);
        manager.render(block);
        await settle();

        expect(isHidden(block)).toBe(false);
        expect(renderer.renderInto).toHaveBeenCalledTimes(1);
    });

    it("empties a hidden note past the unload margin once the scroll is still", async () => {
        const { renderer, block } = await rendered();

        fire(observers.hide, block, false);
        fire(observers.unload, block, false);
        await still();

        expect(isRendered(block)).toBe(false);
        expect(isHidden(block)).toBe(false);
        expect(renderer.discard).toHaveBeenCalledTimes(1);
        expect(placeholderHeight(block)).toBe("640px");
    });

    it("leaves a note shown while it stays inside the hide margin", async () => {
        const { block } = await rendered();
        fire(observers.hide, block, true);
        expect(isHidden(block)).toBe(false);
    });

    it("does nothing to an unloaded note past the hide margin", () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);

        fire(observers.hide, block, false);

        expect(isHidden(block)).toBe(false);
        expect(placeholderHeight(block)).toBe(UNMEASURED);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores blocks it does not own", () => {
        const { manager } = makeManager();
        const stranger = document.createElement("div");

        fire(observers.hide, stranger, false);
        fire(observers.unload, stranger, false);
        manager.render(stranger);

        expect(isHidden(stranger)).toBe(false);
    });

    // Without a pin, its height is its content's, so hiding the content would
    // collapse it.
    it("hides nothing in a note laid out at nothing, and empties it once the scroll is still", async () => {
        const { block } = await rendered(() => 0);

        fire(observers.hide, block, false);
        expect(isHidden(block)).toBe(false);

        await still();
        expect(isRendered(block)).toBe(false);
    });

    it("re-estimates a hidden note edited meanwhile, emptied at the height it was hidden at", async () => {
        const { manager, renderer, block } = await rendered();
        fire(observers.hide, block, false);

        await manager.refresh(block);

        expect(isRendered(block)).toBe(false);
        expect(isHidden(block)).toBe(false);
        expect(renderer.renderInto).toHaveBeenCalledTimes(1);
        expect(renderer.discard).toHaveBeenCalledTimes(1);
        expect(placeholderHeight(block)).toBe("640px");
    });

    describe("that flew past mid-render", () => {
        function makeSlowRenderer() {
            const renderer = makeRenderer();
            renderer.renderInto = vi.fn(async (block: HTMLElement) => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                block.createDiv({ cls: "daily-note-content" });
                return { component: new Component(), footer: Promise.resolve() };
            });
            return renderer;
        }

        async function landing(...passed: ("hide" | "unload")[]) {
            const renderer = makeSlowRenderer();
            const { manager } = makeManager(renderer, laidOut);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await vi.advanceTimersByTimeAsync(1); // into the render
            for (const observer of passed) fire(observers[observer], block, false);
            await vi.advanceTimersByTimeAsync(50);
            return { renderer, block };
        }

        it("hides it as it lands, and keeps it", async () => {
            const { renderer, block } = await landing("hide");
            expect(isHidden(block)).toBe(true);

            await still();
            expect(renderer.discard).not.toHaveBeenCalled();
        });

        it("empties it once the scroll is still where it was reported past the unload margin alone", async () => {
            const { renderer, block } = await landing("unload");

            await still();
            expect(renderer.discard).toHaveBeenCalledTimes(1);
            expect(isRendered(block)).toBe(false);
        });

        it("keeps it where it came back inside the unload margin before it landed", async () => {
            const renderer = makeSlowRenderer();
            const { manager } = makeManager(renderer, laidOut);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await vi.advanceTimersByTimeAsync(1); // into the render
            fire(observers.unload, block, false);
            fire(observers.unload, block, true);
            fire(observers.hide, block, false);
            await vi.advanceTimersByTimeAsync(50);

            await still();
            expect(isHidden(block)).toBe(true);
            expect(renderer.discard).not.toHaveBeenCalled();
        });

        it("empties it once the scroll is still where it passed the unload margin too", async () => {
            const { renderer, block } = await landing("hide", "unload");

            await still();
            expect(renderer.discard).toHaveBeenCalledTimes(1);
            expect(isRendered(block)).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// Fast scrolling
// ---------------------------------------------------------------------------

/**
 * A flick can carry a block past both distances between two frames, so the
 * request to unload it arrives while the render is still waiting for its
 * Markdown. An IntersectionObserver only reports changes, so that request is
 * the only one the block gets until it comes back into view.
 */
describe("NoteWindowManager under a fast scroll", () => {
    /**
     * Renders slowly enough that an observer entry can arrive during the
     * render.
     */
    function makeSlowRenderer() {
        const renderer = makeRenderer();
        renderer.renderInto = vi.fn(async (block: HTMLElement) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            block.createDiv({ cls: "daily-note-content" });
            return { component: new Component(), footer: Promise.resolve() };
        });
        return renderer;
    }

    const settleSlow = () => vi.advanceTimersByTimeAsync(50);

    it("leaves no rendered note behind when a block flies past mid-render", async () => {
        const renderer = makeSlowRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        fire(observers.hide, block, false);
        await settleSlow();

        expect(block.classList.contains("is-unloaded")).toBe(true);
        expect(block.querySelector(".daily-note-content")).toBeNull();
        expect(placeholderHeight(block)).toBe(UNMEASURED);
    });

    // Every vault event uses the same queue (ADR 0004), so a flick must not
    // leave it rendering notes nobody is looking at.
    it("skips the render outright when the block left before its turn came", async () => {
        const renderer = makeSlowRenderer();
        const { manager } = makeManager(renderer);
        const first = manager.add(FILE);
        const second = manager.add(new TFile("Notes/2025-01-02.md"));
        document.body.append(first, second);

        fire(observers.render, first, true);
        fire(observers.render, second, true);
        // Both go past while the first one is still rendering.
        fire(observers.hide, second, false);
        await settleSlow();

        expect(renderer.renderInto).toHaveBeenCalledTimes(1);
        expect(second.classList.contains("is-unloaded")).toBe(true);
    });

    // The request to unload arrives after renderInto has started, not while it
    // is queued: the Markdown is already being read and cannot be skipped.
    it("unloads a block that left while its markdown was in flight, once the scroll is still", async () => {
        const renderer = makeSlowRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await vi.advanceTimersByTimeAsync(1); // into the render
        fire(observers.hide, block, false);
        fire(observers.unload, block, false);
        await settleSlow();
        expect(renderer.discard).not.toHaveBeenCalled();

        await still();
        expect(renderer.renderInto).toHaveBeenCalledTimes(1);
        expect(renderer.discard).toHaveBeenCalledTimes(1);
        expect(block.classList.contains("is-unloaded")).toBe(true);
    });

    /**
     * A long note's render, which asks between slices whether it is still
     * wanted (ADR 0020).
     */
    function makeSlicedRenderer() {
        const renderer = makeRenderer();
        renderer.renderInto = vi.fn(async (block: HTMLElement, _file: TFile, goOn = () => Promise.resolve(true)) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            if (!(await goOn(new Component()))) {
                block.empty();
                return null;
            }
            block.createDiv({ cls: "daily-note-content" });
            return { component: new Component(), footer: Promise.resolve() };
        });
        return renderer;
    }

    // Scrolling past a long note left it drawing for a second after it had
    // gone, which delayed the note the glide stopped on.
    it("stops drawing a note that left mid-render, leaving it unloaded", async () => {
        const renderer = makeSlicedRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await vi.advanceTimersByTimeAsync(1); // into the render
        fire(observers.hide, block, false);
        await settleSlow();

        expect(block.classList.contains("is-unloaded")).toBe(true);
        expect(block.querySelector(".daily-note-content")).toBeNull();
        expect(placeholderHeight(block)).toBe(UNMEASURED);

        fire(observers.render, block, true);
        await settleSlow();
        expect(renderer.renderInto).toHaveBeenCalledTimes(2);
        expect(block.querySelector(".daily-note-content")).not.toBeNull();
    });

    it("draws on a note that came back into view before its next slice", async () => {
        const renderer = makeSlicedRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await vi.advanceTimersByTimeAsync(1);
        fire(observers.hide, block, false);
        fire(observers.render, block, true);
        await settleSlow();

        expect(block.querySelector(".daily-note-content")).not.toBeNull();
        expect(block.classList.contains("is-unloaded")).toBe(false);
    });

    // The observers only report a change, so a block left blank on screen gets
    // no second event. It would stay empty until the reader scrolls again.
    it("keeps a block that came back into view while its render was in flight", async () => {
        const renderer = makeSlowRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await vi.advanceTimersByTimeAsync(1); // into the render
        fire(observers.hide, block, false);
        fire(observers.render, block, true);
        await settleSlow();

        expect(block.classList.contains("is-unloaded")).toBe(false);
        expect(block.classList.contains("is-far")).toBe(false);
        expect(block.querySelector(".daily-note-content")).not.toBeNull();
        expect(renderer.renderInto).toHaveBeenCalledOnce();
    });

    it("ignores an unload for a block it does not own", () => {
        makeManager();
        expect(() => fire(observers.hide, document.createElement("div"), false)).not.toThrow();
    });

    it("renders normally again once the block comes back", async () => {
        const renderer = makeSlowRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        fire(observers.hide, block, false);
        await settleSlow();

        fire(observers.render, block, true);
        await settleSlow();

        expect(block.classList.contains("is-unloaded")).toBe(false);
        expect(block.querySelector(".daily-note-content")).not.toBeNull();
    });
});

describe("NoteWindowManager draws the notes on screen first", () => {
    const SLICES = 3;
    /** Every slice drawn, in order, named by its note's path. */
    let drawn: string[];

    /**
     * A long note draws `SLICES` slices, and asks between them whether to go
     * on. Any other note draws one.
     */
    function makeLongNoteRenderer(longPath: string) {
        const renderer = makeRenderer();
        renderer.renderInto = vi.fn(async (block: HTMLElement, file: TFile, goOn = () => Promise.resolve(true)) => {
            const slices = file.path === longPath ? SLICES : 1;
            for (let i = 0; i < slices; i++) {
                if (i > 0 && !(await goOn(new Component()))) {
                    block.empty();
                    return null;
                }
                await new Promise((resolve) => setTimeout(resolve, 10));
                drawn.push(file.path);
            }
            block.createDiv({ cls: "daily-note-content" });
            return { component: new Component(), footer: Promise.resolve() };
        });
        return renderer;
    }

    const LONG = new TFile("Notes/2025-01-01.md");
    const SHORT = new TFile("Notes/2025-01-02.md");

    function setUp() {
        drawn = [];
        const renderer = makeLongNoteRenderer(LONG.path);
        const { manager } = makeManager(renderer);
        const long = manager.add(LONG);
        const short = manager.add(SHORT);
        document.body.append(long, short);
        onTestFinished(() => manager.detach());
        return { renderer, long, short };
    }

    const drawAll = () => vi.advanceTimersByTimeAsync(100);

    // Scrolling to the top past a long note left it within the drawing
    // distance, and the newest note waited about 0.3 s on an iPhone for it to
    // finish drawing.
    it("draws a note that came on screen between a nearby long note's slices, then the rest of it", async () => {
        const { renderer, long, short } = setUp();
        fire(observers.render, long, true);
        await vi.advanceTimersByTimeAsync(5); // into its first slice
        fire(observers.render, short, true);
        fire(observers.screen, short, true);
        await drawAll();

        expect(drawn).toEqual([LONG.path, SHORT.path, LONG.path, LONG.path]);
        expect(renderer.renderInto).toHaveBeenCalledTimes(2);
        expect(isRendered(long)).toBe(true);
        expect(isRendered(short)).toBe(true);
    });

    it("keeps drawing a long note on screen itself", async () => {
        const { long, short } = setUp();
        fire(observers.render, long, true);
        fire(observers.screen, long, true);
        await vi.advanceTimersByTimeAsync(5);
        fire(observers.render, short, true);
        fire(observers.screen, short, true);
        await drawAll();

        expect(drawn).toEqual([LONG.path, LONG.path, LONG.path, SHORT.path]);
    });

    it("waits its turn for a note only near the screen", async () => {
        const { long, short } = setUp();
        fire(observers.render, long, true);
        await vi.advanceTimersByTimeAsync(5);
        fire(observers.render, short, true);
        await drawAll();

        expect(drawn).toEqual([LONG.path, LONG.path, LONG.path, SHORT.path]);
    });

    it("waits its turn for a note that left the screen before the next slice", async () => {
        const { long, short } = setUp();
        fire(observers.render, long, true);
        await vi.advanceTimersByTimeAsync(5);
        fire(observers.render, short, true);
        fire(observers.screen, short, true);
        fire(observers.screen, short, false);
        await drawAll();

        expect(drawn).toEqual([LONG.path, LONG.path, LONG.path, SHORT.path]);
    });

    it("forgets the notes on screen once removed", async () => {
        const { manager } = makeManager(makeLongNoteRenderer(LONG.path));
        drawn = [];
        const long = manager.add(LONG);
        const short = manager.add(SHORT);
        document.body.append(long, short);
        fire(observers.render, long, true);
        await vi.advanceTimersByTimeAsync(5);
        fire(observers.render, short, true);
        fire(observers.screen, short, true);
        manager.remove(short);
        await drawAll();

        expect(drawn).toEqual([LONG.path, LONG.path, LONG.path, SHORT.path]);
        manager.detach();
    });
});

// ---------------------------------------------------------------------------
// Re-rendering after a save
// ---------------------------------------------------------------------------

describe("NoteWindowManager.refresh", () => {
    it("re-renders a loaded block from scratch", async () => {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        await manager.refresh(block);

        expect(renderer.renderInto).toHaveBeenCalledTimes(2);
        expect(renderer.discard).toHaveBeenCalledTimes(1);
        expect(block.querySelectorAll(".daily-note-content")).toHaveLength(1);
    });

    // A note saved somewhere else, for example by sync, while it scrolls into
    // view.
    it("draws the note once when it comes into view mid-refresh", async () => {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        renderer.renderInto.mockImplementationOnce(async (el: HTMLElement) => {
            fire(observers.render, block, true);
            await new Promise((resolve) => setTimeout(resolve, 100));
            el.createDiv({ cls: "daily-note-content" });
            return { component: new Component(), footer: Promise.resolve() };
        });
        const refreshed = manager.refresh(block);
        fire(observers.render, block, true);
        await vi.advanceTimersByTimeAsync(100);
        await refreshed;

        expect(block.querySelectorAll(".daily-note-content")).toHaveLength(1);
        expect(renderer.renderInto).toHaveBeenCalledTimes(2);
    });

    it("stops watching what it drew before re-rendering it", async () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        const drawn = block.firstElementChild;

        await manager.refresh(block);

        expect(lastResizeUnobserve).toHaveBeenCalledWith(drawn);
    });

    it("leaves the block of a note deleted mid-refresh empty", async () => {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        renderer.renderInto.mockResolvedValueOnce(null);
        await manager.refresh(block);

        expect(block.childElementCount).toBe(0);
    });

    it("unloads a note that left view mid-refresh, and draws it again on its return", async () => {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        renderer.renderInto.mockImplementationOnce(async (el: HTMLElement) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            el.createDiv({ cls: "daily-note-content" });
            return { component: new Component(), footer: Promise.resolve() };
        });
        const refreshed = manager.refresh(block);
        fire(observers.unload, block, false);
        await vi.advanceTimersByTimeAsync(100);
        await refreshed;
        manager.onScroll();
        await still();
        expect(isRendered(block)).toBe(false);

        fire(observers.render, block, true);
        await settle();
        expect(isRendered(block)).toBe(true);
    });

    // On an iPhone, a test that deleted the notes it wrote threw once scrolling
    // stopped: a note re-rendering as it was deleted was queued to unload with
    // no window.
    describe("discards what it drew for a note that left view and was removed", () => {
        it("while it rendered", async () => {
            const renderer = makeRenderer();
            // Out of the page, a block measures nothing, so it is not pinned.
            const { manager } = makeManager(renderer, (el) => (el.isConnected ? 500 : 0));
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            const component = new Component();
            renderer.renderInto.mockImplementationOnce(async (el: HTMLElement) => {
                fire(observers.unload, block, false);
                manager.remove(block);
                block.remove();
                await new Promise((resolve) => setTimeout(resolve, 100));
                el.createDiv({ cls: "daily-note-content" });
                return { component, footer: Promise.resolve() };
            });
            const refreshed = manager.refresh(block);
            await vi.advanceTimersByTimeAsync(100);
            await refreshed;

            await still();
            // The very one: every Component here looks alike.
            expect(renderer.discarded).toContain(component);
        });

        it("while it was updated in place", async () => {
            const renderer = makeRenderer();
            const { manager } = makeManager(renderer, (el) => (el.isConnected ? 500 : 0));
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            renderer.update.mockImplementationOnce(async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return true;
            });
            const refreshed = manager.refresh(block);
            fire(observers.unload, block, false);
            manager.remove(block);
            block.remove();
            await vi.advanceTimersByTimeAsync(100);
            await refreshed;

            await still();
            expect(renderer.discard).toHaveBeenCalledTimes(1);
        });
    });

    describe("a long note updated in place", () => {
        const pinned = (block: HTMLElement) => block.style.getPropertyValue("--daily-note-pinned-height");

        it("re-renders none of it where the renderer updated it", async () => {
            const renderer = makeRenderer();
            const { manager } = makeManager(renderer);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            renderer.update.mockResolvedValueOnce(true);

            await manager.refresh(block);

            expect(renderer.update).toHaveBeenCalledWith(block, FILE, expect.any(Component));
            expect(renderer.renderInto).toHaveBeenCalledOnce();
            expect(renderer.discard).not.toHaveBeenCalled();
        });

        it("updates a note whose linked mentions are still drawing", async () => {
            const renderer = makeRenderer({ footer: () => new Promise(() => {}) });
            const { manager } = makeManager(renderer);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            renderer.update.mockResolvedValueOnce(true);

            await expect(manager.refresh(block)).resolves.toBeUndefined();
        });

        it("stays shown through one update after another", async () => {
            const renderer = makeRenderer();
            const { manager } = makeManager(renderer);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            renderer.update.mockResolvedValue(true);

            await manager.refresh(block);
            await manager.refresh(block);
            await still();

            expect(block.hasClass("is-far")).toBe(false);
            expect(isRendered(block)).toBe(true);
        });

        it("takes its new height through the pin", async () => {
            let height = 640;
            const renderer = makeRenderer();
            const { manager } = makeManager(renderer, () => parseFloat(pinned(block)) || height);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            renderer.update.mockImplementationOnce(async () => {
                height = 700;
                return true;
            });

            await manager.refresh(block);

            expect(pinned(block)).toBe("700px");
        });

        it("leaves on the next still scroll once it updated, if it left view meanwhile", async () => {
            const renderer = makeRenderer();
            const { manager } = makeManager(renderer);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            renderer.update.mockImplementationOnce(async () => {
                fire(observers.unload, block, false);
                return true;
            });

            await manager.refresh(block);
            expect(isRendered(block)).toBe(true);

            manager.onScroll();
            await still();
            expect(isRendered(block)).toBe(false);
        });

        it("stays drawn while it updates, and leaves on the next still scroll after", async () => {
            const renderer = makeRenderer();
            const { manager } = makeManager(renderer);
            const block = manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            renderer.update.mockImplementationOnce(async () => {
                await new Promise((resolve) => setTimeout(resolve, SCROLL_IDLE_MS * 2));
                return true;
            });

            fire(observers.unload, block, false);
            manager.onScroll();
            const refreshed = manager.refresh(block);
            await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS * 2);
            await refreshed;
            expect(isRendered(block)).toBe(true);

            manager.onScroll();
            await still();
            expect(isRendered(block)).toBe(false);
        });
    });

    // An empty note is rendered from the current file anyway when it comes
    // back.
    it("leaves an unloaded block alone", async () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);

        await manager.refresh(block);

        expect(renderer.renderInto).not.toHaveBeenCalled();
    });

    it("does nothing for a block it does not own", async () => {
        const { manager, renderer } = makeManager();
        await manager.refresh(document.createElement("div"));
        expect(renderer.renderInto).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe("NoteWindowManager teardown", () => {
    it("remove stops observing and frees the note", async () => {
        const renderer = makeRenderer();
        const { manager, heights } = makeManager(renderer);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        manager.remove(block);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);

        expect(observers.unobserve).toHaveBeenCalledWith(block);
        expect(renderer.discard).toHaveBeenCalledTimes(1);
        expect(heights.toJSON().heights).toEqual([]);

        manager.render(block);
        await settle();
        expect(renderer.renderInto).toHaveBeenCalledOnce();
    });

    it("remove before attach is harmless", () => {
        const manager = new NoteWindowManager(makeRenderer() as never, makeQueue(), new NoteHeights(), () => LAYOUT);
        const block = manager.add(FILE);

        expect(() => manager.remove(block)).not.toThrow();
    });

    it("remove frees an unloaded block without discarding anything", () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);

        manager.remove(block);

        expect(renderer.discard).not.toHaveBeenCalled();
    });

    it("remove is harmless for an unknown block", () => {
        const { manager, renderer } = makeManager();
        expect(() => manager.remove(document.createElement("div"))).not.toThrow();
        expect(renderer.discard).not.toHaveBeenCalled();
    });

    it("detach disconnects all four observers and frees every rendered note", async () => {
        const renderer = makeRenderer();
        const { manager } = makeManager(renderer);
        const first = manager.add(FILE);
        const second = manager.add(new TFile("Notes/2025-01-02.md"));
        document.body.append(first, second);
        fire(observers.render, first, true);
        fire(observers.render, second, true);
        await settle();

        manager.detach();

        expect(observers.disconnect).toHaveBeenCalledTimes(4);
        expect(renderer.discard).toHaveBeenCalledTimes(2);
    });

    it("leaves no timer running once detached", async () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        fire(observers.unload, block, false);
        manager.onResize();

        manager.detach();

        expect(vi.getTimerCount()).toBe(0);
    });

    // In a hidden tab a note has no size, so nothing is remembered, and there
    // is no new height to give.
    it("waits on no re-reserve for a note that settles measuring nothing", async () => {
        const root = makeScrollRoot(800);
        Object.defineProperty(root, "scrollHeight", { value: 10_000, configurable: true });
        const { manager } = makeManager(makeRenderer(), () => 0, root);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();

        // Done changing after as long as scrolling takes to stop.
        await still();

        expect(vi.getTimerCount()).toBe(0);
    });

    describe("once a note it was unloading is gone, waits on nothing for it", () => {
        /**
         * A rendered note past the unloading distance, which waits for
         * scrolling to stop.
         */
        async function leaving() {
            // Space below the pane, so new heights for the others are never
            // delayed.
            const root = makeScrollRoot(800);
            Object.defineProperty(root, "scrollHeight", { value: 10_000, configurable: true });
            const made = makeManager(makeRenderer(), () => 500, root);
            const block = made.manager.add(FILE);
            document.body.appendChild(block);
            fire(observers.render, block, true);
            await settle();
            fire(observers.unload, block, false);
            return { ...made, block };
        }

        it("emptied", async () => {
            const { manager } = await leaving();
            await still();
            await still();

            manager.onScroll();

            expect(vi.getTimerCount()).toBe(0);
        });

        it("removed", async () => {
            const { manager, block } = await leaving();
            manager.remove(block);
            await still();
            await still();

            manager.onScroll();

            expect(vi.getTimerCount()).toBe(0);
        });

        it("detached", async () => {
            const { manager } = await leaving();
            manager.detach();

            manager.onScroll();

            expect(vi.getTimerCount()).toBe(0);
        });
    });

    // In a hidden tab a note has no size, so when it is unloaded there, it
    // keeps the height it had.
    it("keeps a rendered note's height through forgotten heights, for an unload that measures nothing", async () => {
        let measured = 500;
        const heights = new NoteHeights();
        heights.keep(LAYOUT, FILE.path, 812);
        const { manager } = makeManager(makeRenderer(), () => measured, undefined, heights);
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        await still();

        heights.retainOnly(new Set());
        manager.forgetHeights();
        measured = 0;
        fire(observers.unload, block, false);
        await still();

        expect(placeholderHeight(block)).toBe("812px");
    });

    it("draws nothing queued before it was detached", async () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        manager.detach();
        await settle();

        expect(renderer.renderInto).not.toHaveBeenCalled();
    });

    it("picks up no block it had before it was detached", () => {
        const { manager, scrollRoot } = makeManager();
        const block = manager.add(FILE);
        manager.detach();
        observers.observe.mockClear();

        manager.attach(scrollRoot, document.createElement("div"), moreBelow);

        expect(observers.observe).not.toHaveBeenCalledWith(block);
    });

    it("detach lets the scroll anchor go", () => {
        const { manager } = makeManager();
        const detach = vi.spyOn(ScrollAnchor.prototype, "detach");
        onTestFinished(() => detach.mockRestore());
        // A spy left by another test counts these calls too.
        detach.mockClear();

        manager.detach();

        expect(detach).toHaveBeenCalled();
    });

    it("watches nothing of a note it unloaded when re-attached", async () => {
        const { manager, scrollRoot } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        fire(observers.unload, block, false);
        await still();

        expect(() => manager.attach(scrollRoot, document.createElement("div"), moreBelow)).not.toThrow();
    });

    it("re-attaching picks the existing blocks back up", () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        observers.observe.mockClear();

        manager.attach(document.createElement("div"), document.createElement("div"), moreBelow);

        expect(observers.observe).toHaveBeenCalledWith(block);
    });

    it("detach before attach is harmless", () => {
        const manager = new NoteWindowManager(
            makeRenderer() as never,
            makeQueue(),
            new NoteHeights(),
            () => LAYOUT,
            () => 0
        );
        expect(() => manager.detach()).not.toThrow();
    });

    it("re-attaching replaces the observers rather than stacking them", () => {
        const { manager } = makeManager();
        manager.attach(document.createElement("div"), document.createElement("div"), moreBelow);
        expect(observers.disconnect).toHaveBeenCalledTimes(4);
        expect(observers.margins).toHaveLength(6);
    });
});

// ---------------------------------------------------------------------------
// Layout changes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scroll anchoring, where the platform has none (iOS)
// ---------------------------------------------------------------------------

describe("NoteWindowManager scroll anchoring", () => {
    const resizeObserver = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };

    beforeEach(() => {
        for (const spy of Object.values(resizeObserver)) spy.mockClear();
        vi.stubGlobal("CSS", { supports: () => false });
        vi.stubGlobal(
            "ResizeObserver",
            vi.fn(function () {
                return resizeObserver;
            })
        );
    });

    it("watches every block's height from the moment it is added", () => {
        const { manager } = makeManager();

        const block = manager.add(FILE);

        expect(resizeObserver.observe).toHaveBeenCalledWith(block);
    });

    it("stops watching a removed block, and every block on detach", () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);

        manager.remove(block);
        expect(resizeObserver.unobserve).toHaveBeenCalledWith(block);

        manager.detach();
        expect(resizeObserver.disconnect).toHaveBeenCalled();
    });

    it("tells the anchor the stream is scrolling", () => {
        const onScroll = vi.spyOn(ScrollAnchor.prototype, "onScroll");
        const { manager } = makeManager();

        manager.onScroll();

        expect(onScroll).toHaveBeenCalledOnce();
        onScroll.mockRestore();
    });

    it("tells the anchor the scroll was set to a place", () => {
        const placed = vi.spyOn(ScrollAnchor.prototype, "placed");
        const { manager } = makeManager();

        manager.placed();

        expect(placed).toHaveBeenCalledOnce();
        placed.mockRestore();
    });

    it("hands the anchor the stream, and tells it when every note is loaded", () => {
        const attach = vi.spyOn(ScrollAnchor.prototype, "attach");
        const loadedToEnd = () => true;
        const manager = new NoteWindowManager(makeRenderer() as never, makeQueue(), new NoteHeights(), () => LAYOUT);
        const root = makeScrollRoot(800);
        const stream = document.createElement("div");

        manager.attach(root, stream, loadedToEnd);

        expect(attach).toHaveBeenCalledWith(root, stream, loadedToEnd);
        attach.mockRestore();
    });

    it("has the anchor hand what it owes to the scroll", () => {
        const handOver = vi.spyOn(ScrollAnchor.prototype, "handOver");
        const { manager } = makeManager();

        manager.handOver();

        expect(handOver).toHaveBeenCalledOnce();
        handOver.mockRestore();
    });

    it("stops watching what a note rendered once it unloads", async () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        const rendered = block.firstElementChild;
        expect(resizeObserver.observe).toHaveBeenCalledWith(rendered);

        fire(observers.unload, block, false);
        await still();
        expect(resizeObserver.unobserve).toHaveBeenCalledWith(rendered);
        document.body.empty();
    });

    it("watches the existing blocks again when re-attached", () => {
        const { manager, scrollRoot } = makeManager();
        const block = manager.add(FILE);
        resizeObserver.observe.mockClear();

        manager.attach(scrollRoot, document.createElement("div"), moreBelow);

        expect(resizeObserver.observe).toHaveBeenCalledWith(block);
    });
});

// A rendered block's height only changes when it is re-pinned, which tells the
// anchor. An observer's report would come one round after the report of its
// content, which WebKit logs as an error.
describe("NoteWindowManager watches no pinned block's own size", () => {
    let observed: Set<Element>[];
    /** Whether any ResizeObserver watches `el`. */
    const watched = (el: Element) => observed.some((targets) => targets.has(el));

    beforeEach(() => {
        observed = [];
        vi.stubGlobal("CSS", { supports: () => false });
        vi.stubGlobal(
            "ResizeObserver",
            vi.fn(function () {
                const targets = new Set<Element>();
                observed.push(targets);
                return {
                    observe: (el: Element) => targets.add(el),
                    unobserve: (el: Element) => targets.delete(el),
                    disconnect: () => targets.clear(),
                };
            })
        );
    });
    afterEach(() => document.body.empty());

    async function rendered(measure = () => 500) {
        const setup = makeManager(makeRenderer(), measure);
        const block = setup.manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return { ...setup, block };
    }

    it("watches what a rendered note holds, not its block", async () => {
        const { block } = await rendered();

        expect(watched(block)).toBe(false);
        expect(watched(block.firstElementChild!)).toBe(true);
    });

    it("watches a block again once unloaded", async () => {
        const { block } = await rendered();

        fire(observers.unload, block, false);
        await still();

        expect(watched(block)).toBe(true);
    });

    it("watches a block laid out at nothing, which is not pinned", async () => {
        const { block } = await rendered(() => 0);

        expect(watched(block)).toBe(true);
    });

    it("watches a block again once it lays out at nothing", async () => {
        let height = 500;
        const { manager, block } = await rendered(() => height);

        height = 0;
        manager.onBaseResized(block.firstElementChild);

        expect(watched(block)).toBe(true);
    });

    it("watches an unloaded block when re-attached", () => {
        const { manager, scrollRoot } = makeManager();
        const block = manager.add(FILE);

        manager.attach(scrollRoot, document.createElement("div"), moreBelow);

        expect(watched(block)).toBe(true);
    });

    it("watches no pinned block when re-attached", async () => {
        const { manager, scrollRoot, block } = await rendered();

        manager.attach(scrollRoot, document.createElement("div"), moreBelow);

        expect(watched(block)).toBe(false);
        expect(watched(block.firstElementChild!)).toBe(true);
    });
});

describe("NoteWindowManager.layoutChanges", () => {
    it("counts a render, so a caller can tell the stream is still settling", async () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        const before = manager.layoutChanges;

        fire(observers.render, block, true);
        await settle();

        expect(manager.layoutChanges).toBe(before + 1);
    });

    it("counts an edit's re-render: the note redraws at a height of its own", async () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        const before = manager.layoutChanges;

        await manager.refresh(block);

        expect(manager.layoutChanges).toBe(before + 1);
    });

    it("counts an update in place", async () => {
        const { manager, renderer } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        renderer.update.mockResolvedValueOnce(true);
        const before = manager.layoutChanges;

        await manager.refresh(block);

        expect(manager.layoutChanges).toBe(before + 1);
    });

    it("counts an unload: shedding a note's content moves everything below it", async () => {
        const { manager } = makeManager();
        const block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        const before = manager.layoutChanges;

        fire(observers.unload, block, false);
        await still();

        expect(manager.layoutChanges).toBe(before + 1);
    });
});

// ---------------------------------------------------------------------------
// Runs of a long note hidden when far away (ADR 0021)
// ---------------------------------------------------------------------------

describe("NoteWindowManager hides a long note's far runs", () => {
    /**
     * A long note drawn in four runs of one paragraph each, at `tops`, each
     * 500px tall, in a pane 800px tall at the top of the page. The hiding
     * distance reaches 3,200px past either edge.
     */
    async function renderedLong(tops = [0, 1000, 4500, 9000], runsOf = (ps: HTMLElement[]) => ps.map((p) => [p])) {
        const renderer = makeRenderer({
            render: (block) => {
                const content = block.createDiv({ cls: "daily-note-content" });
                for (const top of tops)
                    content.createEl("p", { text: `at ${top}`, attr: { "data-top": top, "data-bottom": top + 500 } });
            },
        });
        let block: HTMLElement;
        const paragraphs = () => Array.from(block.querySelectorAll("p"));
        renderer.runsOf.mockImplementation(() => runsOf(paragraphs()));
        const root = makeScrollRoot(800);
        root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        let layout = LAYOUT;
        const manager = new NoteWindowManager(
            renderer as never,
            makeQueue(),
            new NoteHeights(),
            () => layout,
            () => 500
        );
        manager.attach(root, document.createElement("div"), moreBelow);
        /**
         * The layout is read once per task, so the width changes in the next
         * one.
         */
        const narrow = async () => {
            await settle();
            layout = "400:16px";
            manager.onResize();
        };
        block = manager.add(FILE);
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        const far = () =>
            paragraphs()
                .filter((p) => p.hasClass("is-far"))
                .map((p) => p.textContent);
        const spacers = () => Array.from(block.querySelectorAll<HTMLElement>(".daily-note-far-run"));
        return { manager, renderer, block, far, spacers, paragraphs, narrow, root };
    }

    /**
     * The hiding observer's report on each paragraph, where its data says it
     * is. A folded paragraph, or one in a hidden note, is nowhere.
     */
    function report(...ps: HTMLElement[]): void {
        observers.hide(
            ps.map((p) => {
                const top = Number(p.dataset.top ?? 0);
                const bottom = Number(p.dataset.bottom ?? 0);
                // With no size, Chromium reports an empty box in empty root
                // bounds.
                const nowhere = bottom <= top;
                return {
                    target: p,
                    isIntersecting: !nowhere && bottom > -3200 && top < 4000,
                    boundingClientRect: { top, bottom, width: nowhere ? 0 : 600, height: bottom - top },
                    rootBounds: nowhere ? { top: 0, bottom: 0 } : { top: -3200, bottom: 4000 },
                } as unknown as IntersectionObserverEntry;
            }),
            {} as IntersectionObserver
        );
    }

    afterEach(() => document.body.empty());

    it("watches the first and last element of each run as the note lands", async () => {
        const { paragraphs } = await renderedLong([0, 1000, 1500, 2000], (ps) => [[ps[0]!, ps[1]!, ps[2]!], [ps[3]!]]);
        const [first, middle, last, alone] = paragraphs();

        for (const el of [first, last, alone]) expect(observers.observe).toHaveBeenCalledWith(el);
        expect(observers.observe).not.toHaveBeenCalledWith(middle);
    });

    it("hides a run as its first element is reported past the hide margin below, mid-glide", async () => {
        const { far, paragraphs } = await renderedLong();

        report(...paragraphs());

        expect(far()).toEqual(["at 4500", "at 9000"]);
    });

    it("hides a run as its last element is reported past the hide margin above", async () => {
        const { far, paragraphs } = await renderedLong([-9000, -4500, -3000, 0]);

        report(...paragraphs());

        expect(far()).toEqual(["at -9000", "at -4500"]);
    });

    // Its first element may still be on screen.
    it("leaves a run whose last element alone is past the margin below", async () => {
        const { far, paragraphs } = await renderedLong([0, 1000, 4500, 9000], (ps) => [
            [ps[0]!],
            [ps[1]!, ps[2]!, ps[3]!],
        ]);
        const [, , , last] = paragraphs();

        report(last!);

        expect(far()).toEqual([]);
    });

    // A fold hid it, or the note it is in is hidden, so it is not where its
    // data says.
    it("hides nothing for an element laid out at nothing", async () => {
        const { far, paragraphs } = await renderedLong();
        const [, , below] = paragraphs();
        below!.dataset.top = "0";
        below!.dataset.bottom = "0";

        report(below!);

        expect(far()).toEqual([]);
    });

    // Hiding a run between two measurements lays the whole note out again.
    it("measures every run reported before hiding any", async () => {
        const { renderer, far, paragraphs } = await renderedLong();
        const steps: string[] = [];
        const farRuns = renderer.farRuns as unknown as { box: (el: Element) => Box | null };
        farRuns.box = (el) => (steps.push("read"), boxFromData(el));
        const hide = renderer.farRuns.hide.bind(renderer.farRuns);
        vi.spyOn(renderer.farRuns, "hide").mockImplementation((...args) => (steps.push("hide"), hide(...args)));

        report(...paragraphs());

        expect(far()).toEqual(["at 4500", "at 9000"]);
        expect(steps.lastIndexOf("read")).toBeLessThan(steps.indexOf("hide"));
    });

    it("stops watching a run as it hides, and watches its spacer with the render margin", async () => {
        const { spacers, paragraphs } = await renderedLong();
        const [, , below] = paragraphs();

        report(below!);

        expect(observers.unobserve).toHaveBeenCalledWith(below);
        expect(observers.observe).toHaveBeenCalledWith(spacers()[0]);
    });

    it("shows a run as its spacer enters the render margin, and watches it again", async () => {
        const { far, spacers, paragraphs } = await renderedLong();
        const [, , below] = paragraphs();
        report(below!);
        const [spacer] = spacers();
        observers.observe.mockClear();

        fire(observers.render, spacer!, true);

        expect(far()).toEqual([]);
        expect(spacer!.isConnected).toBe(false);
        expect(observers.unobserve).toHaveBeenCalledWith(spacer);
        expect(observers.observe).toHaveBeenCalledWith(below);
    });

    // Watched again, it is hidden again by the observer's first report.
    it("watches a run shown by other means again: a search step, a collapse", async () => {
        const { renderer, far, paragraphs } = await renderedLong();
        const [, , below] = paragraphs();
        report(below!);
        observers.observe.mockClear();

        renderer.farRuns.reveal(below!);
        report(below!);

        expect(observers.observe).toHaveBeenCalledWith(below);
        expect(far()).toEqual(["at 4500"]);
    });

    it("ignores a run shown in a note it no longer draws", async () => {
        const { renderer, block, paragraphs } = await renderedLong();
        const [, , below] = paragraphs();
        report(below!);
        fire(observers.unload, block, false);
        await still();
        observers.observe.mockClear();

        renderer.farRuns.reveal(below!);

        expect(observers.observe).not.toHaveBeenCalled();
    });

    it("hides nothing for an element it does not watch", async () => {
        const { far } = await renderedLong();
        const stranger = document.createElement("p");
        stranger.dataset.top = "9000";
        stranger.dataset.bottom = "9500";

        report(stranger);

        expect(far()).toEqual([]);
    });

    // If they were measured before, its runs would be measured at a scroll
    // position the anchor is about to correct.
    it("watches a landing note's runs only once it is re-pinned", async () => {
        const pinnedAtWatch: boolean[] = [];
        observers.observe.mockImplementation((el: Element) => {
            if (el.tagName === "P") pinnedAtWatch.push(el.closest(".daily-note-block")!.hasClass("is-pinned"));
        });

        await renderedLong();

        expect(pinnedAtWatch).toEqual([true, true, true, true]);
    });

    it("hides the far runs of a note drawing from its end between slices, all but the topmost", async () => {
        const renderer = makeRenderer();
        const paragraphs = () => Array.from(document.querySelectorAll("p"));
        renderer.runsOf.mockImplementation(() => paragraphs().map((p) => [p]));
        let farMidDraw: string[] = [];
        renderer.renderInto.mockImplementationOnce(async (block, _file, goOn) => {
            block.addClass("is-drawing-from-end");
            const content = block.createDiv({ cls: "daily-note-content" });
            for (const top of [-12000, -8000, -4500, -1000, 0])
                content.createEl("p", { text: `at ${top}`, attr: { "data-top": top, "data-bottom": top + 500 } });
            const component = new Component();
            await goOn!(component);
            farMidDraw = paragraphs()
                .filter((p) => p.hasClass("is-far"))
                .map((p) => p.textContent);
            return { component, footer: Promise.resolve() };
        });
        const root = makeScrollRoot(800);
        root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        const { manager } = makeManager(renderer, () => 500, root);
        const block = manager.add(FILE);
        block.getBoundingClientRect = () => ({ top: -12000, bottom: 500 }) as DOMRect;
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await settle();

        expect(farMidDraw).toEqual(["at -8000", "at -4500"]);
    });

    it("hides no run between slices of a note drawing from its start", async () => {
        const renderer = makeRenderer();
        renderer.runsOf.mockImplementation(() => Array.from(document.querySelectorAll("p"), (p) => [p]));
        let farMidDraw = -1;
        renderer.renderInto.mockImplementationOnce(async (block, _file, goOn) => {
            const content = block.createDiv({ cls: "daily-note-content" });
            for (const top of [0, 4500, 9000])
                content.createEl("p", { attr: { "data-top": top, "data-bottom": top + 500 } });
            const component = new Component();
            await goOn!(component);
            farMidDraw = block.querySelectorAll(".is-far").length;
            return { component, footer: Promise.resolve() };
        });
        const root = makeScrollRoot(800);
        root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        const { manager } = makeManager(renderer, () => 500, root);
        const block = manager.add(FILE);
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await settle();

        expect(farMidDraw).toBe(0);
    });
    /**
     * A note drawn from its end in two slices, the second adding nothing.
     * `between` runs before each slice returns.
     */
    async function drawnFromEnd(between: (manager: NoteWindowManager) => void = () => {}) {
        const renderer = makeRenderer();
        const paragraphs = () => Array.from(document.querySelectorAll("p"));
        renderer.runsOf.mockImplementation(() => paragraphs().map((p) => [p]));
        const hidden: number[] = [];
        let manager: NoteWindowManager;
        renderer.renderInto.mockImplementationOnce(async (block, _file, goOn) => {
            block.addClass("is-drawing-from-end");
            const content = block.createDiv({ cls: "daily-note-content" });
            for (const top of [-12000, -8000, 0])
                content.createEl("p", { attr: { "data-top": top, "data-bottom": top + 500 } });
            const component = new Component();
            for (let slice = 0; slice < 2; slice++) {
                between(manager);
                await goOn!(component);
                hidden.push(block.querySelectorAll(".daily-note-far-run").length);
            }
            return { component, footer: Promise.resolve() };
        });
        const root = makeScrollRoot(800);
        root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        ({ manager } = makeManager(renderer, () => 500, root));
        const block = manager.add(FILE);
        block.getBoundingClientRect = () => ({ top: -12000, bottom: 500 }) as DOMRect;
        document.body.appendChild(block);
        fire(observers.render, block, true);
        await settle();
        return hidden;
    }

    it("hides each far run of a note drawing from its end once, across slices", async () => {
        expect(await drawnFromEnd()).toEqual([1, 1]);
    });

    it("hides nothing between slices once the view has closed", async () => {
        expect(await drawnFromEnd((manager) => manager.detach())).toEqual([0, 0]);
    });

    // Folded completely, it takes no space, so there is nothing for a spacer to
    // stand in for.
    it("hides nothing of a run reported far with nothing in it shown", async () => {
        const { renderer, far, spacers, paragraphs } = await renderedLong();
        const [, , below] = paragraphs();
        vi.spyOn(renderer.farRuns, "measure").mockReturnValue(null);

        report(below!);

        expect(far()).toEqual([]);
        expect(spacers()).toEqual([]);
    });

    it("stops watching the spacers of a note given up mid-draw", async () => {
        const renderer = makeRenderer();
        renderer.runsOf.mockImplementation(() => Array.from(document.querySelectorAll("p"), (p) => [p]));
        let spacers: HTMLElement[] = [];
        renderer.renderInto.mockImplementationOnce(async (block, _file, goOn) => {
            block.addClass("is-drawing-from-end");
            const content = block.createDiv({ cls: "daily-note-content" });
            for (const top of [-12000, -8000, 0])
                content.createEl("p", { attr: { "data-top": top, "data-bottom": top + 500 } });
            await goOn!(new Component());
            spacers = Array.from(block.querySelectorAll<HTMLElement>(".daily-note-far-run"));
            block.empty();
            return null;
        });
        const root = makeScrollRoot(800);
        root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        const { manager } = makeManager(renderer, () => 500, root);
        const block = manager.add(FILE);
        block.getBoundingClientRect = () => ({ top: -12000, bottom: 500 }) as DOMRect;
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await settle();

        expect(spacers).toHaveLength(1);
        expect(observers.unobserve).toHaveBeenCalledWith(spacers[0]);
    });

    // close() empties the container during the render, so afterwards the block
    // has no parent.
    it("stops watching the spacers of a note whose block left the stream mid-draw", async () => {
        const renderer = makeRenderer();
        renderer.runsOf.mockImplementation(() => Array.from(document.querySelectorAll("p"), (p) => [p]));
        let spacers: HTMLElement[] = [];
        renderer.renderInto.mockImplementationOnce(async (block, _file, goOn) => {
            block.addClass("is-drawing-from-end");
            const content = block.createDiv({ cls: "daily-note-content" });
            for (const top of [-12000, -8000, 0])
                content.createEl("p", { attr: { "data-top": top, "data-bottom": top + 500 } });
            const component = new Component();
            await goOn!(component);
            spacers = Array.from(block.querySelectorAll<HTMLElement>(".daily-note-far-run"));
            block.remove();
            return { component, footer: Promise.resolve() };
        });
        const root = makeScrollRoot(800);
        root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
        const { manager } = makeManager(renderer, () => 500, root);
        const block = manager.add(FILE);
        block.getBoundingClientRect = () => ({ top: -12000, bottom: 500 }) as DOMRect;
        document.body.appendChild(block);

        fire(observers.render, block, true);
        await settle();

        expect(spacers).toHaveLength(1);
        expect(observers.unobserve).toHaveBeenCalledWith(spacers[0]);
    });
    it("hides nothing before it is attached to a pane", async () => {
        const renderer = makeRenderer({
            render: (block) =>
                void block
                    .createDiv({ cls: "daily-note-content" })
                    .createEl("p", { attr: { "data-top": 9000, "data-bottom": 9500 } }),
        });
        renderer.runsOf.mockImplementation(() => [[document.querySelector("p")!]]);
        const manager = new NoteWindowManager(
            renderer as never,
            makeQueue(),
            new NoteHeights(),
            () => LAYOUT,
            () => 500
        );
        const block = manager.add(FILE);
        document.body.appendChild(block);

        manager.render(block);
        await settle();
        await still();

        expect(block.querySelector(".is-far")).toBeNull();
        expect(renderer.renderInto.mock.calls[0]![3]).toBe("from-start");
    });
    it("watches its runs and spacers again when attached anew, and when the pane's height changes", async () => {
        const { manager, spacers, paragraphs, root } = await renderedLong();
        report(...paragraphs());
        const watched = spacers();
        const [near] = paragraphs();
        expect(watched).toHaveLength(2);

        observers.observe.mockClear();
        manager.attach(root, document.createElement("div"), moreBelow);
        for (const el of [...watched, near]) expect(observers.observe).toHaveBeenCalledWith(el);

        observers.observe.mockClear();
        Object.defineProperty(root, "clientHeight", { value: 600, configurable: true });
        manager.onResize();
        for (const el of [...watched, near]) expect(observers.observe).toHaveBeenCalledWith(el);
    });

    it("stops watching a note's runs and spacers as it unloads", async () => {
        const { block, spacers, paragraphs } = await renderedLong();
        const [near, , below] = paragraphs();
        report(below!);
        const watched = spacers();

        fire(observers.unload, block, false);
        await still();

        for (const el of [...watched, near]) expect(observers.unobserve).toHaveBeenCalledWith(el);
    });

    it("stops watching the spacers a save updating the note in place took away", async () => {
        const { manager, renderer, block, spacers, paragraphs } = await renderedLong();
        report(...paragraphs());
        const [shown, kept] = spacers();
        renderer.update.mockImplementation(async () => {
            renderer.farRuns.reveal(shown!);
            return true;
        });
        observers.unobserve.mockClear();

        await manager.refresh(block);

        // Compared by identity, because the two spacers are equal nodes.
        const unwatched = observers.unobserve.mock.calls.map(([el]) => el as unknown);
        expect(unwatched).toContain(shown);
        expect(unwatched).not.toContain(kept);
    });

    // A save may draw the runs again: those it drew are watched, and those it
    // removed are no longer watched.
    it("watches the runs a save updating the note in place drew", async () => {
        const { manager, renderer, block, paragraphs } = await renderedLong();
        const [gone] = paragraphs();
        renderer.update.mockImplementation(async () => {
            gone!.replaceWith(document.createElement("p"));
            return true;
        });
        observers.observe.mockClear();
        observers.unobserve.mockClear();

        await manager.refresh(block);

        expect(observers.unobserve).toHaveBeenCalledWith(gone);
        expect(observers.observe).toHaveBeenCalledWith(paragraphs()[0]);
    });

    it("shows every run at a new width, watching each again: their spacers measured the old one", async () => {
        const { far, spacers, paragraphs, narrow } = await renderedLong();
        report(...paragraphs());
        const watched = spacers();
        expect(watched).toHaveLength(2);
        observers.observe.mockClear();

        await narrow();

        expect(far()).toEqual([]);
        for (const spacer of watched) expect(observers.unobserve).toHaveBeenCalledWith(spacer);
        for (const p of paragraphs().slice(2)) expect(observers.observe).toHaveBeenCalledWith(p);
    });
});
