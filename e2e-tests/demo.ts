import type { Page } from "@playwright/test";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { demoVault } from "../scripts/demo-vault.mjs";

/** Where the README's images are. */
export const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "images");

/** Fixed, so taking the pictures again shows the same days. */
export const DEMO = demoVault({ until: new Date(Date.UTC(2026, 8, 25)), days: 21 });

/**
 * Replaces the test notes with the demo journal, in the folder the test daily
 * notes use, and closes the sidebar. The sidebar shows the test vault's
 * generated name, and with it closed, the stream gets the width a reader cares
 * about. The phone layout already hides it.
 */
export async function prepareDemo(page: Page): Promise<void> {
    const files = Object.entries(DEMO).map(([path, text]): [string, string] => [
        path.replace(/^Journal\//, "Notes/"),
        text,
    ]);
    await page.evaluate(async (files) => {
        const { vault } = window.app;
        for (const file of vault.getFiles()) await vault.delete(file);
        for (const [path, text] of files) {
            const folder = path.split("/").slice(0, -1).join("/");
            if (folder && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
            await vault.create(path, text);
        }
        // The stream renders from metadataCache, which is updated after the
        // file is written.
        await new Promise((r) => setTimeout(r, 1000));
    }, files);
    await page.evaluate(() => window.app.workspace.leftSplit?.collapse?.());
    // Sync's status icon is red in a vault with no account.
    await page.evaluate(() => window.app.internalPlugins.getPluginById("sync")?.disable(false));
    await showLightTheme(page);
    mkdirSync(OUT, { recursive: true });
}

/**
 * The vault follows the system theme. Fixing the theme means a Mac in dark mode
 * takes the same pictures.
 */
export async function showLightTheme(page: Page): Promise<void> {
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.body.classList.contains("theme-light"));
}
