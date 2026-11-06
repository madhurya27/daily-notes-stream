import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { FileView, TFile, WorkspaceLeaf } from "../mocks/obsidian";
import { asApp } from "../stream-view-fixture";
import { followInCalendar, takeCalendarClicks } from "../../src/integrations/calendar";
import { ReadingNotes } from "../../src/stream/reading-notes";
import { moment } from "../../src/notes/moment";

describe("followInCalendar", () => {
    const march11 = new TFile("Notes/2026-03-11.md");
    const march10 = new TFile("Notes/2026-03-10.md");
    const feb28 = new TFile("Notes/2026-02-28.md");
    const dateOf = (note: TFile) => moment(note.basename, "YYYY-MM-DD", true);

    let notes: ReadingNotes;
    let stream: FileView;
    let workspace: ReturnType<typeof makeWorkspace>;
    let calendar: {
        containerEl: HTMLElement;
        updateActiveFile: ReturnType<typeof vi.fn>;
        revealActiveNote: () => void;
    };
    /** Calendar's own `revealActiveNote`, which the adapter takes over. */
    let reveal: Mock<() => void>;
    /** What Calendar saw in the stream's `file` at each call. */
    let seen: string[];
    let stop: () => void;

    /** Something with `on` and `offref`, whose handlers the test can fire. */
    function makeEvents() {
        const handlers = new Map<string, () => void>();
        return {
            on: vi.fn((name: string, callback: () => void) => {
                handlers.set(name, callback);
                return { name };
            }),
            offref: vi.fn(),
            fire: (name: string) => handlers.get(name)?.(),
        };
    }

    /**
     * A workspace whose active tab the test sets. Its active file is that
     * tab's, read when asked, as Obsidian's is.
     */
    function makeWorkspace() {
        const events = makeEvents();
        const workspace = {
            ...events,
            active: null as { file: TFile | null } | null,
            getLeavesOfType: vi.fn(),
            getActiveFile: vi.fn((): TFile | null => workspace.active?.file ?? null),
            layoutChanged: () => events.fire("layout-change"),
        };
        return workspace;
    }

    function show(shown: boolean) {
        Object.defineProperty(calendar.containerEl, "offsetParent", {
            value: shown ? document.body : null,
            configurable: true,
        });
    }

    function read(note: TFile, scrolling = false) {
        notes.report({ view: stream, note, date: dateOf(note), scrolling });
    }

    beforeEach(() => {
        notes = new ReadingNotes();
        workspace = makeWorkspace();
        const app = asApp({ workspace });
        stream = new FileView(new WorkspaceLeaf(app));
        seen = [];
        reveal = vi.fn(() => {
            seen.push(`month ${stream.file?.path}`);
        });
        calendar = {
            containerEl: document.createElement("div"),
            updateActiveFile: vi.fn(() => seen.push(`day ${stream.file?.path}`)),
            revealActiveNote: reveal,
        };
        show(true);
        workspace.getLeavesOfType.mockImplementation((type: string) =>
            type === "calendar" ? [{ view: calendar }] : []
        );
        stop = followInCalendar(app, notes);
        workspace.active = stream;
    });

    it("shows Calendar the note being read as the stream's file, then takes it back", () => {
        read(march11);

        expect(seen).toEqual([`day ${march11.path}`, `month ${march11.path}`]);
        expect(stream.file).toBeNull();
    });

    it("moves Calendar to another month while scrolling only when the month changes", () => {
        read(march11);
        read(march10, true);
        read(feb28, true);

        expect(seen).toEqual([
            `day ${march11.path}`,
            `month ${march11.path}`,
            `day ${march10.path}`,
            `day ${feb28.path}`,
            `month ${feb28.path}`,
        ]);
    });

    // Calendar turns its month only when asked; the reader may have turned it.
    it("leaves Calendar's month alone when the stream stops in the same month", () => {
        read(march11);
        read(march10);
        read(feb28);

        expect(seen.filter((call) => call.startsWith("month"))).toEqual([
            `month ${march11.path}`,
            `month ${feb28.path}`,
        ]);
    });

    it("moves a newly opened Calendar to the note's month, even while scrolling", () => {
        read(march11);
        const reopenedReveal = vi.fn();
        const reopened = { ...calendar, revealActiveNote: reopenedReveal };
        workspace.getLeavesOfType.mockReturnValue([{ view: reopened }]);

        read(march10, true);

        expect(reopenedReveal).toHaveBeenCalledOnce();
    });

    it("moves Calendar to the note's month while scrolling when the note has no date", () => {
        read(march11);
        notes.report({ view: stream, note: march10, date: null, scrolling: true });

        expect(reveal).toHaveBeenCalledTimes(2);
    });

    it("moves Calendar to each dateless note's month while scrolling, as their months are unknown", () => {
        notes.report({ view: stream, note: march11, date: null, scrolling: true });
        notes.report({ view: stream, note: march10, date: null, scrolling: true });

        expect(reveal).toHaveBeenCalledTimes(2);
    });

    it("follows every change while Calendar is shown", () => {
        read(march11, true);

        expect(calendar.updateActiveFile).toHaveBeenCalledOnce();
    });

    it("waits for the stream to stop while Calendar is hidden, then catches up", () => {
        show(false);

        read(march11, true);
        read(feb28, true);
        expect(seen).toEqual([]);

        read(feb28);
        expect(seen).toEqual([`day ${feb28.path}`, `month ${feb28.path}`]);
    });

    it("does nothing while another tab is active, as Calendar would show that tab's file", () => {
        workspace.active = { file: march10 };

        read(march11);

        expect(seen).toEqual([]);
    });

    it("does nothing without Calendar, or with a Calendar that lacks either method", () => {
        workspace.getLeavesOfType.mockReturnValue([]);
        read(march11);
        workspace.getLeavesOfType.mockReturnValue([{ view: { ...calendar, revealActiveNote: undefined } }]);
        read(march10);
        workspace.getLeavesOfType.mockReturnValue([{ view: { ...calendar, updateActiveFile: "no" } }]);
        read(feb28);

        expect(seen).toEqual([]);
    });

    it("tells a Calendar view loaded later, as Obsidian loads a hidden tab's view only once it is shown", () => {
        workspace.getLeavesOfType.mockReturnValue([{ view: {} }]);
        read(march11, true);
        read(march10);
        workspace.getLeavesOfType.mockReturnValue([{ view: calendar }]);

        workspace.layoutChanged();

        expect(seen).toEqual([`day ${march10.path}`, `month ${march10.path}`]);
    });

    it("tells a Calendar view loaded while hidden the last note read, as the stream has stopped by then", () => {
        workspace.getLeavesOfType.mockReturnValue([{ view: {} }]);
        read(march10, true);
        workspace.getLeavesOfType.mockReturnValue([{ view: calendar }]);
        show(false);

        workspace.layoutChanged();

        expect(seen).toEqual([`day ${march10.path}`, `month ${march10.path}`]);
    });

    it("tells a Calendar it has told nothing more when the layout changes", () => {
        read(march11);
        seen = [];

        workspace.layoutChanged();

        expect(seen).toEqual([]);
    });

    it("tells Calendar nothing when the layout changes before any note is read", () => {
        workspace.layoutChanged();

        expect(seen).toEqual([]);
    });

    it("takes the file back even when Calendar throws", () => {
        calendar.updateActiveFile.mockImplementation(() => {
            throw new Error("changed");
        });

        expect(() => read(march11)).toThrow("changed");
        expect(stream.file).toBeNull();
    });

    it("stops following once stopped, and gives Calendar its Reveal active note back", () => {
        read(march11);
        seen = [];

        stop();
        read(march10);

        expect(seen).toEqual([]);
        expect(calendar.revealActiveNote).toBe(reveal);
        for (const ref of workspace.on.mock.results) expect(workspace.offref).toHaveBeenCalledWith(ref.value);
    });

    describe("Calendar's Reveal active note", () => {
        it("turns Calendar to the month of the note being read, with the stream active", () => {
            read(march11);
            seen = [];

            calendar.revealActiveNote();

            expect(seen).toEqual([`day ${march11.path}`, `month ${march11.path}`]);
            expect(stream.file).toBeNull();
        });

        it("is Calendar's own while another tab is active, or before a note is read", () => {
            calendar.revealActiveNote();
            expect(reveal).toHaveBeenCalledOnce();
            read(march11);
            workspace.active = { file: march10 };
            reveal.mockClear();
            seen = [];

            calendar.revealActiveNote();

            expect(reveal).toHaveBeenCalledOnce();
            expect(seen).toEqual(["month undefined"]);
        });

        // Reveal took it there, so a later stop in the month leaves it.
        it("counts as telling Calendar the month", () => {
            workspace.getLeavesOfType.mockReturnValue([{ view: {} }]);
            read(march11);
            workspace.getLeavesOfType.mockReturnValue([{ view: calendar }]);
            show(false);
            workspace.layoutChanged();
            seen = [];

            calendar.revealActiveNote();
            read(march10);

            expect(seen).toEqual([`day ${march11.path}`, `month ${march11.path}`, `day ${march10.path}`]);
        });
    });
});

describe("takeCalendarClicks", () => {
    const march11 = moment("2026-03-11", "YYYY-MM-DD", true);

    /**
     * Calendar's view as 1.5.10 builds it: its Svelte component, given
     * `openOrCreateDailyNote` as the `onClickDay` prop.
     */
    function makeCalendar() {
        const opened = vi.fn((_date: unknown, _inNewSplit: boolean) => Promise.resolve());
        const view = {
            openOrCreateDailyNote: opened,
            onClickDay: opened as (date: unknown, inNewSplit: boolean) => Promise<void>,
            calendar: { $set: vi.fn() },
        };
        view.calendar.$set.mockImplementation((props: { onClickDay: typeof view.onClickDay }) => {
            view.onClickDay = props.onClickDay;
        });
        return view;
    }

    let calendar: ReturnType<typeof makeCalendar>;
    let leaves: { view: unknown }[];
    let layoutChanged: () => void;
    let showDay: ReturnType<typeof vi.fn<(day: unknown) => Promise<boolean>>>;
    let stop: () => void;
    const workspace = {
        getLeavesOfType: vi.fn((type: string) => (type === "calendar" ? leaves : [])),
        on: vi.fn((_name: string, callback: () => void) => {
            layoutChanged = callback;
            return { name: "layout-change" };
        }),
        offref: vi.fn(),
    };

    beforeEach(() => {
        calendar = makeCalendar();
        leaves = [{ view: calendar }];
        showDay = vi.fn(() => Promise.resolve(true));
        stop = takeCalendarClicks(asApp({ workspace }), showDay);
    });

    it("shows the day clicked in the stream instead of opening its note", async () => {
        await calendar.onClickDay(march11, false);

        expect(showDay).toHaveBeenCalledWith(march11);
        expect(calendar.openOrCreateDailyNote).not.toHaveBeenCalled();
    });

    it("leaves a day the stream does not show to Calendar", async () => {
        showDay.mockResolvedValue(false);

        await calendar.onClickDay(march11, false);

        expect(calendar.openOrCreateDailyNote).toHaveBeenCalledWith(march11, false);
    });

    it("leaves a Ctrl/Cmd-click, which opens a new split, to Calendar", async () => {
        await calendar.onClickDay(march11, true);

        expect(showDay).not.toHaveBeenCalled();
        expect(calendar.openOrCreateDailyNote).toHaveBeenCalledWith(march11, true);
    });

    it("takes the clicks of a Calendar loaded later, or reopened, once", () => {
        const reopened = makeCalendar();
        leaves = [{ view: reopened }];

        layoutChanged();
        layoutChanged();

        expect(reopened.calendar.$set).toHaveBeenCalledOnce();
        expect(calendar.calendar.$set).toHaveBeenCalledOnce();
    });

    it("leaves a Calendar alone without its component or its click handler", () => {
        const noComponent = { openOrCreateDailyNote: vi.fn() };
        const noHandler = { calendar: { $set: vi.fn() } };

        for (const view of [noComponent, noHandler]) {
            leaves = [{ view }];
            expect(() => layoutChanged()).not.toThrow();
        }
        leaves = [];
        layoutChanged();

        expect(noHandler.calendar.$set).not.toHaveBeenCalled();
    });

    it("gives the click back to Calendar once stopped", async () => {
        stop();
        await calendar.onClickDay(march11, false);

        expect(calendar.openOrCreateDailyNote).toHaveBeenCalledWith(march11, false);
        expect(workspace.offref).toHaveBeenCalledWith({ name: "layout-change" });
    });

    // A closed Calendar's component is destroyed.
    it("gives nothing back to a Calendar closed since", () => {
        leaves = [];

        stop();

        expect(calendar.calendar.$set).toHaveBeenCalledOnce();
    });
});
