import type { Page } from "@playwright/test";
import { test, expect, openStream, STREAM } from "./obsidian";

const NEWEST = "Notes/2026-03-14.md";
const SECOND = "Notes/2026-03-13.md";
const THIRD = "Notes/2026-03-12.md";

async function read(page: Page, path: string): Promise<string> {
    return page.evaluate((path) => window.app.vault.read(window.app.vault.getFileByPath(path)!), path);
}

async function write(page: Page, path: string, text: string) {
    await page.evaluate(
        async ({ path, text }) => {
            const { vault } = window.app;
            const file = vault.getFileByPath(path);
            if (file) await vault.modify(file, text);
            else await vault.create(path, text);
        },
        { path, text }
    );
}

async function remove(page: Page, path: string) {
    await page.evaluate(async (path) => {
        const file = window.app.vault.getAbstractFileByPath(path);
        if (file) await window.app.vault.delete(file, true);
    }, path);
}

async function rename(page: Page, from: string, to: string) {
    await page.evaluate(
        ({ from, to }) => window.app.fileManager.renameFile(window.app.vault.getFileByPath(from)!, to),
        { from, to }
    );
}

const block = (page: Page, path: string) => page.locator(`${STREAM} .daily-note-block[data-source-path="${path}"]`);

test.describe("a stream following the vault", () => {
    let originals: Record<string, string>;

    test.beforeEach(async ({ obsidian }) => {
        const { page } = obsidian;
        originals = {};
        for (const path of [NEWEST, SECOND, THIRD]) originals[path] = await read(page, path);
    });

    test.afterEach(async ({ obsidian }) => {
        const { page } = obsidian;
        for (const path of ["Notes/2026-03-20.md", "Notes/Archive/2026-03-25.md", "Notes/Archive/2026-03-26.md"])
            await remove(page, path);
        await remove(page, "Notes/Archive");
        for (const [path, text] of Object.entries(originals)) await write(page, path, text);
    });

    test("redraws a note's properties when its frontmatter changes, and keeps them out of the body", async ({
        obsidian,
    }) => {
        const { page } = obsidian;
        await openStream(page);
        const note = block(page, NEWEST);
        await expect(note.locator(".metadata-container")).toContainText("day-14");

        await page.evaluate(async (path) => {
            const file = window.app.vault.getFileByPath(path)!;
            await window.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
                frontmatter.mood = "rested";
                frontmatter.weather = "sunny";
            });
        }, NEWEST);

        const properties = note.locator(".metadata-container");
        await expect(properties.locator(".metadata-property-value-text")).toContainText(["rested", "sunny"]);
        await expect(properties).not.toContainText("day-14");
        await expect(note.locator(".daily-note-content")).not.toContainText("weather");
    });

    test("moves a renamed note to its new date, its title changed and its collapsed heading still collapsed", async ({
        obsidian,
    }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const heading = block(page, SECOND).locator(".daily-note-content h2").first();
        await heading.scrollIntoViewIfNeeded();
        await heading.locator(".collapse-indicator").click();
        await expect(heading).toHaveClass(/is-collapsed/);

        await rename(page, SECOND, "Notes/2026-03-20.md");

        const paths = container.locator(".daily-note-block");
        await expect(paths.nth(0)).toHaveAttribute("data-source-path", "Notes/2026-03-20.md");
        await expect(paths.nth(1)).toHaveAttribute("data-source-path", NEWEST);
        await expect(paths.nth(2)).toHaveAttribute("data-source-path", THIRD);
        const renamed = block(page, "Notes/2026-03-20.md");
        await renamed.scrollIntoViewIfNeeded();
        await expect(renamed.locator(".daily-note-title")).toHaveText("2026-03-20");
        await expect(renamed.locator(".daily-note-content h2").first()).toHaveClass(/is-collapsed/);

        await rename(page, "Notes/2026-03-20.md", SECOND);
    });

    test("drops a deleted note, leaving the ones around it in order", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        await expect(block(page, SECOND)).toHaveCount(1);

        await remove(page, SECOND);

        await expect(block(page, SECOND)).toHaveCount(0);
        // A note left in the stream's count moves every later batch by one,
        // which skips the note at the edge of a batch.
        const dailyNotes = await page.evaluate(() =>
            window.app.vault
                .getMarkdownFiles()
                .map((file: { path: string }) => file.path)
                .filter((path: string) => /^Notes\/\d{4}-\d{2}-\d{2}\.md$/.test(path))
                .sort()
                .reverse()
        );
        const blocks = container.locator(".daily-note-block");
        await expect
            .poll(async () => {
                await container.evaluate((el) => {
                    const pane = el.parentElement!;
                    pane.scrollTo({ top: pane.scrollHeight, behavior: "instant" });
                });
                return blocks.evaluateAll((els) => els.map((el) => el.dataset.sourcePath));
            })
            .toEqual(dailyNotes);
    });

    test("leaves out a dated note in a subfolder the format does not name, at startup and on create", async ({
        obsidian,
    }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            await window.app.vault.createFolder("Notes/Archive").catch(() => {});
        });
        await write(page, "Notes/Archive/2026-03-25.md", "## Archived\n");
        const container = await openStream(page);
        await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");

        await write(page, "Notes/Archive/2026-03-26.md", "## Archived too\n");
        // Give the vault events time to do the wrong thing, if they are going
        // to.
        await page.waitForTimeout(1000);

        await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");
        await expect(container.locator(".daily-note-block[data-source-path^='Notes/Archive/']")).toHaveCount(0);
    });

    test("updates both panes of a split stream when a note is created or deleted", async ({
        obsidian,
        mobileLayout,
    }) => {
        test.skip(mobileLayout, "a phone has no splits");
        const { page } = obsidian;
        await openStream(page);
        await page.evaluate(async () => {
            const leaf = window.app.workspace.getLeaf("split", "vertical");
            await leaf.setViewState({ type: "daily-notes-stream-view", active: true });
        });
        const streams = page.locator(STREAM);
        await expect(streams).toHaveCount(2);
        const newest = (pane: number) => streams.nth(pane).locator(".daily-note-title").first();
        const expectNewest = async (date: string) => {
            for (const pane of [0, 1]) await expect(newest(pane)).toHaveText(date);
        };
        await expectNewest("2026-03-14");

        await write(page, "Notes/2026-03-20.md", "## Later\n\nA newer day.\n");
        await expectNewest("2026-03-20");

        await remove(page, "Notes/2026-03-20.md");
        await expectNewest("2026-03-14");
    });
});
