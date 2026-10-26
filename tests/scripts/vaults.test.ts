import { describe, it, expect, vi } from "vitest";
import { join, resolve } from "path";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import {
    DEMO_VAULT,
    PLUGIN_ID,
    TEST_VAULT,
    USER_DATA_DIR,
    installBuild,
    stopObsidian,
    vaultFrom,
} from "../../scripts/vaults.mjs";

const repoRoot = resolve(__dirname, "../..");

describe("vaultFrom", () => {
    it("acts on the demo vault by default", () => {
        expect(vaultFrom(undefined, ["--desktop"])).toBe(join(repoRoot, ".dev", "demo-vault"));
        expect(DEMO_VAULT).toBe(join(repoRoot, ".dev", "demo-vault"));
    });

    it("acts on the test vault when asked with --test", () => {
        expect(vaultFrom(undefined, ["--test"])).toBe(join(repoRoot, ".dev", "vault"));
        expect(TEST_VAULT).toBe(join(repoRoot, ".dev", "vault"));
    });

    it("acts on a vault named on the command line, whatever else is asked", () => {
        expect(vaultFrom("elsewhere", ["--test"])).toBe(resolve("elsewhere"));
    });
});

describe("PLUGIN_ID", () => {
    it("is the id the manifest gives the plugin, which names its folder in a vault", () => {
        const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8")) as { id: string };
        expect(PLUGIN_ID).toBe(manifest.id);
    });
});

describe("stopObsidian", () => {
    const pattern = `user-data-dir=${join(repoRoot, ".dev", "obsidian-userdata")}`;

    /** Replaces execFileSync. pgrep finds the running copy until pkill runs. */
    function commands(running: boolean) {
        let alive = running;
        return vi.fn((command: string, args: string[]) => {
            if (command === "pgrep") {
                if (!alive) throw new Error("pgrep exits 1 when nothing matches");
                return "4242\n";
            }
            if (command === "pkill") alive = false;
            return "";
        });
    }

    it("is the instance under the dev user-data directory, never your own Obsidian", () => {
        expect(USER_DATA_DIR).toBe(join(repoRoot, ".dev", "obsidian-userdata"));
    });

    it("kills the dev instance's processes and waits until they are gone", () => {
        const run = commands(true);

        stopObsidian(run);

        expect(run).toHaveBeenCalledWith("pkill", ["-f", pattern]);
        expect(run).toHaveBeenLastCalledWith("pgrep", ["-f", pattern], expect.anything());
    });

    it("kills nothing when no dev instance is running", () => {
        const run = commands(false);

        stopObsidian(run);

        expect(run).not.toHaveBeenCalledWith("pkill", expect.anything());
    });
});

describe("installBuild", () => {
    const assets = ["main.js", "manifest.json", "styles.css"];

    /**
     * A fake repo holding the named build files, each containing its own name.
     */
    function built(files: readonly string[]) {
        const repo = mkdtempSync(join(tmpdir(), "build-"));
        for (const file of files) writeFileSync(join(repo, file), file);
        return repo;
    }

    it("copies the build into the vault's plugin folder, creating it", () => {
        const vault = mkdtempSync(join(tmpdir(), "vault-"));

        installBuild(vault, built(assets));

        for (const asset of assets) {
            expect(readFileSync(join(vault, ".obsidian", "plugins", PLUGIN_ID, asset), "utf8")).toBe(asset);
        }
    });

    it("refuses a missing build, naming what is missing, and copies nothing", () => {
        const vault = mkdtempSync(join(tmpdir(), "vault-"));

        expect(() => installBuild(vault, built(["manifest.json"]))).toThrow(
            "Build first — missing main.js, styles.css. Run: pnpm run build"
        );
        expect(() => readFileSync(join(vault, ".obsidian", "plugins", PLUGIN_ID, "manifest.json"))).toThrow();
    });

    /**
     * A vault whose plugin folder links each build file to `target(asset)`, as
     * an older demo run left it.
     */
    function linkedTo(target: (asset: string) => string) {
        const vault = mkdtempSync(join(tmpdir(), "vault-"));
        const pluginDir = join(vault, ".obsidian", "plugins", PLUGIN_ID);
        mkdirSync(pluginDir, { recursive: true });
        for (const asset of assets) symlinkSync(target(asset), join(pluginDir, asset));
        return vault;
    }

    it("replaces a link to a folder that is gone, such as the repo's old name", () => {
        const vault = linkedTo((asset) => join(tmpdir(), "renamed-away", asset));

        installBuild(vault, built(assets));

        for (const asset of assets) {
            const installed = join(vault, ".obsidian", "plugins", PLUGIN_ID, asset);
            expect(lstatSync(installed).isFile()).toBe(true);
            expect(readFileSync(installed, "utf8")).toBe(asset);
        }
    });

    it("replaces a link to another checkout's build, leaving that build as it was", () => {
        const other = mkdtempSync(join(tmpdir(), "other-"));
        for (const asset of assets) writeFileSync(join(other, asset), "the other build");
        const vault = linkedTo((asset) => join(other, asset));

        installBuild(vault, built(assets));

        for (const asset of assets) {
            expect(readFileSync(join(vault, ".obsidian", "plugins", PLUGIN_ID, asset), "utf8")).toBe(asset);
            expect(readFileSync(join(other, asset), "utf8")).toBe("the other build");
        }
    });
});
