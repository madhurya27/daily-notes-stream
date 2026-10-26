import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { DAILY_TEMPLATE, demoVault, writeVault } from "../../scripts/demo-vault.mjs";

const UNTIL = new Date(Date.UTC(2026, 8, 25)); // a Friday
const vault = demoVault({ until: UNTIL, days: 90 });
const paths = Object.keys(vault);
const dailyPaths = paths.filter((path) => /^Journal\/\d{4}-\d{2}-\d{2}\.md$/.test(path));
const daily = (date: string) => vault[`Journal/${date}.md`] ?? "";
const template = vault[`${DAILY_TEMPLATE}.md`];
const unwritten = dailyPaths.filter((path) => vault[path] === template);
const written = dailyPaths.filter((path) => vault[path] !== template);

describe("demoVault", () => {
    it("writes one daily note per day, ending on the given date", () => {
        expect(dailyPaths).toHaveLength(90);
        expect(dailyPaths).toContain("Journal/2026-09-25.md");
        expect(dailyPaths).toContain("Journal/2026-06-28.md");
        expect(dailyPaths).not.toContain("Journal/2026-09-26.md");
    });

    it("gives a date the same note whatever the run ends on", () => {
        const later = demoVault({ until: new Date(Date.UTC(2026, 9, 3)), days: 90 });
        expect(later["Journal/2026-09-10.md"]).toBe(daily("2026-09-10"));
    });

    it("varies from day to day", () => {
        const bodies = new Set(written.map((path) => vault[path]));
        expect(bodies.size).toBe(written.length);
    });

    // Days with nothing written are what "Hide empty notes" leaves out (ADR
    // 0011).
    describe("unwritten days", () => {
        it("writes the daily-notes template", () => {
            expect(template).toMatch(/^---\ntags:\n {2}- daily\n/);
        });

        it("leaves a few days holding only the template, never the newest", () => {
            expect(unwritten.length).toBeGreaterThanOrEqual(3);
            expect(unwritten.length).toBeLessThanOrEqual(dailyPaths.length / 8);
            expect(unwritten).not.toContain("Journal/2026-09-25.md");
        });

        it("links one from another note, so it shows", () => {
            const others = paths.filter((path) => !dailyPaths.includes(path)).map((path) => vault[path]!);
            const linked = unwritten.filter((path) => others.some((body) => body.includes(`[[${path.slice(8, -3)}]]`)));
            expect(linked).toHaveLength(1);
        });
    });

    // Several notes fit on one screen, and a reader scrolls through months, so
    // a line seen twice looks like filler.
    describe("repetition", () => {
        const dates = dailyPaths.map((path) => path.slice("Journal/".length, -".md".length)).sort();
        // Sentences, not task lines, table rows or properties: real journals do
        // repeat chores.
        const prose = (date: string) =>
            new Set(
                daily(date)
                    .split("\n")
                    .filter((line) => line.length > 40 && !/^(- \[|\||\w+:)/.test(line))
            );

        it("repeats no sentence within three days", () => {
            const close = dates.flatMap((date, index) =>
                dates
                    .slice(index + 1, index + 4)
                    .flatMap((later) => [...prose(date)].filter((line) => prose(later).has(line)))
            );
            expect(close).toEqual([]);
        });

        it("puts no sentence in more than a tenth of the notes", () => {
            const counts = new Map<string, number>();
            for (const date of dates) for (const line of prose(date)) counts.set(line, (counts.get(line) ?? 0) + 1);
            const frequent = [...counts].filter(([, count]) => count > dates.length / 10);
            expect(frequent).toEqual([]);
        });

        it("tells a dozen pieces of news once each", () => {
            const work = dates.flatMap((date) =>
                [...daily(date).matchAll(/^- (?!\[)(.+)$/gm)].map((match) => match[1]!)
            );
            const once = work.filter((line) => work.indexOf(line) === work.lastIndexOf(line));
            expect(once.length).toBeGreaterThanOrEqual(12);
        });
    });

    it("resolves every link and embed to a file in the vault", () => {
        const names = new Set(paths.map((path) => path.split("/").pop()!.replace(/\.md$/, "")));
        const targets = Object.values(vault).flatMap((body) =>
            [...body.matchAll(/!?\[\[([^\]|#]+)/g)].map((match) => match[1]!)
        );
        expect(targets.length).toBeGreaterThan(0);
        expect(targets.filter((target) => !names.has(target))).toEqual([]);
    });

    it("reviews the week on Sundays, with the reading list as a Base", () => {
        expect(daily("2026-09-20")).toContain("## Week in review");
        expect(daily("2026-09-20")).toContain("![[Reading.base]]");
        expect(vault["Reading.base"]).toContain('file.inFolder("Books")');
    });

    it("gives the Base books with the properties it lists", () => {
        const books = paths.filter((path) => path.startsWith("Books/"));
        expect(books.length).toBeGreaterThanOrEqual(4);
        for (const book of books) expect(vault[book]).toMatch(/author: .+\nstatus: .+\nrating: /);
    });

    it("shows off headings, tasks, callouts and a table somewhere in the run", () => {
        const all = dailyPaths.map((path) => vault[path]).join("\n");
        expect(all).toMatch(/^### /m);
        expect(all).toMatch(/^- \[x\] /m);
        expect(all).toMatch(/^- \[ \] /m);
        expect(all).toMatch(/^> \[!\w+\]/m);
        expect(all).toMatch(/^\| .+ \|$/m);
    });

    // The newest days are what the stream opens on, so they are the ones worth
    // a footer.
    it("links the newest days from other notes, in the body and in a property", () => {
        const others = paths.filter((path) => !dailyPaths.includes(path)).map((path) => vault[path]!);
        const linking = (date: string) => others.filter((body) => body.includes(`[[${date}]]`));

        expect(linking("2026-09-25").length).toBeGreaterThanOrEqual(2);
        expect(linking("2026-09-24").length).toBeGreaterThanOrEqual(1);
        expect(others.some((body) => /^\w+: "\[\[2026-09-\d\d\]\]"$/m.test(body))).toBe(true);
    });

    it("links only days it wrote, on a run shorter than the log", () => {
        const short = demoVault({ until: UNTIL, days: 1 });
        const projects = Object.entries(short).filter(([path]) => path.startsWith("Projects/"));
        const targets = projects.flatMap(([, body]) => [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]));

        expect(targets.length).toBeGreaterThan(0);
        expect(new Set(targets)).toEqual(new Set(["2026-09-25"]));
    });
});

// In an iCloud vault, a note deleted and written again while a device has it
// open comes back as "Mara 2.md".
describe("writeVault", () => {
    const FOLDERS = ["Journal", "People"];

    function vaultHolding(files: Record<string, string>) {
        const root = mkdtempSync(join(tmpdir(), "demo-vault-"));
        for (const [path, contents] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), contents);
        }
        return root;
    }
    const modified = (root: string, path: string) => statSync(join(root, path)).mtimeMs;
    const age = (root: string, path: string) => {
        const old = new Date(2020, 0, 1);
        utimesSync(join(root, path), old, old);
    };

    it("leaves a note that is already as seeded untouched", () => {
        const root = vaultHolding({ "People/Mara.md": "Mara" });
        age(root, "People/Mara.md");
        const before = modified(root, "People/Mara.md");

        writeVault(root, { "People/Mara.md": "Mara" }, FOLDERS);

        expect(modified(root, "People/Mara.md")).toBe(before);
    });

    it("writes a note that changed or is new", () => {
        const root = vaultHolding({ "People/Mara.md": "old" });

        writeVault(root, { "People/Mara.md": "Mara", "Journal/2026-10-01.md": "today" }, FOLDERS);

        expect(readFileSync(join(root, "People/Mara.md"), "utf8")).toBe("Mara");
        expect(readFileSync(join(root, "Journal/2026-10-01.md"), "utf8")).toBe("today");
    });

    it("deletes what the seed no longer holds in its folders, and nothing outside them", () => {
        const root = vaultHolding({ "Journal/2026-06-01.md": "gone", "Inbox/mine.md": "mine" });

        writeVault(root, { "Journal/2026-10-01.md": "today" }, FOLDERS);

        expect(existsSync(join(root, "Journal/2026-06-01.md"))).toBe(false);
        expect(existsSync(join(root, "Inbox/mine.md"))).toBe(true);
    });
});
