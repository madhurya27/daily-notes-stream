import { LayoutTable, type SavedLayoutTable } from "../../stream/layout-table";

/** What an entry saves besides its key: `["\\n",{"tooWide":true}],` */
const ENTRY_CHARS = 23;

interface Measurement {
    /** Measured too wide for a table. */
    tooWide: true;
}

/**
 * A Base in a note, in a layout: the width it was checked against, and the text
 * size.
 */
export interface BaseKey {
    layout: string;
    path: string;
    /** `baseDigest` of what it is drawn from. */
    base: string;
}

/** Measurements by note path and digest, for each layout. */
export type SavedMeasurements = SavedLayoutTable<Measurement>;

/**
 * Which Bases were too wide for a table, kept with the notes' heights (ADR
 * 0010), so a Base that comes back is drawn as cards straight away. Its height
 * is kept by its note. One note's entry stands for every note holding that
 * Base.
 */
export class BaseMeasurements {
    private readonly table: LayoutTable<Measurement>;

    constructor(changed: () => void = () => {}, limit?: number) {
        this.table = new LayoutTable(isMeasurement, changed, limit);
    }

    /**
     * Whether any note has this Base recorded as too wide, because a template
     * repeats a Base in every daily note (D-194).
     */
    isTooWide({ layout, base }: BaseKey): boolean {
        return this.table.hasKey(layout, (key) => key.endsWith(`\n${base}`));
    }

    markTooWide(key: BaseKey): void {
        if (!this.isTooWide(key)) this.table.set(key.layout, `${key.path}\n${key.base}`, { tooWide: true });
    }

    rename(oldPath: string, newPath: string): void {
        this.table.rename(oldPath, newPath);
    }

    forget(path: string): void {
        this.table.forget(path);
    }

    forgetLayout(layout: string): void {
        this.table.forgetLayout(layout);
    }

    retainOnly(paths: ReadonlySet<string>): void {
        this.table.retainOnly(paths);
    }

    savedSize(): number {
        return this.table.savedSize(ENTRY_CHARS);
    }

    toJSON(): SavedMeasurements {
        return this.table.toJSON();
    }

    restore(saved: unknown): void {
        this.table.restore(saved);
    }
}

function isMeasurement(value: unknown): value is Measurement {
    // Stryker disable next-line ConditionalExpression: a primitive's tooWide is undefined either way.
    return typeof value === "object" && value !== null && (value as Record<string, unknown>).tooWide === true;
}

/**
 * A short string that stands for the Base a note embeds: its Markdown and
 * definition, which can be kilobytes long. It uses cyrb53, a 53-bit hash. A
 * note holds only a few Bases, so two giving the same hash is very unlikely.
 */
export function baseDigest(markdown: string, definition: string | null): string {
    // Stryker disable next-line StringLiteral: the text used for no definition only needs to stay the same.
    const text = `${markdown}\n${definition ?? ""}`;
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    // Stryker disable next-line EqualityOperator: any fixed way of mixing the text gives a valid digest.
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    // Stryker disable next-line ArithmeticOperator: any fixed way of mixing the text gives a valid digest.
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
