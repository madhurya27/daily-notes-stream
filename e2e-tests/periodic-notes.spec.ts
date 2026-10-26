import { installPeriodicNotes, setPeriodicDaily } from "./periodic-notes";
import { test, expect, openStream } from "./obsidian";

/**
 * Periodic Notes' daily notes: a folder and a format that the core plugin's
 * settings don't name.
 */
const DAILY = { enabled: true, folder: "Periodic", format: "DD-MM-YYYY" };
const NOTES = ["Periodic/14-04-2026.md", "Periodic/13-04-2026.md", "Elsewhere/20-04-2026.md"];

let uninstall: () => Promise<void>;

test.beforeEach(async ({ obsidian }) => {
    await obsidian.page.evaluate(async (notes) => {
        for (const path of notes) {
            await window.app.vault.createFolder(path.split("/")[0]).catch(() => {});
            await window.app.vault.create(path, "## Morning\n\nWritten through Periodic Notes.\n");
        }
    }, NOTES);
    uninstall = await installPeriodicNotes(obsidian.page, DAILY);
});

test.afterEach(async ({ obsidian }) => {
    await uninstall();
    await obsidian.page.evaluate(async () => {
        for (const name of ["Periodic", "Elsewhere"]) {
            const folder = window.app.vault.getAbstractFileByPath(name);
            if (folder) await window.app.vault.delete(folder, true);
        }
    });
});

test("shows the daily notes Periodic Notes' settings name, not core's", async ({ obsidian }) => {
    const container = await openStream(obsidian.page);

    await expect(container.locator(".daily-note-title")).toHaveText(["14-04-2026", "13-04-2026"]);
});

test("follows a change to Periodic Notes' daily-note folder", async ({ obsidian }) => {
    const container = await openStream(obsidian.page);
    await expect(container.locator(".daily-note-title").first()).toHaveText("14-04-2026");

    await setPeriodicDaily(obsidian.page, { ...DAILY, folder: "Elsewhere" });

    await expect(container.locator(".daily-note-title")).toHaveText(["20-04-2026"]);
});

test("returns to core's settings when Periodic Notes' daily notes are turned off", async ({ obsidian }) => {
    const container = await openStream(obsidian.page);
    await expect(container.locator(".daily-note-title").first()).toHaveText("14-04-2026");

    await setPeriodicDaily(obsidian.page, { ...DAILY, enabled: false });

    await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");
});

test("returns to core's settings when Periodic Notes is disabled", async ({ obsidian }) => {
    const container = await openStream(obsidian.page);
    await expect(container.locator(".daily-note-title").first()).toHaveText("14-04-2026");

    await obsidian.page.evaluate(() => window.app.plugins.disablePlugin("periodic-notes"));

    await expect(container.locator(".daily-note-title").first()).toHaveText("2026-03-14");
});
