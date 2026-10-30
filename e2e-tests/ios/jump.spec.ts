import { test, expect, type Phone } from "./phone";
import { longNote } from "../long-note";

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
type Frame = { at: number; top: number; shift: number; streamTop: number };

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
        const recording = { frames: [] as Frame[], on: true };
        (window as unknown as { streamFrames: typeof recording }).streamFrames = recording;
        const frame = () => {
            recording.frames.push({
                at: performance.now(),
                top: pane.scrollTop,
                shift: parseFloat(stream.style.getPropertyValue("--daily-notes-scroll-shift")) || 0,
                streamTop: below() - atTop,
            });
            if (recording.on) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
}

/** Stops recording, and reports each frame recorded. */
const frames = (phone: Phone) =>
    phone.run(() => {
        const recording = (window as unknown as { streamFrames: { frames: Frame[]; on: boolean } }).streamFrames;
        recording.on = false;
        return recording.frames;
    });

/**
 * Stops recording, if it is on, and drops what was recorded. A test that fails
 * before `frames` would leave it recording into the tests after it.
 */
const forgetFrames = (phone: Phone) =>
    phone.run(() => {
        const page = window as unknown as { streamFrames?: { on: boolean } };
        if (page.streamFrames) page.streamFrames.on = false;
        delete page.streamFrames;
    });

// Empty blocks that are far too short leave the scroll less room than there is
// above. The glide is stopped before the top while owing (D-143), or, on an
// iPad about 1 in 30 times, bounces there first (D-176). Either way, what is
// owed is moved into the scroll, and the text at the pane's top, which the
// anchor holds, never jumps. Two strokes ended short of the stop in 8 of 8
// glides on an iPad; three reach it.
test("a glide owing the notes above hands over what it owes, the text never jumping", async ({ phone }) => {
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
