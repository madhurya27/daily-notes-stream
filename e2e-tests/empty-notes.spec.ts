import type { Page } from "@playwright/test";
import {
    setHideEmptyNotes,
    test,
    expect,
    atTextSize,
    openStream,
    scrollThroughStream,
    seededDate,
    today,
    todayNote,
    writeDailyNotesConfig,
    writeNote,
    DAILY_NOTES_CONFIG,
} from "./obsidian";

const TEMPLATE_PATH = "Templates/Daily.md";
const OTHER_TEMPLATE_PATH = "Templates/Other.md";
const TEMPLATE = "---\ntags: daily\n---\n# {{date:dddd, MMMM D}}\n\n## Log\n- \n";
/** A day after the newest test note, holding only its template. */
const EMPTY_DAY = "2026-03-15";
const EMPTY_NOTE = `Notes/${EMPTY_DAY}.md`;
/** The only note in a folder of its own, so every daily note there is empty. */
const ONLY_EMPTY_NOTE = `Empty/${EMPTY_DAY}.md`;
/** Not a daily note. It links to the empty one. */
const MENTIONING_NOTE = "Meeting.md";
/** Not a daily note. It is embedded in one. */
const EMBEDDED_NOTE = "Embedded.md";
const EMPTY_TEXT = "---\ntags: daily\n---\n# Sunday, March 15\n\n## Log\n- \n";
/**
 * Empty notes older than all the others, together taller than the pane. They
 * make up the whole end of the stream.
 */
const OLD_EMPTY_NOTES = ["01", "02", "03", "04", "05", "06"].map((day) => `Notes/2020-01-${day}.md`);

async function setShowLinkedMentions(page: Page, on: boolean) {
    await page.evaluate(async (on) => {
        const plugin = window.app.plugins.plugins["daily-notes-stream"];
        plugin.settings.showLinkedMentions = on;
        await plugin.saveSettings();
    }, on);
}

test.describe("empty daily notes", () => {
    test.beforeEach(async ({ obsidian }) => {
        const { page, vaultPath } = obsidian;
        await setHideEmptyNotes(page, true);
        await page.evaluate(async () => {
            await window.app.vault.createFolder("Templates").catch(() => {});
        });
        await writeNote(page, TEMPLATE_PATH, TEMPLATE);
        await writeNote(page, EMPTY_NOTE, EMPTY_TEXT);
        await writeNote(page, await todayNote(page), EMPTY_TEXT);
        writeDailyNotesConfig(vaultPath, { ...DAILY_NOTES_CONFIG, template: "Templates/Daily" });
        await expect
            .poll(() =>
                page.evaluate(
                    () => window.app.internalPlugins.getPluginById("daily-notes").instance.options.template as string
                )
            )
            .toBe("Templates/Daily");
    });

    test.afterEach(async ({ obsidian }) => {
        const { page, vaultPath } = obsidian;
        await setHideEmptyNotes(page, false);
        await setShowLinkedMentions(page, true);
        writeDailyNotesConfig(vaultPath, DAILY_NOTES_CONFIG);
        const paths = [
            TEMPLATE_PATH,
            OTHER_TEMPLATE_PATH,
            ONLY_EMPTY_NOTE,
            "Empty",
            EMPTY_NOTE,
            MENTIONING_NOTE,
            EMBEDDED_NOTE,
            ...OLD_EMPTY_NOTES,
            await todayNote(page),
        ];
        await page.evaluate(async (paths) => {
            for (const path of paths) {
                const file = window.app.vault.getAbstractFileByPath(path);
                if (file) await window.app.vault.delete(file, true);
            }
        }, paths);
    });

    const titles = async (page: Page) => {
        const container = await openStream(page);
        return container.locator(".daily-note-title");
    };

    test("leaves out a note holding only its template, but shows today's", async ({ obsidian }) => {
        const { page } = obsidian;
        const shown = await titles(page);

        await expect(shown.first()).toHaveText(await today(page));
        await expect(shown.nth(1)).toHaveText(seededDate(0));
        await expect(page.locator(`[data-source-path="${EMPTY_NOTE}"]`)).toHaveCount(0);
    });

    test("shows the note once it is written in", async ({ obsidian }) => {
        const { page } = obsidian;
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(seededDate(0));

        await writeNote(page, EMPTY_NOTE, `${EMPTY_TEXT}- Ran 5 km\n`);

        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);
        await expect(shown.nth(2)).toHaveText(seededDate(0));
    });

    test("shows the note once a property is added", async ({ obsidian }) => {
        const { page } = obsidian;
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(seededDate(0));

        await page.evaluate(async (path) => {
            const file = window.app.vault.getFileByPath(path)!;
            await window.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
                frontmatter.mood = "good";
            });
        }, EMPTY_NOTE);

        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);
    });

    test("hides the note again once it is emptied back to the template", async ({ obsidian }) => {
        const { page } = obsidian;
        await writeNote(page, EMPTY_NOTE, `${EMPTY_TEXT}- Ran 5 km\n`);
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);

        await writeNote(page, EMPTY_NOTE, EMPTY_TEXT);

        await expect(shown.nth(1)).toHaveText(seededDate(0));
    });

    test("shows the note, with its linked mentions, when another note links to it", async ({ obsidian }) => {
        const { page } = obsidian;
        await writeNote(page, MENTIONING_NOTE, `Planned on [[${EMPTY_DAY}]].\n`);
        await expect
            .poll(() => page.evaluate((path) => path in window.app.metadataCache.resolvedLinks, MENTIONING_NOTE))
            .toBe(true);

        const shown = await titles(page);

        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);
        await expect(page.locator(`[data-source-path="${EMPTY_NOTE}"]`)).toContainText("Planned on");
    });

    test("shows the note as soon as another note links to it", async ({ obsidian }) => {
        const { page } = obsidian;
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(seededDate(0));

        await writeNote(page, MENTIONING_NOTE, `Planned on [[${EMPTY_DAY}]].\n`);

        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);
        await expect(page.locator(`[data-source-path="${EMPTY_NOTE}"]`)).toContainText("Planned on");
    });

    test("hides the note again once its last link is removed", async ({ obsidian }) => {
        const { page } = obsidian;
        await writeNote(page, MENTIONING_NOTE, `Planned on [[${EMPTY_DAY}]].\n`);
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);

        await writeNote(page, MENTIONING_NOTE, "Planned on another day.\n");

        await expect(shown.nth(1)).toHaveText(seededDate(0));
    });

    test("hides the note again once the note linking to it is deleted", async ({ obsidian }) => {
        const { page } = obsidian;
        await writeNote(page, MENTIONING_NOTE, `Planned on [[${EMPTY_DAY}]].\n`);
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);

        await page.evaluate((path) => window.app.vault.delete(window.app.vault.getFileByPath(path)), MENTIONING_NOTE);

        await expect(shown.nth(1)).toHaveText(seededDate(0));
    });

    test("leaves out a note with no text at all", async ({ obsidian }) => {
        const { page } = obsidian;
        await writeNote(page, EMPTY_NOTE, "");

        const shown = await titles(page);

        await expect(shown.nth(1)).toHaveText(seededDate(0));
        await expect(page.locator(`[data-source-path="${EMPTY_NOTE}"]`)).toHaveCount(0);
    });

    test("leaves the note out despite a link to it while linked mentions are off", async ({ obsidian }) => {
        const { page } = obsidian;
        await setShowLinkedMentions(page, false);
        await writeNote(page, MENTIONING_NOTE, `Planned on [[${EMPTY_DAY}]].\n`);
        await expect
            .poll(() => page.evaluate((path) => path in window.app.metadataCache.resolvedLinks, MENTIONING_NOTE))
            .toBe(true);

        const shown = await titles(page);

        await expect(shown.nth(1)).toHaveText(seededDate(0));
        await expect(page.locator(`[data-source-path="${EMPTY_NOTE}"]`)).toHaveCount(0);
    });

    test("says every note is hidden when each holds only its template", async ({ obsidian }) => {
        const { page, vaultPath } = obsidian;
        await page.evaluate(async () => {
            await window.app.vault.createFolder("Empty").catch(() => {});
        });
        await writeNote(page, ONLY_EMPTY_NOTE, EMPTY_TEXT);
        const container = await openStream(page);

        writeDailyNotesConfig(vaultPath, {
            folder: "Empty",
            format: DAILY_NOTES_CONFIG.format,
            template: "Templates/Daily",
        });

        await expect(container.locator(".daily-notes-empty-state")).toHaveText(/^Every daily note is hidden/);
        await expect(container.locator(".daily-note-block")).toHaveCount(0);
    });

    test("judges the notes again by a template newly set", async ({ obsidian }) => {
        const { page, vaultPath } = obsidian;
        await writeNote(page, OTHER_TEMPLATE_PATH, "## Plan\n- \n");
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(seededDate(0));

        writeDailyNotesConfig(vaultPath, { ...DAILY_NOTES_CONFIG, template: OTHER_TEMPLATE_PATH.replace(/\.md$/, "") });

        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);
    });

    // Each note's check is saved on this device (ADR 0011).
    test("reads no unchanged note after the plugin reloads, and still hides the empty one", async ({ obsidian }) => {
        const { page } = obsidian;
        await titles(page);
        const read = await page.evaluate(async () => {
            const { app } = window;
            await app.plugins.disablePlugin("daily-notes-stream");
            const { vault } = app;
            const cachedRead = vault.cachedRead;
            const read: string[] = [];
            vault.cachedRead = (file: { path: string }) => (read.push(file.path), cachedRead.call(vault, file));
            try {
                await app.plugins.enablePlugin("daily-notes-stream");
                await app.commands.executeCommandById("daily-notes-stream:open-stream");
                while (!document.querySelector(".daily-notes-stream-container .daily-note-content"))
                    await new Promise((resolve) => setTimeout(resolve, 5));
            } finally {
                vault.cachedRead = cachedRead;
            }
            // Drawing the stream also reads each note. Only the check is being
            // tested.
            const drawn = new Set(
                [...document.querySelectorAll<HTMLElement>(".daily-note-block:not(.is-unloaded)")].map(
                    (el) => el.dataset.sourcePath
                )
            );
            return read.filter((path) => path.startsWith("Notes/") && !drawn.has(path));
        });

        expect(read).toEqual([]);
        const shown = (await openStream(page)).locator(".daily-note-title");
        await expect(shown.nth(1)).toHaveText(seededDate(0));
    });

    test("shows every note with the setting off", async ({ obsidian }) => {
        const { page } = obsidian;
        const shown = await titles(page);
        await expect(shown.nth(1)).toHaveText(seededDate(0));

        await setHideEmptyNotes(page, false);

        await expect(shown.nth(1)).toHaveText(EMPTY_DAY);
    });

    test.describe("toggling the setting while reading", () => {
        const block = (page: Page, path: string) => page.locator(`[data-source-path="${path}"]`);

        /** Scrolls the note at `path` to the top of the pane. */
        const readAt = (page: Page, path: string) =>
            block(page, path).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));

        /** How far below the pane's top the note at `path` starts. */
        const offsetOf = (page: Page, path: string) =>
            block(page, path).evaluate((el) => {
                const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
                return el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
            });

        test("keeps the note being read at the top right after scrolling to it", async ({ obsidian }) => {
            const { page } = obsidian;
            const reading = `Notes/${seededDate(10)}.md`;
            // Above the reader, much taller than its text, so its estimate is
            // too short.
            const tall = `Notes/${seededDate(8)}.md`;
            const text = await page.evaluate((path) => window.app.vault.adapter.read(path), tall);
            await writeNote(page, EMBEDDED_NOTE, Array.from({ length: 80 }, (_, i) => `Line ${i}`).join("\n\n"));
            await writeNote(page, tall, `${text}\n![[Embedded]]\n`);
            try {
                const pane = (await openStream(page)).locator("xpath=..");
                // Its batch loads when the end comes into view.
                await pane.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));
                await readAt(page, reading);
                const before = await offsetOf(page, reading);

                await setHideEmptyNotes(page, false);

                await expect(block(page, EMPTY_NOTE)).toHaveCount(1);
                // Mobile scrolls in half pixels, so each correction of the
                // scroll may be a quarter of a pixel off.
                await expect.poll(async () => Math.abs((await offsetOf(page, reading)) - before)).toBeLessThan(1);
            } finally {
                await writeNote(page, tall, text);
            }
        });

        test("moves to the next older note when the one being read is hidden", async ({ obsidian }) => {
            const { page } = obsidian;
            await setHideEmptyNotes(page, false);
            await titles(page);
            await readAt(page, EMPTY_NOTE);

            await setHideEmptyNotes(page, true);

            await expect(block(page, EMPTY_NOTE)).toHaveCount(0);
            await expect.poll(() => offsetOf(page, `Notes/${seededDate(0)}.md`)).toBeCloseTo(0, 0);
        });

        /**
         * Hides the empty notes at the stream's end while the pane is scrolled
         * there. The pane then ends at the stream's new end.
         */
        async function hideAtTheEnd(page: Page) {
            for (const path of OLD_EMPTY_NOTES) await writeNote(page, path, EMPTY_TEXT);
            await setHideEmptyNotes(page, false);
            const container = await openStream(page);
            await scrollThroughStream(container);
            const pane = container.locator("xpath=..");
            const oldest = OLD_EMPTY_NOTES[0]!;
            // Each batch loads when the end comes into view.
            await expect
                .poll(async () => {
                    await pane.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));
                    return block(page, oldest).count();
                })
                .toBe(1);
            await pane.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));

            await setHideEmptyNotes(page, true);

            await expect(block(page, oldest)).toHaveCount(0);
            await expect
                .poll(() => pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
                .toBeLessThan(1);
        }

        test("goes to the end of the stream when no older note is left", async ({ obsidian }) => {
            await hideAtTheEnd(obsidian.page);
        });

        test("goes to the end of the stream when no older note is left, at a large text size", async ({ obsidian }) => {
            const { page } = obsidian;
            await atTextSize(page, 22, () => hideAtTheEnd(page));
        });
    });
});
