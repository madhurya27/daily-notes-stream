import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";

const repoRoot = resolve(__dirname, "../..");
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

interface Step {
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
}
interface Workflow {
    permissions?: Record<string, string>;
    on: { push?: { tags?: string[] } };
    jobs: Record<string, { steps: Step[] }>;
}

const workflow = existsSync(workflowPath) ? (parse(readFileSync(workflowPath, "utf8")) as Workflow) : null;
const steps = () => Object.values(workflow!.jobs).flatMap((job) => job.steps);
const script = () =>
    steps()
        .map((step) => step.run ?? "")
        .join("\n");

/** The three files Obsidian's reviewers download from a release. */
const RELEASE_ASSETS = ["main.js", "manifest.json", "styles.css"];

describe("release workflow", () => {
    it("runs on a pushed tag", () => {
        expect(workflow!.on.push?.tags).toBeTruthy();
    });

    it("installs from the lockfile so a release matches the pinned dependencies", () => {
        expect(script()).toContain("pnpm install --frozen-lockfile");
    });

    it("builds the plugin rather than releasing whatever is committed", () => {
        expect(script()).toContain("pnpm run build");
    });

    it("attaches each release asset individually", () => {
        for (const asset of RELEASE_ASSETS) expect(script()).toContain(asset);
    });

    // Lets anyone check, with `gh attestation verify`, that a release file was
    // built here from this repo. The directory's review recommends it.
    it("attests each release asset's provenance before it releases them", () => {
        const all = steps();
        const attest = all.findIndex((step) => step.uses?.startsWith("actions/attest-build-provenance@"));
        const release = all.findIndex((step) => step.run?.includes("gh release create"));
        expect(attest, "no attestation step").toBeGreaterThanOrEqual(0);
        expect(attest).toBeLessThan(release);
        const subjects = String(all[attest]!.with?.["subject-path"]).split(/\s+/);
        expect(subjects).toEqual(expect.arrayContaining(RELEASE_ASSETS));
        expect(workflow!.permissions).toMatchObject({ "id-token": "write", attestations: "write" });
    });

    it("refuses a tag that does not match the manifest version", () => {
        // Obsidian's review bot only catches a tag that does not match after
        // submission. The release itself should catch it first.
        expect(script()).toMatch(/manifest\.json/);
        expect(script()).toMatch(/exit 1/);
    });

    it("checks the code out without leaving the write-scoped token in .git/config", () => {
        // `pnpm install` and the build run dependency code in the same job.
        const checkout = steps().find((step) => step.uses?.startsWith("actions/checkout@"));
        expect(checkout?.with?.["persist-credentials"]).toBe(false);
    });

    it("runs the quality gates before it builds a release", () => {
        const commands = steps().map((step) => step.run ?? "");
        const buildIndex = commands.findIndex((run) => run.includes("pnpm run build"));
        for (const gate of ["pnpm run format:check", "pnpm run lint", "pnpm run test:coverage"]) {
            const gateIndex = commands.findIndex((run) => run.includes(gate));
            expect(gateIndex, `${gate} is missing`).toBeGreaterThanOrEqual(0);
            expect(gateIndex, `${gate} runs after the build`).toBeLessThan(buildIndex);
        }
    });

    it("pins the pnpm version the setup action resolves", () => {
        // pnpm/action-setup gets no version here, so it reads
        // package.json#packageManager. Without that, the job fails at once.
        const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
            packageManager?: string;
        };
        expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    });

    it("runs a Node version the pinned pnpm can start under", () => {
        // setup-node's `cache: pnpm` runs pnpm before anything else, so a Node
        // older than pnpm's minimum fails the job at setup. pnpm 11 needs Node
        // 22.13 or later, and jsdom and vitest do not support 21 and 23.
        const PNPM_NODE_FLOOR: Record<string, number> = { "11": 22 };
        const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
            packageManager: string;
        };
        const pnpmMajor = /^pnpm@(\d+)\./.exec(pkg.packageManager)?.[1];
        const floor = PNPM_NODE_FLOOR[pnpmMajor!];
        expect(floor, `no known Node floor for pnpm ${pnpmMajor}`).toBeDefined();

        const setupNode = steps().find((step) => step.uses?.startsWith("actions/setup-node@"));
        expect(Number(setupNode?.with?.["node-version"])).toBeGreaterThanOrEqual(floor!);
    });

    it("pins every action to a full commit SHA", () => {
        const used = steps()
            .map((step) => step.uses)
            .filter((uses): uses is string => Boolean(uses));
        expect(used.length).toBeGreaterThan(0);
        for (const uses of used) expect(uses).toMatch(/@[0-9a-f]{40}$/);
    });
});
