import { describe, it, expect, vi } from "vitest";
import { retryLostPromise } from "../../e2e-tests/lost-promise";

const LOST = new Error("page.evaluate: Resulting promise was garbage collected.");

describe("retryLostPromise", () => {
    it("returns what the step returns, without a warning", async () => {
        const warn = vi.fn();

        await expect(retryLostPromise("close settings", async () => 7, warn)).resolves.toBe(7);
        expect(warn).not.toHaveBeenCalled();
    });

    it("runs the step again, with a GitHub warning, when Chromium lost its promise", async () => {
        const warn = vi.fn();
        const step = vi.fn().mockRejectedValueOnce(LOST).mockResolvedValueOnce(7);

        await expect(retryLostPromise("close settings", step, warn)).resolves.toBe(7);
        expect(step).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith(
            "::warning title=Lost promise in e2e startup::close settings ran again: Resulting promise was garbage collected."
        );
    });

    it("throws any other error, without running the step again", async () => {
        const step = vi.fn().mockRejectedValue(new Error("Execution context was destroyed"));

        await expect(retryLostPromise("close settings", step, vi.fn())).rejects.toThrow("context was destroyed");
        expect(step).toHaveBeenCalledTimes(1);
    });

    it("throws when the second run loses its promise too", async () => {
        const step = vi.fn().mockRejectedValue(LOST);

        await expect(retryLostPromise("close settings", step, vi.fn())).rejects.toThrow(LOST);
        expect(step).toHaveBeenCalledTimes(2);
    });
});
