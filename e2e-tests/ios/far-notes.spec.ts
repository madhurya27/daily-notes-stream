import { test, expect } from "./phone";

const STREAM = ".daily-notes-stream-container";

// Like e2e-tests/ios/far-runs.spec.ts for a long note's parts: a note hidden
// because it is far away keeps its height but shows nothing, so one on screen
// is a blank. A stall may keep one on screen for a frame, and the next frame
// shows it (ADR 0023). Turning back within the unloading distance, the reader
// finds the notes it hid, not unloaded ones.
test(
    "flicks back up to notes hidden on the way down show none two frames running",
    { tag: "@portrait" },
    async ({ phone }) => {
        await phone.openStream();
        await phone.run((s: string) => {
            const w = window as unknown as { hiddenFrames: number; drawnFrames: number; counting: boolean };
            w.hiddenFrames = 0;
            w.drawnFrames = 0;
            w.counting = true;
            let onLast = false;
            const pane = document.querySelector(s)!.parentElement!;
            const frame = () => {
                w.drawnFrames++;
                const { top, bottom } = pane.getBoundingClientRect();
                const hidden = Array.from(document.querySelectorAll(".daily-note-block.is-far"));
                const on = hidden.some((block) => {
                    const rect = block.getBoundingClientRect();
                    return rect.bottom > top && rect.top < bottom;
                });
                if (on && onLast) w.hiddenFrames++;
                onLast = on;
                if (w.counting) requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        }, STREAM);

        const pane = await phone.run((s: string) => document.querySelector(s)!.parentElement!.clientHeight, STREAM);
        for (let flicks = 0; flicks < 20 && (await phone.scrollTop()) < 8 * pane; flicks++)
            await phone.flick("up", 1, { share: 0.4 });
        expect(await phone.run(() => document.querySelectorAll(".daily-note-block.is-far").length)).toBeGreaterThan(0);
        for (let flicks = 0; flicks < 20 && (await phone.scrollTop()) > 0; flicks++) await phone.flick("down", 1);

        // Stops counting, or it would go on through the next tests.
        const { hiddenFrames, drawnFrames } = await phone.run(() => {
            const w = window as unknown as { hiddenFrames: number; drawnFrames: number; counting: boolean };
            w.counting = false;
            return { hiddenFrames: w.hiddenFrames, drawnFrames: w.drawnFrames };
        });
        expect(drawnFrames).toBeGreaterThan(100);
        expect(hiddenFrames, "frames with a hidden note on screen since the last").toBe(0);
    }
);
