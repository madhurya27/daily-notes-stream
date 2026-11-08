import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { builtinModules } from "module";
import { dirname, resolve } from "path";
import { parse } from "yaml";

const workflowPath = resolve(__dirname, "../..", ".github/workflows/pinned-plugins.yml");

interface Step {
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
}
interface Workflow {
    on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown };
    permissions?: Record<string, string>;
    jobs: Record<string, { "runs-on": string; steps: Step[] }>;
}

const workflow = existsSync(workflowPath) ? (parse(readFileSync(workflowPath, "utf8")) as Workflow) : null;
const steps = () => Object.values(workflow!.jobs).flatMap((job) => job.steps);
const check = () => steps().find((step) => step.run?.includes("scripts/pin-check.mjs"));

// The e2e tests pin each plugin they install (e2e-tests/pinned-plugin.ts), so
// a new release reaches users before the tests see it.
describe("Pinned plugins workflow", () => {
    it("runs every day, and by hand", () => {
        const crons = (workflow!.on.schedule ?? []).map(({ cron }) => cron);
        expect(crons).toHaveLength(1);
        expect(crons[0]).toMatch(/^\d+ \d+ \* \* \*$/);
        expect(workflow!.on).toHaveProperty("workflow_dispatch");
    });

    it("opens issues for what it finds", () => {
        expect(check()?.run).toContain("--open-issues");
    });

    it("gives gh the token and the repo", () => {
        expect(check()?.env).toEqual({ GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}", GH_REPO: "${{ github.repository }}" });
    });

    it("may write issues and read code, and nothing else", () => {
        expect(workflow!.permissions).toEqual({ contents: "read", issues: "write" });
    });

    it("checks the code out without leaving the token in .git/config", () => {
        const checkout = steps().find((step) => step.uses?.startsWith("actions/checkout@"));
        expect(checkout?.with?.["persist-credentials"]).toBe(false);
    });

    // The script imports the pins from a .ts file, which Node runs without
    // its types from 23.6 on.
    it("runs the Node that CI runs", () => {
        const ci = parse(readFileSync(resolve(__dirname, "../..", ".github/workflows/ci.yml"), "utf8")) as Workflow;
        const nodeOf = (w: Workflow) =>
            Object.values(w.jobs)
                .flatMap((job) => job.steps)
                .find((step) => step.uses?.startsWith("actions/setup-node@"))?.with?.["node-version"];
        expect(nodeOf(workflow!)).toBe(nodeOf(ci));
    });

    // The workflow installs no packages, so the script and every file it
    // imports may use only Node's own modules.
    it("runs a script that imports no package", () => {
        expect(packagesImportedBy(resolve(__dirname, "../..", "scripts/pin-check.mjs"))).toEqual([]);
    });

    it("runs only on Linux, the free runners (D-148)", () => {
        for (const job of Object.values(workflow!.jobs)) expect(job["runs-on"]).toMatch(/^ubuntu-/);
    });

    it("pins every action to a full commit SHA", () => {
        const used = steps().flatMap((step) => (step.uses ? [step.uses] : []));
        expect(used.length).toBeGreaterThan(0);
        for (const uses of used) expect(uses).toMatch(/@[0-9a-f]{40}$/);
    });
});

/** The packages `file` and the repo files it imports load, types aside. */
function packagesImportedBy(file: string, seen = new Set<string>()): string[] {
    if (seen.has(file)) return [];
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const specifiers = [...source.matchAll(/(?:^import (?!type )[^"]*|import\()"([^"]+)"/gm)].flatMap(
        (match) => match[1] ?? []
    );
    return specifiers.flatMap((specifier) => {
        if (specifier.startsWith(".")) return packagesImportedBy(resolve(dirname(file), specifier), seen);
        return builtinModules.includes(specifier.replace(/^node:/, "")) ? [] : [specifier];
    });
}
