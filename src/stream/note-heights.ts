import { LayoutTable, type SavedLayoutTable } from "./layout-table";

export interface SavedNoteHeights {
    /** Heights by path, the oldest layout first. */
    heights: SavedLayoutTable<number>;
    /** Each note's change time when it was measured. */
    mtimes: [path: string, mtime: number][];
}

/** What a note's estimate reads from its file. */
export interface NoteStat {
    mtime: number;
    size: number;
}

/** The share of notes kept each time the oldest are forgotten (D-195). */
const SHARE_KEPT = 0.9;

/** What a height saves besides its path: `["",12345.515625],` */
const HEIGHT_CHARS = 18;
/** What a change time saves besides its path: `["",1793318400000],` */
const MTIME_CHARS = 19;

/** A layout's estimates, worked out from the heights measured in it (D-135). */
interface Learned {
    /** The height that 90% of heights are below, and never the tallest one. */
    tail: number;
    /**
     * The most pixels per byte of any note measured. Undefined if no note had
     * any bytes.
     */
    densest: number | undefined;
}

/**
 * Each note's last measured height, for each layout: the height its empty block
 * keeps until it is re-rendered. A note that changed since it was measured is
 * forgotten, and estimated from its text again (ADR 0017).
 */
export class NoteHeights {
    private readonly table: LayoutTable<number>;
    /**
     * Each layout's worked-out estimates, kept until one of its heights
     * changes.
     */
    private readonly learned = new Map<string, Learned>();
    private changes = 0;
    private mtimes = new Map<string, number>();

    constructor(
        changed: () => void = () => {},
        /** A note's file as it is now. Undefined once it is gone. */
        private readonly statOf: (path: string) => NoteStat | undefined = () => undefined,
        limit?: number
    ) {
        this.table = new LayoutTable(
            (value): value is number => typeof value === "number",
            (layout) => {
                this.learned.delete(layout);
                this.changes++;
                changed();
            },
            limit
        );
    }

    heightOf(layout: string, path: string): number | undefined {
        return this.table.get(layout, path);
    }

    /**
     * `path`'s height in each layout that measured it. Reading this does not
     * count as using a layout.
     */
    heightsOf(path: string): [layout: string, height: number][] {
        return this.table.valuesOf(path);
    }

    /** Every layout, starting with the one used longest ago. */
    layouts(): string[] {
        return this.table.layoutNames();
    }

    /** Heights by path in `layout`. Reading this does not count as using it. */
    entries(layout: string): [path: string, height: number][] {
        return this.table.entries(layout);
    }

    /**
     * The number of changes so far. While it stays the same, the estimates
     * worked out from the heights are still correct.
     */
    get revision(): number {
        return this.changes;
    }

    /**
     * Saves a height, rounded to the 1/64 pixel the browser lays out in.
     * Rounding more would make an empty block differ from the rendered note
     * (D-105).
     */
    keep(layout: string, path: string, height: number): void {
        const mtime = this.statOf(path)?.mtime;
        if (mtime !== undefined) this.mtimes.set(path, mtime);
        const px = Math.round(height * 64) / 64;
        if (this.heightOf(layout, path) !== px) this.table.set(layout, path, px);
    }

    /**
     * An estimated height for `path`, which was not measured in `layout`: the
     * height that 90% of the layout's measured heights are below. This leans
     * tall, because scrolling up past notes taller than their estimate runs out
     * of scroll before the top (D-092). It is never just the tallest height. It
     * is limited to the note's file size times the most pixels per byte
     * measured, so one long note cannot set every estimate. But it is never
     * below `floor`, because a title and frame take space but no bytes (D-135).
     * Undefined if the layout measured nothing.
     */
    estimate(layout: string, path: string, floor = 0): number | undefined {
        const learned = this.learn(layout);
        const size = this.statOf(path)?.size;
        if (learned?.densest === undefined || size === undefined) return learned?.tail;
        return Math.min(learned.tail, Math.max(size * learned.densest, floor));
    }

    private learn(layout: string): Learned | undefined {
        const known = this.learned.get(layout);
        if (known !== undefined) return known;
        const entries = this.table.entries(layout);
        const sorted = entries.map(([, height]) => height).sort((a, b) => a - b);
        const belowTallest = Math.min(Math.floor(sorted.length * 0.9), sorted.length - 2);
        const tail = sorted[Math.max(belowTallest, 0)];
        // Stryker disable next-line ConditionalExpression: with no heights, there are no rates, and the estimate is undefined either way.
        if (tail === undefined) return undefined;
        const rates = entries.map(([path, height]) => height / (this.statOf(path)?.size ?? 0)).filter(Number.isFinite);
        const learned = { tail, densest: rates.length > 0 ? Math.max(...rates) : undefined };
        this.learned.set(layout, learned);
        return learned;
    }

    rename(oldPath: string, newPath: string): void {
        this.table.rename(oldPath, newPath);
        const mtime = this.mtimes.get(oldPath);
        this.mtimes.delete(oldPath);
        if (mtime !== undefined) this.mtimes.set(newPath, mtime);
    }

    forget(path: string): void {
        this.table.forget(path);
        this.mtimes.delete(path);
    }

    forgetLayout(layout: string): void {
        this.table.forgetLayout(layout);
        for (const path of this.mtimes.keys()) if (this.heightsOf(path).length === 0) this.mtimes.delete(path);
    }

    /**
     * Forgets the tenth of notes changed longest ago, to make room (D-195).
     * Returns the notes kept.
     */
    forgetLeastRecentlyChanged(): ReadonlySet<string> {
        const newestFirst = [...this.mtimes].sort(([, a], [, b]) => b - a).map(([path]) => path);
        const kept = new Set(newestFirst.slice(0, Math.floor(newestFirst.length * SHARE_KEPT)));
        this.keepOnly(kept);
        return kept;
    }

    /** Forgets every note not in `paths`, or changed since it was measured. */
    retainOnly(paths: ReadonlySet<string>): void {
        this.keepOnly(new Set([...paths].filter((path) => this.mtimes.get(path) === this.statOf(path)?.mtime)));
    }

    private keepOnly(paths: ReadonlySet<string>): void {
        this.table.retainOnly(paths);
        for (const path of this.mtimes.keys()) if (!paths.has(path)) this.mtimes.delete(path);
    }

    savedSize(): number {
        let size = this.table.savedSize(HEIGHT_CHARS);
        for (const path of this.mtimes.keys()) size += path.length + MTIME_CHARS;
        return size;
    }

    toJSON(): SavedNoteHeights {
        return { heights: this.table.toJSON(), mtimes: [...this.mtimes] };
    }

    /**
     * Replaces what it holds with `saved`, or with nothing if `saved` is not
     * what `toJSON` wrote.
     */
    restore(saved: unknown): void {
        const valid = isSaved(saved);
        this.table.restore(valid ? saved.heights : undefined);
        this.mtimes = new Map(valid ? saved.mtimes : []);
        this.learned.clear();
        this.changes++;
    }
}

function isSaved(saved: unknown): saved is SavedNoteHeights {
    const { mtimes } = (saved ?? {}) as { mtimes?: unknown };
    return (
        Array.isArray(mtimes) &&
        mtimes.every((entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number")
    );
}
