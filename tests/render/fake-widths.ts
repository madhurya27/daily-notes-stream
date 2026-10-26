import type { Component } from "obsidian";
import type { WidthWatch } from "../../src/render/note-widths";

/**
 * A `WidthWatch` without layout. `resize` passes a width to whatever watches an
 * element.
 */
export class FakeWidths implements WidthWatch {
    readonly watched = new Map<HTMLElement, Set<(width: number) => void>>();

    watch(el: HTMLElement, note: Component, refit: (width: number) => void): void {
        const refits = this.watched.get(el) ?? new Set();
        this.watched.set(el, refits);
        refits.add(refit);
        note.register(() => refits.delete(refit));
    }

    /** Reports that `el` changed width, as `NoteWidths` does. */
    resize(el: HTMLElement, width: number): void {
        for (const refit of this.watched.get(el) ?? []) refit(width);
    }

    /** How many functions watch `el` to fit it again. */
    watching(el: HTMLElement): number {
        return this.watched.get(el)?.size ?? 0;
    }
}
