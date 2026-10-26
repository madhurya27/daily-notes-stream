import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../..");
const read = (name: string): string => readFileSync(resolve(repoRoot, name), "utf8");

const listing = read("docs/LISTING.md");
const manifest = JSON.parse(read("manifest.json")) as { description: string };
const pkg = JSON.parse(read("package.json")) as { description: string };

/**
 * The paragraph under `## <heading>` in docs/LISTING.md, joined into one line.
 */
function section(heading: string): string {
    const body = listing.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";
    return body.trim().replace(/\s*\n\s*/g, " ");
}

describe("docs/LISTING.md — the plugin directory's descriptions", () => {
    it("keeps the short description within the listing's 200 characters", () => {
        expect(section("Short description")).not.toBe("");
        expect(section("Short description").length).toBeLessThanOrEqual(200);
    });

    it("keeps the long description within the listing's 1000 characters", () => {
        expect(section("Long description")).not.toBe("");
        expect(section("Long description").length).toBeLessThanOrEqual(1000);
    });

    it("gives the manifest the short description", () => {
        expect(manifest.description).toBe(section("Short description"));
    });

    it("gives package.json the short description", () => {
        expect(pkg.description).toBe(section("Short description"));
    });
});
