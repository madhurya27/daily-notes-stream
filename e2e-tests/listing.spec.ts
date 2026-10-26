import type { Page, TestInfo } from "@playwright/test";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { test, expect, openStream } from "./obsidian";
import { prepareDemo, showLightTheme } from "./demo";

/**
 * Takes the raw screenshots for the plugin directory, each on desktop and
 * phone: the stream's pane on desktop, and the whole screen on a phone.
 * `scripts/listing-cards.mjs` lays them out as the images uploaded by hand
 * under Edit listing, so they go to .dev/, not docs/. Only runs when asked,
 * through `pnpm run capture:listing`.
 */

const OUT = resolve(import.meta.dirname, "..", ".dev", "listing", "raw");
/** Sized so the pane shows in its image at about its own size. */
const WINDOW = { width: 904, height: 640 };

/**
 * Scrolls the stream so the note at `path` starts `fraction` of the way down
 * the window.
 */
async function placeNote(page: Page, path: string, fraction: number): Promise<void> {
    const block = page.locator(`.daily-notes-stream-container [data-source-path="${path}"]`);
    await block.scrollIntoViewIfNeeded();
    await block.evaluate((el, fraction) => {
        el.scrollIntoView({ block: "start" });
        el.closest(".view-content")!.scrollTop -= fraction * window.innerHeight - el.getBoundingClientRect().top;
    }, fraction);
}

/**
 * The window without the status bar, which shows the test vault's sync state.
 */
async function dressWindow(page: Page): Promise<void> {
    await page.evaluate(
        async ({ width, height }) => window.electron.remote.getCurrentWindow().setContentSize(width, height),
        WINDOW
    );
    await page.waitForFunction(({ width }) => window.innerWidth === width, WINDOW);
    await page.evaluate(() => {
        document.head.appendChild(document.createElement("style")).textContent = ".status-bar { display: none; }";
    });
}

/**
 * On desktop, the stream's pane, including its tab bar. On a phone, the whole
 * screen.
 */
async function capture(page: Page, name: string, testInfo: TestInfo): Promise<void> {
    await page.waitForTimeout(1000);
    const layout = testInfo.project.name === "mobile" ? "phone" : "desktop";
    const path = join(OUT, `${name}-${layout}.png`);
    if (layout === "phone") return void (await page.screenshot({ path }));
    const clip = await page.locator(".workspace-split.mod-root").boundingBox();
    if (!clip) throw new Error("the stream's pane is not on screen");
    await page.screenshot({ path, clip });
}

test.describe("listing screenshots", () => {
    test.skip(process.env.CAPTURE_LISTING !== "1", "set CAPTURE_LISTING=1 to capture");
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async ({ obsidian }, testInfo) => {
        const { page } = obsidian;
        await prepareDemo(page);
        if (testInfo.project.name === "desktop") await dressWindow(page);
        mkdirSync(OUT, { recursive: true });
    });

    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.keyboard.press("Escape");
    });

    test("the stream", async ({ obsidian }, testInfo) => {
        const { page } = obsidian;
        await openStream(page);
        await placeNote(page, "Notes/2026-09-24.md", 0.4);
        await capture(page, "stream", testInfo);
    });

    test("search", async ({ obsidian }, testInfo) => {
        const { page } = obsidian;
        await openStream(page);
        await page.locator('.view-action[aria-label="Search"]').click();
        const bar = page.locator(".daily-notes-search");
        await bar.locator("input").fill("Mara");
        // Typing marks a match it finds on screen without scrolling (D-022),
        // even one under a phone's bottom bar. Enter moves to the next match
        // and centers it: the first match, or the second if typing marked the
        // first.
        const count = bar.locator(".document-search-count");
        await expect(count).toHaveText(/^(\d+ notes|1 \/ \d+)$/);
        const typed = await count.textContent();
        await page.keyboard.press("Enter");
        await expect(count).toHaveText(typed?.endsWith("notes") ? /^1 \/ \d+$/ : /^2 \/ \d+$/);
        await capture(page, "search", testInfo);
    });

    test("jump to date", async ({ obsidian }, testInfo) => {
        const { page } = obsidian;
        await openStream(page);
        // Below the prompt, so it covers no date.
        await placeNote(page, "Notes/2026-09-24.md", 0.72);
        await page.locator('.view-action[aria-label="Jump to date"]').click();
        const prompt = page.locator(".prompt");
        await prompt.locator("input.prompt-input").fill("2026-09-1");
        await expect(prompt.locator(".suggestion-item").first()).toBeVisible();
        await capture(page, "jump", testInfo);
    });

    test("a Base in a Sunday review", async ({ obsidian }, testInfo) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const sunday = container.locator('[data-source-path="Notes/2026-09-20.md"]');
        await sunday.scrollIntoViewIfNeeded();
        await sunday.locator("h3", { hasText: "Reading" }).evaluate((heading) => heading.scrollIntoView());
        // A table on desktop, and cards on a phone.
        await expect(sunday.locator(".bases-thead, .bases-cards-item").first()).toBeVisible();
        await capture(page, "bases", testInfo);
    });

    test("the stream in dark mode", async ({ obsidian }, testInfo) => {
        test.skip(testInfo.project.name === "desktop", "only the phone cards show the dark theme");
        const { page } = obsidian;
        await page.emulateMedia({ colorScheme: "dark" });
        try {
            await expect(page.locator("body")).toHaveClass(/theme-dark/);
            await openStream(page);
            await placeNote(page, "Notes/2026-09-24.md", 0.4);
            await capture(page, "dark", testInfo);
        } finally {
            await showLightTheme(page);
        }
    });
});
