import { test, expect, openStream } from "./obsidian";
import { join } from "path";
import { OUT, prepareDemo } from "./demo";
import { recordingAsked } from "./recording-asked";
import { clickAt, clickLikeAPerson, driftOff, flick, glideTo, record, restAt, typeLikeAPerson } from "./screencast";

/**
 * Records the README's animated WebP of the stream in use: a note edited live,
 * scrolling by hand, search, and a jump to a date. Only runs when asked,
 * through `pnpm run capture:recording`, and separately from the screenshots, so
 * either can be made again on its own.
 */
test.describe("README recording", () => {
    test.skip(!recordingAsked(), "set CAPTURE_RECORDING=1 to record");

    test.beforeAll(async ({ obsidian }) => {
        await prepareDemo(obsidian.page);
    });

    test("the stream in use", async ({ obsidian }, testInfo) => {
        // Desktop only for now. docs/TODO.md lists what a phone recording is
        // missing.
        test.skip(testInfo.project.name === "mobile", "no phone recording yet");
        const { page } = obsidian;
        const container = await openStream(page);
        const pause = (ms: number) => page.waitForTimeout(ms);
        const addition = " Strong coffee helped.";

        // The hand is already on the mouse, over the stream, from the first
        // frame. The stream is as tall as its notes. What shows is the pane
        // that scrolls it.
        const pane = container.locator("xpath=..");
        const area = (await pane.boundingBox())!;
        const rest = [area.x + area.width * 0.7, area.y + area.height * 0.72] as const;
        await restAt(page, ...rest);

        await record(page, join(OUT, "demo-desktop.webp"), async () => {
            await pause(1200);

            // Live: the newest note, opened in a split next to the stream and
            // edited by hand. The stream draws it again when the edit saves.
            await clickLikeAPerson(page, container.locator(".daily-note-title").first(), ["Meta", "Alt"]);
            const editor = page.locator(".workspace-leaf.mod-active .cm-content");
            await expect(editor).toBeVisible();
            await pause(1500);
            // Just after the full stop, where a person clicks to add to the
            // sentence.
            const end = await editor.locator(".cm-line", { hasText: "let the day start slowly." }).evaluate((line) => {
                const range = document.createRange();
                range.selectNodeContents(line);
                const rects = range.getClientRects();
                const last = rects[rects.length - 1]!;
                return { x: last.right, y: last.top + last.height / 2 };
            });
            await clickAt(page, end.x + 7, end.y);
            await pause(700);
            await typeLikeAPerson(page, addition);
            // The stream draws the note again once Obsidian saves, about two
            // seconds after the last key.
            await expect(container.getByText(`let the day start slowly.${addition}`)).toBeVisible({ timeout: 10_000 });
            await pause(2000);
            const tab = page.locator(".workspace-tab-header", { hasText: "2026-09-25" });
            await clickLikeAPerson(page, tab.locator(".workspace-tab-header-inner-close-button"));
            await expect(tab).toHaveCount(0);
            await pause(700);

            // Reading down through a few days, one flick at a time.
            for (const distance of [520, 680, 600]) {
                await flick(page, distance, pane);
                await pause(900);
            }

            // Search moves from note to note, across days not yet loaded.
            await clickLikeAPerson(page, page.locator('.view-action[aria-label="Search"]'));
            // The hand moves from the mouse to the keyboard.
            await pause(1000);
            await typeLikeAPerson(page, "Mara");
            await pause(700);
            for (let step = 0; step < 2; step++) {
                await page.keyboard.press("Enter");
                await pause(1100);
            }
            await clickLikeAPerson(page, page.locator(".daily-notes-search .document-search-close-button"));
            await pause(300);
            // Moving away from the button, so it does not stay highlighted.
            await driftOff(page);
            await pause(500);

            // Jump: a few keys narrow down the vault's dates, and a click goes
            // to the day.
            await clickLikeAPerson(page, page.locator('.view-action[aria-label="Jump to date"]'));
            await pause(800);
            await typeLikeAPerson(page, "09-0");
            await pause(900);
            await clickLikeAPerson(page, page.locator(".prompt .suggestion-item", { hasText: "2026-09-08" }));
            await expect(container.locator(".daily-note-title", { hasText: "2026-09-08" })).toBeInViewport();
            // Back where it was at the start, so the loop shows no jump.
            await glideTo(page, ...rest);
            await pause(2000);

            // Back to the newest note, so the loop starts again where it began.
            // On desktop, this is only possible with the command palette or a
            // hotkey.
            await page.keyboard.press("Meta+P");
            const command = page.locator(".prompt .suggestion-item").first();
            await pause(600);
            await typeLikeAPerson(page, "to top");
            await expect(command).toContainText("Scroll to top");
            await pause(700);
            await page.keyboard.press("Enter");
            await expect(container.locator(".daily-note-title").first()).toBeInViewport();
            await pause(1800);
        });
    });
});
