import type { Component } from "obsidian";
import { searchPattern } from "../notes/note-search";

/** The names styles.css colors with `::highlight()`. */
const MATCH = "daily-notes-search-match";
const CURRENT = "daily-notes-search-current";

/**
 * The parts of a window that highlights use: a registry, which is missing
 * without the API.
 */
type HighlightWindow = Window & { CSS: { highlights?: HighlightRegistry }; Highlight: typeof Highlight };

/**
 * The highlight called `name` in the window that shows `node`, registered the
 * first time it is used. Each window, including a pop-out window, only draws
 * highlights from its own registry. Every stream view in that window shares it,
 * so each adds and deletes only its own ranges. Null where the platform has no
 * highlight API; the ranges are still tracked, but not drawn.
 */
function registered(name: string, node: Node): Highlight | null {
    const win = node.win as HighlightWindow;
    const registry = win.CSS.highlights;
    if (!registry) return null;
    let highlight = registry.get(name);
    if (!highlight) {
        highlight = new win.Highlight();
        // Overlapping ranges are drawn by priority: the current match on top of
        // the others.
        if (name === CURRENT) highlight.priority = 1;
        registry.set(name, highlight);
    }
    return highlight;
}

/**
 * Search only matches a note's own text. Linked mentions, embeds and Bases show
 * other files, or Obsidian's own text, and the properties heading is our label.
 */
const OUTSIDE_THE_NOTE = ".daily-note-mentions, .metadata-properties-heading, .internal-embed, .block-language-base";

/**
 * Every match of `pattern` inside a single text node of `root`, leaving out
 * what is not the note's own text.
 */
function findRanges(root: HTMLElement, pattern: RegExp): Range[] {
    const ranges: Range[] = [];
    const walker = root.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, (node) =>
        node.parentElement!.closest(OUTSIDE_THE_NOTE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node as Text).data.matchAll(pattern)) {
            const range = root.doc.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            ranges.push(range);
        }
    }
    return ranges;
}

/**
 * Colors the query in drawn notes with the CSS highlight API, which does not
 * change the DOM. So folding and the shared listeners never see an extra
 * wrapper element.
 */
export class SearchHighlighter {
    private pattern: RegExp | null = null;
    /** Drawn blocks, and the ranges found in each. */
    private readonly ranges = new Map<HTMLElement, Range[]>();
    private current: Range | null = null;

    /**
     * Highlights `query` in every drawn note, and in each note drawn from now
     * on.
     */
    setQuery(query: string): void {
        this.pattern = searchPattern(query);
        for (const block of this.ranges.keys()) this.highlight(block);
    }

    /** Highlights a newly drawn block until `component` unloads it. */
    track(block: HTMLElement, component: Component): void {
        this.highlight(block);
        component.register(() => this.forget(block));
    }

    /**
     * Finds the matches again in a tracked block whose content changed in
     * place.
     */
    refresh(block: HTMLElement): void {
        if (this.ranges.has(block)) this.highlight(block);
    }

    rangesIn(block: HTMLElement): readonly Range[] {
        return this.ranges.get(block) ?? [];
    }

    /** Marks the match the reader is on. Null removes the mark. */
    setCurrent(range: Range | null): void {
        if (this.current) registered(CURRENT, this.current.startContainer)?.delete(this.current);
        this.current = range;
        if (range) registered(CURRENT, range.startContainer)?.add(range);
    }

    private highlight(block: HTMLElement): void {
        this.unpaint(block);
        const found = this.pattern ? findRanges(block, this.pattern) : [];
        this.ranges.set(block, found);
        const highlight = registered(MATCH, block);
        for (const range of found) highlight?.add(range);
    }

    private forget(block: HTMLElement): void {
        this.unpaint(block);
        this.ranges.delete(block);
    }

    private unpaint(block: HTMLElement): void {
        // Stryker disable next-line ArrayDeclaration: an extra entry is not one of the highlight's ranges, so there is nothing to delete.
        const ranges = this.ranges.get(block) ?? [];
        if (this.current && ranges.includes(this.current)) this.setCurrent(null);
        const highlight = registered(MATCH, block);
        for (const range of ranges) highlight?.delete(range);
    }
}
