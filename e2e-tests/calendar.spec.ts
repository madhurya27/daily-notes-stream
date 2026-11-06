import type { Locator, Page } from "@playwright/test";
import { test, expect, openStream, restoreNote, setHideEmptyNotes, writeNote } from "./obsidian";
import { CALENDAR, installPinned } from "./pinned-plugin";

// Calendar follows the note being read (ADR 0024). Each test reads Calendar
// with its sidebar open after the stream has stopped, which works the same on
// desktop and in the phone layout, where the sidebar is a drawer.

let uninstall: () => Promise<void>;
/** Whether the right sidebar was closed, as the tests share one Obsidian. */
let sidebarWasClosed: boolean;

test.beforeEach(async ({ obsidian }) => {
    sidebarWasClosed = await obsidian.page.evaluate(() => window.app.workspace.rightSplit.collapsed);
    uninstall = await installPinned(obsidian.page, CALENDAR);
    await obsidian.page.evaluate(() => window.app.commands.executeCommandById("calendar:show-calendar-view"));
});

test.afterEach(async ({ obsidian }) => {
    await uninstall();
    await obsidian.page.evaluate((closed) => {
        const { rightSplit } = window.app.workspace;
        if (closed) rightSplit.collapse();
        else rightSplit.expand();
    }, sidebarWasClosed);
});

/** Opens the stream and makes it the active tab, as a click into it would. */
async function openFocusedStream(page: Page): Promise<Locator> {
    const container = await openStream(page);
    await page.evaluate(() => {
        const stream = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!;
        window.app.workspace.setActiveLeaf(stream, { focus: true });
    });
    return container;
}

/** Closes the sidebar Calendar is in, the phone layout's drawer included. */
const hideCalendar = (page: Page) => page.evaluate(() => window.app.workspace.rightSplit.collapse());

/** Opens Calendar's sidebar and brings its tab to the front. */
const showCalendar = (page: Page) =>
    page.evaluate(() => window.app.workspace.revealLeaf(window.app.workspace.getLeavesOfType("calendar")[0]!));

/** The month Calendar shows, and the day it highlights. */
function calendarShows(page: Page) {
    return page.evaluate(() => {
        const calendar = document.querySelector('.workspace-leaf-content[data-type="calendar"]');
        return {
            month: calendar?.querySelector(".title")?.textContent?.replace(/\s+/g, " ").trim(),
            day: calendar?.querySelector(".day.active")?.textContent?.trim() ?? null,
        };
    });
}

/**
 * Scrolls until `path`'s top stays a fifth of the way down, below the note
 * above. Notes above change height as they render, so one scroll may not land.
 */
async function scrollToNote(container: Locator, path: string) {
    const block = container.locator(`.daily-note-block[data-source-path="${path}"]`);
    await expect
        .poll(() =>
            block.evaluate((el) => {
                const pane = el.closest(".view-content")!;
                const offset = el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
                const off = offset - pane.clientHeight * 0.2;
                pane.scrollTop += off;
                return Math.abs(off) < 2;
            })
        )
        .toBe(true);
}

test("highlights the day being read, below the end of the note above it", async ({ obsidian }) => {
    const { page } = obsidian;
    await hideCalendar(page);
    const container = await openFocusedStream(page);

    await scrollToNote(container, "Notes/2026-03-11.md");
    await expect(container.locator('.daily-note-block[data-source-path="Notes/2026-03-12.md"]')).toBeInViewport();
    await showCalendar(page);

    await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "11" });
});

// On desktop, opening the sidebar narrows the stream, and its notes grow
// taller, so what is on screen moves. Calendar is opened before the jump there,
// and after it in the phone layout, whose drawer covers the stream without
// resizing it.
test("moves to another month when a jump reaches it", async ({ obsidian }, testInfo) => {
    const { page } = obsidian;
    const besideStream = testInfo.project.name === "desktop";
    const path = "Notes/2026-02-27.md";
    const before = await writeNote(page, path, "## Morning\n\nThe last week of February.\n");
    try {
        await hideCalendar(page);
        await openFocusedStream(page);
        if (besideStream) await showCalendar(page);

        await page.locator('.view-action[aria-label="Jump to date"]').click();
        await page.locator(".prompt input.prompt-input").fill("2026-02-27");
        await page.locator(".prompt .suggestion-item").first().click();
        if (!besideStream) await showCalendar(page);

        await expect.poll(() => calendarShows(page)).toEqual({ month: "Feb 2026", day: "27" });
    } finally {
        await restoreNote(page, path, before);
    }
});

test("leaves Obsidian with no open file, so file commands and the status bar stay off", async ({ obsidian }) => {
    const { page } = obsidian;
    await hideCalendar(page);
    const container = await openFocusedStream(page);
    await scrollToNote(container, "Notes/2026-03-11.md");
    await showCalendar(page);
    await expect.poll(async () => (await calendarShows(page)).day).toBe("11");

    expect(await page.evaluate(() => window.app.workspace.getActiveFile())).toBeNull();
    expect(
        await page.evaluate(() => window.app.commands.commands["app:delete-file"]!.checkCallback!(true))
    ).toBeFalsy();
    await expect(page.locator(".status-bar-item.plugin-word-count")).toBeHidden();
});

test("catches up once a hidden Calendar is shown", async ({ obsidian }) => {
    const { page } = obsidian;
    await hideCalendar(page);
    const container = await openFocusedStream(page);
    await scrollToNote(container, "Notes/2026-03-11.md");
    await showCalendar(page);
    await expect.poll(async () => (await calendarShows(page)).day).toBe("11");

    await hideCalendar(page);
    await scrollToNote(container, "Notes/2026-03-09.md");
    await showCalendar(page);

    await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "9" });
});

test("scrolls the stream to a day clicked in Calendar, in the stream's own tab, and highlights it", async ({
    obsidian,
}) => {
    const { page } = obsidian;
    await hideCalendar(page);
    const container = await openFocusedStream(page);
    await scrollToNote(container, "Notes/2026-03-11.md");
    await showCalendar(page);
    await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "11" });

    await page
        .locator('.workspace-leaf-content[data-type="calendar"] .day:not(.adjacent-month)')
        .getByText("9", { exact: true })
        .click();

    const block = container.locator('.daily-note-block[data-source-path="Notes/2026-03-09.md"]');
    await expect
        .poll(() =>
            block.evaluate(
                (el) => el.getBoundingClientRect().top - el.closest(".view-content")!.getBoundingClientRect().top
            )
        )
        .toBeLessThan(2);
    await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "9" });
    expect(await page.evaluate(() => window.app.workspace.getMostRecentLeaf()?.view.getViewType())).toBe(
        "daily-notes-stream-view"
    );
});

// As Show in stream does (D-218): opening the note would replace the stream.
test("says why, and keeps the stream, for a day whose note it hides", async ({ obsidian }) => {
    const { page } = obsidian;
    const path = "Notes/2026-03-10.md";
    await setHideEmptyNotes(page, true);
    const before = await writeNote(page, path, "");
    try {
        await hideCalendar(page);
        const container = await openFocusedStream(page);
        await scrollToNote(container, "Notes/2026-03-11.md");
        await showCalendar(page);
        await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "11" });

        await page
            .locator('.workspace-leaf-content[data-type="calendar"] .day:not(.adjacent-month)')
            .getByText("10", { exact: true })
            .click();

        await expect(
            page.locator(".notice").getByText("This note is hidden from the stream because it's empty.")
        ).toBeVisible();
        expect(await page.evaluate(() => window.app.workspace.getMostRecentLeaf()?.view.getViewType())).toBe(
            "daily-notes-stream-view"
        );
    } finally {
        await page.evaluate(() => document.querySelectorAll(".notice").forEach((notice) => notice.remove()));
        await restoreNote(page, path, before);
        await setHideEmptyNotes(page, false);
    }
});

/**
 * Turns Calendar one month back with its arrow, keeping the stream the active
 * tab. A real click would make Calendar's tab the active one, and the stream
 * tells Calendar nothing then.
 */
const turnCalendarBack = (page: Page) =>
    page
        .locator('.workspace-leaf-content[data-type="calendar"] [aria-label="Previous Month"]')
        .evaluate((arrow: HTMLElement) => arrow.click());

// Calendar turns its month only when asked, so the stream turns it only when
// the month being read changes.
test("leaves a month turned by hand while the stream stops in the same month", async ({ obsidian }) => {
    const { page } = obsidian;
    await hideCalendar(page);
    const container = await openFocusedStream(page);
    await scrollToNote(container, "Notes/2026-03-11.md");
    await showCalendar(page);
    await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "11" });

    await turnCalendarBack(page);
    await scrollToNote(container, "Notes/2026-03-09.md");
    // Past the wait for the scroll to stop, when the stream reports again.
    await page.waitForTimeout(1000);

    expect((await calendarShows(page)).month).toBe("Feb 2026");
});

test("turns Calendar to the note being read with Calendar's Reveal active note", async ({ obsidian }) => {
    const { page } = obsidian;
    await hideCalendar(page);
    const container = await openFocusedStream(page);
    await scrollToNote(container, "Notes/2026-03-11.md");
    await showCalendar(page);
    await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "11" });
    await turnCalendarBack(page);

    expect((await calendarShows(page)).month).toBe("Feb 2026");

    await page.evaluate(() => window.app.commands.executeCommandById("calendar:reveal-active-note"));

    await expect.poll(() => calendarShows(page)).toEqual({ month: "Mar 2026", day: "11" });
});
