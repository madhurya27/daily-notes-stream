import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { DailyNotesStreamView } from "../../src/ui/stream-view";
import { BASE_RESIZED } from "../../src/render/bases/note-bases";
import { ItemView, Platform, TFile, WorkspaceLeaf } from "../mocks/obsidian";
import {
    asApp,
    flushPromises,
    makeApp,
    makePlugin,
    makeService,
    makeStubbedView,
    makeViewSetup,
} from "../stream-view-fixture";

describe("DailyNotesStreamView — view API", () => {
    let view: DailyNotesStreamView;

    beforeEach(async () => {
        ({ view } = await makeViewSetup());
    });

    it("getViewType returns 'daily-notes-stream-view'", () => {
        expect(view.getViewType()).toBe("daily-notes-stream-view");
    });

    it("getDisplayText returns 'Daily Notes Stream'", () => {
        expect(view.getDisplayText()).toBe("Daily Notes Stream");
    });

    it("is navigable, so the status bar stops describing the last note while the stream has focus", () => {
        expect(view.navigation).toBe(true);
    });

    it("hands Obsidian's history its place in the stream", () => {
        const place = { path: "Notes/2025-01-05.md", offset: -150 };
        vi.spyOn(view["stream"], "place").mockReturnValue(place);

        expect(view.getEphemeralState()).toEqual({ place });
    });

    it("hands Obsidian's history nothing for an empty stream", () => {
        vi.spyOn(view["stream"], "place").mockReturnValue(null);

        expect(view.getEphemeralState()).toEqual({});
    });

    it("returns to the place Obsidian's history hands back", () => {
        const restorePlace = vi.spyOn(view["stream"], "restorePlace").mockResolvedValue();
        const place = { path: "Notes/2025-01-05.md", offset: -150 };

        view.setEphemeralState({ place });

        expect(restorePlace).toHaveBeenCalledWith(place);
    });

    // The plugin now remembers heights (ADR 0010). A history entry from before
    // still contains them.
    it("returns to a place an earlier version kept heights with", () => {
        const restorePlace = vi.spyOn(view["stream"], "restorePlace").mockResolvedValue();
        const place = { path: "a.md", offset: 0, layout: { width: 700, heights: { "a.md": 540 } } };

        view.setEphemeralState({ place });

        expect(restorePlace).toHaveBeenCalledWith(place);
    });

    it.each([undefined, {}, { place: "top" }, { place: { path: 3, offset: 0 } }, { place: { path: "a.md" } }])(
        "ignores a state it did not write: %o",
        (state) => {
            const restorePlace = vi.spyOn(view["stream"], "restorePlace");

            view.setEphemeralState(state);

            expect(restorePlace).not.toHaveBeenCalled();
        }
    );

    it("getIcon returns 'gallery-vertical-end'", () => {
        expect(view.getIcon()).toBe("gallery-vertical-end");
    });

    // Back builds the view again, so what its Bases measured must last longer
    // than the view.
    it("draws Bases from the measurements the plugin keeps for every view", () => {
        const plugin = makePlugin();
        const freshView = new DailyNotesStreamView(new WorkspaceLeaf(asApp(makeApp())), plugin, makeService());

        expect(freshView["renderer"]["bases"]["measured"]).toBe(plugin.layoutMemory.bases);
    });

    // Back builds the view again, and the app restarts. What notes measured
    // must last through both.
    it("reserves the heights the plugin keeps for every view", () => {
        const plugin = makePlugin();
        const freshView = new DailyNotesStreamView(new WorkspaceLeaf(asApp(makeApp())), plugin, makeService());

        expect(freshView["stream"]["window"]["heights"]).toBe(plugin.layoutMemory.notes);
    });

    it("gives the renderer a live view of the plugin settings", async () => {
        const plugin = makePlugin();
        const app = makeApp();
        app.metadataCache.getFileCache = vi.fn().mockReturnValue({ frontmatter: { mood: "happy" } });
        const freshView = new DailyNotesStreamView(new WorkspaceLeaf(asApp(app)), plugin, makeService());

        plugin.settings = {
            showProperties: true,
            propertiesCollapsed: false,
            showLinkedMentions: false,
            linkedMentionsCollapsed: false,
            hideEmptyNotes: false,
            oneCardPerRow: false,
        }; // as loadSettings() would
        const file = new TFile("Notes/2025-01-01.md");
        const renderer = freshView["renderer"];
        const el = renderer.createBlock(file);
        await renderer.renderInto(el, file);

        expect(el.querySelector(".metadata-container")).not.toBeNull();
    });
});

describe("DailyNotesStreamView — today's note", () => {
    // Today's note is the one written in. It is drawn by section, so its saves
    // draw only part of it again (ADR 0019).
    it("asks the service whether a note it renders is today's", async () => {
        const plugin = makePlugin();
        const service = makeService();
        const view = new DailyNotesStreamView(new WorkspaceLeaf(asApp(makeApp())), plugin, service);
        const file = new TFile("Notes/2025-01-01.md");
        const renderer = view["renderer"];

        await renderer.renderInto(renderer.createBlock(file), file);

        expect(service.isToday).toHaveBeenCalledWith("Notes/2025-01-01.md");
    });
});

describe("DailyNotesStreamView — onResize", () => {
    // Obsidian calls onResize when the pane is dragged or the device turns.
    it("passes the resize on to the window", async () => {
        const { view } = await makeViewSetup();
        view.onResize();
        expect(view["stream"]["window"].onResize).toHaveBeenCalled();
    });
});

describe("DailyNotesStreamView — scroll", () => {
    // Emptying notes waits for scrolling to stop, so the window must hear every
    // scroll.
    it("tells the window the stream scrolled", async () => {
        const { view } = await makeViewSetup();
        view.contentEl.dispatchEvent(new Event("scroll"));
        expect(view["stream"]["window"].onScroll).toHaveBeenCalled();
    });

    // A touch is the reader's own change to a note, so no held height may hide
    // it.
    it("tells the window what the reader touched", async () => {
        const { view } = await makeViewSetup();
        const touched = view.contentEl.createDiv();
        touched.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(view["stream"]["window"].onTouch).toHaveBeenCalledWith(touched);
    });

    // Its note's height is fixed again in the same task the Base set its height
    // in (D-108).
    it("tells the window which Base set its height", async () => {
        const { view } = await makeViewSetup();
        const slot = view.contentEl.createDiv();
        slot.dispatchEvent(new Event(BASE_RESIZED, { bubbles: true }));
        expect(view["stream"]["window"].onBaseResized).toHaveBeenCalledWith(slot);
    });

    it("tells the window when a finger goes down and lifts", async () => {
        const { view } = await makeViewSetup();
        const window = view["stream"]["window"];
        const touched = view.contentEl.createDiv();
        touched.dispatchEvent(new Event("touchstart", { bubbles: true }));
        expect(window.onFingerDown).toHaveBeenCalledTimes(1);
        touched.dispatchEvent(new Event("touchend", { bubbles: true }));
        touched.dispatchEvent(new Event("touchcancel", { bubbles: true }));
        expect(window.onFingerUp).toHaveBeenCalledTimes(2);
    });

    // A search keeps its match in place until the reader moves the pane.
    it("tells the stream the reader wheeled", async () => {
        const { view } = await makeViewSetup();
        const onWheel = vi.spyOn(view["stream"], "onWheel");
        view.contentEl.dispatchEvent(new Event("wheel"));
        expect(onWheel).toHaveBeenCalled();
    });
});

describe("DailyNotesStreamView — header title", () => {
    /** An open view whose header has the title Obsidian draws there. */
    async function withTitle() {
        const setup = makeStubbedView();
        const titleEl = document.createElement("div");
        Object.assign(setup.view, { titleEl });
        await setup.view.onOpen();
        return { ...setup, titleEl };
    }

    afterEach(() => {
        Platform.isMobile = false;
    });

    // In iOS apps, a tap on the title bar scrolls to the top.
    it("scrolls the stream to its top on a tap of the title, on mobile", async () => {
        Platform.isMobile = true;
        const { view, titleEl } = await withTitle();

        titleEl.click();

        expect(view["stream"]["window"].scrollToTop).toHaveBeenCalledOnce();
    });

    it("scrolls the stream to its top on the command's call", async () => {
        const { view } = await withTitle();

        view.scrollToTop();

        expect(view["stream"]["window"].scrollToTop).toHaveBeenCalledOnce();
    });

    it("re-estimates the stream's notes once their heights are forgotten", async () => {
        const { view } = await withTitle();

        view.forgetHeights();

        expect(view["stream"]["window"].forgetHeights).toHaveBeenCalledOnce();
    });

    it("scrolls the stream to its top from a header button, on desktop", async () => {
        const { view } = await withTitle();

        view.actions
            .find((a) => a.icon === "arrow-up-to-line" && a.title === "Scroll to top")!
            .callback(new MouseEvent("click"));

        expect(view["stream"]["window"].scrollToTop).toHaveBeenCalledOnce();
    });

    // There, the title does it.
    it("has no scroll to top button on mobile", async () => {
        Platform.isMobile = true;
        const { view } = await withTitle();

        expect(view.actions.map((a) => a.title)).not.toContain("Scroll to top");
    });

    it("leaves the title alone on desktop", async () => {
        const { view, titleEl } = await withTitle();

        titleEl.click();

        expect(view["stream"]["window"].scrollToTop).not.toHaveBeenCalled();
    });

    it("opens without a title to tap", async () => {
        Platform.isMobile = true;
        const { view } = makeStubbedView();
        await expect(view.onOpen()).resolves.toBeUndefined();
    });
});

describe("DailyNotesStreamView — onOpen", () => {
    // Its first batch must already leave out hidden notes (ADR 0011).
    it("opens the stream only once the service has listed its notes", async () => {
        const { view, service } = makeStubbedView();
        let listed!: () => void;
        vi.mocked(service.initialize).mockReturnValue(new Promise((resolve) => (listed = resolve)));

        const opened = view.onOpen();
        await flushPromises();
        expect(view["stream"]["scroll"].attach).not.toHaveBeenCalled();

        listed();
        await opened;
        expect(view["stream"]["scroll"].attach).toHaveBeenCalled();
    });

    // Obsidian restores the pane before the vault is indexed. Closing it then
    // asks for its place.
    it("hands Obsidian's history nothing while the notes are still being listed", async () => {
        const { view, service } = makeStubbedView();
        vi.mocked(service.initialize).mockReturnValue(new Promise(() => {}));

        void view.onOpen();
        await flushPromises();

        expect(view.getEphemeralState()).toEqual({});
    });

    // Obsidian resizes a pane at startup, while the vault is still indexing.
    // The stream has no container yet to read the layout from.
    it("ignores a resize while the notes are still being listed", async () => {
        const { view, service } = makeStubbedView();
        vi.mocked(service.initialize).mockReturnValue(new Promise(() => {}));

        void view.onOpen();
        await flushPromises();

        view.onResize();

        expect(view["stream"]["window"].onResize).not.toHaveBeenCalled();
    });

    it("forgets no heights while the notes are still being listed", async () => {
        const { view, service } = makeStubbedView();
        vi.mocked(service.initialize).mockReturnValue(new Promise(() => {}));

        void view.onOpen();
        await flushPromises();

        view.forgetHeights();

        expect(view["stream"]["window"].forgetHeights).not.toHaveBeenCalled();
    });

    it("never opens a stream closed while its notes were being listed", async () => {
        const { view, service } = makeStubbedView();
        let listed!: () => void;
        vi.mocked(service.initialize).mockReturnValue(new Promise((resolve) => (listed = resolve)));

        const opened = view.onOpen();
        await flushPromises();
        await view.onClose();
        listed();
        await opened;

        expect(view["stream"]["scroll"].attach).not.toHaveBeenCalled();
    });
});

describe("DailyNotesStreamView — wiring", () => {
    it("draws the notes into a container of their own", async () => {
        const { view } = await makeViewSetup();

        const container = view.contentEl.querySelector(":scope > .daily-notes-stream-container");

        expect(container).not.toBeNull();
        expect(view["collapsible"].delegate).toHaveBeenCalledWith(view, container);
        expect(view["renderer"].delegate).toHaveBeenCalledWith(view, container);
    });

    it("follows Obsidian's readable line length, as it is set and as it changes", async () => {
        const app = makeApp();
        Object.assign(app.vault, { config: { readableLineLength: true } });
        const { view } = await makeViewSetup(app);
        expect(view.contentEl.hasClass("is-readable-line-width")).toBe(true);

        Object.assign(app.vault, { config: { readableLineLength: false } });
        const cssChange = app.workspace.on.mock.calls.find(([name]) => name === "css-change")![1];
        cssChange();

        expect(view.contentEl.hasClass("is-readable-line-width")).toBe(false);
    });

    it("names its jump action", async () => {
        const { view } = await makeViewSetup();

        expect(view.actions.find((a) => a.icon === "calendar-1")?.title).toBe("Jump to date");
    });

    // A wheel or touch listener that may cancel the event delays scrolling
    // until it returns.
    it("listens to the wheel and to fingers without holding the scroll", async () => {
        const { view } = makeStubbedView();
        const listen = vi.spyOn(view, "registerDomEvent");

        await view.onOpen();

        for (const type of ["wheel", "touchstart", "touchend", "touchcancel"])
            expect(listen).toHaveBeenCalledWith(view.contentEl, type, expect.any(Function), { passive: true });
    });

    it("hands the rest of a history entry's state to Obsidian", async () => {
        const { view } = await makeViewSetup();
        const handOn = vi.spyOn(ItemView.prototype, "setEphemeralState");
        const state = { place: null, scroll: 3 };

        view.setEphemeralState(state);

        expect(handOn).toHaveBeenCalledWith(state);
        handOn.mockRestore();
    });

    it("closes the stream as the view closes", async () => {
        const { view } = await makeViewSetup();
        const close = vi.spyOn(view["stream"], "close");

        await view.onClose();

        expect(close).toHaveBeenCalledOnce();
    });
});

describe("DailyNotesStreamView — refresh", () => {
    // The plugin calls it when its own settings change. The rebuild is tested
    // in note-stream.test.ts.
    it("rebuilds the stream", async () => {
        const { view } = await makeViewSetup();
        const rebuild = vi.spyOn(view["stream"], "refresh");

        await view.refresh();

        expect(rebuild).toHaveBeenCalledOnce();
    });
});

describe("DailyNotesStreamView — hover parent", () => {
    // Page preview attaches its popup to the view, and unloads it with the
    // view.
    it("starts with no popover", () => {
        const { view } = makeStubbedView(makeApp());
        expect(view.hoverPopover).toBeNull();
    });
});
