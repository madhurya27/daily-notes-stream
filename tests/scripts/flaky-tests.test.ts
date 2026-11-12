import { describe, it, expect } from "vitest";
import { flakyTests, warningFor } from "../../scripts/flaky-tests.mjs";

/** A spec as Playwright's JSON report writes it, run in each of `results`. */
function spec(title: string, line: number, results: [project: string, status: string][]) {
    return {
        title,
        file: "history.spec.ts",
        line,
        tests: results.map(([projectName, status]) => ({ projectName, status })),
    };
}

describe("flakyTests", () => {
    it("names each test that failed before it passed, with its project", () => {
        const report = {
            suites: [
                {
                    specs: [
                        spec("returns to the place", 179, [
                            ["desktop", "expected"],
                            ["mobile", "flaky"],
                        ]),
                    ],
                    suites: [],
                },
            ],
        };

        expect(flakyTests(report)).toEqual(["[mobile] history.spec.ts:179 › returns to the place"]);
    });

    it("finds them inside describe blocks", () => {
        const report = {
            suites: [{ specs: [], suites: [{ specs: [spec("inner", 12, [["desktop", "flaky"]])], suites: [] }] }],
        };

        expect(flakyTests(report)).toEqual(["[desktop] history.spec.ts:12 › inner"]);
    });

    it("leaves out tests that passed, failed or were skipped", () => {
        const report = {
            suites: [
                {
                    specs: [
                        spec("passed", 1, [["desktop", "expected"]]),
                        spec("failed", 2, [["desktop", "unexpected"]]),
                        spec("skipped", 3, [["desktop", "skipped"]]),
                    ],
                },
            ],
        };

        expect(flakyTests(report)).toEqual([]);
    });
});

describe("warningFor", () => {
    // GitHub shows a workflow command's warning on the run and the pull
    // request's checks.
    it("is a GitHub warning that names the test", () => {
        expect(warningFor("[mobile] history.spec.ts:179 › returns")).toBe(
            "::warning title=Flaky e2e test::[mobile] history.spec.ts:179 › returns"
        );
    });
});
