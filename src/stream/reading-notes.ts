import type { FileView, TFile } from "obsidian";
import type { Moment } from "../notes/moment";

/** A stream view's note being read (D-220). */
export interface ReadingNote {
    view: FileView;
    note: TFile;
    /** Its date, or null if its name no longer parses as one. */
    date: Moment | null;
    /**
     * True while the stream is still moving. False once it stops, or after
     * anything that changed the note without a scroll.
     */
    scrolling: boolean;
}

type Listener = (reading: ReadingNote) => void;

/**
 * Which note each stream view is reading. There is one for the plugin. It is
 * private: only our integrations listen (ADR 0024, D-221).
 */
export class ReadingNotes {
    private readonly listeners = new Set<Listener>();

    /** Gets every report, until the returned function is called. */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    report(reading: ReadingNote): void {
        for (const listener of this.listeners) listener(reading);
    }
}
