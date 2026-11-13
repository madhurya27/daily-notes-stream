import { describe, it, expect } from "vitest";
import { codeAround, describeStack } from "../../e2e-tests/freeze-watch";

const frame = (functionName: string, url: string, lineNumber: number, columnNumber: number) => ({
    functionName,
    url,
    location: { scriptId: "1", lineNumber, columnNumber },
});

describe("describeStack", () => {
    // CDP counts lines and columns from 0.
    it("names each frame's function, file, line and column, counted from 1", () => {
        const frames = [
            frame("renderNext", "plugin:daily-notes-stream", 0, 41),
            frame("", "app://obsidian.md/app.js", 9, 0),
        ];

        expect(describeStack(frames)).toBe(
            ["    at renderNext (plugin:daily-notes-stream:1:42)", "    at (anonymous) (app.js:10:1)"].join("\n")
        );
    });
});

describe("codeAround", () => {
    it("shows the code on each side of a column in a long minified line, marking the column", () => {
        const source = `first line\n${"a".repeat(200)}while(x)y();${"b".repeat(200)}`;

        expect(codeAround(source, 1, 200, 5)).toBe("aaaaa>>>while");
    });

    it("stops at the line's ends", () => {
        expect(codeAround("while(x)y();", 0, 0, 5)).toBe(">>>while");
    });
});
