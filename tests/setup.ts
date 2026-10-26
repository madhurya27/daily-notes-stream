/**
 * Extends jsdom's HTMLElement prototype with Obsidian's custom DOM helpers so
 * that code calling .addClass(), .createDiv(), etc. works in tests.
 */

const proto = HTMLElement.prototype;

proto.addClass = function (this: HTMLElement, ...classes: string[]) {
    for (const cls of classes) {
        for (const c of cls.trim().split(/\s+/).filter(Boolean)) {
            this.classList.add(c);
        }
    }
    return this;
};

proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
    for (const cls of classes) this.classList.remove(cls);
    return this;
};

proto.toggleClass = function (this: HTMLElement, cls: string, value?: boolean) {
    this.classList.toggle(cls, value);
    return this;
};

proto.hasClass = function (this: HTMLElement, cls: string): boolean {
    return this.classList.contains(cls);
};

proto.getText = function (this: HTMLElement) {
    return this.textContent ?? "";
};

proto.setText = function (this: HTMLElement, text: string) {
    this.textContent = text;
    return this;
};

proto.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
    return this;
};

proto.createDiv = function (this: HTMLElement, params?: { cls?: string; text?: string }) {
    const el = document.createElement("div");
    if (params?.cls) el.addClass(params.cls);
    if (params?.text) el.setText(params.text);
    this.appendChild(el);
    return el;
};

proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    params?: {
        cls?: string;
        text?: string;
        href?: string;
        type?: string;
        placeholder?: string;
        attr?: Record<string, string>;
    }
) {
    const el = document.createElement(tag);
    if (params?.cls) el.addClass(params.cls);
    if (params?.text) el.setText(params.text);
    if (params?.href) el.setAttribute("href", params.href);
    if (params?.type) el.setAttribute("type", params.type);
    if (params?.placeholder) el.setAttribute("placeholder", params.placeholder);
    for (const [name, value] of Object.entries(params?.attr ?? {})) el.setAttribute(name, value);
    this.appendChild(el);
    return el;
};

proto.createSpan = function (this: HTMLElement, params?: { cls?: string; text?: string }) {
    return this.createEl("span", params);
};

/** Obsidian's check that works across windows. Tests have one window. */
Node.prototype.instanceOf = function <T>(this: Node, type: new () => T): this is T {
    return this instanceof type;
};

/**
 * Obsidian's properties for a node's own window and document, which differ in a
 * pop-out window.
 */
Object.defineProperties(Node.prototype, {
    doc: {
        get(this: Node) {
            return this.ownerDocument ?? this;
        },
    },
    win: {
        get(this: Node) {
            return (this.ownerDocument ?? (this as Document)).defaultView ?? window;
        },
    },
});

/**
 * Obsidian's global helpers: an element built as if on a parent, then removed
 * from it.
 */
const globals = globalThis as unknown as Pick<typeof globalThis, "createEl" | "createDiv" | "createSpan">;
globals.createEl = ((tag: keyof HTMLElementTagNameMap, o?: Parameters<typeof proto.createEl>[1]) => {
    const el = document.createElement("div").createEl(tag, o);
    el.remove();
    return el;
}) as typeof createEl;
globals.createDiv = (o?: Parameters<typeof proto.createDiv>[0]) => globals.createEl("div", o);
globals.createSpan = (o?: Parameters<typeof proto.createSpan>[0]) => globals.createEl("span", o);

/** jsdom does not scroll. Obsidian runs on Chromium, which does. */
proto.scrollIntoView ??= function () {};

proto.onClickEvent = function (this: HTMLElement, handler: (e: MouseEvent) => void) {
    this.addEventListener("click", handler);
};

proto.prepend =
    proto.prepend ??
    function (this: HTMLElement, node: Node) {
        this.insertBefore(node, this.firstChild);
    };

/**
 * jsdom has no CSS object. Obsidian runs on Chromium, which has CSS.escape and
 * CSS.supports. This escapes every character outside [A-Za-z0-9_-], which is
 * stricter than the CSSOM rules, and valid wherever the result is used (an
 * identifier or a quoted value).
 */
const jsdomGaps = globalThis as { CSS?: Partial<typeof CSS>; Highlight?: typeof Highlight };

jsdomGaps.CSS ??= {
    escape: (value: string): string => value.replace(/[^\w-]/g, (c) => `\\${c}`),
    // Chromium keeps the scroll position itself. A test that acts as iOS
    // replaces this.
    supports: (property: string) => property === "overflow-anchor",
};

/**
 * jsdom has no CSS Custom Highlight API; Chromium does. A highlight is a set of
 * ranges, with priority 0 unless given another, and the registry is a map of
 * highlights by name.
 */
jsdomGaps.Highlight ??= class Highlight extends Set<AbstractRange> {
    priority = 0;
} as unknown as typeof Highlight;
jsdomGaps.CSS.highlights ??= new Map() as unknown as HighlightRegistry;

/**
 * jsdom has no layout, so nothing is drawn anywhere. A test that needs a layout
 * fakes its own.
 */
document.elementsFromPoint = () => [];
