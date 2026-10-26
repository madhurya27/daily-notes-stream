import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { Component, MarkdownRenderer, TFile } from "obsidian";
import { BaseMeasurements } from "../../../src/render/bases/base-measurements";
import { BASE_RESIZED, NoteBases, measureHeaderMetrics } from "../../../src/render/bases/note-bases";
import { HOLD_LIMIT_MS, SETTLE_MS } from "../../../src/stream/height-hold";
import { extractBases } from "../../../src/render/bases/bases-as-cards";
import type { HeaderMetrics } from "../../../src/render/bases/bases-width";
import { asApp } from "../../stream-view-fixture";
import { FakeWidths } from "../fake-widths";

const lines = (...l: string[]) => l.join("\n");

/** Three columns. The fake measurements below make its headers 3 × 100px. */
const TABLE = lines(
    "views:",
    "  - type: table",
    "    name: T",
    "    order:",
    "      - aaa",
    "      - bbb",
    "      - ccc"
);
const BLOCK = lines("```base", TABLE, "```");
const KANBAN = lines("```base", "views:", "  - type: kanban", "    name: K", "```");
const CARDS_ONLY = lines("```base", "views:", "  - type: cards", "    name: C", "```");

/** Each header is 100px: 66 of text, and 34 of padding, icon and gap. */
const metrics: HeaderMetrics = { chrome: 34, textWidth: () => 65 };

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    disconnected = false;
    readonly targets: Element[] = [];
    constructor(readonly callback: (entries: { target: Element }[]) => void) {
        FakeResizeObserver.instances.push(this);
    }
    observe(target: Element) {
        // Like the real one, only an element can be watched.
        if (!(target instanceof Element)) throw new TypeError("Failed to execute 'observe': not an Element");
        this.targets.push(target);
    }
    /** Reports that every observed element changed size. */
    resized() {
        this.callback(this.targets.map((target) => ({ target })));
    }
    /** Reports that only `target` changed size, if it is observed. */
    resizedOnly(target: Element) {
        if (this.targets.includes(target)) this.callback([{ target }]);
    }
    disconnect() {
        this.disconnected = true;
    }
}

const note = new TFile("Notes/2025-01-01.md");
let app: {
    vault: { cachedRead: ReturnType<typeof vi.fn> };
    metadataCache: { getFirstLinkpathDest: ReturnType<typeof vi.fn> };
};
let render: MockInstance<typeof MarkdownRenderer.render>;
let measure: ReturnType<typeof vi.fn<(host: HTMLElement) => HeaderMetrics | null>>;
let bases: NoteBases;
let noteWidth: number;
let oneCardPerRow: boolean;
let widths: FakeWidths;

/** A note's content element holding `markdown`'s Bases, drawn. */
async function renderNote(markdown: string, component = loaded()): Promise<HTMLElement> {
    const { markdown: body, bases: sources } = extractBases(markdown);
    const content = document.createElement("div");
    Object.defineProperty(content, "clientWidth", { get: () => noteWidth });
    for (const line of body.split("\n")) {
        if (line.includes("daily-note-base")) content.createDiv({ cls: "daily-note-base" });
    }
    await bases.render(content, note, component, sources);
    return content;
}

function loaded(): Component {
    const component = new Component();
    component.load();
    return component;
}

/** What the Base in `slot` was last drawn from. */
const drawn = (slot: Element) => render.mock.calls.filter((call) => call[2] === slot).at(-1)?.[1];

/**
 * Lays out a table in `slot` as Bases does: its width is set on the header row.
 */
function layOut(slot: Element, tableWidth: number, viewWidth = noteWidth): HTMLElement {
    const view = slot.createDiv({ cls: "bases-view" });
    Object.defineProperty(view, "clientWidth", { get: () => viewWidth });
    view.createDiv({ cls: "bases-thead" }).setAttribute("style", `width: ${tableWidth}px`);
    return view;
}

/**
 * Lays out a kanban in `slot` as Bases does: its board's width is set on its
 * container.
 */
function layOutKanban(slot: Element, boardWidth: number): HTMLElement {
    const view = slot.createDiv({ cls: "bases-view" });
    Object.defineProperty(view, "clientWidth", { get: () => noteWidth });
    view.createDiv({ cls: "bases-kanban-container" }).setAttribute("style", `width: ${boardWidth}px`);
    return view;
}

/** Bases laid out `view`, and the next task ran. */
function reportLayout(view: HTMLElement): void {
    bases.onLayout(view);
    vi.advanceTimersByTime(0);
}

const slotOf = (content: HTMLElement, i = 0) => content.querySelectorAll(".daily-note-base")[i]!;
const cap = (view: HTMLElement) => view.style.getPropertyValue("--bases-table-column-max-width");

beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    widths = new FakeWidths();
    app = {
        vault: { cachedRead: vi.fn().mockResolvedValue(TABLE) },
        metadataCache: { getFirstLinkpathDest: vi.fn().mockReturnValue(new TFile("Bases/Views.base")) },
    };
    render = vi.spyOn(MarkdownRenderer, "render").mockResolvedValue();
    measure = vi.fn().mockReturnValue(metrics);
    bases = new NoteBases(asApp(app), new BaseMeasurements(), widths, () => oneCardPerRow, measure);
    noteWidth = 400;
    oneCardPerRow = false;
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("NoteBases drawing a note's Bases", () => {
    it("draws a Base whose headers fit as the table it is", async () => {
        const content = await renderNote(BLOCK);

        expect(render).toHaveBeenCalledWith(app, BLOCK, slotOf(content), note.path, expect.any(Component));
    });

    it("draws a Base straight as cards when its headers alone overrun the note", async () => {
        noteWidth = 299;

        const content = await renderNote(BLOCK);

        expect(drawn(slotOf(content))).toMatch(/^```base\n[\s\S]*type: cards[\s\S]*\n```$/);
    });

    it("draws cards at Bases' own size", async () => {
        noteWidth = 299;

        const content = await renderNote(BLOCK);

        expect(drawn(slotOf(content))).not.toContain("cardSize");
    });

    // Bases fits as many cards in a row as their size allows. At the largest
    // size, that is one.
    it("draws cards one to a row when the settings ask", async () => {
        noteWidth = 299;
        oneCardPerRow = true;

        const content = await renderNote(BLOCK);

        expect(drawn(slotOf(content))).toContain("cardSize: 800");
    });

    it("draws a Base whose headers just fit as the table", async () => {
        noteWidth = 300;

        const content = await renderNote(BLOCK);

        expect(drawn(slotOf(content))).toBe(BLOCK);
    });

    it("draws each Base into its own placeholder", async () => {
        const content = await renderNote(lines(BLOCK, "", CARDS_ONLY));

        expect(drawn(slotOf(content, 0))).toBe(BLOCK);
        expect(drawn(slotOf(content, 1))).toBe(CARDS_ONLY);
    });

    // Resolved the way Obsidian resolves the embed: from the note.
    it("draws an embedded Base from its file, its named view first", async () => {
        noteWidth = 50;
        app.vault.cachedRead.mockResolvedValue(
            lines(TABLE, "  - type: table", "    name: Second", "    order:", "      - aaa")
        );

        const content = await renderNote("![[Views.base#Second]]");

        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Views.base", note.path);
        expect(drawn(slotOf(content))).toMatch(/views:\n {2}- type: cards\n {4}name: Second/);
    });

    // An embed drawn as a table stays an embed, so changes made in its toolbar
    // save to its file.
    it("draws an embed that fits as the embed it is", async () => {
        const content = await renderNote("![[Views.base]]");

        expect(drawn(slotOf(content))).toBe("![[Views.base]]");
    });

    it.each([
        ["a missing file", null],
        ["a file that is not a Base", new TFile("Views.base.md")],
    ])("draws an embed of %s as written", async (_case, dest) => {
        noteWidth = 100;
        app.metadataCache.getFirstLinkpathDest.mockReturnValue(dest);

        const content = await renderNote("![[Views.base]]");

        expect(drawn(slotOf(content))).toBe("![[Views.base]]");
        expect(app.vault.cachedRead).not.toHaveBeenCalled();
    });

    it("draws a Base with no table as written", async () => {
        noteWidth = 10;

        const content = await renderNote(CARDS_ONLY);

        expect(drawn(slotOf(content))).toBe(CARDS_ONLY);
    });

    it("draws a Base with no table as written, even where it was measured too wide", async () => {
        const measured = new BaseMeasurements();
        bases = new NoteBases(asApp(app), measured, widths, () => oneCardPerRow, measure);
        const content = await renderNote(CARDS_ONLY);
        reportLayout(layOut(slotOf(content), 900));

        const again = await renderNote(CARDS_ONLY);

        expect(drawn(slotOf(again))).toBe(CARDS_ONLY);
    });

    // Headers are measured by reading styles, so only once, not for each note.
    it("measures headers once", async () => {
        await renderNote(BLOCK);
        await renderNote(BLOCK);

        expect(measure).toHaveBeenCalledOnce();
    });

    it("measures nothing and watches nothing for a note without Bases", async () => {
        await renderNote("Just text");

        expect(measure).not.toHaveBeenCalled();
        expect(FakeResizeObserver.instances).toEqual([]);
        expect(widths.watched.size).toBe(0);
    });

    it("draws the table when headers cannot be measured", async () => {
        measure.mockReturnValue(null);
        noteWidth = 10;

        const content = await renderNote(BLOCK);

        expect(drawn(slotOf(content))).toBe(BLOCK);
    });

    it("frees a Base with its note", async () => {
        const component = loaded();
        await renderNote(BLOCK, component);
        const base = render.mock.calls[0]![4];

        component.unload();

        expect((base as unknown as { loaded: boolean }).loaded).toBe(false);
        expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
        expect([...widths.watched.values()].every((refits) => refits.size === 0)).toBe(true);
    });
});

describe("NoteBases measuring a drawn table", () => {
    it("redraws a table wider than its note as cards, alone", async () => {
        const content = await renderNote(lines(BLOCK, "", BLOCK));
        const first = render.mock.calls[0]![4] as unknown as { loaded: boolean };

        reportLayout(layOut(slotOf(content), 900));

        expect(drawn(slotOf(content, 0))).toContain("type: cards");
        expect(drawn(slotOf(content, 1))).toBe(BLOCK);
        expect(first.loaded).toBe(false);
        expect(slotOf(content).querySelector(".bases-view")).toBeNull();
    });

    // Bases lays out a table inside a resize report. Emptying the placeholder
    // there would resize the note one round late, which WebKit logs as an
    // error.
    it("redraws it after the layout, not inside it", async () => {
        const content = await renderNote(BLOCK);

        bases.onLayout(layOut(slotOf(content), 900));
        expect(render).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(0);
        expect(drawn(slotOf(content))).toContain("type: cards");
    });

    it("redraws once for several layouts at once", async () => {
        const content = await renderNote(BLOCK);
        const view = layOut(slotOf(content), 900);

        bases.onLayout(view);
        bases.onLayout(view);
        vi.advanceTimersByTime(0);

        expect(render).toHaveBeenCalledTimes(2);
    });

    it("redraws nothing for a note unloaded before it redraws", async () => {
        const component = loaded();
        const content = await renderNote(BLOCK, component);

        bases.onLayout(layOut(slotOf(content), 900));
        component.unload();
        vi.advanceTimersByTime(0);

        expect(render).toHaveBeenCalledOnce();
    });

    // A note comes back after being emptied. Drawing twice only happens once.
    it("draws it straight as cards next time, at that width", async () => {
        reportLayout(layOut(slotOf(await renderNote(BLOCK)), 900));

        const again = await renderNote(BLOCK);

        expect(drawn(slotOf(again))).toContain("type: cards");
    });

    // Back builds the stream's view again, and its NoteBases with it.
    it("draws it straight as cards in a view sharing what this one measured", async () => {
        const measured = new BaseMeasurements();
        bases = new NoteBases(asApp(app), measured, widths, () => oneCardPerRow, measure);
        reportLayout(layOut(slotOf(await renderNote(BLOCK)), 900));
        bases = new NoteBases(asApp(app), measured, widths, () => oneCardPerRow, measure);

        const again = await renderNote(BLOCK);

        expect(drawn(slotOf(again))).toContain("type: cards");
    });

    it("measures again at another width", async () => {
        reportLayout(layOut(slotOf(await renderNote(BLOCK)), 900));
        noteWidth = 800;

        const again = await renderNote(BLOCK);

        expect(drawn(slotOf(again))).toBe(BLOCK);
    });

    it("redraws a kanban wider than its note as cards", async () => {
        const content = await renderNote(KANBAN);

        reportLayout(layOutKanban(slotOf(content), 600));

        expect(drawn(slotOf(content))).toContain("type: cards");
    });

    it("keeps a kanban that fits", async () => {
        const content = await renderNote(KANBAN);

        reportLayout(layOutKanban(slotOf(content), 300));

        expect(render).toHaveBeenCalledOnce();
    });

    it("keeps a table whose header row has not laid out", async () => {
        const content = await renderNote(BLOCK);

        reportLayout(slotOf(content).createDiv({ cls: "bases-view" }));

        expect(render).toHaveBeenCalledOnce();
    });

    it("keeps a table that fits, unfitted", async () => {
        const content = await renderNote(BLOCK);
        const view = layOut(slotOf(content), 400);

        reportLayout(view);

        expect(render).toHaveBeenCalledOnce();
        expect(cap(view)).toBe("");
    });

    it.each([
        ["cannot become cards", CARDS_ONLY],
        ["is cards already", BLOCK],
    ])("fits a Base that %s", async (_case, markdown) => {
        noteWidth = markdown === BLOCK ? 200 : 400;
        const content = await renderNote(markdown);
        const view = layOut(slotOf(content), 900);

        reportLayout(view);

        expect(render).toHaveBeenCalledOnce();
        expect(cap(view)).not.toBe("");
    });

    // An embedded note's Base, or one inside a callout, is not taken out.
    it("fits a Base it did not draw", () => {
        const view = layOut(document.createElement("div"), 900, 400);

        reportLayout(view);

        expect(cap(view)).not.toBe("");
    });
});

describe("NoteBases when the note's width changes", () => {
    /** Reports the width, and runs the next task. */
    const resize = (width: number) => {
        report(width);
        vi.advanceTimersByTime(0);
    };
    const report = (width: number) => {
        noteWidth = width;
        for (const content of widths.watched.keys()) widths.resize(content, width);
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // Emptying the placeholder inside the report would resize the note one
    // round late, which WebKit logs as an error.
    it("redraws after the report, not inside it", async () => {
        noteWidth = 200;
        const content = await renderNote(BLOCK);

        report(800);
        expect(render).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(0);
        expect(drawn(slotOf(content))).toBe(BLOCK);
    });

    it("redraws once for several reports at once, at the last width", async () => {
        noteWidth = 200;
        await renderNote(BLOCK);

        report(800);
        report(250);
        vi.advanceTimersByTime(0);

        expect(render).toHaveBeenCalledOnce();
    });

    it("redraws nothing for a note unloaded before it redraws", async () => {
        noteWidth = 200;
        const component = loaded();
        await renderNote(BLOCK, component);

        report(800);
        component.unload();
        vi.advanceTimersByTime(0);

        expect(render).toHaveBeenCalledOnce();
    });

    it("redraws cards as a table when the table may fit", async () => {
        noteWidth = 200;
        const content = await renderNote(BLOCK);

        resize(800);

        expect(drawn(slotOf(content))).toBe(BLOCK);
    });

    it("keeps cards where the table was measured too wide", async () => {
        const content = await renderNote(BLOCK);
        reportLayout(layOut(slotOf(content), 900));
        resize(800);
        reportLayout(layOut(slotOf(content), 900, 800));
        const draws = render.mock.calls.length;

        resize(400);

        expect(render).toHaveBeenCalledTimes(draws);
        expect(drawn(slotOf(content))).toContain("type: cards");
    });

    it("keeps cards while the headers still overrun", async () => {
        noteWidth = 200;
        await renderNote(BLOCK);

        resize(250);

        expect(render).toHaveBeenCalledOnce();
    });

    it("redraws a table that no longer fits as cards", async () => {
        noteWidth = 800;
        const content = await renderNote(BLOCK);
        layOut(slotOf(content), 600, 800);

        resize(400);

        expect(drawn(slotOf(content))).toContain("type: cards");
    });

    it("keeps a table exactly as wide as the note", async () => {
        noteWidth = 800;
        const content = await renderNote(BLOCK);
        layOut(slotOf(content), 400, 800);

        resize(400);

        expect(drawn(slotOf(content))).toBe(BLOCK);
    });

    it("redraws a kanban that no longer fits as cards", async () => {
        noteWidth = 800;
        const content = await renderNote(KANBAN);
        layOutKanban(slotOf(content), 600);

        resize(400);

        expect(drawn(slotOf(content))).toContain("type: cards");
    });

    it("leaves a table that still fits, or is not laid out yet", async () => {
        noteWidth = 800;
        const content = await renderNote(lines(BLOCK, "", BLOCK));
        layOut(slotOf(content), 300, 800);

        resize(400);

        expect(render).toHaveBeenCalledTimes(2);
    });
});

describe("NoteBases when an embedded Base's file changes", () => {
    const base = new TFile("Bases/Views.base");
    const oneColumn = lines("views:", "  - type: table", "    name: One", "    order:", "      - aaa");

    beforeEach(() => app.metadataCache.getFirstLinkpathDest.mockReturnValue(base));

    // A copy drawn as cards cannot save, so nothing else would update it.
    it("redraws a cards copy from the file as it now is", async () => {
        noteWidth = 200;
        const content = await renderNote("![[Views.base]]");
        app.vault.cachedRead.mockResolvedValue(TABLE.replace("name: T", "name: Changed"));

        await bases.onBaseModified(base);

        expect(drawn(slotOf(content))).toMatch(/type: cards\n {4}name: Changed/);
    });

    it("redraws a copy that now fits as the embed it is", async () => {
        noteWidth = 200;
        const content = await renderNote("![[Views.base]]");
        app.vault.cachedRead.mockResolvedValue(oneColumn);

        await bases.onBaseModified(base);

        expect(drawn(slotOf(content))).toBe("![[Views.base]]");
    });

    it("redraws that copy as cards again once it lays out too wide", async () => {
        vi.useFakeTimers();
        noteWidth = 200;
        const content = await renderNote("![[Views.base]]");
        app.vault.cachedRead.mockResolvedValue(oneColumn);
        await bases.onBaseModified(base);

        reportLayout(layOut(slotOf(content), 900));
        await vi.advanceTimersByTimeAsync(0);

        expect(drawn(slotOf(content))).toContain("type: cards");
        vi.useRealTimers();
    });

    // Obsidian draws a real embed again when its file changes.
    it("leaves an embed drawn as a table to redraw itself", async () => {
        await renderNote("![[Views.base]]");

        await bases.onBaseModified(base);

        expect(render).toHaveBeenCalledOnce();
    });

    it.each([
        ["another Base", new TFile("Bases/Other.base")],
        ["a note", new TFile("Bases/Views.md")],
    ])("ignores %s changing", async (_case, file) => {
        noteWidth = 200;
        await renderNote("![[Views.base]]");

        await bases.onBaseModified(file);

        expect(render).toHaveBeenCalledOnce();
    });

    it("keeps redrawing the copies in notes still rendered", async () => {
        noteWidth = 200;
        const gone = loaded();
        await renderNote("![[Views.base]]", gone);
        const content = await renderNote("![[Views.base]]");
        gone.unload();
        const draws = render.mock.calls.length;

        await bases.onBaseModified(base);

        expect(render).toHaveBeenCalledTimes(draws + 1);
        expect(render.mock.calls.at(-1)![2]).toBe(slotOf(content));
    });

    it("forgets a copy once its note unloads", async () => {
        noteWidth = 200;
        const component = loaded();
        await renderNote("![[Views.base]]", component);
        component.unload();
        const reads = app.vault.cachedRead.mock.calls.length;

        await bases.onBaseModified(base);

        expect(render).toHaveBeenCalledOnce();
        // There is nothing left to draw again, so the file is not read.
        expect(app.vault.cachedRead).toHaveBeenCalledTimes(reads);
    });
});

/**
 * Bases fills a view after drawing it, and fills it again on a live update. So
 * a Base is held at the height it showed until what is drawn in it stops
 * changing.
 */
describe("NoteBases holding a Base while it refills", () => {
    /** Lays out `slot` at `height`, as a drawn Base would be. */
    const tall = (slot: Element, height: number) => {
        slot.getBoundingClientRect = () => ({ height }) as DOMRect;
    };
    const resized = () => FakeResizeObserver.instances.forEach((observer) => observer.resized());
    /**
     * `slot` is laid out at `height`, the observers report it, then the next
     * task runs.
     */
    const layOutAt = (slot: Element, height: number) => {
        tall(slot, height);
        resized();
        vi.advanceTimersByTime(0);
    };

    // Draws an element, as the real renderer does, for the hold to watch.
    beforeEach(() => {
        vi.useFakeTimers();
        render.mockImplementation(async (_app, _markdown, el) => {
            el.createDiv();
        });
    });
    afterEach(() => vi.useRealTimers());
    const held = (slot: Element) => (slot as HTMLElement).style.getPropertyValue("--daily-note-held-height");

    it("holds a table redrawn as cards at the table's height", async () => {
        const content = await renderNote(BLOCK);
        tall(slotOf(content), 112);

        reportLayout(layOut(slotOf(content), 900));

        expect(held(slotOf(content))).toBe("112px");
    });

    // A live update empties the view and fills it again, and the dip is never
    // drawn.
    it("holds a Base that shrinks by itself at the height it had", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);

        layOutAt(slotOf(content), 40);

        expect(held(slotOf(content))).toBe("300px");
    });

    // Held before it shrinks, not after hearing that it did. Setting the height
    // back inside the report would resize the note one round late, which WebKit
    // logs as an error.
    it("holds a Base where it lays out, before any shrink", async () => {
        const content = await renderNote(BLOCK);

        layOutAt(slotOf(content), 300);

        expect(held(slotOf(content))).toBe("300px");
    });

    it("holds a Base where it grows to", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);

        layOutAt(slotOf(content), 500);

        expect(held(slotOf(content))).toBe("500px");
    });

    // Bases adds rows inside its own ResizeObserver callback. A Base grown
    // there would resize its note too late for that round, and WebKit logs an
    // error.
    it("holds a Base at what it drew, as the draw ends", async () => {
        render.mockImplementation(async (_app, _markdown, el) => {
            el.createDiv();
            tall(el, 76);
        });

        const content = await renderNote(BLOCK);

        expect(held(slotOf(content))).toBe("76px");
    });

    it("grows to what it lays out at unheld, not at its hold", async () => {
        const content = await renderNote(BLOCK);
        const slot = slotOf(content) as HTMLElement;
        layOutAt(slot, 300);
        // As in styles.css: while held, it is laid out at its held height.
        slot.getBoundingClientRect = () => ({ height: held(slot) ? 300 : 500 }) as DOMRect;

        resized();
        vi.advanceTimersByTime(0);

        expect(held(slot)).toBe("500px");
    });

    it("watches the placeholder, which a hold stops resizing", async () => {
        const content = await renderNote(BLOCK);

        expect(FakeResizeObserver.instances.some((observer) => observer.targets.includes(slotOf(content)))).toBe(true);
    });

    it("lets go of a Base drawn and never resized, once still", async () => {
        const content = await renderNote(BLOCK);
        tall(slotOf(content), 120);

        vi.advanceTimersByTime(SETTLE_MS);

        expect(held(slotOf(content))).toBe("120px");
    });

    it("holds nothing once let go into nothing", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        layOutAt(slotOf(content), 0);

        vi.advanceTimersByTime(SETTLE_MS);

        expect(held(slotOf(content))).toBe("");
    });

    it("lets go once what is drawn holds still", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        layOutAt(slotOf(content), 40);

        vi.advanceTimersByTime(SETTLE_MS - 100);
        resized();
        vi.advanceTimersByTime(SETTLE_MS - 1);
        expect(held(slotOf(content))).toBe("300px");

        vi.advanceTimersByTime(1);
        expect(held(slotOf(content))).toBe("40px");
    });

    // It lost rows, so once released, it has the shorter height.
    it("holds it at what it was let go into", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        layOutAt(slotOf(content), 40);
        vi.advanceTimersByTime(SETTLE_MS);

        resized();

        expect(held(slotOf(content))).toBe("40px");
    });

    // A Base that updates live never stops changing.
    it("lets go after a while regardless, from the first change it held", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        vi.advanceTimersByTime(HOLD_LIMIT_MS);
        layOutAt(slotOf(content), 40);

        for (let t = SETTLE_MS / 2; t < HOLD_LIMIT_MS; t += SETTLE_MS / 2) {
            vi.advanceTimersByTime(SETTLE_MS / 2);
            resized();
        }
        expect(held(slotOf(content))).toBe("300px");

        vi.advanceTimersByTime(SETTLE_MS / 2);
        expect(held(slotOf(content))).toBe("40px");
    });

    it("keeps the height it holds at through a redraw while held", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        layOutAt(slotOf(content), 50);

        reportLayout(layOut(slotOf(content), 900));

        expect(held(slotOf(content))).toBe("300px");
    });

    it("watches what it drew, which moves under the hold", async () => {
        const content = await renderNote(BLOCK);
        tall(slotOf(content), 112);

        reportLayout(layOut(slotOf(content), 900));
        await vi.advanceTimersByTimeAsync(0);

        const drawnView = slotOf(content).lastElementChild!;
        expect(FakeResizeObserver.instances.some((observer) => observer.targets.includes(drawnView))).toBe(true);
    });

    it("stops watching a Base unloaded while held", async () => {
        const component = loaded();
        const content = await renderNote(BLOCK, component);
        tall(slotOf(content), 112);
        reportLayout(layOut(slotOf(content), 900));

        component.unload();

        expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
        expect(held(slotOf(content))).toBe("");
    });

    it("holds nothing it never saw laid out", async () => {
        const content = await renderNote(BLOCK);

        reportLayout(layOut(slotOf(content), 900));

        expect(held(slotOf(content))).toBe("");
    });

    // The note keeps the height of a Base that comes back. A Base's own height
    // is never saved.
    it("keeps no height across renders", async () => {
        const component = loaded();
        const content = await renderNote(BLOCK, component);
        layOutAt(slotOf(content), 300);
        vi.advanceTimersByTime(SETTLE_MS);
        tall(slotOf(content), 0);
        component.unload();

        const again = await renderNote(BLOCK);

        expect(held(slotOf(again))).toBe("");
    });
});

/**
 * Its note has a fixed height (ADR 0013). When the Base takes a height through
 * its hold, the note hears about it in the same task. Any other height change
 * waits for a report one frame later.
 */
describe("NoteBases changing a Base's height in a pinned note", () => {
    const tall = (slot: Element, height: number) => {
        slot.getBoundingClientRect = () => ({ height }) as DOMRect;
    };
    const resized = () => FakeResizeObserver.instances.forEach((observer) => observer.resized());
    const layOutAt = (slot: Element, height: number) => {
        tall(slot, height);
        resized();
        vi.advanceTimersByTime(0);
    };
    const held = (slot: Element) => (slot as HTMLElement).style.getPropertyValue("--daily-note-held-height");
    const measuring = (slot: Element) => slot.classList.contains("is-measuring");
    /** How many times `slot` told its note that it set a height. */
    const told = (slot: Element) => {
        const heard = { count: 0 };
        slot.addEventListener(BASE_RESIZED, () => heard.count++);
        return heard;
    };

    /**
     * A Base drawn as cards at 300px, then drawn again as written for a note
     * that became wide enough.
     */
    async function redrawnAsWritten(): Promise<Element> {
        noteWidth = 299;
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        noteWidth = 800;
        for (const watched of widths.watched.keys()) widths.resize(watched, 800);
        await vi.advanceTimersByTimeAsync(0);
        return slotOf(content);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        render.mockImplementation(async (_app, _markdown, el) => {
            el.createDiv();
        });
    });
    afterEach(() => vi.useRealTimers());

    it("grows a task after hearing what it drew grew, telling its note then", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        const heard = told(slotOf(content));

        tall(slotOf(content), 500);
        resized();
        const inReport = { held: held(slotOf(content)), told: heard.count };
        vi.advanceTimersByTime(0);

        expect(inReport).toEqual({ held: "300px", told: 0 });
        expect(held(slotOf(content))).toBe("500px");
        expect(heard.count).toBe(1);
    });

    it("tells its note as it lets go", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        layOutAt(slotOf(content), 40);
        const heard = told(slotOf(content));

        vi.advanceTimersByTime(SETTLE_MS);

        expect(held(slotOf(content))).toBe("40px");
        expect(heard.count).toBe(1);
    });

    it("tells the note it sits in, wherever it listens", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        const heard = told(content);

        vi.advanceTimersByTime(SETTLE_MS);

        expect(heard.count).toBe(1);
    });

    it("tells its note once as the limit lets go, not again once still", async () => {
        const content = await renderNote(BLOCK);
        layOutAt(slotOf(content), 300);
        const heard = told(slotOf(content));
        for (let t = 0; t < HOLD_LIMIT_MS; t += SETTLE_MS / 2) {
            resized();
            vi.advanceTimersByTime(SETTLE_MS / 2);
        }
        const atLimit = heard.count;

        vi.advanceTimersByTime(SETTLE_MS);

        expect(atLimit).toBe(1);
        expect(heard.count).toBe(1);
    });

    it("tells its note nothing once unloaded while held", async () => {
        const component = loaded();
        const content = await renderNote(BLOCK, component);
        layOutAt(slotOf(content), 300);
        const heard = told(slotOf(content));

        component.unload();
        vi.advanceTimersByTime(HOLD_LIMIT_MS);

        expect(heard.count).toBe(0);
        expect(held(slotOf(content))).toBe("");
    });

    it("grows nothing and tells its note nothing once unloaded with a growth heard", async () => {
        const component = loaded();
        const content = await renderNote(BLOCK, component);
        layOutAt(slotOf(content), 300);
        const heard = told(slotOf(content));
        tall(slotOf(content), 500);
        resized();

        component.unload();
        vi.advanceTimersByTime(0);

        expect(heard.count).toBe(0);
        expect(held(slotOf(content))).toBe("");
    });

    it("tells its note nothing for a table that fits, never measured", async () => {
        const content = await renderNote(BLOCK);
        const heard = told(slotOf(content));

        reportLayout(layOut(slotOf(content), 300));

        expect(heard.count).toBe(0);
    });

    // Bases draws a board or table at its own height. If that were shown, the
    // text below it in the note would move one frame before the note hears
    // about it.
    it("clips a Base redrawn as written at the height it showed while it is measured", async () => {
        const slot = await redrawnAsWritten();

        expect(drawn(slot)).toBe(BLOCK);
        expect(measuring(slot)).toBe(true);
        expect(held(slot)).toBe("300px");
    });

    it("draws it as written at that height, however tall it draws", async () => {
        render.mockImplementation(async (_app, markdown, el) => {
            el.createDiv();
            if (markdown === BLOCK) tall(el, 800);
        });

        const slot = await redrawnAsWritten();

        expect(held(slot)).toBe("300px");
    });

    it("keeps that height while what it measures grows", async () => {
        const slot = await redrawnAsWritten();

        layOutAt(slot, 800);

        expect(held(slot)).toBe("300px");
    });

    it("draws it as cards at that height once measured too wide", async () => {
        const slot = await redrawnAsWritten();
        layOutAt(slot, 800);
        // Just after drawing, the cards are shorter than the table until they
        // fill in.
        tall(slot, 120);

        reportLayout(layOut(slot, 900, 800));
        await vi.advanceTimersByTimeAsync(0);

        expect(drawn(slot)).toContain("type: cards");
        expect(measuring(slot)).toBe(false);
        expect(held(slot)).toBe("300px");
    });

    it("lets it out, telling its note, once it fits as written", async () => {
        const slot = await redrawnAsWritten();
        const heard = told(slot);

        reportLayout(layOut(slot, 600, 800));

        expect(measuring(slot)).toBe(false);
        expect(heard.count).toBe(1);
    });

    it("lets it out at the height it draws at", async () => {
        const slot = await redrawnAsWritten();
        tall(slot, 600);
        const before = held(slot);

        reportLayout(layOut(slot, 600, 800));

        expect(before).toBe("300px");
        expect(held(slot)).toBe("600px");
    });

    it("keeps measuring a Base not laid out yet", async () => {
        const slot = await redrawnAsWritten();

        reportLayout(slot.createDiv({ cls: "bases-view" }));

        expect(measuring(slot)).toBe(true);
    });

    it("lets out a Base never measured as it lets go", async () => {
        const slot = await redrawnAsWritten();
        const heard = told(slot);

        vi.advanceTimersByTime(HOLD_LIMIT_MS);

        expect(measuring(slot)).toBe(false);
        expect(heard.count).toBe(1);
    });

    // There is nothing above it in the note to cut off, and a Base drawn at 0px
    // would disappear.
    it("clips nothing on a first draw", async () => {
        const content = await renderNote(BLOCK);

        expect(measuring(slotOf(content))).toBe(false);
    });

    it("clips nothing on a first draw, however tall what it replaces", async () => {
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 200 } as DOMRect);

        const content = await renderNote(BLOCK);

        expect(measuring(slotOf(content))).toBe(false);
    });

    it("clips nothing redrawn as written from cards never laid out", async () => {
        noteWidth = 299;
        const content = await renderNote(BLOCK);
        noteWidth = 800;
        for (const watched of widths.watched.keys()) widths.resize(watched, 800);
        await vi.advanceTimersByTimeAsync(0);

        expect(drawn(slotOf(content))).toBe(BLOCK);
        expect(measuring(slotOf(content))).toBe(false);
    });

    it("clips nothing redrawn as cards from cards", async () => {
        const base = new TFile("Bases/Views.base");
        app.metadataCache.getFirstLinkpathDest.mockReturnValue(base);
        noteWidth = 200;
        const content = await renderNote("![[Views.base]]");
        layOutAt(slotOf(content), 300);

        await bases.onBaseModified(base);

        expect(drawn(slotOf(content))).toContain("type: cards");
        expect(measuring(slotOf(content))).toBe(false);
    });
});

describe("measureHeaderMetrics", () => {
    it("measures nothing where nothing is laid out", () => {
        expect(measureHeaderMetrics(document.createElement("div"))).toBeNull();
    });

    // A header's width is its name's text, in Bases' font, plus what surrounds
    // it.
    it("reads Bases' header font and what surrounds the name", () => {
        const host = document.body.createDiv();
        // Read inside the host, the hidden header gets the same styles a real
        // header there would.
        let readInHost = false;
        vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
            readInHost = host.contains(el);
            return { font: "14px Inter" } as CSSStyleDeclaration;
        });
        vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.hasClass("bases-table-header-label") ? 50 : this.hasClass("bases-table-header-name") ? 16 : 0;
        });
        const context = { font: "", measureText: (text: string) => ({ width: text.length * 7 }) };
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((type: string) =>
            type === "2d" ? context : null) as unknown as HTMLCanvasElement["getContext"]);

        const measured = measureHeaderMetrics(host)!;

        expect(readInHost).toBe(true);

        expect(context.font).toBe("14px Inter");
        expect(measured.chrome).toBe(34);
        expect(measured.textWidth("mood")).toBe(28);
        // The hidden header leaves nothing behind.
        expect(host.children).toHaveLength(0);
        host.remove();
    });

    it.each([
        ["no font", "", 50],
        ["nothing around the name", "14px Inter", 16],
    ])("measures nothing with %s", (_case, font, labelWidth) => {
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ font } as CSSStyleDeclaration);
        vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.hasClass("bases-table-header-label") ? labelWidth : 16;
        });
        const context = { font: "", measureText: () => ({ width: 0 }) };
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            context as unknown as CanvasRenderingContext2D
        );

        expect(measureHeaderMetrics(document.createElement("div"))).toBeNull();
    });

    it("measures nothing without a canvas", () => {
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ font: "14px Inter" } as CSSStyleDeclaration);
        vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.hasClass("bases-table-header-label") ? 50 : 16;
        });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

        expect(measureHeaderMetrics(document.createElement("div"))).toBeNull();
    });
});
