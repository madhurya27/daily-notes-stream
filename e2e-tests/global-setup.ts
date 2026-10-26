import { execFileSync } from "child_process";
import { readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchPinned, PINNED_PLUGINS } from "./pinned-plugin";

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
 * Test vaults and profiles are removed at the end of a run, whether it exits
 * normally, with Ctrl-C, or is killed. A worker that crashes can still leave
 * one behind, so remove anything left over that no running process uses.
 */
export default async function globalSetup(): Promise<void> {
    killStrandedInstances();
    for (const plugin of PINNED_PLUGINS) await fetchPinned(plugin);
    const tmp = tmpdir();
    for (const entry of readdirSync(tmp)) {
        if (!entry.startsWith("dns-vault-") && !entry.startsWith("dns-userdata-")) continue;
        const dir = join(tmp, entry);
        if (inUse(dir)) continue;
        rmSync(dir, { recursive: true, force: true });
        console.log(`[e2e] swept stale fixture directory: ${entry}`);
    }
}

/**
 * Kills copies of Obsidian left behind by an earlier run. Every test profile is
 * in a new dns-userdata- folder, so anything that matches one before this run
 * starts is left over. Killing it also frees its folder to be removed.
 */
function killStrandedInstances(): void {
    for (const signal of ["-TERM", "-KILL"]) {
        try {
            execFileSync("pkill", [signal, "-f", join(tmpdir(), "dns-userdata-")], { stdio: "ignore" });
            console.log("[e2e] killed a stranded Obsidian instance");
        } catch {
            // pkill exits with an error when nothing matched, which means
            // nothing was left behind.
        }
    }
}
