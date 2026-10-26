import { describe, it, expect, beforeEach, vi } from "vitest";
import { LinkChanges } from "../../src/notes/link-changes";

type ResolvedLinks = Record<string, Record<string, number>>;

describe("LinkChanges", () => {
    let links: ResolvedLinks;
    let folder: string;
    let changes: LinkChanges;
    let heard: string[][];

    beforeEach(() => {
        links = {};
        folder = "Notes";
        changes = new LinkChanges(
            () => links,
            () => folder
        );
        heard = [];
        changes.subscribe((paths) => heard.push([...paths].sort()));
    });

    /**
     * `source` now links to `targets`, and the cache says it has resolved it.
     */
    function resolve(source: string, ...targets: string[]) {
        links[source] = Object.fromEntries(targets.map((target) => [target, 1]));
        changes.onResolve(source);
    }

    it("tells, once the cache has resolved, which daily notes gained a link", () => {
        resolve("Meeting.md", "Notes/2026-03-15.md", "Notes/2026-03-16.md");
        expect(heard).toEqual([]);

        changes.onResolved();

        expect(heard).toEqual([["Notes/2026-03-15.md", "Notes/2026-03-16.md"]]);
    });

    it("tells which lost one", () => {
        resolve("Meeting.md", "Notes/2026-03-15.md", "Notes/2026-03-16.md");
        changes.onResolved();

        resolve("Meeting.md", "Notes/2026-03-16.md");
        changes.onResolved();

        expect(heard[1]).toEqual(["Notes/2026-03-15.md"]);
    });

    it("tells nothing when a note resolves to the links it had", () => {
        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();

        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();

        expect(heard).toHaveLength(1);
    });

    it("tells nothing when a note that lost its links resolves to none again", () => {
        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();
        resolve("Meeting.md");
        changes.onResolved();

        resolve("Meeting.md");
        changes.onResolved();

        expect(heard).toHaveLength(2);
    });

    it("tells a batch of resolves as one, each target once", () => {
        resolve("Meeting.md", "Notes/2026-03-15.md");
        resolve("Plan.md", "Notes/2026-03-15.md", "Notes/2026-03-16.md");

        changes.onResolved();

        expect(heard).toEqual([["Notes/2026-03-15.md", "Notes/2026-03-16.md"]]);
    });

    it("ignores links outside the daily-notes folder, and a note's links to itself", () => {
        resolve("Notes/2026-03-15.md", "Notes/2026-03-15.md", "Reading list.md", "Notesy/2026-03-16.md");

        changes.onResolved();

        expect(heard).toEqual([]);
    });

    it("with no daily-notes folder, follows links to every note", () => {
        folder = "";
        resolve("Meeting.md", "2026-03-15.md", "Projects/Plan.md");

        changes.onResolved();

        expect(heard).toEqual([["2026-03-15.md", "Projects/Plan.md"]]);
    });

    it("tells the targets of a deleted note", () => {
        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();

        changes.onDelete("Meeting.md");
        changes.onResolved();

        expect(heard[1]).toEqual(["Notes/2026-03-15.md"]);
    });

    it("carries a note's links across its rename, telling nothing", () => {
        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();

        changes.onRename("Meeting.md", "Standup.md");
        delete links["Meeting.md"];
        resolve("Standup.md", "Notes/2026-03-15.md");
        changes.onResolved();

        expect(heard).toHaveLength(1);
    });

    // A note created again at the same path starts with no links, so each link
    // it gains is new.
    it.each([
        ["deleted", (c: LinkChanges) => c.onDelete("Meeting.md")],
        ["renamed away", (c: LinkChanges) => c.onRename("Meeting.md", "Standup.md")],
    ])("forgets the links of a note %s", (_case, leave) => {
        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();
        leave(changes);
        changes.onResolved();
        const told = heard.length;

        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();

        expect(heard.slice(told)).toEqual([["Notes/2026-03-15.md"]]);
    });

    it("ignores the delete or rename of a note with no links followed", () => {
        changes.onDelete("Meeting.md");
        changes.onRename("Plan.md", "Plans.md");
        changes.onResolved();

        expect(heard).toEqual([]);
    });

    it("stops telling a listener that unsubscribed", () => {
        const listener = vi.fn();
        const unsubscribe = changes.subscribe(listener);
        unsubscribe();

        resolve("Meeting.md", "Notes/2026-03-15.md");
        changes.onResolved();

        expect(listener).not.toHaveBeenCalled();
    });

    it("tells nothing for a note the cache holds no links for", () => {
        changes.onResolve("Nowhere.md");
        changes.onResolved();

        expect(heard).toEqual([]);
    });
});
