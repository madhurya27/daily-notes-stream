import { execFileSync } from "child_process";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchPinned, PINNED_PLUGINS } from "./pinned-plugin";

const FOLDER_PREFIXES = ["dns-vault-", "dns-userdata-", "dns-windows-"];

/** True when a running process still uses this folder. */
function inUse(dir: string): boolean {
    try {
        execFileSync("pgrep", ["-f", dir], { stdio: "ignore" });
        return true;
    } catch {
        return false; // pgrep exits non-zero when nothing matches
    }
}

/**
 * Kills every test copy of Obsidian. Each run starts with none and opens its
 * own, so any that exists is left over from an earlier run, or at the end of a
 * run is this run's. Returns whether it found one.
 */
function killInstances(): boolean {
    let found = false;
    for (const signal of ["-TERM", "-KILL"]) {
        try {
            execFileSync("pkill", [signal, "-f", join(tmpdir(), "dns-userdata-")], { stdio: "ignore" });
            found = true;
        } catch {
            // pkill exits with an error when nothing matched.
        }
    }
    return found;
}

/** Removes the folders that no running process uses. Returns their names. */
function removeFolders(): string[] {
    const tmp = tmpdir();
    const removed: string[] = [];
    for (const entry of readdirSync(tmp)) {
        if (!FOLDER_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
        const dir = join(tmp, entry);
        if (inUse(dir)) continue;
        rmSync(dir, { recursive: true, force: true });
        removed.push(entry);
    }
    return removed;
}

/**
 * Windows stay open between workers, so they are closed when the run ends,
 * whether it exits normally or with Ctrl-C (D-196). A run that is killed leaves
 * them, so a run also starts by removing anything left over.
 */
export default async function globalSetup(): Promise<() => void> {
    if (killInstances()) console.log("[e2e] killed a stranded Obsidian instance");
    for (const entry of removeFolders()) console.log(`[e2e] swept stale fixture directory: ${entry}`);
    for (const plugin of PINNED_PLUGINS) await fetchPinned(plugin);
    process.env.E2E_WINDOWS_DIR = mkdtempSync(join(tmpdir(), "dns-windows-"));
    return () => {
        killInstances();
        removeFolders();
    };
}
