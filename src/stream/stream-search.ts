import type { TFile } from "obsidian";
import { findNotes } from "../notes/note-search";
import type { SearchHighlighter } from "../render/search-highlights";

/** Every daily note, and a way to read its source. */
export interface NoteSource {
    /** Newest first, the same order as the stream. */
    notes(): readonly TFile[];
    read(file: TFile): Promise<string>;
}

/** The stream, as a search moves through it. */
export interface SearchTarget {
    /**
     * Loads `file` into the stream and draws all of it, without scrolling to
     * it. Returns its block, or null if the note is gone.
     */
    ready(file: TFile): Promise<HTMLElement | null>;
    /** The block `file` is shown in, if loaded. */
    blockOf(file: TFile): HTMLElement | null;
    /** The note at the top of the pane, where a search starts from. */
    firstVisibleNote(): TFile | null;
    /**
     * Centers `range` in the pane, and keeps it there while the stream draws.
     */
    center(range: Range): Promise<void>;
    /** Whether all of `range` is inside the pane's visible area. */
    isOnScreen(range: Range): boolean;
}

/** Folded sections, which a search step opens to show the match inside. */
export interface Folds {
    /** Whether a folded section hides `node`. */
    folds(node: Node): boolean;
    /** Unfolds every section that hides `node`, without saving it. */
    unfold(node: Node): void;
}

type Direction = 1 | -1;

/**
 * Moves through the notes that match a query, counted by note, and through the
 * highlights inside each (D-022). Every call runs after the calls before it, so
 * a step waits for the search typed before it.
 */
export class StreamSearch {
    private query = "";
    private matches: TFile[] = [];
    /** The current index in `matches`. -1 before the first step. */
    // Stryker disable next-line UnaryOperator: search sets it before any step finds a match.
    private current = -1;
    /**
     * The current index in the current note's reachable ranges. -1 when it has
     * none.
     */
    // Stryker disable next-line UnaryOperator: search sets it before any step finds a match.
    private range = -1;
    private queue: Promise<void> = Promise.resolve();

    constructor(
        private readonly source: NoteSource,
        private readonly target: SearchTarget,
        private readonly highlighter: SearchHighlighter,
        private readonly folds: Folds,
        private readonly onStatus: (status: string) => void,
        /**
         * jsdom has no layout, so tests replace this function to check
         * visibility.
         */
        private readonly isShown: (range: Range) => boolean = (range) => range.getClientRects().length > 0
    ) {}

    search(query: string): Promise<void> {
        return this.run(async () => {
            this.query = query;
            this.current = -1;
            // Stryker disable next-line UnaryOperator: only read once a step has entered a note, which sets it.
            this.range = -1;
            this.highlighter.setQuery(query);
            this.matches = await this.find();
            this.markFirstOnScreen();
        });
    }

    /**
     * Reads the vault again after it changed, and stays on the current note if
     * it still matches.
     */
    refresh(): Promise<void> {
        return this.run(async () => {
            // Stryker disable next-line ConditionalExpression: an empty query finds no note, and reads none.
            if (!this.query) return;
            const file = this.matches[this.current];
            this.matches = await this.find();
            this.current = file ? this.matches.indexOf(file) : -1;
        });
    }

    close(): Promise<void> {
        return this.search("");
    }

    next(): Promise<void> {
        return this.run(() => this.step(1));
    }

    previous(): Promise<void> {
        return this.run(() => this.step(-1));
    }

    private find(): Promise<TFile[]> {
        return findNotes(this.source.notes(), (file) => this.source.read(file), this.query);
    }

    /**
     * Marks the highest match the reader can already see, as Obsidian's own
     * search bar marks one as you type. It does not scroll, so a half-typed
     * word never takes the reader years away (D-022).
     */
    private markFirstOnScreen(): void {
        for (const [index, file] of this.matches.entries()) {
            const block = this.target.blockOf(file);
            const ranges = block ? this.reachableRanges(block) : [];
            const within = ranges.findIndex((range) => this.isShown(range) && this.target.isOnScreen(range));
            if (within === -1) continue;
            this.current = index;
            this.range = within;
            this.highlighter.setCurrent(ranges[within]!);
            return;
        }
    }

    private async step(direction: Direction): Promise<void> {
        if (this.matches.length === 0) return;
        const file = this.matches[this.current];
        const block = file ? this.target.blockOf(file) : null;
        const ranges = block ? this.reachableRanges(block) : [];
        const within = this.range + direction;
        if (file && within >= 0 && within < ranges.length) {
            await this.show(ranges, within);
            return;
        }
        await this.enter(this.adjacentNote(direction), direction);
    }

    /**
     * Shows the match at `index`: its first highlight when going forward, its
     * last when going back.
     */
    private async enter(index: number, direction: Direction): Promise<void> {
        this.current = index;
        const block = await this.target.ready(this.matches[index]!);
        const ranges = block ? this.reachableRanges(block) : [];
        await this.show(ranges, direction === 1 ? 0 : ranges.length - 1);
    }

    /**
     * The next match, going round to the start after the end. The first step
     * starts from the note on screen.
     */
    private adjacentNote(direction: Direction): number {
        const count = this.matches.length;
        if (this.current !== -1) return (this.current + direction + count) % count;

        const order = this.source.notes();
        const top = this.target.firstVisibleNote();
        const from = top ? order.indexOf(top) : 0;
        // Matches are in the stream's order, so the number of matches above is
        // the index of the first one below.
        const positions = this.matches.map((file) => order.indexOf(file));
        if (direction === 1) return positions.filter((position) => position < from).length % count;
        const throughTop = positions.filter((position) => position <= from).length;
        return (throughTop - 1 + count) % count;
    }

    /**
     * Marks the range at `index` and scrolls it on screen. An index out of
     * range marks nothing.
     */
    private async show(ranges: readonly Range[], index: number): Promise<void> {
        const range = ranges[index] ?? null;
        this.range = range ? index : -1;
        if (range && !this.isShown(range)) this.folds.unfold(range.startContainer);
        this.highlighter.setCurrent(range);
        if (range) await this.target.center(range);
    }

    /** Highlights that are shown, or inside a fold that a step can open. */
    private reachableRanges(block: HTMLElement): Range[] {
        return this.highlighter
            .rangesIn(block)
            .filter((range) => this.isShown(range) || this.folds.folds(range.startContainer));
    }

    private status(): string {
        if (!this.query.trim()) return "";
        const count = this.matches.length;
        if (count === 0) return "No results";
        if (this.current === -1) return count === 1 ? "1 note" : `${count} notes`;
        // The note matched, but not in anything drawn, such as hidden
        // frontmatter or an embed.
        const hidden = this.range === -1 ? " · hidden" : "";
        return `${this.current + 1} / ${count}${hidden}`;
    }

    private run(task: () => Promise<void>): Promise<void> {
        this.queue = this.queue
            .then(task)
            .then(() => this.onStatus(this.status()))
            .catch((e) => console.error("DailyNotesStream: Search failed", e));
        return this.queue;
    }
}
