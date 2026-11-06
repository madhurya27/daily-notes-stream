import type { Debouncer, TFile } from "obsidian";
import { SCROLL_IDLE_MS } from "./scroll-anchor";
import type { ViewTimers } from "./view-timers";

/**
 * When to report a view's note being read (D-220). While scrolling, at once
 * whenever it changes, so a visible calendar keeps up. Once scrolling stops,
 * again if it changed since the last stop, so a hidden one catches up (ADR
 * 0024).
 */
export class ReadingNoteWatch {
    private lastScrolled: TFile | null = null;
    private lastStopped: TFile | null = null;
    /** Reports at the next stop even if the note is the same. */
    // Stryker disable next-line BooleanLiteral: the first stop reports anyway, as nothing has been reported yet.
    private announce = false;
    private readonly stopped: Debouncer<[], void>;

    constructor(
        private readonly read: () => TFile | null,
        private readonly report: (note: TFile, scrolling: boolean) => void,
        timers: ViewTimers
    ) {
        this.stopped = timers.debounce(() => this.onStop(), SCROLL_IDLE_MS, true);
    }

    onScroll(): void {
        const note = this.read();
        if (note && note !== this.lastScrolled) {
            this.lastScrolled = note;
            this.report(note, true);
        }
        this.stopped();
    }

    /**
     * Reports the note once things are still, even if it has not changed:
     * after opening, focus, a refresh, or a delete or rename, which changes a
     * note's date without changing its `TFile`.
     */
    announceSoon(): void {
        this.announce = true;
        this.stopped();
    }

    private onStop(): void {
        const note = this.read();
        if (!note) return;
        this.lastScrolled = note;
        if (note === this.lastStopped && !this.announce) return;
        this.announce = false;
        this.lastStopped = note;
        this.report(note, false);
    }
}
