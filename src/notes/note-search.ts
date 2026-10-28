import type { TFile } from "obsidian";

/**
 * The query as typed, ignoring case. Null if it is blank, which matches
 * nothing.
 */
export function searchPattern(query: string): RegExp | null {
    if (query.trim() === "") return null;
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

/**
 * Markdown that the reading view does not show as text, and what it shows
 * instead: a link's alias or name, and emphasis and code without their marks.
 * An underscore inside a word is not a mark.
 */
const MARKUP: [RegExp, string][] = [
    [/!?\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1"],
    [/!?\[\[([^\]]*)\]\]/g, "$1"],
    [/!?\[([^\]]*)\]\([^)]*\)/g, "$1"],
    [/\*+|~~|==|`+|(?<!\w)_+|_+(?!\w)/g, ""],
];

/** The note's Markdown as the reading view shows it, near enough to search. */
function shownText(markdown: string): string {
    return MARKUP.reduce((text, [markup, shown]) => text.replace(markup, shown), markdown);
}

/**
 * The notes whose title or text contains `query`, in the order given. It
 * searches the note's Markdown, not the rendered text, because an unloaded note
 * has no rendered text (ADR 0006). The Markdown matches either as written or as
 * shown, so formatting between two words does not stop a match (D-182).
 */
export async function findNotes(
    notes: readonly TFile[],
    read: (file: TFile) => Promise<string>,
    query: string
): Promise<TFile[]> {
    const pattern = searchPattern(query);
    if (!pattern) return [];
    const holds = (text: string) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
    };
    const holdsText = (text: string) => holds(text) || holds(shownText(text));
    const found = await Promise.all(notes.map(async (file) => holds(file.basename) || holdsText(await read(file))));
    return notes.filter((_, i) => found[i]);
}
