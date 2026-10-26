import { describe, it, expect } from "vitest";
import { recordingAsked } from "../../e2e-tests/recording-asked";

// A recording replaces a README file in docs/images/, so only a capture command
// asks for one.
describe("recordingAsked", () => {
    it("is asked by CAPTURE_RECORDING=1, as the capture commands set it", () => {
        expect(recordingAsked({ CAPTURE_RECORDING: "1" })).toBe(true);
    });

    it("is not asked by a plain test run, which leaves the variable unset", () => {
        expect(recordingAsked({})).toBe(false);
    });

    it("is not asked by any other value", () => {
        expect(recordingAsked({ CAPTURE_RECORDING: "0" })).toBe(false);
    });
});
