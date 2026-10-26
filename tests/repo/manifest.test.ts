import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../..");
const readJson = (name: string): unknown => JSON.parse(readFileSync(resolve(repoRoot, name), "utf8"));

const manifest = readJson("manifest.json") as Record<string, unknown>;
const versions = readJson("versions.json") as Record<string, string>;
const pkg = readJson("package.json") as Record<string, unknown>;

/**
 * The `owner/repo` this plugin is published from, read from package.json, not
 * from `git remote`. A fork, a downloaded archive and a shallow checkout must
 * all give the same answer, and it is the name the obsidian-releases submission
 * lists.
 */
function repoSlug(): string {
    const url = (pkg.repository as { url?: string } | undefined)?.url ?? "";
    const slug = /github\.com\/([^/]+\/[^/.]+)/.exec(url)?.[1];
    if (!slug) throw new Error(`package.json declares no GitHub repository, found ${JSON.stringify(url)}`);
    return slug;
}

describe("manifest.json — marketplace submission requirements", () => {
    it("points authorUrl at the GitHub account that owns the repository", () => {
        const [owner] = repoSlug().split("/");
        expect(manifest.authorUrl).toBe(`https://github.com/${owner}`);
    });

    it("records this version's minAppVersion in versions.json", () => {
        expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
    });

    it("keeps package.json's version in step with the manifest", () => {
        expect(pkg.version).toBe(manifest.version);
    });

    // Obsidian installs from the release's files, and npm refuses to publish a
    // private package.
    it("marks package.json private, so it never goes to npm", () => {
        expect(pkg.private).toBe(true);
    });
});
