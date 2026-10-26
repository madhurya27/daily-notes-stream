import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { JumpToDateModal, JUMP_OPEN_LIMIT, JUMP_SEARCH_LIMIT } from "../../src/ui/jump-to-date-modal";
import { DailyNoteService } from "../../src/notes/daily-note-service";
import { __mockSettings, __mockMarkdownFiles, __setMockNotes, __setMockSettings } from "../mocks/daily-notes";
import { Platform, moment } from "obsidian";
import type { Moment } from "../../src/notes/moment";
import { asApp, makeApp } from "../stream-view-fixture";

describe("JumpToDateModal", () => {
    let onSubmit: Mock<(target: Moment) => void>;
    let modal: JumpToDateModal;

    /** Opens the jump list for a vault that names its notes in `format`. */
    async function open(format: string, basenames: string[]) {
        __setMockSettings({ format, folder: "Notes" });
        __setMockNotes(basenames.map((name) => `Notes/${name}.md`));
        const service = new DailyNoteService(__mockMarkdownFiles, __mockSettings);
        await service.initialize();
        modal = new JumpToDateModal(asApp(makeApp()), service, onSubmit);
        modal.close = vi.fn();
        modal.open();
    }

    const listed = () => [...modal.resultContainerEl.children].map((el) => el.textContent);
    const picker = () => modal.contentEl.querySelector<HTMLInputElement>('input[type="date"]');
    const calendarIcon = () => modal.contentEl.querySelector(".daily-notes-jump-calendar");

    beforeEach(() => {
        onSubmit = vi.fn();
    });

    afterEach(() => {
        modal.contentEl.remove();
        Platform.isMobile = false;
    });

    it("offers every date, newest first, as this vault names its notes", async () => {
        await open("DD-MM-YYYY", ["01-01-2025", "03-01-2025", "02-01-2025"]);

        expect(listed()).toEqual(["03-01-2025", "02-01-2025", "01-01-2025"]);
    });

    it("narrows to the dates the query appears in", async () => {
        await open("DD-MM-YYYY", ["01-01-2025", "03-02-2025", "02-01-2025"]);

        modal.type("-01-");

        expect(listed()).toEqual(["02-01-2025", "01-01-2025"]);
    });

    it("asks for a date, showing today's as this vault names it", async () => {
        await open("DD-MM-YYYY", ["01-01-2025"]);

        expect(modal.inputEl.placeholder).toBe(`Jump to a date, e.g. ${moment().format("DD-MM-YYYY")}`);
        expect(modal.emptyStateText).toBe("No daily note, and no date to jump to.");
    });

    it("narrows on a query in any case, the spaces around it aside", async () => {
        await open("MMM D, YYYY", ["Jan 1, 2025", "Feb 3, 2025"]);

        modal.type(" JAN ");

        expect(listed()).toEqual(["Jan 1, 2025"]);
    });

    // The reader may type an ISO date, whatever their file names look like.
    it("narrows on an ISO query in a vault that names nothing that way", async () => {
        await open("DD-MM-YYYY", ["01-01-2025", "03-02-2025"]);

        modal.type("2025-02");

        expect(listed()).toEqual(["03-02-2025"]);
    });

    /** `count` days in a row from `first`, as ISO file names. */
    const days = (first: string, count: number) =>
        Array.from({ length: count }, (_, i) => moment(first, "YYYY-MM-DD", true).add(i, "days").format("YYYY-MM-DD"));

    it("opens on about two months of the newest dates", async () => {
        await open("YYYY-MM-DD", days("2025-01-01", 500));

        expect(listed()).toHaveLength(JUMP_OPEN_LIMIT);
        expect(listed()[0]).toBe("2026-05-15");
    });

    it("lists a whole year once a query is typed", async () => {
        await open("YYYY-MM-DD", days("2024-06-01", 700));

        modal.type("2025");

        expect(listed()).toHaveLength(365);
    });

    it("keeps a typed query's list to about a year", async () => {
        await open("YYYY-MM-DD", days("2024-06-01", 700));

        modal.type("20");

        expect(listed()).toHaveLength(JUMP_SEARCH_LIMIT);
    });

    it("submits the date that was chosen", async () => {
        await open("DD-MM-YYYY", ["01-01-2025", "03-01-2025"]);

        modal.type("01-01");
        modal.choose();

        expect(onSubmit).toHaveBeenCalledOnce();
        expect(onSubmit.mock.calls[0]![0].format("YYYY-MM-DD")).toBe("2025-01-01");
    });

    // The jump list replaces quietly going to the nearest older note. A date
    // with no note is still listed, but it says so first.
    describe("a date no note carries", () => {
        it("offers the jump as one entry, saying what it will do", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            modal.type("05-01-2025");

            expect(listed()).toEqual(["05-01-2025 has no noteJump to the nearest older note"]);
            expect(modal.resultContainerEl.querySelector(".daily-notes-jump-fallback")?.textContent).toBe(
                "Jump to the nearest older note"
            );
        });

        it("says nothing more of a date that has its note", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            expect(modal.resultContainerEl.querySelector(".daily-notes-jump-fallback")).toBeNull();
        });

        it("reads a date typed with spaces around it", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            modal.type(" 05-01-2025 ");

            expect(listed()).toEqual(["05-01-2025 has no noteJump to the nearest older note"]);
        });

        it("reads no ISO date with more after it", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            modal.type("2025-01-05x");

            expect(listed()).toEqual([]);
        });

        it("reads the query in ISO too", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            modal.type("2025-01-05");

            expect(listed()).toEqual(["05-01-2025 has no noteJump to the nearest older note"]);
        });

        it("hands the date over, leaving the fallback to the jump itself", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            modal.type("05-01-2025");
            modal.choose();

            expect(onSubmit.mock.calls[0]![0].format("YYYY-MM-DD")).toBe("2025-01-05");
        });

        it("offers nothing on a query that is no date at all", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            modal.type("not-a-date");

            expect(listed()).toEqual([]);
        });
    });

    describe("the calendar button", () => {
        afterEach(() => {
            delete (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker;
        });

        // iOS has showPicker() but opens nothing from it. Its date picker only
        // opens from a tap on the date input itself, so the input is the
        // button.
        it("is the date input itself, under the calendar icon", async () => {
            await open("YYYY-MM-DD", ["2025-01-01"]);

            expect(calendarIcon()!.getAttribute("data-icon")).toBe("calendar");
            expect(picker()!.parentElement).toBe(calendarIcon());
            expect(picker()!.getAttribute("aria-label")).toBe("Pick a date");
            expect(picker()!.hasClass("daily-notes-jump-picker")).toBe(true);
        });

        it("asks for the wheel on a click, where the platform can show it", async () => {
            const showPicker = vi.fn();
            (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker = showPicker;
            await open("YYYY-MM-DD", ["2025-01-01"]);

            picker()!.click();

            expect(showPicker).toHaveBeenCalledOnce();
        });

        it("leaves a click to the platform where it has no showPicker", async () => {
            await open("YYYY-MM-DD", ["2025-01-01"]);

            expect(() => picker()!.click()).not.toThrow();
        });

        it("writes the picked date into the query, in this vault's format", async () => {
            await open("DD-MM-YYYY", ["01-01-2025", "03-01-2025"]);

            picker()!.value = "2025-01-03";
            picker()!.dispatchEvent(new Event("change"));

            expect(modal.inputEl.value).toBe("03-01-2025");
            expect(listed()).toEqual(["03-01-2025"]);
        });

        it("ignores a picker cleared rather than set", async () => {
            await open("DD-MM-YYYY", ["01-01-2025"]);

            picker()!.value = "";
            picker()!.dispatchEvent(new Event("change"));

            expect(modal.inputEl.value).toBe("");
        });
    });

    // A focused search field brings up the phone's keyboard over half the list.
    it("leaves the query unfocused on mobile, so the list opens without a keyboard", async () => {
        Platform.isMobile = true;
        await open("YYYY-MM-DD", ["2025-01-01"]);

        expect(document.activeElement).not.toBe(modal.inputEl);
    });

    it("focuses the query on desktop, ready to type", async () => {
        await open("YYYY-MM-DD", ["2025-01-01"]);

        expect(document.activeElement).toBe(modal.inputEl);
    });

    it("empties its content on close, so a reopen starts clean", async () => {
        await open("YYYY-MM-DD", ["2025-01-01"]);

        modal.onClose();

        expect(modal.contentEl.childElementCount).toBe(0);
    });
});
