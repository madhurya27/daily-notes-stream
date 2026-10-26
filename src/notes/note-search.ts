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
 * The notes whose title or text contains `query`, in the order given. It
 * searches the note's Markdown, not the drawn text, because an emptied note has
 * no drawn text (ADR 0006).
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
    const found = await Promise.all(notes.map(async (file) => holds(file.basename) || holds(await read(file))));
    return notes.filter((_, i) => found[i]);
}
