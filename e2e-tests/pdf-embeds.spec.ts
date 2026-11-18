import { pdf } from "../scripts/pdf.mjs";
import { test, expect, openStream, writeNote, restoreNote } from "./obsidian";

/** Newer than every test note, so it is first in the stream. */
const NOTE = "Notes/2027-01-01.md";
const PDF = "Inline.pdf";

// A PDF inside a line is drawn apart from its note, into a placeholder, so the
// note does not wait for it to load (D-202). The words around it stay in place.
test("draws a PDF inside a line between the line's words", async ({ obsidian: { page } }) => {
    const pdfBefore = await writeNote(page, PDF, pdf(1));
    const before = await writeNote(page, NOTE, `Words first ![[${PDF}]] words after.\n`);
    try {
        const stream = await openStream(page);
        const content = stream.locator(`.daily-note-block[data-source-path="${NOTE}"] .daily-note-content`);
        await expect(content.locator(".pdf-embed canvas")).toBeVisible();

        const layout = await content.evaluate((el) => {
            const paragraph = el.querySelector("p")!;
            const box = paragraph.querySelector(".pdf-embed")!.getBoundingClientRect();
            const words = (text: string) => {
                const node = [...paragraph.childNodes].find((child) => child.textContent?.trim() === text)!;
                const range = document.createRange();
                range.selectNode(node);
                return range.getBoundingClientRect();
            };
            return {
                text: paragraph.textContent,
                // From the top of the words before the box to the box.
                above: box.top - words("Words first").top,
                // From the box to the middle of the words after it.
                below: (words("words after.").top + words("words after.").bottom) / 2 - box.bottom,
                lineHeight: parseFloat(getComputedStyle(paragraph).lineHeight),
            };
        });
        expect(layout.text).toMatch(/^Words first .*words after\.$/);
        // The words before on the line above the box, the words after on the
        // line below it.
        expect(layout.above).toBeGreaterThan(0);
        expect(layout.above).toBeLessThanOrEqual(layout.lineHeight);
        expect(layout.below).toBeGreaterThan(0);
        expect(layout.below).toBeLessThanOrEqual(layout.lineHeight);
    } finally {
        await restoreNote(page, NOTE, before);
        await restoreNote(page, PDF, pdfBefore);
    }
});
