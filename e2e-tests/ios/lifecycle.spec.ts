import { test, expect, type Phone, type Place } from "./phone";
import { SHORT_NOTE, SHORT_NOTE_WITH_BASE } from "./vault";

test("back from the Home Screen, the stream is where it was, and a flick still glides", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(`.daily-note-block[data-source-path="${SHORT_NOTE}"] .daily-note-content > p`, -20);
    const left = await phone.place();
    await phone.followPlaces("return");

    await phone.background(3);

    const shown = await phone.places();
    expect(shown, "the stream drew no frame on return").not.toEqual([]);
    for (const { path, offset } of shown) {
        expect(path).toBe(left.path);
        // Rounded to either side of a half pixel, which is not a jump.
        expect(Math.abs(offset - left.offset), `shown at ${offset}, left at ${left.offset}`).toBeLessThanOrEqual(1);
    }
    expect((await phone.glide("up")).faults).toEqual([]);
});

// A hidden tab's pane has no size, so every note in it seemed out of range and
// was unloaded (D-222). The switch is made by script: what is tested is the
// pane being hidden, not the tab bar, which differs on an iPhone.
test("back from another tab, the stream is where it was, with its notes still drawn", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(`.daily-note-block[data-source-path="${SHORT_NOTE}"] .daily-note-content > p`, -20);
    const left = await phone.place();
    const drawn = await drawnNotes(phone);
    await phone.runAsync(async (path: string) => {
        await window.app.workspace.getLeaf("tab").openFile(window.app.vault.getFileByPath(path)!, { active: true });
    }, SHORT_NOTE_WITH_BASE);
    try {
        // Longer than the stream waits for the scroll to stop before it
        // unloads.
        await phone.runAsync(() => new Promise((resolve) => setTimeout(resolve, 1000)));

        const shown = await showStreamAndFollow(phone);

        expect(shown, "the stream drew no frame on return").not.toEqual([]);
        for (const { path, offset } of shown) {
            expect(path).toBe(left.path);
            expect(Math.abs(offset - left.offset), `shown at ${offset}, left at ${left.offset}`).toBeLessThanOrEqual(1);
        }
        expect(await drawnNotes(phone)).toEqual(drawn);
    } finally {
        await phone.run(() => window.app.workspace.detachLeavesOfType("markdown"));
    }
});

/** The notes with their content drawn. */
function drawnNotes(phone: Phone): Promise<string[]> {
    return phone.run(() =>
        [...document.querySelectorAll<HTMLElement>(".daily-note-block:not(.is-unloaded)")].map(
            (block) => block.dataset.sourcePath!
        )
    );
}

/**
 * Shows the stream's tab again, then records each place it shows, frame by
 * frame, as `phone.place` reads it, until it has been still for a second.
 */
function showStreamAndFollow(phone: Phone): Promise<Place[]> {
    return phone.runAsync(async () => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        const place = () => {
            const paneTop = pane.getBoundingClientRect().top;
            const first = [...pane.querySelectorAll<HTMLElement>(".daily-note-block")].find(
                (block) => block.getBoundingClientRect().bottom > paneTop
            );
            return first && `${first.dataset.sourcePath}\n${Math.round(first.getBoundingClientRect().top - paneTop)}`;
        };
        window.app.workspace.setActiveLeaf(window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!, {
            focus: true,
        });
        const seen: string[] = [];
        let stillSince = performance.now();
        for (const deadline = performance.now() + 10_000; performance.now() < deadline;) {
            await new Promise(requestAnimationFrame);
            const now = place();
            if (now === undefined) continue;
            if (now !== seen.at(-1)) stillSince = performance.now();
            else if (performance.now() - stillSince > 1000) break;
            seen.push(now);
        }
        return [...new Set(seen)].map((key) => {
            const [path, offset] = key.split("\n");
            return { path: path!, offset: Number(offset) };
        });
    });
}

// The glide up ends at the top while the notes above are rendered. Once the
// glide stops, the stream must not keep the reader's place below the top (ADR
// 0013).
test("after a quit and a jump to an old date, flicks up stop on the newest note, and it stays", async ({ phone }) => {
    await phone.openStream();
    const top = await phone.newestOffset();
    await phone.scrollBy(6000);
    await phone.relaunch();
    // As on a first open, or after a change of width: every note above has an
    // estimated height.
    await phone.forgetHeights();
    await phone.openStream();
    await phone.jumpTo("2026-09-12");

    for (let flicks = 0; flicks < 30 && (await phone.scrollTop()) > 0; flicks++) await phone.flick("down", 3);

    expect(await phone.scrollTop()).toBe(0);
    expect(await phone.newestOffset()).toBe(top);
});
