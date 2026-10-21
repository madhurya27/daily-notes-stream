import { test, expect, type Phone } from "./phone";
import { longNote } from "../long-note";

// The notes above a jump's target were never drawn: each renders as a flick
// up reaches it, while iOS owns the scroll (ADR 0013).
test("a flick up from an old date glides on, the text under the thumb moving only with it", async ({ phone }) => {
    await phone.openStream();
    await phone.jumpTo("2026-09-12");
    await phone.shortenPlaceholders();
    await phone.followReader();

    expect(await phone.glideEnding("down")).not.toBe("cut short");

    const { drifts, rendered } = await phone.stopFollowing();
    expect(rendered, "no note above rendered during the glide").toBeGreaterThan(0);
    expect(Math.max(...drifts.map(Math.abs)), `drifts: ${drifts.join(", ")}`).toBeLessThan(5);
});

/** A frame of the stream: its scroll, how far it is drawn off it, and its top below where it rests at the top. */
type Frame = { at: number; top: number; shift: number; streamTop: number };

/** Starts noting each frame, up to 600; `frames` reports them. */
async function recordFrames(phone: Phone): Promise<void> {
    await phone.run(() => {
        const stream = document.querySelector<HTMLElement>(".daily-notes-stream-container")!;
        const pane = stream.parentElement!;
        const below = () => stream.getBoundingClientRect().top - pane.getBoundingClientRect().top;
        // Read at rest, nothing owed: where the stream sits at scroll 0.
        const atTop = below() + pane.scrollTop;
        const frames: Frame[] = [];
        (window as unknown as { streamFrames: Frame[] }).streamFrames = frames;
        const frame = () => {
            frames.push({
                at: performance.now(),
                top: pane.scrollTop,
                shift: parseFloat(stream.style.getPropertyValue("--daily-notes-scroll-shift")) || 0,
                streamTop: below() - atTop,
            });
            if (frames.length < 600) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
}

const frames = (phone: Phone) => phone.run(() => (window as unknown as { streamFrames: Frame[] }).streamFrames);

// Placeholders far too short leave the glide less scroll than lies above. It
// bounced at the top owing the rest, and a pull on the bounce opened
// Obsidian's pull-down action over the stream (D-143). Stopped short, the
// glide halts mid-speed: the cost of estimates too short (D-092).
test("a glide owing the notes above stops before its scroll runs out, the text never jumping", async ({ phone }) => {
    await phone.openStream();
    await phone.jumpTo("2026-09-12");
    await phone.shortenPlaceholders();
    await recordFrames(phone);
    await phone.followReader();

    await phone.flick("down", 2);

    const { drifts } = await phone.stopFollowing();
    const seen = await frames(phone);
    // Still owing and gliding up, the scroll leapt back: the stop wrote it.
    // The page may hear no step for a frame or two before.
    let gliding = false;
    let stopped = false;
    for (const [i, f] of seen.entries()) {
        const before = seen[i - 1];
        if (!before || f.top === before.top) continue;
        if (f.top > before.top && gliding && before.shift !== 0) stopped = true;
        gliding = f.top < before.top;
    }
    expect(stopped, "the glide was stopped owing").toBe(true);
    expect(
        seen.filter((f) => f.shift !== 0 && f.top <= 0),
        "frames at or past the top, owing"
    ).toEqual([]);
    expect(seen.at(-1)!.shift).toBe(0);
    expect(Math.max(...drifts.map(Math.abs)), `drifts: ${drifts.join(", ")}`).toBeLessThan(5);
});

// Notes above shorter than their stored heights, as edited on another device,
// leave the glide more scroll than lies above: the stream, drawn lower,
// reached the pane's top with scroll to spare, and the glide went on into
// blank.
test("a glide that reaches the newest note with scroll to spare stops there", async ({ phone }) => {
    const above = ["Journal/2026-09-28.md", "Journal/2026-09-29.md", "Journal/2026-09-30.md"];
    // Opened afresh: a test before may have shortened what notes reserve.
    await phone.openStream();
    // Edited far from the reader: a rendered note re-renders short at once,
    // or mid-glide, as its metadata catches up.
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
        // A bounce draws the stream below the pane's top; nothing else may.
        const blank = Math.max(...seen.filter((f) => f.top >= 0).map((f) => f.streamTop));
        expect(blank).toBeLessThanOrEqual(1);
        // iOS carries a glide on from a write: the stop held only if the stream never came back down.
        const stopped = seen.findIndex((f) => f.top === 0);
        const after = Math.min(...seen.slice(stopped).map((f) => f.streamTop));
        expect(after, "the glide went on past the stop").toBeGreaterThanOrEqual(-1);
    } finally {
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

// The picker is the platform's: desktop Chromium opens another one, so only
// the phone shows whether a tap on the calendar opens it and a pick comes back.
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

// The keyboard would cover half the list: the reader looks first, then taps.
test("the jump list opens with the keyboard down, and a tap on the query raises it", async ({ phone }) => {
    await phone.openStream();
    await phone.tap('[aria-label="Jump to date"]');
    await expect.poll(() => phone.has(".prompt .suggestion-item")).toBe(true);
    expect(await phone.keyboardShown()).toBe(false);

    await phone.tap(".prompt input.prompt-input");

    await expect.poll(() => phone.keyboardShown()).toBe(true);
    await phone.escape(".prompt input.prompt-input");
    await expect.poll(() => phone.has(".prompt")).toBe(false);
});

// A jump lands on its note's start (ADR 0022). Drawn from its end, as a note
// above the pane is met, the newest landed 130–286 px past its title in 4 of 5.
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
