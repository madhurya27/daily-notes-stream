import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";

const repoRoot = resolve(__dirname, "../..");
const CONFIG = resolve(repoRoot, ".github/dependabot.yml");

interface Update {
    "package-ecosystem": string;
    directory?: string;
    directories?: string[];
    schedule: { interval: string };
    allow?: { "dependency-name": string }[];
    "commit-message"?: { prefix: string };
}

const updates = (): Update[] => (parse(readFileSync(CONFIG, "utf8")) as { updates: Update[] }).updates;
const ecosystem = (name: string) => updates().find((update) => update["package-ecosystem"] === name);

// Dependabot watches the versions the pin check does not (D-240).
describe("Dependabot", () => {
    it("is set up", () => {
        expect(existsSync(CONFIG)).toBe(true);
    });

    it("looks once a week, as the pin check does", () => {
        for (const update of updates()) expect(update.schedule.interval).toBe("weekly");
    });

    // The workflows, and each action in this repo, pin actions by commit.
    it("moves the actions in every workflow and every action in this repo", () => {
        const actions = readdirSync(resolve(repoRoot, ".github/actions")).map((dir) => `/.github/actions/${dir}`);

        expect(ecosystem("github-actions")?.directories).toEqual(["/", ...actions]);
    });

    // Only the API's types: the other packages are tools, moved by hand.
    it("moves only the obsidian package", () => {
        expect(ecosystem("npm")?.directory).toBe("/");
        expect(ecosystem("npm")?.allow).toEqual([{ "dependency-name": "obsidian" }]);
    });

    it("writes conventional commit subjects", () => {
        expect(ecosystem("github-actions")?.["commit-message"]?.prefix).toBe("ci");
        expect(ecosystem("npm")?.["commit-message"]?.prefix).toBe("build");
    });

    it("watches nothing else", () => {
        expect(updates().map((update) => update["package-ecosystem"])).toEqual(["github-actions", "npm"]);
    });
});
