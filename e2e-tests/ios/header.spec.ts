import { test, expect, type Phone } from "./phone";

const HEADER = '.workspace-leaf-content[data-type="daily-notes-stream-view"] .view-header';
/** An old note. Every note between it and the top was never drawn. */
const OLD = "2026-09-10";

test("a tap on the title glides to the newest note and holds it at the very top", async ({ phone }) => {
    await phone.openStream();
    const top = await phone.newestOffset();
    await phone.jumpTo(OLD);

    await phone.tap(`${HEADER} .view-header-title`);
    await phone.rest();

    expect(await phone.scrollTop()).toBe(0);
    expect(await phone.newestOffset()).toBe(top);
});

/** Each action, and the input that shows it opened. */
for (const [action, opened] of [
    ["Search", ".daily-notes-search:not(.is-closed) input"],
    ["Jump to date", ".prompt input"],
] as const)
    test(`a tap on ${action} leaves the scroll alone`, async ({ phone }) => {
        await phone.openStream();
        await phone.jumpTo(OLD);
        const before = await phone.scrollTop();

        await phone.tap(`${HEADER} .view-action[aria-label="${action}"]`);
        await expect.poll(() => phone.has(opened), `${action} did not open`).toBe(true);
        await phone.rest();

        // As the turn checks allow: one pixel of rounding is not a jump.
        expect(Math.abs((await phone.scrollTop()) - before)).toBeLessThan(5);
        await phone.escape(opened);
        await expect.poll(() => phone.has(opened)).toBe(false);
    });

/**
 * A day's entries, `lines` long: headings, prose, lists, tasks, code and a
 * table.
 */
function longNote(lines: number): string {
    const entry = (n: number) => [
        `## Entry ${n}`,
        "",
        `Walked to the river and back, entry ${n}. The light was flat and grey, the kind that makes everything look closer.`,
        "",
        "- coffee with **Sam**, talked about the move",
        "    - the boxes, again",
        "- [ ] call the landlord",
        "",
        "```js",
        `const total = ${n};`,
        "```",
        "",
        "| Meal | What |",
        "| --- | --- |",
        "| Lunch | soup |",
        "",
    ];
    return Array.from({ length: Math.ceil(lines / 16) }, (_, n) => entry(n))
        .flat()
        .slice(0, lines)
        .join("\n");
}

/**
 * Writes each of `notes`, given as `[days back, lines]`, as a long note.
 * Returns what to restore.
 */
async function writeNotes(phone: Phone, notes: readonly (readonly [number, number])[]): Promise<Written[]> {
    const written: Written[] = [];
    for (const [back, lines] of notes) {
        const path = await phone.journalPath(back);
        written.push({ path, original: await phone.writeNote(path, longNote(lines)) });
    }
    return written;
}

type Written = { path: string; original: string | null };

async function restoreNotes(phone: Phone, written: Written[]): Promise<void> {
    for (const { path, original } of written) await phone.restoreNote(path, original);
}

/**
 * Notes as `[days back, lines]`, and whether the reader has scrolled past them
 * before, so their heights are known (ADR 0020).
 */
const CASES = [
    {
        // The scroll up went past a 10,000-line note, which kept drawing to its
        // end for a second after it had gone by, while the top of the stream
        // stayed blank. Measured: 750–1,170 ms, and none once it gives up.
        name: "a tap on the title over long notes draws the newest at once",
        notes: [
            [0, 5000],
            [2, 10000],
            [3, 1000],
        ],
        measured: true,
        within: 400,
    },
    {
        // Under a short newest note, a long note never measured is within the
        // drawing distance when the scroll ends, and it drew to its end first.
        // Measured: 333–341 ms, and 44–49 ms once a note on screen is drawn
        // before it.
        name: "a tap on the title draws a short newest note before a long one near it",
        notes: [
            [0, 30],
            [1, 10000],
            [3, 1000],
        ],
        measured: false,
        within: 200,
    },
] as const;

for (const { name, notes, measured, within } of CASES)
    test(name, async ({ phone }) => {
        const written = await writeNotes(phone, notes);
        try {
            if (!measured) await phone.forgetHeights();
            await phone.openStream();
            // Each is drawn once, so its height is known, as for a reader who
            // has scrolled past them.
            if (measured) for (const { path } of written) await phone.jumpTo(path.slice(8, 18));
            const fourth = await phone.run(
                () => document.querySelectorAll<HTMLElement>(".daily-note-block")[3]!.dataset.sourcePath!
            );
            await phone.placeAt(`.daily-note-block[data-source-path="${fourth}"]`, 0);
            // Far past it, the newest note is emptied once scrolling stops, so
            // the tap makes it draw again.
            await expect
                .poll(() =>
                    phone.run(
                        (path: string) =>
                            document
                                .querySelector(`.daily-note-block[data-source-path="${path}"]`)!
                                .classList.contains("is-unloaded"),
                        written[0]!.path
                    )
                )
                .toBe(true);
            await phone.run(() => {
                const w = window as unknown as { atTop?: number; drawnAtTop?: number };
                delete w.atTop;
                delete w.drawnAtTop;
                const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
                const watch = () => {
                    const now = performance.now();
                    if (pane.scrollTop <= 0) w.atTop ??= now;
                    const r = pane.getBoundingClientRect();
                    const el = document.elementFromPoint(r.left + r.width / 2, r.top + 150);
                    if (w.atTop !== undefined && el?.closest(".daily-note-content")) w.drawnAtTop = now;
                    else requestAnimationFrame(watch);
                };
                requestAnimationFrame(watch);
            });

            await phone.tap(`${HEADER} .view-header-title`);
            // The driver returns undefined as null.
            await expect
                .poll(() => phone.run(() => (window as unknown as { drawnAtTop?: number }).drawnAtTop ?? 0))
                .toBeGreaterThan(0);

            const waited = await phone.run(() => {
                const w = window as unknown as { atTop: number; drawnAtTop: number };
                return w.drawnAtTop - w.atTop;
            });
            expect(waited).toBeLessThan(within);
        } finally {
            await restoreNotes(phone, written);
        }
    });

// Scrolling up from inside it draws it from its end (ADR 0022), and it finishes
// with the scroll at the top. When the place was kept by the text drawn there,
// it ended up 156 px below its title in 3 out of 4 runs.
test("a tap on the title from inside a long newest note glides to its title", async ({ phone }) => {
    await phone.openStream();
    const top = await phone.newestOffset();
    const written = await writeNotes(phone, [[0, 10000]]);
    try {
        await phone.flick("up", 3);

        await phone.tap(`${HEADER} .view-header-title`);
        await phone.rest();

        expect(await phone.scrollTop()).toBe(0);
        expect(await phone.newestOffset()).toBe(top);
    } finally {
        await restoreNotes(phone, written);
    }
});
