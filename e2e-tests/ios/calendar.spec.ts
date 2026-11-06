import { test, expect, type Phone } from "./phone";
import { CALENDAR, fetchPinned, installPinnedVia } from "../pinned-plugin";
import { LANE_SLOT } from "./vault";

// Calendar follows the note being read (ADR 0024), here with real touches.
// Calendar is installed for each test and removed after it. Its tab is not
// shown until the stream has moved, so Obsidian loads its view only then.

let uninstall: () => Promise<void>;

test.beforeAll(() => fetchPinned(CALENDAR));

test.beforeEach(async ({ phone }) => {
    uninstall = await installPinnedVia((fn, arg) => phone.runAsync(fn, arg), CALENDAR);
    await phone.run(() => window.app.commands.executeCommandById("calendar:show-calendar-view"));
    await hideCalendar(phone);
});

test.afterEach(async ({ phone }) => {
    await hideCalendar(phone);
    await uninstall();
});

/** Closes the sidebar Calendar is in. */
const hideCalendar = (phone: Phone) => phone.run(() => window.app.workspace.rightSplit.collapse());

/** Opens Calendar's sidebar and brings its tab to the front. */
const showCalendar = (phone: Phone) =>
    phone.runAsync(() => window.app.workspace.revealLeaf(window.app.workspace.getLeavesOfType("calendar")[0]!));

/** The month Calendar shows, and the day it highlights. */
function calendarShows(phone: Phone) {
    return phone.run(() => {
        const calendar = document.querySelector('.workspace-leaf-content[data-type="calendar"]');
        return {
            month: calendar?.querySelector(".title")?.textContent?.replace(/\s+/g, " ").trim(),
            day: calendar?.querySelector(".day.active")?.textContent?.trim() ?? null,
        };
    });
}

/** The month and day of the note being read, as Calendar writes them. */
function reading(phone: Phone) {
    return phone.run(() => {
        const view = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view;
        const date = window.moment(view.stream.readingNote()!.basename, "YYYY-MM-DD");
        return { month: date.format("MMM YYYY"), day: date.format("D") };
    });
}

test("a flick takes Calendar to the day being read", async ({ phone }) => {
    await phone.openStream();
    const top = await reading(phone);

    await phone.flick("up", 2);
    const read = await reading(phone);
    expect(read).not.toEqual(top);
    await showCalendar(phone);

    await expect.poll(() => calendarShows(phone)).toEqual(read);
});

test("a jump to another month turns Calendar to it", async ({ phone }) => {
    await phone.openStream();
    await showCalendar(phone);
    const top = await reading(phone);
    await expect.poll(() => calendarShows(phone)).toEqual(top);
    await hideCalendar(phone);

    // In July, below the journal, which ends in September.
    await phone.jumpTo(LANE_SLOT.slice("Journal/".length, -".md".length));
    const read = await reading(phone);
    expect(read.month).not.toBe(top.month);
    await showCalendar(phone);

    await expect.poll(() => calendarShows(phone)).toEqual(read);
});
