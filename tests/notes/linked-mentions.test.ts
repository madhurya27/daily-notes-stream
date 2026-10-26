import { describe, it, expect } from "vitest";
import { TFile } from "obsidian";
import { BacklinkIndex } from "../../src/notes/backlink-index";
import { linkedMentions, mentionsSignature } from "../../src/notes/linked-mentions";
import { asApp } from "../stream-view-fixture";

const DAY = "Notes/2025-01-01.md";

/** A span in a note's text, as the metadata cache records one. */
function at(start: number, end: number) {
    return {
        start: { line: 0, col: 0, offset: start },
        end: { line: 0, col: 0, offset: end },
    };
}

function link(target: string, start: number, end = start + target.length + 4) {
    return { link: target, original: `[[${target}]]`, position: at(start, end) };
}

/**
 * A vault of `caches` by path. A link resolves by file name, as Obsidian's
 * shortest-path links do. The index is built from what the caches link to.
 */
function vault(caches: Record<string, object>, mtimes: Record<string, number> = {}) {
    const files = new Map<string, TFile>();
    for (const path of [DAY, ...Object.keys(caches)]) {
        const file = new TFile(path);
        file.stat = { ctime: 0, mtime: mtimes[path] ?? 0, size: 0 };
        files.set(path, file);
    }
    const byName = (name: string) => [...files.values()].find((file) => file.basename === name) ?? null;
    const app = asApp({
        vault: { getFileByPath: (path: string) => files.get(path) ?? null },
        metadataCache: {
            getFileCache: (file: TFile) => caches[file.path] ?? null,
            getFirstLinkpathDest: (linkpath: string) => byName(linkpath),
        },
    });
    const resolvedLinks = Object.fromEntries(
        Object.entries(caches).map(([path, cache]) => {
            const { links = [], embeds = [], frontmatterLinks = [] } = cache as Record<string, { link: string }[]>;
            const targets = [...links, ...embeds, ...frontmatterLinks]
                .map((ref) => byName(ref.link.split("#")[0]!)?.path)
                .filter((target): target is string => target !== undefined);
            return [path, Object.fromEntries(targets.map((target) => [target, 1]))];
        })
    );
    return { app, index: new BacklinkIndex(() => resolvedLinks), day: files.get(DAY)! };
}

describe("linkedMentions", () => {
    it("finds each note linking here, sorted by path", () => {
        const { app, index, day } = vault({
            "b.md": { links: [link("2025-01-01", 0)] },
            "a.md": { links: [link("2025-01-01", 0)] },
        });

        expect(linkedMentions(app, index, day).map((mention) => mention.source.path)).toEqual(["a.md", "b.md"]);
    });

    it("shows a link in the section around it", () => {
        const { app, index, day } = vault({
            "a.md": { links: [link("2025-01-01", 12)], sections: [{ type: "paragraph", position: at(10, 40) }] },
        });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toEqual([{ start: 10, end: 40 }]);
    });

    it("shows a link in a list in its own item, the innermost, not the whole list", () => {
        const { app, index, day } = vault({
            "a.md": {
                links: [link("2025-01-01", 30)],
                sections: [{ type: "list", position: at(0, 100) }],
                listItems: [
                    { parent: -1, position: at(0, 60) },
                    { parent: 0, position: at(25, 45) },
                    { parent: -1, position: at(61, 100) },
                ],
            },
        });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toEqual([{ start: 25, end: 45 }]);
    });

    it("shows a link at the very end of a list item in that item", () => {
        const { app, index, day } = vault({
            "a.md": {
                links: [link("2025-01-01", 45)],
                sections: [{ type: "list", position: at(0, 100) }],
                listItems: [{ parent: -1, position: at(25, 45) }],
            },
        });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toEqual([{ start: 25, end: 45 }]);
    });

    it("shows a link after every list item in the section around it", () => {
        const { app, index, day } = vault({
            "a.md": {
                links: [link("2025-01-01", 50)],
                sections: [{ type: "list", position: at(0, 100) }],
                listItems: [
                    { parent: -1, position: at(0, 20) },
                    { parent: -1, position: at(25, 45) },
                ],
            },
        });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toEqual([{ start: 0, end: 100 }]);
    });

    it("shows a section holding several links once, in source order", () => {
        const { app, index, day } = vault({
            "a.md": {
                links: [link("2025-01-01", 60), link("2025-01-01", 12), link("2025-01-01", 20)],
                sections: [
                    { type: "paragraph", position: at(10, 40) },
                    { type: "paragraph", position: at(50, 80) },
                ],
            },
        });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toEqual([
            { start: 10, end: 40 },
            { start: 50, end: 80 },
        ]);
    });

    it("counts embeds and links to a heading in the note", () => {
        const { app, index, day } = vault({
            "a.md": {
                embeds: [link("2025-01-01", 0)],
                links: [link("2025-01-01#Morning", 50)],
                sections: [
                    { type: "paragraph", position: at(0, 20) },
                    { type: "paragraph", position: at(50, 80) },
                ],
            },
        });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toHaveLength(2);
    });

    it("falls back to the link itself when no section holds it", () => {
        const { app, index, day } = vault({ "a.md": { links: [link("2025-01-01", 5, 19)] } });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toEqual([{ start: 5, end: 19 }]);
    });

    it("shows a link in a property as the property, once", () => {
        const { app, index, day } = vault({
            "a.md": {
                frontmatterLinks: [
                    { key: "related.0", link: "2025-01-01", original: "[[2025-01-01]]" },
                    { key: "related.1", link: "2025-01-01", original: "[[2025-01-01]]" },
                    { key: "next", link: "2025-01-02", original: "[[2025-01-02]]" },
                ],
            },
        });

        const [mention] = linkedMentions(app, index, day);

        expect(mention!.properties).toEqual(["related: [[2025-01-01]]"]);
        expect(mention!.excerpts).toEqual([]);
    });

    it("leaves out links from the source that point at other notes", () => {
        const { app, index, day } = vault({
            "2025-01-02.md": {},
            "a.md": {
                links: [link("2025-01-02", 50), link("2025-01-01", 0)],
                sections: [
                    { type: "paragraph", position: at(0, 20) },
                    { type: "paragraph", position: at(50, 80) },
                ],
            },
        });

        expect(linkedMentions(app, index, day)[0]!.excerpts).toEqual([{ start: 0, end: 20 }]);
    });

    it("leaves out a note's links to itself", () => {
        const { app, index, day } = vault({ [DAY]: { links: [link("2025-01-01", 0)] } });

        expect(linkedMentions(app, index, day)).toEqual([]);
    });

    // The index and the cache can disagree for a moment while the cache catches
    // up.
    it("leaves out a source that is gone, uncached, or no longer links here", () => {
        const { app, index, day } = vault({ "a.md": { links: [link("2025-01-01", 0)] } });
        Object.assign(app.vault, { getFileByPath: () => null });
        expect(linkedMentions(app, index, day)).toEqual([]);

        const uncached = vault({ "a.md": { links: [link("2025-01-01", 0)] } });
        Object.assign(uncached.app.metadataCache, { getFileCache: () => null });
        expect(linkedMentions(uncached.app, uncached.index, uncached.day)).toEqual([]);

        const moved = vault({ "a.md": { links: [link("2025-01-01", 0)] } });
        Object.assign(moved.app.metadataCache, { getFirstLinkpathDest: () => null });
        expect(linkedMentions(moved.app, moved.index, moved.day)).toEqual([]);
    });
});

describe("mentionsSignature", () => {
    const caches = {
        "a.md": { links: [link("2025-01-01", 0)], sections: [{ type: "paragraph", position: at(0, 20) }] },
    };
    const signature = (mtimes: Record<string, number> = {}, more: Record<string, object> = {}) => {
        const { app, index, day } = vault({ ...caches, ...more }, mtimes);
        return mentionsSignature(linkedMentions(app, index, day));
    };

    it("stays the same while nothing a footer shows changed", () => {
        expect(signature()).toBe(signature());
    });

    it("changes when a source is written", () => {
        expect(signature({ "a.md": 1 })).not.toBe(signature());
    });

    it("changes when a source starts linking here", () => {
        expect(signature({}, { "b.md": { links: [link("2025-01-01", 0)] } })).not.toBe(signature());
    });

    it("changes when a source links here in one more place", () => {
        const more = {
            "a.md": {
                links: [link("2025-01-01", 0), link("2025-01-01", 30)],
                sections: [
                    { type: "paragraph", position: at(0, 20) },
                    { type: "paragraph", position: at(30, 50) },
                ],
            },
        };
        expect(signature({}, more)).not.toBe(signature());
    });

    it("changes when a source links here from a property and one more place", () => {
        const more = {
            "a.md": {
                links: [link("2025-01-01", 0), link("2025-01-01", 30)],
                sections: [
                    { type: "paragraph", position: at(0, 20) },
                    { type: "paragraph", position: at(30, 50) },
                ],
                frontmatterLinks: [{ key: "related", link: "2025-01-01", original: "[[2025-01-01]]" }],
            },
        };
        expect(signature({}, more)).not.toBe(signature());
    });

    // Without a separator, `a.md` changed at 1 followed by `2b.md` would read
    // the same as `a.md` changed at 12 followed by `b.md`.
    it("tells one source's end from the next one's start", () => {
        const mention = (path: string, mtime: number) => {
            const source = new TFile(path);
            source.stat.mtime = mtime;
            return { source, excerpts: [], properties: ["related: [[2025-01-01]]"] };
        };

        expect(mentionsSignature([mention("a.md", 1), mention("2b.md", 0)])).not.toBe(
            mentionsSignature([mention("a.md", 12), mention("b.md", 0)])
        );
    });
});
