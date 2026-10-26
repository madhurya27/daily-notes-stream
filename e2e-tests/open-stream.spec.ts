import type { Page } from "@playwright/test";
import { test, expect, openStream } from "./obsidian";

const STREAM = "daily-notes-stream-view";

/**
 * A note open on its own in the active tab, with nothing left behind by an
 * earlier test.
 */
async function openNoteAlone(page: Page) {
    await page.evaluate(async (type) => {
        window.app.workspace.detachLeavesOfType(type);
        window.app.workspace.detachLeavesOfType("markdown");
        await new Promise((r) => setTimeout(r, 300));
        await window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath("Reading list.md")!);
    }, STREAM);
}

/** What each open tab shows, stream or note. */
function openViews(page: Page) {
    return page.evaluate(
        (type) => ({
            streams: window.app.workspace.getLeavesOfType(type).length,
            notes: window.app.workspace.getLeavesOfType("markdown").length,
        }),
        STREAM
    );
}

test.describe("opening the stream", () => {
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
    });

    test("the command replaces the note in the current tab, as the graph does", async ({ obsidian }) => {
        const { page } = obsidian;
        await openNoteAlone(page);

        await page.evaluate(() => window.app.commands.executeCommandById("daily-notes-stream:open-stream"));

        await expect.poll(() => openViews(page)).toEqual({ streams: 1, notes: 0 });
    });

    test("a mod-click on the ribbon icon opens it in a new tab", async ({ obsidian }) => {
        test.skip(test.info().project.name === "mobile", "a phone's tap carries no modifier");
        const { page } = obsidian;
        await openNoteAlone(page);

        await page
            .locator('.side-dock-ribbon-action[aria-label="Open daily notes stream"]')
            .dispatchEvent("click", { metaKey: true, ctrlKey: false });

        await expect.poll(() => openViews(page)).toEqual({ streams: 1, notes: 1 });
    });

    test("a mod-alt-click on the ribbon icon opens it in a split", async ({ obsidian, mobileLayout }) => {
        test.skip(mobileLayout, "a phone has no splits");
        const { page } = obsidian;
        await openNoteAlone(page);

        await page
            .locator('.side-dock-ribbon-action[aria-label="Open daily notes stream"]')
            .dispatchEvent("click", { metaKey: true, altKey: true });

        await expect.poll(() => openViews(page)).toEqual({ streams: 1, notes: 1 });
        const besideNote = await page.evaluate(
            (type) =>
                window.app.workspace.getLeavesOfType(type)[0].parent ===
                window.app.workspace.getLeavesOfType("markdown")[0].parent,
            STREAM
        );
        expect(besideNote).toBe(false);
    });

    test("the ribbon icon and tab draw a stack of cards, not core Daily notes' calendar", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        // A name missing from Obsidian's icon set draws nothing, without any
        // error.
        const ribbon = page.locator('.side-dock-ribbon-action[aria-label="Open daily notes stream"] svg');
        const tab = page.locator(".mod-root .workspace-tab-header.is-active .workspace-tab-header-inner-icon svg");
        await expect(ribbon).toHaveClass(/lucide-gallery-vertical-end/);
        await expect(tab).toHaveClass(/lucide-gallery-vertical-end/);
    });

    test("the command run from a stream keeps the reader's place", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const scrolled = await container.evaluate((el) => {
            el.parentElement!.scrollTop = 600;
            return el.parentElement!.scrollTop;
        });
        expect(scrolled).toBeGreaterThan(0);

        await page.evaluate(() => window.app.commands.executeCommandById("daily-notes-stream:open-stream"));

        await expect.poll(() => openViews(page)).toEqual({ streams: 1, notes: 0 });
        expect(await container.evaluate((el) => el.parentElement!.scrollTop)).toBe(scrolled);
    });
});
