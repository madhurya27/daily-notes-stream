import type { Page } from "@playwright/test";
import { test, expect, openStream } from "./obsidian";

/** Newer than every test note, so they are first in the stream. */
const FIRST = "Notes/2026-03-15.md";
const SECOND = "Notes/2026-03-16.md";

/**
 * Opens the stream with math drawn once, so MathJax has loaded, then writes
 * `math` as a new note and returns how long it took to draw, and the width of
 * its math as it was drawn.
 */
async function drawNewNote(page: Page, math: string): Promise<{ ms: number; width: number }> {
    await page.evaluate(async (note) => {
        await window.app.vault.create(note, "$x$\n");
    }, FIRST);
    const container = await openStream(page);
    await expect(container.locator(".math.is-loaded").first()).toBeVisible();
    await page.evaluate((note) => {
        const { renderer } = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0].view;
        const renderInto = renderer.renderInto;
        const w = window as unknown as { drawn?: Promise<{ ms: number; width: number }> };
        w.drawn = new Promise((resolve) => {
            renderer.renderInto = async (block: HTMLElement, file: { path: string }, ...rest: unknown[]) => {
                const start = performance.now();
                const out = await renderInto.call(renderer, block, file, ...rest);
                if (file.path === note) {
                    const ms = performance.now() - start;
                    resolve({ ms, width: block.querySelector("mjx-math")?.getBoundingClientRect().width ?? -1 });
                }
                return out;
            };
        });
    }, SECOND);
    await page.evaluate(
        async ({ note, text }) => {
            await window.app.vault.create(note, text);
        },
        { note: SECOND, text: `${math}\n` }
    );
    return page.evaluate(() => (window as unknown as { drawn: Promise<{ ms: number; width: number }> }).drawn);
}

test.afterEach(async ({ obsidian }) => {
    await obsidian.page.evaluate(
        async (notes) => {
            for (const note of notes) {
                const file = window.app.vault.getAbstractFileByPath(note);
                if (file) await window.app.vault.delete(file);
            }
        },
        [FIRST, SECOND]
    );
});

// Obsidian's own math step waits 100 ms for MathJax's stylesheet (D-210).
test("a note with math draws without waiting for MathJax's stylesheet", async ({ obsidian }) => {
    const { ms } = await drawNewNote(obsidian.page, "$$y^2$$");

    expect(ms).toBeLessThan(100);
});

// Before the stylesheet has them, characters drawn for the first time have no
// size, so the note would be measured short.
test("math with characters new to the page has its size as its note is drawn", async ({ obsidian }) => {
    const { width } = await drawNewNote(obsidian.page, "$$\\aleph \\beth \\gimel$$");

    expect(width).toBeGreaterThan(10);
});
