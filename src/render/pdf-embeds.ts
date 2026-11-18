import { closes, FENCE_OPEN } from "./bases/bases-as-cards";

/**
 * A PDF embed on a line of its own: `![[X.pdf]]`, `![[X.pdf#page=2]]`,
 * `![[X.pdf|300]]`.
 */
const PDF_EMBED = /^ {0,3}(!\[\[[^\]|#]+\.pdf(?:#[^\]|]*)?(?:\|[^\]]*)?\]\])\s*$/i;

/**
 * Within a line: a code span, a run of backticks that opens none, a comment's
 * `%%`, or a PDF embed. Matching them all at once finds each embed outside
 * code and comments.
 */
const IN_LINE = /(`+)(?!`).*?[^`]\1(?!`)|`+|%%|!\[\[[^\]|#]+\.pdf(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/gi;

const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:\s|$)/;

/** The placeholder a PDF taken out of the note is drawn into. */
export const PDF_SLOT_CLASS = "daily-note-pdf";
/**
 * An HTML block ends at a blank line, so the line after the placeholder is
 * still read as Markdown.
 */
const SLOT = `<div class="${PDF_SLOT_CLASS}"></div>`;
/** Inside a line, a span keeps the text around it on the same line. */
const INLINE_SLOT = `<span class="${PDF_SLOT_CLASS}"></span>`;

/** What the lines read so far leave open. */
interface LineState {
    fence: { marker: string } | null;
    /** Inside an Obsidian comment, `%%`, which may span lines. */
    comment: boolean;
    /** Inside an indented code block. */
    code: boolean;
    /** Inside a list, whose indented lines are not code. */
    list: boolean;
    blankBefore: boolean;
}

/**
 * The note's Markdown with each PDF replaced by an empty placeholder, and the
 * PDFs in order. A note's draw waits for all it renders, and a PDF takes
 * hundreds of milliseconds to load (D-202, D-238). A PDF stays where Obsidian
 * draws none, in code or a comment, and in a heading, whose text names it.
 */
export function extractPdfs(markdown: string): { markdown: string; pdfs: string[] } {
    const pdfs: string[] = [];
    // Stryker disable next-line BooleanLiteral: before the first line, a line
    // that goes on a code block opens one, as nothing comes before it.
    const state: LineState = { fence: null, comment: false, code: false, list: false, blankBefore: true };
    const out = markdown.split("\n").map((line) => slotLine(line, state, pdfs));
    return { markdown: out.join("\n"), pdfs };
}

/** `line` with its PDFs replaced, adding them to `pdfs`. */
function slotLine(line: string, state: LineState, pdfs: string[]): string {
    if (state.fence) {
        if (closes(state.fence, line)) state.fence = null;
        return line;
    }
    const blank = line.trim() === "";
    const code = isIndentedCode(line, blank, state);
    state.blankBefore = blank;
    if (code || blank) return line;

    const open = FENCE_OPEN.exec(line);
    if (open) {
        state.fence = { marker: open[2]! };
        return line;
    }
    const embed = state.comment ? null : PDF_EMBED.exec(line);
    if (embed) {
        pdfs.push(embed[1]!);
        return `${SLOT}\n`;
    }
    if (HEADING.test(line)) return line;
    return line.replace(IN_LINE, (token) => {
        if (token === "%%") state.comment = !state.comment;
        else if (token.startsWith("!") && !state.comment) {
            pdfs.push(token);
            return INLINE_SLOT;
        }
        return token;
    });
}

/**
 * Whether `line` is in an indented code block, and keeps track of the list
 * that tells one apart from an item's indented paragraph. Inside a comment,
 * an indented line is still read for the `%%` that closes it.
 */
function isIndentedCode(line: string, blank: boolean, state: LineState): boolean {
    const indented = /^(?: {4}|\t)/.test(line);
    if (state.code && (blank || indented)) return true;
    if (LIST_ITEM.test(line)) state.list = true;
    else if (state.blankBefore && /^ ?\S/.test(line)) state.list = false;
    state.code = indented && state.blankBefore && !state.list && !state.comment;
    return state.code;
}

/**
 * Runs `draw`, and settles when `slot` holds a PDF's box, which has the height
 * the note is measured at, or when `draw` settles, as it does if no box comes.
 * Hands back before the PDF has loaded.
 */
export async function untilPdfBox(slot: HTMLElement, draw: () => Promise<void>): Promise<void> {
    let watch!: MutationObserver;
    const box = new Promise<void>((resolve) => {
        watch = new MutationObserver(() => {
            if (slot.querySelector(".pdf-embed")) resolve();
        });
    });
    watch.observe(slot, { subtree: true, childList: true });
    await Promise.race([box, draw()]);
    watch.disconnect();
}
