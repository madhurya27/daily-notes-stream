/**
 * Reloads the plugin in the window `pnpm run demo` opened, through the
 * debugging port it was started with. D-008 says why it is done here and not in
 * the vault.
 *
 * Turning the plugin off and on again runs `onload` again and loads
 * `styles.css` again, which Obsidian otherwise only reads once, when it loads.
 */
import { chromium } from "@playwright/test";
import { execSync } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { PLUGIN_ID, USER_DATA_DIR } from "./vaults.mjs";

const VIEW_TYPE = "daily-notes-stream-view";

/**
 * The debugging port of the Obsidian started with `userDataDir`, read from a
 * `ps` listing, or null if it has none. Only that one, because e2e runs start
 * their own copies, each with a port, and a reload there would break a test.
 * Its helper processes have the folder but not the port.
 */
export function debugPort(psOutput, userDataDir) {
    for (const args of psOutput.split("\n")) {
        const port = /--remote-debugging-port=(\d+)/.exec(args);
        // The option and a space after it, so a path with spaces matches, and a
        // longer path does not.
        if (port && `${args} `.includes(`--user-data-dir=${userDataDir} `)) return Number(port[1]);
    }
    return null;
}

function runningPort() {
    return debugPort(execSync("ps -Ao args", { encoding: "utf8" }), USER_DATA_DIR);
}

/**
 * Returns the port it reached. Throws an error when no window is open, instead
 * of letting a watcher look like it worked.
 */
export async function reloadPlugin() {
    const port = runningPort();
    if (port === null) throw new Error("No Obsidian with a debugging port — start one with: pnpm run demo");

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
        for (const page of browser.contexts().flatMap((context) => context.pages())) {
            const reloaded = await page
                .evaluate(
                    async ([pluginId, viewType]) => {
                        const app = window.app;
                        if (!app?.plugins?.plugins?.[pluginId]) return false;
                        await app.plugins.disablePlugin(pluginId);
                        await app.plugins.enablePlugin(pluginId);
                        // Turning the plugin off closed the view, so the
                        // command opens it again.
                        if (app.workspace.getLeavesOfType(viewType).length === 0) {
                            await app.commands.executeCommandById(`${pluginId}:open-stream`);
                        }
                        return true;
                    },
                    [PLUGIN_ID, VIEW_TYPE]
                )
                .catch(() => false); // a devtools or about:blank page, not the vault
            if (reloaded) return port;
        }
    } finally {
        await browser.close();
    }
    throw new Error(`Obsidian is on port ${port}, but ${PLUGIN_ID} is not installed in the open vault.`);
}

/** True when this module is the file Node was asked to run, not an import. */
export function isMain(moduleUrl) {
    return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}
