/**
 * Moves the pins of the plugins the e2e tests install
 * (`e2e-tests/pinned-plugin.ts`) to the versions the community directory
 * installs (D-224, D-234). The daily workflow runs it in steps:
 *
 * - `find`: the plugins with another version and no pull request or issue for
 *   it yet, as the step output `releases`.
 * - `move <id> <version>`: rewrites the plugin's pin.
 * - `report <id> <version> <outcome>`: after the e2e tests, opens a pull
 *   request that moves the pin, or an issue with the tests that failed.
 *
 * Run with no step, it prints the plugins with another version.
 */
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { failedTests, newestReport } from "./flaky-tests.mjs";
import { isMain } from "./is-main.mjs";

const PINS_FILE = "e2e-tests/pinned-plugin.ts";

/** A version as Obsidian writes it, with an optional pre-release tag. */
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

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
    const { version } = await response.json();
    // It is written into a .ts file and a branch name.
    if (!VERSION.test(version)) throw new Error(`${repo}: ${JSON.stringify(version)} is not a version`);
    return version;
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

const releaseUrl = ({ plugin, latest }) => `https://github.com/${plugin.repo}/releases/tag/${latest}`;

const branchFor = ({ plugin, latest }) => `pin/${plugin.id}-${latest}`;

/** The pull request that moves the pin to `release`, tested in `runUrl`. */
export function pullRequestFor(release, runUrl) {
    const { plugin, latest } = release;
    return {
        title: `test: pin ${plugin.name} ${latest} in the e2e tests`,
        body: [
            `[${plugin.name} ${latest}](${releaseUrl(release)}) is the version the community directory installs. The e2e tests pin ${plugin.version}.`,
            "",
            `The e2e tests pass on Linux with ${latest}: ${runUrl}`,
            "",
            "Before merging, check out this branch and run `pnpm run test:ios`.",
        ].join("\n"),
    };
}

/** The issue that reports `failures` of the e2e tests on `release`. */
export function failureIssueFor(release, failures, runUrl) {
    const { plugin, latest } = release;
    const failed =
        failures.length > 0
            ? ["These tests failed:", "", ...failures.map((test) => `- ${test}`)]
            : ["The run failed before any test did."];
    return {
        title: `${plugin.name} ${latest} fails the e2e tests`,
        body: [
            `[${plugin.name} ${latest}](${releaseUrl(release)}) is the version the community directory installs. The e2e tests pin ${plugin.version}, and fail with ${latest}.`,
            "",
            ...failed,
            "",
            `The run, with its traces: ${runUrl}`,
        ].join("\n"),
    };
}

/**
 * `releases` without a pull request or an issue, open or closed. `gh` runs the
 * GitHub CLI with its arguments and returns what it printed.
 */
export function unreported(releases, gh) {
    return releases.filter((release) => {
        const { title } = failureIssueFor(release, [], "");
        const issues = JSON.parse(
            gh(["issue", "list", "--state", "all", "--search", `"${title}" in:title`, "--json", "title"])
        );
        if (issues.some((issue) => issue.title === title)) return false;
        const branch = branchFor(release);
        const pulls = JSON.parse(gh(["pr", "list", "--state", "all", "--head", branch, "--json", "headRefName"]));
        return pulls.length === 0;
    });
}

/**
 * The SHA-256 of each file Obsidian installs from `repo`'s release `version`.
 * The stylesheet is left out if the release has none.
 *
 * @param {string} repo `owner/name` on GitHub.
 * @param {string} version
 * @param {(url: string) => Promise<Response>} [get]
 * @returns {Promise<Record<string, string>>}
 */
export async function releaseHashes(repo, version, get = fetch) {
    const hashes = {};
    for (const name of ["main.js", "manifest.json", "styles.css"]) {
        const response = await get(`https://github.com/${repo}/releases/download/${version}/${name}`);
        if (response.status === 404 && name === "styles.css") continue;
        if (!response.ok) throw new Error(`${repo} ${version} ${name}: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        hashes[name] = createHash("sha256").update(bytes).digest("hex");
    }
    return hashes;
}

/**
 * `source`, the pins file, with plugin `id` pinned to `version`.
 *
 * @param {string} source
 * @param {string} id
 * @param {string} version
 * @param {Record<string, string>} sha256 Each file's SHA-256.
 * @returns {string}
 */
export function movePin(source, id, version, sha256) {
    const start = source.indexOf(`    id: "${id}",\n`);
    if (start === -1) throw new Error(`${PINS_FILE}: no pin has the id ${id}`);
    const end = source.indexOf("\n};", start);
    const files = Object.entries(sha256).map(([name, hash]) => `        "${name}": "${hash}",\n`);
    const pin = source
        .slice(start, end)
        .replace(/version: "[^"]*"/, `version: "${version}"`)
        .replace(/sha256: \{\n[^}]*\}/, `sha256: {\n${files.join("")}    }`);
    return source.slice(0, start) + pin + source.slice(end);
}

/**
 * Commits the moved pin on the release's branch, pushes it to `pushUrl`, and
 * opens the pull request. `git` and `gh` run their CLIs with the arguments.
 */
export function openPullRequest(release, runUrl, { git, gh, pushUrl }) {
    const branch = branchFor(release);
    const { title, body } = pullRequestFor(release, runUrl);
    git(["switch", "-c", branch]);
    git(["add", PINS_FILE]);
    git([
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        title,
    ]);
    git(["push", pushUrl, branch]);
    gh(["pr", "create", "--head", branch, "--title", title, "--body", body]);
    // A pull request opened with the workflow's token starts no workflow.
    gh(["workflow", "run", "ci.yml", "--ref", branch]);
}

const cli = (command) => (args) => execFileSync(command, args, { encoding: "utf8" });

const { GH_TOKEN, GITHUB_OUTPUT, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL } = process.env;
const runUrl = () => `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;

/** Rewrites the pins file with plugin `id` pinned to `version`. */
async function writePin(pins, id, version) {
    const { repo } = pins.find((pin) => pin.id === id);
    const hashes = await releaseHashes(repo, version);
    writeFileSync(PINS_FILE, movePin(readFileSync(PINS_FILE, "utf8"), id, version, hashes));
}

/** Each step, given the pins and the step's arguments. */
const STEPS = {
    async find(pins) {
        const releases = unreported(await findNewReleases(pins), cli("gh"));
        const found = JSON.stringify(releases.map(({ plugin, latest }) => ({ id: plugin.id, version: latest })));
        console.log(found);
        appendFileSync(GITHUB_OUTPUT, `releases=${found}\n`);
    },

    move: writePin,

    /**
     * `outcome` is the e2e step's: `success`, `failure` or `skipped`. The
     * pin is moved again here, because the tests ran the plugin's code where
     * it could change the files.
     */
    async report(pins, id, version, outcome) {
        const release = { plugin: pins.find((pin) => pin.id === id), latest: version };
        if (outcome === "success") {
            await writePin(pins, id, version);
            const pushUrl = `https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`;
            openPullRequest(release, runUrl(), { git: cli("git"), gh: cli("gh"), pushUrl });
            return;
        }
        const report = newestReport();
        const { title, body } = failureIssueFor(release, report ? failedTests(report) : [], runUrl());
        cli("gh")(["issue", "create", "--title", title, "--body", body]);
    },

    async print(pins) {
        const releases = await findNewReleases(pins);
        for (const { plugin, latest } of releases)
            console.log(`${plugin.name}: the directory installs ${latest}; the e2e tests pin ${plugin.version}`);
        if (releases.length === 0) console.log("Every pinned plugin is at its repo's version.");
    },
};

async function main() {
    const { PINNED_PLUGINS } = await import("../e2e-tests/pinned-plugin.ts");
    const [step = "print", ...args] = process.argv.slice(2);
    await STEPS[step](PINNED_PLUGINS, ...args);
}

if (isMain(import.meta.url)) await main();
