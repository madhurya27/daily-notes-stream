import { test, expect, openStream, restoreNote, seededDate, writeNote } from "./obsidian";
import { longNote } from "./long-note";

/**
 * Parts of a long note far from the screen leave the layout, replaced by
 * spacers as tall as they were, and come back before the reader reaches them
 * (ADR 0021).
 */

const NEWEST = `Notes/${seededDate(0)}.md`;
const NOTE = `[data-source-path="${NEWEST}"]`;

test.describe("a long note's far runs", () => {
    let original: string | null;

    test.afterEach(async ({ obsidian }) => {
        await restoreNote(obsidian.page, NEWEST, original);
    });

    /**
     * Opens the stream with a 3,000-line newest note, once its far parts are
     * hidden.
     */
    async function openLong(page: import("@playwright/test").Page, text = longNote(3000)) {
        original = await writeNote(page, NEWEST, text);
        const container = await openStream(page);
        await expect(container.locator(`${NOTE} .daily-note-far-run`).first()).toBeAttached({ timeout: 30_000 });
        return container;
    }

    test("hides the runs far below, holding the room they took", async ({ obsidian }) => {
        const container = await openLong(obsidian.page);

        const { hidden, before, after } = await container.locator(NOTE).evaluate((block) => {
            const content = block.querySelector(".daily-note-content")!;
            const footer = content.nextElementSibling ?? content;
            const hidden = content.querySelectorAll(".is-far").length;
            const before = [content.getBoundingClientRect().height, footer.getBoundingClientRect().top];
            window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0].view.renderer.farRuns.revealAll(block);
            const after = [content.getBoundingClientRect().height, footer.getBoundingClientRect().top];
            return { hidden, before, after };
        });

        expect(hidden).toBeGreaterThan(0);
        expect(Math.abs(after[0]! - before[0]!), "height").toBeLessThan(0.5);
        expect(Math.abs(after[1]! - before[1]!), "what follows").toBeLessThan(0.5);
    });

    test("shows each run before it reaches the screen, scrolled through fast", async ({ obsidian }) => {
        const container = await openLong(obsidian.page);

        const { seen, frames } = await container.locator("xpath=..").evaluate(async (pane, note) => {
            const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
            const block = pane.querySelector(note)!;
            let seen = 0;
            let frames = 0;
            // Most of a screen each frame, as a hard flick goes, to the note's
            // end.
            while (
                pane.scrollTop + pane.clientHeight <
                block.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + pane.scrollTop
            ) {
                pane.scrollTop += pane.clientHeight * 0.8;
                await frame();
                frames++;
                const { top, bottom } = pane.getBoundingClientRect();
                for (const spacer of block.querySelectorAll(".daily-note-far-run")) {
                    const rect = spacer.getBoundingClientRect();
                    if (rect.bottom > top && rect.top < bottom) seen++;
                }
            }
            return { seen, frames };
        }, NOTE);

        expect(frames).toBeGreaterThan(10);
        expect(seen, "frames with a spacer on screen").toBe(0);
    });

    test("finds a search match in a hidden run, and shows it", async ({ obsidian }) => {
        const container = await openLong(obsidian.page, `${longNote(3000)}\n\nThe word is zanzibar.\n`);
        const match = container.locator(`${NOTE} p`, { hasText: "zanzibar" });
        await expect(match).toHaveClass(/is-far/);

        await obsidian.page.evaluate(async () => {
            const { search } = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0].view;
            await search.search("zanzibar");
            await search.next();
        });

        await expect(match).not.toHaveClass(/is-far/);
        await expect(match).toBeInViewport();
    });

    test("collapses and opens a section over hidden runs at its full height", async ({ obsidian }) => {
        const container = await openLong(obsidian.page, `# Everything\n\n${longNote(3000)}`);
        const note = container.locator(NOTE);
        const content = note.locator(".daily-note-content");
        const height = () => content.evaluate((el) => el.getBoundingClientRect().height);
        const open = await height();
        const chevron = note.locator("h1 > .collapse-indicator");

        await chevron.click();
        await expect.poll(height).toBeLessThan(200);
        await expect(content.locator(".daily-note-far-run")).toHaveCount(0);

        await chevron.click();
        await expect.poll(async () => Math.abs((await height()) - open)).toBeLessThan(0.5);
    });
});
