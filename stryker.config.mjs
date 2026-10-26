// @ts-check
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
    testRunner: "vitest",
    // Named here, because with pnpm, Stryker does not find it by itself.
    plugins: ["@stryker-mutator/vitest-runner"],
    mutate: ["src/**/*.ts"],
    coverageAnalysis: "perTest",
    // With bail, vitest 4 sometimes reports that no test ran for a mutant that
    // makes a test fail at once, and Stryker counts it as surviving: about 3 of
    // 133 in a file.
    disableBail: true,
    reporters: ["clear-text", "html", "progress"],
    // Only the table, because listing every survivor on each run hides it. The
    // HTML report has them.
    clearTextReporter: { reportMutants: false, reportTests: false },
    htmlReporter: { fileName: "reports/mutation/report.html" },
    tempDirName: ".dev/stryker-tmp",
    // A worker uses more than one core, so 30% of the cores leaves about half
    // the machine free.
    concurrency: "30%",
    // Only runs again the mutants whose code changed since the last run.
    incremental: true,
    // A static mutant runs every test again. There are few of them, and they
    // are slow.
    ignoreStatic: true,
    // Only what the unit tests import, because the vaults in .dev/ have
    // thousands of files.
    ignorePatterns: ["/.dev", "/docs/plans", "/e2e-tests", "/coverage", "/test-results"],
};
