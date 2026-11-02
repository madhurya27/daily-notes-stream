import { test, expect, openStream } from "./obsidian";

/** Newer than every test note, so it is first in the stream. */
const NOTE = "Notes/2026-03-15.md";

test("draws a Mermaid diagram", async ({ obsidian }) => {
    const { page } = obsidian;
    await page.evaluate(async (note) => {
        await window.app.vault.create(note, "```mermaid\nflowchart LR\n  A --> B\n```\n");
    }, NOTE);
    try {
        const container = await openStream(page);
        const block = container.locator(".daily-note-block").first();

        await expect(block.locator(".mermaid svg")).toBeVisible();
    } finally {
        await page.evaluate(async (note) => {
            const file = window.app.vault.getAbstractFileByPath(note);
            if (file) await window.app.vault.delete(file);
        }, NOTE);
    }
});
