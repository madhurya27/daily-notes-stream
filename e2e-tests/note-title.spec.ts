import type { Page } from "@playwright/test";
import { test, expect, openStream } from "./obsidian";

/**
 * Where each open note is: its path, and whether its leaf is in the stream's
 * tab group.
 */
function openNotes(page: Page) {
    return page.evaluate(() => {
        const stream = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0];
        return window.app.workspace
            .getLeavesOfType("markdown")
            .map((leaf: { view: { file?: { path: string } }; parent: unknown }) => ({
                path: leaf.view.file?.path,
                besideStream: leaf.parent === stream?.parent,
            }));
    });
}

async function streamIsOpen(page: Page) {
    return page.evaluate(() => window.app.workspace.getLeavesOfType("daily-notes-stream-view").length > 0);
}

test.describe("note title", () => {
    // Tests share the instance, so a note left open would cover the next test's
    // stream.
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
    });

    test("matches the size of the note's own inline title, at any text size", async ({ obsidian }) => {
        const { page } = obsidian;
        // Not the 16px default, so a title sized from anything other than the
        // text size would show up.
        await page.evaluate(() => document.body.style.setProperty("--font-text-size", "21px"));
        const fontSize = (el: Element) => getComputedStyle(el).fontSize;

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-14.md");
            await window.app.workspace.getLeaf(false).openFile(file!);
        });
        const inlineTitle = page.locator(".workspace-leaf.mod-active .inline-title").first();
        await expect(inlineTitle).toBeVisible();
        const native = await inlineTitle.evaluate(fontSize);

        const container = await openStream(page);
        const stream = await container.locator(".daily-note-title").first().evaluate(fontSize);
        await page.evaluate(() => document.body.style.removeProperty("--font-text-size"));

        expect(stream).toBe(native);
    });

    test("opens the note in the stream's tab, which Back returns to", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        await container.locator(".daily-note-title").first().click();

        await expect
            .poll(async () => (await openNotes(page)).map((n: { path?: string }) => n.path))
            .toEqual(["Notes/2026-03-14.md"]);
        expect(await streamIsOpen(page)).toBe(false);
        await page.evaluate(() => window.app.commands.executeCommandById("app:go-back"));
        await expect.poll(() => streamIsOpen(page)).toBe(true);
    });

    test("opens the note in a split when mod-alt-clicked", async ({ obsidian, mobileLayout }) => {
        test.skip(mobileLayout, "a phone has no splits");
        const { page } = obsidian;
        const container = await openStream(page);

        await container
            .locator(".daily-note-title")
            .first()
            .click({ modifiers: ["ControlOrMeta", "Alt"] });

        await expect.poll(() => openNotes(page)).toEqual([{ path: "Notes/2026-03-14.md", besideStream: false }]);
    });

    test("opens the note in a new tab when mod-clicked, keeping the stream", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        await container
            .locator(".daily-note-title")
            .first()
            .click({ modifiers: ["ControlOrMeta"] });

        await expect.poll(() => openNotes(page)).toEqual([{ path: "Notes/2026-03-14.md", besideStream: true }]);
    });

    test("opens the note in a new tab when middle-clicked, keeping the stream", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        await container.locator(".daily-note-title").first().click({ button: "middle" });

        await expect.poll(() => openNotes(page)).toEqual([{ path: "Notes/2026-03-14.md", besideStream: true }]);
    });

    test("offers the file menu on right-click", async ({ obsidian, mobileLayout }) => {
        const { page } = obsidian;
        // A native menu (the macOS default) is never in the DOM, so it cannot
        // be read.
        await page.evaluate(() => window.app.vault.setConfig("nativeMenus", false));
        const container = await openStream(page);

        await container.locator(".daily-note-title").first().click({ button: "right" });

        const menu = page.locator(".menu");
        await expect(menu.getByText("Open in new tab")).toBeVisible();
        // Added by Obsidian's own file menu handlers, not by the plugin.
        await expect(menu.getByText("Bookmark...")).toBeVisible();
        // Obsidian adds its own "Open in new window" wherever windows exist, so
        // ours would add a second one.
        await expect(menu.getByText("Open in new window")).toHaveCount(mobileLayout ? 0 : 1);
        // A phone's menu is a sheet over a background, and ignores Escape.
        if (mobileLayout) await page.locator(".suggestion-bg").click({ position: { x: 5, y: 5 } });
        else await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await page.evaluate(() => window.app.vault.setConfig("nativeMenus", null));
    });
});
