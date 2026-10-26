import { describe, it, expect } from "vitest";
import { pdf } from "../../scripts/pdf.mjs";

describe("pdf", () => {
    const doc = pdf(3);

    it("holds one page object per page, each with its number on it", () => {
        expect(doc).toMatch(/^%PDF-1\.4\n/);
        expect(doc).toContain("/Count 3");
        expect(doc.match(/\/Type \/Page /g)).toHaveLength(3);
        expect(doc).toContain("(Page 3) Tj");
    });

    // pdf.js finds each object through the table: the catalog, the page list,
    // then a page and its text for each page.
    it("points each cross-reference entry at its object", () => {
        const [, table = ""] = doc.split(/xref\n0 \d+\n0000000000 65535 f \n/);
        const offsets = table
            .split("\n")
            .filter((line) => line.endsWith(" n "))
            .map((line) => Number(line.slice(0, 10)));

        expect(offsets).toHaveLength(2 + 3 * 2);
        offsets.forEach((offset, i) => expect(doc.startsWith(`${i + 1} 0 obj`, offset)).toBe(true));
        expect(doc).toContain(`startxref\n${doc.indexOf("xref\n")}\n%%EOF\n`);
    });
});
