import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi, type MockInstance } from "vitest";
import { Component, TFile } from "obsidian";
import { CollapsibleManager, LINKED_MENTIONS_SECTION_KEY, PROPERTIES_SECTION_KEY } from "../../src/render/collapsible";
import type { CollapsibleStateStore } from "../../src/render/collapse-store";
import { FarRuns } from "../../src/render/far-runs";
import { fake } from "../stream-view-fixture";

function makeStore(collapsedByDefault = false): CollapsibleStateStore {
    return fake<CollapsibleStateStore>({
        isCollapsed: vi.fn().mockReturnValue(collapsedByDefault),
        collapsedOr: vi.fn().mockReturnValue(collapsedByDefault),
        setCollapsed: vi.fn(),
        clearForFile: vi.fn(),
        retainSections: vi.fn(),
    });
}

/**
 * Sets up the shared listeners the way the view does, then adds the fold
 * arrows.
 */
const delegateComponent = new Component();

function makeCollapsible(manager: CollapsibleManager, content: HTMLElement, filePath: string): void {
    manager.delegate(delegateComponent, content);
    CollapsibleManager.prototype.makeCollapsible.call(manager, content, filePath);
}

/** Fold toggles are bound to the arrow, not the whole heading or list item. */
function clickChevron(el: HTMLElement): void {
    (el.querySelector(":scope > .collapse-indicator") as HTMLElement).click();
}

describe("CollapsibleManager — keyboard and ARIA", () => {
    let store: ReturnType<typeof makeStore>;
    let manager: CollapsibleManager;

    function chevron(el: HTMLElement): HTMLElement {
        return el.querySelector(":scope > .collapse-indicator") as HTMLElement;
    }

    function press(el: HTMLElement, key: string): void {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }

    beforeEach(() => {
        store = makeStore();
        manager = new CollapsibleManager(store);
    });

    it("exposes each chevron as a focusable button", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");

        const indicator = chevron(content.querySelector("h2") as HTMLElement);
        expect(indicator.getAttribute("role")).toBe("button");
        expect(indicator.getAttribute("tabindex")).toBe("0");
    });

    it("reports the section state through aria-expanded", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        const indicator = chevron(content.querySelector("h2") as HTMLElement);

        expect(indicator.getAttribute("aria-expanded")).toBe("true");
        indicator.click();
        expect(indicator.getAttribute("aria-expanded")).toBe("false");
    });

    it("starts with aria-expanded false for a stored collapsed section", () => {
        store = makeStore(true);
        manager = new CollapsibleManager(store);
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");

        expect(chevron(content.querySelector("h2") as HTMLElement).getAttribute("aria-expanded")).toBe("false");
    });

    it("toggles on Enter and Space", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        const header = content.querySelector("h2") as HTMLElement;

        press(chevron(header), "Enter");
        expect(header.classList.contains("is-collapsed")).toBe(true);

        press(chevron(header), " ");
        expect(header.classList.contains("is-collapsed")).toBe(false);
    });

    it("ignores other keys", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        const header = content.querySelector("h2") as HTMLElement;

        press(chevron(header), "a");

        expect(header.classList.contains("is-collapsed")).toBe(false);
        expect(store.setCollapsed).not.toHaveBeenCalled();
    });

    it("prevents Space from scrolling the stream", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        const indicator = chevron(content.querySelector("h2") as HTMLElement);

        const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
        indicator.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });

    it("stops a key it toggles on at the stream root", () => {
        const outer = document.createElement("div");
        const content = outer.appendChild(document.createElement("div"));
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        const onOuterKey = vi.fn();
        outer.addEventListener("keydown", onOuterKey);

        press(chevron(content.querySelector("h2") as HTMLElement), "Enter");

        expect(onOuterKey).not.toHaveBeenCalled();
    });

    it("draws each chevron as Obsidian's", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");

        expect(chevron(content.querySelector("h2") as HTMLElement).dataset.icon).toBe("chevron-right");
    });

    it("gives list-item chevrons the same treatment", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Task<ul><li>sub</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        const li = content.querySelector("li") as HTMLElement;

        press(chevron(li), "Enter");

        expect(li.classList.contains("is-collapsed")).toBe(true);
        expect(chevron(li).getAttribute("aria-expanded")).toBe("false");
    });
});

describe("CollapsibleManager — duplicate section keys", () => {
    let store: ReturnType<typeof makeStore>;
    let manager: CollapsibleManager;

    beforeEach(() => {
        store = makeStore();
        manager = new CollapsibleManager(store);
    });

    it("suffixes repeated header text so each heading keeps its own state", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Notes</h2><p>a</p><h2>Notes</h2><p>b</p><h2>Notes</h2><p>c</p>";
        makeCollapsible(manager, content, "file.md");

        const headers = content.querySelectorAll("h2");
        clickChevron(headers[0] as HTMLElement);
        clickChevron(headers[1] as HTMLElement);
        clickChevron(headers[2] as HTMLElement);

        expect(store.setCollapsed).toHaveBeenNthCalledWith(1, "file.md", "notes", true);
        expect(store.setCollapsed).toHaveBeenNthCalledWith(2, "file.md", "notes#2", true);
        expect(store.setCollapsed).toHaveBeenNthCalledWith(3, "file.md", "notes#3", true);
    });

    it("suffixes repeated list items at the same depth", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Task<ul><li>a</li></ul></li><li>Task<ul><li>b</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");

        const items = content.querySelectorAll(":scope > ul > li");
        clickChevron(items[0] as HTMLElement);
        clickChevron(items[1] as HTMLElement);

        expect(store.setCollapsed).toHaveBeenNthCalledWith(1, "file.md", "li-1-task", true);
        expect(store.setCollapsed).toHaveBeenNthCalledWith(2, "file.md", "li-1-task#2", true);
    });

    it("keeps a repeated heading's key apart from a heading that reads like its suffix", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Foo</h2><h2>Foo</h2><h2>Foo 2</h2>";

        const keys = manager.makeCollapsible(content, "file.md");

        expect(new Set(keys).size).toBe(3);
    });

    it("counts headers and list items separately", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Task</h2><ul><li>Task<ul><li>a</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");

        clickChevron(content.querySelector("h2") as HTMLElement);
        clickChevron(content.querySelector("li") as HTMLElement);

        expect(store.setCollapsed).toHaveBeenNthCalledWith(1, "file.md", "task", true);
        expect(store.setCollapsed).toHaveBeenNthCalledWith(2, "file.md", "task/li-1-task", true);
    });
});

describe("CollapsibleManager — keys by the heading above", () => {
    const keysOf = (html: string) => {
        const content = document.createElement("div");
        content.innerHTML = html;
        return new CollapsibleManager(makeStore()).makeCollapsible(content, "file.md");
    };
    const list = (text: string) => `<ul><li>${text}<ul><li>a</li></ul></li></ul>`;

    it("keys a list item by the heading it sits under", () => {
        expect(keysOf(`<h2>Day 35</h2>${list("Errands")}`)).toEqual(["day-35", "day-35/li-1-errands"]);
    });

    // Otherwise, deleting the first would pass its saved state to the second.
    it("numbers a repeated list item only under the same heading", () => {
        expect(keysOf(`<h2>Mon</h2>${list("Errands")}<h2>Tue</h2>${list("Errands")}`)).toEqual([
            "mon",
            "tue",
            "mon/li-1-errands",
            "tue/li-1-errands",
        ]);
    });

    it("keys a heading by the heading it sits under, and a top-level one bare", () => {
        expect(keysOf("<h1>Morning</h1><h2>Notes</h2><h1>Evening</h1><h2>Notes</h2>")).toEqual([
            "morning",
            "morning/notes",
            "evening",
            "evening/notes",
        ]);
    });

    it("keys a list item by the nearest heading above, at any level", () => {
        expect(keysOf(`<h1>Day</h1><h3>Errands</h3>${list("Shop")}<h2>Later</h2>${list("Call")}`)).toEqual([
            "day",
            "day/errands",
            "day/later",
            "errands/li-1-shop",
            "later/li-1-call",
        ]);
    });

    it("finds the heading above a list wrapped in a block of its own", () => {
        expect(keysOf(`<h2>Plan</h2><div>${list("Errands")}</div>`)).toEqual(["plan", "plan/li-1-errands"]);
    });

    // A heading inside a list item is not a section of its own (Obsidian's
    // reading view folds none there).
    it("keys a list item by the heading above the list, past one inside an item", () => {
        expect(keysOf(`<h2>Plan</h2><ul><li><h3>Aside</h3></li><li>Errands<ul><li>a</li></ul></li></ul>`)).toEqual([
            "plan",
            "plan/li-1-errands",
        ]);
    });

    it("keys a list item above every heading bare", () => {
        expect(keysOf(`${list("Errands")}<h2>Plan</h2>`)).toEqual(["plan", "li-1-errands"]);
    });
});

describe("CollapsibleManager — headers", () => {
    let store: ReturnType<typeof makeStore>;
    let manager: CollapsibleManager;

    beforeEach(() => {
        store = makeStore();
        manager = new CollapsibleManager(store);
    });

    it("adds is-collapsible class to each header", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>Heading</h1>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("h1")!.classList.contains("is-collapsible")).toBe(true);
    });

    it("prepends a collapse-indicator span inside the header", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Section</h2>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("h2 > .collapse-indicator")).not.toBeNull();
    });

    it("reads initial state from store and adds is-collapsed when true", () => {
        store = makeStore(true);
        manager = new CollapsibleManager(store);
        const content = document.createElement("div");
        content.innerHTML = "<h1>Title</h1><p>Content</p>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("h1")!.classList.contains("is-collapsed")).toBe(true);
    });

    it("applies is-hidden to siblings when initially collapsed", () => {
        store = makeStore(true);
        manager = new CollapsibleManager(store);
        const content = document.createElement("div");
        content.innerHTML = "<h1>Title</h1><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("p")!.classList.contains("is-hidden")).toBe(true);
    });

    it("clicking inside the heading (not the chevron) does not toggle collapse", () => {
        const content = document.createElement("div");
        content.innerHTML = '<h1>Title <a class="internal-link">Link</a></h1><p>Body</p>';
        makeCollapsible(manager, content, "file.md");

        (content.querySelector("a") as HTMLElement).click();

        expect(content.querySelector("h1")!.classList.contains("is-collapsed")).toBe(false);
        expect(store.setCollapsed).not.toHaveBeenCalled();
    });

    it("toggles the heading once and stops the click at the stream root", () => {
        // With a shared listener, the click does pass through the heading to
        // reach the root. It must not go any further than the stream.
        const outer = document.createElement("div");
        const content = outer.appendChild(document.createElement("div"));
        content.innerHTML = "<h1>Title</h1><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        const onOuterClick = vi.fn();
        outer.addEventListener("click", onOuterClick);

        (content.querySelector("h1 > .collapse-indicator") as HTMLElement).click();

        expect(content.querySelector("h1")!.classList.contains("is-collapsed")).toBe(true);
        expect(store.setCollapsed).toHaveBeenCalledTimes(1);
        expect(onOuterClick).not.toHaveBeenCalled();
    });

    it("chevron click hides siblings until next same-level heading", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>A</h1><p>Para</p><h1>B</h1><p>After B</p>";
        makeCollapsible(manager, content, "file.md");
        const [h1a] = Array.from(content.querySelectorAll("h1")) as HTMLElement[];
        clickChevron(h1a!);
        const [p1, p2] = Array.from(content.querySelectorAll("p")) as HTMLElement[];
        expect(p1!.classList.contains("is-hidden")).toBe(true);
        expect(p2!.classList.contains("is-hidden")).toBe(false);
    });

    it("chevron click stops at a higher-level heading", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Sub</h2><p>Body</p><h1>Top</h1>";
        makeCollapsible(manager, content, "file.md");
        clickChevron(content.querySelector("h2") as HTMLElement);
        expect(content.querySelector("p")!.classList.contains("is-hidden")).toBe(true);
        expect(content.querySelector("h1")!.classList.contains("is-hidden")).toBe(false);
    });

    it("chevron click persists state to store with slugified key", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>My Heading</h1>";
        makeCollapsible(manager, content, "file.md");
        clickChevron(content.querySelector("h1") as HTMLElement);
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "my-heading", true);
    });

    it("second chevron click un-collapses header and removes is-hidden from siblings", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>Title</h1><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        const h1 = content.querySelector("h1") as HTMLElement;
        clickChevron(h1); // collapse
        clickChevron(h1); // uncollapse
        expect(h1.classList.contains("is-collapsed")).toBe(false);
        expect(content.querySelector("p")!.classList.contains("is-hidden")).toBe(false);
    });

    it("skips headers that are direct children of a list item (no chevron added)", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li><h2>Heading in list</h2></li></ul>";
        makeCollapsible(manager, content, "file.md");
        const h2 = content.querySelector("h2")!;
        expect(h2.classList.contains("is-collapsible")).toBe(false);
        expect(h2.querySelector(".collapse-indicator")).toBeNull();
    });

    it("processes all header levels h1–h6", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>";
        makeCollapsible(manager, content, "file.md");
        for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
            expect(content.querySelector(tag)!.classList.contains("is-collapsible")).toBe(true);
        }
    });

    it("slugifies heading text: special chars are stripped, spaces become hyphens", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>Hello World!</h1>";
        makeCollapsible(manager, content, "file.md");
        clickChevron(content.querySelector("h1") as HTMLElement);
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "hello-world", true);
    });

    // With a slug of "", every such heading was keyed by its position, and its
    // fold moved to another heading once one was added above.
    it.each([
        ["Задачи на день", "задачи-на-день"],
        ["今日のメモ", "今日のメモ"],
        ["Café ☕ notes", "café-notes"],
        ["आज के काम", "आज-के-काम"],
    ])("keeps the letters of a heading in any script: %s", (heading, key) => {
        const content = document.createElement("div");
        content.innerHTML = `<h1>${heading}</h1>`;
        makeCollapsible(manager, content, "file.md");
        clickChevron(content.querySelector("h1") as HTMLElement);
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", key, true);
    });

    it("leading and trailing hyphens are removed from slug", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>---Section---</h1>";
        makeCollapsible(manager, content, "file.md");
        clickChevron(content.querySelector("h1") as HTMLElement);
        // "---Section---" → lower case "---section---" → replace runs of other
        // characters → "-section-" → remove dashes at the ends → "section"
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "section", true);
    });

    it("hides lower-level headings during collapse (h2 after h1 is hidden, not a break)", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>Top</h1><h2>Sub</h2><p>Body</p>";
        makeCollapsible(manager, content, "file.md");
        clickChevron(content.querySelector("h1") as HTMLElement);
        // An h2 (level 2) is lower than an h1 (level 1), so it does not end the
        // section, and the h2 must be hidden.
        expect(content.querySelector("h2")!.classList.contains("is-hidden")).toBe(true);
        expect(content.querySelector("p")!.classList.contains("is-hidden")).toBe(true);
    });

    it("expanding a header keeps nested collapsed sections collapsed", () => {
        const content = document.createElement("div");
        content.innerHTML = '<h2>Top</h2><p id="a">A</p><h3>First</h3><p id="b">B</p><h3>Second</h3><p id="c">C</p>';
        makeCollapsible(manager, content, "file.md");
        const h2 = content.querySelector("h2") as HTMLElement;
        const [first, second] = Array.from(content.querySelectorAll("h3")) as HTMLElement[];

        clickChevron(first!); // collapse the first h3
        clickChevron(h2); // collapse the h2
        clickChevron(h2); // expand the h2

        expect(first!.classList.contains("is-hidden")).toBe(false);
        expect(second!.classList.contains("is-hidden")).toBe(false);
        expect(content.querySelector("#a")!.classList.contains("is-hidden")).toBe(false);
        expect(content.querySelector("#b")!.classList.contains("is-hidden")).toBe(true);
        expect(content.querySelector("#c")!.classList.contains("is-hidden")).toBe(false);
    });

    it("nested collapsed section stays collapsed only until a same-or-higher heading", () => {
        const content = document.createElement("div");
        content.innerHTML =
            '<h2>Top</h2><h3>Inner</h3><p id="b">B</p><h4>Deep</h4><p id="c">C</p><h3>Next</h3><p id="d">D</p>';
        makeCollapsible(manager, content, "file.md");
        const h2 = content.querySelector("h2") as HTMLElement;
        const inner = content.querySelector("h3") as HTMLElement;

        clickChevron(inner);
        clickChevron(h2);
        clickChevron(h2);

        expect(content.querySelector("#b")!.classList.contains("is-hidden")).toBe(true);
        expect(content.querySelector("h4")!.classList.contains("is-hidden")).toBe(true);
        expect(content.querySelector("#c")!.classList.contains("is-hidden")).toBe(true);
        expect(content.querySelector("#d")!.classList.contains("is-hidden")).toBe(false);
    });
});

describe("CollapsibleManager — lists", () => {
    let store: ReturnType<typeof makeStore>;
    let manager: CollapsibleManager;

    beforeEach(() => {
        store = makeStore();
        manager = new CollapsibleManager(store);
    });

    it("adds is-collapsible to li that has a nested list", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Parent<ul><li>Child</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("ul > li")!.classList.contains("is-collapsible")).toBe(true);
    });

    it("does not add is-collapsible to li without a nested list", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Leaf item</li></ul>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("li")!.classList.contains("is-collapsible")).toBe(false);
    });

    it("prepends collapse-indicator inside collapsible li", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Item<ul><li>Sub</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("ul > li > .collapse-indicator")).not.toBeNull();
    });

    it("applies is-collapsed from store to list item", () => {
        store = makeStore(true);
        manager = new CollapsibleManager(store);
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Item<ul><li>Sub</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("ul > li")!.classList.contains("is-collapsed")).toBe(true);
    });

    it("indicator click collapses list item and calls store.setCollapsed", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Item<ul><li>Sub</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        const indicator = content.querySelector("ul > li > .collapse-indicator") as HTMLElement;
        indicator.click();
        expect(content.querySelector("ul > li")!.classList.contains("is-collapsed")).toBe(true);
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "li-1-item", true);
    });

    it("second indicator click un-collapses list item", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Item<ul><li>Sub</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        const indicator = content.querySelector("ul > li > .collapse-indicator") as HTMLElement;
        indicator.click();
        indicator.click();
        expect(content.querySelector("ul > li")!.classList.contains("is-collapsed")).toBe(false);
    });

    it("uses a depth-and-text-based key: top-level list item has depth 1", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>A<ul><li>Sub</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        (content.querySelector("ul > li > .collapse-indicator") as HTMLElement).click();
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "li-1-a", true);
    });

    it("derives the key from the item's own text, ignoring nested sub-list content (stable across edits elsewhere)", () => {
        const content = document.createElement("div");
        content.innerHTML = `
            <ul>
                <li>Alpha<ul><li>Sub-A</li></ul></li>
                <li>Beta<ul><li>Sub-B</li></ul></li>
            </ul>`;
        makeCollapsible(manager, content, "file.md");
        const indicators = Array.from(content.querySelectorAll<HTMLElement>("ul > li > .collapse-indicator"));
        indicators[0]!.click();
        indicators[1]!.click();
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "li-1-alpha", true);
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "li-1-beta", true);
    });

    it("counts an ordered list in a list item's depth", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ol><li>Item<ol><li>Sub</li></ol></li></ol>";

        expect(manager.makeCollapsible(content, "file.md")).toEqual(["li-1-item"]);
    });

    it("keys a list item by all of its own text, formatting and all", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ul><li><strong>Bold</strong> item<ul><li>Sub</li></ul></li></ul>";

        expect(manager.makeCollapsible(content, "file.md")).toEqual(["li-1-bold-item"]);
    });

    it("starts a list item with no saved state expanded", () => {
        const fresh = fake<CollapsibleStateStore>({
            collapsedOr: vi.fn((_path: string, _key: string, fallback: boolean) => fallback),
            setCollapsed: vi.fn(),
        });
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Item<ul><li>Sub</li></ul></li></ul>";

        new CollapsibleManager(fresh).makeCollapsible(content, "file.md");

        expect(content.querySelector("li")!.classList.contains("is-collapsed")).toBe(false);
    });

    it("handles ol (ordered list) as nested container", () => {
        const content = document.createElement("div");
        content.innerHTML = "<ol><li>Item<ol><li>Sub</li></ol></li></ol>";
        makeCollapsible(manager, content, "file.md");
        expect(content.querySelector("ol > li")!.classList.contains("is-collapsible")).toBe(true);
    });
});

describe("CollapsibleManager — delegated listeners", () => {
    let store: ReturnType<typeof makeStore>;
    let manager: CollapsibleManager;
    let root: HTMLElement;
    let component: Component;
    let registerDomEvent: MockInstance<Component["registerDomEvent"]>;

    beforeEach(() => {
        store = makeStore();
        manager = new CollapsibleManager(store);
        root = document.createElement("div");
        document.body.appendChild(root);
        component = new Component();
        registerDomEvent = vi.spyOn(component, "registerDomEvent");
    });

    afterEach(() => root.remove());

    function heading(): HTMLElement {
        const h = document.createElement("h1");
        h.setText("Section");
        root.appendChild(h);
        manager.attachCollapseToggle(h, {
            filePath: "Notes/2026-01-01.md",
            sectionKey: "section",
            defaultCollapsed: false,
            apply: vi.fn(),
            hides: () => false,
        });
        return h.querySelector(".collapse-indicator") as HTMLElement;
    }

    it("binds nothing to the chevron itself", () => {
        // Fold arrows are created again every time a note is re-rendered. A
        // listener for each arrow would pile up on the view until it closes.
        heading().click();
        expect(store.setCollapsed).not.toHaveBeenCalled();
    });

    it("registers one listener pair on the root, whatever the chevron count", () => {
        manager.delegate(component, root);
        heading();
        heading();
        heading();
        expect(registerDomEvent).toHaveBeenCalledTimes(2);
        expect(registerDomEvent.mock.calls.map((c) => c[1])).toEqual(["click", "keydown"]);
    });

    it("toggles the chevron a delegated click landed on", () => {
        manager.delegate(component, root);
        heading().click();
        expect(store.setCollapsed).toHaveBeenCalledWith("Notes/2026-01-01.md", "section", true);
    });

    it("ignores a delegated click outside any chevron", () => {
        manager.delegate(component, root);
        heading();
        root.click();
        expect(store.setCollapsed).not.toHaveBeenCalled();
    });

    it("ignores Enter pressed outside any chevron", () => {
        manager.delegate(component, root);
        heading();
        root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        expect(store.setCollapsed).not.toHaveBeenCalled();
    });
});

describe("CollapsibleManager — unfolding for search", () => {
    let store: ReturnType<typeof makeStore>;
    let manager: CollapsibleManager;
    let content: HTMLElement;

    beforeEach(() => {
        store = makeStore(true);
        manager = new CollapsibleManager(store);
        content = document.createElement("div");
        content.innerHTML =
            "<h2>Top</h2><p id='a'>A</p>" +
            "<h3>Inner</h3><ul><li id='item'>Item<ul><li id='deep'>Deep</li></ul></li></ul>" +
            "<h2>Other</h2><p id='b'>B</p>";
        makeCollapsible(manager, content, "file.md");
    });

    const text = (id: string) => content.querySelector(`#${id}`)!.firstChild!;
    const hidden = (el: Element) => el.classList.contains("is-hidden") || el.closest(".is-hidden") !== null;

    it("knows which text a collapsed section hides", () => {
        expect(manager.folds(text("a"))).toBe(true);
        expect(manager.folds(text("deep"))).toBe(true);
        expect(manager.folds(content.querySelector("h2")!.lastChild!)).toBe(false);
    });

    it("hides nothing once every section is expanded", () => {
        store = makeStore(false);
        manager = new CollapsibleManager(store);
        makeCollapsible(manager, content, "fresh.md");
        expect(manager.folds(text("deep"))).toBe(false);
    });

    it("unfolds every section around the text, and only those", () => {
        manager.unfold(text("deep"));

        const [top, other] = Array.from(content.querySelectorAll("h2"));
        expect(top!.classList.contains("is-collapsed")).toBe(false);
        expect(content.querySelector("h3")!.classList.contains("is-collapsed")).toBe(false);
        expect(content.querySelector("#item")!.classList.contains("is-collapsed")).toBe(false);
        expect(hidden(content.querySelector("#deep")!)).toBe(false);
        expect(other!.classList.contains("is-collapsed")).toBe(true);
        expect(hidden(content.querySelector("#b")!)).toBe(true);
        expect(manager.folds(text("deep"))).toBe(false);
    });

    it("saves nothing, so a re-render folds it again", () => {
        manager.unfold(text("deep"));
        expect(store.setCollapsed).not.toHaveBeenCalled();
    });

    it("leaves a section unfolded for search open as the note's sections refresh", () => {
        const top = content.querySelector("h2") as HTMLElement;
        manager.unfold(text("a"));

        manager.refreshCollapsible(content, "file.md");

        expect(top.classList.contains("is-collapsed")).toBe(false);
    });

    it("collapses an unfolded section on the next click, and says so", () => {
        const top = content.querySelector("h2") as HTMLElement;
        manager.unfold(text("a"));
        expect(top.querySelector(".collapse-indicator")!.getAttribute("aria-expanded")).toBe("true");

        clickChevron(top);

        expect(top.classList.contains("is-collapsed")).toBe(true);
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "top", true);
    });
});

describe("CollapsibleManager — stale sections", () => {
    const HOUR_MS = 60 * 60 * 1000;
    let store: ReturnType<typeof makeStore>;
    let manager: CollapsibleManager;

    /** A note last written `hoursAgo` hours ago. */
    function noteWritten(hoursAgo: number): TFile {
        const file = new TFile("file.md");
        file.stat.mtime = Date.now() - hoursAgo * HOUR_MS;
        return file;
    }

    beforeEach(() => {
        store = makeStore();
        manager = new CollapsibleManager(store);
    });

    it("hands back the key of every section it made", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h2>Notes</h2><h2>Notes</h2><ul><li>Task<ul><li>a</li></ul></li></ul>";

        expect(manager.makeCollapsible(content, "file.md")).toEqual(["notes", "notes#2", "notes/li-1-task"]);
    });

    it("forgets the sections a settled note no longer has, keeping the properties panel's and the footer's", () => {
        manager.forgetRemovedSections(noteWritten(25), ["notes"]);

        expect(store.retainSections).toHaveBeenCalledWith(
            "file.md",
            new Set(["notes", PROPERTIES_SECTION_KEY, LINKED_MENTIONS_SECTION_KEY])
        );
    });

    it("forgets the sections of a note written a day ago to the millisecond", () => {
        const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
        onTestFinished(() => now.mockRestore());

        manager.forgetRemovedSections(noteWritten(24), ["notes"]);

        expect(store.retainSections).toHaveBeenCalled();
    });

    it("forgets nothing of a note written in the last day: a heading may be mid-edit", () => {
        manager.forgetRemovedSections(noteWritten(23), ["notes"]);

        expect(store.retainSections).not.toHaveBeenCalled();
    });
});

describe("CollapsibleManager — refreshing after sections re-render in place", () => {
    it("passes over a collapsed chevron it did not draw", () => {
        const manager = new CollapsibleManager(makeStore());
        const content = document.createElement("div");
        content.innerHTML = '<h2>Plan</h2><span class="collapse-indicator" aria-expanded="false"></span>';

        expect(() => manager.refreshCollapsible(content, "file.md")).not.toThrow();
    });

    it("gives a kept heading or list item no second chevron, and returns every key", () => {
        const manager = new CollapsibleManager(makeStore());
        const content = document.createElement("div");
        content.innerHTML = "<h2>Plan</h2><ul><li>Errands<ul><li>Post office</li></ul></li></ul>";
        manager.makeCollapsible(content, "file.md");
        content.createEl("h2", { text: "Later" });

        expect(manager.refreshCollapsible(content, "file.md")).toEqual(["plan", "later", "plan/li-1-errands"]);
        expect(content.querySelectorAll(".collapse-indicator")).toHaveLength(3);
    });

    // As rendering the whole note would: the element takes the key, and that
    // key's saved state.
    it("re-keys a kept list item whose key moved, showing and saving that key's state", () => {
        const store = makeStore();
        vi.mocked(store.collapsedOr).mockImplementation((_path, key) => key === "li-1-errands#2");
        const manager = new CollapsibleManager(store);
        const content = document.createElement("div");
        content.innerHTML = "<ul><li>Errands<ul><li>Post office</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        const kept = content.querySelector("li")!;
        content.insertAdjacentHTML("afterbegin", "<ul><li>Errands<ul><li>Bank</li></ul></li></ul>");

        expect(manager.refreshCollapsible(content, "file.md")).toEqual(["li-1-errands", "li-1-errands#2"]);
        expect(kept.hasClass("is-collapsed")).toBe(true);
        expect(kept.querySelectorAll(":scope > .collapse-indicator")).toHaveLength(1);

        clickChevron(kept);
        expect(store.setCollapsed).toHaveBeenCalledWith("file.md", "li-1-errands#2", false);
    });

    // D-136: the key includes the heading above, so renaming a heading unfolds
    // what is under it.
    it("opens a kept list item under a renamed heading, whose key has no saved state", () => {
        const store = makeStore();
        vi.mocked(store.collapsedOr).mockImplementation((_path, key) => key === "errands/li-1-shopping");
        const manager = new CollapsibleManager(store);
        const content = document.createElement("div");
        content.innerHTML = "<h2>Errands</h2><ul><li>Shopping<ul><li>Milk</li></ul></li></ul>";
        makeCollapsible(manager, content, "file.md");
        const kept = content.querySelector("li")!;
        content.querySelector("h2")!.replaceWith(Object.assign(document.createElement("h2"), { textContent: "To do" }));

        expect(kept.hasClass("is-collapsed")).toBe(true);
        expect(manager.refreshCollapsible(content, "file.md")).toEqual(["to-do", "to-do/li-1-shopping"]);
        expect(kept.hasClass("is-collapsed")).toBe(false);
    });
});

describe("CollapsibleManager — runs hidden when far (ADR 0021)", () => {
    let manager: CollapsibleManager;
    let content: HTMLElement;
    const p = (text: string) => Array.from(content.querySelectorAll("p")).find((el) => el.textContent === text)!;

    beforeEach(() => {
        // Every element is shown and one line tall, because jsdom has no
        // layout.
        manager = new CollapsibleManager(
            makeStore(),
            new FarRuns(() => ({ top: 0, bottom: 20, marginTop: 0, marginBottom: 0 }))
        );
        content = document.createElement("div");
        content.innerHTML = "<h2>A</h2><p>1</p><p>2</p><h2>B</h2><p>3</p>";
        document.body.append(content);
        makeCollapsible(manager, content, "file.md");
    });

    afterEach(() => content.remove());

    it("shows the runs in a section before collapsing it, and leaves the rest hidden", () => {
        manager.farRuns.hide([p("1"), p("2")]);
        manager.farRuns.hide([p("3")]);

        clickChevron(content.querySelector("h2")!);

        expect(p("1").hasClass("is-far") || p("2").hasClass("is-far")).toBe(false);
        expect(p("1").hasClass("is-hidden") && p("2").hasClass("is-hidden")).toBe(true);
        expect(content.querySelectorAll(".daily-note-far-run")).toHaveLength(1);
        expect(p("3").hasClass("is-far")).toBe(true);
    });

    it("shows the runs in a section before opening it", () => {
        clickChevron(content.querySelector("h2")!);
        manager.farRuns.hide([p("1"), p("2")]);

        clickChevron(content.querySelector("h2")!);

        expect(content.querySelector(".is-far, .is-hidden, .daily-note-far-run")).toBeNull();
    });

    it("counts a far run as a fold search can open", () => {
        manager.farRuns.hide([p("3")]);
        const text = p("3").firstChild!;

        expect(manager.folds(text)).toBe(true);
        expect(manager.folds(p("1").firstChild!)).toBe(false);

        manager.unfold(text);

        expect(p("3").hasClass("is-far")).toBe(false);
        expect(manager.folds(text)).toBe(false);
    });
});
