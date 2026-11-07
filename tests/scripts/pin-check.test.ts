import { describe, it, expect, vi } from "vitest";
import { findNewReleases, issueFor, latestVersion, openIssues } from "../../scripts/pin-check.mjs";

const CALENDAR = { name: "Calendar", repo: "liamcain/obsidian-calendar-plugin", version: "1.5.10" };
const DATAVIEW = { name: "Dataview", repo: "blacksmithgu/obsidian-dataview", version: "0.5.70" };

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

describe("issueFor", () => {
    const issue = issueFor({ plugin: CALENDAR, latest: "1.5.11" });

    // The repo's version may also be older than the pin: Dataview's manifest
    // stayed at 0.5.68 after it released 0.5.70.
    it("names the plugin and both versions in its title, whichever is newer", () => {
        expect(issue.title).toBe("Calendar: the directory installs 1.5.11; the e2e tests pin 1.5.10");
    });

    it("says where the pin is and what to run after raising it", () => {
        expect(issue.body).toContain("e2e-tests/pinned-plugin.ts");
        expect(issue.body).toContain("pnpm run test:e2e");
        expect(issue.body).toContain("pnpm run test:ios");
    });

    it("links the release", () => {
        expect(issue.body).toContain("https://github.com/liamcain/obsidian-calendar-plugin/releases/tag/1.5.11");
    });
});

/** A `gh` that knows the issues titled `titles`, and records each call. */
function fakeGh(titles: string[]) {
    return vi.fn((args: string[]) => (args[1] === "list" ? JSON.stringify(titles.map((title) => ({ title }))) : ""));
}

describe("openIssues", () => {
    const release = { plugin: CALENDAR, latest: "1.5.11" };
    const { title, body } = issueFor(release);

    it("opens an issue for a new release", () => {
        const gh = fakeGh([]);

        openIssues([release], gh);

        expect(gh).toHaveBeenCalledWith(["issue", "create", "--title", title, "--body", body]);
    });

    // Closed counts too: a release you decided to skip is not reported again
    // every day.
    it("opens none when an issue, open or closed, has its title", () => {
        const gh = fakeGh([title]);

        openIssues([release], gh);

        expect(gh).toHaveBeenCalledWith([
            "issue",
            "list",
            "--state",
            "all",
            "--search",
            `"${title}" in:title`,
            "--json",
            "title",
        ]);
        expect(gh).toHaveBeenCalledTimes(1);
    });

    // GitHub's search matches words, so a title for another version can come
    // back too.
    it("opens one when the search finds only other titles", () => {
        const gh = fakeGh(["Calendar: the directory installs 1.5.12; the e2e tests pin 1.5.10"]);

        openIssues([release], gh);

        expect(gh).toHaveBeenCalledWith(["issue", "create", "--title", title, "--body", body]);
    });
});
