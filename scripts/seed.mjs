/**
 * Fills the demo vault, or the test vault with --test. Each takes its own
 * options, listed in its script.
 *
 *   node scripts/seed.mjs [--test] [vault] [options]
 */
import { main as seedDemo } from "./demo-vault.mjs";
import { main as seedTest } from "./seed-test-vault.mjs";

if (process.argv.includes("--test")) seedTest();
else seedDemo();
