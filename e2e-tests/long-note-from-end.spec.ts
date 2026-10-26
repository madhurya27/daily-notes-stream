import type { Locator, Page } from "@playwright/test";
import {
    test,
    expect,
    emulatePhoneCpu,
    openStream,
    restoreNote,
    restoreScrollAnchoring,
    seededDate,
    withoutScrollAnchoring,
    writeNote,
    unloadFar,
} from "./obsidian";
import { longNote } from "./long-note";

/**
 * A long note that the reader scrolls up into from below is drawn from its end,
 * where the reader is, and the text they see stays still as the note finishes
 * drawing.
 */

const LONG = `Notes/${seededDate(5)}.md`;
const NOTE = `[data-source-path="${LONG}"]`;

/**
 * Each frame from when the reader reaches the note's last screen until it has
 * finished drawing and settled.
 */
interface Frame {
    /** It still has its empty height, because drawing has not finished. */
    drawing: boolean;
    /** The note's text is under the middle of the pane. */
    text: boolean;
    /** Its title shows in the pane. */
    title: boolean;
    /**
     * How far what was under the middle of the pane moved in the frame, after
     * the glide's step.
     */
    jump: number;
    /**
     * Its content's elements in the layout: shown, not hidden behind a spacer.
     */
    laidOut: number;
}

/**
 * Scrolls up into the note's last screen from below, frame by frame, and keeps
 * scrolling up `glide` px a frame while it draws.
 */
function comeUpInto(pane: Locator, glide = 0): Promise<{ frames: Frame[]; through: number; elements: number }> {
    return pane.evaluate(
        async (pane, [selector, glide]) => {
            const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
            const block = pane.querySelector<HTMLElement>(selector)!;
            pane.scrollTop += block.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom;
            const middle = () => {
                const { left, width, top, height } = pane.getBoundingClientRect();
                return document.elementFromPoint(left + width / 2, top + height / 2);
            };
            /**
             * What is under the middle to follow. In a gap in a note's content,
             * the text below the gap, because the content's own top rises while
             * a note drawn from its end grows above.
             */
            const followed = (el: Element | null) => {
                if (!el?.classList.contains("daily-note-content")) return el;
                const { top, height } = pane.getBoundingClientRect();
                return (
                    Array.from(el.children).find((child) => child.getBoundingClientRect().bottom > top + height / 2) ??
                    el
                );
            };
            const frames: Frame[] = [];
            let held: Element | null = null;
            for (let i = 0; i < 600 && (frames.length === 0 || frames.at(-1)!.drawing || frames.length < 30); i++) {
                // Down, because the glide goes up.
                const glided = glide && block.classList.contains("is-unloaded") ? glide : 0;
                pane.scrollTop -= glided;
                // Under the middle after the glide's step, where the stream
                // reads the reader's place. One step can move the middle off a
                // note as it finishes drawing.
                const under = followed(middle());
                const underTop = under?.getBoundingClientRect().top ?? 0;
                await frame();
                const box = under?.isConnected ? under.getBoundingClientRect() : null;
                // Gone, or hidden behind a spacer, so it shows nothing that
                // could move.
                const jump = box && box.height > 0 ? box.top - underTop : 0;
                const el = middle();
                const text = !!el && el !== block && block.contains(el) && !!el.closest(".daily-note-content");
                const header = block.querySelector(".daily-note-header");
                const titleBox = header?.getBoundingClientRect();
                const { top, bottom } = pane.getBoundingClientRect();
                const title =
                    !!header &&
                    !!titleBox &&
                    getComputedStyle(header).visibility === "visible" &&
                    titleBox.bottom > top &&
                    titleBox.top < bottom;
                if (text && !held) held = el;
                frames.push({
                    laidOut: block.querySelectorAll(".daily-note-content > :not(.is-far, .daily-note-far-run)").length,
                    drawing: block.classList.contains("is-unloaded"),
                    text,
                    title,
                    jump,
                });
            }
            // Where in the note the first text seen is, from 0 at its start to
            // 1 at its end.
            const content = block.querySelector(".daily-note-content");
            const children = content ? Array.from(content.children) : [];
            const part = held && children.find((child) => child.contains(held));
            const through = part ? children.indexOf(part) / children.length : -1;
            return {
                frames,
                through,
                elements: children.filter((child) => !child.matches(".daily-note-far-run")).length,
            };
        },
        [NOTE, glide] as const
    );
}

/**
 * Below the note, far enough that it is out of the layout and unloaded, and not
 * scrolling.
 */
async function goBelow(page: Page, pane: Locator, note: Locator) {
    await expect
        .poll(
            async () => {
                await pane.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));
                return /is-far|is-unloaded/.test((await note.getAttribute("class"))!);
            },
            { timeout: 30_000 }
        )
        .toBe(true);
    // A note never drawn is already empty.
    if ((await note.getAttribute("class"))!.includes("is-far")) await unloadFar(note);
    await page.waitForTimeout(500);
}

/**
 * Within a pixel, what is under the reader only moves as they scroll: while
 * drawing, when drawing finishes, and afterwards.
 */
function expectNoJump(frames: Frame[]) {
    expect(Math.max(...frames.map((f) => Math.abs(f.jump))), "how far what was under the reader jumped").toBeLessThan(
        1
    );
}

function expectDrawnFromItsEnd({ frames, through }: { frames: Frame[]; through: number }) {
    expect(through, "how far through the note the text first seen lies").toBeGreaterThan(0.9);
    const landed = frames.findIndex((f) => !f.drawing);
    const firstText = frames.findIndex((f) => f.text);
    expect(landed, "it lands").toBeGreaterThan(0);
    expect(firstText, "text under the reader before it lands").toBeGreaterThanOrEqual(0);
    expect(firstText, "text under the reader before it lands").toBeLessThan(landed);
    expect(frames.filter((f) => f.drawing && f.title).length, "frames with its title in view mid-draw").toBe(0);
    expectNoJump(frames);
}

test.describe("a long note met from below", () => {
    /**
     * What the note held before the test wrote it. Undefined if there was no
     * note.
     */
    let original: string | null | undefined;

    test.beforeEach(async ({ obsidian }) => {
        original = undefined;
        // As on iOS, which does not keep the scroll position, so the stream
        // keeps the place itself.
        await withoutScrollAnchoring(obsidian.page);
    });

    test.afterEach(async ({ obsidian }) => {
        if (original !== undefined) await restoreNote(obsidian.page, LONG, original);
        await restoreScrollAnchoring(obsidian.page);
    });

    /**
     * Opens a stream with `lines` in the long note, which was never drawn, and
     * with no note's height remembered.
     */
    async function openForgotten(page: Page, lines: number) {
        original = await writeNote(page, LONG, longNote(lines));
        await page.evaluate(() => window.app.plugins.plugins["daily-notes-stream"].layoutMemory.forgetAll());
        const container = await openStream(page);
        const pane = container.locator("xpath=..");
        const note = container.locator(NOTE);
        await goBelow(page, pane, note);
        await expect(note.locator(".daily-note-header"), "never drawn").toHaveCount(0);
        return pane;
    }

    test("draws its end first, reserved at the height it drew at before", async ({ obsidian }) => {
        original = await writeNote(obsidian.page, LONG, longNote(3000));
        const container = await openStream(obsidian.page);
        const pane = container.locator("xpath=..");
        const note = container.locator(NOTE);
        await note.scrollIntoViewIfNeeded();
        await expect(note).toHaveClass(/is-pinned/, { timeout: 30_000 });
        await goBelow(obsidian.page, pane, note);

        expectDrawnFromItsEnd(await comeUpInto(pane));
    });

    test("draws its end first, never drawn, heights forgotten", async ({ obsidian }) => {
        expectDrawnFromItsEnd(await comeUpInto(await openForgotten(obsidian.page, 3000)));
    });

    // On a phone, what is laid out costs time on every frame (ADR 0021). So at
    // a phone's speed, a slice is a small part of the note, and what it drew
    // far away leaves the layout.
    test("keeps only what is near the reader in the layout, and the reader in place, as it draws at a phone's speed", async ({
        obsidian,
        mobileLayout,
    }) => {
        test.skip(!mobileLayout, "a phone's speed");
        test.setTimeout(120_000);
        const pane = await openForgotten(obsidian.page, 10_000);
        const restoreCpu = await emulatePhoneCpu(obsidian.page);
        try {
            // Keeps scrolling up while it draws, as after a flick.
            const { frames, elements } = await comeUpInto(pane, 20);
            expectNoJump(frames);
            const laidOut = Math.max(...frames.filter((f) => f.drawing).map((f) => f.laidOut));
            expect(laidOut / elements, "share of the note in the layout mid-draw").toBeLessThan(0.1);
        } finally {
            await restoreCpu();
        }
    });
});
