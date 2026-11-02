import { test, expect, type Phone } from "./phone";
import { longNote } from "../long-note";

/** Farther than a short drag and what glides on after it can move the text. */
const MOVED_WITH_FINGER = 1000;

const owedNow = (phone: Phone) =>
    phone.run(
        () =>
            (
                window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.stream.window
                    .anchor as unknown as { owed: number }
            ).owed
    );

/** What a test holds back or reads on the stream's anchor. */
type HeldAnchor = {
    owed: number;
    settleOnceStill: (() => void) & { cancel: () => void; run: () => void };
};

// The notes above a jump's target were never drawn. Each one is drawn when a
// flick up reaches it, while iOS controls the scroll (ADR 0013). Those right
// above it keep their heights: the jump draws every short one near it at once,
// and one flick would not get past them.
test("a flick up from an old date glides on, the text under the thumb moving only with it", async ({ phone }) => {
    await phone.estimateShortAbove("2026-09-15");
    try {
        await phone.openStream();
        await phone.jumpTo("2026-09-12");
        expect(await emptyHeightsAbove(phone), "the empty notes above").toContain(100);
        await phone.followReader();

        expect((await phone.glide("down")).faults).toEqual([]);

        const { drifts, rendered } = await phone.stopFollowing();
        expect(rendered, "no note above rendered during the glide").toBeGreaterThan(0);
        expect(Math.max(...drifts.map(Math.abs)), `drifts: ${drifts.join(", ")}`).toBeLessThan(5);
    } finally {
        await phone.restoreHeights();
    }
});

/** The heights of the empty notes above the pane. */
function emptyHeightsAbove(phone: Phone): Promise<number[]> {
    return phone.run(() => {
        const paneTop = document
            .querySelector(".daily-notes-stream-container")!
            .parentElement!.getBoundingClientRect().top;
        return [...document.querySelectorAll<HTMLElement>(".daily-note-block.is-unloaded")]
            .map((block) => block.getBoundingClientRect())
            .filter(({ bottom }) => bottom <= paneTop)
            .map(({ height }) => Math.round(height));
    });
}

/**
 * A frame of the stream: its scroll position, how far it is shifted from it,
 * and how far its top is below where it sits at the top.
 */
type Frame = { at: number; top: number; shift: number; streamTop: number; frozen: boolean; finger: boolean };

/**
 * Starts recording each frame, until `frames` reports them. Not up to a count:
 * at the iPhone's 120 Hz, 600 frames ended before the stream, still for
 * `SCROLL_IDLE_MS`, moved what it owed into the scroll.
 */
async function recordFrames(phone: Phone): Promise<void> {
    await phone.run(() => {
        const stream = document.querySelector<HTMLElement>(".daily-notes-stream-container")!;
        const pane = stream.parentElement!;
        const below = () => stream.getBoundingClientRect().top - pane.getBoundingClientRect().top;
        // Read while still, with nothing owed: where the stream is at scroll
        // position 0.
        const atTop = below() + pane.scrollTop;
        const recording = { frames: [] as Frame[], on: true, heard: new AbortController() };
        let finger = false;
        const { signal } = recording.heard;
        document.addEventListener("touchstart", () => (finger = true), { capture: true, passive: true, signal });
        document.addEventListener("touchend", () => (finger = false), { capture: true, passive: true, signal });
        (window as unknown as { streamFrames: typeof recording }).streamFrames = recording;
        const frame = () => {
            recording.frames.push({
                at: performance.now(),
                top: pane.scrollTop,
                shift: parseFloat(stream.style.getPropertyValue("--daily-notes-scroll-shift")) || 0,
                streamTop: below() - atTop,
                frozen: pane.classList.contains("is-scroll-frozen"),
                finger,
            });
            if (recording.on) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
}

/** Stops recording, and reports each frame recorded. */
const frames = (phone: Phone) =>
    phone.run(() => {
        const recording = (
            window as unknown as { streamFrames: { frames: Frame[]; on: boolean; heard: AbortController } }
        ).streamFrames;
        recording.on = false;
        recording.heard.abort();
        return recording.frames;
    });

/**
 * Stops recording, if it is on, and drops what was recorded. A test that fails
 * before `frames` would leave it recording into the tests after it.
 */
const forgetFrames = (phone: Phone) =>
    phone.run(() => {
        const page = window as unknown as { streamFrames?: { on: boolean; heard: AbortController } };
        if (page.streamFrames) page.streamFrames.on = false;
        page.streamFrames?.heard.abort();
        delete page.streamFrames;
    });

// Empty blocks that are far too short leave the scroll less room than there is
// above. The glide is stopped before the top while owing (D-143), or, on an
// iPad about 1 in 30 times, bounces there first (D-176). Either way, what is
// owed is moved into the scroll, and the text at the pane's top, which the
// anchor holds, never jumps. Two strokes ended short of the stop in 8 of 8
// glides on an iPad; three reach it.
test("a glide owing the notes above hands over what it owes, the text never jumping @portrait", async ({ phone }) => {
    await phone.estimateShortAbove("2026-09-12");
    try {
        await phone.openStream();
        await phone.jumpTo("2026-09-12");
        await recordFrames(phone);
        await phone.followReader({ at: "top" });

        await phone.flick("down", 3);

        const { drifts } = await phone.stopFollowing();
        const seen = await frames(phone);
        expect(
            seen.some((f) => f.shift !== 0),
            "the glide owed the notes above"
        ).toBe(true);
        expect(seen.at(-1)!.shift).toBe(0);
        expect(Math.max(...drifts.map(Math.abs)), `drifts: ${drifts.join(", ")}`).toBeLessThan(5);
    } finally {
        await forgetFrames(phone);
        await phone.restoreHeights();
    }
});

/** Scrolls until `date`'s note is drawn, so the notes above have heights. */
const scrollDownWithNoFinger = (phone: Phone, date: string) =>
    phone.runAsync(async (path: string) => {
        const stream = document.querySelector(".daily-notes-stream-container")!;
        const pane = stream.parentElement!;
        const block = () => stream.querySelector(`[data-source-path$="${path}.md"]:not(.is-unloaded)`);
        for (let frame = 0; frame < 2000 && !block(); frame++) {
            pane.scrollTop += 200;
            await new Promise(requestAnimationFrame);
        }
    }, date);

/**
 * Moves the pane up with no touch, one step a frame, as a trackpad or mouse
 * would: the tests cannot drive those. Returns the notes held while off screen.
 */
const scrollUpWithNoFinger = (phone: Phone) =>
    phone.runAsync(async () => {
        const stream = document.querySelector(".daily-notes-stream-container")!;
        const pane = stream.parentElement!;
        const heldOffScreen: string[] = [];
        const heard = new MutationObserver((changes) => {
            const { top, bottom } = pane.getBoundingClientRect();
            for (const { target } of changes) {
                const block = target as HTMLElement;
                // A Base's box has a hold of its own, which is not the note's.
                if (!block.dataset.sourcePath || !block.style.getPropertyValue("--daily-note-held-height")) continue;
                const at = block.getBoundingClientRect();
                if (at.bottom <= top || at.top >= bottom) heldOffScreen.push(block.dataset.sourcePath);
            }
        });
        heard.observe(stream, { attributes: true, attributeFilter: ["style"], subtree: true });
        for (let frame = 0; frame < 600 && pane.scrollTop > 0; frame++) {
            pane.scrollTop -= 100;
            await new Promise(requestAnimationFrame);
        }
        heard.disconnect();
        return heldOffScreen;
    });

// A note drawn off screen grows as it fills in whatever moved the pane (D-200).
// A script's steady scroll does not make the next note jump even with a hold,
// so this checks the hold, not the text.
test("a scroll with no finger holds no note off screen @portrait", async ({ phone }) => {
    await phone.openStream();
    await scrollDownWithNoFinger(phone, "2026-09-12");
    await phone.jumpTo("2026-09-12");
    await phone.followReader({ at: "top" });

    const heldOffScreen = await scrollUpWithNoFinger(phone);

    const { rendered } = await phone.stopFollowing();
    expect(rendered, "notes above rendered during the scroll").toBeGreaterThan(0);
    expect(heldOffScreen).toEqual([]);
});

/** Whether a glide has been stopped since `recordFrames`. */
const glideStopped = (phone: Phone) =>
    phone.run(() =>
        (window as unknown as { streamFrames: { frames: Frame[] } }).streamFrames.frames.some((f) => f.frozen)
    );

/** For each stop with no finger on it, the frames moved before the next. */
function framesMovedAfterStops(seen: Frame[]): number[] {
    return seen.flatMap((frame, stop) => {
        if (!frame.frozen || frame.finger) return [];
        const after = seen.slice(stop + 1);
        const finger = after.findIndex((f) => f.finger);
        const carried = finger < 0 ? after : after.slice(0, finger);
        return [carried.filter((f, i) => i > 0 && f.top !== carried[i - 1]!.top).length];
    });
}

// The stop above left a hard flick thousands of pixels short of the newest
// note, and the reader had to flick again. It goes on from its own speed
// (D-192). A short stroke may end before the stop, so each flick rests first,
// and no later finger cancels what follows. This does not check how the text
// moves: Bases filling in on the way move it, with or without this.
test("a hard flick stopped while owing carries on with no finger on it", async ({ phone }) => {
    await phone.estimateShortAbove("2026-09-12");
    try {
        await phone.openStream();
        await phone.jumpTo("2026-09-12");
        await recordFrames(phone);

        for (let flicks = 0; flicks < 5 && !(await glideStopped(phone)); flicks++)
            await phone.flick("down", 1, { share: 0.85, ms: 30 });

        const carried = framesMovedAfterStops(await frames(phone));
        expect(Math.max(0, ...carried), "frames it moved in after a stop").toBeGreaterThan(5);
    } finally {
        await forgetFrames(phone);
        await phone.restoreHeights();
    }
});

// Notes above that are shorter than their saved heights, as after editing on
// another device, leave the scroll more room than there is above. The stream,
// shifted down, reached the pane's top with scroll left, and the scrolling went
// on into empty space.
test("a glide that reaches the newest note with scroll to spare stops there", async ({ phone }) => {
    const above = ["Journal/2026-09-28.md", "Journal/2026-09-29.md", "Journal/2026-09-30.md"];
    // Opened again, because an earlier test may have made the notes' empty
    // heights shorter.
    await phone.openStream();
    // Edited far from the reader, because a rendered note re-renders short at
    // once, or mid-glide, when its metadata is updated.
    await phone.jumpTo("2026-09-12");
    const texts = await phone.runAsync(
        (paths: string[]) => Promise.all(paths.map((path) => window.app.vault.adapter.read(path))),
        above
    );
    try {
        await phone.runAsync(async (paths: string[]) => {
            for (const path of paths) await window.app.vault.modify(window.app.vault.getFileByPath(path)!, "Short.\n");
        }, above);
        await phone.jumpTo("2026-09-24");
        const rendered = await phone.run(
            (paths: string[]) =>
                paths.filter(
                    (path) =>
                        !document
                            .querySelector(`.daily-note-block[data-source-path="${path}"]`)!
                            .classList.contains("is-unloaded")
                ),
            above
        );
        expect(rendered, "the edited notes are unrendered as the flick starts").toEqual([]);
        await recordFrames(phone);

        await phone.flick("down", 2);

        const seen = await frames(phone);
        expect(
            seen.some((f) => f.shift > 0),
            "the notes above shrank as they rendered"
        ).toBe(true);
        expect(
            seen.some((f) => f.top === 0),
            "the glide reached the top"
        ).toBe(true);
        // A bounce draws the stream below the pane's top. Nothing else may.
        const blank = Math.max(...seen.filter((f) => f.top >= 0).map((f) => f.streamTop));
        expect(blank).toBeLessThanOrEqual(1);
        // iOS keeps scrolling after the scroll position is set, so the stop
        // only worked if the stream never came back down.
        const stopped = seen.findIndex((f) => f.top === 0);
        const after = Math.min(...seen.slice(stopped).map((f) => f.streamTop));
        expect(after, "the glide went on past the stop").toBeGreaterThanOrEqual(-1);
    } finally {
        await forgetFrames(phone);
        await phone.runAsync(
            async (paths: string[], texts: string[]) => {
                for (const [i, path] of paths.entries())
                    await window.app.vault.modify(window.app.vault.getFileByPath(path)!, texts[i]!);
            },
            above,
            texts
        );
    }
});

// The date picker belongs to the platform. Desktop Chromium opens a different
// one, so only the phone shows whether a tap on the calendar opens it and a
// chosen date comes back.
test("the calendar's picker fills the query, and a tap on it jumps there", async ({ phone }) => {
    await phone.openStream();
    await phone.tap('[aria-label="Jump to date"]');
    await phone.tap(".daily-notes-jump-calendar");

    await phone.pickDate("2026-09-12");

    await expect.poll(() => phone.inputValue(".prompt input.prompt-input")).toBe("2026-09-12");
    await phone.tap(".prompt .suggestion-item");
    await phone.rest();
    expect((await phone.place()).path).toBe("Journal/2026-09-12.md");
});

// The keyboard would cover half the list, so the reader looks first, then taps.
test("the jump list opens with the keyboard down, and a tap on the query raises it", async ({ phone }) => {
    await phone.openStream();
    await phone.tap('[aria-label="Jump to date"]');
    await expect.poll(() => phone.has(".prompt .suggestion-item")).toBe(true);
    expect(await phone.keyboardShown()).toBe(false);

    await phone.tap(".prompt input.prompt-input");

    await phone.raiseKeyboard();
    await phone.escape(".prompt input.prompt-input");
    await expect.poll(() => phone.has(".prompt")).toBe(false);
});

// iOS drops a scroll set after a finger lands, and the stream jumped by all it
// owed, 10,111 px in a filmed flick, onto a blank note (D-204). The stream's
// wait for stillness is held back until the finger lands, which is otherwise
// about 1 in 8 runs of four hard flicks.
test("a finger landing as the stream's wait ends moves the text only with the finger", async ({ phone }) => {
    await phone.estimateShortAbove("2026-09-12");
    try {
        await phone.openStream();
        await phone.jumpTo("2026-09-12");
        await phone.run(() => {
            const anchor = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.stream.window
                .anchor as unknown as HeldAnchor;
            (window as unknown as { heldWait: HeldAnchor["settleOnceStill"] }).heldWait = anchor.settleOnceStill;
            anchor.settleOnceStill = Object.assign(() => {}, { cancel: () => {}, run: () => {} });
        });
        await phone.flick("down", 1);
        const owed = await owedNow(phone);
        expect(Math.abs(owed), "the flick left the stream owing").toBeGreaterThan(MOVED_WITH_FINGER);

        await phone.run(() => {
            const anchor = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.stream.window
                .anchor as unknown as HeldAnchor;
            const wait = (window as unknown as { heldWait: HeldAnchor["settleOnceStill"] }).heldWait;
            // Not at the touch: a scroll set by then was kept. All set from 49
            // ms after it were lost.
            document.addEventListener(
                "touchstart",
                () => {
                    anchor.settleOnceStill = wait;
                    setTimeout(() => {
                        wait();
                        wait.run();
                    }, 100);
                },
                { once: true, passive: true }
            );
            const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
            const { left, top, width, height } = pane.getBoundingClientRect();
            const text = document.elementFromPoint(left + width / 2, top + height / 2)!;
            const tops: number[] = [];
            (window as unknown as { fingerTops: number[] }).fingerTops = tops;
            const frame = () => {
                if (!text.isConnected) return;
                tops.push(Math.round(text.getBoundingClientRect().top));
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        });
        await phone.flick("down", 1, { share: 0.2, ms: 400 });

        const tops = await phone.run(() => (window as unknown as { fingerTops: number[] }).fingerTops);
        expect(Math.max(...tops) - Math.min(...tops), `tops: ${tops.join(", ")}`).toBeLessThan(MOVED_WITH_FINGER);
        expect(await owedNow(phone), "owed once still").toBe(0);
    } finally {
        await phone.restoreHeights();
    }
});

// A long note is drawn from its end, then laid out from its start. Read after
// that, the anchor held its text, then the next note where that left it, so all
// of what was on screen moved: 120-297 px in hard flicks (D-203).
test("a long note landing with its tail on screen leaves its text and the next note still", async ({ phone }) => {
    const path = "Journal/2026-09-13.md";
    const original = await phone.writeNote(path, longNote(6000));
    try {
        await phone.forgetHeights();
        await phone.openStream();
        await phone.jumpTo("2026-09-06");

        const seen = await phone.runAsync(async (path: string) => {
            const long = document.querySelector<HTMLElement>(`.daily-note-block[data-source-path="${path}"]`)!;
            const next = long.nextElementSibling!;
            const pane = long.closest(".daily-notes-stream-container")!.parentElement!;
            const { top, left, width, height } = pane.getBoundingClientRect();
            let framesDrawn = 0;
            const drawnBefore = !long.classList.contains("is-unloaded");
            pane.scrollTop += long.getBoundingClientRect().bottom - top - height * 0.7;
            const tops: number[] = [];
            const textTops: number[] = [];
            let text: Element | undefined;
            let framesLanded = 0;
            const start = performance.now();
            while (performance.now() - start < 20_000 && framesLanded < 90) {
                await new Promise(requestAnimationFrame);
                tops.push(Math.round(next.getBoundingClientRect().top - top));
                if (!long.classList.contains("is-unloaded")) framesLanded++;
                // The text at the pane's top, from the frame it is first drawn.
                text ??= document
                    .elementsFromPoint(left + width / 2, top + 1)
                    .find((el) => el.closest(".daily-note-content") && long.contains(el));
                if (text) textTops.push(Math.round(text.getBoundingClientRect().top - top));
                if (text && framesLanded === 0) framesDrawn++;
            }
            return { drawnBefore, framesDrawn, framesLanded, tops, textTops };
        }, path);

        expect(seen.drawnBefore, "the long note waits to be drawn").toBe(false);
        expect(seen.framesDrawn, "the text was on screen before the note landed").toBeGreaterThan(0);
        const textMoved = Math.max(...seen.textTops) - Math.min(...seen.textTops);
        expect(textMoved, `text tops: ${seen.textTops.join(", ")}`).toBeLessThan(5);
        expect(Math.max(...seen.tops) - Math.min(...seen.tops), `tops: ${seen.tops.join(", ")}`).toBeLessThan(5);
        expect(seen.framesLanded, "the long note landed").toBe(90);
    } finally {
        await phone.restoreNote(path, original);
    }
});

// A jump goes to its note's start (ADR 0022). When it was drawn from its end,
// as a note above the pane is, the newest note ended up 130–286 px below its
// title in 4 out of 5 runs.
test("a jump up to a long note lands on its title", async ({ phone }) => {
    const path = await phone.journalPath(0);
    const original = await phone.writeNote(path, longNote(10000));
    try {
        await phone.openStream();
        await phone.jumpTo("2026-09-12");

        await phone.jumpTo(path.slice(8, 18));

        expect(await phone.newestOffset()).toBe(0);
    } finally {
        await phone.restoreNote(path, original);
    }
});
