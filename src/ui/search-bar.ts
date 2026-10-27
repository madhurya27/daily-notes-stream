import { Component, debounce, setIcon } from "obsidian";

/** Long enough that a word typed quickly is only searched once. */
export const SEARCH_DEBOUNCE_MS = 250;

/** An icon button, with a name for screen readers and tooltips. */
function labeled(el: HTMLElement, icon: string, label: string): HTMLElement {
    setIcon(el, icon);
    el.setAttribute("aria-label", label);
    return el;
}

export interface SearchBarActions {
    search(query: string): void;
    next(): void;
    previous(): void;
    close(): void;
}

/**
 * The search bar, with the same markup as Obsidian's own, so Obsidian's
 * stylesheet draws it. Enter goes forward, Shift+Enter goes back, and Escape
 * closes it. The query is kept after it closes, as Obsidian's is.
 */
export class SearchBar {
    readonly el: HTMLElement;
    private readonly inputEl: HTMLInputElement;
    private readonly countEl: HTMLElement;

    constructor(
        component: Component,
        private readonly actions: SearchBarActions
    ) {
        this.el = createDiv();
        this.el.addClass("document-search-container", "daily-notes-search", "is-closed");
        const search = this.el.createDiv({ cls: "document-search" });

        const field = search.createDiv({ cls: "search-input-container document-search-input" });
        this.inputEl = field.createEl("input", { type: "text", placeholder: "Find..." });
        this.countEl = field.createDiv({ cls: "document-search-count" });

        const buttons = search.createDiv({ cls: "document-search-buttons" });
        const button = () => buttons.createEl("button", { cls: "clickable-icon document-search-button" });
        const previous = labeled(button(), "arrow-up", "Previous");
        const next = labeled(button(), "arrow-down", "Next");
        const exit = labeled(
            buttons.createDiv({ cls: "clickable-icon document-search-close-button" }),
            "x",
            "Exit search"
        );

        component.registerDomEvent(this.inputEl, "input", () => this.searchTyped());
        component.registerDomEvent(this.inputEl, "keydown", (evt) => this.onKeydown(evt));
        component.registerDomEvent(previous, "click", () => actions.previous());
        component.registerDomEvent(next, "click", () => actions.next());
        component.registerDomEvent(exit, "click", () => this.close());
    }

    get isOpen(): boolean {
        return !this.el.hasClass("is-closed");
    }

    /** Shows the bar with its query selected, and searches for it again. */
    open(): void {
        this.el.removeClass("is-closed");
        this.inputEl.focus();
        this.inputEl.select();
        if (this.inputEl.value) this.actions.search(this.inputEl.value);
    }

    close(): void {
        this.searchTyped.cancel();
        this.el.addClass("is-closed");
        this.actions.close();
    }

    setStatus(status: string): void {
        this.countEl.setText(status);
    }

    private readonly searchTyped = debounce(() => this.actions.search(this.inputEl.value), SEARCH_DEBOUNCE_MS, true);

    private onKeydown(evt: KeyboardEvent): void {
        if (evt.key === "Escape") {
            this.close();
        } else if (evt.key === "Enter") {
            this.searchTyped.run();
            if (evt.shiftKey) this.actions.previous();
            else this.actions.next();
        } else {
            return;
        }
        evt.preventDefault();
    }
}
