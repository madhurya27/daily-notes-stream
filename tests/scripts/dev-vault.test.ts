import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { debugPort } from "../../scripts/reload-plugin.mjs";
import {
    ASSETS,
    createChangeFilter,
    createReloader,
    linkAssets,
    optionsFrom,
    stepsFor,
} from "../../scripts/dev-vault.mjs";

const repoRoot = resolve(__dirname, "../..");

describe("debugPort", () => {
    const DEV = "/repo/.dev/obsidian-userdata";
    const obsidian = (dir: string, port?: number) =>
        `/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=${dir}` +
        (port ? ` --remote-debugging-port=${port}` : "");

    it("reads the port the dev instance was launched with", () => {
        expect(debugPort(obsidian(DEV, 63416), DEV)).toBe(63416);
    });

    it("returns null when the dev instance has none", () => {
        expect(debugPort(obsidian(DEV), DEV)).toBeNull();
    });

    // A save during an e2e run must not reload the plugin inside a test's
    // window.
    it("passes over e2e instances, whatever order ps lists them in", () => {
        const ps = [obsidian("/tmp/dns-userdata-a1", 1000), obsidian(DEV, 2000)].join("\n");
        expect(debugPort(ps, DEV)).toBe(2000);
        expect(debugPort(obsidian("/tmp/dns-userdata-a1", 1000), DEV)).toBeNull();
    });

    it("reads it from the main process, past helpers that carry the directory but no port", () => {
        const helper = `/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper --type=renderer --user-data-dir=${DEV}`;
        expect(debugPort([helper, obsidian(DEV, 2000)].join("\n"), DEV)).toBe(2000);
    });

    it("finds a directory whose path holds a space", () => {
        const spaced = "/Users/me/Mobile Documents/repo/.dev/obsidian-userdata";
        expect(debugPort(obsidian(spaced, 4000), spaced)).toBe(4000);
    });

    it("matches the directory whole, not one it prefixes", () => {
        expect(debugPort(obsidian(`${DEV}-old`, 3000), DEV)).toBeNull();
    });
});

describe("linkAssets", () => {
    let vault: string;

    beforeEach(() => {
        vault = mkdtempSync(join(tmpdir(), "dev-vault-"));
        mkdirSync(join(vault, ".obsidian", "plugins", "daily-notes-stream"), { recursive: true }); // as `seed` leaves it
    });

    afterEach(() => {
        rmSync(vault, { recursive: true, force: true });
    });

    const pluginDir = () => join(vault, ".obsidian", "plugins", "daily-notes-stream");

    it("points each asset at the repo's own file", () => {
        linkAssets(repoRoot, vault);
        for (const asset of ASSETS) {
            expect(readlinkSync(join(pluginDir(), asset))).toBe(join(repoRoot, asset));
        }
    });

    it("replaces the copies a seeded vault holds", () => {
        writeFileSync(join(pluginDir(), "main.js"), "a stale build");

        linkAssets(repoRoot, vault);

        expect(lstatSync(join(pluginDir(), "main.js")).isSymbolicLink()).toBe(true);
    });

    it("is safe to run twice", () => {
        linkAssets(repoRoot, vault);
        linkAssets(repoRoot, vault);
        expect(lstatSync(join(pluginDir(), "styles.css")).isSymbolicLink()).toBe(true);
    });
});

describe("createReloader", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("collapses a burst of writes into one reload", async () => {
        const reload = vi.fn().mockResolvedValue(1);
        const schedule = createReloader(reload, 250);

        schedule();
        schedule();
        schedule();
        await vi.advanceTimersByTimeAsync(300);

        // esbuild writes main.js in more than one step, and macOS reports a
        // single save as several events.
        expect(reload).toHaveBeenCalledOnce();
    });

    it("waits for a reload in flight, then runs once for everything that arrived", async () => {
        let finish: (port: number) => void = () => {};
        const reload = vi
            .fn()
            .mockImplementationOnce(() => new Promise<number>((res) => (finish = res)))
            .mockResolvedValue(1);
        const schedule = createReloader(reload, 250);

        schedule();
        await vi.advanceTimersByTimeAsync(300); // first reload starts, and hangs
        schedule();
        schedule();
        expect(reload).toHaveBeenCalledOnce();

        finish(1);
        await vi.advanceTimersByTimeAsync(300);

        expect(reload).toHaveBeenCalledTimes(2);
    });

    it("reports a failure and stays watching", async () => {
        const reload = vi.fn().mockRejectedValueOnce(new Error("No Obsidian")).mockResolvedValue(1);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const schedule = createReloader(reload, 250);

        schedule();
        await vi.advanceTimersByTimeAsync(300);
        schedule();
        await vi.advanceTimersByTimeAsync(300);

        expect(log.mock.calls.flat().join(" ")).toContain("No Obsidian");
        expect(reload).toHaveBeenCalledTimes(2);
        log.mockRestore();
    });
});

describe("createChangeFilter", () => {
    it("passes a file whose contents were written", () => {
        const mtimes = new Map([["main.js", 100]]);
        const changed = createChangeFilter((path: string) => mtimes.get(path)!);

        expect(changed("main.js")).toBe(true); // first sighting
        mtimes.set("main.js", 200);
        expect(changed("main.js")).toBe(true);
    });

    it("drops an event that left the file as it was", () => {
        // Reloading makes Obsidian read the linked files again, and macOS
        // reports that read as a change, which would reload again, forever.
        const changed = createChangeFilter(() => 100);

        expect(changed("main.js")).toBe(true);
        expect(changed("main.js")).toBe(false);
        expect(changed("main.js")).toBe(false);
    });

    it("keeps a file's history apart from its neighbors", () => {
        const mtimes = new Map([
            ["main.js", 100],
            ["styles.css", 100],
        ]);
        const changed = createChangeFilter((path: string) => mtimes.get(path)!);

        expect(changed("main.js")).toBe(true);
        expect(changed("styles.css")).toBe(true);
        expect(changed("main.js")).toBe(false);
    });

    it("treats a file it cannot stat as unchanged, rather than throwing at the watcher", () => {
        const changed = createChangeFilter(() => {
            throw new Error("ENOENT");
        });

        expect(changed("gone.js")).toBe(false);
    });
});

describe("stepsFor", () => {
    // The vaults are thrown away each time. Filling them again on each run
    // keeps their notes up to date with the script and the date.
    it("builds only when there is no build, and always seeds, links, opens and watches", () => {
        expect(stepsFor({ built: true })).toEqual(["seed", "link", "open", "watch"]);
        expect(stepsFor({ built: false })).toEqual(["build", "seed", "link", "open", "watch"]);
    });
});

describe("optionsFrom", () => {
    it("picks the vault named, not a flag's value", () => {
        expect(optionsFrom(["--position", "900,60", "elsewhere", "--desktop"])).toEqual({
            named: "elsewhere",
            seedArgs: ["elsewhere"],
            openArgs: ["--position", "900,60", "elsewhere", "--desktop"],
        });
    });

    it("hands --test to the seed and the window, and layout flags to the window alone", () => {
        expect(optionsFrom(["--test", "--ipad"])).toEqual({
            named: undefined,
            seedArgs: ["--test"],
            openArgs: ["--test", "--ipad"],
        });
    });
});
