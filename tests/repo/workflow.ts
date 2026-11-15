import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";

const repoRoot = resolve(__dirname, "../..");

export interface Step {
    id?: string;
    if?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    "continue-on-error"?: boolean;
}
export interface Job {
    "runs-on": string;
    needs?: string | string[];
    if?: string;
    env?: Record<string, string>;
    permissions?: Record<string, string>;
    outputs?: Record<string, string>;
    strategy?: { "fail-fast"?: boolean; matrix?: Record<string, unknown> };
    steps: Step[];
}
export interface Workflow {
    on: {
        push?: { branches?: string[] };
        pull_request?: unknown;
        schedule?: { cron: string }[];
        workflow_dispatch?: unknown;
    };
    permissions?: Record<string, string>;
    jobs: Record<string, Job>;
}

/** `.github/workflows/<name>`, parsed. */
export function readWorkflow(name: string): Workflow {
    return parse(readFileSync(resolve(repoRoot, ".github/workflows", name), "utf8")) as Workflow;
}

/**
 * The job's steps, with each action in this repo replaced by its own steps, as
 * the runner runs them.
 */
export function stepsOf(job: Job): Step[] {
    return job.steps.flatMap((step) => {
        if (!step.uses?.startsWith("./")) return [step];
        const action = parse(readFileSync(resolve(repoRoot, step.uses, "action.yml"), "utf8")) as {
            runs: { steps: Step[] };
        };
        return [step, ...action.runs.steps];
    });
}
