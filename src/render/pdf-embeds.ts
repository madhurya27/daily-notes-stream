import { closes, FENCE_OPEN } from "./bases/bases-as-cards";

/**
 * A PDF embed on a line of its own: `![[X.pdf]]`, `![[X.pdf#page=2]]`,
 * `![[X.pdf|300]]`.
 */
const PDF_EMBED = /^ {0,3}(!\[\[[^\]|#]+\.pdf(?:#[^\]|]*)?(?:\|[^\]]*)?\]\])\s*$/i;

/** The placeholder a PDF taken out of the note is drawn into. */
export const PDF_SLOT_CLASS = "daily-note-pdf";
/**
 * An HTML block ends at a blank line, so the line after the placeholder is
 * still read as Markdown.
 */
const SLOT = `<div class="${PDF_SLOT_CLASS}"></div>`;

/**
 * The note's Markdown with each PDF on a line of its own replaced by an empty
 * placeholder, and the PDFs in order. A note's draw waits for all it renders,
 * and a PDF takes hundreds of milliseconds to load (D-202). One inside a line
 * of text stays, because a placeholder would break the line.
 */
export function extractPdfs(markdown: string): { markdown: string; pdfs: string[] } {
    const out: string[] = [];
    const pdfs: string[] = [];
    let fence: { marker: string } | null = null;

    for (const line of markdown.split("\n")) {
        if (fence) {
            if (closes(fence, line)) fence = null;
            out.push(line);
            continue;
        }
        const open = FENCE_OPEN.exec(line);
        if (open) fence = { marker: open[2]! };
        const embed = open ? null : PDF_EMBED.exec(line);
        if (embed) {
            pdfs.push(embed[1]!);
            out.push(SLOT, "");
        } else out.push(line);
    }
    return { markdown: out.join("\n"), pdfs };
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
