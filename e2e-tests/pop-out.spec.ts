import type { Page } from "@playwright/test";
import { test, expect, openStream, SEEDED_DAYS, STREAM } from "./obsidian";

/**
 * A pop-out window is a separate page, with its own document, timers and
 * element types, while the plugin's code runs in the main window. Each test
 * moves the stream into one and uses it there.
 */

/**
 * Moves a new stream into a new pop-out window, and returns that window's page.
 */
async function openInPopOut(page: Page): Promise<Page> {
    await openStream(page);
    const opened = page.context().waitForEvent("page");
    await page.evaluate(() => {
        const [leaf] = window.app.workspace.getLeavesOfType("daily-notes-stream-view");
        window.app.workspace.moveLeafToPopout(leaf!);
    });
    const popOut = await opened;
    await expect(popOut.locator(`${STREAM} .daily-note-block`).first()).toBeVisible();
    return popOut;
}

/**
 * Every uncaught error and logged error, in the main window and the pop-out.
 */
function errorsIn(...pages: Page[]): string[] {
    const errors: string[] = [];
    for (const page of pages) {
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
    }
    return errors;
}

test.describe("the stream in a pop-out window", () => {
    test.beforeEach(({ mobileLayout }) => {
        test.skip(mobileLayout, "phones and tablets have no pop-out windows");
    });

    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => window.app.workspace.detachLeavesOfType("daily-notes-stream-view"));
    });

    test("renders its notes", async ({ obsidian }) => {
        const popOut = await openInPopOut(obsidian.page);
        const errors = errorsIn(obsidian.page, popOut);
        const note = popOut.locator(`${STREAM} .daily-note-block`).first();

        await expect(note.locator(".daily-note-content h2").first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test("loads older notes as it scrolls", async ({ obsidian }) => {
        const popOut = await openInPopOut(obsidian.page);
        const errors = errorsIn(obsidian.page, popOut);
        const blocks = popOut.locator(`${STREAM} .daily-note-block`);

        await expect(blocks).toHaveCount(10); // BATCH_SIZE
        await blocks.last().scrollIntoViewIfNeeded();
        await expect(blocks).toHaveCount(SEEDED_DAYS);
        expect(errors).toEqual([]);
    });

    test("folds a heading", async ({ obsidian }) => {
        const popOut = await openInPopOut(obsidian.page);
        const errors = errorsIn(obsidian.page, popOut);
        const note = popOut.locator(`${STREAM} .daily-note-block`).first();
        const heading = note.locator(".daily-note-content h2").first();
        const body = note.locator(".daily-note-content p").first();

        await heading.locator(".collapse-indicator").click();
        await expect(body).toBeHidden();
        await heading.locator(".collapse-indicator").click();
        await expect(body).toBeVisible();
        expect(errors).toEqual([]);
    });

    test("highlights a search's matches", async ({ obsidian }) => {
        const popOut = await openInPopOut(obsidian.page);
        const errors = errorsIn(obsidian.page, popOut);

        await popOut.locator('.view-action[aria-label="Search"]').click();
        const input = popOut.locator(".daily-notes-search input");
        await expect(input).toBeFocused();
        await input.fill("km");

        // Painted from the pop-out's own registry, because the main window's
        // registry paints nothing there.
        await expect
            .poll(() => popOut.evaluate(() => CSS.highlights.get("daily-notes-search-match")?.size ?? 0))
            .toBeGreaterThan(0);
        await expect(popOut.locator(".daily-notes-search .document-search-count")).not.toHaveText("");
        expect(errors).toEqual([]);
    });
});
