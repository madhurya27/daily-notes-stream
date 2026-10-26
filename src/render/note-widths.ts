import type { Component } from "obsidian";

/**
 * What fits a note again when its width changes. In the view, this is
 * `NoteWidths`.
 */
export interface WidthWatch {
    /**
     * Calls `refit` with `el`'s width each time it changes, until `note`
     * unloads.
     */
    watch(el: HTMLElement, note: Component, refit: (width: number) => void): void;
}

/**
 * A watched element: the width it last had, and what fits it again when that
 * changes.
 */
interface Watched {
    width: number;
    refits: Set<(width: number) => void>;
}

/**
 * Watches each drawn note's width, with one observer for the view. Tables,
 * equations and Bases fit themselves again when it changes. A change in height
 * only, which is most of what a note reports, fits nothing again.
 */
export class NoteWidths implements WidthWatch {
    private readonly watched = new Map<Element, Watched>();
    /**
     * Created on the first watch. On desktop nothing needs fitting, so none is
     * needed.
     */
    private observer: ResizeObserver | null = null;

    constructor(view: Component) {
        view.register(() => this.observer?.disconnect());
    }

    watch(el: HTMLElement, note: Component, refit: (width: number) => void): void {
        let watched = this.watched.get(el);
        if (!watched) {
            watched = { width: el.clientWidth, refits: new Set() };
            this.watched.set(el, watched);
            this.observer ??= new ResizeObserver((entries) => this.refit(entries));
            this.observer.observe(el);
        }
        watched.refits.add(refit);
        note.register(() => this.unwatch(el, refit));
    }

    private refit(entries: ResizeObserverEntry[]): void {
        for (const { target } of entries) {
            const watched = this.watched.get(target);
            // A note hidden far away has no size (ADR 0023): there is no width
            // to fit, and when it comes back at its own width, nothing changed.
            if (!watched || target.clientWidth === 0 || target.clientWidth === watched.width) continue;
            watched.width = target.clientWidth;
            for (const refit of watched.refits) refit(watched.width);
        }
    }

    private unwatch(el: HTMLElement, refit: (width: number) => void): void {
        // Each refit is a new function, registered once, so its note stops
        // watching it once.
        const watched = this.watched.get(el)!;
        watched.refits.delete(refit);
        if (watched.refits.size > 0) return;
        this.watched.delete(el);
        this.observer!.unobserve(el);
    }
}
