import type { Page } from "@playwright/test";
import { installPinned, DATAVIEW } from "./pinned-plugin";

/**
 * Installs and turns on Dataview in the vault, with its JS queries on. The
 * returned function removes it.
 */
export async function installDataview(page: Page): Promise<() => Promise<void>> {
    const uninstall = await installPinned(page, DATAVIEW);
    await page.evaluate(() => {
        window.app.plugins.plugins.dataview.settings.enableDataviewJs = true;
    });
    return uninstall;
}
