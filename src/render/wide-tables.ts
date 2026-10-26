import type { Component } from "obsidian";
import type { WidthWatch } from "./note-widths";

/**
 * Labels each body cell with its column's name, and stacks a table wider than
 * the note as cards. This is checked again when the note's width changes. A
 * table may not scroll sideways inside the stream (ADR 0008). Tables drawn
 * later, as Dataview's are, get the same treatment.
 */
export function stackWideTables(contentEl: HTMLElement, noteComponent: Component, widths: WidthWatch): void {
    const fit = (tables: HTMLTableElement[]) => {
        for (const table of tables) {
            // Measure it as a grid, because stacked it is exactly as wide as
            // the note.
            table.removeClass("is-stacked");
            table.toggleClass("is-stacked", table.offsetWidth > contentEl.clientWidth + 1);
        }
    };
    const stack = (tables: HTMLTableElement[]) => {
        tables.forEach(labelColumns);
        fit(tables);
    };
    stack(Array.from(contentEl.querySelectorAll("table")));

    // Dataview fills its table over several renders: the header first, the rows
    // later.
    const added = new MutationObserver((records) => {
        const tables = new Set<HTMLTableElement>();
        for (const record of records) {
            const changed = (record.target as Element).closest("table");
            if (changed) tables.add(changed);
            for (const node of Array.from(record.addedNodes)) {
                if (node.instanceOf(HTMLElement)) tablesIn(node).forEach((table) => tables.add(table));
            }
        }
        stack([...tables]);
    });
    added.observe(contentEl, { childList: true, subtree: true });

    widths.watch(contentEl, noteComponent, () => fit(Array.from(contentEl.querySelectorAll("table"))));
    noteComponent.register(() => added.disconnect());
}

function tablesIn(el: HTMLElement): HTMLTableElement[] {
    return el.instanceOf(HTMLTableElement) ? [el] : Array.from(el.querySelectorAll("table"));
}

/**
 * A stacked cell shows its column's name, which the stylesheet reads from
 * `data-column`.
 */
function labelColumns(table: HTMLTableElement): void {
    const names = Array.from(table.querySelectorAll("thead th")).map(columnName);
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        Array.from(row.querySelectorAll<HTMLElement>(":scope > td")).forEach((cell, i) => {
            const name = names[i];
            if (name) cell.dataset.column = name;
        });
    }
}

/** Dataview's first header also holds the number of rows, in its own span. */
const RESULT_COUNT = ".dataview.small-text";

function columnName(th: Element): string {
    const name = th.cloneNode(true) as Element;
    name.querySelector(RESULT_COUNT)?.remove();
    return name.getText().trim();
}
