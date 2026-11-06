import type { App } from "obsidian";
import type { Moment } from "../notes/moment";
import type { ReadingNote, ReadingNotes } from "../stream/reading-notes";

/**
 * The part of the Calendar plugin's view (1.5.10) this uses. Neither method is
 * published: `updateActiveFile` highlights the active `FileView`'s file, and
 * `revealActiveNote` shows its month.
 */
interface CalendarView {
    containerEl: HTMLElement;
    updateActiveFile(): void;
    /** Calendar's own reads its view from `this`. */
    revealActiveNote: (this: CalendarView) => void;
}

/**
 * Calendar's open view, or null if it is closed or no longer has the methods.
 */
function calendarView(app: App): CalendarView | null {
    const view = app.workspace.getLeavesOfType("calendar")[0]?.view as Partial<CalendarView> | undefined;
    const usable = typeof view?.updateActiveFile === "function" && typeof view.revealActiveNote === "function";
    return usable ? (view as CalendarView) : null;
}

/**
 * Makes Calendar highlight the note a stream is reading, and turn to its
 * month when that changes (ADR 0024). Calendar reads the active tab's file, so
 * for the length of the call the stream's `file` is the note; at any other time
 * it is null, and Obsidian sees no open file. While Calendar is hidden, it
 * catches up once the stream stops. Returns the function that stops it.
 */
export function followInCalendar(app: App, notes: ReadingNotes): () => void {
    // The month this showed the Calendar view last told. A reopened Calendar
    // shows another.
    let told: { calendar: CalendarView; month: string | null } | null = null;
    let last: ReadingNote | null = null;
    // Calendar's own Reveal active note, for each view whose one this replaced.
    const ownReveals = new Map<CalendarView, () => void>();

    /**
     * Shows `calendar` the note as the active tab's file, and turns it to the
     * note's month if `turn`. Returns false, telling nothing, unless the stream
     * is the active tab: Calendar would show the active tab's file.
     */
    function tell(calendar: CalendarView, { view, note, date }: ReadingNote, turn: boolean): boolean {
        view.file = note;
        try {
            if (app.workspace.getActiveFile() !== note) return false;
            calendar.updateActiveFile();
            if (turn) {
                ownReveals.get(calendar)!.call(calendar);
                told = { calendar, month: date?.format("YYYY-MM") ?? null };
            }
            return true;
        } finally {
            view.file = null;
        }
    }

    /**
     * Calendar's open view, its Reveal active note made to show the note being
     * read while the stream is the active tab. Calendar's own looks for an open
     * file, and the stream shows none.
     */
    function calendar(): CalendarView | null {
        const view = calendarView(app);
        if (view && !ownReveals.has(view)) {
            const own = view.revealActiveNote;
            ownReveals.set(view, own);
            view.revealActiveNote = () => {
                if (!last || !tell(view, last, true)) own.call(view);
            };
        }
        return view;
    }

    function follow(reading: ReadingNote): void {
        const view = calendar();
        if (!view) return;
        if (reading.scrolling && !view.containerEl.isShown()) return;
        // A note with no date has no known month, so Calendar is turned to it.
        const month = reading.date?.format("YYYY-MM") ?? null;
        const sameMonth = month !== null && told?.calendar === view && told.month === month;
        tell(view, reading, !sameMonth);
    }

    const unsubscribe = notes.subscribe((reading) => {
        last = reading;
        follow(reading);
    });
    // Obsidian loads the view of a tab not yet shown, such as Calendar's in a
    // closed sidebar, only once it is shown. Until then it has no methods.
    const layoutChanged = app.workspace.on("layout-change", () => {
        if (last && calendarView(app) !== told?.calendar) follow({ ...last, scrolling: false });
    });
    return () => {
        unsubscribe();
        app.workspace.offref(layoutChanged);
        for (const [view, own] of ownReveals) view.revealActiveNote = own;
    };
}

/** Calendar's day click: its `onClickDay(date, inNewSplit)`. */
type ClickDay = (date: Moment, inNewSplit: boolean) => Promise<void>;

/**
 * The part of the Calendar plugin's view (1.5.10) its clicks need. Neither is
 * published: `calendar` is its Svelte component, given `openOrCreateDailyNote`
 * once, as the `onClickDay` prop.
 */
interface CalendarClicks {
    calendar: { $set(props: { onClickDay: ClickDay }): void };
    openOrCreateDailyNote: ClickDay;
}

/** Calendar's open view, or null if it is closed or no longer has these. */
function calendarClicks(app: App): CalendarClicks | null {
    const view = app.workspace.getLeavesOfType("calendar")[0]?.view as Partial<CalendarClicks> | undefined;
    const usable = typeof view?.calendar?.$set === "function" && typeof view.openOrCreateDailyNote === "function";
    return usable ? (view as CalendarClicks) : null;
}

/**
 * Makes a click on a Calendar day go to `showDay`, which scrolls the stream to
 * its note. When it returns false, Calendar opens the note itself, as it does
 * for a Ctrl/Cmd-click. Returns the function that gives the click back.
 */
export function takeCalendarClicks(app: App, showDay: (day: Moment) => Promise<boolean>): () => void {
    let taken: CalendarClicks | null = null;

    function take(): void {
        const view = calendarClicks(app);
        if (!view || view === taken) return;
        const open = view.openOrCreateDailyNote;
        view.calendar.$set({
            onClickDay: async (date, inNewSplit) => {
                if (inNewSplit || !(await showDay(date))) await open(date, inNewSplit);
            },
        });
        taken = view;
    }

    take();
    // A reopened Calendar has a new component, given Calendar's own handler.
    const layoutChanged = app.workspace.on("layout-change", take);
    return () => {
        app.workspace.offref(layoutChanged);
        // A closed Calendar's component is destroyed.
        if (taken && calendarClicks(app) === taken) {
            taken.calendar.$set({ onClickDay: taken.openOrCreateDailyNote });
        }
    };
}
