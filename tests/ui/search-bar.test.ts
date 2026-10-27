import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { Component } from "obsidian";
import { SearchBar, SEARCH_DEBOUNCE_MS } from "../../src/ui/search-bar";

describe("SearchBar", () => {
    let actions: {
        search: Mock<(query: string) => void>;
        next: Mock<() => void>;
        previous: Mock<() => void>;
        close: Mock<() => void>;
    };
    let bar: SearchBar;
    let input: HTMLInputElement;

    beforeEach(() => {
        vi.useFakeTimers();
        actions = { search: vi.fn(), next: vi.fn(), previous: vi.fn(), close: vi.fn() };
        const component = new Component();
        component.load();
        bar = new SearchBar(component, actions);
        document.body.appendChild(bar.el);
        input = bar.el.querySelector("input")!;
    });

    afterEach(() => {
        bar.el.remove();
        vi.useRealTimers();
    });

    const press = (key: string, init: KeyboardEventInit = {}) => {
        const evt = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
        input.dispatchEvent(evt);
        return evt;
    };
    const type = (text: string) => {
        input.value = text;
        input.dispatchEvent(new Event("input"));
    };
    const button = (label: string) => bar.el.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;

    it("is Obsidian's own find bar, so its stylesheet draws it", () => {
        expect(bar.el.matches(".document-search-container")).toBe(true);
        expect(input.closest(".document-search-input")).not.toBeNull();
        expect(input.placeholder).toBe("Find...");
        // Obsidian's stylesheet matches the attribute, and an empty value still
        // counts as text.
        expect(input.getAttribute("type")).toBe("text");
        expect(button("Previous").dataset.icon).toBe("arrow-up");
        expect(button("Next").dataset.icon).toBe("arrow-down");
        expect(button("Exit search").dataset.icon).toBe("x");
        expect(input.closest(".document-search-container > .document-search")).not.toBeNull();
        expect(button("Next").matches(".document-search-buttons > .clickable-icon.document-search-button")).toBe(true);
        expect(
            button("Exit search").matches(".document-search-buttons > .clickable-icon.document-search-close-button")
        ).toBe(true);
    });

    it("starts closed", () => {
        expect(bar.isOpen).toBe(false);
        expect(bar.el.hasClass("is-closed")).toBe(true);
    });

    it("opens with the query focused and selected, to type over", () => {
        input.value = "milk";
        const select = vi.spyOn(input, "select");

        bar.open();

        expect(bar.isOpen).toBe(true);
        expect(bar.el.hasClass("is-closed")).toBe(false);
        expect(document.activeElement).toBe(input);
        expect(select).toHaveBeenCalled();
    });

    it("searches once typing pauses", () => {
        type("mi");
        type("milk");
        expect(actions.search).not.toHaveBeenCalled();

        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

        expect(actions.search.mock.calls).toEqual([["milk"]]);
    });

    it("waits for typing to pause, not for its first key", () => {
        type("m");
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
        type("mi");
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
        expect(actions.search).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(actions.search.mock.calls).toEqual([["mi"]]);
    });

    it("searches what was typed before Enter steps to the next match", () => {
        type("milk");

        const evt = press("Enter");

        expect(actions.search.mock.calls).toEqual([["milk"]]);
        expect(actions.next).toHaveBeenCalledOnce();
        expect(actions.search.mock.invocationCallOrder[0]).toBeLessThan(actions.next.mock.invocationCallOrder[0]!);
        expect(evt.defaultPrevented).toBe(true);
    });

    it("steps back on Shift+Enter", () => {
        press("Enter", { shiftKey: true });

        expect(actions.previous).toHaveBeenCalledOnce();
        expect(actions.next).not.toHaveBeenCalled();
    });

    it("closes on Escape", () => {
        bar.open();

        const evt = press("Escape");

        expect(bar.isOpen).toBe(false);
        expect(actions.close).toHaveBeenCalledOnce();
        expect(evt.defaultPrevented).toBe(true);
    });

    it("leaves other keys to the input", () => {
        const evt = press("a");

        expect(evt.defaultPrevented).toBe(false);
        expect(actions.next).not.toHaveBeenCalled();
    });

    it("steps and closes from its buttons", () => {
        bar.open();

        button("Next").click();
        button("Previous").click();
        button("Exit search").click();

        expect(actions.next).toHaveBeenCalledOnce();
        expect(actions.previous).toHaveBeenCalledOnce();
        expect(actions.close).toHaveBeenCalledOnce();
        expect(bar.isOpen).toBe(false);
    });

    it("drops a search still waiting when it closes", () => {
        type("milk");

        bar.close();
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

        expect(actions.search).not.toHaveBeenCalled();
    });

    it("searches nothing as it opens with no query", () => {
        bar.open();

        expect(actions.search).not.toHaveBeenCalled();
    });

    it("re-runs the kept query when it opens again", () => {
        type("milk");
        bar.close();

        bar.open();

        expect(actions.search.mock.calls).toEqual([["milk"]]);
    });

    it("shows the count it is given", () => {
        bar.setStatus("2 / 5");

        expect(bar.el.querySelector(".document-search-count")!.textContent).toBe("2 / 5");
    });
});
