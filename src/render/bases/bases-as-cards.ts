import { parseYaml, stringifyYaml } from "obsidian";

/**
 * The first line of a code block: up to three spaces, then three or more
 * ` or ~, then the info string.
 */
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)/;
/**
 * A Base embed on a line of its own: `![[X.base]]`, `![[X.base#View]]`,
 * `![[X.base|300]]`.
 */
const BASE_EMBED = /^ {0,3}!\[\[([^\]|#]+\.base)(?:#([^\]|]+))?(?:\|[^\]]*)?\]\]\s*$/;

interface Fence {
    marker: string;
    indent: string;
    isBase: boolean;
    opening: string;
    body: string[];
}

/**
 * A Base's definition with its table and kanban views changed to cards, at
 * `cardSize` if given. `first`, the view an embed names, is moved to the front,
 * because a Base shows its first view. Null if no view can be changed, so the
 * Base keeps its fitted columns.
 */
export function asCards(definition: string, first?: string, cardSize?: number): string | null {
    const parsed = parseDefinition(definition);
    if (!parsed || !Array.isArray(parsed.views)) return null;

    const views: unknown[] = parsed.views;
    if (!views.some(drawsWide)) return null;
    const size = cardSize === undefined ? {} : { cardSize };
    const converted = views.map((view) => (drawsWide(view) ? { ...view, type: "cards", ...size } : view));
    const named = converted.findIndex((view) => isRecord(view) && view.name === first);
    // Stryker disable next-line EqualityOperator: moving the first view to the front leaves it where it is.
    if (named > 0) converted.unshift(...converted.splice(named, 1));
    // Stryker disable next-line MethodExpression: a blank line before the closing fence draws the same.
    return stringifyYaml({ ...parsed, views: converted }).trimEnd();
}

/**
 * The placeholder a Base taken out of the note is drawn into. Each Base gets
 * its own.
 */
export const BASE_SLOT_CLASS = "daily-note-base";
/**
 * An HTML block ends at a blank line, so the line after the placeholder is
 * still read as Markdown.
 */
const SLOT = `<div class="${BASE_SLOT_CLASS}"></div>`;

/** A Base as the note writes it, and the Markdown that draws it as written. */
export type BaseSource =
    | { kind: "block"; definition: string; markdown: string }
    | { kind: "embed"; link: string; view: string | undefined; markdown: string };

/**
 * The note's Markdown with each Base (a `base` code block, or an embed on a
 * line of its own) replaced by an empty placeholder, and the Bases in order.
 * Each one is rendered into its own placeholder, so it can be re-rendered on
 * its own.
 */
export function extractBases(markdown: string): { markdown: string; bases: BaseSource[] } {
    const out: string[] = [];
    const bases: BaseSource[] = [];
    let fence: Fence | null = null;

    for (const line of markdown.split("\n")) {
        if (fence) {
            if (!closes(fence, line)) fence.body.push(line);
            else {
                if (fence.isBase) {
                    bases.push(baseBlock(fence, line));
                    out.push(fence.indent + SLOT, "");
                } else out.push(fence.opening, ...fence.body, line);
                fence = null;
            }
            continue;
        }

        const open = FENCE_OPEN.exec(line);
        if (open) {
            // Stryker disable next-line StringLiteral: both groups always match, even if only an empty string.
            const [, indent = "", marker = "", info] = open;
            fence = { marker, indent, isBase: info === "base", opening: line, body: [] };
            continue;
        }

        const embed = BASE_EMBED.exec(line);
        if (embed) {
            bases.push({ kind: "embed", link: embed[1]!, view: embed[2], markdown: line.trim() });
            out.push(SLOT, "");
        } else out.push(line);
    }

    if (fence) out.push(fence.opening, ...fence.body);
    return { markdown: out.join("\n"), bases };
}

/**
 * Whether `line` closes the code block: a fence of the same character, at least
 * as long.
 */
function closes(fence: Fence, line: string): boolean {
    const trimmed = line.trim();
    return trimmed.length >= fence.marker.length && trimmed === fence.marker[0]!.repeat(trimmed.length);
}

/** The code block without the indent, which its placeholder keeps. */
function baseBlock(fence: Fence, closing: string): BaseSource {
    const dedent = (line: string) => (line.startsWith(fence.indent) ? line.slice(fence.indent.length) : line);
    const definition = fence.body.map(dedent).join("\n");
    const markdown = [dedent(fence.opening), definition, dedent(closing)].join("\n");
    return { kind: "block", definition, markdown };
}

/** A Base's YAML as an object, or null if it is not an object. */
export function parseDefinition(definition: string): Record<string, unknown> | null {
    // Stryker disable BlockStatement: an empty catch returns undefined, which the caller treats the same as null.
    try {
        const parsed: unknown = parseYaml(definition);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A view that can be wider than its note. As cards, a kanban's columns become
 * groups.
 */
function drawsWide(view: unknown): view is Record<string, unknown> {
    return isRecord(view) && (view.type === "table" || view.type === "kanban");
}
