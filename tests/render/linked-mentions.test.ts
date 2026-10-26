import { describe, it, expect, vi, beforeEach } from "vitest";
import { Component, MarkdownRenderer, TFile } from "obsidian";
import { Platform } from "../mocks/obsidian";
import { BacklinkIndex } from "../../src/notes/backlink-index";
import { CollapsibleManager } from "../../src/render/collapsible";
import { CollapsibleStateStore } from "../../src/render/collapse-store";
import { LinkedMentionsFooter } from "../../src/render/linked-mentions";
import type { DailyNotesStreamSettings } from "../../src/settings";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { asApp } from "../stream-view-fixture";
import { FakeWidths } from "./fake-widths";

const DAY = "Notes/2025-01-01.md";

function at(start: number, end: number) {
    return { start: { line: 0, col: 0, offset: start }, end: { line: 0, col: 0, offset: end } };
}

/** A note whose whole text is one paragraph that links to the day. */
function linkingNote(text: string) {
    const offset = text.indexOf("[[");
    return {
        text,
        cache: {
            links: [{ link: "2025-01-01", original: "[[2025-01-01]]", position: at(offset, offset + 14) }],
            sections: [{ type: "paragraph", position: at(0, text.length) }],
        },
    };
}

type Source = { text: string; cache: object };

/**
 * A vault of `sources` by path, each linking to the day. `read` replaces
 * `cachedRead`, so a test can keep a read waiting.
 */
function makeVault(sources: Record<string, Source>) {
    const files = new Map<string, TFile>([[DAY, new TFile(DAY)]]);
    for (const path of Object.keys(sources)) files.set(path, new TFile(path));
    const resolvedLinks: Record<string, Record<string, number>> = {};
    for (const path of Object.keys(sources)) resolvedLinks[path] = { [DAY]: 1 };
    const handlers: Record<string, (() => void)[]> = {};
    const read = vi.fn((file: TFile) => Promise.resolve(sources[file.path]?.text ?? ""));
    const app = asApp({
        vault: { getFileByPath: (path: string) => files.get(path) ?? null, cachedRead: read },
        metadataCache: {
            getFileCache: (file: TFile) => sources[file.path]?.cache ?? null,
            getFirstLinkpathDest: (name: string) => [...files.values()].find((f) => f.basename === name) ?? null,
            on: vi.fn((name: string, handler: () => void) => {
                (handlers[name] ??= []).push(handler);
                return {};
            }),
        },
    });
    const index = new BacklinkIndex(() => resolvedLinks);
    /**
     * A note starts linking here, as Obsidian would report once it resolves
     * links.
     */
    const add = (path: string, source: Source) => {
        sources[path] = source;
        files.set(path, new TFile(path));
        resolvedLinks[path] = { [DAY]: 1 };
    };
    const resolved = () => {
        index.invalidate();
        for (const handler of handlers["resolved"] ?? []) handler();
    };
    return { app, index, read, files, add, resolved, day: files.get(DAY)! };
}

function makeStore() {
    const storage = new Map<string, unknown>();
    return new CollapsibleStateStore(
        asApp({
            loadLocalStorage: (key: string) => storage.get(key) ?? null,
            saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
        })
    );
}

/**
 * A footer for `vault`, with working fold arrows under a root with shared
 * listeners. `collapsible` is its manager.
 */
function makeFooter(
    vault: ReturnType<typeof makeVault>,
    settings: Partial<DailyNotesStreamSettings> = {},
    store = makeStore()
) {
    const collapsible = new CollapsibleManager(store);
    const decorate = vi.fn();
    const footer = new LinkedMentionsFooter(
        vault.app,
        vault.index,
        collapsible,
        () => ({ ...DEFAULT_SETTINGS, ...settings }),
        new FakeWidths(),
        decorate
    );
    const root = document.body.createDiv();
    collapsible.delegate(new Component(), root);
    const block = root.createDiv({ cls: "daily-note-block" });
    const note = new Component();
    note.load();
    return { footer, block, note, decorate, collapsible, render: () => footer.render(block, vault.day, note) };
}

const mentionsEl = (block: HTMLElement) => block.querySelector<HTMLElement>(".daily-note-mentions");
const chevron = (block: HTMLElement) => block.querySelector<HTMLElement>(".daily-note-mentions .collapse-indicator")!;

beforeEach(() => {
    document.body.empty();
    vi.restoreAllMocks();
});

describe("LinkedMentionsFooter", () => {
    it("draws nothing with the setting off", async () => {
        const vault = makeVault({ "a.md": linkingNote("See [[2025-01-01]].") });
        const { block, render } = makeFooter(vault, { showLinkedMentions: false });

        await render();

        expect(mentionsEl(block)).toBeNull();
        expect(vault.read).not.toHaveBeenCalled();
    });

    it("leaves the footer empty when nothing links here", async () => {
        const { block, render } = makeFooter(makeVault({}));

        await render();

        expect(mentionsEl(block)!.childElementCount).toBe(0);
    });

    it("heads the footer with its count, then a group per note linking here", async () => {
        const vault = makeVault({ "b.md": linkingNote("B [[2025-01-01]]"), "a.md": linkingNote("A [[2025-01-01]]") });
        const { block, render } = makeFooter(vault);

        await render();

        const heading = mentionsEl(block)!.querySelector(":scope > .daily-note-mentions-heading")!;
        expect(heading.querySelector(".daily-note-mentions-title")!.textContent).toBe("Linked mentions");
        expect(heading.querySelector(".daily-note-mentions-count")!.textContent).toBe("2");
        const groups = Array.from(
            block.querySelectorAll<HTMLElement>(".daily-note-mentions-content > .daily-note-mention")
        );
        expect(groups.map((group) => group.dataset.linkSource)).toEqual(["a.md", "b.md"]);
    });

    it("titles a group with a link to its note, for the stream's own link gestures", async () => {
        const { block, render } = makeFooter(makeVault({ "Ideas/a.md": linkingNote("A [[2025-01-01]]") }));

        await render();

        const title = block.querySelector<HTMLElement>(".daily-note-mention-title")!;
        expect(title.matches("a.internal-link")).toBe(true);
        expect(title.dataset.href).toBe("Ideas/a.md");
        expect(title.textContent).toBe("a");
    });

    it("renders each excerpt as markdown, resolving links against the note it came from", async () => {
        const render = vi.spyOn(MarkdownRenderer, "render");
        const footer = makeFooter(makeVault({ "a.md": linkingNote("Met [[2025-01-01]] again") }));

        await footer.render();

        expect(render).toHaveBeenCalledWith(
            expect.anything(),
            "Met [[2025-01-01]] again",
            expect.any(HTMLElement),
            "a.md",
            footer.note
        );
    });

    it("renders only the excerpt around the link, not the whole note", async () => {
        const render = vi.spyOn(MarkdownRenderer, "render");
        const text = "Before.\n\nMet [[2025-01-01]] again";
        const source = linkingNote(text);
        source.cache.sections = [
            { type: "paragraph", position: at(0, 7) },
            { type: "paragraph", position: at(9, text.length) },
        ];

        await makeFooter(makeVault({ "a.md": source })).render();

        expect(render.mock.calls.map(([, markdown]) => markdown)).toEqual(["Met [[2025-01-01]] again"]);
    });

    it("toggles from its heading row, as the properties panel does", async () => {
        const { block, render } = makeFooter(makeVault({ "a.md": linkingNote("A [[2025-01-01]]") }));
        await render();

        mentionsEl(block)!.querySelector<HTMLElement>(".daily-note-mentions-title")!.click();

        expect(mentionsEl(block)!.hasClass("is-collapsed")).toBe(true);
    });

    it("renders a property linking here as its line", async () => {
        const render = vi.spyOn(MarkdownRenderer, "render");
        const vault = makeVault({
            "a.md": {
                text: "",
                cache: { frontmatterLinks: [{ key: "day", link: "2025-01-01", original: "[[2025-01-01]]" }] },
            },
        });

        await makeFooter(vault).render();

        expect(render).toHaveBeenCalledWith(
            expect.anything(),
            "day: [[2025-01-01]]",
            expect.any(HTMLElement),
            "a.md",
            expect.anything()
        );
        expect(vault.read).not.toHaveBeenCalled();
    });

    it("hands what it drew to be decorated, as the note's own content is", async () => {
        const { block, render, decorate } = makeFooter(makeVault({ "a.md": linkingNote("A [[2025-01-01]]") }));

        await render();

        expect(decorate).toHaveBeenCalledWith(mentionsEl(block));
    });

    it("reads every source at once", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]"), "b.md": linkingNote("B [[2025-01-01]]") });
        const pending: (() => void)[] = [];
        vault.read.mockImplementation(
            (file: TFile) => new Promise((resolve) => pending.push(() => resolve(`${file.path}`)))
        );

        const drawn = makeFooter(vault).render();
        await Promise.resolve();

        expect(vault.read).toHaveBeenCalledTimes(2);
        for (const release of pending) release();
        await drawn;
    });

    it("draws nothing once its note unloads mid-read", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        let release!: () => void;
        vault.read.mockImplementation(() => new Promise((resolve) => (release = () => resolve("A [[2025-01-01]]"))));
        const { block, note, render } = makeFooter(vault);

        const drawn = render();
        await Promise.resolve();
        note.unload();
        release();
        await drawn;

        expect(block.querySelector(".daily-note-mention")).toBeNull();
    });

    it("shows only the count while collapsed, reading nothing until expanded", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        const { block, render } = makeFooter(vault, { linkedMentionsCollapsed: true });

        await render();

        expect(mentionsEl(block)!.hasClass("is-collapsed")).toBe(true);
        expect(mentionsEl(block)!.querySelector(".daily-note-mentions-count")!.textContent).toBe("1");
        expect(vault.read).not.toHaveBeenCalled();

        chevron(block).click();
        await vi.waitFor(() => expect(block.querySelector(".daily-note-mention")).not.toBeNull());
        expect(mentionsEl(block)!.hasClass("is-collapsed")).toBe(false);
    });

    it("draws the notes once, however often it is expanded", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        const { block, render } = makeFooter(vault);
        await render();

        chevron(block).click();
        chevron(block).click();
        await Promise.resolve();

        expect(vault.read).toHaveBeenCalledOnce();
        expect(block.querySelectorAll(".daily-note-mention")).toHaveLength(1);
    });

    it("tells search what a collapsed footer hides", async () => {
        const { block, render, collapsible } = makeFooter(makeVault({ "a.md": linkingNote("A [[2025-01-01]]") }));
        await render();
        const excerpt = block.querySelector(".daily-note-mention-excerpt")!;

        chevron(block).click();

        expect(collapsible.folds(excerpt)).toBe(true);
        expect(collapsible.folds(block.querySelector(".daily-note-mentions-title")!)).toBe(false);
    });

    it("logs a source it could not read, and draws no group", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        vault.read.mockRejectedValue(new Error("gone"));
        const { block, render } = makeFooter(vault);

        await render();

        expect(error).toHaveBeenCalledWith("DailyNotesStream: Failed to draw linked mentions", expect.any(Error));
        expect(block.querySelector(".daily-note-mention")).toBeNull();
    });

    it("remembers a collapse for the note's next render", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        const store = makeStore();
        const first = makeFooter(vault, {}, store);
        await first.render();
        chevron(first.block).click();

        const second = makeFooter(vault, {}, store);
        await second.render();

        expect(mentionsEl(second.block)!.hasClass("is-collapsed")).toBe(true);
    });

    it("redraws once the cache resolves a note newly linking here", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        const { block, render } = makeFooter(vault);
        await render();

        vault.add("b.md", linkingNote("B [[2025-01-01]]"));
        vault.resolved();

        await vi.waitFor(() => expect(block.querySelectorAll(".daily-note-mention")).toHaveLength(2));
        expect(mentionsEl(block)!.querySelector(".daily-note-mentions-count")!.textContent).toBe("2");
    });

    it("leaves the footer be when the cache resolves nothing it shows", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        const { render } = makeFooter(vault);
        await render();

        vault.resolved();
        await Promise.resolve();

        expect(vault.read).toHaveBeenCalledOnce();
    });

    it("keeps only the newest of two redraws that overlap", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        const { block, decorate, render } = makeFooter(vault);
        await render();
        const pending: (() => void)[] = [];
        vault.read.mockImplementation(
            (file: TFile) => new Promise((resolve) => pending.push(() => resolve(file.path)))
        );

        vault.add("b.md", linkingNote("B [[2025-01-01]]"));
        vault.resolved();
        vault.add("c.md", linkingNote("C [[2025-01-01]]"));
        vault.resolved();
        await Promise.resolve();
        for (const release of pending) release();

        await vi.waitFor(() => expect(block.querySelectorAll(".daily-note-mention")).toHaveLength(3));
        expect(block.querySelectorAll(".daily-note-mentions")).toHaveLength(1);
        // The first draw, then the newest one. The draw it replaced changes
        // nothing.
        expect(decorate).toHaveBeenCalledTimes(2);
    });

    it("stops listening for the cache once its note unloads", async () => {
        const vault = makeVault({ "a.md": linkingNote("A [[2025-01-01]]") });
        const { note, render } = makeFooter(vault);
        await render();
        note.unload();

        vault.add("b.md", linkingNote("B [[2025-01-01]]"));
        vault.resolved();
        await Promise.resolve();

        expect(vault.read).toHaveBeenCalledOnce();
    });

    describe("on mobile", () => {
        beforeEach(() => {
            Platform.isMobile = true;
            return () => {
                Platform.isMobile = false;
            };
        });

        // A table too wide for a phone is stacked as cards (ADR 0008), in an
        // excerpt just as in a note.
        it("names each cell of an excerpt's table after its column", async () => {
            vi.spyOn(MarkdownRenderer, "render").mockImplementation((_app, _md, el) => {
                const table = el.createEl("table");
                table.createEl("thead").createEl("tr").createEl("th", { text: "Pace" });
                table.createEl("tbody").createEl("tr").createEl("td", { text: "5:12" });
                return Promise.resolve();
            });
            const { block, render } = makeFooter(makeVault({ "a.md": linkingNote("A [[2025-01-01]]") }));

            await render();

            expect(block.querySelector("td")?.dataset.column).toBe("Pace");
        });

        it("shrinks a wide equation in an excerpt to fit", async () => {
            let math: HTMLElement | null = null;
            vi.spyOn(MarkdownRenderer, "render").mockImplementation((_app, _md, el) => {
                const container = el.createEl("mjx-container" as "div", { attr: { display: "true" } });
                Object.defineProperty(container, "clientWidth", { value: 400 });
                math = container.createEl("mjx-math" as "div");
                Object.defineProperty(math, "offsetWidth", { value: 800 });
                return Promise.resolve();
            });
            const { render } = makeFooter(makeVault({ "a.md": linkingNote("A [[2025-01-01]]") }));

            await render();

            expect(math!.style.getPropertyValue("--daily-note-equation-zoom")).toBe("0.5");
        });
    });

    // On desktop, a table scrolls sideways, as Obsidian's tables do (ADR 0008).
    it("leaves an excerpt's table to Obsidian on desktop", async () => {
        vi.spyOn(MarkdownRenderer, "render").mockImplementation((_app, _md, el) => {
            const table = el.createEl("table");
            table.createEl("thead").createEl("tr").createEl("th", { text: "Pace" });
            table.createEl("tbody").createEl("tr").createEl("td", { text: "5:12" });
            return Promise.resolve();
        });
        const { block, render } = makeFooter(makeVault({ "a.md": linkingNote("A [[2025-01-01]]") }));

        await render();

        expect(block.querySelector("td")?.dataset.column).toBeUndefined();
    });
});
