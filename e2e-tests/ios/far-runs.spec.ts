import { test, expect } from "./phone";
import { longNote } from "../long-note";

const STREAM = ".daily-notes-stream-container";

// A blank screen only shows in a recording (scripts/capture-iphone.swift). This
// checks what causes one: a hidden part's spacer reaching the screen (ADR
// 0021). A stall, or a glide that moves further than the rendering distance in
// one frame, keeps one on screen for a frame, and the next frame shows the part
// (ADR 0023). On an iPad in landscape, the next frame can reach the next hidden
// part, so a part is followed by the element after its spacer.
test(
    "flicks down a long note and back show no hidden part's spacer two frames running",
    { tag: "@portrait" },
    async ({ phone }) => {
        test.setTimeout(300_000);
        const path = await phone.journalPath(1);
        const original = await phone.writeNote(path, longNote(5000));
        try {
            await phone.openStream();
            await phone.jumpTo(path.slice(8, 18));
            await expect
                .poll(() => phone.run(() => document.querySelectorAll(".daily-note-far-run").length), {
                    timeout: 60_000,
                })
                .toBeGreaterThan(0);

            await phone.run(
                (s: string, p: string) => {
                    const w = window as unknown as { spacerFrames: number; drawnFrames: number; counting: boolean };
                    w.spacerFrames = 0;
                    w.drawnFrames = 0;
                    w.counting = true;
                    let onLast = new Set<Element>();
                    const pane = document.querySelector(s)!.parentElement!;
                    const frame = () => {
                        w.drawnFrames++;
                        const { top, bottom } = pane.getBoundingClientRect();
                        const spacers = document.querySelectorAll(`[data-source-path="${p}"] .daily-note-far-run`);
                        const on = new Set(
                            Array.from(spacers)
                                .filter((spacer) => {
                                    const rect = spacer.getBoundingClientRect();
                                    return rect.bottom > top && rect.top < bottom;
                                })
                                .map((spacer) => spacer.nextElementSibling!)
                        );
                        if ([...on].some((part) => onLast.has(part))) w.spacerFrames++;
                        onLast = on;
                        if (w.counting) requestAnimationFrame(frame);
                    };
                    requestAnimationFrame(frame);
                },
                STREAM,
                path
            );
            await phone.flick("up", 8);
            await phone.flick("down", 8);

            // Stops counting, or it would go on through the next tests.
            const { spacerFrames, drawnFrames } = await phone.run(() => {
                const w = window as unknown as { spacerFrames: number; drawnFrames: number; counting: boolean };
                w.counting = false;
                return { spacerFrames: w.spacerFrames, drawnFrames: w.drawnFrames };
            });
            expect(drawnFrames).toBeGreaterThan(100);
            expect(spacerFrames, "frames with a part's spacer on screen since the last").toBe(0);
        } finally {
            await phone.restoreNote(path, original);
        }
    }
);
