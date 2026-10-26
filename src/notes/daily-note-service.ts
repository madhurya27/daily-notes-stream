import { TFile, normalizePath } from "obsidian";
import { moment, type Moment } from "./moment";
import { ParsedDates } from "./parsed-dates";
import { readDateFormat, type DateFormat } from "./daily-note-format";
import type { DailyNoteSettings } from "../obsidian-internals";

/** Which daily notes the stream leaves out. */
export interface NoteFilter {
    /**
     * Brings `isHidden` up to date for every daily note in `files`, while the
     * list is being built.
     */
    prepare(files: TFile[]): Promise<void>;
    /**
     * Brings `isHidden` up to date for `file` only, because it, or a link to
     * it, changed.
     */
    recheck(file: TFile): Promise<void>;
    isHidden(file: TFile, date: Moment): boolean;
    /**
     * Changes when many hidden notes may have changed at once, so the notes are
     * listed again.
     */
    signature(): string;
}

/** Hides nothing. */
const SHOW_ALL: NoteFilter = {
    prepare: () => Promise.resolve(),
    recheck: () => Promise.resolve(),
    isHidden: () => false,
    // Stryker disable next-line StringLiteral: a signature that never changes only needs to stay the same.
    signature: () => "",
};

/**
 * Where `insertSorted` put a note: its index, and whether it is inside the
 * loaded part of the stream.
 */
export interface Insertion {
    index: number;
    inStream: boolean;
}

/** A daily note and the date read from its name, read only once. */
interface DatedNote {
    file: TFile;
    date: Moment;
}

export class DailyNoteService {
    private sorted: DatedNote[] = [];
    /** How many of the notes, newest first, the stream has loaded. */
    private _streamLength = 0;
    /**
     * The daily notes settings the list was built from. Null before the first
     * build.
     */
    private builtFrom: string | null = null;
    /** The date format the list was built with. Null before the first build. */
    private builtWith: DateFormat | null = null;
    /**
     * The day on which the list or `catchUpDay` last checked the filter's
     * "today".
     */
    private seenDay: Moment = moment();

    /**
     * `markdownFiles`: the vault's Markdown files, including the daily notes.
     * `parsedDates`: shared by all views, so opening a view again only reads
     * the dates of new files. `filter`: decides which notes are left out.
     */
    constructor(
        private readonly markdownFiles: () => TFile[],
        private readonly dailyNoteSettings: () => DailyNoteSettings,
        private readonly parsedDates = new ParsedDates(),
        private readonly filter = SHOW_ALL
    ) {}

    /**
     * Call once for each view, when it opens. If it fails, the list is empty,
     * instead of the view being left blank, and the next refresh tries again.
     */
    async initialize(): Promise<void> {
        const format = this.readFormat();
        try {
            this.rebuilt(await this.buildSorted(format), format);
        } catch (error) {
            console.error("DailyNotesStream: Failed to list the daily notes", error);
        }
    }

    /**
     * Builds the list again when Obsidian's daily notes format or folder
     * changed, which changes which files are daily notes, or when the filter's
     * signature changed. Returns whether it built the list again.
     */
    async refreshIfSettingsChanged(): Promise<boolean> {
        const format = this.readFormat();
        if (this.signature(format) === this.builtFrom) return false;
        this.rebuilt(await this.buildSorted(format), format);
        return true;
    }

    /**
     * The notes that a new day may hide or show, once per day: yesterday's,
     * which is no longer today's, and one made in advance for the new day.
     * Nothing runs at midnight; the next change asks (ADR 0011).
     */
    catchUpDay(): TFile[] {
        const today = moment();
        if (today.isSame(this.seenDay.valueOf(), "day")) return [];
        const seen = this.seenDay;
        this.seenDay = today;
        return this.datedNotes(this.format())
            .filter((note) => note.date.isSame(seen.valueOf(), "day") || note.date.isSame(today.valueOf(), "day"))
            .map((note) => note.file);
    }

    /** A new list starts a new stream. */
    private rebuilt(sorted: DatedNote[], format: DateFormat): void {
        this.sorted = sorted;
        this._streamLength = 0;
        this.builtFrom = this.signature(format);
        this.builtWith = format;
    }

    /** Newest first. */
    getBatch(offset: number, limit: number): TFile[] {
        return this.sorted.slice(offset, offset + limit).map((note) => note.file);
    }

    /** How many of the notes, newest first, the stream has loaded. */
    get streamLength(): number {
        return this._streamLength;
    }

    /** The notes the stream has loaded, newest first. */
    streamedNotes(): TFile[] {
        return this.getBatch(0, this._streamLength);
    }

    /**
     * Loads the next `limit` notes into the stream and returns them. Returns
     * none past the last note.
     */
    extendStream(limit: number): TFile[] {
        const notes = this.getBatch(this._streamLength, limit);
        this._streamLength += notes.length;
        return notes;
    }

    /**
     * Null if the file is not a daily note, is hidden, or is already listed. If
     * it falls inside the loaded part of the stream, it is added to it.
     */
    insertSorted(file: TFile): Insertion | null {
        const date = this.parseDate(file, this.format());
        if (!date || this.filter.isHidden(file, date)) return null;

        const index = this.firstIndexOnOrBefore(date.valueOf());
        // Each date has exactly one path, so the search finds the duplicate.
        if (this.sorted[index]?.file.path === file.path) return null;

        this.sorted.splice(index, 0, { file, date });
        const inStream = index < this._streamLength;
        if (inStream) this._streamLength++;
        return { index, inStream };
    }

    /**
     * Whether `file` belongs in the list: a daily note that the filter, checked
     * again for it, keeps.
     */
    async belongs(file: TFile): Promise<boolean> {
        const date = this.parseDate(file, this.format());
        if (!date) return false;
        await this.filter.recheck(file);
        return !this.filter.isHidden(file, date);
    }

    /**
     * Whether the filter leaves out any daily note. It reads the whole vault,
     * so only use it for an empty stream.
     */
    hidesAny(): boolean {
        return this.datedNotes(this.format()).some((note) => this.filter.isHidden(note.file, note.date));
    }

    /**
     * Returns the removed note's index, or -1 if it was not listed. If it was
     * in the loaded part of the stream, it is removed from it.
     */
    removeSorted(filePath: string): number {
        const index = this.indexOf(filePath);
        if (index === -1) return index;
        this.sorted.splice(index, 1);
        if (index < this._streamLength) this._streamLength--;
        return index;
    }

    /**
     * The index of the newest note dated on or before `target`, comparing days
     * only. -1 if every note is newer, or the stream is empty.
     */
    indexForDate(target: Moment): number {
        // Stryker disable next-line StringLiteral: a jump's target is a date, already at the start of its day.
        const index = this.firstIndexOnOrBefore(target.clone().startOf("day").valueOf());
        return index < this.sorted.length ? index : -1;
    }

    /**
     * Whether the note at `path` is today's: the one being written in, so it is
     * saved while on screen.
     */
    isToday(path: string): boolean {
        const today = moment();
        const note = this.sorted[this.indexForDate(today)];
        return !!note && note.file.path === path && note.date.isSame(today.valueOf(), "day");
    }

    /** The index of the note at `path`, or -1 if it is not listed. */
    indexOf(path: string): number {
        return this.sorted.findIndex((note) => note.file.path === path);
    }

    get length(): number {
        return this.sorted.length;
    }

    /**
     * Every note's date, newest first: the dates a jump can go to. Do not
     * change it.
     */
    dates(): Moment[] {
        return this.sorted.map((note) => note.date);
    }

    /**
     * `date` written as this vault's file names write it, including nested
     * formats.
     */
    formatDate(date: Moment): string {
        return date.format(this.format().basename);
    }

    /**
     * `text` read as one of this vault's file names, or null if it is not one.
     */
    parseNoteDate(text: string): Moment | null {
        const date = moment(text, this.format().basename, true);
        return date.isValid() ? date : null;
    }

    /**
     * Binary search of the list, which is newest first: the first index whose
     * date is at or before `time`, or `length` if there is none.
     */
    private firstIndexOnOrBefore(time: number): number {
        let lo = 0;
        let hi = this.sorted.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.sorted[mid]!.date.valueOf() > time) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    /**
     * What the list was built from: the date format, and what the filter hides.
     */
    private signature(format: DateFormat): string {
        return `${this.dateSignature(format)}\u0000${this.filter.signature()}`;
    }

    /** What decides which files are daily notes, and their dates. */
    private dateSignature(format: DateFormat): string {
        return `${format.folder}\u0000${format.path}`;
    }

    private async buildSorted(format: DateFormat): Promise<DatedNote[]> {
        const notes = this.datedNotes(format);
        this.seenDay = moment();
        await this.filter.prepare(notes.map((note) => note.file));
        return notes
            .filter((note) => !this.filter.isHidden(note.file, note.date))
            .sort((a, b) => b.date.valueOf() - a.date.valueOf());
    }

    /** Every daily note in the vault, in no particular order. */
    private datedNotes(format: DateFormat): DatedNote[] {
        // Uses parseDate, the same check as for a newly created file (D-026).
        const files = this.markdownFiles();
        const dates = this.parsedDates.datesOf(files, this.dateSignature(format), (file) =>
            this.parseDate(file, format)
        );
        return files
            .map((file, i) => ({ file, date: dates[i] ?? null }))
            .filter((note): note is DatedNote => note.date !== null);
    }

    /**
     * The format the list was built with. A change to the settings refreshes
     * the service, which builds the list again if the format changed. Before
     * the first build, the format from the settings.
     */
    private format(): DateFormat {
        return this.builtWith ?? this.readFormat();
    }

    private readFormat(): DateFormat {
        return readDateFormat(this.dailyNoteSettings());
    }

    /** Reads a date from a Markdown file's name, using the date format. */
    private parseBasename(file: TFile, format: DateFormat) {
        // Stryker disable next-line ConditionalExpression: parseDate's path check refuses it too; this only saves time.
        if (file.extension !== "md") return null;
        // Stryker disable next-line BooleanLiteral: parseDate's path check also refuses a loose match.
        const date = moment(file.basename, format.basename, true);
        return date.isValid() ? date : null;
    }

    /**
     * Vault events fire for every file, so matching the name alone would accept
     * `Attachments/2026-07-07.png`. The date, written as a path, must give back
     * this path.
     */
    private parseDate(file: TFile, format: DateFormat) {
        // Cheaper than the strict parse below, and most files in the vault fail
        // it.
        if (format.folder && !normalizePath(file.path).startsWith(`${format.folder}/`)) return null;

        const date = this.parseBasename(file, format);
        if (!date) return null;

        const expectedPath = normalizePath(`${format.folder}/${date.format(format.path)}.md`);
        return normalizePath(file.path) === expectedPath ? date : null;
    }
}
