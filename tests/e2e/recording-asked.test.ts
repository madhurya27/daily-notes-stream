import { describe, it, expect } from "vitest";
import { recordingAsked, screenshotsAsked } from "../../e2e-tests/recording-asked";

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

// The screenshots replace README files in docs/images/, so only a capture
// command asks for them.
describe("screenshotsAsked", () => {
    it("is asked by CAPTURE_SCREENSHOTS=1, as the capture commands set it", () => {
        expect(screenshotsAsked({ CAPTURE_SCREENSHOTS: "1" })).toBe(true);
    });

    it("is not asked by a plain test run, which leaves the variable unset", () => {
        expect(screenshotsAsked({})).toBe(false);
    });

    it("is not asked by any other value", () => {
        expect(screenshotsAsked({ CAPTURE_SCREENSHOTS: "0" })).toBe(false);
    });

    it("is not asked by a recording", () => {
        expect(screenshotsAsked({ CAPTURE_RECORDING: "1" })).toBe(false);
    });
});
