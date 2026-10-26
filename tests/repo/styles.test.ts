import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const styles = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");

/** Each rule's declaration block, keyed by its selector. */
const rules = [...styles.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: selector!.trim(), body: body! })
);

describe("styles.css", () => {
    it("holds rules", () => {
        expect(rules.length).toBeGreaterThan(0);
    });

    // The directory's scorecard warns on each (D-153).
    it("selects with no :has", () => {
        for (const { selector } of rules) expect(selector).not.toContain(":has(");
    });

    it("selects no custom element by its tag", () => {
        for (const { selector } of rules) {
            // A highlight's name is not a tag.
            const tags = selector.replace(/::highlight\([^)]*\)/g, "");
            expect(tags, selector).not.toMatch(/(^|[\s>+~(,])[a-z]+-[a-z-]+(?=[\s[.:>+~,)]|$)/);
        }
    });

    it("uses no !important", () => {
        expect(rules.filter(({ body }) => body.includes("!important"))).toEqual([]);
    });

    // WebKit only reads the prefixed property, so on iOS, Obsidian's
    // `-webkit-user-select: none` won. Nothing could be selected, and there
    // were no search highlights, because WebKit does not draw them on text that
    // cannot be selected.
    it("spells every user-select for WebKit too", () => {
        for (const { selector, body } of rules) {
            const value = /(?<![-\w])user-select:\s*([^;]+);/.exec(body)?.[1];
            if (value) expect(body, selector).toContain(`-webkit-user-select: ${value}`);
        }
    });
});
