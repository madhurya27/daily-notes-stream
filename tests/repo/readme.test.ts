import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import DailyNotesStreamPlugin from "../../src/main";
import { DailyNotesStreamSettingTab, DEFAULT_SETTINGS } from "../../src/settings";
import { __setMockNotes } from "../mocks/daily-notes";
import type { PluginManifest } from "../mocks/obsidian";
import { asApp, fake } from "../stream-view-fixture";

const repoRoot = resolve(__dirname, "../..");
const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "manifest.json"), "utf8")) as { name: string };

/** Loads the plugin just enough to read the commands it registers. */
async function loadedPlugin() {
    __setMockNotes([]);
    const app = {
        vault: { on: vi.fn().mockReturnValue({}) },
        workspace: {
            on: vi.fn().mockReturnValue({}),
            getLeavesOfType: vi.fn().mockReturnValue([]),
            onLayoutReady: vi.fn(),
        },
        metadataCache: { on: vi.fn().mockReturnValue({}) },
        loadLocalStorage: vi.fn().mockReturnValue(null),
    };
    const plugin = new DailyNotesStreamPlugin(asApp(app), { id: "daily-notes-stream" } as PluginManifest);
    await plugin.onload();
    return plugin;
}

/** Every local image the README links to, however the link is written. */
function referencedImages(): string[] {
    const markdown = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]!);
    const html = [...readme.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]!);
    return [...markdown, ...html].filter((src) => !src.startsWith("http"));
}

describe("README", () => {
    it("shows the plugin rather than only describing it", () => {
        // A screenshot is the first thing a marketplace reader looks for.
        expect(referencedImages().length).toBeGreaterThan(0);
    });

    it("points every image at a file that exists", () => {
        for (const src of referencedImages()) {
            expect(existsSync(resolve(repoRoot, src)), `${src} is missing`).toBe(true);
        }
    });

    it("titles the plugin exactly as the manifest names it", () => {
        expect(readme.split("\n")[0]).toBe(`# ${manifest.name}`);
    });

    it("quotes each command the way the palette displays it", async () => {
        const plugin = await loadedPlugin();
        const commands = (plugin as unknown as { commands: { name: string }[] }).commands;
        expect(commands.length).toBeGreaterThan(0);
        for (const { name } of commands) {
            expect(readme).toContain(`${manifest.name}: ${name}`);
        }
    });

    // Obsidian's developer policies: any network use must be stated, naming the
    // service and why.
    it("names, in its privacy answer, each service the plugin loads from", () => {
        const services: Record<string, string> = { "i.ytimg.com": "YouTube" };
        const privacy = readme.split("\n- **").find((item) => item.startsWith("Is it private?**")) ?? "";
        const hosts = readdirSync(resolve(repoRoot, "src"), { recursive: true, encoding: "utf8" })
            .filter((file) => file.endsWith(".ts"))
            .flatMap((file) => [
                // Matches lazily up to the end of the statement, because
                // Stryker wraps the URL in its own code.
                ...readFileSync(resolve(repoRoot, "src", file), "utf8").matchAll(/\.src = [^;]*?`https:\/\/([^/]+)/g),
            ])
            .map((match) => match[1]!);

        expect(hosts).toContain("i.ytimg.com");
        for (const host of hosts) {
            expect(services[host], `${host}: name its service here`).toBeDefined();
            expect(privacy.replace(/\s+/g, " "), host).toContain(`from ${services[host]} (\`${host}\`)`);
        }
    });

    // Settings hidden under Use went unnoticed. A section of their own can be
    // found by skimming the headings.
    it("lists every setting, and its default, in a section of its own", () => {
        const section = readme.split(/^## /m).find((part) => part.startsWith("Settings\n")) ?? "";
        type Row = { name?: string; heading?: string; items?: Row[]; control?: { key: keyof typeof DEFAULT_SETTINGS } };
        const rows = (
            new DailyNotesStreamSettingTab(
                asApp({}),
                fake<DailyNotesStreamPlugin>({ settings: DEFAULT_SETTINGS })
            ).getSettingDefinitions() as Row[]
        ).flatMap((row) => [row, ...(row.items ?? [])]);

        expect(rows.length).toBeGreaterThan(0);
        for (const { name, heading, control } of rows) {
            const line = section.split("\n").find((text) => text.includes(`**${name ?? heading}**`));
            expect(line, `${name ?? heading} is not under ## Settings`).toBeDefined();
            if (control) expect(line).toContain(DEFAULT_SETTINGS[control.key] ? "(on by default)" : "(off by default)");
        }
    });
});
