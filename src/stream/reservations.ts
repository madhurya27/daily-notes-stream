import type { TFile } from "obsidian";
import type { NoteHeights } from "./note-heights";

/** The parts of an empty note's window that decide its height. */
export interface Reserving {
    file: TFile;
    /**
     * The height it keeps: measured when it was last unloaded, or the estimate.
     */
    height: number;
    /**
     * Whether `height` was measured, in this session or an earlier one, rather
     * than guessed.
     */
    measured: boolean;
}

/** What changes when empty blocks get new heights after scrolling stops. */
export interface ReservePlan {
    /** The blocks that should now get their note's `height`. */
    changed: [HTMLElement, Reserving][];
    /**
     * How far the blocks entirely above the pane move. The anchor shows this
     * move first (ADR 0015).
     */
    movedAbove: number;
}

/**
 * The height each empty note keeps, and whether the empty blocks need new
 * heights because more heights were measured, or the layout changed (ADR 0014).
 */
export class Reservations {
    /** The layout the empty notes expect heights for. */
    private expectedIn: string | null = null;
    /**
     * What the empty blocks' heights were last based on: the heights' revision,
     * and the layout.
     */
    private reservedFrom: string;

    constructor(
        private readonly heights: NoteHeights,
        /** The height for a note not measured in a layout (D-092). */
        private readonly estimate: (layout: string, path: string) => number | undefined
    ) {
        this.reservedFrom = this.key();
    }

    get owed(): boolean {
        return this.reservedFrom !== this.key();
    }

    /**
     * Sets `note`'s height to what it last measured in `layout`, or the
     * estimate there. If there is neither, as just after the screen turned, it
     * keeps its height until the notes on screen are measured.
     */
    expect(note: Reserving, layout: string): void {
        const remembered = this.heights.heightOf(layout, note.file.path);
        note.height = remembered ?? this.estimate(layout, note.file.path) ?? note.height;
        note.measured = remembered !== undefined;
    }

    /**
     * A new note, given a height from what is known now. The others too, unless
     * they already need new heights.
     */
    add(note: Reserving, layout: string): void {
        const owed = this.owed;
        this.expectedIn = layout;
        this.expect(note, layout);
        if (!owed) this.reservedFrom = this.key();
    }

    /**
     * Whether `layout` is new. If so, the empty notes need the heights they
     * measured there.
     */
    expectLayout(layout: string): boolean {
        if (layout === this.expectedIn) return false;
        this.expectedIn = layout;
        return true;
    }

    /**
     * Each empty note's block, to give it the height it is now expected to
     * have. Null while the new heights would make the stream shorter by more
     * than `roomBelow` the pane, because the browser would then pull the scroll
     * back. Once planned, nothing more is needed.
     */
    plan(
        unloaded: Iterable<[HTMLElement, Reserving]>,
        layout: string,
        paneTop: number,
        roomBelow: number
    ): ReservePlan | null {
        const key = this.key();
        const changed: [HTMLElement, Reserving][] = [];
        let movedAbove = 0;
        let shrinkBelow = 0;
        for (const [block, note] of unloaded) {
            if (!note.measured) this.expect(note, layout);
            const reserved = parseFloat(block.style.getPropertyValue("--daily-note-placeholder-height"));
            if (reserved === note.height) continue;
            changed.push([block, note]);
            if (isAbove(block, paneTop)) movedAbove += note.height - reserved;
            else shrinkBelow += reserved - note.height;
        }
        if (shrinkBelow > roomBelow) return null;
        this.reservedFrom = key;
        return { changed, movedAbove };
    }

    private key(): string {
        return `${this.heights.revision}\n${this.expectedIn}`;
    }
}

/**
 * Whether the block is entirely above the pane's top. A block not laid out, in
 * a hidden tab, is nowhere.
 */
function isAbove(block: HTMLElement, paneTop: number): boolean {
    const { bottom, height } = block.getBoundingClientRect();
    return height > 0 && bottom <= paneTop;
}
