import { test, expect, openStream, restoreNote, seededDate, todayNote, writeNote } from "./obsidian";

/**
 * A note only draws again the sections a save changed (ADR 0019). What it draws
 * must be the same as drawing the whole saved note.
 */
/**
 * Today's note is drawn by section from the start. An older note is drawn in
 * groups of sections (ADR 0020), then by section after its first save, so its
 * first render is in groups.
 */
const NOTES = [
    ["today's", todayNote],
    ["an older", async () => `Notes/${seededDate(0)}.md`],
] as const;

/** One day of a journal kept in one note, with `n` to tell the days apart. */
function day(n: number): string {
    return [
        `## Day ${n}`,
        "",
        `Walked to the [[Notes|river]] and back, entry ${n}. The light was flat and grey.`,
        "",
        "- coffee with **Sam**",
        "    - talked about the move",
        "- [ ] call the landlord",
        "",
        "```js",
        `const day = ${n};`,
        "```",
        "",
        "| Meal | What |",
        "| --- | --- |",
        "| Lunch | soup |",
        "",
        "> [!note] Mood",
        "> Tired, but fine.",
        "",
    ].join("\n");
}

const DAYS = 40;
const journal = (days = Array.from({ length: DAYS }, (_, i) => day(i))) => days.join("\n");

for (const [which, pathOf] of NOTES) {
    test.describe(`${which} note saved while on screen`, () => {
        let NOTE = "";
        let original: string | null = null;

        test.beforeEach(async ({ obsidian }) => {
            NOTE = await pathOf(obsidian.page);
            original = await writeNote(obsidian.page, NOTE, journal());
        });

        test.afterEach(async ({ obsidian }) => restoreNote(obsidian.page, NOTE, original));

        async function save(page: import("@playwright/test").Page, edit: (text: string) => string) {
            await page.evaluate(
                async ({ path, edit }) => {
                    const file = window.app.vault.getAbstractFileByPath(path);
                    await window.app.vault.process(
                        file,
                        new Function("text", `return (${edit})(text)`) as (t: string) => string
                    );
                },
                { path: NOTE, edit: edit.toString() }
            );
        }

        const content = (page: import("@playwright/test").Page) =>
            page.locator(`.daily-note-block[data-source-path="${NOTE}"] .daily-note-content`);

        test("keeps what a save left alone, and draws what a fresh render draws", async ({ obsidian }) => {
            const { page } = obsidian;
            await openStream(page);
            await expect(content(page)).toContainText("entry 39");

            // Updated in place by the second save at the latest.
            await save(page, (text) => text.replace("entry 3.", "entry 3, edited."));
            await expect(content(page)).toContainText("entry 3, edited.");
            await content(page).evaluate((el) => el.querySelector("h2")!.setAttribute("data-kept", ""));
            await save(page, (text) =>
                text
                    .replace("entry 20.", "entry 20, edited.")
                    .replace("## Day 30", "## Day 30\n\nA paragraph of its own.")
                    .replace(/## Day 35[\s\S]*?(?=## Day 36)/, "")
            );
            await expect(content(page)).toContainText("A paragraph of its own.");
            await expect(content(page)).not.toContainText("entry 35");
            await expect(content(page).locator("h2").first()).toHaveAttribute("data-kept", "");

            // Differences in markup only: drawing the whole note leaves a line
            // break between blocks; Obsidian marks a table's cells with their
            // direction when the table is the only thing it draws, as in a
            // section on its own; and which runs are hidden when far away
            // depends on when it is read (ADR 0021).
            const drawn = () =>
                content(page).evaluate((el) => {
                    const copy = el.cloneNode(true) as HTMLElement;
                    for (const spacer of Array.from(copy.querySelectorAll(".daily-note-far-run"))) spacer.remove();
                    for (const far of Array.from(copy.querySelectorAll(".is-far"))) {
                        far.classList.remove("is-far");
                        if (far.classList.length === 0) far.removeAttribute("class");
                    }
                    for (const node of Array.from(copy.childNodes)) {
                        if (node instanceof Text && !node.data.trim()) node.remove();
                    }
                    return copy.innerHTML.replace(/(<t[hd]) dir="(?:ltr|rtl)"/g, "$1");
                });
            await content(page).evaluate((el) => el.querySelector("[data-kept]")!.removeAttribute("data-kept"));
            // On mobile, any scrolling boxes are cut off once the stream stops
            // scrolling.
            let inPlace = "";
            await expect
                .poll(async () => {
                    const before = inPlace;
                    await page.waitForTimeout(1000);
                    inPlace = await drawn();
                    return inPlace === before;
                })
                .toBe(true);
            await openStream(page);
            await expect(content(page)).toContainText("A paragraph of its own.");
            // Code blocks and links finish drawing after the note itself.
            await expect.poll(drawn).toBe(inPlace);
        });

        test("draws the properties a save added above its text, the text kept", async ({ obsidian }) => {
            const { page } = obsidian;
            await openStream(page);
            await save(page, (text) => text.replace("entry 3.", "entry 3, edited."));
            await expect(content(page)).toContainText("entry 3, edited.");
            await content(page).evaluate((el) => el.querySelector("h2")!.setAttribute("data-kept", ""));

            await save(page, (text) => `---\nmood: tired\n---\n${text}`);

            const properties = page.locator(`.daily-note-block[data-source-path="${NOTE}"] .metadata-container`);
            await expect(properties).toContainText("tired");
            await expect(properties).toHaveCount(1);
            expect(await properties.evaluate((el) => el.nextElementSibling!.matches(".daily-note-content"))).toBe(true);
            await expect(content(page).locator("h2").first()).toHaveAttribute("data-kept", "");
        });

        test("keeps a collapsed section collapsed over what a save drew in it", async ({ obsidian }) => {
            const { page } = obsidian;
            await openStream(page);
            await save(page, (text) => text.replace("entry 3.", "entry 3, edited."));
            await expect(content(page)).toContainText("entry 3, edited.");

            const day5 = content(page).locator("h2", { hasText: "Day 5" });
            await day5.locator(".collapse-indicator").click();
            await save(page, (text) => text.replace("entry 5.", "entry 5, edited."));

            const edited = content(page).locator("p", { hasText: "entry 5, edited." });
            await expect(edited).toBeAttached();
            await expect(edited).toBeHidden();
            await expect(day5.locator(".collapse-indicator")).toHaveAttribute("aria-expanded", "false");
            await day5.locator(".collapse-indicator").click();
        });
    });
}
