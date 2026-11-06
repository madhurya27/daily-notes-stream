import type { Page } from "@playwright/test";
import { test, expect, openStream, withoutScrollAnchoring, restoreScrollAnchoring } from "./obsidian";

const READ = "Notes/2026-03-11.md";
const OTHER = "Notes/2026-03-09.md";

/**
 * A hidden tab's pane has no size, so every note in it seems out of range and
 * its width seems to be 0. The reader comes back to the stream as it was.
 */
test.describe("switching to another tab and back", () => {
    test.afterEach(({ obsidian }) =>
        obsidian.page.evaluate(() =>
            window.app.workspace.getLeavesOfType("markdown").forEach((leaf: { detach(): void }) => leaf.detach())
        )
    );

    test("keeps the reader's place", async ({ obsidian }) => {
        const { page } = obsidian;
        await openAtNote(page);
        const before = await place(page);

        await switchTabs(page);

        expect(await place(page)).toEqual(before);
    });

    test.describe("where the platform has no scroll anchoring", () => {
        test.beforeEach(({ obsidian }) => withoutScrollAnchoring(obsidian.page));
        test.afterEach(({ obsidian }) => restoreScrollAnchoring(obsidian.page));

        test("keeps the reader's place", async ({ obsidian }) => {
            const { page } = obsidian;
            await openAtNote(page);
            const before = await place(page);

            await switchTabs(page);

            expect(await place(page)).toEqual(before);
        });
    });
});

/**
 * Opens the stream with `READ` a fifth of the way down the pane. The notes
 * above it render and grow as it is reached, so it is placed again until it
 * stays.
 */
async function openAtNote(page: Page): Promise<void> {
    const container = await openStream(page);
    const block = container.locator(`.daily-note-block[data-source-path="${READ}"]`);
    await expect(block).toBeAttached();
    await expect
        .poll(() =>
            block.evaluate((el) => {
                const pane = el.closest(".view-content")!;
                const off = el.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight * 0.2;
                pane.scrollTop += off;
                return Math.abs(off) < 1;
            })
        )
        .toBe(true);
    // Until the scroll counts as stopped, and what waited for that is done.
    await page.waitForTimeout(1000);
}

/** The note a third of the way down the pane, and the scroll. */
function place(page: Page) {
    return page.evaluate(() => {
        const pane = document.querySelector('[data-type="daily-notes-stream-view"] .view-content')!;
        const line = pane.getBoundingClientRect().top + pane.clientHeight / 3;
        const at = [...pane.querySelectorAll(".daily-note-block")].find((block) => {
            const box = block.getBoundingClientRect();
            return box.top <= line && box.bottom > line;
        });
        return { note: at?.getAttribute("data-source-path"), scrollTop: pane.scrollTop };
    });
}

/**
 * Opens a note in a new tab, then shows the stream again once the hidden
 * stream has had time to unload what it thought was far, and to settle after.
 */
async function switchTabs(page: Page): Promise<void> {
    await page.evaluate(async (path) => {
        await window.app.workspace.getLeaf("tab").openFile(window.app.vault.getFileByPath(path)!, { active: true });
    }, OTHER);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
        window.app.workspace.setActiveLeaf(window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!, {
            focus: true,
        });
    });
    await page.waitForTimeout(1500);
}
