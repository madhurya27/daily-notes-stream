type Listener = (paths: string[]) => void;

/**
 * Which daily notes gained or lost a link. There is one for the plugin. A
 * hidden empty note is shown while another note links to it (ADR 0011; D-073).
 * Each note's links into the daily notes folder are kept from its last
 * `resolve`. Changes are reported once the cache is `resolved`, when the
 * backlink index is up to date again.
 */
export class LinkChanges {
    private readonly targetsBySource = new Map<string, string[]>();
    private readonly changed = new Set<string>();
    private readonly listeners = new Set<Listener>();

    /**
     * `folder`: the daily notes folder as `readDateFormat` gives it, or "" if
     * not set.
     */
    constructor(
        private readonly links: () => Record<string, Record<string, number>>,
        private readonly folder: () => string
    ) {}

    /**
     * Gets every batch of changed paths, until the returned function is called.
     */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * The cache resolved `source`'s links. This runs for every file at startup,
     * so it only compares.
     */
    onResolve(source: string): void {
        const now = this.followedTargets(source);
        const before = this.targetsBySource.get(source) ?? [];
        for (const target of now) if (!before.includes(target)) this.changed.add(target);
        for (const target of before) if (!now.includes(target)) this.changed.add(target);
        // Stryker disable next-line ConditionalExpression,EqualityOperator: only frees memory; no links compares the same as nothing kept.
        if (now.length > 0) this.targetsBySource.set(source, now);
        else this.targetsBySource.delete(source);
    }

    onDelete(source: string): void {
        for (const target of this.targetsBySource.get(source) ?? []) this.changed.add(target);
        this.targetsBySource.delete(source);
    }

    onRename(oldPath: string, newPath: string): void {
        const targets = this.targetsBySource.get(oldPath);
        // Stryker disable next-line ConditionalExpression: nothing kept under the new path reads as nothing either way.
        if (!targets) return;
        this.targetsBySource.delete(oldPath);
        this.targetsBySource.set(newPath, targets);
    }

    onResolved(): void {
        if (this.changed.size === 0) return;
        const paths = [...this.changed];
        this.changed.clear();
        for (const listener of this.listeners) listener(paths);
    }

    /** `source`'s links into the daily notes folder, except links to itself. */
    private followedTargets(source: string): string[] {
        const folder = this.folder();
        const prefix = folder ? `${folder}/` : "";
        return Object.keys(this.links()[source] ?? {}).filter(
            (target) => target !== source && target.startsWith(prefix)
        );
    }
}
