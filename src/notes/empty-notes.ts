import { debounce, type TFile } from "obsidian";
import type { NoteFilter } from "./daily-note-service";
import type { Moment } from "./moment";
import { isTemplateOnly, templatePattern } from "./template-match";
import type { BacklinkIndex } from "./backlink-index";
import type { DailyNotesStreamSettings } from "../settings";
import type { DailyNoteSettings } from "../obsidian-internals";
import { saveLoggingOnce } from "../local-storage";

/**
 * How much bigger than its template a note can be and still be read. A bigger
 * note has writing in it.
 */
const READ_MARGIN_BYTES = 1024;

/** The parts of the vault this index uses. */
export interface NoteReader {
    read(file: TFile): Promise<string>;
    /**
     * The file a link to `linkpath` opens. This is how the daily notes template
     * is found.
     */
    resolve(linkpath: string): TFile | null;
}

/** The daily notes template, as last read. */
interface Template {
    /**
     * Its setting, the file it points to, and that file's change time. If any
     * of these changes, it is read again.
     */
    key: string;
    pattern: RegExp;
    /** The biggest note worth reading. */
    maxBytes: number;
}

interface Verdict {
    mtime: number;
    empty: boolean;
}

/**
 * Where results are kept between sessions: the vault's localStorage on this
 * device.
 */
export interface VerdictStore {
    load(): unknown;
    save(value: unknown): void;
}

/**
 * Kept for each vault and each device, like the layout memory. Plugin data
 * would sync it.
 */
export const EMPTY_NOTES_KEY = "daily-notes-stream:empty-notes";
/**
 * Change this when the saved format changes. The old data is then thrown away,
 * which is fine for a cache.
 */
const VERSION = 1;
/** Delay from the first of several quick changes, as the layout memory uses. */
const SAVE_DELAY_MS = 1000;

/** The last session's results, with only what is needed to trust them. */
interface Saved {
    /** Every result was found with this template. */
    template: string;
    /**
     * When the last check of every note started. A note not changed since, and
     * not saved as empty, has writing in it.
     */
    checkedAt: number;
    /**
     * Each empty note's change time. A synced edit may have an older time than
     * `checkedAt`.
     */
    empty: Map<string, number>;
}

/**
 * Which daily notes hold only their template (ADR 0011). There is one for the
 * plugin. A result is kept for each path, with the change time at which it was
 * read, so only notes changed since are read again. A changed template throws
 * away every result. The empty notes, and when every note was last checked, are
 * saved, so the next session only reads what changed since (D-072).
 */
export class EmptyNotes {
    private template: Template | null = null;
    private verdicts = new Map<string, Verdict>();
    private readonly saved: Saved | null;
    /**
     * When this session's last check of every note started. Nothing is saved
     * before there is one.
     */
    private checkedAt: number | null = null;
    private readonly saveSoon = debounce(() => this.save(), SAVE_DELAY_MS);
    private readonly saveLogged = saveLoggingOnce("which notes are empty");

    constructor(
        private readonly reader: NoteReader,
        private readonly store: VerdictStore,
        private readonly dailyNoteSettings: () => DailyNoteSettings
    ) {
        this.saved = restore(store.load());
    }

    /** The template path set in the daily notes settings. */
    templatePath(): string {
        return this.dailyNoteSettings().template?.trim() ?? "";
    }

    /**
     * `refresh` for every daily note. The next session trusts results from the
     * time this started.
     */
    async checkAll(files: TFile[]): Promise<void> {
        const startedAt = Date.now();
        // If a note were not read, it would wrongly count as having writing in
        // it.
        if (!(await this.readStale(files))) return;
        this.checkedAt = startedAt;
        this.saveSoon();
    }

    /**
     * Reads those of `files` that changed since their result, are small enough
     * to be empty, and are not trusted from the last session.
     */
    async refresh(files: TFile[]): Promise<void> {
        await this.readStale(files);
    }

    /**
     * `refresh`, and returns whether it read every note. If a read fails, the
     * note gets no result, so it shows and is read again next time. It may have
     * been deleted during the check, or not downloaded yet.
     */
    private async readStale(files: TFile[]): Promise<boolean> {
        const template = await this.readTemplate();
        if (!template) return false;
        // If the template changes during the read, the map is replaced, and
        // these results go into the old one.
        const verdicts = this.verdicts;
        const saved = this.saved?.template === template.key ? this.saved : null;
        const stale = files.filter((file) => verdicts.get(file.path)?.mtime !== file.stat.mtime);
        const read = await Promise.all(
            stale.map(async (file) => {
                // Stryker disable BlockStatement: an empty catch returns undefined, which fails `every` just as false does.
                try {
                    const empty =
                        file.stat.size <= template.maxBytes &&
                        (trusted(file, saved) ?? isTemplateOnly(await this.reader.read(file), template.pattern));
                    verdicts.set(file.path, { mtime: file.stat.mtime, empty });
                    return true;
                } catch {
                    return false;
                }
                // Stryker restore BlockStatement
            })
        );
        if (stale.length > 0 && this.checkedAt !== null) this.saveSoon();
        return read.every(Boolean);
    }

    /**
     * Whether `file` held only its template when it was last read. False if it
     * was not read, or changed since.
     */
    isEmpty(file: TFile): boolean {
        const verdict = this.verdicts.get(file.path);
        return verdict?.mtime === file.stat.mtime && verdict.empty;
    }

    rename(oldPath: string, newPath: string): void {
        moveKey(this.verdicts, oldPath, newPath);
        if (this.saved) moveKey(this.saved.empty, oldPath, newPath);
    }

    forget(path: string): void {
        this.verdicts.delete(path);
    }

    /** Saves a waiting change now, because the plugin is unloading. */
    flush(): void {
        this.saveSoon.run();
    }

    private save(): void {
        const empty = [...this.verdicts].filter(([, verdict]) => verdict.empty).map(([path, v]) => [path, v.mtime]);
        this.saveLogged(() =>
            this.store.save({ version: VERSION, template: this.template?.key, checkedAt: this.checkedAt, empty })
        );
    }

    /**
     * Finds the template the way Obsidian follows a link to it, and only reads
     * it again once it has changed. Null if it cannot be read; then no note
     * counts as empty until it can.
     */
    private async readTemplate(): Promise<Template | null> {
        const path = this.templatePath();
        const file = path ? this.reader.resolve(path) : null;
        const key = `${path}\u0000${file?.path}\u0000${file?.stat.mtime}`;
        if (this.template?.key === key) return this.template;

        this.template = null;
        this.verdicts = new Map();
        let text: string | null = null;
        try {
            text = file ? await this.reader.read(file) : null;
        } catch (error) {
            console.error("DailyNotesStream: Failed to read the daily-notes template; hiding no notes", error);
            return null;
        }
        this.template = {
            key,
            pattern: templatePattern(text),
            maxBytes: (file?.stat.size ?? 0) + READ_MARGIN_BYTES,
        };
        return this.template;
    }
}

/**
 * `file`'s result from the last session. Undefined if it cannot be trusted, so
 * the note must be read.
 */
function trusted(file: TFile, saved: Saved | null): boolean | undefined {
    if (!saved) return undefined;
    const emptyAt = saved.empty.get(file.path);
    if (emptyAt !== undefined) return emptyAt === file.stat.mtime ? true : undefined;
    return file.stat.mtime <= saved.checkedAt ? false : undefined;
}

function moveKey<V>(map: Map<string, V>, from: string, to: string): void {
    const value = map.get(from);
    if (value === undefined) return;
    map.delete(from);
    map.set(to, value);
}

/** What `save` wrote, or null for anything else. */
function restore(value: unknown): Saved | null {
    // Stryker disable next-line ConditionalExpression: a primitive has no version, so it is refused below.
    if (typeof value !== "object" || value === null) return null;
    const { version, template, checkedAt, empty } = value as Record<string, unknown>;
    // Stryker disable next-line ConditionalExpression: a template that is not a string never matches the current one's key.
    if (version !== VERSION || typeof template !== "string" || typeof checkedAt !== "number") return null;
    if (!Array.isArray(empty)) return null;
    return { template, checkedAt, empty: new Map(empty as [string, number][]) };
}

/**
 * The stream's filter. While the setting is on, an empty note is hidden, except
 * today's, which is about to be written in, and one with linked mentions to
 * show.
 */
export function hideEmptyNotes(
    notes: EmptyNotes,
    backlinks: BacklinkIndex,
    settings: () => Pick<DailyNotesStreamSettings, "hideEmptyNotes" | "showLinkedMentions">
): NoteFilter {
    const hasMentions = (file: TFile) => settings().showLinkedMentions && backlinks.sourcesOf(file.path).length > 0;
    return {
        prepare: (files) => (settings().hideEmptyNotes ? notes.checkAll(files) : Promise.resolve()),
        recheck: (file) => (settings().hideEmptyNotes ? notes.refresh([file]) : Promise.resolve()),
        isHidden: (file: TFile, date: Moment) =>
            settings().hideEmptyNotes && notes.isEmpty(file) && !date.isSame(Date.now(), "day") && !hasMentions(file),
        signature: () => {
            const { hideEmptyNotes, showLinkedMentions } = settings();
            return `${hideEmptyNotes}\u0000${showLinkedMentions}\u0000${notes.templatePath()}`;
        },
    };
}
