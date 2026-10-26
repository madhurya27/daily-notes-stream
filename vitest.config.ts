import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        // e2e-tests/ belongs to Playwright, and vitest would try to run its
        // tests.
        include: ["tests/**/*.test.ts"],
        environment: "jsdom",
        setupFiles: ["tests/setup.ts"],
        // A run stops at its first failure. --bail=0 keeps going. Stryker sets
        // its own value (D-141).
        bail: 1,
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
        },
    },
    resolve: {
        alias: {
            obsidian: resolve(__dirname, "tests/mocks/obsidian.ts"),
        },
    },
});
