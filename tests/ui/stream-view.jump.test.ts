import { describe, it, expect, vi } from "vitest";
import { TFile, moment } from "../mocks/obsidian";
import { JumpToDateModal } from "../../src/ui/jump-to-date-modal";
import { makeViewSetup } from "../stream-view-fixture";

describe("DailyNotesStreamView — the jump action", () => {
    it("carries the date the modal returns into a jump", async () => {
        const { view, service } = await makeViewSetup();
        const opened: JumpToDateModal[] = [];
        vi.spyOn(JumpToDateModal.prototype, "open").mockImplementation(function (this: JumpToDateModal) {
            opened.push(this);
        });

        view.actions.find((a) => a.title === "Jump to date")!.callback(new MouseEvent("click"));
        opened[0]!["onSubmit"](moment("2025-01-05", "YYYY-MM-DD", true));

        expect(service.indexForDate).toHaveBeenCalledOnce();
        expect(vi.mocked(service.indexForDate).mock.calls[0]![0].format("YYYY-MM-DD")).toBe("2025-01-05");
    });
});

describe("DailyNotesStreamView — showing a note", () => {
    it("looks the note up in this view's own list", async () => {
        const { view, service } = await makeViewSetup();
        const file = new TFile("Notes/2025-01-05.md");

        await view.showNote(file);

        expect(service.indexOf).toHaveBeenCalledWith("Notes/2025-01-05.md");
    });
});

describe("DailyNotesStreamView — showing a day", () => {
    it("looks the day up in this view's own list, and says whether it found it", async () => {
        const { view, service } = await makeViewSetup();
        vi.mocked(service.indexOnDay).mockReturnValue(-1);

        const shown = await view.showDay(moment("2025-01-05", "YYYY-MM-DD", true));

        expect(shown).toBe(false);
        expect(vi.mocked(service.indexOnDay).mock.calls[0]![0].format("YYYY-MM-DD")).toBe("2025-01-05");
    });
});
