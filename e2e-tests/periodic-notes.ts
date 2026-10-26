import type { Page } from "@playwright/test";
import { installPinned, PERIODIC_NOTES } from "./pinned-plugin";

/**
 * Periodic Notes' settings for daily notes, as its settings pane saves them.
 */
export interface PeriodicDailySettings {
    enabled: boolean;
    folder: string;
    format: string;
}

/**
 * Installs and turns on Periodic Notes with `daily` as its daily note settings,
 * already moved over from the core plugin's. The returned function removes it.
 */
export function installPeriodicNotes(page: Page, daily: PeriodicDailySettings): Promise<() => Promise<void>> {
    return installPinned(page, PERIODIC_NOTES, {
        showGettingStartedBanner: false,
        hasMigratedDailyNoteSettings: true,
        daily: { ...daily, template: "" },
    });
}

/**
 * Saves new daily note settings through Periodic Notes, as its settings pane
 * does.
 */
export async function setPeriodicDaily(page: Page, daily: PeriodicDailySettings): Promise<void> {
    await page.evaluate(async (daily) => {
        const plugin = window.app.plugins.getPlugin("periodic-notes");
        await plugin.updateSettings({ ...plugin.settings, daily: { ...plugin.settings.daily, ...daily } });
    }, daily);
}
