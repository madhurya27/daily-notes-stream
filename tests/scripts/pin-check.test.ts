import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";
import {
    failureIssueFor,
    findNewReleases,
    latestVersion,
    movePin,
    openPullRequest,
    pullRequestFor,
    releaseHashes,
    unreported,
} from "../../scripts/pin-check.mjs";

const CALENDAR = { id: "calendar", name: "Calendar", repo: "liamcain/obsidian-calendar-plugin", version: "1.5.10" };
const DATAVIEW = { id: "dataview", name: "Dataview", repo: "blacksmithgu/obsidian-dataview", version: "0.5.70" };

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

describe("findNewReleases", () => {
    it("lists each plugin whose repo has another version than its pin", async () => {
        const latest = async (repo: string) => (repo === CALENDAR.repo ? "1.5.11" : DATAVIEW.version);

        expect(await findNewReleases([CALENDAR, DATAVIEW], latest)).toEqual([{ plugin: CALENDAR, latest: "1.5.11" }]);
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
});
