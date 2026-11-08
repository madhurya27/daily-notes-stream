/**
 * Finds the plugins the e2e tests pin (`e2e-tests/pinned-plugin.ts`) whose
 * repo has another version. Run directly, it prints them. With `--open-issues`,
 * it also opens an issue for each, through `gh`, unless one has its title.
 */
import { execFileSync } from "child_process";
import { isMain } from "./is-main.mjs";

/**
 * The version in the manifest on `repo`'s default branch, which is what the
 * community directory installs.
 *
 * @param {string} repo `owner/name` on GitHub.
 * @param {(url: string) => Promise<Response>} [get]
 */
export async function latestVersion(repo, get = fetch) {
    const response = await get(`https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`);
    if (!response.ok) throw new Error(`${repo}: ${response.status} reading its manifest.json`);
    return (await response.json()).version;
}

/** Each of `pins` whose repo has another version, with that version. */
export async function findNewReleases(pins, latest = latestVersion) {
    const found = [];
    for (const plugin of pins) {
        const version = await latest(plugin.repo);
        if (version !== plugin.version) found.push({ plugin, latest: version });
    }
    return found;
}

/** The issue that reports `release`. */
export function issueFor({ plugin, latest }) {
    return {
        title: `${plugin.name}: the directory installs ${latest}; the e2e tests pin ${plugin.version}`,
        body: [
            `[${plugin.name} ${latest}](https://github.com/${plugin.repo}/releases/tag/${latest}) is the version the community directory installs.`,
            "",
            `On a branch, move its pin to that version in \`e2e-tests/pinned-plugin.ts\`, with each file's SHA-256, then run \`pnpm run test:e2e\` and \`pnpm run test:ios\`.`,
        ].join("\n"),
    };
}

/**
 * Opens an issue for each of `releases` unless one, open or closed, has its
 * title. `gh` runs the GitHub CLI with its arguments and returns what it
 * printed.
 */
export function openIssues(releases, gh) {
    for (const release of releases) {
        const { title, body } = issueFor(release);
        const found = JSON.parse(
            gh(["issue", "list", "--state", "all", "--search", `"${title}" in:title`, "--json", "title"])
        );
        if (found.some((issue) => issue.title === title)) continue;
        gh(["issue", "create", "--title", title, "--body", body]);
    }
}

async function main() {
    const { PINNED_PLUGINS } = await import("../e2e-tests/pinned-plugin.ts");
    const releases = await findNewReleases(PINNED_PLUGINS);
    for (const release of releases) console.log(issueFor(release).title);
    if (releases.length === 0) console.log("Every pinned plugin is at its repo's version.");
    if (process.argv.includes("--open-issues"))
        openIssues(releases, (args) => execFileSync("gh", args, { encoding: "utf8" }));
}

if (isMain(import.meta.url)) await main();
