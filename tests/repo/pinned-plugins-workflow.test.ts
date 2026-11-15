import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { builtinModules } from "module";
import { dirname, resolve } from "path";
import { readWorkflow, stepsOf, type Job } from "./workflow";

const workflow = readWorkflow("pinned-plugins.yml");
const jobs = () => Object.values(workflow.jobs);
const steps = () => jobs().flatMap(stepsOf);
const job = (name: string) => workflow.jobs[name]!;
const stepRunning = (j: Job, command: string) => stepsOf(j).find((step) => step.run?.includes(command));

// The e2e tests pin each plugin they install (e2e-tests/pinned-plugin.ts), so
// a new release reaches users before the tests see it (D-224, D-234).
describe("Pinned plugins workflow", () => {
    // Weekly, so a plugin that releases often opens one pull request a week at
    // most (D-234).
    it("runs once a week, and by hand", () => {
        const crons = (workflow.on.schedule ?? []).map(({ cron }) => cron);
        expect(crons).toHaveLength(1);
        expect(crons[0]).toMatch(/^\d+ \d+ \* \* [0-6]$/);
        expect(workflow.on).toHaveProperty("workflow_dispatch");
    });

    it("gives the token nothing unless a job asks for it", () => {
        expect(workflow.permissions).toEqual({});
    });

    describe("the find job", () => {
        it("lists the new versions, reading only", () => {
            const find = stepRunning(job("find"), "scripts/pin-check.mjs find");
            expect(find?.env).toEqual({ GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}", GH_REPO: "${{ github.repository }}" });
            expect(job("find").outputs?.["releases"]).toBe(`\${{ steps.${find?.id}.outputs.releases }}`);
            expect(job("find").permissions).toEqual({ contents: "read", issues: "read", "pull-requests": "read" });
        });
    });

    describe("the test job", () => {
        const test = () => job("test");

        it("tests each new version on its own, and only when there is one", () => {
            expect(test().strategy?.matrix?.["release"]).toBe("${{ fromJSON(needs.find.outputs.releases) }}");
            expect(test().strategy?.["fail-fast"]).toBe(false);
            expect(test().if).toBe("needs.find.outputs.releases != '[]'");
        });

        // The tests run the plugin's code.
        it("may only read", () => {
            expect(test().permissions).toEqual({ contents: "read" });
        });

        it("sets up the e2e tests as CI does", () => {
            const ci = readWorkflow("ci.yml").jobs["e2e"]!;
            const local = (j: Job) => j.steps.flatMap((step) => (step.uses?.startsWith("./") ? [step.uses] : []));
            expect(local(test())).toEqual(local(ci));
            expect(local(test())).toHaveLength(1);
        });

        it("moves the pin, then runs every e2e test, failures and all", () => {
            const all = stepsOf(test());
            const move = all.findIndex((step) => step.run?.includes("scripts/pin-check.mjs move"));
            const e2e = all.findIndex((step) => /xvfb-run .*pnpm run test:e2e --max-failures=0/.test(step.run ?? ""));
            expect(move).toBeGreaterThan(-1);
            expect(e2e).toBeGreaterThan(move);
            expect(all[e2e]?.id).toBe("e2e");
            expect(all[e2e]?.["continue-on-error"]).toBe(true);
        });

        it("keeps the outcome and the report, even when a step fails", () => {
            const keep = stepsOf(test()).find((step) => step.uses?.startsWith("actions/upload-artifact@"));
            expect(keep?.if).toBe("always()");
            const outcome = stepsOf(test()).find((step) => step.env?.["OUTCOME"] === "${{ steps.e2e.outcome }}");
            expect(outcome?.if).toBe("always()");
        });
    });

    describe("the report job", () => {
        const report = () => job("report");

        it("reports each version tested, whatever the tests found", () => {
            expect(report().needs).toEqual(["find", "test"]);
            expect(report().strategy?.matrix?.["release"]).toBe("${{ fromJSON(needs.find.outputs.releases) }}");
            expect(report().if).toBe("!cancelled() && needs.find.outputs.releases != '[]'");
        });

        it("opens the pull request or the issue", () => {
            const run = stepRunning(report(), "scripts/pin-check.mjs report");
            expect(run?.env).toMatchObject({
                GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
                GH_REPO: "${{ github.repository }}",
            });
        });

        // It pushes a branch, opens a pull request or an issue, and starts CI
        // on the branch.
        it("is the only job that may write, and runs no plugin", () => {
            expect(report().permissions).toEqual({
                contents: "write",
                "pull-requests": "write",
                issues: "write",
                actions: "write",
            });
            expect(stepsOf(report()).some((step) => step.uses?.startsWith("./"))).toBe(false);
        });
    });

    // A version comes from the plugin's manifest, which anyone may write.
    it("passes the matrix to commands only through the environment", () => {
        for (const step of steps()) expect(step.run ?? "").not.toContain("${{");
    });

    it("checks the code out without leaving the token in .git/config", () => {
        const checkouts = steps().filter((step) => step.uses?.startsWith("actions/checkout@"));
        expect(checkouts).toHaveLength(jobs().length);
        for (const checkout of checkouts) expect(checkout.with?.["persist-credentials"]).toBe(false);
    });

    // The script imports the pins from a .ts file, which Node runs without
    // its types from 23.6 on.
    it("runs the Node that CI runs", () => {
        const nodeOf = (j: Job) =>
            stepsOf(j).find((step) => step.uses?.startsWith("actions/setup-node@"))?.with?.["node-version"];
        const ci = nodeOf(readWorkflow("ci.yml").jobs["check"]!);
        for (const j of jobs()) expect(nodeOf(j)).toBe(ci);
    });

    // The find and report jobs install no packages, so the script and every
    // file it imports may use only Node's own modules.
    it("runs a script that imports no package", () => {
        expect(packagesImportedBy(resolve(__dirname, "../..", "scripts/pin-check.mjs"))).toEqual([]);
    });

    it("runs only on Linux, the free runners (D-148)", () => {
        for (const j of jobs()) expect(j["runs-on"]).toMatch(/^ubuntu-/);
    });

    it("pins every action to a full commit SHA", () => {
        const used = steps().flatMap((step) => (step.uses && !step.uses.startsWith("./") ? [step.uses] : []));
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
