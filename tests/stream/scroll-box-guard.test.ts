import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ScrollBoxGuard } from "../../src/stream/scroll-box-guard";
import { SCROLL_IDLE_MS } from "../../src/stream/scroll-anchor";

const still = () => vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS);

let container: HTMLElement;
let guard: ScrollBoxGuard;

/** An element that would be a scrolling box, as Obsidian's CSS makes some. */
function scrollBox(overflow = "auto"): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("style", `overflow-y: ${overflow}`);
    return el;
}

/** A `.bases-view` around a table Bases laid out `tableWidth` wide. */
function baseView(tableWidth: string): { view: HTMLElement; thead: HTMLElement } {
    const view = document.createElement("div");
    view.addClass("bases-view");
    const thead = view.createDiv({ cls: "bases-thead" });
    thead.setAttribute("style", `width: ${tableWidth}`);
    return { view, thead };
}

const laidOut = vi.fn<(view: HTMLElement) => void>();

beforeEach(() => {
    vi.useFakeTimers();
    laidOut.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    guard = new ScrollBoxGuard(laidOut);
    guard.attach(container);
});

afterEach(() => {
    guard.detach();
    container.remove();
    vi.useRealTimers();
});

/**
 * A table's wrapper, as Obsidian's reading view leaves it: set to scroll
 * sideways with an inline style.
 */
function tableWrapper(): HTMLElement {
    const el = document.createElement("div");
    el.style.setProperty("overflow-x", "auto");
    el.appendChild(document.createElement("table"));
    return el;
}

const clipped = (el: HTMLElement) => el.style.getPropertyValue("overflow-x") === "" && el.hasClass("is-scroll-clipped");

// An inline overflow-x wins over the stylesheet's clip (D-153), and a box left
// scrolling until scrolling stops would stop the scroll it appeared during.
describe("ScrollBoxGuard, an inline overflow-x", () => {
    it("is cleared and clipped as it is added, mid-scroll", async () => {
        guard.onScroll();
        const wrapper = container.appendChild(tableWrapper());

        await Promise.resolve();

        expect(clipped(wrapper)).toBe(true);
    });

    it("is cleared and clipped when nested in what was added", async () => {
        const note = document.createElement("div");
        const wrapper = note.appendChild(tableWrapper());
        container.appendChild(note);

        await Promise.resolve();

        expect(clipped(wrapper)).toBe(true);
        expect(note.hasClass("is-scroll-clipped")).toBe(false);
    });

    it("is cleared and clipped when set on an element already shown", async () => {
        const section = container.appendChild(document.createElement("div"));
        await still();

        section.style.setProperty("overflow-x", "scroll");
        await Promise.resolve();

        expect(clipped(section)).toBe(true);
    });

    it("leaves the rest of the inline style alone", async () => {
        const wrapper = tableWrapper();
        wrapper.style.setProperty("width", "10px");
        container.appendChild(wrapper);

        await Promise.resolve();

        expect(wrapper.getAttribute("style")).toBe("width: 10px;");
    });

    it("leaves an element without one unclipped", async () => {
        const section = container.appendChild(document.createElement("div"));
        section.style.setProperty("width", "10px");

        await Promise.resolve();

        expect(section.hasClass("is-scroll-clipped")).toBe(false);
    });

    // The stylesheet already clips everything in a Base.
    it("is left alone inside a Base", async () => {
        const embed = document.createElement("div");
        embed.addClass("bases-embed");
        const wrapper = embed.appendChild(tableWrapper());
        container.appendChild(embed);
        await Promise.resolve();

        wrapper.style.setProperty("overflow-x", "scroll");
        await Promise.resolve();

        expect(wrapper.style.getPropertyValue("overflow-x")).toBe("scroll");
    });
});

describe("ScrollBoxGuard safety net", () => {
    it.each(["auto", "scroll", "hidden"])("clips an added %s box once the scroll is still", async (overflow) => {
        const box = container.appendChild(scrollBox(overflow));

        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(true);
    });

    it("clips a box nested in what was added", async () => {
        const note = document.createElement("div");
        const box = note.appendChild(scrollBox());
        container.appendChild(note);

        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(true);
        expect(note.classList.contains("is-scroll-clipped")).toBe(false);
    });

    // Reading styles while scrolling makes the browser recalculate the whole
    // page's styles, just before a pause.
    it("waits while the stream scrolls", async () => {
        const box = container.appendChild(scrollBox());
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);

        guard.onScroll();
        await vi.advanceTimersByTimeAsync(SCROLL_IDLE_MS - 1);

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(box.classList.contains("is-scroll-clipped")).toBe(true);
    });

    it("leaves a box that does not scroll alone", async () => {
        const box = container.appendChild(scrollBox("visible"));

        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
    });

    // An SVG's overflow is how far it draws, not a scrolling box.
    it("skips SVG", async () => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("style", "overflow: hidden");
        container.appendChild(svg);

        await still();

        expect(svg.classList.contains("is-scroll-clipped")).toBe(false);
    });

    // The stylesheet already clips everything in a Base.
    it("skips what is added inside a Base", async () => {
        const embed = container.appendChild(document.createElement("div"));
        embed.addClass("bases-embed");
        await still();

        const box = embed.appendChild(scrollBox());
        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
    });

    it("skips a box removed before the scroll was still", async () => {
        const box = container.appendChild(scrollBox());
        await Promise.resolve();
        box.remove();

        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
    });

    it("checks each addition once", async () => {
        const box = container.appendChild(scrollBox());
        await still();
        box.removeClass("is-scroll-clipped");

        guard.onScroll();
        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
    });

    it("stops watching once detached", async () => {
        guard.detach();
        const box = container.appendChild(scrollBox());

        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
    });

    it("drops a pending check once detached", async () => {
        const box = container.appendChild(scrollBox());
        await Promise.resolve();

        guard.detach();
        expect(vi.getTimerCount()).toBe(0);
        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
    });

    it("waits on nothing while nothing is unchecked", async () => {
        container.appendChild(document.createTextNode("text"));
        await Promise.resolve();
        guard.onScroll();

        expect(vi.getTimerCount()).toBe(0);
    });

    it("watches only the container it was last attached to", async () => {
        const other = document.createElement("div");
        guard.attach(other);
        const box = container.appendChild(scrollBox());

        await still();

        expect(box.classList.contains("is-scroll-clipped")).toBe(false);
    });
});

describe("ScrollBoxGuard Bases", () => {
    /** Adds a Base's view, then forgets that it was reported. */
    async function mounted(): Promise<{ view: HTMLElement; thead: HTMLElement }> {
        const base = baseView("300px");
        container.appendChild(base.view);
        await Promise.resolve();
        laidOut.mockClear();
        return base;
    }

    it("reports a Base as it renders", async () => {
        const embed = document.createElement("div");
        embed.addClass("bases-embed");
        const { view } = baseView("600px");
        embed.appendChild(view);

        container.appendChild(embed);
        await Promise.resolve();

        expect(laidOut).toHaveBeenCalledExactlyOnceWith(view);
    });

    it("reports a Base once for a batch of changes", async () => {
        const { view, thead } = await mounted();

        thead.setAttribute("style", "width: 600px");
        view.createDiv({ cls: "bases-tr" });
        await Promise.resolve();

        expect(laidOut).toHaveBeenCalledExactlyOnceWith(view);
    });

    // Bases sets the table's width on its header row when it lays out.
    it("reports a Base when its table's width changes", async () => {
        const { view, thead } = await mounted();

        thead.setAttribute("style", "width: 600px");
        await Promise.resolve();

        expect(laidOut).toHaveBeenCalledExactlyOnceWith(view);
    });

    // Bases sets a kanban board's width on its container.
    it("reports a Base when its kanban board's width changes", async () => {
        const { view } = await mounted();
        const board = view.createDiv({ cls: "bases-kanban-container" });
        await Promise.resolve();
        laidOut.mockClear();

        board.setAttribute("style", "width: 600px");
        await Promise.resolve();

        expect(laidOut).toHaveBeenCalledExactlyOnceWith(view);
    });

    // A maximum width set when fitting is a style change on the view itself,
    // and reacting to it would loop forever.
    it("ignores other style changes in a Base", async () => {
        const { view } = await mounted();

        view.setAttribute("style", "color: red");
        await Promise.resolve();

        expect(laidOut).not.toHaveBeenCalled();
    });

    it("reports a Base when rows are added to it", async () => {
        const { view } = await mounted();

        view.createDiv({ cls: "bases-tr" });
        await Promise.resolve();

        expect(laidOut).toHaveBeenCalledExactlyOnceWith(view);
    });

    it("ignores changes outside a Base", async () => {
        await mounted();

        container.appendChild(document.createElement("p"));
        await Promise.resolve();

        expect(laidOut).not.toHaveBeenCalled();
    });
});
