/**
 * How many layouts are remembered. Each pane width and font size is a separate
 * layout, and everything is measured again in each one.
 */
const LAYOUTS_KEPT = 4;

/** Values by key, for each layout. The layout used longest ago comes first. */
export type SavedLayoutTable<V> = [layout: string, entries: [key: string, value: V][]][];

/**
 * What was measured, for each layout, by note. A key is a note's path, or
 * starts with the path and a newline. Renaming a note moves its entries with
 * it, deleting it removes them, and the layout used longest ago is forgotten
 * first.
 */
export class LayoutTable<V> {
    private layouts = new Map<string, Map<string, V>>();

    constructor(
        /**
         * Whether a saved value is a `V`, so `restore` can refuse anything
         * else.
         */
        private readonly isValue: (value: unknown) => value is V,
        /** Called with each layout that changed. */
        private readonly changed: (layout: string) => void,
        private readonly limit = LAYOUTS_KEPT
    ) {}

    get(layout: string, key: string): V | undefined {
        return this.use(layout)?.get(key);
    }

    set(layout: string, key: string, value: V): void {
        let entries = this.use(layout);
        if (!entries) {
            entries = new Map();
            this.layouts.set(layout, entries);
            if (this.layouts.size > this.limit) this.layouts.delete(this.layouts.keys().next().value!);
        }
        entries.set(key, value);
        this.changed(layout);
    }

    /** `layout`'s keys and values. Reading them does not count as using it. */
    entries(layout: string): [key: string, value: V][] {
        return [...(this.layouts.get(layout) ?? [])];
    }

    /**
     * Whether any of `layout`'s keys matches. Marks the layout as just used, so
     * it is forgotten last.
     */
    hasKey(layout: string, matches: (key: string) => boolean): boolean {
        const entries = this.use(layout);
        return entries !== undefined && [...entries.keys()].some(matches);
    }

    /** Every layout, starting with the one used longest ago. */
    layoutNames(): string[] {
        return [...this.layouts.keys()];
    }

    /**
     * `key`'s value in each layout that has one. Reading them does not count as
     * using any layout.
     */
    valuesOf(key: string): [layout: string, value: V][] {
        return [...this.layouts].flatMap(([layout, entries]): [string, V][] =>
            entries.has(key) ? [[layout, entries.get(key)!]] : []
        );
    }

    rename(oldPath: string, newPath: string): void {
        this.edit((entries) => {
            const moved = [...entries].filter(([key]) => notePathOf(key) === oldPath);
            for (const [key, value] of moved) {
                entries.delete(key);
                entries.set(newPath + key.slice(oldPath.length), value);
            }
            return moved.length > 0;
        });
    }

    forget(path: string): void {
        this.removeWhere((notePath) => notePath === path);
    }

    /** Forgets notes deleted while the plugin was not running to see it. */
    retainOnly(paths: ReadonlySet<string>): void {
        this.removeWhere((notePath) => !paths.has(notePath));
    }

    toJSON(): SavedLayoutTable<V> {
        return [...this.layouts].map(([layout, entries]) => [layout, [...entries]]);
    }

    /**
     * Replaces what it holds with `saved`, or with nothing if `saved` is not
     * what `toJSON` wrote.
     */
    restore(saved: unknown): void {
        this.layouts = this.isSaved(saved)
            ? new Map(saved.map(([layout, entries]) => [layout, new Map(entries)]))
            : new Map<string, Map<string, V>>();
    }

    /**
     * `layout`'s entries. Marks the layout as just used, so it is forgotten
     * last.
     */
    private use(layout: string): Map<string, V> | undefined {
        const entries = this.layouts.get(layout);
        if (entries) {
            this.layouts.delete(layout);
            this.layouts.set(layout, entries);
        }
        return entries;
    }

    private removeWhere(matches: (notePath: string) => boolean): void {
        this.edit((entries) => {
            let removed = false;
            for (const key of entries.keys()) {
                if (matches(notePathOf(key))) removed = entries.delete(key);
            }
            return removed;
        });
    }

    /**
     * Applies `change` to every layout. If `change` returns true, that layout
     * changed.
     */
    private edit(change: (entries: Map<string, V>) => boolean): void {
        for (const [layout, entries] of this.layouts) {
            if (change(entries)) this.changed(layout);
        }
    }

    private isSaved(value: unknown): value is SavedLayoutTable<V> {
        return (
            Array.isArray(value) &&
            value.every(
                (entry) =>
                    Array.isArray(entry) &&
                    typeof entry[0] === "string" &&
                    Array.isArray(entry[1]) &&
                    (entry[1] as unknown[]).every(
                        (pair) => Array.isArray(pair) && typeof pair[0] === "string" && this.isValue(pair[1])
                    )
            )
        );
    }
}

function notePathOf(key: string): string {
    const end = key.indexOf("\n");
    return end === -1 ? key : key.slice(0, end);
}
