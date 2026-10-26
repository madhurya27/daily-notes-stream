import { test, expect, type Phone } from "./phone";
import { FREE_DAYS } from "./vault";

/**
 * A trip to the oldest note starts this many notes above it, the length of the
 * default journal.
 */
const TRIP_NOTES = 21;

/**
 * Jumps to the note `TRIP_NOTES` above the oldest, or to the newest. Returns
 * that note's path.
 */
async function startTrip(phone: Phone): Promise<string> {
    const dates = await phone.run(() =>
        window.app.workspace
            .getLeavesOfType("daily-notes-stream-view")[0]
            .view.service.dates()
            .map((date: { format(f: string): string }) => date.format("YYYY-MM-DD"))
    );
    const date = dates[Math.max(0, dates.length - TRIP_NOTES)]!;
    await phone.jumpTo(date);
    return `Journal/${date}.md`;
}

test("flicks reach the oldest note, each note once, newest first", async ({ phone }) => {
    await phone.openStream();
    const total = await phone.run(
        () => window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0].view.service.length
    );
    await startTrip(phone);

    for (let flicks = 0; flicks < 100 && !(await phone.atEnd()); flicks++) await phone.flick("up", 3);

    const paths = await phone.run(() =>
        [...document.querySelectorAll<HTMLElement>(".daily-note-block")].map((block) => block.dataset.sourcePath!)
    );
    expect(paths).toHaveLength(total);
    expect(new Set(paths).size).toBe(total);
    expect(paths).toEqual([...paths].sort().reverse());
});

// With no measured heights, every note grows from its estimate as it is drawn,
// including the Bases (EMBEDS_NOTE in vault.ts) as they fill in (ADR 0013).
test("flicks to the oldest note and back change a rendered note's height only as it re-pins", async ({ phone }) => {
    await phone.forgetHeights();
    await phone.openStream();
    const total = await phone.run(
        () => window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0].view.service.length
    );
    const start = await startTrip(phone);
    await phone.watchPins();

    for (let flicks = 0; flicks < 100 && !(await phone.atEnd()); flicks++) await phone.flick("up", 3);
    for (let flicks = 0; flicks < 100 && (await phone.place()).path < start; flicks++) await phone.flick("down", 3);

    const { unpinned, rendered } = await phone.stopWatchingPins();
    expect(rendered).toBeGreaterThanOrEqual(Math.min(total, TRIP_NOTES));
    expect(unpinned).toEqual([]);
});

// Each flick starts on the newest notes, which hold the things that used to
// stop scrolling completely within 0.4 s (STALLERS in vault.ts).
test("flicks from the top glide on", async ({ phone }) => {
    for (const flick of [1, 2, 3]) {
        await phone.openStream();
        expect(await phone.glideEnding("up"), `flick ${flick}`).not.toBe("cut short");
    }
});

for (const [what, target, depth] of [
    ["text", ".daily-note-content > p", -20],
    // A Base is drawn again on each turn, as cards or as a table.
    ["a Base", ".daily-note-base", 300],
] as const)
    test(`a turn and back leaves what was in view, with ${what} at the top`, async ({ phone }) => {
        await phone.openStream();
        await phone.placeAt(target, depth);
        const seen = await phone.seen();

        // An iPad starts on its side.
        const found = await phone.orientation();
        await phone.turn(found === "PORTRAIT" ? "LANDSCAPE" : "PORTRAIT");
        await phone.turn(found);

        // As e2e-tests/turn.spec.ts allows: one pixel of rounding is not a
        // jump.
        const now = await phone.topOf(seen);
        expect(Math.abs(now - seen.top), `"${seen.text}" moved from ${seen.top} to ${now}`).toBeLessThan(5);
    });

// Deep in the stream, as for a reader looking for an old note. The finger lands
// on a Base, which used to stop scrolling where it started. Its cards are about
// 1,250 px tall, so from 300 px in, it fills the screen under both strokes.
for (const direction of ["up", "down"] as const)
    test(`a flick ${direction} over a Base deep in the stream glides on`, async ({ phone }) => {
        // Three times, because what stops scrolling stops some flicks, not all
        // (D-085). Each from the top, because placeAt looks down the stream,
        // and a scroll may go past the Base.
        for (const flick of [1, 2, 3]) {
            await phone.openStream();
            await phone.placeAt('.daily-note-block[data-source-path="Journal/2026-09-13.md"] .daily-note-base', 300);
            expect(await phone.glideEnding(direction), `flick ${flick}`).not.toBe("cut short");
        }
    });

// A touch dims a link, or shows a date's daily note button, and Obsidian fades
// the change in. When the fade started under the finger, with a blended callout
// further down (the vault has one), it stopped the stream from scrolling
// (D-167).
for (const [what, target] of [
    ["a link in a Base", ".daily-note-base .bases-rendered-value .internal-link"],
    ["a date in a Base", '.daily-note-base [data-property-type="date"] input'],
    ["a date's daily-note button", '.daily-note-base [data-property-type="date"] .clickable-icon'],
    ["a link to a day in a Base", ".daily-note-base .metadata-link-inner"],
    ["a link in a note's text", ".daily-note-content > p .internal-link"],
] as const)
    test(`a swipe that starts on ${what} scrolls the stream`, async ({ phone }) => {
        await phone.openStream();
        await phone.placeAt(target, -300);
        const before = await phone.scrollTop();

        await phone.swipeFrom(target);

        expect(await phone.scrollTop()).toBeGreaterThan(before + 100);
    });

/**
 * A web page taller than its frame, so it could scroll inside it, in a note
 * deep in the stream.
 */
const PAGE = "Pages/Tall page.html";
const FRAMED = FREE_DAYS[0];

for (const direction of ["up", "down"] as const)
    test(`a flick ${direction} over a web page in a frame glides on`, async ({ phone }) => {
        await phone.runAsync(
            async (page: string, note: string) => {
                const { vault } = window.app;
                if (!vault.getFolderByPath("Pages")) await vault.createFolder("Pages");
                const lines = Array.from(
                    { length: 200 },
                    (_, i) => `<p>Line ${i + 1} of a page taller than its frame.</p>`
                );
                await vault.create(page, `<!doctype html><body style="font-size: 20px">${lines.join("")}</body>`);
                const src = vault.adapter.getResourcePath(page);
                await vault.create(note, `A page:\n\n<iframe src="${src}" width="560" height="1500"></iframe>\n`);
            },
            PAGE,
            FRAMED
        );
        try {
            for (const flick of [1, 2, 3]) {
                await phone.openStream();
                await phone.placeAt(`.daily-note-block[data-source-path="${FRAMED}"] iframe`, 300);
                // The frame loads its page once the stream stops scrolling
                // (D-087).
                await expect
                    .poll(() =>
                        phone.run((note: string) => {
                            const frame = document.querySelector<HTMLIFrameElement>(
                                `.daily-note-block[data-source-path="${note}"] iframe`
                            );
                            const page = frame?.contentDocument?.scrollingElement;
                            return !!page && page.scrollHeight > page.clientHeight;
                        }, FRAMED)
                    )
                    .toBe(true);
                expect(await phone.glideEnding(direction), `flick ${flick}`).not.toBe("cut short");
            }
        } finally {
            await phone.runAsync(
                async (...paths: string[]) => {
                    for (const path of paths) {
                        const file = window.app.vault.getAbstractFileByPath(path);
                        if (file) await window.app.vault.delete(file, true);
                    }
                },
                FRAMED,
                PAGE,
                "Pages"
            );
        }
    });
