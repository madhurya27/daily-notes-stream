import { installPinned, TEMPLATER } from "./pinned-plugin";
import { test, expect, openStream, setHideEmptyNotes, writeDailyNotesConfig, DAILY_NOTES_CONFIG } from "./obsidian";

const TEMPLATE_PATH = "Templates/Daily.md";
/** A journal's daily notes template, filled in only by Templater. */
const TEMPLATE = [
    "---",
    "type: Journal",
    'created: <% tp.file.creation_date("YYYY-MM-DD") %>',
    "---",
    "",
    `# <% moment(tp.file.title, "YYYY-MM-DD").format("dddd - MMMM Do, YYYY") %>`,
    "",
    "## Notes",
    "- <% tp.file.cursor() %>",
    "",
    "## Events",
    "- ",
    "",
].join("\n");
/** Newer than every test note, so it would be first in the stream if shown. */
const NOTE = "Notes/2026-03-20.md";

let uninstall: () => Promise<void>;

const read = (page: Parameters<typeof openStream>[0]) =>
    page.evaluate((path) => window.app.vault.read(window.app.vault.getFileByPath(path)), NOTE) as Promise<string>;

test.beforeEach(async ({ obsidian }) => {
    const { page, vaultPath } = obsidian;
    await setHideEmptyNotes(page, true);
    // Saved on this device only, where Templater's own switch saves it, because
    // the setting runs code when a file is created.
    await page.evaluate(() =>
        window.app.saveLocalStorage("templater-local-settings", { trigger_on_file_creation: true })
    );
    uninstall = await installPinned(page, TEMPLATER, { templates_folder: "Templates" });
    await page.evaluate(
        async ({ path, text }) => {
            await window.app.vault.createFolder("Templates").catch(() => {});
            await window.app.vault.create(path, text);
        },
        { path: TEMPLATE_PATH, text: TEMPLATE }
    );
    writeDailyNotesConfig(vaultPath, { ...DAILY_NOTES_CONFIG, template: "Templates/Daily" });
    await expect
        .poll(() =>
            page.evaluate(() => window.app.internalPlugins.getPluginById("daily-notes").instance.options.template)
        )
        .toBe("Templates/Daily");
    // The core Daily notes plugin creates the note with its template's text,
    // and Templater then fills it in.
    await page.evaluate(
        async ({ path, text }) => {
            await window.app.vault.create(path, text);
        },
        { path: NOTE, text: TEMPLATE }
    );
    await expect.poll(() => read(page)).toContain("# Friday - March 20th, 2026\n");
});

test.afterEach(async ({ obsidian }) => {
    const { page, vaultPath } = obsidian;
    await uninstall();
    await setHideEmptyNotes(page, false);
    await page.evaluate(() => window.app.saveLocalStorage("templater-local-settings", null));
    writeDailyNotesConfig(vaultPath, DAILY_NOTES_CONFIG);
    await page.evaluate(
        async (paths) => {
            for (const path of paths) {
                const file = window.app.vault.getAbstractFileByPath(path);
                if (file) await window.app.vault.delete(file, true);
            }
        },
        [NOTE, "Templates"]
    );
});

test("hides a daily note Templater filled in and nobody wrote in", async ({ obsidian }) => {
    const container = await openStream(obsidian.page);

    await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");
});

test("shows the note once written in at Templater's cursor", async ({ obsidian }) => {
    const { page } = obsidian;
    const container = await openStream(page);
    await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");

    await page.evaluate(async (path) => {
        const file = window.app.vault.getFileByPath(path);
        await window.app.vault.process(file, (text: string) =>
            text.replace(/## Notes\n- .*\n/, "## Notes\n- Called Mara\n")
        );
    }, NOTE);

    await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-20");
});
