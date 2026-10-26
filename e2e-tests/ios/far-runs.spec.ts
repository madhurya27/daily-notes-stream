import { test, expect } from "./phone";
import { longNote } from "../long-note";

const STREAM = ".daily-notes-stream-container";

// A blank screen only shows in a recording (scripts/capture-iphone.swift). This
// checks what causes one: a hidden part's spacer reaching the screen (ADR
// 0021). A pause, or a scroll that moves further than the drawing distance in
// one frame, keeps one on screen for a frame, and the next frame shows the part
// (ADR 0023).
test("flicks down a long note and back show no hidden run's spacer two frames running", async ({ phone }) => {
    test.setTimeout(300_000);
    const path = await phone.journalPath(1);
    const original = await phone.writeNote(path, longNote(5000));
    try {
        await phone.openStream();
        await phone.jumpTo(path.slice(8, 18));
        await expect
            .poll(() => phone.run(() => document.querySelectorAll(".daily-note-far-run").length), { timeout: 60_000 })
            .toBeGreaterThan(0);

        await phone.run(
            (s: string, p: string) => {
                const w = window as unknown as { spacerFrames: number; frames: number };
                w.spacerFrames = 0;
                w.frames = 0;
                let onLast = false;
                const pane = document.querySelector(s)!.parentElement!;
                const frame = () => {
                    w.frames++;
                    const { top, bottom } = pane.getBoundingClientRect();
                    const spacers = document.querySelectorAll(`[data-source-path="${p}"] .daily-note-far-run`);
                    const on = Array.from(spacers).some((spacer) => {
                        const rect = spacer.getBoundingClientRect();
                        return rect.bottom > top && rect.top < bottom;
                    });
                    if (on && onLast) w.spacerFrames++;
                    onLast = on;
                    requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            },
            STREAM,
            path
        );
        await phone.flick("up", 8);
        await phone.flick("down", 8);

        const { spacerFrames, frames } = await phone.run(() => {
            const { spacerFrames, frames } = window as unknown as { spacerFrames: number; frames: number };
            return { spacerFrames, frames };
        });
        expect(frames).toBeGreaterThan(100);
        expect(spacerFrames, "frames with a spacer on screen since the last").toBe(0);
    } finally {
        await phone.restoreNote(path, original);
    }
});
