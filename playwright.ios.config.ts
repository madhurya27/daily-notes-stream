import { defineConfig } from "@playwright/test";

/**
 * When this run started, to the second, in a form that is safe in a file name.
 */
const runStamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

/**
 * Obsidian on an iPhone connected by USB (ADR 0016). One phone, so one worker.
 */
export default defineConfig({
    testDir: "e2e-tests/ios",
    globalSetup: "./e2e-tests/ios/global-setup.ts",
    workers: 1,
    // A run stops at its first failure. --max-failures=0 keeps going, for a
    // full report.
    maxFailures: 1,
    // A session starts WebDriverAgent on the phone, and flicks wait until their
    // scrolling ends.
    timeout: 180_000,
    expect: { timeout: 15_000 },
    outputDir: "test-results/ios-artifacts",
    reporter: [["list"], ["json", { outputFile: `test-results/ios-runs/${runStamp}.json` }]],
});
