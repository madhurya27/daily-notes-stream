import type { TFile } from "obsidian";
import type { Moment } from "./moment";

/**
 * The date read from each path, kept by the plugin between opens of the stream.
 * A date depends only on the path and the daily notes format, so nothing in the
 * vault can make an entry out of date. So there are no listeners, and each view
 * still builds its own list (.claude/rules/invariants.md).
 */
export class ParsedDates {
    private format: string | null = null;
    private byPath = new Map<string, Moment | null>();

    /**
     * Each file's date in `format`. Only reads paths not already seen with that
     * format. Paths no longer in `files` are forgotten.
     */
    datesOf(files: TFile[], format: string, parse: (file: TFile) => Moment | null): (Moment | null)[] {
        const known = format === this.format ? this.byPath : new Map<string, Moment | null>();
        const seen = new Map<string, Moment | null>();
        const dates = files.map((file) => {
            // Undefined means not seen yet. Null means seen, and not a daily
            // note.
            const cached = known.get(file.path);
            const date = cached === undefined ? parse(file) : cached;
            seen.set(file.path, date);
            return date;
        });
        this.format = format;
        this.byPath = seen;
        return dates;
    }
}
