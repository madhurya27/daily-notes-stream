import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import type { Step } from "../repo/workflow";
import {
    allPins,
    failureIssueFor,
    findNewReleases,
    latestObsidianVersion,
    latestVersion,
    movedSource,
    moveObsidianPin,
    movePin,
    obsidianHash,
    obsidianPin,
    openPullRequest,
    pullRequestFor,
    releaseHashes,
    unreported,
} from "../../scripts/pin-check.mjs";

const CALENDAR = {
    id: "calendar",
    name: "Calendar",
    repo: "liamcain/obsidian-calendar-plugin",
    version: "1.5.10",
    kind: "plugin" as const,
};
const DATAVIEW = {
    id: "dataview",
    name: "Dataview",
    repo: "blacksmithgu/obsidian-dataview",
    version: "0.5.70",
    kind: "plugin" as const,
};
const OBSIDIAN = {
    id: "obsidian",
    name: "Obsidian",
    repo: "obsidianmd/obsidian-releases",
    version: "1.15.0",
    kind: "app" as const,
};

const SETUP_FILE = ".github/actions/e2e-setup/action.yml";
const SETUP = readFileSync(resolve(__dirname, "../..", SETUP_FILE), "utf8");

/** The step of the e2e setup action `source` that installs Obsidian. */
function installStep(source: string): Step {
    const { runs } = parse(source) as { runs: { steps: (Step & { name: string })[] } };
    return runs.steps.find((step) => step.name === "Install Obsidian")!;
}

/** A fetch that answers `body` with `status`, and records the URL. */
function fakeFetch(body: unknown, status = 200) {
    return vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
}

// The directory installs the version in the manifest on the repo's default
// branch, not its newest GitHub release, which may be a beta.
describe("latestVersion", () => {
    it("reads the version from the manifest on the repo's default branch", async () => {
        const fetch = fakeFetch({ version: "1.5.11" });

        expect(await latestVersion(CALENDAR.repo, fetch)).toBe("1.5.11");
        expect(fetch).toHaveBeenCalledWith(
            "https://raw.githubusercontent.com/liamcain/obsidian-calendar-plugin/HEAD/manifest.json"
        );
    });

    // The version is written into a .ts file, and into a branch name.
    it("fails when the version is not a version number", async () => {
        await expect(latestVersion(CALENDAR.repo, fakeFetch({ version: '1.0", x: "' }))).rejects.toThrow(
            'liamcain/obsidian-calendar-plugin: "1.0\\", x: \\"" is not a version'
        );
    });

    it("fails, naming the repo, when the manifest cannot be read", async () => {
        await expect(latestVersion(CALENDAR.repo, fakeFetch({}, 404))).rejects.toThrow(
            "liamcain/obsidian-calendar-plugin: 404"
        );
    });
});

// Obsidian's updater installs the version in this file, which also leaves out
// the early-access releases.
describe("latestObsidianVersion", () => {
    it("reads the version Obsidian's updater installs", async () => {
        const fetch = fakeFetch({ latestVersion: "1.15.1", beta: { latestVersion: "1.16.0" } });

        expect(await latestObsidianVersion(OBSIDIAN.repo, fetch)).toBe("1.15.1");
        expect(fetch).toHaveBeenCalledWith(
            "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/desktop-releases.json"
        );
    });

    // The version is written into a workflow, and into a branch name.
    it("fails when the version is not a version number", async () => {
        await expect(latestObsidianVersion(OBSIDIAN.repo, fakeFetch({ latestVersion: "1.15; rm" }))).rejects.toThrow(
            'obsidianmd/obsidian-releases: "1.15; rm" is not a version'
        );
    });

    it("fails, naming the repo, when the file cannot be read", async () => {
        await expect(latestObsidianVersion(OBSIDIAN.repo, fakeFetch({}, 500))).rejects.toThrow(
            "obsidianmd/obsidian-releases: 500"
        );
    });
});

describe("obsidianPin", () => {
    it("is the Obsidian that the e2e setup installs", () => {
        const version = installStep(SETUP).env?.["OBSIDIAN_VERSION"];

        expect(obsidianPin(SETUP)).toEqual({ ...OBSIDIAN, version });
    });

    it("fails when the setup pins no version", () => {
        expect(() => obsidianPin("runs: {}")).toThrow(`${SETUP_FILE}: no OBSIDIAN_VERSION`);
    });
});

describe("allPins", () => {
    it("is each plugin, then Obsidian", () => {
        const { kind: _, ...plugin } = CALENDAR;

        expect(allPins([plugin], SETUP)).toEqual([CALENDAR, obsidianPin(SETUP)]);
    });
});

describe("findNewReleases", () => {
    /**
     * A fetch that answers each repo with `versions[repo]`, in the file its
     * kind of pin reads.
     */
    const fetchVersions = (versions: Record<string, string>) =>
        vi.fn(async (url: string) => {
            const repo = Object.keys(versions).find((r) => url.includes(`/${r}/`))!;
            const body = url.endsWith("desktop-releases.json")
                ? { latestVersion: versions[repo] }
                : { version: versions[repo] };
            return new Response(JSON.stringify(body));
        });

    it("lists each pin whose repo has another version than its pin", async () => {
        const fetch = fetchVersions({ [CALENDAR.repo]: "1.5.11", [DATAVIEW.repo]: DATAVIEW.version });

        expect(await findNewReleases([CALENDAR, DATAVIEW], fetch)).toEqual([{ plugin: CALENDAR, latest: "1.5.11" }]);
    });

    it("reads Obsidian's version where its updater does", async () => {
        const fetch = fetchVersions({ [OBSIDIAN.repo]: "1.15.1" });

        expect(await findNewReleases([OBSIDIAN], fetch)).toEqual([{ plugin: OBSIDIAN, latest: "1.15.1" }]);
    });
});

const release = { plugin: CALENDAR, latest: "1.5.11" };
const RUN = "https://github.com/me/repo/actions/runs/1";

describe("pullRequestFor", () => {
    const pr = pullRequestFor(release, RUN);

    it("is titled as a commit that moves the pin", () => {
        expect(pr.title).toBe("test: pin Calendar 1.5.11 in the e2e tests");
    });

    it("links the release and the run the tests passed in", () => {
        expect(pr.body).toContain("https://github.com/liamcain/obsidian-calendar-plugin/releases/tag/1.5.11");
        expect(pr.body).toContain(RUN);
    });

    // The workflow runs only the Linux e2e tests. The device tests install
    // pinned plugins too.
    it("asks for the device tests before merging", () => {
        expect(pr.body).toContain("pnpm run test:ios");
    });

    describe("for Obsidian", () => {
        const obsidian = pullRequestFor({ plugin: OBSIDIAN, latest: "1.15.1" }, RUN);

        it("is titled as a commit that moves the pin", () => {
            expect(obsidian.title).toBe("test: pin Obsidian 1.15.1 in the e2e tests");
        });

        // Its release tags start with a v.
        it("links the release, which its updater installs", () => {
            expect(obsidian.body).toContain(
                "[Obsidian 1.15.1](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.15.1) is the version Obsidian's updater installs."
            );
        });

        // The devices run the Obsidian they have installed, not the pin.
        it("asks for no device tests", () => {
            expect(obsidian.body).not.toContain("test:ios");
        });
    });
});

describe("failureIssueFor", () => {
    it("names the plugin and the version that fails", () => {
        expect(failureIssueFor(release, [], RUN).title).toBe("Calendar 1.5.11 fails the e2e tests");
    });

    it("lists each failed test, links the release and the run, and names the pin", () => {
        const { body } = failureIssueFor(release, ["[mobile] calendar.spec.ts:20 › opens"], RUN);

        expect(body).toContain("- [mobile] calendar.spec.ts:20 › opens");
        expect(body).toContain("https://github.com/liamcain/obsidian-calendar-plugin/releases/tag/1.5.11");
        expect(body).toContain(RUN);
        expect(body).toContain("1.5.10");
    });

    it("links Obsidian's release, which its updater installs", () => {
        const { body } = failureIssueFor({ plugin: OBSIDIAN, latest: "1.15.1" }, [], RUN);

        expect(body).toContain(
            "[Obsidian 1.15.1](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.15.1) is the version Obsidian's updater installs."
        );
    });

    // The pin could not move, or the build failed: no test ran.
    it("says so when no test failed", () => {
        expect(failureIssueFor(release, [], RUN).body).toContain("failed before any test did");
    });
});

/**
 * A `gh` that knows the issues titled `titles` and the pull requests from
 * `branches`, and records each call.
 */
function fakeGh(titles: string[] = [], branches: string[] = []) {
    return vi.fn((args: string[]) => {
        if (args[0] === "issue" && args[1] === "list") return JSON.stringify(titles.map((title) => ({ title })));
        if (args[0] === "pr" && args[1] === "list") {
            const head = args[args.indexOf("--head") + 1];
            return JSON.stringify(
                branches.filter((branch) => branch === head).map((branch) => ({ headRefName: branch }))
            );
        }
        return "";
    });
}

// Closed counts too: a version you decided to skip is not tested again every
// day.
describe("unreported", () => {
    const issueTitle = failureIssueFor(release, [], RUN).title;

    it("keeps a version with no pull request and no issue", () => {
        expect(unreported([release], fakeGh())).toEqual([release]);
    });

    it("drops a version whose issue exists, open or closed", () => {
        const gh = fakeGh([issueTitle]);

        expect(unreported([release], gh)).toEqual([]);
        expect(gh).toHaveBeenCalledWith([
            "issue",
            "list",
            "--state",
            "all",
            "--search",
            `"${issueTitle}" in:title`,
            "--json",
            "title",
        ]);
    });

    // GitHub's search matches words, so a title for another version can come
    // back too.
    it("keeps a version when the search finds only other titles", () => {
        expect(unreported([release], fakeGh(["Calendar 1.5.12 fails the e2e tests"]))).toEqual([release]);
    });

    it("drops a version whose pull request exists, open, merged or closed", () => {
        const gh = fakeGh([], ["pin/calendar-1.5.11"]);

        expect(unreported([release], gh)).toEqual([]);
        expect(gh).toHaveBeenCalledWith([
            "pr",
            "list",
            "--state",
            "all",
            "--head",
            "pin/calendar-1.5.11",
            "--json",
            "headRefName",
        ]);
    });
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A fetch that serves `files` from a release, and 404 for anything else. */
function fakeRelease(files: Record<string, string>) {
    return vi.fn(async (url: string) => {
        const name = url.split("/").at(-1)!;
        return name in files ? new Response(files[name]) : new Response("", { status: 404 });
    });
}

describe("releaseHashes", () => {
    it("hashes each file the release downloads from GitHub", async () => {
        const fetch = fakeRelease({ "main.js": "code", "manifest.json": "{}", "styles.css": "a{}" });

        expect(await releaseHashes(CALENDAR.repo, "1.5.11", fetch)).toEqual({
            "main.js": sha("code"),
            "manifest.json": sha("{}"),
            "styles.css": sha("a{}"),
        });
        expect(fetch).toHaveBeenCalledWith(
            "https://github.com/liamcain/obsidian-calendar-plugin/releases/download/1.5.11/main.js"
        );
    });

    // Obsidian installs a plugin without a stylesheet; Calendar has none.
    it("leaves out a stylesheet the release does not have", async () => {
        const hashes = await releaseHashes(
            CALENDAR.repo,
            "1.5.11",
            fakeRelease({ "main.js": "", "manifest.json": "" })
        );

        expect(Object.keys(hashes)).toEqual(["main.js", "manifest.json"]);
    });

    it("fails, naming the file, when the release lacks one it needs", async () => {
        await expect(releaseHashes(CALENDAR.repo, "1.5.11", fakeRelease({ "manifest.json": "" }))).rejects.toThrow(
            "main.js: 404"
        );
    });
});

const PINS = `export const CALENDAR: PinnedPlugin = {
    id: "calendar",
    name: "Calendar",
    version: "1.5.10",
    sha256: {
        "main.js": "aaa",
        "manifest.json": "bbb",
    },
};

export const TEMPLATER: PinnedPlugin = {
    id: "templater-obsidian",
    version: "2.27.0",
    sha256: {
        "main.js": "ccc",
    },
};
`;

describe("movePin", () => {
    it("sets the plugin's version and hashes, and leaves the other pins alone", () => {
        const moved = movePin(PINS, "calendar", "1.5.11", { "main.js": "ddd", "styles.css": "eee" });

        expect(moved).toBe(
            PINS.replace('version: "1.5.10"', 'version: "1.5.11"').replace(
                '"main.js": "aaa",\n        "manifest.json": "bbb",',
                '"main.js": "ddd",\n        "styles.css": "eee",'
            )
        );
    });

    it("fails when no pin has the id", () => {
        expect(() => movePin(PINS, "dataview", "0.5.70", {})).toThrow("no pin has the id dataview");
    });
});

describe("obsidianHash", () => {
    it("hashes the Linux build the e2e setup downloads", async () => {
        const fetch = fakeRelease({ "obsidian-1.15.1.tar.gz": "app" });

        expect(await obsidianHash(OBSIDIAN.repo, "1.15.1", fetch)).toBe(sha("app"));
        expect(fetch).toHaveBeenCalledWith(
            "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.15.1/obsidian-1.15.1.tar.gz"
        );
    });

    it("fails, naming the file, when the release lacks it", async () => {
        await expect(obsidianHash(OBSIDIAN.repo, "1.15.1", fakeRelease({}))).rejects.toThrow(
            "obsidian-1.15.1.tar.gz: 404"
        );
    });
});

describe("moveObsidianPin", () => {
    const HASH = "f".repeat(64);
    it("sets the version and the hash the setup checks", () => {
        const moved = installStep(moveObsidianPin(SETUP, "9.9.9", HASH));

        expect(moved.env?.["OBSIDIAN_VERSION"]).toBe("9.9.9");
        expect(moved.run).toContain(`echo "${HASH}  $RUNNER_TEMP/obsidian.tar.gz" | sha256sum -c`);
    });

    it("leaves the rest of the setup alone", () => {
        const lines = (source: string) => source.split("\n");
        const changed = lines(moveObsidianPin(SETUP, "9.9.9", HASH)).filter((line, i) => line !== lines(SETUP)[i]);

        expect(changed).toHaveLength(2);
    });

    it("fails when the setup has no version or no hash to move", () => {
        expect(() => moveObsidianPin("OBSIDIAN_VERSION: 1.0.0\n", "9.9.9", HASH)).toThrow(
            `${SETUP_FILE}: no SHA-256 to move`
        );
        expect(() => moveObsidianPin("", "9.9.9", HASH)).toThrow(`${SETUP_FILE}: no OBSIDIAN_VERSION to move`);
    });
});

describe("movedSource", () => {
    it("moves a plugin's pin to its release's hashes", async () => {
        const fetch = fakeRelease({ "main.js": "code", "manifest.json": "{}" });

        expect(await movedSource(PINS, CALENDAR, "1.5.11", fetch)).toBe(
            movePin(PINS, "calendar", "1.5.11", { "main.js": sha("code"), "manifest.json": sha("{}") })
        );
    });

    it("moves Obsidian's pin to its Linux build's hash", async () => {
        const fetch = fakeRelease({ "obsidian-1.15.1.tar.gz": "app" });

        expect(await movedSource(SETUP, OBSIDIAN, "1.15.1", fetch)).toBe(moveObsidianPin(SETUP, "1.15.1", sha("app")));
    });
});

describe("openPullRequest", () => {
    const pr = pullRequestFor(release, RUN);

    it("commits the moved pin on its own branch, pushes it, and opens the pull request", () => {
        const git = vi.fn((_args: string[]) => "");
        const gh = fakeGh();

        openPullRequest(release, RUN, { git, gh, pushUrl: "https://token@github.com/me/repo.git" });

        expect(git.mock.calls.map(([args]) => args)).toEqual([
            ["switch", "-c", "pin/calendar-1.5.11"],
            ["add", "e2e-tests/pinned-plugin.ts"],
            [
                "-c",
                "user.name=github-actions[bot]",
                "-c",
                "user.email=41898282+github-actions[bot]@users.noreply.github.com",
                "commit",
                "-m",
                pr.title,
            ],
            ["push", "https://token@github.com/me/repo.git", "pin/calendar-1.5.11"],
        ]);
        expect(gh).toHaveBeenCalledWith([
            "pr",
            "create",
            "--head",
            "pin/calendar-1.5.11",
            "--title",
            pr.title,
            "--body",
            pr.body,
        ]);
    });

    // A pull request a workflow opens starts no workflow, except one it starts
    // by hand.
    it("then runs CI on the branch, so the pull request shows its checks", () => {
        const gh = fakeGh();

        openPullRequest(release, RUN, { git: () => "", gh, pushUrl: "" });

        expect(gh.mock.calls.at(-1)?.[0]).toEqual(["workflow", "run", "ci.yml", "--ref", "pin/calendar-1.5.11"]);
    });

    it("commits Obsidian's pin, in the e2e setup", () => {
        const git = vi.fn((_args: string[]) => "");

        openPullRequest({ plugin: OBSIDIAN, latest: "1.15.1" }, RUN, { git, gh: fakeGh(), pushUrl: "" });

        expect(git).toHaveBeenCalledWith(["switch", "-c", "pin/obsidian-1.15.1"]);
        expect(git).toHaveBeenCalledWith(["add", SETUP_FILE]);
    });
});
