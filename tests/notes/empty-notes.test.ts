import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TFile, moment } from "../mocks/obsidian";
import { __mockSettings, __setMockSettings } from "../mocks/daily-notes";
import { EmptyNotes, hideEmptyNotes } from "../../src/notes/empty-notes";
import { BacklinkIndex } from "../../src/notes/backlink-index";

const TEMPLATE = "## Log\n- \n";

/** What localStorage would hold between sessions. */
function storeOf() {
    let saved: unknown = null;
    return { load: vi.fn(() => saved), save: vi.fn((value: unknown) => void (saved = structuredClone(value))) };
}

/**
 * A vault of `texts` by path. Each file's size is its text's length, and the
 * results are kept in `store`.
 */
function vaultOf(texts: Record<string, string>, store = storeOf()) {
    const files = new Map<string, TFile>();
    const fileAt = (path: string) => {
        let file = files.get(path);
        if (!file) {
            file = new TFile(path);
            files.set(path, file);
        }
        file.stat = { ...file.stat, size: texts[path]?.length ?? 0 };
        return file;
    };
    const read = vi.fn((file: TFile) => Promise.resolve(texts[file.path] ?? ""));
    const resolve = vi.fn((linkpath: string) => (`${linkpath}.md` in texts ? fileAt(`${linkpath}.md`) : null));
    return { texts, fileAt, read, resolve, store, notes: new EmptyNotes({ read, resolve }, store, __mockSettings) };
}

/** Writes `path` again, as a save does: new text, and a new change time. */
function write(vault: ReturnType<typeof vaultOf>, path: string, text: string): TFile {
    vault.texts[path] = text;
    const file = vault.fileAt(path);
    file.stat = { ...file.stat, mtime: file.stat.mtime + 1 };
    return file;
}

describe("EmptyNotes", () => {
    beforeEach(() => __setMockSettings({ format: "YYYY-MM-DD", folder: "", template: "Templates/Daily" }));

    it("finds a note holding only its template empty, and a written one not", async () => {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "a.md": "## Log\n- \n", "b.md": "## Log\n- ran\n" });
        const [a, b] = [vault.fileAt("a.md"), vault.fileAt("b.md")];

        await vault.notes.refresh([a, b]);

        expect(vault.notes.isEmpty(a)).toBe(true);
        expect(vault.notes.isEmpty(b)).toBe(false);
        expect(vault.resolve).toHaveBeenCalledWith("Templates/Daily");
    });

    it("finds nothing empty before it has read the note", () => {
        const vault = vaultOf({ "a.md": "" });

        expect(vault.notes.isEmpty(vault.fileAt("a.md"))).toBe(false);
    });

    it("reads no note bigger than the template by more than a kilobyte", async () => {
        const big = `## Log\n- ${"x".repeat(2048)}`;
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "big.md": big });
        const file = vault.fileAt("big.md");

        await vault.notes.refresh([file]);

        expect(vault.notes.isEmpty(file)).toBe(false);
        expect(vault.read).not.toHaveBeenCalledWith(file);
    });

    it("reads a note again only once it has changed", async () => {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "a.md": TEMPLATE });
        const a = vault.fileAt("a.md");
        await vault.notes.refresh([a]);
        await vault.notes.refresh([a]);
        expect(vault.read.mock.calls.filter(([file]) => file === a)).toHaveLength(1);

        write(vault, "a.md", "## Log\n- ran\n");
        expect(vault.notes.isEmpty(a)).toBe(false);
        await vault.notes.refresh([a]);

        expect(vault.read.mock.calls.filter(([file]) => file === a)).toHaveLength(2);
        expect(vault.notes.isEmpty(a)).toBe(false);
    });

    it("reads the template once, until it changes, and then every note again", async () => {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "a.md": TEMPLATE });
        const a = vault.fileAt("a.md");
        await vault.notes.refresh([a]);
        await vault.notes.refresh([a]);
        expect(vault.read).toHaveBeenCalledTimes(2);

        write(vault, "Templates/Daily.md", "## Journal\n");
        await vault.notes.refresh([a]);

        expect(vault.read).toHaveBeenCalledTimes(4);
        expect(vault.notes.isEmpty(a)).toBe(false);
    });

    it("reads every note again under a new template path", async () => {
        const vault = vaultOf({
            "Templates/Daily.md": TEMPLATE,
            "Templates/Journal.md": "## Journal\n",
            "a.md": TEMPLATE,
        });
        const a = vault.fileAt("a.md");
        await vault.notes.refresh([a]);

        __setMockSettings({ format: "YYYY-MM-DD", folder: "", template: "Templates/Journal" });
        await vault.notes.refresh([a]);

        expect(vault.notes.isEmpty(a)).toBe(false);
        expect(vault.notes.templatePath()).toBe("Templates/Journal");
    });

    it("reads the template path without the spaces around it", () => {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "", template: " Templates/Daily " });

        expect(vaultOf({}).notes.templatePath()).toBe("Templates/Daily");
    });

    it("names no template path when the settings name none", () => {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "" });

        expect(vaultOf({}).notes.templatePath()).toBe("");
    });

    it("reads a note as big as the template and a kilobyte", async () => {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "a.md": TEMPLATE + " ".repeat(1024) });
        const a = vault.fileAt("a.md");

        await vault.notes.refresh([a]);

        expect(vault.read).toHaveBeenCalledWith(a);
    });

    it("shows a note it could not read, and reads it again next time", async () => {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "a.md": TEMPLATE, "b.md": TEMPLATE });
        const [a, b] = [vault.fileAt("a.md"), vault.fileAt("b.md")];
        vault.read.mockImplementationOnce(vault.read.getMockImplementation()!);
        vault.read.mockRejectedValueOnce(new Error("ENOENT"));

        await vault.notes.refresh([a, b]);
        expect(vault.notes.isEmpty(a)).toBe(false);
        expect(vault.notes.isEmpty(b)).toBe(true);

        await vault.notes.refresh([a, b]);
        expect(vault.notes.isEmpty(a)).toBe(true);
    });

    it("hides nothing while the template cannot be read, and reads it again next time", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "a.md": TEMPLATE });
        const a = vault.fileAt("a.md");
        await vault.notes.refresh([a]);

        write(vault, "Templates/Daily.md", TEMPLATE);
        vault.read.mockRejectedValueOnce(new Error("ENOENT"));
        await vault.notes.refresh([a]);
        expect(vault.notes.isEmpty(a)).toBe(false);
        expect(errors).toHaveBeenCalledExactlyOnceWith(
            "DailyNotesStream: Failed to read the daily-notes template; hiding no notes",
            expect.any(Error)
        );

        await vault.notes.refresh([a]);
        expect(vault.notes.isEmpty(a)).toBe(true);
        errors.mockRestore();
    });

    it.each([
        ["no template set", ""],
        ["no template setting", undefined],
        ["a template that is missing", "Templates/Gone"],
    ])("with %s, finds only blank notes empty", async (_, template) => {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "", template });
        const vault = vaultOf({ "a.md": " \n", "b.md": TEMPLATE });
        const [a, b] = [vault.fileAt("a.md"), vault.fileAt("b.md")];

        await vault.notes.refresh([a, b]);

        expect(vault.notes.isEmpty(a)).toBe(true);
        expect(vault.notes.isEmpty(b)).toBe(false);
    });

    it("carries a verdict across a rename, and drops it with a delete", async () => {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "a.md": TEMPLATE });
        await vault.notes.refresh([vault.fileAt("a.md")]);

        vault.notes.rename("a.md", "b.md");
        const renamed = vault.fileAt("a.md");
        renamed.path = "b.md";
        expect(vault.notes.isEmpty(renamed)).toBe(true);

        expect(vault.notes.isEmpty(new TFile("a.md"))).toBe(false);

        vault.notes.forget("b.md");
        expect(vault.notes.isEmpty(renamed)).toBe(false);
    });

    it("ignores a rename of a note it never read, saving nothing for it", async () => {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "c.md": TEMPLATE });
        await vault.notes.checkAll([vault.fileAt("c.md")]);

        vault.notes.rename("a.md", "b.md");
        vault.notes.flush();

        expect(vault.notes.isEmpty(new TFile("b.md"))).toBe(false);
        expect(vault.store.save).toHaveBeenLastCalledWith(expect.objectContaining({ empty: [["c.md", 0]] }));
    });
});

describe("hideEmptyNotes", () => {
    let settings: { hideEmptyNotes: boolean; showLinkedMentions: boolean };
    let links: Record<string, Record<string, number>>;
    const today = moment("2026-09-28", "YYYY-MM-DD");

    beforeEach(() => {
        settings = { hideEmptyNotes: true, showLinkedMentions: true };
        links = {};
        vi.useFakeTimers({ now: new Date(2026, 8, 28, 12) });
        __setMockSettings({ format: "YYYY-MM-DD", folder: "", template: "Templates/Daily" });
    });

    afterEach(() => vi.useRealTimers());

    /**
     * A filter for a vault holding an empty note for yesterday and one for
     * today.
     */
    async function filterOver() {
        const vault = vaultOf({ "Templates/Daily.md": TEMPLATE, "2026-09-27.md": "", "2026-09-28.md": "" });
        const filter = hideEmptyNotes(vault.notes, new BacklinkIndex(() => links), () => settings);
        const files = [vault.fileAt("2026-09-27.md"), vault.fileAt("2026-09-28.md")] as const;
        await filter.prepare([...files]);
        return { vault, filter, files };
    }

    it("hides an empty note, but never today's", async () => {
        const { filter, files } = await filterOver();

        expect(filter.isHidden(files[0], today.clone().subtract(1, "day"))).toBe(true);
        expect(filter.isHidden(files[1], today)).toBe(false);
    });

    it("hides nothing, and reads nothing, when turned off", async () => {
        settings.hideEmptyNotes = false;
        const { vault, filter, files } = await filterOver();

        expect(filter.isHidden(files[0], today.clone().subtract(1, "day"))).toBe(false);
        expect(vault.read).not.toHaveBeenCalled();
    });

    it("checks every note when the list is built, and one when it changes", async () => {
        const { vault, filter, files } = await filterOver();
        const checkAll = vi.spyOn(vault.notes, "checkAll");
        const refresh = vi.spyOn(vault.notes, "refresh");

        await filter.prepare([...files]);
        await filter.recheck(files[0]);

        expect(checkAll).toHaveBeenCalledExactlyOnceWith([...files]);
        expect(refresh.mock.calls.at(-1)).toEqual([[files[0]]]);
    });

    it("rechecks nothing when turned off", async () => {
        settings.hideEmptyNotes = false;
        const { vault, filter, files } = await filterOver();

        await filter.recheck(files[0]);

        expect(vault.read).not.toHaveBeenCalled();
    });

    // Its linked mentions are content the stream would show under it.
    it("shows an empty note another note links to", async () => {
        links = { "Meeting.md": { "2026-09-27.md": 1 } };
        const { filter, files } = await filterOver();

        expect(filter.isHidden(files[0], today.clone().subtract(1, "day"))).toBe(false);
    });

    it("hides an empty note linked to when linked mentions are off, as nothing would show under it", async () => {
        links = { "Meeting.md": { "2026-09-27.md": 1 } };
        settings.showLinkedMentions = false;
        const { filter, files } = await filterOver();

        expect(filter.isHidden(files[0], today.clone().subtract(1, "day"))).toBe(true);
    });

    it("signs the settings and the template path, which change what is hidden wholesale", async () => {
        const { filter } = await filterOver();
        const signatures = [filter.signature()];

        settings.showLinkedMentions = false;
        signatures.push(filter.signature());
        settings.hideEmptyNotes = false;
        signatures.push(filter.signature());
        __setMockSettings({ format: "YYYY-MM-DD", folder: "", template: "Templates/Journal" });
        signatures.push(filter.signature());

        expect(new Set(signatures).size).toBe(4);
    });
});

describe("EmptyNotes across sessions", () => {
    const TEXTS = { "Templates/Daily.md": TEMPLATE, "empty.md": TEMPLATE, "written.md": "## Log\n- ran\n" };

    beforeEach(() => {
        __setMockSettings({ format: "YYYY-MM-DD", folder: "", template: "Templates/Daily" });
        vi.useFakeTimers({ now: 1_000 });
    });

    afterEach(() => vi.useRealTimers());

    /**
     * A session that checked every note at `now`, then closed. Returns the next
     * session's vault, which uses the same store.
     */
    async function afterASession(texts: Record<string, string> = TEXTS) {
        const first = vaultOf({ ...texts });
        await first.notes.checkAll(Object.keys(texts).slice(1).map(first.fileAt));
        first.notes.flush();
        vi.setSystemTime(5_000);
        const next = vaultOf({ ...texts }, first.store);
        return { first, next, files: () => Object.keys(texts).slice(1).map(next.fileAt) };
    }

    /** The notes the vault read, not counting the template. */
    const notesRead = (vault: ReturnType<typeof vaultOf>) =>
        vault.read.mock.calls.map(([file]) => file.path).filter((path) => !path.startsWith("Templates/"));

    it("keeps only the empty notes, and when every note was last checked", async () => {
        const { first } = await afterASession();

        expect(first.store.save).toHaveBeenCalledOnce();
        expect(first.store.save.mock.calls[0]![0]).toMatchObject({ checkedAt: 1_000, empty: [["empty.md", 0]] });
    });

    it("trusts every note unchanged since, reading none", async () => {
        const { next, files } = await afterASession();
        const [empty, written] = files();

        await next.notes.checkAll(files());

        expect(notesRead(next)).toEqual([]);
        expect(next.notes.isEmpty(empty!)).toBe(true);
        expect(next.notes.isEmpty(written!)).toBe(false);
    });

    it("reads a note saved empty whose mtime moved, even back in time, as a synced edit's may", async () => {
        const { next, files } = await afterASession();
        next.texts["empty.md"] = "## Log\n- ran\n";
        next.fileAt("empty.md").stat.mtime = 500;

        await next.notes.checkAll(files());

        expect(notesRead(next)).toEqual(["empty.md"]);
        expect(next.notes.isEmpty(next.fileAt("empty.md"))).toBe(false);
    });

    it("reads a note changed since the last check", async () => {
        const { next, files } = await afterASession();
        next.texts["written.md"] = TEMPLATE;
        next.fileAt("written.md").stat.mtime = 2_000;

        await next.notes.checkAll(files());

        expect(notesRead(next)).toEqual(["written.md"]);
        expect(next.notes.isEmpty(next.fileAt("written.md"))).toBe(true);
    });

    it("reads every note under a changed template", async () => {
        const { next, files } = await afterASession();
        next.fileAt("Templates/Daily.md").stat.mtime = 2_000;

        await next.notes.checkAll(files());

        expect(notesRead(next).sort()).toEqual(["empty.md", "written.md"]);
    });

    it("dates a check from when it began, so a note saved during its reads is read next time", async () => {
        const vault = vaultOf({ ...TEXTS });
        vault.read.mockImplementation((file: TFile) => {
            vi.setSystemTime(3_000);
            return Promise.resolve(vault.texts[file.path] ?? "");
        });

        await vault.notes.checkAll([vault.fileAt("empty.md")]);
        vault.notes.flush();

        expect(vault.store.save.mock.calls[0]![0]).toMatchObject({ checkedAt: 1_000 });
    });

    it("vouches for no note after a check that could not read one", async () => {
        const vault = vaultOf({ ...TEXTS });
        const read = vault.read.getMockImplementation()!;
        vault.read.mockImplementationOnce(read).mockImplementationOnce(read);
        vault.read.mockRejectedValueOnce(new Error("ENOENT"));

        await vault.notes.checkAll([vault.fileAt("empty.md"), vault.fileAt("written.md")]);
        vault.notes.flush();

        expect(vault.store.save).not.toHaveBeenCalled();
    });

    it("vouches for no note after a check that could not read the template", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const vault = vaultOf({ ...TEXTS });
        vault.read.mockRejectedValueOnce(new Error("ENOENT"));

        await vault.notes.checkAll([vault.fileAt("empty.md")]);
        vault.notes.flush();

        expect(vault.store.save).not.toHaveBeenCalled();
        errors.mockRestore();
    });

    it("trusts a note last changed the moment the last check began", async () => {
        const { next, files } = await afterASession();
        next.fileAt("written.md").stat.mtime = 1_000;

        await next.notes.checkAll(files());

        expect(notesRead(next)).toEqual([]);
    });

    it("saves nothing for a re-check that read nothing new", async () => {
        const { next, files } = await afterASession();
        await next.notes.checkAll(files());
        next.notes.flush();
        next.store.save.mockClear();

        await next.notes.refresh(files());
        vi.advanceTimersByTime(1_000);

        expect(next.store.save).not.toHaveBeenCalled();
    });

    it("saves what it knows once the template it was checked under can no longer be read", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const vault = vaultOf({ ...TEXTS });
        await vault.notes.checkAll([vault.fileAt("empty.md")]);
        write(vault, "Templates/Daily.md", TEMPLATE);
        vault.read.mockRejectedValueOnce(new Error("ENOENT"));
        await vault.notes.refresh([vault.fileAt("empty.md")]);

        vault.notes.flush();

        expect(vault.store.save).toHaveBeenCalledOnce();
        expect(errors).toHaveBeenCalledOnce();
        errors.mockRestore();
    });

    it("saves a verdict one note's re-check changed, a second after", async () => {
        const { next, files } = await afterASession();
        await next.notes.checkAll(files());
        next.notes.flush();
        next.store.save.mockClear();

        const written = next.fileAt("empty.md");
        next.texts["empty.md"] = "## Log\n- ran\n";
        written.stat.mtime = 6_000;
        await next.notes.refresh([written]);
        expect(next.store.save).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1_000);

        expect(next.store.save.mock.calls[0]![0]).toMatchObject({ checkedAt: 5_000, empty: [] });
    });

    it("saves nothing before every note has been checked this session", async () => {
        const { next } = await afterASession();
        next.store.save.mockClear();

        await next.notes.refresh([next.fileAt("empty.md")]);
        next.notes.rename("empty.md", "moved.md");
        next.notes.forget("written.md");
        next.notes.flush();

        expect(next.store.save).not.toHaveBeenCalled();
    });

    it("carries a saved empty note across a rename before the check", async () => {
        const { next } = await afterASession();
        next.notes.rename("empty.md", "moved.md");
        next.texts["moved.md"] = TEMPLATE;

        await next.notes.checkAll([next.fileAt("moved.md")]);

        expect(notesRead(next)).toEqual([]);
        expect(next.notes.isEmpty(next.fileAt("moved.md"))).toBe(true);
    });

    it.each([
        ["nothing saved", null],
        ["another version", { version: 0, template: "", checkedAt: 9_999, empty: [] }],
        ["something else", "garbage"],
        ["no list of empty notes", { version: 1, template: "", checkedAt: 9_999, empty: "none" }],
    ])("reads every note over %s", async (_, saved) => {
        const vault = vaultOf({ ...TEXTS });
        vault.store.load.mockReturnValue(saved);
        const notes = new EmptyNotes({ read: vault.read, resolve: vault.resolve }, vault.store, __mockSettings);

        await notes.checkAll([vault.fileAt("empty.md"), vault.fileAt("written.md")]);

        expect(notesRead(vault).sort()).toEqual(["empty.md", "written.md"]);
    });

    it.each([
        ["another version", { version: 0 }],
        ["no time it was checked at", { checkedAt: "9999" }],
    ])("reads every note over a check under the same template saved with %s", async (_, change) => {
        const { first, next, files } = await afterASession();
        next.store.load.mockReturnValue({ ...(first.store.save.mock.calls[0]![0] as object), ...change });
        const notes = new EmptyNotes({ read: next.read, resolve: next.resolve }, next.store, __mockSettings);

        await notes.checkAll(files());

        expect(notesRead(next).sort()).toEqual(["empty.md", "written.md"]);
    });
});
