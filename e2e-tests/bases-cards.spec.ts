import type { Locator, Page } from "@playwright/test";
import { test, expect, atTextScale, atTextSize, openStream, LAYOUT_VIEWPORT, unloadFar } from "./obsidian";

/** Newer than every test note, so it is first in the stream. */
const NOTE = "Notes/2026-03-15.md";

function table(name: string, columns: string[], ...extra: string[]): string[] {
    return ["  - type: table", `    name: ${name}`, ...extra, "    order:", ...columns.map((c) => `      - ${c}`)];
}

const block = (...lines: string[]) => ["```base", ...lines, "```", ""];

/** Its headers alone are wider than a phone and a desktop note. */
const HEADERS_WIDE = ["file.name", "file.path", "file.folder", "file.ext", "file.size", "file.ctime", "file.mtime"];
/**
 * Fits a tablet's note but not a phone's: the headers are only wider than the
 * phone.
 */
const MIDDLE = ["file.name", "file.path", "file.folder", "file.ext", "file.size"];

/**
 * Short headers and long values: only the drawn table shows that it is too
 * wide.
 */
const VALUES_WIDE = [
    "formulas:",
    ...["a", "b", "c", "d"].map((f) => `  ${f}: file.path + " " + file.path`),
    "views:",
    ...table("Values", ["formula.a", "formula.b", "formula.c", "formula.d"]),
];

/** An embed names its second view. `this` is the note that embeds it. */
const TWO_VIEWS = [
    "views:",
    ...table("First", ["file.name"]),
    ...table("This note", HEADERS_WIDE, "    filters: file.path == this.file.path"),
    "",
].join("\n");

async function seed(page: Page, body: string[]): Promise<string> {
    const text = body.join("\n");
    await page.evaluate(
        async ({ note, text, base }) => {
            await window.app.vault.create("Two.base", base);
            await window.app.vault.create(note, text);
        },
        { note: NOTE, text, base: TWO_VIEWS }
    );
    return text;
}

const read = (page: Page, path: string) => page.evaluate((p) => window.app.vault.adapter.read(p), path);

/**
 * Bases keeps a hidden card to measure with. Only the drawn cards are
 * `draggable`.
 */
const cards = (base: Locator) => base.locator(".bases-cards-item[draggable]");

/** Wide enough that `MIDDLE` fits. */
const TABLET_WIDTH = 900;

async function resize(page: Page, width: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: LAYOUT_VIEWPORT.mobile.height,
        deviceScaleFactor: 1,
        mobile: false,
    });
}

// Mobile only. Desktop draws Bases as Obsidian does (ADR 0008).
test.describe("Bases on mobile", () => {
    test.beforeEach(({ mobileLayout }) => test.skip(!mobileLayout, "desktop draws Bases as Obsidian does"));
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(
            async (paths) => {
                for (const path of paths) {
                    const file = window.app.vault.getAbstractFileByPath(path);
                    if (file) await window.app.vault.delete(file);
                }
            },
            [NOTE, "Two.base"]
        );
    });

    // The same rule as a Markdown table: cards only when wider than the note.
    test("draws a Base too wide for the note as cards, one that fits as a table", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, [
            ...block("views:", ...table("Wide", HEADERS_WIDE)),
            ...block("views:", ...table("Narrow", ["file.name"])),
        ]);
        const bases = (await openStream(page)).locator(".daily-note-block").first().locator(".daily-note-base");

        await expect(cards(bases.nth(0)).first()).toBeVisible();
        await expect(bases.nth(0).locator(".bases-thead")).toHaveCount(0);
        await expect(bases.nth(1).locator(".bases-thead")).toBeVisible();
        await expect(cards(bases.nth(1))).toHaveCount(0);
    });

    test("draws one card to a row when the settings ask", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("Wide", HEADERS_WIDE)));
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.oneCardPerRow = true;
            await plugin.saveSettings();
        });
        const base = (await openStream(page)).locator(".daily-note-base").first();
        await expect(cards(base).nth(1)).toBeVisible();

        const [first, second] = await Promise.all([0, 1].map((i) => cards(base).nth(i).boundingBox()));
        expect(second!.x).toBe(first!.x);
        expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
    });

    // Its headers alone decide it, measured once from Bases' own header.
    test("draws a Base whose headers overrun the note straight as cards", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(() => {
            const w = window as unknown as { tablesDrawn: number };
            w.tablesDrawn = 0;
            new MutationObserver((records) => {
                for (const record of records)
                    for (const node of Array.from(record.addedNodes))
                        if (
                            node instanceof Element &&
                            !node.matches(".daily-note-bases-probe") &&
                            node.querySelector(".bases-thead")
                        )
                            w.tablesDrawn++;
            }).observe(document.body, { childList: true, subtree: true });
        });
        await seed(page, block("views:", ...table("Wide", HEADERS_WIDE)));
        const base = (await openStream(page)).locator(".daily-note-base").first();

        await expect(cards(base).first()).toBeVisible();
        expect(await page.evaluate(() => (window as unknown as { tablesDrawn: number }).tablesDrawn)).toBe(0);
    });

    // Bases draws a card's border as a 1px ring outside the card, and nothing
    // may cut that off.
    test("shows each card's whole border", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("Wide", HEADERS_WIDE)));
        const card = cards((await openStream(page)).locator(".daily-note-base").first()).first();
        await expect(card).toBeVisible();

        const clipped = await card.evaluate((el) => {
            const ring = el.getBoundingClientRect();
            const found: string[] = [];
            for (let e = el.parentElement; e && !e.matches(".daily-note-block"); e = e.parentElement) {
                if (getComputedStyle(e).overflowX === "visible") continue;
                const box = e.getBoundingClientRect();
                if (box.left > ring.left - 1 || box.right < ring.right + 1 || box.top > ring.top - 1)
                    found.push(e.className);
            }
            return found;
        });
        expect(clipped).toEqual([]);
    });

    // Bases moves its cards and its header's first icon inwards, but the note's
    // text is not moved. The ring is the card's border.
    test("lines a card's border and the header's first icon up with the note's text", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("Wide", HEADERS_WIDE)));
        const base = (await openStream(page)).locator(".daily-note-base").first();
        await expect(cards(base).first()).toBeVisible();

        const offsets = await base.evaluate((el) => {
            const text = el.closest(".daily-note-content")!.getBoundingClientRect();
            // A phone may fit two cards in a row, so the ring belongs to the
            // row.
            const row = [...el.querySelectorAll(".bases-cards-item[draggable]")]
                .map((card) => card.getBoundingClientRect())
                .filter((card, _, [first]) => card.top === first!.top);
            const icon = el.querySelector(".bases-toolbar svg")!.getBoundingClientRect();
            return {
                ringLeft: Math.round(row[0]!.left - 1 - text.left),
                ringRight: Math.round(text.right - row.at(-1)!.right - 1),
                icon: Math.round(icon.left - text.left),
            };
        });
        expect(offsets).toEqual({ ringLeft: 0, ringRight: 0, icon: 0 });
    });

    // Obsidian shrinks the view name and the count to fit the toolbar. If they
    // were clipped instead of hidden (ADR 0008), neither would shrink.
    test("fits every toolbar item in a Base's header, shortening a long view name", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("A view name far too long for any phone's toolbar", HEADERS_WIDE)));
        const base = (await openStream(page)).locator(".daily-note-base").first();
        await expect(base.locator(".bases-toolbar")).toBeVisible();

        const toolbar = await base.evaluate((el) => {
            const bar = el.querySelector(".bases-toolbar")!;
            const right = bar.getBoundingClientRect().right;
            const name = bar.querySelector(".bases-toolbar-views-menu")!;
            return {
                // An item's margin goes past its button, so use the button, as
                // the item cuts it off.
                cut: [...bar.children]
                    .filter((item) => {
                        const button = item.firstElementChild!.getBoundingClientRect().right;
                        return Math.min(button, item.getBoundingClientRect().right) > right + 1;
                    })
                    .map((item) => item.className),
                // Its label gets shorter, not the arrow after it.
                chevronShown:
                    name.querySelector(".mod-aux")!.getBoundingClientRect().right <=
                    name.getBoundingClientRect().right + 1,
            };
        });
        expect(toolbar).toEqual({ cut: [], chevronShown: true });
    });

    // D-097: on a phone, New takes the space that a short view name and the
    // count need.
    test("hides a Base's New button, leaving a short view name and the count whole", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("Books", HEADERS_WIDE)));
        const base = (await openStream(page)).locator(".daily-note-base").first();
        await expect(base.locator(".bases-toolbar")).toBeVisible();

        await expect(base.locator(".bases-toolbar-new-item-menu")).toBeHidden();
        const shortened = await base.evaluate((el) =>
            [...el.querySelectorAll(".bases-toolbar .text-button-label")]
                .filter((label) => label.scrollWidth > label.clientWidth)
                .map((label) => label.textContent)
        );
        expect(shortened).toEqual([]);
    });

    /**
     * Draws a card holding a tag pill below its title. Returns whatever cuts
     * off the pill, up to its card.
     */
    async function tagPillClippedBy(page: Page): Promise<string[]> {
        await seed(page, [
            "---",
            "tags:",
            "  - Books",
            "---",
            "",
            ...block(
                "views:",
                "  - type: cards",
                "    name: Tags",
                "    order:",
                "      - file.name",
                "      - note.tags"
            ),
        ]);
        const pill = cards((await openStream(page)).locator(".daily-note-base").first())
            .first()
            .locator(".bases-cards-line a.tag")
            .first();
        await expect(pill).toBeVisible();
        return pill.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const found: string[] = [];
            for (let e = el.parentElement; e && !e.matches(".bases-cards-item"); e = e.parentElement) {
                if (getComputedStyle(e).overflow === "visible") continue;
                const clip = e.getBoundingClientRect();
                // Within a pixel, because inline layout leaves the pill a
                // fraction of a pixel above its line's top.
                const cut = Math.max(
                    clip.top - box.top,
                    box.bottom - clip.bottom,
                    clip.left - box.left,
                    box.right - clip.right
                );
                if (cut >= 1) found.push(e.className);
            }
            return found;
        });
    }

    // Bases draws a card's line at a fixed height, and a pill becomes taller
    // than that as the font grows.
    test("shows a tag pill whole in its card at a large font", async ({ obsidian }) => {
        const { page } = obsidian;
        await atTextSize(page, 22, async () => {
            expect(await tagPillClippedBy(page)).toEqual([]);
        });
    });

    // On a phone, Obsidian changes a pill's text size with iOS's text size
    // setting.
    test("shows a tag pill whole in its card at iOS's larger text sizes", async ({ obsidian }) => {
        const { page } = obsidian;
        await atTextScale(page, 1.5, async () => {
            expect(await tagPillClippedBy(page)).toEqual([]);
        });
    });

    // Bases fills a view after it is drawn. A note that comes back keeps its
    // height until its Bases fill in again, or everything below jumps away and
    // back. This is easy to see on iOS, which does not keep the scroll
    // position.
    test("holds a note's height while its Bases redraw on scrolling back", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("Wide", HEADERS_WIDE)));
        const container = await openStream(page);
        const top = container.locator(".daily-note-block").first();
        const base = top.locator(".daily-note-base").first();
        await expect(cards(base).first()).toBeVisible();
        await page.waitForTimeout(500);

        await container.locator(".daily-note-block").nth(6).scrollIntoViewIfNeeded();
        await unloadFar(top);
        const height = (await top.boundingBox())!.height;

        // Read after every change to the note. Reading forces a layout, so no
        // frame is needed to catch a dip.
        await top.evaluate((el) => {
            const w = window as unknown as { lowest: number };
            w.lowest = Infinity;
            new MutationObserver(() => {
                w.lowest = Math.min(w.lowest, el.getBoundingClientRect().height);
            }).observe(el, { childList: true, subtree: true, attributes: true });
        });
        await top.scrollIntoViewIfNeeded();
        await expect(cards(base).first()).toBeVisible();
        await page.waitForTimeout(500);

        const lowest = await page.evaluate(() => (window as unknown as { lowest: number }).lowest);
        expect(lowest).toBeGreaterThanOrEqual(height - 1);
    });

    // Custom properties are inherited, so a note's held height would also hold
    // each Base at that height.
    test("holds a note without holding the Bases in it", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("Wide", HEADERS_WIDE)));
        const container = await openStream(page);
        const top = container.locator(".daily-note-block").first();
        const base = top.locator(".daily-note-base").first();
        await expect(cards(base).first()).toBeVisible();

        // A Base keeps its own height where it was laid out, which is not the
        // note's held height.
        const holds = await top.evaluate((el) => {
            el.style.setProperty("--daily-note-held-height", "5000px");
            const base = el.querySelector<HTMLElement>(".daily-note-base")!;
            const own = base.style.getPropertyValue("--daily-note-held-height");
            const reached = getComputedStyle(base).getPropertyValue("--daily-note-held-height");
            return [getComputedStyle(el).minHeight, !!own, reached === own];
        });

        expect(holds).toEqual(["5000px", true, true]);
    });

    test("measures a table whose values overrun the note, and redraws it as cards", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block(...VALUES_WIDE));
        const base = (await openStream(page)).locator(".daily-note-base").first();

        await expect(cards(base).first()).toBeVisible();
        await expect(base.locator(".bases-thead")).toHaveCount(0);
    });

    test("draws an embedded Base's named view, for the note", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, ["![[Two.base#This note]]", ""]);
        const base = (await openStream(page)).locator(".daily-note-base").first();

        // The view the embed names, filtered by `this`, which is the note, not
        // the Base.
        await base.scrollIntoViewIfNeeded();
        await expect(cards(base)).toHaveCount(1);
        await expect(cards(base)).toContainText("2026-03-15");
    });

    // Cards are a copy, so they would not update with the file by themselves.
    test("redraws an embed drawn as cards when its file changes", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, ["![[Two.base#This note]]", ""]);
        const base = (await openStream(page)).locator(".daily-note-base").first();
        await base.scrollIntoViewIfNeeded();
        await expect(cards(base)).toHaveCount(1);

        await page.evaluate(
            async (text) => {
                await window.app.vault.modify(window.app.vault.getFileByPath("Two.base")!, text);
            },
            TWO_VIEWS.replace("    filters: file.path == this.file.path\n", "")
        );

        await expect.poll(() => cards(base).count()).toBeGreaterThan(1);
    });

    // A phone turned sideways, or a tablet's split view resized.
    test("redraws a Base when the note's width changes", async ({ obsidian }) => {
        const { page } = obsidian;
        await seed(page, block("views:", ...table("Middle", MIDDLE)));
        const base = (await openStream(page)).locator(".daily-note-base").first();
        await expect(cards(base).first()).toBeVisible();

        try {
            await resize(page, TABLET_WIDTH);
            await expect(base.locator(".bases-thead")).toBeVisible();
            await expect(cards(base)).toHaveCount(0);
        } finally {
            await resize(page, LAYOUT_VIEWPORT.mobile.width);
        }
        await expect(cards(base).first()).toBeVisible();
    });

    test("leaves the note and the Base untouched", async ({ obsidian }) => {
        const { page } = obsidian;
        const body = await seed(page, [...block("views:", ...table("Wide", HEADERS_WIDE)), "![[Two.base#This note]]"]);
        const container = await openStream(page);
        await expect(cards(container.locator(".daily-note-base").first()).first()).toBeVisible();

        expect(await read(page, NOTE)).toBe(body);
        expect(await read(page, "Two.base")).toBe(TWO_VIEWS);
    });

    // Bases saves a code block through the editor that holds it, and the stream
    // has no editor.
    test("saves no toolbar edit over the note", async ({ obsidian }) => {
        const { page } = obsidian;
        const body = await seed(page, block("views:", ...table("Narrow", ["file.name"])));
        const note = (await openStream(page)).locator(".daily-note-block").first();

        await note.locator(".bases-toolbar-views-menu").first().click();
        await page.locator(".menu").getByText("Add view").click();
        // The view was added, so Bases opens its settings.
        await expect(page.locator(".menu")).toContainText("Configure view");
        // Bases saves 100 ms after an edit, so give a save time to happen.
        await page.waitForTimeout(1000);

        expect(await read(page, NOTE)).toBe(body);
    });
});
