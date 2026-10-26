/**
 * Installs the build into any vault, without touching its notes and settings.
 * `pnpm run install:vault <vault>` builds first, with a name like
 * `build:device`.
 *
 *   node scripts/install-build.mjs <vault>
 */
import { resolve } from "path";
import { isMain } from "./reload-plugin.mjs";
import { installBuild } from "./vaults.mjs";

/**
 * @param {readonly string[]} args
 * @param {string} [repo] where the build is; the repo by default
 */
export function main(args = process.argv.slice(2), repo) {
    if (args[0] === undefined) throw new Error("Usage: pnpm run install:vault <vault>");
    const vault = resolve(args[0]);
    installBuild(vault, repo);
    console.log(`Installed the plugin into ${vault}`);
}

if (isMain(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
