import type { Locator, Page } from "@playwright/test";
import { test, expect, openStream, seededDate, today, STREAM, unloadFar } from "./obsidian";

const NEWEST = seededDate(0);

/**
 * Notes that link to the newest daily note. There are two Agenda notes, so
 * `[[Agenda]]` goes to the one next to whichever note it is written in.
 */
const SOURCES: Record<string, string> = {
    "Ideas/Agenda.md": "# Ideas agenda\n",
    "Notes/Agenda.md": "# Notes agenda\n",
    "Ideas/Plan.md": [
        "# Plan",
        "",
        `- Talk about [[${NEWEST}]] at the [[Agenda]]`,
        "- Something else",
        "",
        "| Column one | Column two | Column three | Column four | Column five | Column six | Column seven |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        `| [[${NEWEST}]] | b | c | d | e | f | g |`,
        "",
    ].join("\n"),
    "Trip.md": `---\nday: "[[${NEWEST}]]"\n---\n\nPacked.\n`,
};

/** The paths the cache says link to `target`. */
function linkingTo(page: Page, target: string): Promise<string[]> {
    return page.evaluate(
        (path) =>
            Object.entries(window.app.metadataCache.resolvedLinks as Record<string, Record<string, number>>)
                .filter(([, targets]) => path in targets)
                .map(([source]) => source)
                .sort(),
        target
    );
}

async function create(page: Page, files: Record<string, string>): Promise<void> {
    await page.evaluate(async (entries) => {
        for (const [path, body] of entries) {
            const folder = path.split("/").slice(0, -1).join("/");
            if (folder && !window.app.vault.getAbstractFileByPath(folder)) await window.app.vault.createFolder(folder);
            await window.app.vault.create(path, body);
        }
    }, Object.entries(files));
}

async function remove(page: Page, paths: string[]): Promise<void> {
    await page.evaluate(async (all) => {
        for (const path of [...all, "Ideas"]) {
            const file = window.app.vault.getAbstractFileByPath(path);
            if (file) await window.app.vault.delete(file, true);
        }
    }, paths);
}

/** Renames through the file manager, as the file explorer does. */
async function rename(page: Page, from: string, to: string): Promise<void> {
    await page.evaluate(
        ({ from, to }) => window.app.fileManager.renameFile(window.app.vault.getFileByPath(from)!, to),
        { from, to }
    );
}

/** The newest note's footer, drawn. */
async function footerOfNewest(page: Page): Promise<Locator> {
    const container = await openStream(page);
    const footer = container.locator(`.daily-note-block[data-source-path="Notes/${NEWEST}.md"] .daily-note-mentions`);
    await expect(footer.locator(".daily-note-mention")).toHaveCount(2);
    return footer;
}

test.describe("linked mentions", () => {
    test.beforeEach(async ({ obsidian }) => {
        const { page } = obsidian;
        await create(page, SOURCES);
        await expect.poll(() => linkingTo(page, `Notes/${NEWEST}.md`)).toEqual(["Ideas/Plan.md", "Trip.md"]);
    });

    test.afterEach(async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
        await remove(page, [...Object.keys(SOURCES), "Later.md", "Journey.md"]);
    });

    test("lists the notes linking to a note under it, with the text around each link", async ({ obsidian }) => {
        const footer = await footerOfNewest(obsidian.page);

        await expect(footer.locator(".daily-note-mentions-count")).toHaveText("2");
        await expect(footer.locator(".daily-note-mention-title")).toHaveText(["Plan", "Trip"]);
        const plan = footer.locator('.daily-note-mention[data-link-source="Ideas/Plan.md"]');
        await expect(plan.locator(".daily-note-mention-excerpt").first()).toHaveText(/Talk about .* at the Agenda/);
        await expect(plan.locator(".daily-note-mention-excerpt").first()).not.toContainText("Something else");
        await expect(footer.locator('[data-link-source="Trip.md"] .daily-note-mention-excerpt')).toHaveText(/^day: /);
    });

    // The note's own bottom border is the stream's only divider. A second line
    // above the footer looked like the end of a note.
    test("draws no line of its own, leaving the note's end the only one", async ({ obsidian }) => {
        const footer = await footerOfNewest(obsidian.page);

        await expect(footer).toHaveCSS("border-top-style", "none");
    });

    test("opens a linking note from its title", async ({ obsidian }) => {
        const { page } = obsidian;
        const footer = await footerOfNewest(page);

        await footer.locator(".daily-note-mention-title", { hasText: "Plan" }).click();

        await expect.poll(() => page.evaluate(() => window.app.workspace.getActiveFile()?.path)).toBe("Ideas/Plan.md");
    });

    test("resolves an excerpt's links from the note it was written in", async ({ obsidian }) => {
        const { page } = obsidian;
        const footer = await footerOfNewest(page);

        await footer.locator(".daily-note-mention-excerpt .internal-link", { hasText: "Agenda" }).click();

        await expect
            .poll(() => page.evaluate(() => window.app.workspace.getActiveFile()?.path))
            .toBe("Ideas/Agenda.md");
    });

    test("adds a note that starts linking here while the stream is open", async ({ obsidian }) => {
        const { page } = obsidian;
        const footer = await footerOfNewest(page);

        await create(page, { "Later.md": `Back to [[${NEWEST}]].\n` });

        await expect(footer.locator(".daily-note-mentions-count")).toHaveText("3");
        await expect(footer.locator(".daily-note-mention-title")).toHaveText(["Plan", "Later", "Trip"]);
    });

    test("drops a linking note once it is deleted", async ({ obsidian }) => {
        const { page } = obsidian;
        const footer = await footerOfNewest(page);

        await page.evaluate(() => window.app.vault.delete(window.app.vault.getFileByPath("Trip.md")!));

        await expect(footer.locator(".daily-note-mentions-count")).toHaveText("1");
        await expect(footer.locator(".daily-note-mention-title")).toHaveText(["Plan"]);
    });

    test("follows a linking note across its rename", async ({ obsidian }) => {
        const { page } = obsidian;
        const footer = await footerOfNewest(page);

        await rename(page, "Trip.md", "Journey.md");

        await expect(footer.locator(".daily-note-mention-title")).toHaveText(["Plan", "Journey"]);
    });

    test("stays collapsed once collapsed, on the next open too", async ({ obsidian }) => {
        const { page } = obsidian;
        const footer = await footerOfNewest(page);

        await footer.locator(".daily-note-mentions-heading").click();
        await expect(footer.locator(".daily-note-mentions-content")).toBeHidden();

        const reopened = (await openStream(page)).locator(
            `.daily-note-block[data-source-path="Notes/${NEWEST}.md"] .daily-note-mentions`
        );
        await expect(reopened).toHaveClass(/is-collapsed/);
        await expect(reopened.locator(".daily-note-mentions-count")).toHaveText("2");
        await reopened.locator(".daily-note-mentions-heading").click();
        await expect(reopened.locator(".daily-note-mention")).toHaveCount(2);
    });

    // Nothing in the stream may scroll on a phone (ADR 0008), including a
    // quoted table.
    test("makes nothing in the footer a scroll box on a phone", async ({ obsidian, mobileLayout }) => {
        test.skip(!mobileLayout, "desktop keeps Obsidian's scroll bars");
        const footer = await footerOfNewest(obsidian.page);
        await expect(footer.locator("table")).toBeVisible();
        // Obsidian makes the parent of a table on its own scroll. The guard
        // cuts it off once scrolling stops.
        await expect
            .poll(() =>
                footer.evaluate((root) =>
                    Array.from(root.querySelectorAll("*"))
                        .filter((el) => !(el instanceof SVGElement))
                        .filter((el) => {
                            const style = getComputedStyle(el);
                            return /auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`);
                        })
                        .map((el) => `${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".")}`)
                )
            )
            .toEqual([]);
    });

    // The footer reads the linking notes after the note draws. A note that the
    // reader scrolls back to must not end up too short in between, or the text
    // below it would jump on iOS.
    test("holds a note coming back into view at its height while its mentions are read", async ({ obsidian }) => {
        const { page } = obsidian;
        await footerOfNewest(page);
        const container = page.locator(STREAM);
        const blocks = container.locator(".daily-note-block");
        const newest = blocks.first();
        await expect
            .poll(() =>
                newest.evaluate((el) =>
                    window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes
                        .toJSON()
                        .heights.some(([, heights]: [string, [string, number][]]) =>
                            heights.some(([path]) => path === el.dataset.sourcePath)
                        )
                )
            )
            .toBe(true);
        const height = (await newest.boundingBox())!.height;

        for (let i = 1; !(await newest.getAttribute("class"))!.includes("is-far"); i++) {
            await blocks.nth(i).evaluate((el) => el.scrollIntoView({ block: "start" }));
            await page.waitForTimeout(400);
        }
        await unloadFar(newest);

        // Reading the linking notes now takes longer than the wait for the note
        // to stop changing, as on a slow disk.
        const heights = await page.evaluate(async () => {
            const vault = window.app.vault;
            const read = vault.cachedRead.bind(vault);
            vault.cachedRead = async (file: { path: string }) => {
                if (file.path !== "Ideas/Plan.md") return read(file);
                await new Promise((resolve) => setTimeout(resolve, 800));
                return read(file);
            };
            const block = document.querySelector<HTMLElement>(".daily-note-block")!;
            const seen: number[] = [];
            const observer = new ResizeObserver(() => seen.push(block.getBoundingClientRect().height));
            observer.observe(block);
            document.querySelectorAll(".daily-note-block")[1]!.scrollIntoView({ block: "start" });
            await new Promise((resolve) => setTimeout(resolve, 2000));
            observer.disconnect();
            vault.cachedRead = read;
            return { seen, rendered: !block.classList.contains("is-unloaded") };
        });

        expect(heights.rendered).toBe(true);
        expect(Math.min(...heights.seen)).toBeGreaterThanOrEqual(height - 1);
    });
});

// The core plugin creates today's note when the vault opens, after the links to
// that day are written.
test("lists the notes linking to a note written before it was", async ({ obsidian }) => {
    const { page } = obsidian;
    const date = await today(page);
    const path = `Notes/${date}.md`;
    await remove(page, [path]);
    try {
        await create(page, { "Plan.md": `Talk about [[${date}]].` });
        const container = await openStream(page);
        await create(page, { [path]: "Morning." });

        const heading = container.locator(`.daily-note-block[data-source-path="${path}"] .daily-note-mentions-heading`);
        await expect(heading).toBeVisible();
        await expect(heading.locator(".daily-note-mentions-count")).toHaveText("1");
    } finally {
        await remove(page, ["Plan.md", path]);
    }
});
