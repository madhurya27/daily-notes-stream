import type { Page } from "@playwright/test";
import {
    test,
    expect,
    openStream,
    restoreNote,
    seededDate,
    setHideEmptyNotes,
    writeNote,
    SEEDED_DAYS,
    STREAM,
} from "./obsidian";

/** Past the first batch of ten, so reaching it has to load more. */
const OLDEST = `Notes/${seededDate(SEEDED_DAYS - 1)}.md`;
/** Older than every seeded note, and holding nothing. */
const EMPTY_NOTE = "Notes/2020-01-01.md";

/** Opens `path` in the current tab, as a click in the file explorer does. */
async function openNote(page: Page, path: string) {
    await page.evaluate(async (path) => {
        await window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath(path)!);
    }, path);
    await expect.poll(() => page.evaluate(() => window.app.workspace.getActiveFile()?.path)).toBe(path);
}

/** How far the top of `path`'s block is from the top of the pane. */
function distanceFromTop(page: Page, path: string) {
    return page.locator(`${STREAM} .daily-note-block[data-source-path="${path}"]`).evaluate((el) => {
        const scroller = el.closest(".daily-notes-stream-container")!.parentElement!;
        return Math.abs(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
    });
}

test.describe("show in stream", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => {
            window.app.workspace.detachLeavesOfType("daily-notes-stream-view");
            window.app.workspace.detachLeavesOfType("markdown");
        });
    });

    test("opens the stream in the note's tab, at the note, and Back returns to the note", async ({ obsidian }) => {
        const { page } = obsidian;
        await openNote(page, OLDEST);

        await page.evaluate(() => window.app.commands.executeCommandById("daily-notes-stream:show-in-stream"));

        await expect(page.locator(STREAM)).toBeVisible();
        await expect.poll(() => distanceFromTop(page, OLDEST)).toBeLessThan(40);
        // The note's tab became the stream; no tab was added.
        expect(await page.evaluate(() => window.app.workspace.getLeavesOfType("markdown").length)).toBe(0);

        await page.evaluate(() => window.app.commands.executeCommandById("app:go-back"));
        await expect(page.locator(STREAM)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.app.workspace.getActiveFile()?.path)).toBe(OLDEST);
    });

    test("offers it in the file explorer's menu, and opens the stream there", async ({ obsidian }) => {
        const { page } = obsidian;
        // A native menu (the macOS default) is never in the DOM, so it cannot
        // be read.
        await page.evaluate(() => window.app.vault.setConfig("nativeMenus", false));
        try {
            await openNote(page, OLDEST);
            await page.evaluate(() => window.app.commands.executeCommandById("file-explorer:reveal-active-file"));

            await page.locator(`.nav-file-title[data-path="${OLDEST}"]`).click({ button: "right" });
            await page.locator(".menu").getByText("Show in stream").click();

            await expect.poll(() => distanceFromTop(page, OLDEST)).toBeLessThan(40);
        } finally {
            await page.evaluate(() => window.app.vault.setConfig("nativeMenus", null));
        }
    });

    // No stream has read the note yet, so only reading it now can tell that
    // it is hidden (D-218).
    test("says why, and stays on the note, when the stream hides it", async ({ obsidian }) => {
        const { page } = obsidian;
        await setHideEmptyNotes(page, true);
        const before = await writeNote(page, EMPTY_NOTE, "");
        try {
            await openNote(page, EMPTY_NOTE);

            await page.evaluate(() => window.app.commands.executeCommandById("daily-notes-stream:show-in-stream"));

            await expect(
                page.locator(".notice").getByText("This note is hidden from the stream because it's empty.")
            ).toBeVisible();
            await expect(page.locator(STREAM)).toHaveCount(0);
            expect(await page.evaluate(() => window.app.workspace.getActiveFile()?.path)).toBe(EMPTY_NOTE);
        } finally {
            await page.evaluate(() => document.querySelectorAll(".notice").forEach((notice) => notice.remove()));
            await restoreNote(page, EMPTY_NOTE, before);
            await setHideEmptyNotes(page, false);
        }
    });

    test("is not in the palette while the stream is the active tab", async ({ obsidian }) => {
        const { page } = obsidian;
        await openNote(page, OLDEST);
        await page.evaluate(() => window.app.commands.executeCommandById("daily-notes-stream:show-in-stream"));
        await expect(page.locator(STREAM)).toBeVisible();

        // executeCommandById reports true whether or not the command ran.
        const offered = await page.evaluate(() =>
            window.app.commands.findCommand("daily-notes-stream:show-in-stream").checkCallback(true)
        );

        expect(offered).toBe(false);
    });
});
