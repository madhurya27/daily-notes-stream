import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "obsidian";
import { NoteWidths } from "../../src/render/note-widths";

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    observed = new Set<Element>();
    disconnected = false;
    constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this);
    }
    observe(el: Element) {
        this.observed.add(el);
    }
    unobserve(el: Element) {
        this.observed.delete(el);
    }
    disconnect() {
        this.disconnected = true;
    }
    /** Reports `targets`, as the platform does after a layout. */
    report(...targets: Element[]) {
        this.callback(
            targets.map((target) => ({ target }) as ResizeObserverEntry),
            this
        );
    }
}

/** jsdom has no layout, so this element is as wide as `width()` says. */
function noteContent(width: () => number): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, get: width });
    return el;
}

function loaded(): Component {
    const component = new Component();
    component.load();
    return component;
}

let view: Component;
let widths: NoteWidths;
const observer = () => FakeResizeObserver.instances[0]!;

beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    view = loaded();
    widths = new NoteWidths(view);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("NoteWidths", () => {
    it("refits a note with its new width", () => {
        let width = 400;
        const content = noteContent(() => width);
        const refit = vi.fn();
        widths.watch(content, loaded(), refit);

        width = 800;
        observer().report(content);

        expect(refit).toHaveBeenCalledExactlyOnceWith(800);
    });

    // A height change is reported too, and measuring then would be wasted
    // layout work.
    it("refits nothing when only the height changed", () => {
        const content = noteContent(() => 400);
        const refit = vi.fn();
        widths.watch(content, loaded(), refit);

        observer().report(content);

        expect(refit).not.toHaveBeenCalled();
    });

    // A note hidden far from the screen has no size (ADR 0023), so there is no
    // width to fit.
    it("refits nothing while a note lays out at nothing, nor once it is back at its width", () => {
        let width = 400;
        const content = noteContent(() => width);
        const refit = vi.fn();
        widths.watch(content, loaded(), refit);

        width = 0;
        observer().report(content);
        width = 400;
        observer().report(content);

        expect(refit).not.toHaveBeenCalled();
    });

    it("watches every note through one observer, refitting only the note that changed", () => {
        let wide = 400;
        const [first, second] = [noteContent(() => wide), noteContent(() => 400)];
        const [refitFirst, refitSecond] = [vi.fn(), vi.fn()];
        widths.watch(first, loaded(), refitFirst);
        widths.watch(second, loaded(), refitSecond);

        wide = 800;
        observer().report(first, second);

        expect(FakeResizeObserver.instances).toHaveLength(1);
        expect(refitFirst).toHaveBeenCalledOnce();
        expect(refitSecond).not.toHaveBeenCalled();
    });

    // Tables, equations and Bases each fit themselves again in the same note.
    it("runs every refit of a note", () => {
        let width = 400;
        const content = noteContent(() => width);
        const note = loaded();
        const [tables, equations] = [vi.fn(), vi.fn()];
        widths.watch(content, note, tables);
        widths.watch(content, note, equations);

        width = 800;
        observer().report(content);

        expect(tables).toHaveBeenCalledWith(800);
        expect(equations).toHaveBeenCalledWith(800);
    });

    it("stops watching a note once it unloads", () => {
        let width = 400;
        const content = noteContent(() => width);
        const note = loaded();
        const refit = vi.fn();
        widths.watch(content, note, refit);

        note.unload();
        width = 800;
        observer().report(content);

        expect(observer().observed.has(content)).toBe(false);
        expect(refit).not.toHaveBeenCalled();
    });

    // A note drawn again into the same element, as happens when it is drawn
    // again.
    it("watches a note again once watched afresh after it unloaded", () => {
        let width = 400;
        const content = noteContent(() => width);
        const first = loaded();
        widths.watch(content, first, vi.fn());
        first.unload();
        const refit = vi.fn();

        widths.watch(content, loaded(), refit);
        width = 800;
        observer().report(content);

        expect(observer().observed.has(content)).toBe(true);
        expect(refit).toHaveBeenCalledExactlyOnceWith(800);
    });

    it("makes no observer until a note is watched", () => {
        expect(FakeResizeObserver.instances).toEqual([]);
    });

    // Its tables' function stops watching first. The equations' function keeps
    // watching until it stops too.
    it("watches a note until every refit of it is gone", () => {
        const content = noteContent(() => 400);
        const [tables, equations] = [loaded(), loaded()];
        widths.watch(content, tables, vi.fn());
        widths.watch(content, equations, vi.fn());

        tables.unload();
        expect(observer().observed.has(content)).toBe(true);
        equations.unload();
        expect(observer().observed.has(content)).toBe(false);
    });

    it("stops watching altogether once the view closes", () => {
        widths.watch(
            noteContent(() => 400),
            loaded(),
            vi.fn()
        );

        view.unload();

        expect(observer().disconnected).toBe(true);
    });
});
