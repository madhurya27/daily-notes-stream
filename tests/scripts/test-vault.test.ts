import { describe, it, expect } from "vitest";
import { DAILY_TEMPLATE, testVault } from "../../scripts/seed-test-vault.mjs";

const vault = testVault({ days: 120 });
const paths = Object.keys(vault);
const note = (path: string) => vault[path] ?? "";

describe("testVault", () => {
    it("writes the filler run, newest on 2026-08-29, and the notes docs/TESTING.md names", () => {
        const daily = paths.filter((path) => /^Notes\/\d{4}-\d{2}-\d{2}\.md$/.test(path));
        expect(daily).toContain("Notes/2026-08-29.md");
        expect(daily).toContain("Notes/2026-08-30.md");
        expect(daily).toContain("Notes/2026-02-01.md");
        expect(daily).toContain("Notes/2026-01-15.md");
        expect(daily.length).toBeGreaterThanOrEqual(120);
    });

    // docs/TESTING.md, "Empty notes".
    describe("empty notes", () => {
        const template = note(`${DAILY_TEMPLATE}.md`);

        it("writes a template with a date placeholder", () => {
            expect(template).toContain("{{date}}");
        });

        it("holds a note made from it and never written in, and a blank one", () => {
            expect(note("Notes/2026-08-27.md")).toBe(template.replace("{{date}}", "2026-08-27"));
            expect(note("Notes/2026-08-23.md")).toBe("");
        });

        it("holds one whose only writing is a property", () => {
            expect(note("Notes/2026-08-25.md")).toBe(
                template.replace("{{date}}", "2026-08-25").replace("mood:", "mood: rested")
            );
        });

        it("holds an empty one another note links to", () => {
            expect(note("Notes/2026-08-21.md")).toBe(template.replace("{{date}}", "2026-08-21"));
            expect(note("Notes/Agenda.md")).toContain("[[2026-08-21]]");
        });
    });

    it("keeps the files that must stay out of the stream", () => {
        expect(paths).toContain("Notes/2026-01-20.png");
        expect(paths).toContain("Elsewhere/2026-01-21.md");
    });

    it("writes the Bases the notes embed", () => {
        for (const base of ["Wide", "Middle", "Narrow", "Resized", "Two"])
            expect(paths).toContain(`Bases/${base}.base`);
    });

    // Grouped by file type, which is wider than a phone in either orientation,
    // so it shows as cards (D-107).
    it("embeds a kanban grouped by file extension in the newest note", () => {
        expect(note("Bases/Kanban.base")).toMatch(/type: kanban[\s\S]*groupBy:\n {6}property: file\.ext/);
        expect(note("Notes/2026-08-30.md")).toContain("![[Kanban.base]]");
    });

    // docs/TESTING.md, "Mobile": a phone draws page 1, and a tap opens the PDF
    // (D-083).
    it("embeds a PDF of several pages and a video wider than a phone in the newest note", () => {
        expect(note("Attachments/Manual.pdf")).toContain("/Count 3");
        expect(note("Notes/2026-08-30.md")).toContain("![[Manual.pdf]]");
        expect(note("Notes/2026-08-30.md")).toMatch(/<iframe [^>]*width="560"/);
    });

    it("gives 2026-02-01 the frontmatter the checklist lists", () => {
        expect(note("Notes/2026-02-01.md")).toMatch(/aliases: Feb 1st Test\nmood: productive/);
    });

    it("resolves every link and embed but [[Someday]], which stays unresolved on purpose", () => {
        const names = new Set(paths.map((path) => path.split("/").pop()!.replace(/\.md$/, "")));
        const targets = Object.values(vault).flatMap((body) =>
            [...body.matchAll(/!?\[\[([^\]|#]+)/g)].map((match) => match[1]!)
        );
        expect(targets.filter((target) => !names.has(target))).toEqual(["Someday"]);
    });

    // One note of each linked-mention case docs/TESTING.md lists, all on the
    // newest note.
    describe("links to the newest note, for its linked mentions", () => {
        const newest = "[[2026-08-29]]";
        const linking = paths.filter((path) => !path.startsWith("Notes/") && note(path).includes(newest));

        it("from several notes, one outside any folder", () => {
            expect(linking.length).toBeGreaterThanOrEqual(3);
            expect(linking.some((path) => !path.includes("/"))).toBe(true);
        });

        it("from a nested list item, a paragraph, a property and a wide table", () => {
            const bodies = linking.map(note).join("\n");
            expect(bodies).toMatch(new RegExp(`^ {4}- .*\\[\\[2026-08-29\\]\\]`, "m"));
            expect(bodies).toMatch(new RegExp(`^\\w[^|\\n-].*\\[\\[2026-08-29\\]\\]`, "m"));
            expect(bodies).toMatch(/^\w+: "\[\[2026-08-29\]\]"$/m);
            expect(bodies).toMatch(/^\|.*\[\[2026-08-29\]\].*\|$/m);
        });

        it("from a note whose own link resolves beside it, not beside the daily note", () => {
            expect(paths).toContain("Projects/Agenda.md");
            expect(paths).toContain("Notes/Agenda.md");
            expect(linking.some((path) => path.startsWith("Projects/") && note(path).includes("[[Agenda]]"))).toBe(
                true
            );
        });
    });
});
