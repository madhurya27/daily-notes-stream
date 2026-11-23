import type { Locator, Page } from "@playwright/test";
import { test, expect, openStream, STREAM } from "./obsidian";

/** Newer than every test note, so it is first in the stream. */
const NOTE = "Notes/2026-03-20.md";
const TEXT = [
    "## Outer",
    "",
    "Outer text.",
    "",
    "### Inner",
    "",
    "Inner text.",
    "",
    "## Twin",
    "",
    "First twin's text.",
    "",
    "## Twin",
    "",
    "Second twin's text.",
    "",
    "## Read [[Reading list]] tonight",
    "",
    "- Parent",
    "    - Child",
    "",
].join("\n");

async function write(page: Page, text: string, mtime?: number) {
    await page.evaluate(
        async ({ path, text, mtime }) => {
            const { vault } = window.app;
            const file = vault.getFileByPath(path);
            if (file) await vault.modify(file, text, mtime === undefined ? undefined : { mtime });
            else await vault.create(path, text);
        },
        { path: NOTE, text, mtime }
    );
}

/**
 * The note's heading whose text is exactly `text`. `nth` chooses among headings
 * with the same text.
 */
const heading = (note: Locator, text: string, nth = 0) =>
    note
        .locator(".daily-note-content :is(h2, h3)")
        .filter({ hasText: new RegExp(`^${text}$`) })
        .nth(nth);

const chevron = (host: Locator) => host.locator(".collapse-indicator").first();

/** The section's saved state, or null if none is saved. */
const stored = (page: Page, sectionKey: string) =>
    page.evaluate(
        ({ path, key }) => {
            const saved = window.app.loadLocalStorage("daily-notes-stream:collapse") as {
                files: [string, [string, boolean][]][];
            } | null;
            const sections = new Map(saved?.files.find(([file]) => file === path)?.[1]);
            return sections.get(key) ?? null;
        },
        { path: NOTE, key: sectionKey }
    );

/**
 * The left edge of the first ink inside `box`, with every fold arrow hidden, or
 * `box`'s right edge if there is none.
 */
async function inkLeft(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<number> {
    const hide = await page.addStyleTag({ content: ".collapse-indicator { visibility: hidden !important; }" });
    const png = (await page.screenshot({ clip: box })).toString("base64");
    await hide.evaluate((el) => (el as Element).remove());
    const column = await page.evaluate(
        async ({ src, width }) => {
            const img = new Image();
            img.src = `data:image/png;base64,${src}`;
            await img.decode();
            const canvas = document.createElement("canvas");
            [canvas.width, canvas.height] = [img.width, img.height];
            const context = canvas.getContext("2d")!;
            context.drawImage(img, 0, 0);
            const { data } = context.getImageData(0, 0, img.width, img.height);
            for (let x = 0; x < img.width; x++)
                for (let y = 0; y < img.height; y++) {
                    const i = (y * img.width + x) * 4;
                    if (data[i]! + data[i + 1]! + data[i + 2]! < 700) return (x * width) / img.width;
                }
            return width;
        },
        { src: png, width: box.width }
    );
    return box.x + column;
}

test.describe("collapsing sections of a note", () => {
    let note: Locator;

    test.beforeEach(async ({ obsidian }) => {
        const { page } = obsidian;
        await write(page, TEXT);
        await openStream(page);
        note = page.locator(`${STREAM} .daily-note-block[data-source-path="${NOTE}"]`);
        await expect(note.locator(".daily-note-content")).toContainText("Second twin's text.");
    });

    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(async (path) => {
            window.app.workspace.detachLeavesOfType("markdown");
            const file = window.app.vault.getFileByPath(path);
            if (file) await window.app.vault.delete(file);
        }, NOTE);
    });

    test("leaves a nested section collapsed when the one around it expands", async () => {
        await chevron(heading(note, "Inner")).click();
        await chevron(heading(note, "Outer")).click();
        await expect(note.getByText("Outer text.")).toBeHidden();

        await chevron(heading(note, "Outer")).click();

        await expect(note.getByText("Outer text.")).toBeVisible();
        await expect(heading(note, "Inner")).toBeVisible();
        await expect(heading(note, "Inner")).toHaveClass(/is-collapsed/);
        await expect(note.getByText("Inner text.")).toBeHidden();
    });

    test("collapses two headings of the same text apart, and remembers them apart", async ({ obsidian }) => {
        await chevron(heading(note, "Twin", 0)).click();

        await expect(note.getByText("First twin's text.")).toBeHidden();
        await expect(note.getByText("Second twin's text.")).toBeVisible();

        await openStream(obsidian.page);
        await expect(heading(note, "Twin", 0)).toHaveClass(/is-collapsed/);
        await expect(heading(note, "Twin", 1)).not.toHaveClass(/is-collapsed/);
    });

    test("collapses a parent bullet's sub-bullets", async () => {
        const parent = note.locator("li").filter({ hasText: /^Parent/ });
        await expect(parent.getByText("Child")).toBeVisible();

        await chevron(parent).click();

        await expect(parent.getByText("Child")).toBeHidden();
        await expect(parent.getByText("Parent")).toBeVisible();
    });

    test("folds and unfolds a parent bullet with a click on the bullet", async ({ obsidian }) => {
        const parent = note.locator("li").filter({ hasText: /^Parent/ });
        const text = (await parent.locator(".daily-note-text-run").first().boundingBox())!;
        // The default theme draws the bullet's middle 11 px left of the text.
        const bullet = { x: text.x - 11, y: text.y + text.height / 2 };

        await obsidian.page.mouse.click(bullet.x, bullet.y);
        await expect(parent.getByText("Child")).toBeHidden();

        await obsidian.page.mouse.click(bullet.x, bullet.y);
        await expect(parent.getByText("Child")).toBeVisible();
    });

    test("leaves a heading open on a touch screen when its first letter is tapped", async ({ obsidian }) => {
        const { page } = obsidian;
        const host = heading(note, "Outer");
        // Detaching the session ends the emulation.
        const cdp = await page.context().newCDPSession(page);
        try {
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
            expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
            const text = await host.evaluate((el) => {
                const range = document.createRange();
                range.selectNodeContents(el.lastChild!);
                return range.getBoundingClientRect();
            });

            await page.mouse.click(text.left + 2, text.top + text.height / 2);

            await expect(host).not.toHaveClass(/is-collapsed/);
        } finally {
            await cdp.detach();
        }
    });

    test("puts a task's fold arrow on screen, beside its checkbox", async ({ obsidian }) => {
        await write(obsidian.page, "- [ ] Task\n    - Sub\n");
        const task = note.locator("li.task-list-item.is-collapsible");
        const arrow = (await chevron(task).locator("svg").boundingBox())!;
        const checkbox = (await task.locator("input").first().boundingBox())!;
        const pane = (await obsidian.page.locator(`.view-content:has(${STREAM})`).boundingBox())!;

        expect(arrow.x).toBeGreaterThanOrEqual(pane.x);
        expect(arrow.x + arrow.width).toBeLessThanOrEqual(checkbox.x);
        expect(checkbox.x - (arrow.x + arrow.width)).toBeLessThan(8);
    });

    test("puts a numbered item's fold arrow clear of its number", async ({ obsidian }) => {
        const { page } = obsidian;
        await write(page, "9. Ninth\n    - Sub\n10. Tenth\n    - Sub\n\nLater:\n\n100. Hundredth\n     - Sub\n");
        for (const label of ["Ninth", "Tenth", "Hundredth"]) {
            const item = note.locator("li.is-collapsible").filter({ hasText: new RegExp(`^${label}`) });
            const arrow = (await chevron(item).locator("svg path").boundingBox())!;
            const text = (await item.boundingBox())!.x;

            const number = await inkLeft(page, {
                x: arrow.x + arrow.width,
                y: arrow.y,
                width: text - arrow.x - arrow.width,
                height: arrow.height,
            });

            expect(number - (arrow.x + arrow.width), label).toBeGreaterThanOrEqual(4);
        }
    });

    // A bigger text size draws the bullet further left, so the arrow must
    // move out with it, and the gap grows with the text.
    test("keeps the gap between a bullet and its arrow in proportion to the text size", async ({ obsidian }) => {
        const { page } = obsidian;
        const parent = note.locator("li").filter({ hasText: /^Parent/ });
        const gap = async (size: string) => {
            await page.evaluate((s) => document.body.style.setProperty("--font-text-size", s), size);
            const arrow = (await chevron(parent).locator("svg path").boundingBox())!;
            const text = (await parent.locator(".daily-note-text-run").first().boundingBox())!.x;
            const bullet = await inkLeft(page, {
                x: arrow.x + arrow.width,
                y: arrow.y,
                width: text - arrow.x - arrow.width,
                height: arrow.height,
            });
            return bullet - (arrow.x + arrow.width);
        };
        try {
            expect(await gap("21px")).toBeCloseTo(((await gap("16px")) * 21) / 16, 0);
        } finally {
            await page.evaluate(() => document.body.style.removeProperty("--font-text-size"));
        }
    });

    test("selects no text when an arrow is clicked twice quickly", async ({ obsidian }) => {
        const { page } = obsidian;
        for (const host of [heading(note, "Outer"), note.locator("li").filter({ hasText: /^Parent/ })]) {
            await chevron(host).dblclick();

            expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("");
            await expect(host).not.toHaveClass(/is-collapsed/);
        }
    });

    test("leaves a heading open when its text is selected", async ({ obsidian }) => {
        const { page } = obsidian;
        const host = heading(note, "Outer");
        // The heading's box is wider than its word, so drag across the word
        // itself. One drag is one click. A double-click would fold and unfold,
        // which would hide a fold.
        const word = await host.evaluate((h) => {
            const text = [...h.childNodes].find(
                (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
            )!;
            const range = document.createRange();
            range.selectNodeContents(text);
            const { left, right, top, height } = range.getBoundingClientRect();
            return { left, right, y: top + height / 2 };
        });

        await page.mouse.move(word.left + 1, word.y);
        await page.mouse.down();
        await page.mouse.move(word.right - 1, word.y, { steps: 5 });
        await page.mouse.up();

        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Outer");
        await expect(host).not.toHaveClass(/is-collapsed/);
        await expect(note.getByText("Outer text.")).toBeVisible();
    });

    test("leaves a heading open when its link is followed", async ({ obsidian }) => {
        const { page } = obsidian;
        const host = heading(note, "Read Reading list tonight");

        // A new tab keeps the stream's DOM, which a plain click would navigate
        // away from.
        await host.locator(".internal-link").click({ modifiers: ["ControlOrMeta"] });

        await expect
            .poll(() => page.evaluate(() => window.app.workspace.getActiveFile()?.path))
            .toBe("Reading list.md");
        await expect(chevron(host)).toHaveAttribute("aria-expanded", "true");
    });

    test("expands a renamed heading, and forgets its old name once the note has settled", async ({ obsidian }) => {
        const { page } = obsidian;
        await chevron(heading(note, "Outer")).click();
        expect(await stored(page, "outer")).toBe(true);

        await write(page, TEXT.replace("## Outer", "## Renamed"));

        await expect(heading(note, "Renamed")).not.toHaveClass(/is-collapsed/);
        await expect(note.getByText("Outer text.")).toBeVisible();
        // During an edit, the old name may come back, so it is kept until the
        // note is a day old (D-027).
        expect(await stored(page, "outer")).toBe(true);

        await write(page, TEXT.replace("## Outer", "## Renamed"), Date.now() - 2 * 24 * 60 * 60 * 1000);

        await expect.poll(() => stored(page, "outer")).toBeNull();
    });

    test("announces each chevron as a button with its expanded state", async () => {
        const outer = chevron(heading(note, "Outer"));
        await expect(outer).toHaveRole("button");
        await expect(outer).toHaveAttribute("aria-expanded", "true");

        await outer.click();

        await expect(outer).toHaveAttribute("aria-expanded", "false");
        await expect(chevron(note.locator("li").filter({ hasText: /^Parent/ }))).toHaveRole("button");
    });
});
