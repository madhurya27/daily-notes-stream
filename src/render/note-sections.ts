import type { CachedMetadata } from "obsidian";

/** An inline footnote, which Obsidian draws at the end of the note. */
const INLINE_FOOTNOTE = /\^\[/;

/**
 * Where a note's sections are, without the frontmatter. Null in the same cases
 * as `noteSections`.
 */
function sectionSpans(markdown: string, cache: CachedMetadata | null): { start: number; end: number }[] | null {
    if (!cache?.sections) return null;
    if (cache.footnotes?.length || cache.footnoteRefs?.length || cache.referenceLinks?.length) return null;
    if (INLINE_FOOTNOTE.test(markdown)) return null;
    return cache.sections
        .filter((section) => section.type !== "yaml")
        .map(({ position }) => ({ start: position.start.offset, end: position.end.offset }));
}

/**
 * A note's sections as source text, in order, without the frontmatter. Null
 * when the note must be drawn all at once: it is not indexed yet, or something
 * links one section to another (ADR 0019).
 */
export function noteSections(markdown: string, cache: CachedMetadata | null): string[] | null {
    return sectionSpans(markdown, cache)?.map(({ start, end }) => markdown.slice(start, end)) ?? null;
}

/**
 * A note's body as groups of whole sections, each up to `size` characters and
 * cut from the note's own text, so a long note is drawn one group at a time
 * (ADR 0020). Null in the same cases as `noteSections`.
 */
export function noteChunks(markdown: string, cache: CachedMetadata | null, size: number): string[] | null {
    const spans = sectionSpans(markdown, cache);
    if (!spans) return null;
    const runs: { start: number; end: number }[] = [];
    for (const span of spans) {
        const run = runs[runs.length - 1];
        if (run && span.end - run.start <= size) run.end = span.end;
        else runs.push({ ...span });
    }
    return runs.map(({ start, end }) => markdown.slice(start, end));
}

/**
 * Sections `[start, endBefore)` became `[start, endAfter)`. The others are the
 * same.
 */
export interface ChangedSpan {
    start: number;
    endBefore: number;
    endAfter: number;
}

/**
 * What a save changed: the sections between those that are the same at the
 * start and at the end.
 */
export function changedSpan(before: readonly string[], after: readonly string[]): ChangedSpan {
    let start = 0;
    // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: past the end of the shorter list, undefined matches no section.
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }
    return { start, endBefore, endAfter };
}
