/**
 * Elements that are laid out as blocks in a rendered note.
 */
const BLOCK = /^(BLOCKQUOTE|DETAILS|DIV|DL|FIGURE|H[1-6]|HR|OL|P|PRE|SECTION|TABLE|UL)$/;

/**
 * Wraps in an element each piece of loose text that shares its parent with a
 * block element, mostly a list item's own words above its nested list. WebKit
 * paints no CSS highlight on such text, so on iOS search marked nothing there.
 */
export function wrapTextBesideBlocks(root: HTMLElement): void {
    for (const parent of [root, ...root.querySelectorAll("*")]) {
        if (![...parent.children].some((el) => BLOCK.test(el.tagName))) continue;
        for (const node of [...parent.childNodes]) {
            if (!node.instanceOf(Text) || !node.data.trim()) continue;
            const run = createSpan();
            run.addClass("daily-note-text-run");
            node.replaceWith(run);
            run.append(node);
        }
    }
}
