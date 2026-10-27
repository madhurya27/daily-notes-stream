import type { CDPSession, Locator, Page } from "@playwright/test";
import {
    test,
    expect,
    openStream,
    restoreNote,
    restoreScrollAnchoring,
    scrollThroughStream,
    seededDate,
    SEEDED_DAYS,
    withoutScrollAnchoring,
    writeNote,
    LAYOUT_VIEWPORT,
} from "./obsidian";

/** Opens the bar from the header, which both layouts show. */
async function openSearch(page: Page): Promise<Locator> {
    await page.locator('.view-action[aria-label="Search"]').click();
    const bar = page.locator(".daily-notes-search");
    await expect(bar.locator("input")).toBeFocused();
    return bar;
}

/** How many ranges the named highlight colors. */
const painted = (page: Page, name: string) => page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name);

/**
 * The current match's text, and whether it is inside the pane's visible area.
 */
const currentMatch = (page: Page) =>
    page.evaluate(() => {
        const [range] = [...(CSS.highlights.get("daily-notes-search-current") ?? [])] as Range[];
        if (!range) return null;
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!.getBoundingClientRect();
        const rect = range.getBoundingClientRect();
        return { text: range.toString(), onScreen: rect.top >= pane.top && rect.bottom <= pane.bottom };
    });

test.describe("search the stream", () => {
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.keyboard.press("Escape");
    });

    test("opens on the vault's search hotkey, with the other hotkeys left alone", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        await page.keyboard.press("ControlOrMeta+f");
        await expect(page.locator(".daily-notes-search input")).toBeFocused();

        await page.keyboard.press("Escape");
        await page.keyboard.press("ControlOrMeta+p");
        await expect(page.locator(".prompt")).toBeVisible();
    });

    // The stream keeps the hotkey and reads it again when settings are saved.
    // So this proves that a changed hotkey is saved in the config folder, and
    // that the stream hears it.
    test("follows a rebind of the search hotkey while open", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        // What the Hotkeys settings tab does when the reader records a key
        // combination.
        await page.evaluate(async () => {
            const { hotkeyManager } = window.app;
            hotkeyManager.setHotkeys("editor:open-search", [{ modifiers: ["Mod", "Shift"], key: "J" }]);
            await hotkeyManager.save();
        });
        try {
            await expect(async () => {
                await page.keyboard.press("ControlOrMeta+Shift+J");
                await expect(page.locator(".daily-notes-search input")).toBeFocused({ timeout: 500 });
            }).toPass();

            await page.keyboard.press("Escape");
            await page.keyboard.press("ControlOrMeta+f");
            await expect(page.locator(".daily-notes-search input")).not.toBeFocused();
        } finally {
            await page.evaluate(async () => {
                const { hotkeyManager } = window.app;
                hotkeyManager.removeHotkeys("editor:open-search");
                await hotkeyManager.save();
            });
        }
    });

    test("counts matching notes, not matches", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const bar = await openSearch(page);

        // Every test note says "km" twice, from one run a day.
        await bar.locator("input").fill("km");

        // One is marked at once, because it is on screen. The total is what
        // matters.
        await expect(bar.locator(".document-search-count")).toHaveText(new RegExp(`/ ${SEEDED_DAYS}$`));
    });

    test("recounts as a note is edited while open", async ({ obsidian }) => {
        const { page } = obsidian;
        const paths = [`Notes/${seededDate(0)}.md`, `Notes/${seededDate(1)}.md`];
        const originals = await page.evaluate(
            (paths) => Promise.all(paths.map((path) => window.app.vault.read(window.app.vault.getFileByPath(path)!))),
            paths
        );
        const append = (path: string) =>
            page.evaluate(
                (path) => window.app.vault.append(window.app.vault.getFileByPath(path)!, "\nA zebra crossing.\n"),
                path
            );
        try {
            await append(paths[0]!);
            await openStream(page);
            const bar = await openSearch(page);
            await bar.locator("input").fill("zebra");
            await expect(bar.locator(".document-search-count")).toHaveText("1 note");

            await append(paths[1]!);

            await expect(bar.locator(".document-search-count")).toHaveText("2 notes");
        } finally {
            await page.evaluate(
                async ({ paths, originals }) => {
                    for (const [i, path] of paths.entries())
                        await window.app.vault.modify(window.app.vault.getFileByPath(path)!, originals[i]!);
                },
                { paths, originals }
            );
        }
    });

    // Obsidian pads its search bar to make room for the floating header, and
    // the view content makes room for it again. Making room twice leaves a gap.
    test("on a phone, sits under the floating header with no gap above the notes", async ({
        obsidian,
        mobileLayout,
    }) => {
        test.skip(!mobileLayout, "only a phone floats the header");
        const { page } = obsidian;
        await openStream(page);
        const bar = await openSearch(page);
        const leaf = page.locator(".workspace-leaf.mod-active");

        const [header, input, barBox, content] = await Promise.all([
            leaf.locator(".view-header").boundingBox(),
            bar.locator("input").boundingBox(),
            bar.boundingBox(),
            leaf.locator(".view-content").boundingBox(),
        ]);

        expect(input!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
        expect(Math.abs(content!.y - (barBox!.y + barBox!.height))).toBeLessThanOrEqual(1);
    });

    // Obsidian keeps room for its own count, "0 / 0", which is shorter than
    // ours.
    test("keeps the typed text clear of the count", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const bar = await openSearch(page);
        await bar.locator("input").fill("Programming languages");
        const count = bar.locator(".document-search-count");
        await expect(count).toHaveText("No results");

        const textEnd = await bar
            .locator("input")
            .evaluate(
                (input) => input.getBoundingClientRect().right - parseFloat(getComputedStyle(input).paddingRight)
            );
        const countBox = await count.boundingBox();

        expect(textEnd).toBeLessThanOrEqual(countBox!.x);
    });

    test.describe("on a tablet", () => {
        let cdp: CDPSession;
        const layOut = ({ width, height }: { width: number; height: number }) =>
            cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

        test.beforeEach(async ({ obsidian, mobileLayout }) => {
            test.skip(!mobileLayout, "only the mobile layout has a tablet width");
            const { page } = obsidian;
            cdp = await page.context().newCDPSession(page);
            // An iPad Air in landscape.
            await layOut({ width: 1180, height: 820 });
            await openStream(page);
            await expect(page.locator("body")).toHaveClass(/\bis-tablet\b/);
        });

        test.afterEach(async ({ mobileLayout }) => {
            if (!mobileLayout) return;
            await layOut(LAYOUT_VIEWPORT.mobile);
            await cdp.detach();
        });

        // Obsidian stretches the group of buttons to fill the bar. A close
        // button outside the group is pushed to the bar's far end.
        test("keeps the close button next to the arrows", async ({ obsidian }) => {
            const bar = await openSearch(obsidian.page);

            const [previous, next, exit] = await Promise.all(
                ["Previous", "Next", "Exit search"].map((label) => bar.getByLabel(label).boundingBox())
            );

            const arrowGap = next!.x - (previous!.x + previous!.width);
            const exitGap = exit!.x - (next!.x + next!.width);
            expect(Math.abs(exitGap - arrowGap)).toBeLessThanOrEqual(1);
        });

        // As Obsidian's own bar does in a note: no header floats over the bar.
        test("sits right under the header", async ({ obsidian }) => {
            const { page } = obsidian;
            const bar = await openSearch(page);

            const [header, input] = await Promise.all([
                page.locator(".workspace-leaf.mod-active .view-header").boundingBox(),
                bar.locator("input").boundingBox(),
            ]);

            expect(Math.abs(input!.y - (header!.y + header!.height))).toBeLessThanOrEqual(1);
        });
    });

    test("reaches a note past the loaded batch and shows its match", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        await expect(container.locator(".daily-note-block")).toHaveCount(10); // BATCH_SIZE
        const bar = await openSearch(page);

        // Day 2 is the second-oldest note, far below the first batch.
        await bar.locator("input").fill("Ran 2 km");
        await expect(bar.locator(".document-search-count")).toHaveText("1 note");
        await page.keyboard.press("Enter");

        await expect(bar.locator(".document-search-count")).toHaveText("1 / 1");
        await expect.poll(() => currentMatch(page)).toEqual({ text: "Ran 2 km", onScreen: true });
    });

    test.describe("a match atop a block taller than the pane", () => {
        const path = `Notes/${seededDate(SEEDED_DAYS)}.md`;
        const code = ["```", "Wombat", ...Array.from({ length: 150 }, (_, i) => `line ${i}`), "```"].join("\n");

        test.beforeEach(async ({ obsidian }) => {
            await writeNote(obsidian.page, path, code);
        });
        test.afterEach(async ({ obsidian }) => {
            await restoreNote(obsidian.page, path, null);
        });

        test("brings the match itself on screen", async ({ obsidian }) => {
            const { page } = obsidian;
            await openStream(page);
            const bar = await openSearch(page);
            await bar.locator("input").fill("Wombat");
            await page.keyboard.press("Enter");

            await expect(bar.locator(".document-search-count")).toHaveText("1 / 1");
            await expect.poll(() => currentMatch(page)).toEqual({ text: "Wombat", onScreen: true });
        });
    });

    test.describe("a match below Bases", () => {
        const path = `Notes/${seededDate(SEEDED_DAYS)}.md`;
        const columns = ["file.name", "file.path", "file.folder", "file.ext", "file.size", "file.ctime", "file.mtime"];
        const base = ["```base", "views:", "  - type: table", "    name: Wide", "    order:"];
        const text = [...base, ...columns.map((c) => `      - ${c}`), "```", ""].join("\n").repeat(2) + "Quokka";

        test.beforeEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(async ({ path, text }) => void (await window.app.vault.create(path, text)), {
                path,
                text,
            });
        });
        test.afterEach(async ({ obsidian }) => {
            await obsidian.page.evaluate((p) => window.app.vault.delete(window.app.vault.getFileByPath(p)!), path);
        });

        /** Moves to the match, and waits for every Base above it to fill in. */
        async function stepToMatch(page: Page) {
            const bar = await openSearch(page);
            await bar.locator("input").fill("Quokka");
            await page.keyboard.press("Enter");

            await expect(bar.locator(".document-search-count")).toHaveText("1 / 1");
            const views = page.locator(`[data-source-path="${path}"] .bases-view`);
            await expect(views).toHaveCount(2);
            for (const view of await views.all()) {
                await expect(view.locator(".bases-tr, .bases-cards-item").first()).toBeAttached();
            }
        }

        // The Bases above the match fill in after the scroll lands on it.
        test("keeps the match on screen while the Bases fill in", async ({ obsidian }) => {
            const { page } = obsidian;
            await openStream(page);

            await stepToMatch(page);

            await expect.poll(() => currentMatch(page)).toEqual({ text: "Quokka", onScreen: true });
        });

        // If scrolled to before they load, Bases show "0 results", then fill
        // in.
        test("shows no Base on screen before it fills in", async ({ obsidian }) => {
            const { page } = obsidian;
            await openStream(page);
            await page.evaluate(() => {
                const frames: boolean[] = ((window as unknown as { loadingShown: boolean[] }).loadingShown = []);
                const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
                const sample = () => {
                    const { top, bottom } = pane.getBoundingClientRect();
                    const loading = [...document.querySelectorAll(".daily-note-base .is-loading")];
                    frames.push(
                        loading.some((el) => {
                            const rect = el.getBoundingClientRect();
                            return rect.bottom > top && rect.top < bottom;
                        })
                    );
                    if (frames.length < 120) requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
            });

            await stepToMatch(page);

            await expect
                .poll(() => page.evaluate(() => (window as unknown as { loadingShown: boolean[] }).loadingShown.length))
                .toBe(120);
            const shown = await page.evaluate(() => (window as unknown as { loadingShown: boolean[] }).loadingShown);
            expect(shown.filter(Boolean)).toEqual([]);
            await expect.poll(() => currentMatch(page)).toEqual({ text: "Quokka", onScreen: true });
        });

        // A note with a remembered height is held at that height, so the Bases
        // fill in inside it, and the stream around it never changes size. If
        // the remembered height is taller than it draws, as after a Base lost
        // rows, rounding does not resize it either. iOS does not keep the
        // scroll position, and neither does the stream here.
        test("keeps the match on screen in a note held taller", async ({ obsidian }) => {
            const { page } = obsidian;
            await scrollThroughStream(await openStream(page));
            await page.evaluate((path) => {
                const { notes } = window.app.plugins.plugins["daily-notes-stream"].layoutMemory;
                const saved: [string, [string, number][]][] = notes.toJSON().heights;
                for (const [layout, heights] of saved) {
                    for (const [key, height] of heights) if (key === path) notes.keep(layout, path, height + 400);
                }
            }, path);
            await withoutScrollAnchoring(page);
            try {
                await openStream(page);

                await stepToMatch(page);

                await expect.poll(() => currentMatch(page)).toEqual({ text: "Quokka", onScreen: true });
            } finally {
                await restoreScrollAnchoring(page);
            }
        });
    });

    // Typing marks what the reader already sees, as Obsidian's own search bar
    // does, and does not scroll. The first match on screen is the newest note's
    // run.
    test("marks the first match on screen as you type, moving nothing", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const scrollTop = () => container.locator("xpath=..").evaluate((el) => el.scrollTop);
        const before = await scrollTop();
        const bar = await openSearch(page);

        await bar.locator("input").fill("km");

        await expect(bar.locator(".document-search-count")).toHaveText(`1 / ${SEEDED_DAYS}`);
        await expect.poll(() => currentMatch(page)).toEqual({ text: "km", onScreen: true });
        expect(await scrollTop()).toBe(before);
    });

    // On a phone, the bottom navbar floats over the pane. A match under it is
    // in the pane but not seen, so Enter would move past it.
    test("on a phone, marks no match under the bottom navbar as you type", async ({ obsidian, mobileLayout }) => {
        test.skip(!mobileLayout, "only a phone floats a navbar over the pane");
        const { page } = obsidian;
        // The newest note, which the stream draws first.
        const path = `Notes/${seededDate(0)}.md`;
        const word = "Zanzibar";
        const before = await writeNote(
            page,
            path,
            `${"Filler.\n\n".repeat(30)}Hidden ${word} here.\n\n${"Filler.\n\n".repeat(40)}`
        );
        try {
            const container = await openStream(page);
            const bar = await openSearch(page);
            const text = container.locator(`[data-source-path="${path}"]`).getByText(word);
            await text.scrollIntoViewIfNeeded();
            const navbar = (await page.locator(".mobile-navbar").boundingBox())!;
            await withoutScrollAnchoring(page);
            // Puts the word's line just under the navbar's top edge.
            await text.evaluate((el, y) => {
                const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                pane.scrollTop += el.getBoundingClientRect().top - y;
            }, navbar.y + 8);
            const line = (await text.boundingBox())!;
            expect(line.y).toBeGreaterThanOrEqual(navbar.y);
            expect(line.y + line.height).toBeLessThanOrEqual(navbar.y + navbar.height);

            await bar.locator("input").fill(word);

            await expect(bar.locator(".document-search-count")).toHaveText("1 note");
            expect(await currentMatch(page)).toBeNull();
        } finally {
            await restoreScrollAnchoring(page);
            await restoreNote(page, path, before);
        }
    });

    test("steps through a note's matches before the next note", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const bar = await openSearch(page);
        const count = bar.locator(".document-search-count");
        await bar.locator("input").fill("km");
        await expect(count).toHaveText(`1 / ${SEEDED_DAYS}`);

        // The newest note says "km" twice: in its run, marked while typing,
        // then in its table.
        await page.keyboard.press("Enter");
        await expect(count).toHaveText(`1 / ${SEEDED_DAYS}`);
        await page.keyboard.press("Enter");

        await expect(count).toHaveText(`2 / ${SEEDED_DAYS}`);
        await expect.poll(() => currentMatch(page)).toEqual({ text: "km", onScreen: true });

        await page.keyboard.press("Shift+Enter");
        await expect(count).toHaveText(`1 / ${SEEDED_DAYS}`);
    });

    test("unfolds a match under a collapsed heading, unsaved", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const heading = container.locator(".daily-note-block").first().locator(".daily-note-content h2").first();
        await heading.locator(".collapse-indicator").click();
        await expect(heading).toHaveClass(/is-collapsed/);
        const bar = await openSearch(page);
        await bar.locator("input").fill("Stretching");

        await page.keyboard.press("Enter");

        await expect(bar.locator(".document-search-count")).toHaveText(`1 / ${SEEDED_DAYS}`);
        await expect.poll(() => currentMatch(page)).toEqual({ text: "Stretching", onScreen: true });
        await expect(heading).not.toHaveClass(/is-collapsed/);
        // Not saved: the fold is still in the vault's own storage.
        const saved = await page.evaluate(() =>
            JSON.stringify(window.app.loadLocalStorage("daily-notes-stream:collapse")).includes("true")
        );
        expect(saved).toBe(true);
    });

    test("labels a match nothing on screen can show", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const bar = await openSearch(page);
        // The frontmatter text: the properties panel draws "mood", never
        // "mood:".
        await bar.locator("input").fill("mood:");

        await page.keyboard.press("Enter");

        await expect(bar.locator(".document-search-count")).toHaveText(`1 / ${SEEDED_DAYS} · hidden`);
        expect(await currentMatch(page)).toBeNull();
    });

    test("paints nothing in the properties heading, which no note holds", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        await expect(page.locator(".metadata-properties-title").first()).toHaveText("Properties");
        const bar = await openSearch(page);

        await bar.locator("input").fill("Properties");

        await expect(bar.locator(".document-search-count")).toHaveText("No results");
        expect(await painted(page, "daily-notes-search-match")).toBe(0);
    });

    test.describe("text another file holds", () => {
        const path = `Notes/${seededDate(0)}.md`;
        let before = "";

        test.beforeEach(async ({ obsidian }) => {
            const { page } = obsidian;
            before = await page.evaluate((p) => window.app.vault.read(window.app.vault.getFileByPath(p)!), path);
            const base = ["```base", "views:", "  - type: table", "    name: All", "```"].join("\n");
            const text = `${before}\n![[Borscht]]\n\n${base}\n`;
            await page.evaluate(
                async ({ path, text }) => {
                    await window.app.vault.createFolder("Recipes");
                    // Only listed by the Base, and only embedded.
                    await window.app.vault.create("Recipes/Gazpacho.md", "");
                    await window.app.vault.create("Recipes/Borscht.md", "Chilled beetroot, blended smooth");
                    await window.app.vault.modify(window.app.vault.getFileByPath(path)!, text);
                },
                { path, text }
            );
        });
        test.afterEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(
                async ({ path, before }) => {
                    await window.app.vault.modify(window.app.vault.getFileByPath(path)!, before);
                    await window.app.vault.delete(window.app.vault.getFolderByPath("Recipes")!, true);
                },
                { path, before }
            );
        });

        /**
         * Searches once the note draws `shown`, which no daily note's text
         * contains.
         */
        async function searchFor(page: Page, query: string, shown: Locator) {
            await openStream(page);
            // Bases only draws the rows that are on screen.
            await expect(async () => {
                await page
                    .locator(`[data-source-path="${path}"] .daily-note-content > *`)
                    .last()
                    .scrollIntoViewIfNeeded();
                await expect(shown).toBeAttached({ timeout: 500 });
            }).toPass();
            const bar = await openSearch(page);
            await bar.locator("input").fill(query);
            await expect(bar.locator(".document-search-count")).toHaveText("No results");
        }

        test("paints nothing in a Base, which lists other files", async ({ obsidian }) => {
            const { page } = obsidian;
            const row = page.locator(`[data-source-path="${path}"] .block-language-base`).getByText("Gazpacho");

            await searchFor(page, "Gazpacho", row.first());

            expect(await painted(page, "daily-notes-search-match")).toBe(0);
        });

        test("paints nothing in an embedded note", async ({ obsidian }) => {
            const { page } = obsidian;
            const embed = page.locator(`[data-source-path="${path}"] .markdown-embed`).getByText("Chilled beetroot");

            await searchFor(page, "Chilled", embed);

            expect(await painted(page, "daily-notes-search-match")).toBe(0);
        });
    });

    test("clears every highlight on close", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const bar = await openSearch(page);
        await bar.locator("input").fill("km");
        await page.keyboard.press("Enter");
        await expect.poll(() => painted(page, "daily-notes-search-match")).toBeGreaterThan(0);

        await page.keyboard.press("Escape");

        await expect(bar).toBeHidden();
        await expect.poll(() => painted(page, "daily-notes-search-match")).toBe(0);
        expect(await painted(page, "daily-notes-search-current")).toBe(0);
    });
});
