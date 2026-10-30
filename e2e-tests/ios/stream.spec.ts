import { test, expect, type Phone } from "./phone";
import { EMBEDS_NOTE, LANE_SLOT, LANE_TEXT, STALLERS } from "./vault";

/**
 * How many notes above the stream's end the trip to it starts: more than a
 * batch (`BATCH_SIZE`), so it must load the last one by flicking (D-190).
 */
const NOTES_TO_END = 15;

test("flicks reach the oldest note, each note once, newest first", async ({ phone }) => {
    await phone.openStream();
    const dates = await phone.run(() =>
        window.app.workspace
            .getLeavesOfType("daily-notes-stream-view")[0]
            .view.service.dates()
            .map((date: { format(f: string): string }) => date.format("YYYY-MM-DD"))
    );
    await phone.jumpTo(dates.at(-NOTES_TO_END)!);
    const paths = () =>
        phone.run(() =>
            [...document.querySelectorAll<HTMLElement>(".daily-note-block")].map((block) => block.dataset.sourcePath!)
        );
    expect((await paths()).length, "notes loaded before the flicks").toBeLessThan(dates.length);

    for (let flicks = 0; flicks < 100 && !(await phone.atEnd()); flicks++) await phone.flick("up", 3);

    expect(await phone.atEnd(), "the flicks reached the stream's end").toBe(true);
    const loaded = await paths();
    expect(loaded).toHaveLength(dates.length);
    expect(new Set(loaded).size).toBe(dates.length);
    expect(loaded).toEqual([...loaded].sort().reverse());
});

// With no measured heights, every note grows from its estimate as it is
// rendered, including the Bases (EMBEDS_NOTE in vault.ts) as they fill in (ADR
// 0013). It stops past that note, because the lane below it is plain (D-190).
test("flicks past the embeds note and back change a rendered note's height only as it re-pins", async ({ phone }) => {
    await phone.forgetHeights();
    await phone.openStream();
    const top = (await phone.place()).path;
    await phone.watchPins();

    for (let flicks = 0; flicks < 100 && (await phone.place()).path >= EMBEDS_NOTE; flicks++)
        await phone.flick("up", 3);
    for (let flicks = 0; flicks < 100 && (await phone.place()).path < top; flicks++) await phone.flick("down", 3);

    const { unpinned, rendered } = await phone.stopWatchingPins();
    expect(rendered).toContain(EMBEDS_NOTE);
    expect(unpinned).toEqual([]);
});

/**
 * Three flicks `direction` from `depth` px into `target` in the lane's slot,
 * which holds `markdown` above its plain text. Three, because what stops
 * scrolling stops some flicks, not all (D-085). Each starts the same way, in
 * the same notes (`startInLane`).
 */
async function glidesInLane(
    phone: Phone,
    direction: "up" | "down",
    { markdown = "", target = "", depth = 300, ready = async () => {} } = {}
): Promise<void> {
    await phone.fillSlot(markdown && `${markdown}\n\n${LANE_TEXT}`);
    try {
        for (const flick of [1, 2, 3]) {
            await phone.startInLane(target, depth);
            await ready();
            expect((await phone.glide(direction)).faults, `flick ${flick}`).toEqual([]);
        }
    } finally {
        await phone.fillSlot();
    }
}

// The control: nothing in the glide's way but plain text.
for (const direction of ["up", "down"] as const)
    test(`a flick ${direction} over plain text glides on`, async ({ phone }) => {
        await glidesInLane(phone, direction);
    });

// The things that used to stop scrolling completely within 0.4 s.
test("a flick up over math, Bases, a wide table and code glides on", async ({ phone }) => {
    await glidesInLane(phone, "up", { markdown: STALLERS.join("\n") });
});

for (const [what, target, depth] of [
    ["text", ".daily-note-content > p", -20],
    // A Base is re-rendered on each turn, as cards or as a table.
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

// The finger lands on a Base, which used to stop scrolling where it started.
// Its cards are about 1,250 px tall, so from 300 px in, it fills the screen
// under both strokes.
for (const direction of ["up", "down"] as const)
    test(`a flick ${direction} over a Base deep in the stream glides on`, async ({ phone }) => {
        await glidesInLane(phone, direction, {
            markdown: "### Reading\n\n![[Reading.base]]",
            target: ".daily-note-base",
        });
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

/** A web page taller than its frame, so it could scroll inside it. */
const PAGE = "Pages/Tall page.html";

for (const direction of ["up", "down"] as const)
    test(`a flick ${direction} over a web page in a frame glides on`, async ({ phone }) => {
        const src = await phone.runAsync(async (page: string) => {
            const { vault } = window.app;
            if (!vault.getFolderByPath("Pages")) await vault.createFolder("Pages");
            const lines = Array.from(
                { length: 200 },
                (_, i) => `<p>Line ${i + 1} of a page taller than its frame.</p>`
            );
            await vault.create(page, `<!doctype html><body style="font-size: 20px">${lines.join("")}</body>`);
            return vault.adapter.getResourcePath(page) as string;
        }, PAGE);
        try {
            await glidesInLane(phone, direction, {
                markdown: `A page:\n\n<iframe src="${src}" width="560" height="1500"></iframe>`,
                target: "iframe",
                // The frame loads its page once the stream stops scrolling
                // (D-087).
                ready: () =>
                    expect
                        .poll(() =>
                            phone.run((note: string) => {
                                const frame = document.querySelector<HTMLIFrameElement>(
                                    `.daily-note-block[data-source-path="${note}"] iframe`
                                );
                                const page = frame?.contentDocument?.scrollingElement;
                                return !!page && page.scrollHeight > page.clientHeight;
                            }, LANE_SLOT)
                        )
                        .toBe(true),
            });
        } finally {
            await phone.runAsync(
                async (...paths: string[]) => {
                    for (const path of paths) {
                        const file = window.app.vault.getAbstractFileByPath(path);
                        if (file) await window.app.vault.delete(file, true);
                    }
                },
                PAGE,
                "Pages"
            );
        }
    });
