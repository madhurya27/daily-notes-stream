import type { Page } from "@playwright/test";
import { test, expect, openStream } from "./obsidian";

/**
 * What Obsidian's status bar and a phone's file info describe, or null for
 * nothing.
 */
function activeFile(page: Page) {
    return page.evaluate(() => window.app.workspace.getActiveFile()?.path ?? null);
}

test.describe("status bar", () => {
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
    });

    test("stops describing the last note once the stream has focus", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const wordCount = page.locator(".status-bar-item.plugin-word-count");
        await page.evaluate(async () => {
            await window.app.workspace.getLeaf("tab").openFile(window.app.vault.getFileByPath("Reading list.md")!);
        });
        await expect
            .poll(() => page.evaluate(() => window.app.workspace.getActiveFile()?.path))
            .toBe("Reading list.md");

        await page.evaluate(() => {
            const stream = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!;
            window.app.workspace.setActiveLeaf(stream, { focus: true });
        });

        // A phone has no status bar, so there the check is only the active
        // file.
        await expect.poll(() => activeFile(page)).toBeNull();
        await expect(wordCount).toBeHidden();
        await expect(page.locator(".status-bar-item.plugin-backlink")).toBeHidden();
    });
});
