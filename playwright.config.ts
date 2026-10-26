import { defineConfig } from "@playwright/test";
import type { MobileLayoutOptions } from "./e2e-tests/obsidian";

/**
 * When this run started, to the second, in a form that is safe in a file name.
 */
const runStamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

export default defineConfig<MobileLayoutOptions>({
    testDir: "e2e-tests",
    // A phone, not Obsidian on this Mac. See playwright.ios.config.ts.
    testIgnore: "ios/**",
    globalSetup: "./e2e-tests/global-setup.ts",
    // One Obsidian copy and vault for each worker. More workers would not get
    // enough CPU.
    workers: 4,
    // A run stops at its first failure. --max-failures=0 keeps going, for a
    // full report.
    maxFailures: 1,
    fullyParallel: true,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    // Playwright empties outputDir at the start of every run. Each run's report
    // is kept next to it, to find the cause of a failure afterwards.
    outputDir: "test-results/artifacts",
    reporter: [["list"], ["json", { outputFile: `test-results/runs/${runStamp}.json` }]],
    use: { trace: "retain-on-failure" },
    // Every test runs twice. Obsidian's mobile stylesheet and phone layout are
    // different enough that a rule can be right in one and wrong in the other.
    // Each project has its own copy of Obsidian, so neither affects the other.
    projects: [
        { name: "desktop", use: { mobileLayout: false } },
        { name: "mobile", use: { mobileLayout: true } },
    ],
});
