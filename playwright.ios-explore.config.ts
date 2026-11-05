import { defineConfig } from "@playwright/test";
import ios from "./playwright.ios.config";

/**
 * Random real swipes on the device on USB, to find what the regular tests miss
 * (D-216). IOS_DEVICE picks it, as for test:ios. EXPLORE_SEED repeats a run's
 * gestures; EXPLORE_GESTURES sets how many it makes.
 */
export default defineConfig({
    ...ios,
    testDir: "e2e-tests/ios/explore",
    testIgnore: undefined,
    // Forty gestures, each waiting for its glide to end.
    timeout: 900_000,
});
