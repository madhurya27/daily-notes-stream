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

/**
 * The path of the note in the focused leaf. getActiveFile() would report the
 * last note that had focus.
 */
function activeNote(page: Page) {
    return page.evaluate(() => window.app.workspace.activeLeaf?.view?.file?.path);
}

async function streamIsOpen(page: Page) {
    return page.evaluate(() => window.app.workspace.getLeavesOfType("daily-notes-stream-view").length > 0);
}

async function firstLink(page: Page, text: string) {
    const container = await openStream(page);
    return container.locator(".internal-link", { hasText: text }).first();
}

test.describe("links in a note", () => {
    // Tests share the instance, so a note left open would cover the next test's
    // stream.
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
    });

    test("open the linked note in the stream's tab, which Back returns to", async ({ obsidian }) => {
        const { page } = obsidian;
        await (await firstLink(page, "Reading list")).click();

        await expect
            .poll(async () => (await openNotes(page)).map((n: { path?: string }) => n.path))
            .toEqual(["Reading list.md"]);
        expect(await streamIsOpen(page)).toBe(false);

        await page.evaluate(() => window.app.commands.executeCommandById("app:go-back"));
        await expect.poll(() => streamIsOpen(page)).toBe(true);
    });

    test("create a missing note in the stream's tab", async ({ obsidian }) => {
        const { page } = obsidian;
        await (await firstLink(page, "Someday")).click();

        await expect
            .poll(async () => (await openNotes(page)).map((n: { path?: string }) => n.path))
            .toEqual(["Someday.md"]);
        expect(await streamIsOpen(page)).toBe(false);
        await page.evaluate(async () => {
            await window.app.vault.delete(window.app.vault.getFileByPath("Someday.md")!);
        });
    });

    test("open the linked note at the heading it names", async ({ obsidian }) => {
        const { page } = obsidian;
        await (await firstLink(page, "what's next")).click();

        await expect.poll(() => activeNote(page)).toBe("Reading list.md");
        const note = page.locator(".workspace-leaf.mod-active .markdown-source-view");
        await expect(note.getByText("Middlemarch")).toBeInViewport();
    });

    test("open in a split when mod-alt-clicked", async ({ obsidian, mobileLayout }) => {
        test.skip(mobileLayout, "a phone has no splits");
        const { page } = obsidian;
        await (await firstLink(page, "Reading list")).click({ modifiers: ["ControlOrMeta", "Alt"] });

        await expect.poll(() => openNotes(page)).toEqual([{ path: "Reading list.md", besideStream: false }]);
    });

    test("open in a new tab when mod-clicked, keeping the stream", async ({ obsidian }) => {
        const { page } = obsidian;
        await (await firstLink(page, "Reading list")).click({ modifiers: ["ControlOrMeta"] });

        await expect.poll(() => openNotes(page)).toEqual([{ path: "Reading list.md", besideStream: true }]);
    });

    test("open in a new tab when middle-clicked", async ({ obsidian }) => {
        const { page } = obsidian;
        await (await firstLink(page, "Reading list")).click({ button: "middle" });

        await expect.poll(() => openNotes(page)).toEqual([{ path: "Reading list.md", besideStream: true }]);
    });

    test("offer the linked note's file menu on right-click", async ({ obsidian, mobileLayout }) => {
        const { page } = obsidian;
        // A native menu (the macOS default) is never in the DOM, so it cannot
        // be read.
        await page.evaluate(() => window.app.vault.setConfig("nativeMenus", false));
        await (await firstLink(page, "Reading list")).click({ button: "right" });

        const menu = page.locator(".menu");
        await expect(menu.getByText("Open in new tab")).toBeVisible();
        await expect(menu.getByText("Bookmark...")).toBeVisible();

        // A phone's menu is a sheet over a background, and ignores Escape.
        if (mobileLayout) await page.locator(".suggestion-bg").click({ position: { x: 5, y: 5 } });
        else await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await page.evaluate(() => window.app.vault.setConfig("nativeMenus", null));
    });

    test("offer only where to open a missing note on right-click, and create it there", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(() => window.app.vault.setConfig("nativeMenus", false));
        try {
            await (await firstLink(page, "Someday")).click({ button: "right" });

            const menu = page.locator(".menu");
            await expect(menu.getByText("Open in new tab")).toBeVisible();
            // There is no file yet, so none of Obsidian's file menu items.
            await expect(menu.getByText("Bookmark...")).toHaveCount(0);
            await expect(menu.getByText("Rename...")).toHaveCount(0);

            await menu.getByText("Open in new tab").click();

            await expect.poll(() => openNotes(page)).toEqual([{ path: "Someday.md", besideStream: true }]);
            expect(await streamIsOpen(page)).toBe(true);
        } finally {
            await page.evaluate(async () => {
                window.app.workspace.detachLeavesOfType("markdown");
                const file = window.app.vault.getFileByPath("Someday.md");
                if (file) await window.app.vault.delete(file);
                window.app.vault.setConfig("nativeMenus", null);
            });
        }
    });

    test("fade a link to a note that does not exist, as Obsidian does", async ({ obsidian }) => {
        const { page } = obsidian;
        const missing = await firstLink(page, "Someday");
        const existing = await firstLink(page, "Reading list");

        await expect(missing).toHaveClass(/\bis-unresolved\b/);
        await expect(existing).not.toHaveClass(/\bis-unresolved\b/);
        const opacity = await missing.evaluate((el) => Number(getComputedStyle(el).opacity));
        expect(opacity).toBeLessThan(1);
    });

    test("unfade the link once its note is created", async ({ obsidian }) => {
        const { page } = obsidian;
        const missing = await firstLink(page, "Someday");
        await expect(missing).toHaveClass(/\bis-unresolved\b/);

        await page.evaluate(async () => {
            await window.app.vault.create("Someday.md", "");
        });

        await expect(missing).not.toHaveClass(/\bis-unresolved\b/);
        await page.evaluate(() => window.app.vault.delete(window.app.vault.getFileByPath("Someday.md")!));
        await expect(missing).toHaveClass(/\bis-unresolved\b/);
    });

    test("preview the linked note on mod-hover", async ({ obsidian, mobileLayout }) => {
        test.skip(mobileLayout, "a phone has no hover");
        const { page } = obsidian;
        const link = await firstLink(page, "Reading list");

        await page.keyboard.down("ControlOrMeta");
        await link.hover();

        await expect(page.locator(".hover-popover").getByText("Book 1", { exact: true })).toBeVisible();
        await page.keyboard.up("ControlOrMeta");
        await page.mouse.move(0, 0);
        await expect(page.locator(".hover-popover")).toHaveCount(0);
    });

    test("preview the linked note on a plain hover once Page preview drops the Mod key", async ({
        obsidian,
        mobileLayout,
    }) => {
        test.skip(mobileLayout, "a phone has no hover");
        const { page } = obsidian;
        // Settings → Page preview: the stream's row. Its switch is on while
        // hovering needs Mod.
        const needsMod = async () => {
            const settings = page.context().waitForEvent("page");
            await page.evaluate(() => {
                window.app.setting.open();
                window.app.setting.openTabById("page-preview");
            });
            return (await settings)
                .locator(".vertical-tab-content .setting-item")
                .filter({ hasText: "Daily Notes Stream" })
                .locator(".checkbox-container");
        };
        let toggle = await needsMod();
        await expect(toggle).toHaveClass(/is-enabled/);
        await toggle.click();
        await expect(toggle).not.toHaveClass(/is-enabled/);
        await page.evaluate(() => window.app.setting.close());
        try {
            await (await firstLink(page, "Reading list")).hover();

            await expect(page.locator(".hover-popover").getByText("Book 1", { exact: true })).toBeVisible();
        } finally {
            await page.mouse.move(0, 0);
            toggle = await needsMod();
            await toggle.click();
            await expect(toggle).toHaveClass(/is-enabled/);
            await page.evaluate(() => window.app.setting.close());
        }
    });
});
