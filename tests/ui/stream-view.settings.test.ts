import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DailyNoteService } from "../../src/notes/daily-note-service";
import { makeApp, makeViewSetup } from "../stream-view-fixture";

const CONFIG_FILE = ".obsidian/daily-notes.json";

/** Fires the vault's undocumented "raw" event, as saving the settings would. */
function writeConfig(app: ReturnType<typeof makeApp>, path = CONFIG_FILE) {
    for (const [name, callback] of app.vault.on.mock.calls) {
        if (name === "raw") (callback as (p: string) => void)(path);
    }
}

describe("DailyNotesStreamView — Obsidian's daily-notes settings changed", () => {
    let app: ReturnType<typeof makeApp>;
    let service: DailyNoteService;

    beforeEach(async () => {
        vi.useFakeTimers();
        app = makeApp();
        ({ service } = await makeViewSetup(app));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Runs the delayed handler and empties the change queue. Not every timer,
     * because the midnight timer starts itself again.
     */
    async function settle() {
        await vi.advanceTimersByTimeAsync(1_000);
    }

    // What a changed format does to the stream is tested in
    // note-stream.test.ts.
    it("checks the daily-notes settings when the config is written", async () => {
        writeConfig(app);
        await settle();

        expect(service.refreshIfSettingsChanged).toHaveBeenCalledOnce();
    });

    it("ignores writes outside the config directory", async () => {
        writeConfig(app, "Notes/2025-01-01.md");
        await settle();

        expect(service.refreshIfSettingsChanged).not.toHaveBeenCalled();
    });
});
