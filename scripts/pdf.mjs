/**
 * A PDF of `pages` letter-size pages, each showing its number in large type, as
 * text. This is enough for Obsidian's viewer, without keeping a binary test
 * file.
 *
 * @param {number} pages
 * @returns {string}
 */
export function pdf(pages) {
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
    const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`);
    objects.push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`);
    const font = "<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>";
    for (let i = 0; i < pages; i++) {
        const text = `BT /F1 48 Tf 72 700 Td (Page ${i + 1}) Tj ET`;
        objects.push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources ${font} >>`
        );
        objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    }
    let out = "%PDF-1.4\n";
    const offsets = objects.map((object, i) => {
        const offset = out.length;
        out += `${i + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = out.length;
    const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
    return `${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
