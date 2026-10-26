import { test, expect, type Phone } from "./phone";
import { A_MONTH, KANBAN, KANBAN_FILE, MIDDLE, SHORT_KANBAN, SHORT_NOTE } from "./vault";

/** A file the Base lists, because it shows every note in `Books/`. */
const NEW_ROW = "Books/A new book.md";

const after = `.daily-note-block[data-source-path="${SHORT_NOTE}"] .daily-note-title`;

/**
 * The places a list went through, with repeats of the same place counted once.
 */
const path = (tops: number[]) => tops.filter((top, i) => top !== tops[i - 1]);

/** Whether the places only moved in one direction, with none coming back. */
const oneWay = (tops: number[]) => {
    const steps = path(tops).flatMap((top, i, all) => (i === 0 ? [] : [Math.sign(top - all[i - 1]!)]));
    return steps.every((step) => step === steps[0]);
};

/**
 * Where on screen the text the reader follows was, on each frame, while another
 * pane adds a row to every `Reading.base`.
 */
async function placesAsARowIsAdded(phone: Phone): Promise<number[]> {
    await phone.followReader();
    try {
        // Return nothing, because a TFile links to the whole vault, which is
        // too much for the driver to send.
        await phone.runAsync(async (path: string) => {
            await window.app.vault.create(path, "author: Someone new\n");
        }, NEW_ROW);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return (await phone.stopFollowing()).moves;
    } finally {
        await phone.runAsync(async (path: string) => {
            await window.app.vault.delete(window.app.vault.getFileByPath(path)!);
        }, NEW_ROW);
    }
}

test("a Base on screen gains a row: the text below it never jumps and returns", async ({ phone }) => {
    await phone.openStream();
    // The Base's end on screen, and the next note's text in the middle of the
    // pane.
    await phone.placeAt(after, -400);

    const tops = await placesAsARowIsAdded(phone);

    expect(oneWay(tops), `on screen at ${path(tops).join(", ")}`).toBe(true);
});

// Bases empties a view and fills it again as it draws it again, now one row
// taller. Above the top of the screen, only the stream's anchor stops that from
// moving the text in view.
test("a Base gaining a row just above the screen's top leaves the text below still", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(after, 50);
    expect(await phone.atTop(".daily-note-base"), "the Base reaches into the screen").toBe(false);

    const tops = await placesAsARowIsAdded(phone);

    expect(Math.max(...tops.map(Math.abs)), `on screen at ${path(tops).join(", ")}`).toBeLessThan(2);
});

// Bases fills a view in a task of its own, which moves the text below it inside
// its note with a fixed height. While scrolling, a scroll event can come before
// the report that fixes the note's height again. Both are made here, in that
// order, in one task.
test("a Base filling in above the screen's top, a scroll before its report, leaves the next note still", async ({
    phone,
}) => {
    await phone.openStream();
    await phone.jumpTo(SHORT_NOTE.slice("Journal/".length, -".md".length));
    const { scrolled, reported } = await phone.runAsync(
        async (title: string, slot: string) => {
            const pane = document.querySelector(title)!.closest(".view-content")!;
            const top = () =>
                Math.round(
                    document.querySelector(title)!.getBoundingClientRect().top - pane.getBoundingClientRect().top
                );
            const frame = () => new Promise((done) => requestAnimationFrame(done));
            const filled = document.createElement("div");
            filled.style.height = "600px";
            document.querySelector(slot)!.append(filled);
            pane.scrollTop -= 100;
            pane.dispatchEvent(new Event("scroll"));
            const scrolled = top();
            await frame();
            await frame();
            return { scrolled, reported: top() };
        },
        after,
        SHORT_KANBAN
    );

    expect(reported).toBe(scrolled);
});

/**
 * A table whose headers fit a phone but whose values do not. Only the drawn
 * table shows that it is too wide.
 */
const VALUES_WIDE = [
    A_MONTH + "formulas:",
    ...["a", "b", "c", "d"].map((formula) => `  ${formula}: file.path + " " + file.path`),
    "views:",
    "  - type: table",
    "    name: Values",
    "    order:",
    ...["a", "b", "c", "d"].map((formula) => `      - formula.${formula}`),
    "",
].join("\n");

/**
 * Where on screen the text the reader follows was, on each frame, while `file`
 * is written again as `body`, and its copy in `slot` is drawn again and
 * measured again: as written, then as cards (D-033). The file is restored
 * afterwards.
 */
async function placesAsRedrawn(phone: Phone, slot: string, file: string, body: (was: string) => string) {
    const was = await phone.runAsync(
        (path: string): Promise<string> => window.app.vault.cachedRead(window.app.vault.getFileByPath(path)!),
        file
    );
    const write = (body: string) =>
        phone.runAsync(
            async (path: string, body: string) => {
                await window.app.vault.modify(window.app.vault.getFileByPath(path)!, body);
            },
            file,
            body
        );
    // Whether it was drawn as written on the way, because drawing again is over
    // within a frame or two.
    await phone.run((slot: string) => {
        const el = document.querySelector(slot)!;
        const seen = new MutationObserver(() => {
            if (!el.querySelector('.bases-view:not([data-view-type="cards"])')) return;
            el.setAttribute("data-drew-as-written", "");
            seen.disconnect();
        });
        seen.observe(el, { childList: true, subtree: true });
    }, slot);
    await phone.followReader();
    try {
        await phone.run(() => window.app.plugins.plugins["daily-notes-stream"].layoutMemory.bases.restore(null));
        await write(body(was));
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const tops = (await phone.stopFollowing()).moves;
        expect(await phone.has(`${slot}[data-drew-as-written]`), "drawn as written first").toBe(true);
        expect(await phone.has(`${slot} .bases-view[data-view-type="cards"]`), "then as cards").toBe(true);
        return tops;
    } finally {
        await write(was);
    }
}

// Measured again, a kanban is drawn as a board, then again as cards (D-107).
// Above the top of the screen, only the stream's anchor keeps the text in view
// still.
test("a kanban redrawn as cards just above the screen's top leaves the next note still", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(after, 50);
    expect(await phone.atTop(".daily-note-base"), "a Base reaches into the screen").toBe(false);

    const tops = await placesAsRedrawn(phone, SHORT_KANBAN, KANBAN_FILE, (was) => `${was}# Changed\n`);

    expect(Math.max(...tops.map(Math.abs)), `on screen at ${path(tops).join(", ")}`).toBeLessThan(2);
});

// Drawing again changes the Base's height inside a note with a fixed height.
// The note's height is fixed again, and the anchor shifts, in the task that
// changed it (ADR 0013).
for (const [what, slot, file, body] of [
    ["a table", MIDDLE, "Bases/Middle.base", () => VALUES_WIDE],
    ["a kanban", KANBAN, KANBAN_FILE, (was: string) => `${was}# Changed\n`],
] as const)
    test(`${what} redrawn as cards above the screen's top leaves the text below it in its note still`, async ({
        phone,
    }) => {
        await phone.openStream();
        await phone.placeAt(`${slot} ~ h2`, -200);
        expect(await phone.atTop(slot), "the Base reaches into the screen").toBe(false);

        const tops = await placesAsRedrawn(phone, slot, file, body);

        expect(Math.max(...tops.map(Math.abs)), `on screen at ${path(tops).join(", ")}`).toBeLessThan(2);
    });
