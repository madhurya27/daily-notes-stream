import type { Page } from "@playwright/test";
import { test, expect, openStream, restoreScrollAnchoring, seededDate, withoutScrollAnchoring } from "./obsidian";

/**
 * Defines `window.streamPlace` in the page: the first note that is at least
 * partly in the pane, and how far its top is from the pane's top, as the stream
 * keeps its place. Undefined while no stream is open. Also defines
 * `window.streamPlaces`: every different place from the next frame until 30
 * frames pass without a change.
 */
function measurePlaces(page: Page) {
    return page.evaluate(() => {
        window.streamPlace = () => {
            const pane = document.querySelector(".daily-notes-stream-container")?.parentElement;
            if (!pane) return undefined;
            const paneTop = pane.getBoundingClientRect().top;
            const first = [...pane.querySelectorAll<HTMLElement>(".daily-note-block")].find(
                (block) => block.getBoundingClientRect().bottom > paneTop
            );
            return JSON.stringify(
                first && {
                    path: first.dataset.sourcePath,
                    offset: Math.round(first.getBoundingClientRect().top - paneTop),
                }
            );
        };
        window.streamPlaces = async (deadline) => {
            const seen: string[] = [];
            for (let quiet = 0; quiet < 30 && performance.now() < deadline;) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const frame = window.streamPlace!();
                if (frame === undefined) continue;
                quiet = frame === seen.at(-1) ? quiet + 1 : 0;
                seen.push(frame);
            }
            return [...new Set(seen)];
        };
    });
}

const place = (page: Page) => page.evaluate(() => window.streamPlace!());

/**
 * Waits until the stream's place stops changing, because rendering moves it,
 * and a Base fills in even later.
 */
async function settledPlace(page: Page) {
    let before = await place(page);
    let stillSince = Date.now();
    await expect
        .poll(
            async () => {
                const now = await place(page);
                if (now !== before) stillSince = Date.now();
                before = now;
                return Date.now() - stillSince;
            },
            { intervals: [250], timeout: 20_000 }
        )
        .toBeGreaterThan(1500);
    return before;
}

/**
 * Scrolls the stream `past` the top of the note `daysBack` days back, and waits
 * for it to settle. Twice, because the first scroll is measured against empty
 * blocks, and the notes it renders move the target.
 */
async function scrollPast(page: Page, daysBack: number, past = 150) {
    const container = await openStream(page);
    const target = container.locator(`.daily-note-block[data-source-path="Notes/${seededDate(daysBack)}.md"]`);
    const scrollTo = () =>
        target.evaluate((el, past) => {
            const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
            pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top + past;
        }, past);
    await scrollTo();
    await settledPlace(page);
    await scrollTo();
    return { container, target, before: await settledPlace(page) };
}

/**
 * Leaves the stream for a note and comes back with Back. Returns every place
 * the stream showed on the way, and the place it left.
 */
async function goBack(page: Page) {
    const { target } = await scrollPast(page, 3);
    const title = await target.locator(".daily-note-title").elementHandle();

    // In one task, because on a phone the notes around it may still be
    // rendering, so the place is read the moment it is left.
    const { left, frames } = await page.evaluate(async (title) => {
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

        // Back does nothing until the stream is in the leaf's history.
        const history = () => window.app.workspace.getLeaf(false).history.backHistory.length;
        const behind = history();
        const deadline = performance.now() + 15_000;

        const left = window.streamPlace!();
        // Playwright's click() would scroll the title into view first, which
        // would move the place.
        title!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        while (history() === behind) {
            if (performance.now() > deadline) return { left: "the note never opened", frames: [] };
            await nextFrame();
        }

        // Every frame from Back onwards, as the stream shows it, until it stops
        // changing.
        window.app.commands.executeCommandById("app:go-back");
        return { left, frames: await window.streamPlaces!(deadline) };
    }, title);

    return { left, frames };
}

/**
 * Opens the stream again, and gives it the place it left once it has drawn a
 * frame, as iOS does. Returns every place it showed from then on, and the place
 * it left.
 */
async function returnAfterAFrame(
    page: Page,
    { daysBack = 3, past, unmeasured = false }: { daysBack?: number; past?: number; unmeasured?: boolean } = {}
) {
    const { before: left } = await scrollPast(page, daysBack, past);
    const eState = await page.evaluate((unmeasured) => {
        const eState = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.getEphemeralState();
        // As after a change of width: nothing was measured in the new layout.
        if (unmeasured) window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes.restore(null);
        return eState;
    }, unmeasured);
    await openStream(page);

    const frames = await page.evaluate(async (eState) => {
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        await nextFrame();
        await nextFrame();
        window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.setEphemeralState(eState);
        return window.streamPlaces!(performance.now() + 15_000);
    }, eState);
    return { left, frames };
}

test.describe("history", () => {
    test.beforeEach(({ obsidian }) => measurePlaces(obsidian.page));

    test.afterEach(async ({ obsidian }) => {
        await obsidian.page.evaluate(() => window.app.workspace.detachLeavesOfType("markdown"));
    });

    test("Back returns to the note the stream was scrolled to", async ({ obsidian }) => {
        const { page } = obsidian;
        const { container, before } = await scrollPast(page, 8);

        // The stream is the active tab that can navigate, so Obsidian opens the
        // note in it.
        await page.evaluate(async () => {
            await window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath("Reading list.md")!);
        });
        await expect(container).toHaveCount(0);
        await page.evaluate(() => window.app.commands.executeCommandById("app:go-back"));

        await expect.poll(() => place(page)).toEqual(before);
    });

    test("Back shows the stream only at the place it left", async ({ obsidian }) => {
        const { left, frames } = await goBack(obsidian.page);
        expect(frames).toEqual([left]);
    });

    test("returns to the place it left when handed it after drawing a frame", async ({ obsidian }) => {
        const { left, frames } = await returnAfterAFrame(obsidian.page);
        expect(frames).toEqual([left]);
    });

    test("returns to the place it left when none of its notes' heights are remembered", async ({ obsidian }) => {
        const { left, frames } = await returnAfterAFrame(obsidian.page, { unmeasured: true });
        expect(frames).toEqual([left]);
    });

    // The tenth note is the last of the first batch. Nothing is loaded below it
    // until the stream loads more, so there is too little to scroll to a place
    // near its bottom.
    test("returns to a place near the bottom of the last note loaded with it", async ({ obsidian }) => {
        const { left, frames } = await returnAfterAFrame(obsidian.page, { daysBack: 9, past: 700 });
        expect(frames).toEqual([left]);
    });

    // iOS's WebKit does not keep the scroll position, so the stream keeps the
    // reader's place itself.
    test.describe("where the platform has no scroll anchoring", () => {
        test.beforeEach(({ obsidian }) => withoutScrollAnchoring(obsidian.page));
        test.afterEach(({ obsidian }) => restoreScrollAnchoring(obsidian.page));

        test("Back shows the stream only at the place it left", async ({ obsidian }) => {
            const { left, frames } = await goBack(obsidian.page);
            expect(frames).toEqual([left]);
        });

        test("returns to the place it left when handed it after drawing a frame", async ({ obsidian }) => {
            const { left, frames } = await returnAfterAFrame(obsidian.page);
            expect(frames).toEqual([left]);
        });

        test("returns to the place it left when none of its notes' heights are remembered", async ({ obsidian }) => {
            const { left, frames } = await returnAfterAFrame(obsidian.page, { unmeasured: true });
            expect(frames).toEqual([left]);
        });

        test.describe("past a Base at the top of the note it left", () => {
            const NOTE = `Notes/${seededDate(3)}.md`;
            let original = "";

            test.beforeEach(async ({ obsidian }) => {
                original = await obsidian.page.evaluate(async (path) => {
                    const file = window.app.vault.getFileByPath(path)!;
                    const text = await window.app.vault.read(file);
                    const base = ["```base", "views:", "  - type: table", "    name: Files", "```", ""].join("\n");
                    await window.app.vault.modify(file, base + text);
                    return text;
                }, NOTE);
            });

            test.afterEach(async ({ obsidian }) => {
                await obsidian.page.evaluate(
                    ([path, text]) => window.app.vault.modify(window.app.vault.getFileByPath(path)!, text),
                    [NOTE, original] as const
                );
            });

            // Bases fills a view after it is drawn, so the note shrinks, then
            // grows back.
            test("returns to the place it left", async ({ obsidian }) => {
                const { left, frames } = await returnAfterAFrame(obsidian.page, { past: 900 });
                expect(frames).toEqual([left]);
            });
        });
    });
});
