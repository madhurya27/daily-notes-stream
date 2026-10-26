import { parseLinktext, type App, type CachedMetadata, type Pos, type TFile } from "obsidian";
import type { BacklinkIndex } from "./backlink-index";

/** Positions in a linking note's text. */
export interface Excerpt {
    start: number;
    end: number;
}

/** A note that links here, and where. */
export interface Mention {
    source: TFile;
    /**
     * The list item or section around each link in the body, each only once, in
     * the order of the text.
     */
    excerpts: Excerpt[];
    /** Each property that links here, as `key: value` Markdown. */
    properties: string[];
}

/**
 * The notes that link to `file`, sorted by path, using only the cache. No file
 * is read, so a footer can draw its count before any excerpt.
 */
export function linkedMentions(app: App, index: BacklinkIndex, file: TFile): Mention[] {
    const mentions: Mention[] = [];
    for (const path of index.sourcesOf(file.path)) {
        const source = app.vault.getFileByPath(path);
        const cache = source && app.metadataCache.getFileCache(source);
        if (!source || !cache) continue;

        const linksHere = (link: string) =>
            app.metadataCache.getFirstLinkpathDest(parseLinktext(link).path, path)?.path === file.path;
        const excerpts = excerptsOf(
            cache,
            [...(cache.links ?? []), ...(cache.embeds ?? [])].filter((ref) => linksHere(ref.link))
        );
        const properties = [
            ...new Set(
                (cache.frontmatterLinks ?? [])
                    .filter((ref) => linksHere(ref.link))
                    .map((ref) => `${ref.key.split(".")[0]}: ${ref.original}`)
            ),
        ];
        // The index can be ahead of this note's cache while the cache resolves
        // links again.
        if (excerpts.length > 0 || properties.length > 0) mentions.push({ source, excerpts, properties });
    }
    return mentions;
}

/**
 * Changes whenever what a footer shows might change: a linking note added or
 * removed, linking more or less, or edited.
 */
export function mentionsSignature(mentions: readonly Mention[]): string {
    return mentions
        .map(
            ({ source, excerpts, properties }) =>
                `${source.path}:${excerpts.length + properties.length}:${source.stat.mtime}`
        )
        .join("|");
}

/**
 * Each link's innermost list item, otherwise its section, otherwise the link
 * itself, with no duplicates.
 */
function excerptsOf(cache: CachedMetadata, refs: readonly { position: Pos }[]): Excerpt[] {
    const byStart = new Map<number, Excerpt>();
    for (const { position } of refs) {
        const offset = position.start.offset;
        const around = innermost(cache.listItems ?? [], offset) ?? innermost(cache.sections ?? [], offset) ?? position;
        byStart.set(around.start.offset, { start: around.start.offset, end: around.end.offset });
    }
    return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/**
 * The cache lists items in the order of the text, a parent before its children,
 * so the last one that holds `offset` is the innermost.
 */
function innermost(items: readonly { position: Pos }[], offset: number): Pos | undefined {
    for (let i = items.length - 1; i >= 0; i--) {
        const { position } = items[i]!;
        if (position.start.offset <= offset && offset <= position.end.offset) return position;
    }
    return undefined;
}
