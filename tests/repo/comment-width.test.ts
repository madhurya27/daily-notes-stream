import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/** Comment lines are at most this wide, counting indentation (D-175). */
const WIDTH = 80;

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

/** Each line inside a `/* … *\/` comment, with its line number. */
function blockCommentLines(text: string): { line: number; text: string }[] {
    const lines = text.split("\n");
    const found: { line: number; text: string }[] = [];
    let inside = false;
    for (const [i, line] of lines.entries()) {
        if (!inside && line.includes("/*")) inside = true;
        if (inside) found.push({ line: i + 1, text: line });
        if (inside && line.includes("*/")) inside = false;
    }
    return found;
}

/**
 * Each `//` comment line, with its line number. An indented example in a
 * comment, such as a command line, cannot wrap, so it is left out.
 */
function lineCommentLines(text: string): { line: number; text: string }[] {
    return text
        .split("\n")
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(({ text }) => /^\s*\/\/(?! {2})/.test(text));
}

/** The lines over `WIDTH`, as `line: text`, so a failure names them. */
const tooLong = (lines: { line: number; text: string }[]) =>
    lines.filter(({ text }) => text.length > WIDTH).map(({ line, text }) => `${line}: ${text}`);

// ESLint checks comments in every TypeScript and JavaScript file. It cannot
// read CSS or Swift, so these are checked here.
describe("comment width", () => {
    it("holds in styles.css", () => {
        const lines = blockCommentLines(read("styles.css"));
        expect(lines.length).toBeGreaterThan(0);
        expect(tooLong(lines)).toEqual([]);
    });

    for (const path of ["scripts/capture-iphone.swift", "scripts/draw-touches.swift"]) {
        it(`holds in ${path}`, () => {
            const text = read(path);
            const lines = [...lineCommentLines(text), ...blockCommentLines(text)];
            expect(lines.length).toBeGreaterThan(0);
            expect(tooLong(lines)).toEqual([]);
        });
    }

    it("leaves an indented example out", () => {
        const example = `//   swift -O scripts/draw-touches.swift ${"x".repeat(WIDTH)}`;
        expect(lineCommentLines(example)).toEqual([]);
        expect(lineCommentLines(`// ${"x".repeat(WIDTH)}`)).toHaveLength(1);
    });
});
