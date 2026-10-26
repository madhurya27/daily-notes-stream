import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(repoRoot, file), "utf8");

describe("build configuration", () => {
    it('keeps "type": "module" even though the bundle is CommonJS', () => {
        // The two are unrelated. esbuild's format is an output setting for
        // Obsidian, while this field tells Node, and so Playwright's TypeScript
        // loader, how to read this repo's own source files.
        // e2e-tests/obsidian.ts uses import.meta.url, which cannot be parsed
        // without it.
        const pkg = JSON.parse(read("package.json")) as { type?: string };
        expect(read("esbuild.config.mjs")).toContain('format: "cjs"');
        expect(pkg.type).toBe("module");
        expect(read("e2e-tests/obsidian.ts")).toContain("import.meta.url");
    });

    // Release builds run without BUILD_LABEL, so they have an empty label and
    // show no notice.
    it("bakes BUILD_LABEL in from the environment, empty when unset", () => {
        expect(read("esbuild.config.mjs")).toContain('BUILD_LABEL: JSON.stringify(process.env.BUILD_LABEL ?? "")');
    });

    it("names a phone build by its code, in words", () => {
        const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
        expect(pkg.scripts["build:device"]).toContain('BUILD_LABEL="$(node scripts/build-name.mjs)"');
    });
});
