import { DAILY_TEMPLATE } from "../../scripts/demo-vault.mjs";

export const PLUGIN_ID = "daily-notes-stream";

/** The test vault's config files, by name, in its config folder. */
export function vaultConfig({ recording }: { recording: boolean }): Record<string, unknown> {
    return {
        "daily-notes.json": { folder: "Journal", format: "YYYY-MM-DD", template: DAILY_TEMPLATE },
        "core-plugins.json": { "daily-notes": true, bases: true },
        "community-plugins.json": [PLUGIN_ID],
        "app.json": { attachmentFolderPath: "Attachments" },
        // Light in a recording, like the desktop recording. Otherwise the
        // phone's own theme, as the desktop e2e vault follows the Mac's.
        "appearance.json": { theme: recording ? "moonstone" : "system" },
    };
}
