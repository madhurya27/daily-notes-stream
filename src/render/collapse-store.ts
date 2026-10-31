import { App } from "obsidian";

/** Kept for each vault, like the layout memory. */
export const COLLAPSE_STATE_KEY = "daily-notes-stream:collapse";
/**
 * Change this when the saved format changes. The old data is then thrown away.
 */
const VERSION = 1;

type Sections = Map<string, boolean>;

/**
 * A key saved by builds before D-121: one for each section, and an index for
 * each note.
 */
export function isOldCollapseKey(name: string): boolean {
    return /^collapse(-idx)?:.*\.md(:|$)/.test(name);
}

/**
 * Which sections are folded. There is one for the plugin. It is read once, and
 * saved in full on each change. The keys are the slug of the text for headings,
 * and `li-{depth}-{own text}` for list items, each under the heading above it
 * (D-136).
 */
export class CollapsibleStateStore {
    private readonly files: Map<string, Sections>;

    constructor(private readonly app: App) {
        this.files = restore(app.loadLocalStorage(COLLAPSE_STATE_KEY));
    }

    isCollapsed(filePath: string, sectionKey: string): boolean {
        return this.collapsedOr(filePath, sectionKey, false);
    }

    /**
     * The saved state, or `fallback`. The properties panel's default comes from
     * a setting.
     */
    collapsedOr(filePath: string, sectionKey: string, fallback: boolean): boolean {
        return this.files.get(filePath)?.get(sectionKey) ?? fallback;
    }

    /**
     * Both states are saved, because "unfolded" must also last when the note is
     * re-rendered.
     */
    setCollapsed(filePath: string, sectionKey: string, collapsed: boolean): void {
        const sections = this.files.get(filePath) ?? new Map<string, boolean>();
        if (sections.get(sectionKey) === collapsed) return;
        sections.set(sectionKey, collapsed);
        this.files.set(filePath, sections);
        this.save();
    }

    /**
     * Moves the fold state when a note is renamed or moved, so nothing unfolds.
     */
    migrate(oldPath: string, newPath: string): void {
        const sections = this.files.get(oldPath);
        if (!sections) return;
        this.files.delete(oldPath);
        this.files.set(newPath, sections);
        this.save();
    }

    /**
     * Forgets the note's sections not in `keep`: headings and lists it no
     * longer has.
     */
    retainSections(filePath: string, keep: ReadonlySet<string>): void {
        const sections = this.files.get(filePath);
        if (!sections) return;
        const gone = [...sections.keys()].filter((sectionKey) => !keep.has(sectionKey));
        if (gone.length === 0) return;
        for (const sectionKey of gone) sections.delete(sectionKey);
        if (sections.size === 0) this.files.delete(filePath);
        this.save();
    }

    /** Forgets notes deleted while the plugin was not running to see it. */
    retainOnly(paths: ReadonlySet<string>): void {
        const gone = [...this.files.keys()].filter((path) => !paths.has(path));
        if (gone.length === 0) return;
        for (const path of gone) this.files.delete(path);
        this.save();
    }

    /** Starts again with nothing folded, as on a new device. */
    forgetAll(): void {
        this.files.clear();
        this.app.saveLocalStorage(COLLAPSE_STATE_KEY, null);
    }

    clearForFile(filePath: string): void {
        if (this.files.delete(filePath)) this.save();
    }

    private save(): void {
        const files = [...this.files].map(([path, sections]) => [path, [...sections]]);
        this.app.saveLocalStorage(COLLAPSE_STATE_KEY, { version: VERSION, files });
    }
}

/** What `save` wrote, or nothing for anything else. */
function restore(value: unknown): Map<string, Sections> {
    const { version, files } = (value ?? {}) as { version?: unknown; files?: unknown };
    if (version !== VERSION || !Array.isArray(files) || !files.every(isSavedFile)) return new Map();
    return new Map(files.map(([path, sections]) => [path, new Map(sections)]));
}

function isSavedFile(entry: unknown): entry is [string, [string, boolean][]] {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) return false;
    return (entry[1] as unknown[]).every(
        (section) => Array.isArray(section) && typeof section[0] === "string" && typeof section[1] === "boolean"
    );
}
