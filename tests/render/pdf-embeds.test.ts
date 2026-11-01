import { describe, expect, it } from "vitest";
import { extractPdfs, PDF_SLOT_CLASS } from "../../src/render/pdf-embeds";

const SLOT = `<div class="${PDF_SLOT_CLASS}"></div>`;

describe("extractPdfs", () => {
    it("leaves a slot for a PDF on a line of its own, with a blank line after it", () => {
        expect(extractPdfs("Before.\n![[Manual.pdf]]\nAfter.")).toEqual({
            markdown: `Before.\n${SLOT}\n\nAfter.`,
            pdfs: ["![[Manual.pdf]]"],
        });
    });

    it.each(["![[Manual.pdf#page=2]]", "![[Manual.pdf|300]]", "![[Manual.pdf#height=400|300]]", "![[Files/A B.PDF]]"])(
        "takes %s as a PDF",
        (embed) => {
            expect(extractPdfs(embed).pdfs).toEqual([embed]);
        }
    );

    it("keeps each PDF, in order, without the spaces around it", () => {
        expect(extractPdfs("   ![[a.pdf]]  \n\n![[b.pdf]]").pdfs).toEqual(["![[a.pdf]]", "![[b.pdf]]"]);
    });

    it.each([
        ["inside a line of text", "See ![[Manual.pdf]] here"],
        ["indented as code", "    ![[Manual.pdf]]"],
        ["of another kind", "![[photo.png]]"],
        ["only named like one", "![[Manual.pdf.md]]"],
        ["a link, not an embed", "[[Manual.pdf]]"],
    ])("leaves a PDF %s where it is", (_case, line) => {
        expect(extractPdfs(line)).toEqual({ markdown: line, pdfs: [] });
    });

    it.each([
        ["a closed code block", "```\n![[Manual.pdf]]\n```"],
        ["a code block of tildes", "~~~\n![[Manual.pdf]]\n~~~"],
        ["a code block left open", "```\n![[Manual.pdf]]"],
        ["a code block a shorter fence does not close", "````\n```\n![[Manual.pdf]]\n````"],
    ])("leaves a PDF inside %s", (_case, source) => {
        expect(extractPdfs(source)).toEqual({ markdown: source, pdfs: [] });
    });

    it("takes a PDF after a code block closes", () => {
        expect(extractPdfs("```\ncode\n```\n![[Manual.pdf]]").pdfs).toEqual(["![[Manual.pdf]]"]);
    });
});
