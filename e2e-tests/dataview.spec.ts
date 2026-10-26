import type { Locator } from "@playwright/test";
import { installDataview } from "./dataview";
import { test, expect, openStream } from "./obsidian";

/** Newer than every test note, so it is first in the stream. */
const NOTE = "Notes/2026-03-15.md";

/**
 * A table wider than a phone, as each of Dataview's two query languages draws
 * it, and a list.
 */
const QUERIES = [
    "```dataview",
    'TABLE file.ctime, file.mtime, file.size, file.folder, file.path FROM "Notes"',
    "```",
    "",
    "```dataviewjs",
    `dv.table(["File", "Created", "Modified", "Size", "Folder", "Path"], dv.pages('"Notes"').map((p) => [p.file.link, p.file.ctime, p.file.mtime, p.file.size, p.file.folder, p.file.path]))`,
    "```",
    "",
    "```dataview",
    'LIST FROM "Notes" LIMIT 3',
    "```",
    "",
].join("\n");

let uninstall: () => Promise<void>;

test.beforeEach(async ({ obsidian }) => {
    uninstall = await installDataview(obsidian.page);
    await obsidian.page.evaluate(
        async ({ note, body }) => {
            await window.app.vault.create(note, body);
        },
        { note: NOTE, body: QUERIES }
    );
});

test.afterEach(async ({ obsidian }) => {
    await obsidian.page.evaluate(async (note) => {
        const file = window.app.vault.getAbstractFileByPath(note);
        if (file) await window.app.vault.delete(file);
    }, NOTE);
    await uninstall();
});

/** The note's Dataview blocks, once each has drawn. */
async function openQueries(page: Parameters<typeof openStream>[0]): Promise<Locator> {
    const note = (await openStream(page)).locator(".daily-note-block").first();
    await expect(note.locator(".block-language-dataview table")).toBeVisible();
    await expect(note.locator(".block-language-dataviewjs table")).toBeVisible();
    await expect(note.locator(".block-language-dataview ul")).toBeVisible();
    return note;
}

test("never scrolls the page sideways", async ({ obsidian }) => {
    const note = await openQueries(obsidian.page);

    await expect
        .poll(() =>
            note.evaluate((el) => el.closest(".view-content")!.scrollWidth - el.closest(".view-content")!.clientWidth)
        )
        .toBeLessThanOrEqual(0);
});

// Dataview's own stylesheet makes its blocks scroll (ADR 0008).
test("on mobile, draws no scroll box around a query", async ({ obsidian, mobileLayout }) => {
    test.skip(!mobileLayout, "desktop keeps its scroll bars");
    const note = await openQueries(obsidian.page);

    // The stylesheet alone must cut off a block, because the guard only cuts it
    // off once scrolling stops, unless Obsidian set the overflow inline
    // (D-172).
    const boxes = await note.evaluate((root) =>
        Array.from(root.querySelectorAll(".block-language-dataview, .block-language-dataviewjs"))
            .filter((el) => {
                el.classList.remove("is-scroll-clipped");
                const style = getComputedStyle(el);
                return /auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`);
            })
            .map((el) => el.className)
    );

    expect(boxes).toEqual([]);
});

// Dataview draws its table after the note is drawn.
test("on mobile, stacks a query's table too wide for the note", async ({ obsidian, mobileLayout }) => {
    test.skip(!mobileLayout, "desktop keeps a table a table");
    const note = await openQueries(obsidian.page);

    for (const table of await note.locator("table").all()) {
        await expect(table).toHaveClass(/is-stacked/);
        await expect(table.locator("tbody td").first()).toHaveAttribute("data-column", "File");
    }
});
