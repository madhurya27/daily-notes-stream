/**
 * Which notes link to each path: the metadata cache's `resolvedLinks`, turned
 * around. There is one for the plugin, shared by every view. It is built on
 * first use, and again only after `invalidate()`, so a footer can look up its
 * note without going through every note.
 */
export class BacklinkIndex {
    private bySource: Map<string, string[]> | null = null;

    constructor(private readonly resolvedLinks: () => Record<string, Record<string, number>>) {}

    /**
     * The paths of the notes that link to `path`, sorted. A note's links to
     * itself are left out.
     */
    sourcesOf(path: string): readonly string[] {
        this.bySource ??= this.invert();
        return this.bySource.get(path) ?? [];
    }

    /**
     * The cache resolved links again, so the next lookup builds the index
     * again.
     */
    invalidate(): void {
        this.bySource = null;
    }

    private invert(): Map<string, string[]> {
        const byTarget = new Map<string, string[]>();
        for (const [source, targets] of Object.entries(this.resolvedLinks())) {
            for (const target of Object.keys(targets)) {
                if (target === source) continue;
                const sources = byTarget.get(target);
                if (sources) sources.push(source);
                else byTarget.set(target, [source]);
            }
        }
        for (const sources of byTarget.values()) sources.sort();
        return byTarget;
    }
}
