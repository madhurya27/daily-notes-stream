import { describe, it, expect } from "vitest";
import { buildName } from "../../scripts/build-name.mjs";

// A build on the phone shows its name in a notice. Two words are easier to
// compare than a commit and a time.
describe("buildName", () => {
    it("names a build in two lowercase words", () => {
        expect(buildName("4b0df87")).toMatch(/^[a-z]+ [a-z]+$/);
    });

    it("gives the same code the same name", () => {
        expect(buildName("4b0df87 diff")).toBe(buildName("4b0df87 diff"));
    });

    it("gives different code a different name", () => {
        const names = new Set(Array.from({ length: 50 }, (_, i) => buildName(`commit ${i}`)));
        expect(names.size).toBeGreaterThan(45);
    });
});
