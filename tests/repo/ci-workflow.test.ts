import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";

const workflowPath = resolve(__dirname, "../..", ".github/workflows/ci.yml");

interface Step {
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
}
interface Workflow {
    on: { push?: { branches?: string[] }; pull_request?: unknown };
    permissions?: Record<string, string>;
    jobs: Record<string, { "runs-on": string; steps: Step[] }>;
}

const workflow = existsSync(workflowPath) ? (parse(readFileSync(workflowPath, "utf8")) as Workflow) : null;
const steps = () => Object.values(workflow!.jobs).flatMap((job) => job.steps);
const commands = () => steps().map((step) => step.run ?? "");

describe("CI workflow", () => {
    it("runs on every push to main and every pull request", () => {
        expect(workflow!.on.push?.branches).toContain("main");
        expect(workflow!.on).toHaveProperty("pull_request");
    });

    it("runs only on Linux, the free runners (D-148)", () => {
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

    it("gives the token read access only", () => {
        // Pull requests run their own code, so nothing in the job may write.
        expect(workflow!.permissions).toEqual({ contents: "read" });
    });

    it("checks the code out without leaving the token in .git/config", () => {
        const checkout = steps().find((step) => step.uses?.startsWith("actions/checkout@"));
        expect(checkout?.with?.["persist-credentials"]).toBe(false);
    });

    it("pins every action to a full commit SHA", () => {
        const used = steps().flatMap((step) => (step.uses ? [step.uses] : []));
        expect(used.length).toBeGreaterThan(0);
        for (const uses of used) expect(uses).toMatch(/@[0-9a-f]{40}$/);
    });
});
