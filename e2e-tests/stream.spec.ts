import type { Locator } from "@playwright/test";
import {
    test,
    expect,
    atTextSize,
    openStream,
    closeSearchPanes,
    restoreScrollAnchoring,
    seededDate,
    SEEDED_DAYS,
    withoutScrollAnchoring,
    writeDailyNotesConfig,
    DAILY_NOTES_CONFIG,
    LAYOUT_VIEWPORT,
} from "./obsidian";

test.describe("daily notes stream in real Obsidian", () => {
    test("renders daily notes as real rendered markdown", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        await expect(container.locator(".daily-note-block").first()).toBeVisible();
        // Newest first: 2026-03-14 is the most recent seeded note.
        await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");

        // Obsidian's MarkdownRenderer made real elements, not raw text.
        const firstNote = container.locator(".daily-note-block").first();
        await expect(firstNote.locator(".daily-note-content h2").first()).toHaveText(/Morning/);
        await expect(firstNote.locator(".daily-note-content ul li").first()).toBeVisible();
        // Frontmatter must not appear in the body.
        await expect(firstNote.locator(".daily-note-content")).not.toContainText("mood:");
    });

    // An icon name missing from Obsidian's Lucide set renders a blank button,
    // without any error.
    test("draws an icon on every header action", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);
        const actions = page.locator(".workspace-leaf.mod-active .view-action");
        await expect(actions).not.toHaveCount(0);
        for (const action of await actions.all()) await expect(action.locator("svg")).toHaveCount(1);
    });

    test("collapses a heading in the real rendered DOM", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const firstNote = container.locator(".daily-note-block").first();
        const heading = firstNote.locator(".daily-note-content h2").first();
        const body = firstNote.locator(".daily-note-content p").first();

        await expect(body).toBeVisible();
        await heading.locator(".collapse-indicator").click();

        await expect(heading).toHaveClass(/is-collapsed/);
        await expect(body).toBeHidden();

        await heading.locator(".collapse-indicator").click();
        await expect(body).toBeVisible();
    });

    test("hides headings nested under a collapsed one, not just its text", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const firstNote = container.locator(".daily-note-block").first();
        const heading = firstNote.locator(".daily-note-content h2").first();
        const nested = firstNote.locator(".daily-note-content h3").first();

        await expect(nested).toBeVisible();
        await heading.locator(".collapse-indicator").click();

        // Hiding is a class the stylesheet must respect. A heading has its own
        // display from the foldable rule, which a single .is-hidden cannot
        // beat.
        await expect(nested).toHaveClass(/is-hidden/);
        await expect(nested).toBeHidden();

        await heading.locator(".collapse-indicator").click();
        await expect(nested).toBeVisible();
    });

    test("leaves an .is-hidden outside the stream to Obsidian", async ({ obsidian }) => {
        const { page } = obsidian;
        await openStream(page);

        const display = await page.evaluate(() => {
            const el = document.body.appendChild(document.createElement("div"));
            el.className = "is-hidden";
            const value = getComputedStyle(el).display;
            el.remove();
            return value;
        });

        expect(display).toBe("block");
    });

    test("hides a table and a code block under a collapsed heading", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const note = container.locator(".daily-note-block").first();
        const heading = note.locator(".daily-note-content h2", { hasText: "Wide content" });
        const table = note.locator(".daily-note-content table").first();
        const code = note.locator(".daily-note-content pre").first();

        await expect(table).toBeVisible();
        await heading.locator(".collapse-indicator").click();

        // A stacked table has its own display rule. The hidden rule must beat
        // it, or a folded section keeps showing.
        await expect(table).toBeHidden();
        await expect(code).toBeHidden();

        await heading.locator(".collapse-indicator").click();
        await expect(table).toBeVisible();
    });

    test("keeps the list chevron clear of a task's checkbox", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const parentTask = container
            .locator(".daily-note-content li.task-list-item", { hasText: "Parent task" })
            .first();
        const chevron = parentTask.locator("> .collapse-indicator");
        const checkbox = parentTask.locator("> input").first();

        await expect(chevron).toBeVisible();
        const [chevronBox, checkboxBox] = await Promise.all([chevron.boundingBox(), checkbox.boundingBox()]);

        // The arrow sits outside the list content. A task item puts its
        // checkbox there too, so the two overlap unless the arrow moves.
        expect(chevronBox!.x + chevronBox!.width).toBeLessThanOrEqual(checkboxBox!.x);
    });

    test("centers a list chevron on its label", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        // Both kinds the test vault has: a plain bullet with children, and a
        // task.
        for (const label of ["Groceries", "Parent task"]) {
            const item = container.locator(".daily-note-content li.is-collapsible", { hasText: label }).first();
            await expect(item).toBeVisible();

            const offset = await item.evaluate((li) => {
                const chevron = li.querySelector(":scope > .collapse-indicator")!;
                // The item's own words, wrapped in an element for WebKit, next
                // to the nested list.
                const range = document.createRange();
                range.selectNodeContents(li.querySelector(":scope > .daily-note-text-run")!);
                const words = range.getBoundingClientRect();
                const box = chevron.getBoundingClientRect();
                return box.top + box.height / 2 - (words.top + words.height / 2);
            });

            expect(Math.abs(offset), label).toBeLessThan(1);
        }
    });

    // Obsidian moves the box by a fixed 0.2em of its own 13.33px font. The box
    // grows with the text but the move does not, so at other sizes it is off
    // center, by 3px at 28px on a phone (D-104).
    for (const size of [12, 16, 22, 28]) {
        test(`centers a task's checkbox on its label at a ${size}px text size`, async ({ obsidian }) => {
            const { page } = obsidian;
            await atTextSize(page, size, async () => {
                const container = await openStream(page);
                const task = container.locator(".daily-note-content li.task-list-item", { hasText: "Parent task" });
                const offset = await task.first().evaluate((li) => {
                    const box = li.querySelector(":scope > input.task-list-item-checkbox")!;
                    const range = document.createRange();
                    range.selectNodeContents(li.querySelector(":scope > .daily-note-text-run")!);
                    const text = range.getBoundingClientRect();
                    const check = box.getBoundingClientRect();
                    return check.top + check.height / 2 - (text.top + text.height / 2);
                });
                expect(Math.abs(offset)).toBeLessThan(0.5);
            });
        });
    }

    // The box grows with the text but the list's indent does not. At 28px on a
    // phone, reading view starts a task's first line 11px left of the rest
    // (D-106).
    test.describe("a wrapped task", () => {
        const NOTE = "Notes/2026-03-20.md";

        test.beforeEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(async (note) => {
                await window.app.vault.create(
                    note,
                    "- [ ] A wrapping task, its words running on past the width of any pane so the line has to break and carry on underneath, where the reader looks for it under the first\n"
                );
            }, NOTE);
        });
        test.afterEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(async (note) => {
                await window.app.vault.delete(window.app.vault.getFileByPath(note)!);
            }, NOTE);
        });

        for (const size of [12, 16, 22, 28]) {
            test(`lines its words up under its first line at a ${size}px text size`, async ({ obsidian }) => {
                const { page } = obsidian;
                await atTextSize(page, size, async () => {
                    const container = await openStream(page);
                    const task = container.locator(`.daily-note-block[data-source-path="${NOTE}"] li.task-list-item`);
                    await expect(task).toBeVisible();
                    const lines = await task.evaluate((li) => {
                        const range = document.createRange();
                        range.selectNodeContents(li);
                        range.setStartAfter(li.querySelector(":scope > input.task-list-item-checkbox")!);
                        return [...range.getClientRects()].map((line) => line.left);
                    });
                    expect(lines.length, "lines").toBeGreaterThan(1);
                    for (const left of lines.slice(1)) expect(Math.abs(left - lines[0]!)).toBeLessThan(0.5);
                });
            });
        }
    });

    test("ignores a click on a task checkbox", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const checkbox = container
            .locator(".daily-note-content li.task-list-item", { hasText: "Parent task" })
            .first()
            .locator("> input.task-list-item-checkbox");

        await expect(checkbox).not.toBeChecked();
        // force: the checkbox ignores the pointer, so otherwise Playwright's
        // check would wait for pointer events it will never get.
        await checkbox.click({ force: true });

        // The stream is read-only and the renderer never saves, so a tick here
        // would be false, and the next render would remove it.
        await expect(checkbox).not.toBeChecked();
    });

    test("indents nested lists the way Obsidian's reading view does", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const list = container.locator(".daily-note-content ul", { hasText: "Groceries" }).first();
        await expect(list).toBeVisible();

        // Obsidian indents rendered lists with the list item's margin, and sets
        // the list's own padding to zero. A plain <ul> gets the browser's 40px
        // for each level instead, which on a phone uses a tenth of the width
        // for every level of nesting.
        const step = await list.evaluate((ul) => {
            const li = (el: Element) => el.querySelector(":scope > li")!;
            const outer = li(ul).getBoundingClientRect().left;
            const inner = li(ul.querySelector("ul")!).getBoundingClientRect().left;
            return { padding: getComputedStyle(ul).paddingInlineStart, nested: inner - outer };
        });

        expect(step.padding).toBe("0px");
        // --list-indent: 0.5625em * 4 = 2.25em, 36px at the default 16px root.
        expect(step.nested).toBeCloseTo(36, 0);
    });

    test.describe("a heading holding a link", () => {
        const NOTE = "Notes/2026-03-20.md";
        const HEADING =
            "## [An episode on anxiety, long enough to wrap on a phone and a desktop note alike, and then some more](https://example.com) - a podcast";

        test.beforeEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(
                async ({ note, heading }) => {
                    await window.app.vault.create(note, `${heading}\n\nText.\n`);
                },
                { note: NOTE, heading: HEADING }
            );
        });
        test.afterEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(async (note) => {
                await window.app.vault.delete(window.app.vault.getFileByPath(note)!);
            }, NOTE);
        });

        // The link and the words continue as one line of text, not as columns
        // side by side.
        test("wraps as reading view wraps it", async ({ obsidian }) => {
            const { page } = obsidian;
            const height = (h: Element) => Math.round(h.getBoundingClientRect().height);
            const heading = (await openStream(page)).locator(".daily-note-block").first().locator("h2");
            const stream = await heading.evaluate(height);

            await page.evaluate(async (note) => {
                const file = window.app.vault.getFileByPath(note);
                await window.app.workspace.getLeaf("tab").openFile(file!, { state: { mode: "preview" } });
            }, NOTE);
            const reading = page.locator(".workspace-leaf.mod-active .markdown-reading-view h2").first();
            await expect(reading).toBeVisible();

            expect(stream).toBe(await reading.evaluate(height));
        });

        test("centers its chevron on the first line", async ({ obsidian }) => {
            const heading = (await openStream(obsidian.page)).locator(".daily-note-block").first().locator("h2");
            const [chevron, line] = await heading.evaluate((h) => {
                const center = (r: DOMRect) => r.top + r.height / 2;
                const svg = h.querySelector(".collapse-indicator svg")!.getBoundingClientRect();
                return [center(svg), center(h.querySelector("a")!.getClientRects()[0]!)];
            });
            expect(Math.abs(chevron - line)).toBeLessThanOrEqual(1);
        });
    });

    test("toggles a heading from the keyboard", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const firstNote = container.locator(".daily-note-block").first();
        const heading = firstNote.locator(".daily-note-content h2").first();
        const chevron = heading.locator(".collapse-indicator");

        await chevron.focus();
        await expect(chevron).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Enter");

        await expect(chevron).toHaveAttribute("aria-expanded", "false");
        await expect(heading).toHaveClass(/is-collapsed/);
        await page.keyboard.press("Enter");
        await expect(chevron).toHaveAttribute("aria-expanded", "true");
    });

    test("loads a second batch on scroll", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const blocks = container.locator(".daily-note-block");

        await expect(blocks).toHaveCount(10); // BATCH_SIZE

        // The stream's end, not the last note: a note taller than the pane is
        // shown from its middle, too far above the end to load more.
        await container.locator(".daily-notes-stream-sentinel").scrollIntoViewIfNeeded();
        await expect(blocks).toHaveCount(SEEDED_DAYS);
    });

    test("draws an embedded image", async ({ obsidian }) => {
        const { page } = obsidian;
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="teal"/></svg>';
        await page.evaluate(async (svg) => {
            await window.app.vault.create("Embedded dot.svg", svg);
            await window.app.vault.create("Notes/2026-03-20.md", "## Pictures\n\n![[Embedded dot.svg]]\n");
        }, svg);
        try {
            const container = await openStream(page);
            const image = container.locator('.daily-note-block[data-source-path="Notes/2026-03-20.md"] img');

            await expect(image).toBeVisible();
            await expect
                .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
                .toBe(120);
        } finally {
            await page.evaluate(async () => {
                for (const path of ["Notes/2026-03-20.md", "Embedded dot.svg"])
                    await window.app.vault.delete(window.app.vault.getFileByPath(path)!);
            });
        }
    });

    test("keeps loading batches while short notes leave a tall window unfilled", async ({ obsidian, mobileLayout }) => {
        const { page, vaultPath } = obsidian;
        // Taller than a batch of ten short notes, which end up about 140px
        // each.
        const viewport = LAYOUT_VIEWPORT[mobileLayout ? "mobile" : "desktop"];
        const cdp = await page.context().newCDPSession(page);
        const resize = (height: number) =>
            cdp.send("Emulation.setDeviceMetricsOverride", {
                ...viewport,
                height,
                deviceScaleFactor: 1,
                mobile: false,
            });
        await resize(2400);
        const notes = Array.from({ length: 25 }, (_, i) => `Short/2026-01-${String(i + 1).padStart(2, "0")}.md`);
        await page.evaluate(async (notes) => {
            await window.app.vault.createFolder("Short").catch(() => {});
            for (const path of notes) await window.app.vault.create(path, "Rest day.\n");
        }, notes);
        writeDailyNotesConfig(vaultPath, { ...DAILY_NOTES_CONFIG, folder: "Short" });
        try {
            const container = await openStream(page);
            const blocks = container.locator(".daily-note-block");
            await expect(blocks.first()).toHaveAttribute("data-source-path", notes.at(-1)!);
            // Not scrolled: a batch of ten short notes does not fill the
            // window.
            await expect.poll(() => blocks.count()).toBeGreaterThan(10);
            expect(await container.evaluate((el) => el.parentElement!.scrollTop)).toBe(0);
        } finally {
            await resize(viewport.height);
            writeDailyNotesConfig(vaultPath, DAILY_NOTES_CONFIG);
            await page.evaluate(async () => {
                const folder = window.app.vault.getAbstractFileByPath("Short");
                if (folder) await window.app.vault.delete(folder, true);
            });
        }
    });

    // jsdom loads no stylesheet and has no layout, so unloading notes can only
    // be proven here: a block far above the screen keeps its height and loses
    // its content (ADR 0006).
    test.describe("off-screen notes", () => {
        /**
         * Three notes tall enough that the top one can be pushed past the
         * unloading distance.
         */
        const TALL_NOTES = ["2026-03-20.md", "2026-03-19.md", "2026-03-18.md"];

        test.beforeEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(async (names: string[]) => {
                const body = (name: string) =>
                    `# ${name}\n\n` + Array.from({ length: 300 }, (_, i) => `Line ${i} of ${name}.`).join("\n\n");
                for (const name of names) {
                    await window.app.vault.create(`Notes/${name}`, body(name));
                }
            }, TALL_NOTES);
        });

        test.afterEach(async ({ obsidian }) => {
            await obsidian.page.evaluate(async (names: string[]) => {
                for (const name of names) {
                    const file = window.app.vault.getAbstractFileByPath(`Notes/${name}`);
                    if (file) await window.app.vault.delete(file);
                }
            }, TALL_NOTES);
        });

        test("drops the content of a note scrolled far above, keeping its height", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            const top = container.locator(".daily-note-block").first();

            await expect(top.locator(".daily-note-content")).toBeVisible();
            const renderedHeight = (await top.boundingBox())!.height;

            await container.locator(".daily-note-block").nth(3).scrollIntoViewIfNeeded();

            await expect(top).toHaveClass(/is-unloaded/);
            await expect(top.locator(".daily-note-content")).toHaveCount(0);
            // The empty block keeps the space the note had, so nothing below
            // moves.
            expect((await top.boundingBox())!.height).toBeCloseTo(renderedHeight, -1);
        });

        // On iOS, unloading a note while scrolling stops the scroll, so nothing
        // is unloaded until scrolling stops (D-032).
        test("keeps a note scrolled far above rendered until the scroll stops", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            const top = container.locator(".daily-note-block").first();
            await expect(top.locator(".daily-note-content")).toBeVisible();

            await container.locator(".daily-note-block").nth(3).scrollIntoViewIfNeeded();
            // Scrolling: a small scroll about every frame, for much longer than
            // the idle wait.
            const scroller = container.locator("xpath=..");
            const stillRendered = await scroller.evaluate(async (el) => {
                const block = el.querySelector(".daily-note-block")!;
                for (let i = 0; i < 40; i++) {
                    el.scrollBy(0, i % 2 ? 1 : -1);
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    if (block.classList.contains("is-unloaded")) return false;
                }
                return true;
            });
            expect(stillRendered).toBe(true);

            await expect(top).toHaveClass(/is-unloaded/);
        });

        test("leaves the scroll position where it was when a note unloads", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            const top = container.locator(".daily-note-block").first();

            await container.locator(".daily-note-block").nth(3).scrollIntoViewIfNeeded();
            await expect(top).toHaveClass(/is-unloaded/);

            const scroller = container.locator("xpath=..");
            const before = await scroller.evaluate((el) => el.scrollTop);
            await page.waitForTimeout(500);

            expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
        });

        /**
         * Scrolls the top note's bottom five pane heights above the pane, in
         * small steps.
         */
        async function glidePastTop(scroller: import("@playwright/test").Locator) {
            return scroller.evaluate(async (el) => {
                const top = el.querySelector<HTMLElement>(".daily-note-block")!;
                const target = top.offsetTop + top.offsetHeight + 5 * el.clientHeight;
                let hiddenMidGlide = false;
                while (el.scrollTop < target - 1) {
                    el.scrollBy(0, Math.min(200, target - el.scrollTop));
                    await new Promise((resolve) => setTimeout(resolve, 16));
                    hiddenMidGlide ||= top.classList.contains("is-far");
                }
                return hiddenMidGlide;
            });
        }

        // WebKit stalls for longer the more is laid out, so a note far away
        // leaves the layout as soon as it is far, even mid-glide (ADR 0023).
        test("takes a note a few panes above out of the layout mid-glide, keeping its height", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            const top = container.locator(".daily-note-block").first();
            await expect(top.locator(".daily-note-content")).toBeVisible();
            const renderedHeight = (await top.boundingBox())!.height;

            expect(await glidePastTop(container.locator("xpath=.."))).toBe(true);

            await expect(top.locator(".daily-note-content")).toBeHidden();
            await expect(top).not.toHaveClass(/is-unloaded/);
            expect((await top.boundingBox())!.height).toBeCloseTo(renderedHeight, 0);
        });

        test("shows a hidden note again as it comes back, drawing nothing anew", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            const top = container.locator(".daily-note-block").first();
            const content = top.locator(".daily-note-content");
            await expect(content).toBeVisible();
            await content.evaluate((el) => (el.dataset.probe = "drawn once"));

            await glidePastTop(container.locator("xpath=.."));
            await expect(top).toHaveClass(/is-far/);
            await top.scrollIntoViewIfNeeded();

            await expect(content).toBeVisible();
            await expect(content).toHaveAttribute("data-probe", "drawn once");
        });

        test("renders the note again when it comes back into view", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);
            const top = container.locator(".daily-note-block").first();

            await container.locator(".daily-note-block").nth(3).scrollIntoViewIfNeeded();
            await expect(top).toHaveClass(/is-unloaded/);

            await top.scrollIntoViewIfNeeded();

            await expect(top).not.toHaveClass(/is-unloaded/);
            await expect(top.locator(".daily-note-content h1")).toHaveText("2026-03-20.md");
        });
    });

    test.describe("a note above the pane changing height", () => {
        /**
         * Where the fourth note is, scrolled to the top, before and after a
         * note above it grows 1000px.
         */
        async function growAbove(page: import("@playwright/test").Page, container: import("@playwright/test").Locator) {
            const blocks = container.locator(".daily-note-block");
            await expect(blocks.nth(3)).toBeAttached();
            await blocks.nth(3).evaluate((el) => el.scrollIntoView({ block: "start" }));
            await expect(blocks.first()).not.toHaveClass(/is-unloaded/);
            const top = () =>
                blocks.nth(3).evaluate((el) => {
                    const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                    return el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
                });
            // The notes above are rendered as it is scrolled to, and grow
            // taller than their empty blocks. This is the first thing the
            // anchor has to correct.
            await expect.poll(top).toBeCloseTo(0, 0);
            const before = await top();

            await blocks.first().evaluate(async (el) => {
                el.appendChild(document.createElement("div")).style.height = "1000px";
                // One frame for the resize to be observed, and a second for the
                // scroll it sets.
                for (let frame = 0; frame < 2; frame++) await new Promise((r) => requestAnimationFrame(r));
            });
            return { before, after: await top() };
        }

        // iOS's WebKit does not keep the scroll position, so the text under the
        // reader jumped by however much a note above grew. Here, Chromium acts
        // as iOS.
        test.describe("where the platform has no scroll anchoring", () => {
            test.beforeEach(({ obsidian }) => withoutScrollAnchoring(obsidian.page));
            test.afterEach(({ obsidian }) => restoreScrollAnchoring(obsidian.page));

            async function openUnanchored(page: import("@playwright/test").Page) {
                const container = await openStream(page);
                // Ours, so a platform that partly keeps the place cannot
                // correct it a second time.
                await expect(container.locator("xpath=..")).toHaveCSS("overflow-anchor", "none");
                return container;
            }

            test("keeps the reader's place", async ({ obsidian }) => {
                const { page } = obsidian;
                const container = await openUnanchored(page);

                const { before, after } = await growAbove(page, container);

                expect(after).toBeCloseTo(before, 0);
            });

            // A Base filling in, in the part of a note scrolled past. Nothing
            // above the pane's top was done by the reader, whichever note it is
            // in.
            test("keeps the reader's place when a note reaching into the pane grows above it", async ({ obsidian }) => {
                const { page } = obsidian;
                const container = await openUnanchored(page);
                const note = container.locator(".daily-note-block").nth(3);
                await expect(note).toBeAttached();
                await note.evaluate((el) => el.scrollIntoView({ block: "start" }));
                await expect(note).not.toHaveClass(/is-unloaded/);
                await page.waitForTimeout(1000);
                // The pane's top 60px into the note's text.
                await note.evaluate((el) => {
                    const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                    const text = el.querySelector(".daily-note-content")!.getBoundingClientRect().top;
                    pane.scrollTop += text - pane.getBoundingClientRect().top + 60;
                });
                await page.waitForTimeout(1000);
                await expect(container).not.toHaveClass(/is-scroll-shifted/);

                const { before, after } = await note.evaluate(async (el) => {
                    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
                    const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                    const box = pane.getBoundingClientRect();
                    const reader = document.elementFromPoint(box.left + box.width / 2, box.top + 40)!;
                    const before = reader.getBoundingClientRect().top;
                    const content = el.querySelector(".daily-note-content")!;
                    if (content.getBoundingClientRect().top >= box.top)
                        throw new Error("the note's text starts below the pane's top");
                    content.prepend(document.createElement("div"));
                    (content.firstElementChild as HTMLElement).style.height = "1000px";
                    await frame();
                    await frame();
                    return { before, after: reader.getBoundingClientRect().top };
                });

                expect(after).toBeCloseTo(before, 0);
            });

            // Nothing loads below the stream's end to fill the space a shift
            // leaves there, so a note shrinking there moves the place at once.
            test("draws nothing past the stream's end when the last note shrinks", async ({ obsidian }) => {
                const { page } = obsidian;
                const container = await openUnanchored(page);
                const blocks = container.locator(".daily-note-block");
                await container.locator(".daily-notes-stream-sentinel").scrollIntoViewIfNeeded();
                await expect(blocks).toHaveCount(SEEDED_DAYS);
                const last = blocks.last();
                await last.scrollIntoViewIfNeeded();
                await expect(last).not.toHaveClass(/is-unloaded/);
                // Taller than the pane, so the pane's top is inside the note as
                // it shrinks.
                await last.evaluate((el) => {
                    const tail = el.querySelector(".daily-note-content")!.appendChild(document.createElement("div"));
                    tail.dataset.e2eTail = "";
                    tail.style.height = "2000px";
                });
                const pane = container.locator("xpath=..");
                // At the end, and not scrolling. The note is pinned at its new
                // height one report later.
                await expect
                    .poll(async () => {
                        await pane.evaluate((el) => (el.scrollTop = el.scrollHeight));
                        await page.waitForTimeout(400);
                        return pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
                    })
                    .toBeLessThanOrEqual(1);
                await expect(container).not.toHaveClass(/is-scroll-shifted/);

                // How far the pane's bottom shows past the stream's end, not
                // counting the pane's own padding.
                const blank = await pane.evaluate(async (el) => {
                    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
                    const stream = el.querySelector(".daily-notes-stream-container")!;
                    const past = () => el.getBoundingClientRect().bottom - stream.getBoundingClientRect().bottom;
                    const padding = past();
                    el.querySelector<HTMLElement>("[data-e2e-tail]")!.style.height = "1000px";
                    let worst = 0;
                    for (let i = 0; i < 20; i++) {
                        await frame();
                        worst = Math.max(worst, past() - padding);
                    }
                    return worst;
                });

                expect(blank).toBeLessThanOrEqual(1);
            });

            /**
             * A flick upward, frame by frame, until a note above has been
             * rendered, then a little more.
             */
            const GLIDE_STEP_PX = 30;
            const GLIDE_STEPS_AFTER_RENDER = 10;

            // While scrolling, iOS controls the scroll position. Setting it
            // then is ignored or undone, which the reader saw as a jump or a
            // flicker. So nothing but the scrolling itself may move the scroll
            // until it stops.
            test("leaves a glide the only thing moving the scroll, and the text moving with it", async ({
                obsidian,
            }) => {
                const { page } = obsidian;
                const container = await openUnanchored(page);
                const blocks = container.locator(".daily-note-block");
                await expect(blocks).toHaveCount(10); // BATCH_SIZE
                await blocks.last().evaluate((el) => el.scrollIntoView({ block: "start" }));
                // Not scrolling, so what was rendered on the way down is
                // already in the scroll position.
                await page.waitForTimeout(1000);
                await expect(container).not.toHaveClass(/is-scroll-shifted/);

                const glide = await container.locator("xpath=..").evaluate(
                    async (pane, { stepPx, stepsAfterRender }) => {
                        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
                        const box = pane.getBoundingClientRect();
                        const reader = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)!;
                        reader.setAttribute("data-e2e-reader", "");
                        const start = reader.getBoundingClientRect().top;
                        const blocks = [...pane.querySelectorAll(".daily-note-block")];
                        const unloaded = () => blocks.filter((b) => b.classList.contains("is-unloaded")).length;
                        const unloadedBefore = unloaded();

                        const overwritten: number[] = [];
                        const from = pane.scrollTop;
                        let set = from;
                        for (let after = 0; after < stepsAfterRender && set > 0;) {
                            if (unloaded() < unloadedBefore) after++;
                            if (pane.scrollTop !== set) overwritten.push(pane.scrollTop - set);
                            pane.scrollTop = set - stepPx;
                            set = pane.scrollTop;
                            await frame();
                            await frame();
                        }
                        return { overwritten, rendered: unloadedBefore - unloaded(), start, glided: from - set };
                    },
                    { stepPx: GLIDE_STEP_PX, stepsAfterRender: GLIDE_STEPS_AFTER_RENDER }
                );

                expect(glide.rendered).toBeGreaterThan(0);
                expect(glide.overwritten).toEqual([]);

                // Once scrolling stops, the shift moves into the scroll
                // position, and the text is where the scrolling alone would
                // have put it.
                await expect(container).not.toHaveClass(/is-scroll-shifted/);
                const reader = page.locator("[data-e2e-reader]");
                const moved = await reader.evaluate((el, start) => el.getBoundingClientRect().top - start, glide.start);
                expect(moved).toBeCloseTo(glide.glided, 0);
            });
        });

        // Mid-glide, iOS paints a resize before it reports it (ADR 0013).
        // Chromium reports it first, so each test reads the layout when the
        // task that changes it ends, which is what iOS would paint.
        test.describe("as iOS paints it, before any resize is reported", () => {
            test.beforeEach(({ obsidian }) => withoutScrollAnchoring(obsidian.page));
            test.afterEach(({ obsidian }) => restoreScrollAnchoring(obsidian.page));

            test("draws a note rendering above the pane with the shift that keeps the place", async ({ obsidian }) => {
                const { page } = obsidian;
                // With no measured heights, every note is rendered without a
                // held height. This is the case that jumped.
                await page.evaluate(() =>
                    window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes.restore(null)
                );
                const container = await openStream(page);
                const blocks = container.locator(".daily-note-block");
                await expect(blocks).toHaveCount(10); // BATCH_SIZE
                await blocks.last().evaluate((el) => el.scrollIntoView({ block: "start" }));
                await page.waitForTimeout(1000);
                // The test notes all lay out alike, so the layout's estimate
                // would be right. Here each empty block is too short, and every
                // note grows when rendered.
                await container.evaluate((stream) => {
                    for (const block of stream.querySelectorAll<HTMLElement>(".daily-note-block.is-unloaded"))
                        block.style.setProperty("--daily-note-placeholder-height", "100px");
                });
                await page.waitForTimeout(1000);
                await expect(container).not.toHaveClass(/is-scroll-shifted/);

                const drifts = await container.locator("xpath=..").evaluate(async (pane) => {
                    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
                    const box = pane.getBoundingClientRect();
                    const reader = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)!;
                    const start = reader.getBoundingClientRect().top;
                    let scrolled = 0;
                    // Where the reader's scroll left the pane, until the anchor
                    // stops the scroll before the top and sets what it owes.
                    let at = pane.scrollTop;
                    // How far the reader is from where the reader's own scroll
                    // puts them.
                    const drift = () => reader.getBoundingClientRect().top - (start + scrolled);
                    const drifts: number[] = [];
                    // A mutation observer's callback runs when the task that
                    // made the change ends.
                    const rendered = new MutationObserver((records) => {
                        for (const { target, oldValue } of records) {
                            const block = target as HTMLElement;
                            // Far behind the glide, the reader's note hides its
                            // content (ADR 0023), so there is no place then.
                            if (pane.scrollTop !== at || reader.getClientRects().length === 0) return;
                            if (oldValue?.includes("is-unloaded") && !block.classList.contains("is-unloaded"))
                                drifts.push(drift());
                        }
                    });
                    rendered.observe(pane, {
                        subtree: true,
                        attributeFilter: ["class"],
                        attributeOldValue: true,
                    });
                    while (at > 0 && pane.scrollTop === at) {
                        pane.scrollTop -= 30;
                        scrolled += at - pane.scrollTop;
                        at = pane.scrollTop;
                        await frame();
                        await frame();
                    }
                    rendered.disconnect();
                    return drifts;
                });

                expect(drifts.length).toBeGreaterThan(0);
                for (const drift of drifts) expect(drift).toBeCloseTo(0, 0);
            });

            test("keeps the place as a note above the pane grows", async ({ obsidian }) => {
                const { page } = obsidian;
                const container = await openStream(page);
                const blocks = container.locator(".daily-note-block");
                await expect(blocks.nth(3)).toBeAttached();
                await blocks.nth(3).evaluate((el) => el.scrollIntoView({ block: "start" }));
                await expect(blocks.first()).not.toHaveClass(/is-unloaded/);
                await page.waitForTimeout(1000);

                const moved = await blocks.first().evaluate((el) => {
                    const reader = el.parentElement!.children[3]!;
                    const before = reader.getBoundingClientRect().top;
                    el.appendChild(document.createElement("div")).style.height = "1000px";
                    return reader.getBoundingClientRect().top - before;
                });

                expect(moved).toBe(0);
            });

            test("pins each rendered note at the height it lays out at, clipping none of it", async ({ obsidian }) => {
                const { page } = obsidian;
                const container = await openStream(page);
                await expect(container.locator(".daily-note-block.is-pinned").first()).toBeAttached();
                await page.waitForTimeout(1000);

                const offBy = await container.evaluate((stream) =>
                    [...stream.querySelectorAll<HTMLElement>(".daily-note-block.is-pinned")].map((block) => {
                        const pinned = block.getBoundingClientRect().height;
                        block.classList.remove("is-pinned");
                        const natural = block.getBoundingClientRect().height;
                        block.classList.add("is-pinned");
                        return pinned - natural;
                    })
                );

                expect(offBy.length).toBeGreaterThan(0);
                expect(offBy).toEqual(offBy.map(() => 0));
            });

            // When the property was inherited, re-pinning restyled every
            // element of the note: 0.5 s for a 10,000-line note at a phone's
            // speed (D-129).
            test("keeps a pinned height and the stream's shift from the elements inside", async ({ obsidian }) => {
                const container = await openStream(obsidian.page);
                await expect(container.locator(".daily-note-block.is-pinned").first()).toBeAttached();

                const inside = await container.evaluate((stream) => {
                    stream.style.setProperty("--daily-notes-scroll-shift", "-5px");
                    const content = stream.querySelector(".daily-note-block.is-pinned .daily-note-content")!;
                    const style = getComputedStyle(content);
                    const values = ["--daily-note-pinned-height", "--daily-notes-scroll-shift"].map((name) =>
                        style.getPropertyValue(name)
                    );
                    stream.style.removeProperty("--daily-notes-scroll-shift");
                    return values;
                });
                expect(inside).toEqual(["", ""]);
            });

            // A Base, notes with no measured height, and a scroll down and
            // back: rendering, unloading and Bases filling in each change a
            // height.
            test.describe("through a scroll down and back", () => {
                const path = `Notes/${seededDate(SEEDED_DAYS)}.md`;
                const base = ["```base", "views:", "  - type: table", "    name: Files", "```", ""].join("\n");

                test.beforeEach(async ({ obsidian }) => {
                    await obsidian.page.evaluate(
                        async ({ path, text }) => void (await window.app.vault.create(path, text)),
                        { path, text: base.repeat(2) }
                    );
                });
                test.afterEach(async ({ obsidian }) => {
                    await obsidian.page.evaluate(
                        (p) => window.app.vault.delete(window.app.vault.getFileByPath(p)!),
                        path
                    );
                });

                test("changes a rendered note's height only as it re-pins", async ({ obsidian }) => {
                    const { page } = obsidian;
                    await page.evaluate(() =>
                        window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes.restore(null)
                    );
                    const container = await openStream(page);

                    const { sawBases, unpinned } = await container.locator("xpath=..").evaluate(async (pane, path) => {
                        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
                        /**
                         * What only re-pinning or unloading the note changes.
                         */
                        const state = (block: HTMLElement) =>
                            [
                                block.style.getPropertyValue("--daily-note-pinned-height"),
                                block.classList.contains("is-pinned"),
                                block.classList.contains("is-unloaded"),
                            ].join();
                        const seen = new Map<HTMLElement, { state: string; height: number }>();
                        const unpinned: string[] = [];
                        let sawBases = false;
                        // Read when a task ends and when a frame starts, before
                        // Chromium's resize reports, so it is what iOS would
                        // paint.
                        const check = () => {
                            sawBases ||= pane.querySelectorAll(`[data-source-path="${path}"] .bases-view`).length === 2;
                            for (const block of pane.querySelectorAll<HTMLElement>(".daily-note-block")) {
                                const now = { state: state(block), height: block.getBoundingClientRect().height };
                                const was = seen.get(block);
                                seen.set(block, now);
                                if (!was || block.classList.contains("is-unloaded")) continue;
                                if (now.state === was.state && Math.abs(now.height - was.height) > 0.5)
                                    unpinned.push(`${block.dataset.sourcePath}: ${was.height} → ${now.height}`);
                            }
                        };
                        const tasks = new MutationObserver(check);
                        tasks.observe(pane, {
                            subtree: true,
                            childList: true,
                            attributes: true,
                            characterData: true,
                        });
                        let watching = true;
                        void (async () => {
                            while (watching) {
                                check();
                                await frame();
                            }
                        })();

                        const step = pane.clientHeight / 3;
                        const settle = async () => {
                            for (let i = 0; i < 10; i++) await frame();
                        };
                        const down = async () => {
                            const last = pane.scrollTop;
                            pane.scrollTop += step;
                            await frame();
                            await frame();
                            return pane.scrollTop !== last;
                        };
                        // At the end, a batch may still be loading.
                        while ((await down()) || (await settle(), await down()));
                        while (pane.scrollTop > 0) {
                            pane.scrollTop -= step;
                            await frame();
                            await frame();
                        }
                        await settle();
                        watching = false;
                        tasks.disconnect();
                        return { sawBases, unpinned };
                    }, path);

                    expect(sawBases).toBe(true);
                    expect(unpinned).toEqual([]);
                });
            });
        });

        // Where the platform keeps the place itself, a second correction would
        // double the move.
        test("leaves the anchoring to the platform where it has its own", async ({ obsidian }) => {
            const { page } = obsidian;
            const container = await openStream(page);

            const { before, after } = await growAbove(page, container);

            expect(after).toBeCloseTo(before, 0);
        });
    });

    test("shows a note created while the view is open", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        // Return nothing, because the created TFile cannot be sent back to
        // Node.
        await page.evaluate(async () => {
            await window.app.vault.create("Notes/2026-03-20.md", "## Later\n\nA newer day.\n");
        });

        await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-20");
        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-20.md");
            await window.app.vault.delete(file);
        });
        await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");
    });

    test("lets a note deleted before its render reads it go quietly", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const errors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });

        // The deletion happens in the middle: after the render took the note,
        // before it read it.
        await page.evaluate(async () => {
            const vault = window.app.vault;
            const read = vault.cachedRead.bind(vault);
            vault.cachedRead = async (file: { path: string }) => {
                if (file.path === "Notes/2026-03-20.md") {
                    vault.cachedRead = read;
                    await vault.delete(file);
                }
                return read(file);
            };
            await vault.create("Notes/2026-03-20.md", "## Later\n\nA newer day.\n");
        });

        await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");
        await expect(container).not.toContainText("Error rendering note");
        expect(errors.filter((text) => text.includes("DailyNotesStream"))).toEqual([]);
    });

    test("ignores dated files that are not daily notes", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        await page.evaluate(async () => {
            await window.app.vault.createFolder("Attachments").catch(() => {});
            // Right date format but wrong folder, and right folder but wrong
            // file type.
            await window.app.vault.create("Attachments/2026-03-25.md", "not a daily note");
            await window.app.vault.create("Notes/2026-03-26.png", "not markdown either");
        });

        // Give the vault events time to do the wrong thing, if they are going
        // to.
        await page.waitForTimeout(1000);
        await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");
        await expect(container.locator(".daily-note-block")).toHaveCount(10);

        await page.evaluate(async () => {
            for (const path of ["Attachments/2026-03-25.md", "Notes/2026-03-26.png"]) {
                const file = window.app.vault.getAbstractFileByPath(path);
                if (file) await window.app.vault.delete(file);
            }
        });
    });

    // The stream is a column of notes, so it has a note's margins: the theme's,
    // with nothing of its own added.
    test("lays a note's text out as wide as reading view does", async ({ obsidian }) => {
        const { page } = obsidian;
        const edges = (p: Element) => {
            const { left, right } = p.getBoundingClientRect();
            return { left: Math.round(left), right: Math.round(right) };
        };
        const block = (await openStream(page)).locator(".daily-note-block").first();
        const path = await block.getAttribute("data-source-path");
        const stream = await block.locator(".daily-note-content p").first().evaluate(edges);

        await page.evaluate(async (path) => {
            const file = window.app.vault.getFileByPath(path);
            await window.app.workspace.getLeaf("tab").openFile(file!, { state: { mode: "preview" } });
        }, path!);
        const reading = page.locator(".workspace-leaf.mod-active .markdown-reading-view p").first();
        await expect(reading).toBeVisible();

        expect(stream).toEqual(await reading.evaluate(edges));
    });

    // Heights are remembered by the column's width (ADR 0010). A stream that
    // opens empty, before a scroll bar can show, must read the width it will
    // have when full.
    test("keeps the column as wide while the pane cannot scroll", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const scrolling = await container.evaluate((el) => el.clientWidth);

        // Every test shares the page, so the rule is removed together with the
        // measurement.
        const still = await container.evaluate((el) => {
            const hidden = el.appendChild(document.createElement("style"));
            hidden.textContent = ".daily-note-block { display: none; }";
            const pane = el.parentElement!;
            const measured = { width: el.clientWidth, scrolls: pane.scrollHeight > pane.clientHeight };
            hidden.remove();
            return measured;
        });

        expect(still).toEqual({ width: scrolling, scrolls: false });
    });

    test("keeps wide content inside the stream instead of scrolling the page", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        await expect(container.locator("table").first()).toBeVisible();
        await expect(container.locator("p > a.external-link").first()).toBeVisible();

        // This matters in the mobile project: a phone has no room for a wide
        // table, line of code or URL, so it pushes the page sideways instead.
        const overflow = await container.evaluate((el) => {
            const scroller = el.parentElement!;
            // Both are viewport coordinates, because the scrolling element need
            // not start at 0.
            const limit = scroller.getBoundingClientRect().right;
            return {
                pageOverflow: scroller.scrollWidth - scroller.clientWidth,
                widest: Math.max(
                    ...Array.from(el.querySelectorAll("table, pre, p > a.external-link")).map((child) =>
                        Math.round(child.getBoundingClientRect().right - limit)
                    )
                ),
            };
        });

        expect(overflow.pageOverflow).toBeLessThanOrEqual(0);
        expect(overflow.widest).toBeLessThanOrEqual(0);
    });

    test("keeps the copy button off the code it sits over", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);
        const pre = container.locator("pre").first();
        await expect(pre).toBeVisible();
        // The button only fades in when the pointer is over it, but it takes up
        // its space either way.
        await pre.hover();

        // Obsidian wraps rendered code and fixes its copy button to the
        // top-right corner, so a long first line runs under the icon.
        const overlap = await pre.evaluate((el) => {
            const button = el.querySelector(".copy-code-button");
            const code = el.querySelector("code");
            if (!button || !code) throw new Error("no copy button on the rendered code block");
            const icon = button.getBoundingClientRect();
            const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
            const range = document.createRange();
            let widest = 0;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                range.selectNodeContents(node);
                for (const line of Array.from(range.getClientRects())) {
                    const across = Math.min(line.right, icon.right) - Math.max(line.left, icon.left);
                    const down = Math.min(line.bottom, icon.bottom) - Math.max(line.top, icon.top);
                    if (across > 0 && down > 0) widest = Math.max(widest, across);
                }
            }
            return Math.round(widest);
        });

        expect(overlap).toBe(0);
    });

    test("keeps the properties panel collapsed across a re-render", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const firstNote = container.locator(".daily-note-block").first();
        const panel = firstNote.locator(".metadata-container");

        await expect(panel).toBeVisible();
        await expect(panel).not.toHaveClass(/is-collapsed/);
        await firstNote.locator(".metadata-properties-heading").click();
        await expect(panel).toHaveClass(/is-collapsed/);

        // Editing the note re-renders it, and the panel must not open again.
        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-14.md");
            await window.app.vault.append(file, "\nEdited.\n");
        });

        await expect(firstNote.locator(".daily-note-content")).toContainText("Edited.");
        await expect(container.locator(".daily-note-block").first().locator(".metadata-container")).toHaveClass(
            /is-collapsed/
        );
    });

    test("lines the properties header up with the properties, not inside them", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const block = container.locator(".daily-note-block").first();
        const panel = block.locator(".metadata-container");
        // Fold state is saved for each note, and an earlier test may have left
        // this panel closed. Then its keys are not there to measure.
        if (await panel.evaluate((el) => el.classList.contains("is-collapsed"))) {
            await panel.locator(".metadata-properties-heading").click();
        }
        const heading = block.locator(".metadata-properties-heading");
        const rows = block.locator(".metadata-properties");
        await expect(heading).toBeVisible();
        await expect(rows).toBeVisible();
        // Obsidian puts the heading above the box, not in it.
        await expect(block.locator(".metadata-content > .metadata-properties-heading")).toHaveCount(0);

        // Obsidian puts the arrow outside the panel, and starts the heading's
        // word at the panel's own left edge. Inside the panel, the arrow took
        // the icon column, and the heading looked like one more property row.
        const [titleBox, rowsBox] = await Promise.all([
            block.locator(".metadata-properties-title").boundingBox(),
            rows.boundingBox(),
        ]);
        expect(Math.abs(titleBox!.x - rowsBox!.x)).toBeLessThan(1);
    });

    test("keeps the properties box centered on the note", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const block = container.locator(".daily-note-block").first();
        const box = block.locator(".metadata-content").first();
        await expect(box).toBeVisible();

        // Obsidian extends this box evenly past its container on both sides.
        // Taking space out of the container would move it instead of making it
        // narrower.
        const [blockBox, boxBox] = await Promise.all([block.boundingBox(), box.boundingBox()]);
        const leftBleed = blockBox!.x - boxBox!.x;
        const rightBleed = boxBox!.x + boxBox!.width - (blockBox!.x + blockBox!.width);
        expect(Math.abs(leftBleed - rightBleed)).toBeLessThan(1);
    });

    test("reveals the properties chevron on hover, as Obsidian does", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const heading = container.locator(".metadata-properties-heading").first();
        const chevron = heading.locator("> .collapse-indicator");
        await expect(chevron).toBeVisible();
        await page.mouse.move(0, 0);

        // Obsidian keeps this arrow hidden until the pointer is over the row,
        // and the row itself is the control. A phone taps the row instead.
        await expect(chevron).toHaveCSS("opacity", "0");
        await heading.hover();
        await expect(chevron).toHaveCSS("opacity", "1");
    });

    test("keeps the properties chevron inside the note", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const block = container.locator(".daily-note-block").first();
        const chevron = block.locator(".metadata-properties-heading > .collapse-indicator");
        await expect(chevron).toBeVisible();

        // Obsidian puts this arrow in a left margin that its own properties
        // panel keeps empty. Here it goes exactly where a content heading's
        // arrow does: in the stream's padding, and never outside the pane,
        // which on a phone has less padding.
        const [paneBox, chevronBox, headingChevronBox] = await Promise.all([
            page.locator(".workspace-leaf-content[data-type='daily-notes-stream-view'] .view-content").boundingBox(),
            chevron.boundingBox(),
            block.locator(".daily-note-content h2.is-collapsible > .collapse-indicator").first().boundingBox(),
        ]);
        expect(chevronBox!.x).toBeCloseTo(headingChevronBox!.x, 0);
        expect(chevronBox!.x).toBeGreaterThanOrEqual(paneBox!.x);
    });

    // A list starts right under its heading, a quarter of a paragraph's spacing
    // below. A paragraph or table keeps its own margin.
    test("spaces a heading from what follows it", async ({ obsidian }) => {
        const container = await openStream(obsidian.page);
        const gaps = await container
            .locator(".daily-note-block")
            .first()
            .evaluate((el) => {
                const spacing = parseFloat(getComputedStyle(el.querySelector("p")!).marginBlockStart);
                return Array.from(el.querySelectorAll(".daily-note-content h2.is-collapsible")).map((heading) => {
                    const next = heading.nextElementSibling!;
                    const gap = next.getBoundingClientRect().top - heading.getBoundingClientRect().bottom;
                    return `${next.tagName}: ${gap / spacing}`;
                });
            });
        expect(gaps).toEqual(["P: 1", "UL: 0.25", "TABLE: 1", "UL: 0.25"]);
    });

    test("sets the properties heading on the same line as the note's own headings", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const block = container.locator(".daily-note-block").first();
        await expect(block.locator(".metadata-properties-title")).toBeVisible();

        // "Properties" is a heading of the note like any other. Its word starts
        // where "Morning" does, and its arrow is the same distance to the left.
        const geometry = await block.evaluate((el) => {
            const box = (node: Element) => node.getBoundingClientRect();
            const heading = el.querySelector(".daily-note-content h2.is-collapsible")!;
            const title = el.querySelector(".metadata-properties-title")!;
            return {
                headingText: box(heading).left + parseFloat(getComputedStyle(heading).paddingLeft),
                headingChevron: box(heading.querySelector(":scope > .collapse-indicator")!).right,
                titleText: box(title).left,
                titleChevron: box(el.querySelector(".metadata-properties-heading > .collapse-indicator")!).right,
            };
        });

        expect(Math.abs(geometry.titleText - geometry.headingText)).toBeLessThan(1);
        const headingGap = geometry.headingText - geometry.headingChevron;
        expect(Math.abs(geometry.titleText - geometry.titleChevron - headingGap)).toBeLessThan(1);
    });

    test("renders the properties panel at the size Obsidian's own does", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
        });

        // The panel Obsidian draws for the same note, to compare the stream's
        // with. Every rule for these classes is already in Obsidian's
        // stylesheet, and anything the stream sets again could end up
        // different.
        const measure = (root: Element) => {
            const size = (sel: string) => {
                const el = root.querySelector(sel)!;
                return {
                    height: Math.round(el.getBoundingClientRect().height),
                    fontSize: getComputedStyle(el).fontSize,
                };
            };
            return {
                title: size(".metadata-properties-title"),
                row: size(".metadata-property"),
                key: size(".metadata-property-key"),
                keyText: size(".metadata-property-key-input"),
                value: size(".metadata-property-value"),
                icon: Math.round(root.querySelector(".metadata-property-icon svg")!.getBoundingClientRect().width),
            };
        };

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-14.md");
            await window.app.workspace.getLeaf(false).openFile(file!);
        });
        const note = page.locator(".workspace-leaf.mod-active .view-content").first();
        await expect(note.locator(".metadata-property").first()).toBeVisible();
        const native = await note.evaluate(measure);

        const container = await openStream(page);
        await expect(container.locator(".metadata-property").first()).toBeVisible();
        const stream = await container.evaluate(measure);

        expect(stream.icon).toBe(native.icon);
        for (const part of ["title", "row", "key", "keyText", "value"] as const) {
            expect(stream[part].fontSize, part).toBe(native[part].fontSize);
            // Obsidian fills a row with inputs and the stream with text, so a
            // box can be a pixel different after rounding. Anything more means
            // a rule is missing.
            expect(Math.abs(stream[part].height - native[part].height), part).toBeLessThanOrEqual(1);
        }
    });

    test("shows the icon Obsidian's own properties panel shows for each key", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
        });

        // setIcon names the svg after the icon it drew. The two panels label a
        // row differently: Obsidian with an attribute, and the stream with the
        // key it wrote.
        const iconsByKey = (root: Locator, keyFrom: "attribute" | "text") =>
            root.evaluate(
                (el, mode) =>
                    Object.fromEntries(
                        Array.from(el.querySelectorAll(".metadata-property")).map((row) => [
                            mode === "attribute"
                                ? row.getAttribute("data-property-key")
                                : row.querySelector(".metadata-property-key-input")!.textContent!.toLowerCase(),
                            Array.from(row.querySelector(".metadata-property-icon svg")!.classList)
                                .filter((name) => name !== "svg-icon")
                                .join(" "),
                        ])
                    ),
                keyFrom
            );

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-14.md");
            await window.app.workspace.getLeaf(false).openFile(file!);
        });
        const note = page.locator(".workspace-leaf.mod-active .view-content").first();
        await expect(note.locator(".metadata-property").first()).toBeVisible();
        const native = await iconsByKey(note, "attribute");

        const container = await openStream(page);
        const block = container.locator(`.daily-note-block[data-source-path="Notes/2026-03-14.md"]`);
        await expect(block.locator(".metadata-property").first()).toBeVisible();
        const stream = await iconsByKey(block, "text");

        expect(stream).toEqual(native);
        // A check on the comparison itself: the same icon everywhere would pass
        // it without proving anything about the types.
        expect(new Set(Object.values(stream).map(String)).size).toBeGreaterThan(1);
    });

    test("opens the search pane on an inline tag, as Obsidian does everywhere else", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        await closeSearchPanes(page);

        await container.locator(".daily-note-content a.tag").first().click();

        const search = page.locator(".workspace-leaf-content[data-type='search']");
        await expect(search).toBeVisible();
        await expect(search.locator('input[type="search"]')).toHaveValue("tag:#running");
    });

    test("opens the search in a new tab when the tag is mod-clicked", async ({ obsidian }) => {
        const { page } = obsidian;
        const container = await openStream(page);

        await closeSearchPanes(page);

        await container
            .locator(".daily-note-content a.tag")
            .first()
            .click({ modifiers: ["ControlOrMeta"] });

        // A tab in the main area, not the sidebar pane that a plain click
        // opens.
        const search = page.locator(".workspace-split.mod-root .workspace-leaf-content[data-type='search']");
        await expect(search).toBeVisible();
        await expect(search.locator('input[type="search"]')).toHaveValue("tag:#running");
    });

    test("opens the search pane on a tag pill in the properties panel", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
        });
        const container = await openStream(page);

        await closeSearchPanes(page);

        await container.locator(".multi-select-pill").first().click();

        const search = page.locator(".workspace-leaf-content[data-type='search']");
        await expect(search).toBeVisible();
        await expect(search.locator('input[type="search"]')).toHaveValue("tag:#daily");
    });

    test("draws a tag property as the pill Obsidian's own panel draws", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
        });

        // Only what the tag styles decide. A pill's own box cannot be compared:
        // its width depends on its word, and Obsidian's editable pill is made
        // wider by a remove button that the read-only stream never draws.
        const measure = (root: Element) => {
            const pill = root.querySelector('.metadata-property-value[data-property-type="tags"] .multi-select-pill')!;
            const content = pill.querySelector(".multi-select-pill-content")!;
            const style = getComputedStyle(pill);
            return {
                text: content.textContent,
                contentHeight: Math.round(content.getBoundingClientRect().height),
                radius: style.borderTopLeftRadius,
                background: style.backgroundColor,
                color: style.color,
                fontSize: style.fontSize,
                padding: style.padding,
                marginInlineStart: getComputedStyle(content).marginInlineStart,
            };
        };

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-14.md");
            await window.app.workspace.getLeaf(false).openFile(file!);
        });
        const note = page.locator(".workspace-leaf.mod-active .view-content").first();
        await expect(note.locator(".multi-select-pill").first()).toBeVisible();
        const native = await note.evaluate(measure);

        const container = await openStream(page);
        await expect(container.locator(".multi-select-pill").first()).toBeVisible();
        const stream = await container.evaluate(measure);

        expect(stream).toEqual(native);
        // A pill, not a rectangle: its ends are fully rounded, and the word is
        // evenly inside it. Obsidian's space at the end is the remove button's
        // margin, so a read-only pill must add its own.
        const pill = await container
            .locator(".multi-select-pill")
            .first()
            .evaluate((el) => {
                const box = el.getBoundingClientRect();
                const word = el.querySelector(".multi-select-pill-content")!.getBoundingClientRect();
                return { height: box.height, before: word.left - box.left, after: box.right - word.right };
            });
        expect(parseFloat(stream.radius)).toBeGreaterThanOrEqual(pill.height / 2);
        expect(pill.after).toBeCloseTo(pill.before, 0);
    });

    test("marks the tag pills invalid that Obsidian's own panel marks", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
            const tags = [
                "work",
                "#work",
                "a b",
                "a,b",
                "123",
                "1a",
                "a/b",
                "-a_b",
                "é日本",
                "💡",
                "a.b",
                "a!",
                "a，b",
                "a…",
                "a—b",
                "a«b»",
                "a⸗b",
            ];
            const list = tags.map((tag) => `  - "${tag}"`).join("\n");
            await window.app.vault.create("Notes/2026-03-20.md", `---\ntags:\n${list}\n---\n\nA day.\n`);
        });

        const pills = (root: Element) =>
            Array.from(
                root.querySelectorAll(".multi-select-pill"),
                (pill) => `${pill.textContent} ${pill.classList.contains("is-invalid") ? "invalid" : "valid"}`
            );

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-20.md");
            await window.app.workspace.getLeaf(false).openFile(file!);
        });
        const note = page.locator(".workspace-leaf.mod-active .view-content").first();
        await expect(note.locator(".multi-select-pill")).toHaveCount(17);
        const native = await note.evaluate(pills);

        const container = await openStream(page);
        const block = container.locator('.daily-note-block[data-source-path="Notes/2026-03-20.md"]');
        await expect(block.locator(".multi-select-pill")).toHaveCount(17);
        expect(await block.evaluate(pills)).toEqual(native);
        await expect(block.locator(".multi-select-pill.is-invalid").first()).toHaveCSS(
            "text-decoration-line",
            "line-through"
        );
        // It names no tag, so it does not start a search.
        await expect(block.locator(".multi-select-pill.is-invalid").first()).toHaveCSS("cursor", "default");

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-20.md");
            await window.app.vault.delete(file);
        });
    });

    test("types a scalar tags value and a legacy tag key as Obsidian's own panel does", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
            await window.app.vault.create("Notes/2026-03-20.md", "---\ntags: work\ntag: solo\n---\n\nA day.\n");
        });

        const rows = (root: Element) =>
            Array.from(root.querySelectorAll(".metadata-property-value"), (value) => ({
                type: (value as HTMLElement).dataset.propertyType === "tags" ? "tags" : "not tags",
                pills: Array.from(value.querySelectorAll(".multi-select-pill"), (pill) => pill.textContent),
            }));

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-20.md");
            await window.app.workspace.getLeaf(false).openFile(file!);
        });
        const note = page.locator(".workspace-leaf.mod-active .view-content").first();
        await expect(note.locator(".metadata-property")).toHaveCount(2);
        const native = await note.evaluate(rows);

        const container = await openStream(page);
        const block = container.locator('.daily-note-block[data-source-path="Notes/2026-03-20.md"]');
        await expect(block.locator(".metadata-property")).toHaveCount(2);
        expect(await block.evaluate(rows)).toEqual(native);

        await page.evaluate(async () => {
            const file = window.app.vault.getAbstractFileByPath("Notes/2026-03-20.md");
            await window.app.vault.delete(file);
        });
    });

    test("centers a property's icon on the words in its row", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const panel = container.locator(".metadata-container").first();
        if (await panel.evaluate((el) => el.classList.contains("is-collapsed"))) {
            await panel.locator(".metadata-properties-heading").click();
        }
        await expect(panel.locator(".metadata-property").first()).toBeVisible();

        // Where the letters are, not where their boxes are. The key fills the
        // row's height, so its box was centered while the word inside it was at
        // the top, especially in a phone's taller row.
        const centers = await panel
            .locator(".metadata-property")
            .first()
            .evaluate((el) => {
                const middle = (sel: string) => {
                    const range = document.createRange();
                    range.selectNodeContents(el.querySelector(sel)!);
                    const text = range.getBoundingClientRect();
                    const r = text.height > 0 ? text : el.querySelector(sel)!.getBoundingClientRect();
                    return r.top + r.height / 2;
                };
                return {
                    icon: middle(".metadata-property-icon svg"),
                    key: middle(".metadata-property-key-input"),
                    value: middle(".metadata-property-value-text"),
                };
            });

        expect(Math.abs(centers.icon - centers.key)).toBeLessThanOrEqual(1);
        expect(Math.abs(centers.icon - centers.value)).toBeLessThanOrEqual(1);
    });

    test("draws no properties panel for a note without frontmatter", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
            await window.app.vault.create("Notes/2026-03-15.md", "## Plain\n\nNo properties here.\n");
        });
        try {
            const container = await openStream(page);
            const plain = container.locator('.daily-note-block[data-source-path="Notes/2026-03-15.md"]');
            await expect(plain.locator(".daily-note-content")).toContainText("No properties here.");
            await expect(plain.locator(".metadata-container")).toHaveCount(0);
            await expect(container.locator(".daily-note-block").nth(1).locator(".metadata-container")).toHaveCount(1);
        } finally {
            await page.evaluate(async () => {
                await window.app.vault.delete(window.app.vault.getFileByPath("Notes/2026-03-15.md"));
            });
        }
    });

    test("collapses the properties box away entirely", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            plugin.settings.propertiesCollapsed = false;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const block = container.locator(".daily-note-block").first();
        const panel = block.locator(".metadata-container");
        const heading = panel.locator(".metadata-properties-heading");
        if (await panel.evaluate((el) => el.classList.contains("is-collapsed"))) await heading.click();

        const expandedTop = (await heading.boundingBox())!.y;
        await heading.click();
        await expect(panel).toHaveClass(/is-collapsed/);

        // Hiding only the rows left the box that holds them, with its padding
        // and, on mobile, its background, under the heading.
        await expect(block.locator(".metadata-content")).toBeHidden();
        const [panelBox, headingBox] = await Promise.all([panel.boundingBox(), heading.boundingBox()]);
        expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(headingBox!.y + headingBox!.height + 1);

        // Only what is under the heading is hidden. The heading itself must not
        // jump, or folding twice looks like the panel twitching.
        expect(Math.abs(headingBox!.y - expandedTop)).toBeLessThanOrEqual(1);
    });

    test("draws no focus ring when the properties heading is clicked", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const heading = container.locator(".metadata-properties-heading").first();
        await heading.click();

        // Obsidian renders a ring around this heading on :focus. The stream is
        // read-only, so a click on it must fold the panel and leave no ring
        // behind.
        await expect(heading).not.toBeFocused();
        expect(await heading.evaluate((el) => getComputedStyle(el, "::before").boxShadow)).toBe("none");
    });

    test("does not offer a pointer on property icons nothing can click", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(async () => {
            const plugin = window.app.plugins.plugins["daily-notes-stream"];
            plugin.settings.showProperties = true;
            await plugin.saveSettings();
        });
        const container = await openStream(page);
        const panel = container.locator(".metadata-container").first();
        // Fold state is saved for each note, and an earlier test may have left
        // this panel closed. Then its icons are not there to measure.
        if (await panel.evaluate((el) => el.classList.contains("is-collapsed"))) {
            await panel.locator(".metadata-properties-heading").click();
        }
        const icon = panel.locator(".metadata-property-icon").first();
        await expect(icon).toBeVisible();

        // Obsidian's mobile stylesheet styles this icon as a button, because in
        // its own properties editor it opens a menu. The stream is read-only,
        // so the cursor must not suggest something that cannot happen.
        await expect(icon).toHaveCSS("cursor", "default");
    });
});
