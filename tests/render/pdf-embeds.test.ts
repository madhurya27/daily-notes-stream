import { describe, expect, it } from "vitest";
import { extractPdfs, PDF_SLOT_CLASS } from "../../src/render/pdf-embeds";

const SLOT = `<div class="${PDF_SLOT_CLASS}"></div>`;
const INLINE_SLOT = `<span class="${PDF_SLOT_CLASS}"></span>`;

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

    it("leaves a slot inside the line for a PDF inside a line of text", () => {
        expect(extractPdfs("See ![[Manual.pdf]] here")).toEqual({
            markdown: `See ${INLINE_SLOT} here`,
            pdfs: ["![[Manual.pdf]]"],
        });
    });

    it("keeps PDFs inside lines and on their own lines in order", () => {
        expect(extractPdfs("![[a.pdf]] and ![[b.pdf|300]]\n![[c.pdf]]\n- ![[d.pdf#page=2]]").pdfs).toEqual([
            "![[a.pdf]]",
            "![[b.pdf|300]]",
            "![[c.pdf]]",
            "![[d.pdf#page=2]]",
        ]);
    });

    it.each([
        ["a list item", "- ![[a.pdf]]", `- ${INLINE_SLOT}`],
        ["a quote", "> ![[a.pdf]]", `> ${INLINE_SLOT}`],
        ["a table cell", "| ![[a.pdf]] | x |", `| ${INLINE_SLOT} | x |`],
        ["a line after code", "`code` ![[a.pdf]]", `\`code\` ${INLINE_SLOT}`],
        ["a line whose backticks open no code", "`` x ![[a.pdf]] `", `\`\` x ${INLINE_SLOT} \``],
        ["a line with spaces inside it", "Words\n\nSee    ![[a.pdf]]", `Words\n\nSee    ${INLINE_SLOT}`],
        ["a line after a comment", "%% hidden %% ![[a.pdf]]", `%% hidden %% ${INLINE_SLOT}`],
        ["the line after a comment closes", "%%\nhidden\n%%\n![[a.pdf]]", `%%\nhidden\n%%\n${SLOT}\n`],
        ["a paragraph's indented line", "Words\n    ![[a.pdf]]", `Words\n    ${INLINE_SLOT}`],
        ["a nested list item", "- Bills\n\t- ![[a.pdf]]", `- Bills\n\t- ${INLINE_SLOT}`],
        ["a nested list item after a blank line", "- Bills\n\n\t- ![[a.pdf]]", `- Bills\n\n\t- ${INLINE_SLOT}`],
        ["a list's indented paragraph", "- item\n\n    ![[a.pdf]]", `- item\n\n    ${INLINE_SLOT}`],
        ["a line after an indented code block", "    code\n![[a.pdf]] x", `    code\n${INLINE_SLOT} x`],
        ["a paragraph after a list", "- item\n\nWords\n\n    ![[a.pdf]]", "- item\n\nWords\n\n    ![[a.pdf]]"],
    ])("takes a PDF in %s", (_case, source, markdown) => {
        expect(extractPdfs(source).markdown).toBe(markdown);
    });

    // In each of these, Obsidian draws no PDF, or a heading's text would
    // change.
    it.each([
        ["code", "See `![[a.pdf]]` here"],
        ["code with a backtick inside", "See `` `![[a.pdf]] `` here"],
        ["a comment", "See %% ![[a.pdf]] %% here"],
        ["a comment across lines", "%% start\n![[a.pdf]] here\n![[b.pdf]]\nend %%"],
        ["a heading", "## Read ![[a.pdf]]"],
        ["indented code after a blank line", "Words\n\n    ![[a.pdf]] here"],
        ["indented code at the start", "\t![[a.pdf]] here"],
        ["indented code's second line", "    code\n    ![[a.pdf]] here"],
        ["indented code past a line of spaces", "    code\n  \n    ![[a.pdf]] here"],
        ["indented code past a blank line", "    code\n\n    ![[a.pdf]] here"],
    ])("leaves a PDF inside %s where it is", (_case, source) => {
        expect(extractPdfs(source)).toEqual({ markdown: source, pdfs: [] });
    });
});
