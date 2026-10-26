import { describe, it, expect } from "vitest";
import { readDateFormat } from "../../src/notes/daily-note-format";

describe("readDateFormat", () => {
    it("splits a nested format into the path and the filename's part", () => {
        expect(readDateFormat({ format: "YYYY/MM/YYYY-MM-DD", folder: "Notes" })).toEqual({
            path: "YYYY/MM/YYYY-MM-DD",
            basename: "YYYY-MM-DD",
            folder: "Notes",
        });
    });

    it("falls back to YYYY-MM-DD when no format is set", () => {
        expect(readDateFormat({ format: "", folder: "Notes" })).toMatchObject({
            path: "YYYY-MM-DD",
            basename: "YYYY-MM-DD",
        });
    });

    it("keeps a filename format when the format ends in a folder", () => {
        expect(readDateFormat({ format: "YYYY/MM/", folder: "Notes" }).basename).toBe("YYYY-MM-DD");
    });

    // normalizePath turns an unset folder into "/".
    it.each([
        ["Notes/", "Notes"],
        ["/Notes", "Notes"],
        ["/", ""],
        [" Notes ", "Notes"],
        ["", ""],
        [undefined, ""],
    ])("reads the folder %j as %j", (folder, expected) => {
        expect(readDateFormat({ format: "YYYY-MM-DD", folder }).folder).toBe(expected);
    });
});
