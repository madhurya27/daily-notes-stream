import {
    test,
    expect,
    openStream,
    restoreScrollAnchoring,
    scrollThroughStream,
    seededDate,
    SEEDED_DAYS,
    withoutScrollAnchoring,
} from "./obsidian";
import type { Locator, Page } from "@playwright/test";

/** The stream's pane, the element that scrolls. */
const pane = (container: Locator) => container.locator("xpath=..");

const title = (page: Page) =>
    page.locator('.workspace-leaf-content[data-type="daily-notes-stream-view"] .view-header-title');

/**
 * Jumps to the oldest note, so the notes between it and the top are empty
 * blocks that were never drawn. Each one grows taller than its estimate as the
 * scroll back up passes it.
 */
async function scrollToOldest(page: Page, container: Locator) {
    await page.locator('.view-action[aria-label="Jump to date"]').click();
    await page.locator(".prompt input.prompt-input").fill(seededDate(SEEDED_DAYS - 1));
    await page.locator(".prompt .suggestion-item").first().click();
    await expect(page.locator(".prompt")).toBeHidden();
    await expect.poll(() => pane(container).evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
    // Once scrolling stops, the notes above get new heights, and the anchor
    // moves the scroll with them (ADR 0014).
    let last = NaN;
    await expect
        .poll(
            async () => {
                const now = await pane(container).evaluate((el) => el.scrollTop);
                const settled = now === last;
                last = now;
                return settled;
            },
            { intervals: [600] }
        )
        .toBe(true);
}

/** How far the newest note is below the pane's top. */
const newestOffset = (container: Locator) =>
    container
        .locator(".daily-note-block")
        .first()
        .evaluate((el) => {
            const scroller = el.closest(".daily-notes-stream-container")!.parentElement!;
            return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        });

test.describe("tapping the header title", () => {
    test.describe("on mobile", () => {
        test.beforeEach(({ mobileLayout }) => test.skip(!mobileLayout, "a mobile gesture"));

        test("glides back to the newest note", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            await scrollToOldest(page, container);

            await title(page).click();

            await expect.poll(() => pane(container).evaluate((el) => el.scrollTop)).toBe(0);
            expect(await newestOffset(container)).toBeGreaterThanOrEqual(0);
        });

        test("leaves the scroll alone on a tap of a header action", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            await scrollToOldest(page, container);
            const before = await pane(container).evaluate((el) => el.scrollTop);

            await page.locator('.view-action[aria-label="Search"]').click();
            await page.waitForTimeout(500);

            expect(await pane(container).evaluate((el) => el.scrollTop)).toBe(before);
            await page.keyboard.press("Escape");
        });

        // iOS's WebKit does not keep the scroll position, so the stream keeps
        // the reader's place itself, and must not stop before the top here.
        test.describe("where the platform has no scroll anchoring", () => {
            /**
             * Notes between the top and the oldest, tall enough to grow taller
             * than their empty blocks.
             */
            const TALL = [3, 4, 5, 6, 7, 8, 9].map((days) => `Notes/${seededDate(days)}.md`);
            let originals: string[] = [];

            test.beforeEach(async ({ obsidian }) => {
                await withoutScrollAnchoring(obsidian.page);
                originals = await obsidian.page.evaluate(async (paths: string[]) => {
                    const body = (path: string) =>
                        Array.from({ length: 300 }, (_, i) => `Line ${i} of ${path}.`).join("\n\n");
                    const read: string[] = [];
                    for (const path of paths) {
                        const file = window.app.vault.getFileByPath(path)!;
                        read.push(await window.app.vault.read(file));
                        await window.app.vault.modify(file, body(path));
                    }
                    return read;
                }, TALL);
            });

            test.afterEach(async ({ obsidian }) => {
                // Nothing to restore if the test was skipped.
                if (originals.length === 0) return;
                await restoreScrollAnchoring(obsidian.page);
                await obsidian.page.evaluate(
                    async ([paths, bodies]: [string[], string[]]) => {
                        for (const [i, path] of paths.entries()) {
                            await window.app.vault.modify(window.app.vault.getFileByPath(path)!, bodies[i]!);
                        }
                    },
                    [TALL, originals] as [string[], string[]]
                );
                originals = [];
            });

            test("reaches the top", async ({ obsidian }) => {
                const { page } = obsidian;
                const container = await openStream(page);
                await expect(pane(container)).toHaveCSS("overflow-anchor", "none");
                await scrollToOldest(page, container);

                await title(page).click();

                // Still there after the anchor has moved the shift into the
                // scroll, which happens when scrolling stops.
                await expect.poll(() => pane(container).evaluate((el) => el.scrollTop)).toBe(0);
                await page.waitForTimeout(500);
                expect(await pane(container).evaluate((el) => el.scrollTop)).toBe(0);
                expect(await newestOffset(container)).toBeGreaterThanOrEqual(0);
            });

            // Each note between the oldest and the top gets the height it last
            // measured (ADR 0010), so nothing is owed that the scroll cannot
            // reach.
            test("lets a scroll up by hand from a jump reach the newest note", async ({ obsidian }) => {
                const { page } = obsidian;
                await scrollThroughStream(await openStream(page));
                const container = await openStream(page);
                await scrollToOldest(page, container);

                // By hand, with the wheel, until the pane is at its top. The
                // tall notes are about 12,000px each.
                await container.hover();
                while ((await pane(container).evaluate((el) => el.scrollTop)) > 0) {
                    await page.mouse.wheel(0, -2000);
                    await page.waitForTimeout(30);
                }

                // Still there after the anchor has moved the shift into the
                // scroll, which happens when scrolling stops. Heights are
                // remembered as laid out, so nothing is owed for them (D-105).
                await page.waitForTimeout(500);
                expect(await pane(container).evaluate((el) => el.scrollTop)).toBe(0);
                expect(await newestOffset(container)).toBeGreaterThanOrEqual(0);
            });
        });
    });

    test("leaves the scroll alone on desktop", async ({ obsidian, mobileLayout }) => {
        test.skip(mobileLayout, "a desktop rule");
        const { page } = obsidian;
        const container = await openStream(page);
        await scrollToOldest(page, container);
        const before = await pane(container).evaluate((el) => el.scrollTop);

        await title(page).click();
        await page.waitForTimeout(500);

        expect(await pane(container).evaluate((el) => el.scrollTop)).toBe(before);
    });
});

test("the Scroll to top button glides back to the newest note, on desktop", async ({ obsidian, mobileLayout }) => {
    test.skip(mobileLayout, "the title does it on mobile");
    const { page } = obsidian;
    const container = await openStream(page);
    await scrollToOldest(page, container);

    await page.locator('.view-action[aria-label="Scroll to top"]').click();

    await expect.poll(() => pane(container).evaluate((el) => el.scrollTop)).toBe(0);
    expect(await newestOffset(container)).toBeGreaterThanOrEqual(0);
});

test("there is no Scroll to top button on mobile", async ({ obsidian, mobileLayout }) => {
    test.skip(!mobileLayout, "a mobile rule");
    await openStream(obsidian.page);

    await expect(obsidian.page.locator('.view-action[aria-label="Scroll to top"]')).toHaveCount(0);
});

test("the Scroll to top command glides back to the newest note", async ({ obsidian, mobileLayout }) => {
    const { page } = obsidian;
    const container = await openStream(page);
    await scrollToOldest(page, container);

    await page.evaluate(() => window.app.commands.executeCommandById("command-palette:open"));
    await page.locator(".prompt input.prompt-input").fill("Daily Notes Stream: Scroll to top");
    await page.keyboard.press("Enter");

    await expect.poll(() => pane(container).evaluate((el) => el.scrollTop)).toBe(0);
    expect(await newestOffset(container)).toBeGreaterThanOrEqual(0);
});

test("the Scroll to top command is not offered while a note has the focus", async ({ obsidian }) => {
    const { page } = obsidian;
    await openStream(page);
    await page.evaluate(async () => {
        await window.app.workspace.getLeaf("tab").openFile(window.app.vault.getFileByPath("Reading list.md")!);
    });
    try {
        await page.evaluate(() => window.app.commands.executeCommandById("command-palette:open"));
        const prompt = page.locator(".prompt");
        await prompt.locator("input.prompt-input").fill("Daily Notes Stream:");

        await expect(prompt.locator(".suggestion-item").first()).toBeVisible();
        await expect(prompt.locator(".suggestion-item", { hasText: "Scroll to top" })).toHaveCount(0);
    } finally {
        await page.keyboard.press("Escape");
        await page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
    }
});
