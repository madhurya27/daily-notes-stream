import { App, debounce } from "obsidian";
import { BaseMeasurements } from "../render/bases/base-measurements";
import { NoteHeights } from "./note-heights";

/**
 * Kept for each vault and each device, because a height is only correct on the
 * screen that measured it.
 */
export const LAYOUT_MEMORY_KEY = "daily-notes-stream:layout";
/**
 * Change this when the saved format changes. The old data is then thrown away,
 * which is fine for a cache.
 */
const VERSION = 5;
/**
 * Delay from the first of several quick changes, so a long scroll still saves
 * as it goes.
 */
export const SAVE_DELAY_MS = 1000;

/**
 * The most characters saved for a vault. All of a device's vaults and plugins
 * share localStorage, which holds about 5.2 million characters on iOS (D-195).
 */
export const SAVED_SIZE_LIMIT = 600_000;

/**
 * What the stream measured, kept between sessions, so a note not yet rendered
 * in this session still gets its real height (docs/adr/0010-layout-memory.md).
 * There is one for the plugin, which every view shares.
 */
export class LayoutMemory {
    readonly notes = new NoteHeights(
        () => this.saveSoon(),
        (path) => this.app.vault.getFileByPath(path)?.stat
    );
    readonly bases = new BaseMeasurements(() => this.saveSoon());
    private readonly saveSoon = debounce(() => this.save(), SAVE_DELAY_MS);

    constructor(
        private readonly app: App,
        private readonly limit = SAVED_SIZE_LIMIT
    ) {
        const saved: unknown = app.loadLocalStorage(LAYOUT_MEMORY_KEY);
        if (!isVersion(saved)) return;
        this.notes.restore(saved.notes);
        this.bases.restore(saved.bases);
    }

    /** Moves a note's measurements to its new path. */
    rename(oldPath: string, newPath: string): void {
        this.notes.rename(oldPath, newPath);
        this.bases.rename(oldPath, newPath);
    }

    forget(path: string): void {
        this.notes.forget(path);
        this.bases.forget(path);
    }

    /**
     * Forgets notes deleted or changed while the plugin was not running to see
     * it.
     */
    retainOnly(paths: ReadonlySet<string>): void {
        this.notes.retainOnly(paths);
        this.bases.retainOnly(paths);
    }

    /** Starts again with nothing measured, as on a new device. */
    forgetAll(): void {
        this.retainOnly(new Set());
    }

    /** Saves a waiting change now, because the plugin is unloading. */
    flush(): void {
        this.saveSoon.run();
    }

    /** About how many characters a save writes. */
    savedSize(): number {
        return this.notes.savedSize() + this.bases.savedSize();
    }

    private save(): void {
        while (this.savedSize() > this.limit) this.shrink();
        this.app.saveLocalStorage(LAYOUT_MEMORY_KEY, {
            version: VERSION,
            notes: this.notes.toJSON(),
            bases: this.bases.toJSON(),
        });
    }

    /**
     * Forgets the layout used longest ago. In the last layout, forgets the
     * notes changed longest ago.
     */
    private shrink(): void {
        const [oldest, next] = this.notes.layouts();
        if (next === undefined) {
            this.bases.retainOnly(this.notes.forgetLeastRecentlyChanged());
        } else {
            this.notes.forgetLayout(oldest!);
            this.bases.forgetLayout(oldest!);
        }
    }
}

function isVersion(saved: unknown): saved is { notes: unknown; bases: unknown } {
    // Stryker disable next-line ConditionalExpression: a primitive has no version either.
    return typeof saved === "object" && saved !== null && (saved as { version?: unknown }).version === VERSION;
}

/**
 * The layout `column` uses for notes: its width, or the width given to check
 * against, and the text size notes are drawn at. On a phone, iOS's text size
 * setting changes the text size. Theme margins, line width and pane size all
 * affect the width.
 */
export function layoutOf(column: HTMLElement, width = column.clientWidth): string {
    // Stryker disable next-line MethodExpression: jsdom trims a custom property's value, as browsers have since 2021; older ones kept the space.
    const textSize = getComputedStyle(column).getPropertyValue("--font-preferred-size").trim();
    return `${width}:${textSize}`;
}
