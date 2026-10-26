import {
    test,
    expect,
    openStream,
    scrollThroughStream,
    seededDate,
    LAYOUT_VIEWPORT,
    SEEDED_DAYS,
    withoutScrollAnchoring,
    restoreScrollAnchoring,
    writeDailyNotesConfig,
    DAILY_NOTES_CONFIG,
} from "./obsidian";

/**
 * The note at the pane's top, how far above the top it starts, and how many
 * empty notes are above it.
 */
function readingPoint(container: import("@playwright/test").Locator) {
    return container.evaluate((column) => {
        const pane = column.parentElement!.getBoundingClientRect();
        const blocks = [...column.querySelectorAll<HTMLElement>(".daily-note-block")];
        const i = blocks.findIndex((block) => block.getBoundingClientRect().bottom > pane.top + 1);
        return {
            path: blocks[i]!.dataset.sourcePath,
            offset: blocks[i]!.getBoundingClientRect().top - pane.top,
            unloadedAbove: blocks.slice(0, i).filter((block) => block.classList.contains("is-unloaded")).length,
        };
    });
}

/** Turns the phone on its side, as a reader does. */
async function turnPhone(page: import("@playwright/test").Page) {
    const turn = ({ width, height }: { width: number; height: number }) =>
        cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const cdp = await page.context().newCDPSession(page);
    await turn({ width: LAYOUT_VIEWPORT.mobile.height, height: LAYOUT_VIEWPORT.mobile.width });
    return { restore: () => turn(LAYOUT_VIEWPORT.mobile) };
}

/**
 * Makes the pane narrower, as a desktop reader does. Not by resizing the
 * viewport, because afterwards Obsidian's menus no longer close on Escape.
 */
async function openRightSidebar(page: import("@playwright/test").Page) {
    await page.evaluate(() => window.app.workspace.rightSplit.expand());
    return { restore: () => page.evaluate(() => window.app.workspace.rightSplit.collapse()) };
}

/** Opens the jump list and returns its prompt. */
async function openSuggester(page: import("@playwright/test").Page) {
    await page.locator('.view-action[aria-label="Jump to date"]').click();
    const prompt = page.locator(".prompt");
    await expect(prompt).toBeVisible();
    return prompt;
}

/** Types `date` into the jump list and chooses the first item. */
async function jumpTo(page: import("@playwright/test").Page, date: string) {
    const prompt = await openSuggester(page);
    await prompt.locator("input.prompt-input").fill(date);
    await prompt.locator(".suggestion-item").first().click();
    await expect(prompt).toBeHidden();
}

test.describe("jump to date", () => {
    // Tests share one Obsidian instance, and a jump list left open puts a modal
    // background over the next test's first click.
    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.keyboard.press("Escape");
        await expect(obsidian.page.locator(".modal-container")).toHaveCount(0);
    });

    test("loads past the first batch and brings the note to the top", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const blocks = container.locator(".daily-note-block");

        await expect(blocks).toHaveCount(10); // BATCH_SIZE
        const oldest = seededDate(SEEDED_DAYS - 1);

        await jumpTo(page, oldest);

        // The target was past the first batch, so reaching it had to load more.
        await expect(blocks).toHaveCount(SEEDED_DAYS);
        const target = container.locator(`.daily-note-block[data-source-path="Notes/${oldest}.md"]`);
        await expect(target.locator(".daily-note-title")).toHaveText(oldest);

        // Scrolled to, not only loaded: the block ends up at the top of the
        // pane. Checked repeatedly, because the jump keeps correcting the
        // scroll as the notes around the target are rendered and push it down.
        await expect
            .poll(() =>
                target.evaluate((el) => {
                    const scroller = el.closest(".daily-notes-stream-container")!.parentElement!;
                    return Math.abs(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
                })
            )
            .toBeLessThan(40);
    });

    // Only days the vault has a note for are listed, so the reader can no
    // longer choose one that quietly goes somewhere else.
    test("offers the vault's own dates, newest first", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        const prompt = await openSuggester(page);
        const items = prompt.locator(".suggestion-item");

        await expect(items).toHaveCount(SEEDED_DAYS);
        await expect(items.first()).toHaveText(seededDate(0));
        await expect(items.last()).toHaveText(seededDate(SEEDED_DAYS - 1));
    });

    test("offers the dates in whatever format the daily-notes settings name", async ({ obsidian }) => {
        const { page, vaultPath } = obsidian;
        const notes = ["14-03-2026", "13-03-2026", "March 14, 2026", "March 13, 2026"].map(
            (name) => `Formats/${name}.md`
        );
        await page.evaluate(async (notes) => {
            await window.app.vault.createFolder("Formats").catch(() => {});
            for (const path of notes) await window.app.vault.create(path, "## Morning\n");
        }, notes);
        try {
            await openStream(page);
            const offered = async () => (await openSuggester(page)).locator(".suggestion-item");

            writeDailyNotesConfig(vaultPath, { folder: "Formats", format: "DD-MM-YYYY" });
            await expect(page.locator(".daily-note-title").first()).toHaveText("14-03-2026");
            await expect(await offered()).toHaveText(["14-03-2026", "13-03-2026"]);
            await page.keyboard.press("Escape");

            writeDailyNotesConfig(vaultPath, { folder: "Formats", format: "MMMM D, YYYY" });
            await expect(page.locator(".daily-note-title").first()).toHaveText("March 14, 2026");
            await expect(await offered()).toHaveText(["March 14, 2026", "March 13, 2026"]);
            await page.keyboard.press("Escape");
        } finally {
            writeDailyNotesConfig(vaultPath, DAILY_NOTES_CONFIG);
            await page.evaluate(async () => {
                const folder = window.app.vault.getAbstractFileByPath("Formats");
                if (folder) await window.app.vault.delete(folder, true);
            });
        }
    });

    // A focused search field brings up the phone's keyboard over half the list.
    // The reader looks first, then taps the search field or the calendar.
    test("focuses the query on desktop only, and a tap focuses it on mobile", async ({ obsidian, mobileLayout }) => {
        const { page } = obsidian;
        await openStream(page);
        const prompt = await openSuggester(page);
        const query = prompt.locator("input.prompt-input");

        if (!mobileLayout) {
            await expect(query).toBeFocused();
            return;
        }
        // Checked for a while, because Obsidian may focus the search field
        // after it opens.
        await expect.poll(() => query.evaluate((el) => el === document.activeElement), { timeout: 1000 }).toBe(false);
        await page.waitForTimeout(500);
        await expect(query).not.toBeFocused();

        await query.click();
        await expect(query).toBeFocused();
    });

    test("narrows to what is typed", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        const prompt = await openSuggester(page);
        await prompt.locator("input.prompt-input").fill(seededDate(3));

        await expect(prompt.locator(".suggestion-item")).toHaveText([seededDate(3)]);
    });

    test("says a date has no note before jumping anywhere near it", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        // A day after the end of the vault, so no note has it.
        const prompt = await openSuggester(page);
        await prompt.locator("input.prompt-input").fill(seededDate(-1));

        await expect(prompt.locator(".suggestion-item")).toContainText("has no note");
        await expect(prompt.locator(".daily-notes-jump-fallback")).toHaveText("Jump to the nearest older note");
    });

    test("keeps the query box the prompt's full width, clear button inside", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const prompt = await openSuggester(page);
        const box = async (selector: string) => (await prompt.locator(selector).boundingBox())!;

        const container = await box(".prompt-input-container");
        const input = await box("input.prompt-input");
        const clear = await box(".search-input-clear-button");

        expect(input.x + input.width).toBeCloseTo(container.x + container.width, 0);
        expect(clear.x + clear.width).toBeLessThanOrEqual(input.x + input.width);
    });

    // iOS only opens its date picker from a tap on the date input itself, never
    // through showPicker(), so a tap on the icon must land on the input.
    test("puts the date input under the calendar icon, where a tap lands", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const prompt = await openSuggester(page);

        const icon = prompt.locator(".daily-notes-jump-calendar");

        // Checked repeatedly, because on mobile the prompt slides up from below
        // the screen.
        await expect
            .poll(async () => {
                const box = (await icon.boundingBox())!;
                return page.evaluate(
                    ({ x, y }) => document.elementFromPoint(x, y)?.matches('input[type="date"]') ?? false,
                    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
                );
            })
            .toBe(true);
    });

    // iOS draws a date input at its own width, whatever its box says. One that
    // spread out of the icon caught the clear button's taps.
    test("leaves the clear button its taps, however wide the date input draws", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const prompt = await openSuggester(page);
        await prompt.locator(".daily-notes-jump-picker").evaluate((el) => (el.style.minWidth = "240px"));
        const clear = prompt.locator(".search-input-clear-button");

        await expect
            .poll(async () => {
                const box = (await clear.boundingBox())!;
                return page.evaluate(
                    ({ x, y }) => document.elementFromPoint(x, y)?.matches(".search-input-clear-button") ?? false,
                    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
                );
            })
            .toBe(true);
    });

    // iOS fills an empty date input with today's date when its picker opens.
    // Moving the focus away on that change closed the picker before the reader
    // could use it.
    test("keeps the wheel open as it fills the query, and Enter still jumps", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const prompt = await openSuggester(page);
        const picker = prompt.locator(".daily-notes-jump-picker");
        const target = seededDate(SEEDED_DAYS - 1);

        await picker.focus();
        await picker.evaluate((el, value) => {
            (el as HTMLInputElement).value = value;
            el.dispatchEvent(new Event("change"));
        }, target);

        await expect(prompt.locator("input.prompt-input")).toHaveValue(target);
        await expect(picker).toBeFocused();

        await page.keyboard.press("Enter");
        await expect(prompt).toBeHidden();
        const block = container.locator(`.daily-note-block[data-source-path="Notes/${target}.md"]`);
        await expect(block.locator(".daily-note-title")).toHaveText(target);
    });

    test("fills the query from the platform's own date picker", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        const prompt = await openSuggester(page);
        const target = seededDate(2);

        // The date picker itself belongs to the platform, so the test uses the
        // hidden input that the calendar button passes to it, and checks what
        // comes back.
        await prompt.locator(".daily-notes-jump-picker").evaluate((el, value) => {
            (el as HTMLInputElement).value = value;
            el.dispatchEvent(new Event("change"));
        }, target);

        await expect(prompt.locator("input.prompt-input")).toHaveValue(target);
        await expect(prompt.locator(".suggestion-item")).toHaveText([target]);
    });

    test("falls back to the nearest older note when the date has none", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const newest = seededDate(0);

        // A day after the end of the vault, so the newest note is the one
        // before it.
        await jumpTo(page, seededDate(-1));

        const target = container.locator(`.daily-note-block[data-source-path="Notes/${newest}.md"]`);
        await expect(target.locator(".daily-note-title")).toHaveText(newest);
    });

    test("says so, and moves nothing, when no note is that old", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const blocks = container.locator(".daily-note-block");
        const scroller = container.locator("xpath=..");
        await expect(blocks).toHaveCount(10); // BATCH_SIZE

        await jumpTo(page, seededDate(SEEDED_DAYS + 30));

        await expect(page.locator(".notice")).toHaveText("No daily note on or before that date.");
        await expect(blocks).toHaveCount(10);
        expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
    });

    // A guessed height grows or shrinks as the reader scrolls back past it (ADR
    // 0010).
    test("reserves the heights notes measured in an earlier session", async ({ obsidian }) => {
        const { page } = obsidian;
        await scrollThroughStream(await openStream(page));
        await page.evaluate(async () => {
            await window.app.plugins.disablePlugin("daily-notes-stream");
            await window.app.plugins.enablePlugin("daily-notes-stream");
        });
        const container = await openStream(page);

        await jumpTo(page, seededDate(SEEDED_DAYS - 1));

        const { layout, remembered, reserved } = await container.evaluate((column) => {
            const layout = `${column.clientWidth}:${getComputedStyle(column).getPropertyValue("--font-preferred-size").trim()}`;
            const notes: [string, [string, number][]][] =
                window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes.toJSON().heights;
            const unloaded = [...column.querySelectorAll<HTMLElement>(".daily-note-block.is-unloaded")];
            return {
                layout,
                remembered: Object.fromEntries(notes.find(([key]) => key === layout)?.[1] ?? []),
                reserved: unloaded.map((el) => [
                    el.dataset.sourcePath!,
                    el.style.getPropertyValue("--daily-note-placeholder-height"),
                ]),
            };
        });
        // On a phone, the text size changed by iOS's setting.
        expect(layout).toMatch(/^\d+:(\d+px|calc\(\d+px \* [\d.]+\))$/);
        expect(reserved.length).toBeGreaterThan(0);
        // A note unloaded in this session keeps the height it measured, as the
        // store saves it (D-105).
        for (const [path, height] of reserved) expect(height, path).toBe(`${remembered[path!]}px`);
    });

    // iOS does not keep the scroll position. Whatever changes height when the
    // width changes, the stream must keep the place by itself. At 100px, the
    // note above crosses the pane's top and reflows too.
    for (const below of [0, 100]) {
        test(`keeps a title ${below}px below the pane's top where it was when the width changes`, async ({
            obsidian,
        }, testInfo) => {
            const { page } = obsidian;
            await withoutScrollAnchoring(page);
            try {
                const container = await openStream(page);
                await scrollThroughStream(container);
                const date = seededDate(Math.floor(SEEDED_DAYS / 2));
                await jumpTo(page, date);
                await container.evaluate((column, below) => column.parentElement!.scrollBy(0, -below), below);
                // Scrolling counts as stopped, and the anchor reads the place
                // again.
                await page.waitForTimeout(1000);
                const title = container.locator(`.daily-note-block[data-source-path$="${date}.md"] .daily-note-title`);
                const titleTop = () =>
                    title.evaluate((el) => {
                        const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                        return el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
                    });
                const before = await titleTop();
                expect(before).toBeGreaterThan(-1);
                expect((await readingPoint(container)).unloadedAbove).toBeGreaterThan(0);
                const widthBefore = await container.evaluate((column) => column.clientWidth);

                const width = testInfo.project.name === "mobile" ? await turnPhone(page) : await openRightSidebar(page);
                try {
                    await expect.poll(() => container.evaluate((column) => column.clientWidth)).not.toBe(widthBefore);
                    // Obsidian reports the resize late, and the shift moves
                    // into the scroll once it stops.
                    await page.waitForTimeout(1000);
                    expect(await titleTop()).toBeCloseTo(before, 0);
                } finally {
                    await width.restore();
                }
            } finally {
                await restoreScrollAnchoring(page);
            }
        });
    }

    // When turned, a phone renders the cards being read as a table again. The
    // reader ends up as far through the Base as they were (D-056), in the
    // table, while it is held at the cards' height.
    test("keeps how far the pane's top is through a Base redrawn as a table", async ({ obsidian, mobileLayout }) => {
        test.skip(!mobileLayout, "only a phone draws a Base as cards");
        const { page } = obsidian;
        const date = seededDate(SEEDED_DAYS);
        const path = `Notes/${date}.md`;
        const columns = ["file.name", "file.path", "file.folder", "file.ext", "file.size"];
        const base = ["```base", "views:", "  - type: table", "    name: Files", "    order:"];
        await page.evaluate(
            async ({ path, text }) => {
                await window.app.vault.create(path, text);
            },
            {
                path,
                text: [...base, ...columns.map((c) => `      - ${c}`), "```", ""].join("\n"),
            }
        );
        await withoutScrollAnchoring(page);
        try {
            const container = await openStream(page);
            await jumpTo(page, date);
            const slot = container.locator(`.daily-note-block[data-source-path="${path}"] .daily-note-base`);
            await expect(slot.locator(".bases-cards-item[draggable]").first()).toBeVisible();
            await page.waitForTimeout(1000);
            /** How far down the Base the pane's top is. */
            const through = () =>
                slot.evaluate((el) => {
                    const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                    const { top, height } = el.getBoundingClientRect();
                    return (pane.getBoundingClientRect().top - top) / height;
                });
            await slot.evaluate((el) => {
                const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                const { top, height } = el.getBoundingClientRect();
                pane.scrollTop += top + height / 2 - pane.getBoundingClientRect().top;
            });
            await page.waitForTimeout(1000);
            expect(await through()).toBeCloseTo(0.5, 1);

            // Two frames after the table starts being held at the cards'
            // height.
            const whileHeld = slot.evaluate(
                (el) =>
                    new Promise<{ paneAt: number; drawn: number }>((resolve) => {
                        const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                        const measure = () =>
                            resolve({
                                paneAt: pane.getBoundingClientRect().top - el.getBoundingClientRect().top,
                                drawn: el.lastElementChild!.getBoundingClientRect().height,
                            });
                        const tick = () => {
                            const held = el.style.getPropertyValue("--daily-note-held-height");
                            if (held && el.querySelector(".bases-thead"))
                                requestAnimationFrame(() => requestAnimationFrame(measure));
                            else requestAnimationFrame(tick);
                        };
                        tick();
                    })
            );
            const width = await turnPhone(page);
            try {
                const { paneAt, drawn } = await whileHeld;
                expect(paneAt).toBeLessThan(drawn);
                await expect(slot.locator(".bases-thead")).toBeVisible();
                // Held until Bases fills it, then moved into the scroll once
                // scrolling stops.
                await page.waitForTimeout(3000);
                expect(await through()).toBeCloseTo(0.5, 1);
            } finally {
                await width.restore();
            }
        } finally {
            await restoreScrollAnchoring(page);
            await page.evaluate((path) => window.app.vault.delete(window.app.vault.getAbstractFileByPath(path)!), path);
        }
    });

    // As a phone's trace showed: the pane's top is on the Base's last card, and
    // a heading below it starts inside the pane. The reader is in the Base.
    test("keeps the pane's top in a Base redrawn as a table when a heading starts below it", async ({
        obsidian,
        mobileLayout,
    }) => {
        test.skip(!mobileLayout, "only a phone draws a Base as cards");
        const { page } = obsidian;
        const date = seededDate(SEEDED_DAYS);
        const path = `Notes/${date}.md`;
        // The demo vault's Base: six books, too wide for a table on a phone,
        // embedded from a .base file.
        const books: [string, string, string, string][] = [
            ["A Pattern Language", "Christopher Alexander", "up next", ""],
            ["Four Thousand Weeks", "Oliver Burkeman", "finished", "4"],
            ["Piranesi", "Susanna Clarke", "finished", "5"],
            ["The Design of Everyday Things", "Don Norman", "reading", "4"],
            ["The Dispossessed", "Ursula K. Le Guin", "reading", "5"],
            ["Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin", "up next", ""],
        ];
        const files: Record<string, string> = {
            ...Object.fromEntries(
                books.map(([title, author, status, rating]) => [
                    `Books/${title}.md`,
                    `---\nauthor: ${author}\nstatus: ${status}\nrating: ${rating}\n---\n`,
                ])
            ),
            "Reading.base": [
                "filters:",
                "  and:",
                '    - file.inFolder("Books")',
                "views:",
                "  - type: table",
                "    name: Reading",
                "    order:",
                "      - file.name",
                "      - author",
                "      - status",
                "      - rating",
                "",
            ].join("\n"),
            [path]: [
                "## Reading",
                "",
                "![[Reading.base]]",
                "",
                "## Next week",
                "",
                "- [ ] Order tiles",
                "- [x] Book dentist",
                "- [ ] Back up the laptop",
                "",
            ].join("\n"),
        };
        await page.evaluate(async (files) => {
            await window.app.vault.createFolder("Books").catch(() => {});
            for (const [path, text] of Object.entries(files)) await window.app.vault.create(path, text);
        }, files);
        await withoutScrollAnchoring(page);
        try {
            const container = await openStream(page);
            await jumpTo(page, date);
            const slot = container.locator(`.daily-note-block[data-source-path="${path}"] .daily-note-base`);
            await expect(slot.locator(".bases-cards-item[draggable]").first()).toBeVisible();
            await page.waitForTimeout(1000);
            /** How far down the Base the pane's top is. */
            const through = () =>
                slot.evaluate((el) => {
                    const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                    const { top, height } = el.getBoundingClientRect();
                    return (pane.getBoundingClientRect().top - top) / height;
                });
            // The Base ends 40% of the way down the pane, with the heading just
            // below.
            await slot.evaluate((el) => {
                const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                const bottom = el.getBoundingClientRect().bottom - pane.getBoundingClientRect().top;
                pane.scrollTop += bottom - 0.4 * pane.clientHeight;
            });
            await page.waitForTimeout(1000);
            const before = await through();
            expect(before).toBeGreaterThan(0);
            expect(before).toBeLessThan(1);

            const width = await turnPhone(page);
            try {
                await expect(slot.locator(".bases-thead")).toBeVisible();
                // Held until Bases fills it, then moved into the scroll once
                // scrolling stops.
                await page.waitForTimeout(3000);
                expect(await through()).toBeCloseTo(before, 1);
            } finally {
                await width.restore();
            }
        } finally {
            await restoreScrollAnchoring(page);
            await page.evaluate(async (paths) => {
                for (const path of [...paths, "Books"])
                    await window.app.vault.delete(window.app.vault.getAbstractFileByPath(path)!, true);
            }, Object.keys(files));
        }
    });
});
