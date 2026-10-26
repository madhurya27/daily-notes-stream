import type { Locator } from "@playwright/test";
import { test, expect, atTextScale, openStream, restoreNote, writeNote } from "./obsidian";

/** Newer than every test note, so it is first in the stream. */
const NOTE = "Notes/2026-03-15.md";

const fontSizes = (note: Locator, title: string, body: string) =>
    note.evaluate(
        (el, { title, body }) => {
            const size = (selector: string) => getComputedStyle(el.querySelector(selector)!).fontSize;
            return { title: size(title), body: size(body), properties: size(".metadata-container") };
        },
        { title, body }
    );

test.describe("text size", () => {
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
    });

    // On a phone, Obsidian changes a note's text size with iOS's text size
    // setting.
    test("sizes a note's text as Obsidian's reading view does, iOS's text size included", async ({ obsidian }) => {
        const { page } = obsidian;
        const before = await writeNote(page, NOTE, "---\nmood: calm\n---\n- A walk before work\n");
        await atTextScale(page, 1.25, async () => {
            await page.evaluate(async (path) => {
                await window.app.workspace
                    .getLeaf(false)
                    .openFile(window.app.vault.getFileByPath(path)!, { state: { mode: "preview" } });
            }, NOTE);
            const reading = page.locator(".workspace-leaf.mod-active .markdown-reading-view");
            await expect(reading.locator("li").first()).toBeVisible();
            const native = await fontSizes(reading, ".inline-title", "li");

            const note = (await openStream(page)).locator(".daily-note-block").first();
            await expect(note.locator(".daily-note-content li").first()).toBeVisible();

            expect(await fontSizes(note, ".daily-note-title", ".daily-note-content li")).toEqual(native);
        }).finally(() => restoreNote(page, NOTE, before));
    });
});
