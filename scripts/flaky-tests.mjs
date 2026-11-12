/**
 * Finds the e2e tests that failed and then passed on a retry, in the newest
 * Playwright JSON report in `test-results/runs/`. Run directly, it prints a
 * GitHub warning for each. In a workflow, it also sets the step's output
 * `found` to whether there were any, so their traces can be kept.
 */
import { appendFileSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { isMain } from "./is-main.mjs";

/** Each flaky test in `report`, as `[project] file:line › title`. */
export function flakyTests(report) {
    const found = [];
    const visit = (suite) => {
        for (const spec of suite.specs ?? [])
            for (const test of spec.tests)
                if (test.status === "flaky")
                    found.push(`[${test.projectName}] ${spec.file}:${spec.line} › ${spec.title}`);
        for (const inner of suite.suites ?? []) visit(inner);
    };
    for (const suite of report.suites) visit(suite);
    return found;
}

/** The workflow command that shows `test` as a warning. */
export function warningFor(test) {
    return `::warning title=Flaky e2e test::${test}`;
}

function main() {
    const runs = "test-results/runs";
    // Named by the time the run started, so the last name is the newest.
    const newest = readdirSync(runs)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .at(-1);
    const flaky = newest ? flakyTests(JSON.parse(readFileSync(join(runs, newest), "utf8"))) : [];
    for (const test of flaky) console.log(warningFor(test));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `found=${flaky.length > 0}\n`);
}

if (isMain(import.meta.url)) main();
