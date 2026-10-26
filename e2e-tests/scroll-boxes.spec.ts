import type { Locator, Page } from "@playwright/test";
import { pdf } from "../scripts/pdf.mjs";
import { test, expect, openStream } from "./obsidian";

/** Newer than every test note, so it is first in the stream. */
const NOTE = "Notes/2026-03-15.md";

/**
 * Enough columns to be wider than a phone, and than a desktop at Bases' default
 * width.
 */
const WIDE_COLUMNS = ["file.name", "file.path", "file.folder", "file.ext", "file.size", "file.ctime", "file.mtime"];

const BASES: Record<string, string> = {
    "Wide.base": baseView(WIDE_COLUMNS),
    "Narrow.base": baseView(["file.name"]),
    // A column resized by hand ignores the maximum width set when fitting, so
    // it is clipped instead.
    "Resized.base": baseView(["file.name", "file.path"], ["columnSize:", "      file.path: 900"]),
    // One column for each file type, md, base and pdf, which is wider than a
    // phone (1.14).
    "Kanban.base": baseView(["file.name"], ["groupBy:", "      property: file.ext", "      direction: ASC"], "kanban"),
};

function baseView(order: string[], extra: string[] = [], type = "table"): string {
    return [
        "views:",
        `  - type: ${type}`,
        "    name: Table",
        "    order:",
        ...order.map((column) => `      - ${column}`),
        ...extra.map((line) => `    ${line}`),
        "",
    ].join("\n");
}

/** Where Kanban.base is drawn among this note's Bases. */
const KANBAN_SLOT = 3;

/** Three pages of text. Obsidian's PDF viewer scrolls between them. */
const PDF = { path: "Doc.pdf", body: pdf(3) };

/**
 * One of each kind of embed that scrolls inside a note elsewhere in Obsidian.
 */
const ZOO = [
    "## Embeds",
    "",
    "![[Wide.base]]",
    "",
    "![[Narrow.base]]",
    "",
    "![[Resized.base]]",
    "",
    "![[Kanban.base]]",
    "",
    // Inline, so it is still a table on a phone.
    "Fitted: ![[Wide.base]]",
    "",
    "![[Reading list]]",
    "",
    "![[Reading list#Later]]",
    "",
    `![[${PDF.path}]]`,
    "",
    // Wider than a phone, as a pasted video embed is.
    '<iframe src="about:blank" width="560" height="315"></iframe>',
    "",
    "$$\\sum_{i=1}^{n} x_i + \\sum_{j=1}^{m} y_j + \\sum_{k=1}^{p} z_k + \\sum_{l=1}^{q} w_l + \\sum_{r=1}^{s} v_r + \\int_0^1 f(t)\\,dt$$",
    "",
    "```mermaid",
    "flowchart LR",
    "  A[Alpha step] --> B[Beta step] --> C[Gamma step] --> D[Delta step] --> E[Epsilon step] --> F[Zeta step]",
    "```",
    "",
    "| Column one | Column two | Column three | Column four | Column five | Column six | Column seven |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| a | b | c | d | e | f | g |",
    "",
].join("\n");

/**
 * Every element in the stream that is a scroll container, except SVG.
 */
function scrollBoxes(container: Locator): Promise<string[]> {
    return container.evaluate((root) =>
        Array.from(root.querySelectorAll("*"))
            .filter((el) => !(el instanceof SVGElement))
            .filter((el) => {
                const style = getComputedStyle(el);
                return /auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`);
            })
            .map((el) => `${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".")}`)
    );
}

async function seedZoo(page: Page): Promise<void> {
    await page.evaluate(
        async ({ bases, note, zoo }) => {
            // What Mermaid's "Allow" saves. Without it, Obsidian draws no
            // diagram.
            window.app.saveLocalStorage("mermaid-vault-trust", true);
            for (const [path, body] of Object.entries(bases)) await window.app.vault.create(path, body);
            await window.app.vault.create(note, zoo);
        },
        { bases: { ...BASES, [PDF.path]: PDF.body }, note: NOTE, zoo: ZOO }
    );
}

async function deleteZoo(page: Page): Promise<void> {
    await page.evaluate(
        async (paths) => {
            for (const path of paths) {
                const file = window.app.vault.getAbstractFileByPath(path);
                if (file) await window.app.vault.delete(file);
            }
        },
        [NOTE, PDF.path, ...Object.keys(BASES)]
    );
}

/**
 * How far `el` could scroll sideways, and whether it is a scroll container.
 */
function sidewaysScroll(el: Locator): Promise<{ overflow: number; scrolls: boolean }> {
    return el.evaluate((box) => ({
        overflow: box.scrollWidth - box.clientWidth,
        scrolls: /auto|scroll/.test(getComputedStyle(box).overflowX),
    }));
}

// Neither side makes the page itself wider.
test("never scrolls the page sideways", async ({ obsidian }) => {
    const { page } = obsidian;
    await seedZoo(page);
    try {
        const container = await openStream(page);
        await expect(container.locator(".bases-view").first()).toBeVisible();
        await expect(container.locator(".mermaid svg")).toBeVisible();
        await expect(container.locator("iframe")).toBeAttached();

        await expect
            .poll(() => container.evaluate((el) => el.parentElement!.scrollWidth - el.parentElement!.clientWidth))
            .toBeLessThanOrEqual(0);
    } finally {
        await deleteZoo(page);
    }
});

test("on desktop, draws a kanban as a kanban", async ({ obsidian, mobileLayout }) => {
    test.skip(mobileLayout, "a phone draws a wide kanban as cards");
    const { page } = obsidian;
    await seedZoo(page);
    try {
        const container = await openStream(page);

        await expect(container.locator(".bases-kanban-card").first()).toBeVisible();
    } finally {
        await deleteZoo(page);
    }
});

// If it were clipped, it would pass the test above with the end of the equation
// missing.
test("on mobile, shrinks a wide equation to fit the note", async ({ obsidian, mobileLayout }) => {
    test.skip(!mobileLayout, "desktop draws math as Obsidian does");
    const { page } = obsidian;
    await seedZoo(page);
    try {
        const container = await openStream(page);
        const math = container.locator('mjx-container[display="true"] mjx-math');
        await expect(math).toBeVisible();

        await expect
            .poll(() =>
                math.evaluate((el) => {
                    const note = el.closest(".daily-note-content")!.getBoundingClientRect();
                    const box = el.getBoundingClientRect();
                    return box.left >= note.left - 0.5 && box.right <= note.right + 0.5;
                })
            )
            .toBe(true);
    } finally {
        await deleteZoo(page);
    }
});

// A scroll container inside the scroller stops iOS's scrolling early once notes
// have been unloaded. Android follows the same rule (ADR 0008).
test.describe("on mobile, nothing inside the stream scrolls", () => {
    test.beforeEach(({ mobileLayout }) => test.skip(!mobileLayout, "desktop keeps its scroll bars"));
    test.afterEach(({ obsidian }) => deleteZoo(obsidian.page));

    test("has no scroll box in the seeded notes", async ({ obsidian }) => {
        const container = await openStream(obsidian.page);
        await expect(container.locator("table").first()).toBeVisible();

        await expect.poll(() => scrollBoxes(container)).toEqual([]);
    });

    test("has no scroll box around Bases, kanban included, math, diagrams or embedded notes", async ({ obsidian }) => {
        const { page } = obsidian;
        await seedZoo(page);
        const container = await openStream(page);
        const note = container.locator(".daily-note-block").first();
        await expect(note.locator(".bases-view")).toHaveCount(5);
        await expect(note.locator(".bases-tr").first()).toBeVisible();
        await expect(note.locator(".bases-cards-item").first()).toBeVisible();
        await expect(note.locator(".mermaid svg")).toBeVisible();
        await expect(note.locator(".pdf-embed canvas").first()).toBeVisible();

        await expect.poll(() => scrollBoxes(container)).toEqual([]);
    });

    // Clipped, it showed one of several columns. Cards show every column as a
    // group.
    test("draws a kanban wider than the note as cards, a group per column", async ({ obsidian }) => {
        const { page } = obsidian;
        await seedZoo(page);
        const columns = await page.evaluate((): string[] => [
            ...new Set<string>(window.app.vault.getFiles().map((f: { extension: string }) => f.extension)),
        ]);
        const kanban = (await openStream(page)).locator(".daily-note-base").nth(KANBAN_SLOT);
        await expect(kanban.locator(".bases-cards-item").first()).toBeVisible();

        await expect(kanban.locator(".bases-kanban-card")).toHaveCount(0);
        for (const ext of columns) await expect(kanban.getByText(ext, { exact: true })).toBeVisible();
    });

    // Clipped, its viewer shows page 1, and its toolbar does nothing (D-083).
    test("opens a PDF from a tap on its first page", async ({ obsidian }) => {
        const { page } = obsidian;
        await seedZoo(page);
        const pdf = (await openStream(page)).locator(".pdf-embed");
        await expect(pdf.locator("canvas").first()).toBeVisible();
        await expect(pdf.locator(".pdf-toolbar:visible")).toHaveCount(0);

        await pdf.click();

        await expect.poll(() => page.evaluate(() => window.app.workspace.getActiveFile()?.path)).toBe(PDF.path);
    });

    test("fits a Base that cannot become cards to the note", async ({ obsidian }) => {
        const { page } = obsidian;
        await seedZoo(page);
        const container = await openStream(page);
        const view = container.locator(".bases-view:has(.bases-thead)").first();
        await expect(view.locator(".bases-tr").first()).toBeVisible();

        await expect
            .poll(() =>
                view.evaluate((el) => el.querySelector<HTMLElement>(".bases-thead")!.offsetWidth - el.clientWidth)
            )
            .toBeLessThanOrEqual(0);
    });

    // Bases pins both to its own scroll container. If it were clipped, they
    // would be pinned to the stream's.
    test("keeps a Base's header and summaries on its table while the stream scrolls", async ({ obsidian }) => {
        const { page } = obsidian;
        // A screen of text on each side, so the stream can scroll the table
        // past either edge.
        const screen = Array.from({ length: 40 }, (_, i) => `Line ${i}`).join("\n\n");
        await page.evaluate(
            async ({ note, body, base }) => {
                await window.app.vault.create("Summed.base", base);
                await window.app.vault.create(note, body);
            },
            {
                note: NOTE,
                body: `${screen}\n\n![[Summed.base]]\n\n${screen}\n`,
                base: baseView(["file.name", "file.size"], ["summaries:", "      file.size: Sum"]),
            }
        );
        try {
            const view = (await openStream(page)).locator(".bases-view").first();
            await expect(view.locator(".bases-table-footer")).toBeAttached();

            /**
             * Scrolls the view's `edge` 100px past the screen's edge. Returns
             * how far it went, and where each bar is on the view.
             */
            const scrollPast = (edge: "top" | "bottom") =>
                view.evaluate((el, edge) => {
                    const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                    const sign = edge === "top" ? -1 : 1;
                    const past = () => sign * (el.getBoundingClientRect()[edge] - pane.getBoundingClientRect()[edge]);
                    const offset = (bar: string) =>
                        el.querySelector(bar)!.getBoundingClientRect()[edge] - el.getBoundingClientRect()[edge];
                    const bars = () => ({ header: offset(".bases-thead"), footer: offset(".bases-table-footer") });
                    const before = bars();
                    pane.scrollTop -= sign * (100 - past());
                    return { past: past(), before, after: bars() };
                }, edge);

            const top = await scrollPast("top");
            expect(top.past).toBeCloseTo(100, 0);
            expect(top.after.header).toBe(top.before.header);
            const bottom = await scrollPast("bottom");
            expect(bottom.past).toBeCloseTo(100, 0);
            expect(bottom.after.footer).toBe(bottom.before.footer);
        } finally {
            await page.evaluate(async () => {
                const file = window.app.vault.getAbstractFileByPath("Summed.base");
                if (file) await window.app.vault.delete(file);
            });
        }
    });

    test("stacks a table too wide for the note", async ({ obsidian }) => {
        const container = await openStream(obsidian.page);
        const table = container.locator(".daily-note-block").first().locator("table").first();

        await expect(table).toHaveClass(/is-stacked/);
        // Each stacked cell shows its column's name, from the header row.
        await expect(table.locator("tbody td").nth(1)).toHaveAttribute("data-column", "Distance");
    });
});

test.describe("on desktop, wide content scrolls inside its own box", () => {
    test.beforeEach(({ mobileLayout }) => test.skip(mobileLayout, "mobile has no scroll boxes"));
    test.afterEach(({ obsidian }) => deleteZoo(obsidian.page));

    test("gives a table too wide for the note its own scroll bar", async ({ obsidian }) => {
        const { page } = obsidian;
        // Cells that cannot break. A table wraps its words, so only these are
        // too wide.
        const cell = "x".repeat(60);
        await page.evaluate(
            async (text) => {
                await window.app.vault.create("Notes/2026-03-15.md", text);
            },
            [`| A | B | C |`, `| --- | --- | --- |`, `| ${cell} | ${cell} | ${cell} |`, ""].join("\n")
        );
        const table = (await openStream(page)).locator(".daily-note-block").first().locator("table");
        await expect(table).toBeVisible();

        const scroll = await sidewaysScroll(table);
        expect(scroll.scrolls).toBe(true);
        expect(scroll.overflow).toBeGreaterThan(0);
    });

    test("draws a wide Base as its own table, scrolling, not cards", async ({ obsidian }) => {
        const { page } = obsidian;
        await seedZoo(page);
        const note = (await openStream(page)).locator(".daily-note-block").first();
        const view = note.locator(".bases-view").first();
        await expect(view.locator(".bases-tr").first()).toBeVisible();

        await expect.poll(async () => (await sidewaysScroll(view)).overflow).toBeGreaterThan(0);
        expect((await sidewaysScroll(view)).scrolls).toBe(true);
        await expect(note.locator(".bases-cards-item")).toHaveCount(0);
    });

    test("keeps a table a table, unlabeled", async ({ obsidian }) => {
        const container = await openStream(obsidian.page);
        const table = container.locator(".daily-note-block").first().locator("table").first();
        await expect(table).toBeVisible();

        await expect(table).not.toHaveClass(/is-stacked/);
        await expect(table.locator("tbody td").nth(1)).not.toHaveAttribute("data-column");
    });
});
