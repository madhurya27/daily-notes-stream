import { describe, it, expect } from "vitest";
import { vaultConfig } from "../../e2e-tests/ios/vault-config";

// Obsidian's default theme is light. If the theme is not set, the phone's dark
// mode never shows.
describe("vaultConfig", () => {
    it("follows the phone's theme in a test run", () => {
        expect(vaultConfig({ readme: false })["appearance.json"]).toEqual({ theme: "system" });
    });

    it("is light for the README, as the desktop's pictures are", () => {
        expect(vaultConfig({ readme: true })["appearance.json"]).toEqual({ theme: "moonstone" });
    });
});
