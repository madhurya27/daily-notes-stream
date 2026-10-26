import { describe, it, expect, beforeEach } from "vitest";
import { Component } from "obsidian";
import { stackWideTables } from "../../src/render/wide-tables";
import { FakeWidths } from "./fake-widths";

/** jsdom has no layout, so each test sets the widths it needs. */
function setWidth(el: HTMLElement, prop: "offsetWidth" | "clientWidth", width: () => number): void {
    Object.defineProperty(el, prop, { configurable: true, get: width });
}

function table(headers: string[], rows: string[][]): HTMLTableElement {
    const el = document.createElement("table");
    const head = el.createEl("thead").createEl("tr");
    for (const text of headers) head.createEl("th", { text });
    const body = el.createEl("tbody");
    for (const row of rows) {
        const tr = body.createEl("tr");
        for (const text of row) tr.createEl("td", { text });
    }
    return el;
}

let content: HTMLElement;
let component: Component;
let noteWidth: number;
let widths: FakeWidths;

beforeEach(() => {
    widths = new FakeWidths();
    content = document.createElement("div");
    noteWidth = 400;
    setWidth(content, "clientWidth", () => noteWidth);
    component = new Component();
    component.load();
});

describe("stackWideTables", () => {
    it("names each body cell after its column", () => {
        const el = content.appendChild(table(["Day", " Pace "], [["1", "5:12"]]));

        stackWideTables(content, component, widths);

        const cells = Array.from(el.querySelectorAll("td"));
        expect(cells.map((cell) => cell.dataset.column)).toEqual(["Day", "Pace"]);
    });

    it("leaves Dataview's result count out of its first column's name", () => {
        const el = content.appendChild(table(["File"], [["a"]]));
        el.querySelector("th")!.createSpan({ cls: "dataview small-text", text: "15" });

        stackWideTables(content, component, widths);

        expect(el.querySelector("td")!.dataset.column).toBe("File");
    });

    it("leaves a cell with no header unnamed", () => {
        const el = content.appendChild(table(["Day", ""], [["1", "2", "3"]]));

        stackWideTables(content, component, widths);

        const cells = Array.from(el.querySelectorAll("td"));
        expect(cells.map((cell) => cell.dataset.column)).toEqual(["Day", undefined, undefined]);
    });

    it("stacks a table wider than the note", () => {
        const el = content.appendChild(table(["A"], [["1"]]));
        setWidth(el, "offsetWidth", () => 600);

        stackWideTables(content, component, widths);

        expect(el.classList.contains("is-stacked")).toBe(true);
    });

    it("keeps a table that fits as a grid", () => {
        const el = content.appendChild(table(["A"], [["1"]]));
        setWidth(el, "offsetWidth", () => 400);

        stackWideTables(content, component, widths);

        expect(el.classList.contains("is-stacked")).toBe(false);
    });

    // Widths are rounded, so a table one pixel wider than the note still fits.
    it("keeps a table one pixel wider than the note as a grid", () => {
        const el = content.appendChild(table(["A"], [["1"]]));
        setWidth(el, "offsetWidth", () => 401);

        stackWideTables(content, component, widths);

        expect(el.classList.contains("is-stacked")).toBe(false);
    });

    // A stacked table is exactly as wide as the note, which would say it fits.
    it("measures a stacked table as a grid", () => {
        const el = content.appendChild(table(["A"], [["1"]]));
        setWidth(el, "offsetWidth", () => (el.hasClass("is-stacked") ? 400 : 600));
        stackWideTables(content, component, widths);

        noteWidth = 399;
        widths.resize(content, 399);

        expect(el.classList.contains("is-stacked")).toBe(true);
    });

    it("re-checks when the note's width changes", () => {
        const el = content.appendChild(table(["A"], [["1"]]));
        setWidth(el, "offsetWidth", () => 600);
        stackWideTables(content, component, widths);

        noteWidth = 800;
        widths.resize(content, 800);

        expect(el.classList.contains("is-stacked")).toBe(false);
    });

    // Dataview draws its table after the note is drawn, and again on each
    // change.
    it("stacks a table drawn into the note later, named by its columns", async () => {
        stackWideTables(content, component, widths);
        const el = table(["Day"], [["1"]]);
        setWidth(el, "offsetWidth", () => 600);

        content.createDiv().appendChild(el);
        await Promise.resolve();

        expect(el.classList.contains("is-stacked")).toBe(true);
        expect(el.querySelector("td")!.dataset.column).toBe("Day");
    });

    it("passes over text drawn beside a later table", async () => {
        stackWideTables(content, component, widths);
        const el = table(["Day"], [["1"]]);
        setWidth(el, "offsetWidth", () => 600);

        content.append("3 results", el);
        await Promise.resolve();

        expect(el.classList.contains("is-stacked")).toBe(true);
    });

    // Dataview fills its table over several renders: the header first, the rows
    // later.
    it("re-checks a table as its rows arrive", async () => {
        const el = content.appendChild(table(["Day"], []));
        let width = 300;
        setWidth(el, "offsetWidth", () => width);
        stackWideTables(content, component, widths);

        width = 600;
        el.querySelector("tbody")!.createEl("tr").createEl("td", { text: "1" });
        await Promise.resolve();

        expect(el.classList.contains("is-stacked")).toBe(true);
        expect(el.querySelector("td")!.dataset.column).toBe("Day");
    });

    it("re-checks a later table when the note's width changes", async () => {
        stackWideTables(content, component, widths);
        const el = content.appendChild(table(["A"], [["1"]]));
        setWidth(el, "offsetWidth", () => 600);
        await Promise.resolve();

        noteWidth = 800;
        widths.resize(content, 800);

        expect(el.classList.contains("is-stacked")).toBe(false);
    });

    it("stops watching once the note unloads", async () => {
        content.appendChild(table(["A"], [["1"]]));
        stackWideTables(content, component, widths);

        component.unload();
        const later = content.appendChild(table(["A"], [["1"]]));
        setWidth(later, "offsetWidth", () => 600);
        await Promise.resolve();

        expect(widths.watching(content)).toBe(0);
        expect(later.classList.contains("is-stacked")).toBe(false);
    });
});
