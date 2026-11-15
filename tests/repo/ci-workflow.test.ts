import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";

const workflowPath = resolve(__dirname, "../..", ".github/workflows/ci.yml");

interface Step {
    id?: string;
    if?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
}
interface Workflow {
    on: { push?: { branches?: string[] }; pull_request?: unknown };
    permissions?: Record<string, string>;
    jobs: Record<string, { "runs-on": string; env?: Record<string, string>; steps: Step[] }>;
}

const workflow = existsSync(workflowPath) ? (parse(readFileSync(workflowPath, "utf8")) as Workflow) : null;
const steps = () => Object.values(workflow!.jobs).flatMap((job) => job.steps);
const commands = () => steps().map((step) => step.run ?? "");

describe("CI workflow", () => {
    it("runs on every push to main and every pull request", () => {
        expect(workflow!.on.push?.branches).toContain("main");
        expect(workflow!.on).toHaveProperty("pull_request");
    });

    it("runs only on Linux, the free runners (D-148, D-227)", () => {
        for (const job of Object.values(workflow!.jobs)) expect(job["runs-on"]).toMatch(/^ubuntu-/);
    });

    it("runs every gate that needs no Obsidian, from the lockfile", () => {
        const gates = [
            "pnpm install --frozen-lockfile",
            "pnpm run format:check",
            "pnpm run lint",
            "pnpm run typecheck:e2e",
            "pnpm run test:coverage",
            "pnpm run build",
        ];
        for (const gate of gates) expect(commands(), gate).toContainEqual(expect.stringContaining(gate));
    });

    describe("the e2e job (D-227)", () => {
        const job = () => workflow!.jobs["e2e"]!;
        const run = () => job().steps.map((step) => step.run ?? "");

        it("runs the e2e tests in a virtual display", () => {
            expect(run()).toContainEqual(expect.stringMatching(/xvfb-run .*pnpm run test:e2e/));
        });

        it("starts Obsidian from the download, as a run on the Mac does", () => {
            expect(job().env?.["OBSIDIAN_PATH"]).toBeTruthy();
            // Watching lays the page out at the window's size, not the tests'.
            expect(job().env).not.toHaveProperty("E2E_SHOW_WINDOW");
        });

        it("checks Obsidian's download against a pinned SHA-256", () => {
            expect(run()).toContainEqual(expect.stringMatching(/[0-9a-f]{64} .*\|\s*sha256sum -c/));
        });

        // A test may retry where it fails now and then (docs/TODO.md). Each
        // retry shows on the pull request, so it is not passed over.
        it("warns of each test that passed only on a retry", () => {
            const warn = job().steps.find((step) => step.run?.includes("scripts/flaky-tests.mjs"));
            expect(warn?.id).toBe("flaky");
        });

        it("keeps the traces of a run with a failed or flaky test", () => {
            const keep = job().steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
            expect(keep?.if).toBe("failure() || steps.flaky.outputs.found == 'true'");
        });

        it("lets Obsidian keep its sandbox on", () => {
            // Ubuntu blocks the user namespaces that Chromium's sandbox needs.
            expect(run()).toContainEqual(
                expect.stringContaining("sysctl -w kernel.apparmor_restrict_unprivileged_userns=0")
            );
            expect(run().join("\n")).not.toContain("--no-sandbox");
        });
    });

    it("gives the token read access only", () => {
        // Pull requests run their own code, so nothing in the job may write.
        expect(workflow!.permissions).toEqual({ contents: "read" });
    });

    it("checks the code out without leaving the token in .git/config", () => {
        const checkout = steps().find((step) => step.uses?.startsWith("actions/checkout@"));
        expect(checkout?.with?.["persist-credentials"]).toBe(false);
    });

    it("runs the Node that @types/node describes", () => {
        // Tests type-check against @types/node, so its major must be the Node
        // that runs them.
        const pkg = JSON.parse(readFileSync(resolve(__dirname, "../..", "package.json"), "utf8")) as {
            devDependencies: Record<string, string>;
        };
        const typesMajor = /(\d+)\./.exec(pkg.devDependencies["@types/node"]!)?.[1];
        const setupNode = steps().find((step) => step.uses?.startsWith("actions/setup-node@"));
        expect(String(setupNode?.with?.["node-version"])).toBe(typesMajor);
    });

    it("pins every action to a full commit SHA", () => {
        const used = steps().flatMap((step) => (step.uses ? [step.uses] : []));
        expect(used.length).toBeGreaterThan(0);
        for (const uses of used) expect(uses).toMatch(/@[0-9a-f]{40}$/);
    });
});
