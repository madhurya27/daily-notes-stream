import type { Page } from "@playwright/test";
import { test, expect, openStream, seededDate } from "./obsidian";

/**
 * How much of the screen is not yet painted when a reader scrolls with the
 * wheel on a slowed desktop. Uses real wheel input, sent from outside the page,
 * because a scroll set from inside the page waits whenever the page is busy,
 * and a wheel does not. Only runs when asked: SCROLL_COST=1 pnpm exec
 * playwright test scroll-cost --project=desktop. RATES, SPEEDS, SECONDS,
 * DOWN_UP=1 and SCREEN=4k175 change the test.
 */

// Tracing copies the page on every wheel event, which takes up the frames it
// measures.
test.use({ trace: "off" });

const RATES = (process.env.RATES ?? "6").split(",").map(Number);
const SPEEDS = (process.env.SPEEDS ?? "8000").split(",").map(Number);
const SECONDS = Number(process.env.SECONDS ?? 8);

/**
 * Notes as people write them: text, a callout, lists, an image, a table, and
 * tasks.
 */
const NOTES = 120;

function journalDay(day: number): string {
    const sentence = (i: number) =>
        `On day ${day} I spent part ${i} of the morning on [[Project ${i % 7}]], and wrote down how the plan for the week shifted so I would not lose the thread.`;
    const paragraph = (n: number) => Array.from({ length: 4 }, (_, i) => sentence(n * 4 + i)).join(" ");
    return [
        "---",
        `mood: ${["calm", "busy", "tired", "good"][day % 4]}`,
        "tags: [daily, journal]",
        "---",
        "",
        "## Morning",
        "",
        paragraph(0),
        "",
        "> [!note] Reminder",
        "> Call back about the **quarterly review**, and check the *budget* sheet.",
        "",
        "## Work",
        "",
        paragraph(1),
        "",
        "- Meetings",
        "    - Standup with the team",
        "    - Design review for [[Atlas]]",
        "- Reading: *The Pragmatic Programmer*, chapter 3",
        "",
        "![[photo.svg]]",
        "",
        "## Evening",
        "",
        paragraph(2),
        "",
        "| Habit | Done |",
        "| --- | --- |",
        "| Walk | yes |",
        "| Read | no |",
        "",
        "## Tasks",
        "",
        "- [x] Groceries",
        "- [ ] Email the landlord",
        "",
    ].join("\n");
}

const PHOTO =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#8ab"/><circle cx="600" cy="300" r="200" fill="#fc6"/></svg>';

interface Measured {
    /**
     * The part of the screen not drawn, weighted by how long each frame showed
     * it.
     */
    blankShare: number;
    worstBlank: number;
    /** How long each note that showed undrawn stayed undrawn. */
    noteBlankMs: number[];
    draws: number[];
    /**
     * Renders that finished after the note had already been scrolled past.
     */
    behind: number;
    longestFrame: number;
}

/**
 * Starts measuring every frame in the page. `window.stopMeasuring()` returns
 * what it saw.
 */
function startMeasuring(page: Page): Promise<void> {
    return page.evaluate(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        const renderer = (
            window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view as unknown as {
                renderer: { renderInto: (block: HTMLElement, ...rest: unknown[]) => Promise<unknown> };
            }
        ).renderer;
        const renderInto = renderer.renderInto;
        const draws: number[] = [];
        let behind = 0;
        renderer.renderInto = async function (block: HTMLElement, ...rest: unknown[]) {
            const start = performance.now();
            const drawn = await renderInto.call(this, block, ...rest);
            draws.push(performance.now() - start);
            if (drawn && block.getBoundingClientRect().bottom < pane.getBoundingClientRect().top) behind++;
            return drawn;
        };

        const blankSince = new Map<Element, number>();
        const noteBlankMs: number[] = [];
        let blankTime = 0;
        let worstBlank = 0;
        let longestFrame = 0;
        const t0 = performance.now();
        let last = t0;
        let stopped = false;
        const sample = () => {
            if (stopped) return;
            const now = performance.now();
            // A long frame showed what it found for its whole duration.
            const frame = now - last;
            last = now;
            longestFrame = Math.max(longestFrame, frame);
            const screen = pane.getBoundingClientRect();
            let blank = 0;
            for (const block of pane.querySelectorAll<HTMLElement>(".daily-note-block")) {
                const box = block.getBoundingClientRect();
                const shown = Math.min(box.bottom, screen.bottom) - Math.max(box.top, screen.top);
                const undrawn = block.classList.contains("is-unloaded") || block.classList.contains("is-far");
                if (shown > 0 && undrawn) {
                    blank += shown;
                    if (!blankSince.has(block)) blankSince.set(block, now);
                } else if (blankSince.has(block)) {
                    noteBlankMs.push(now - blankSince.get(block)!);
                    blankSince.delete(block);
                }
            }
            const share = blank / screen.height;
            blankTime += share * frame;
            worstBlank = Math.max(worstBlank, share);
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);

        (window as unknown as { stopMeasuring: () => Measured }).stopMeasuring = () => {
            stopped = true;
            const end = performance.now();
            for (const since of blankSince.values()) noteBlankMs.push(end - since);
            renderer.renderInto = renderInto;
            return { blankShare: blankTime / (end - t0), worstBlank, noteBlankMs, draws, behind, longestFrame };
        };
    });
}

/**
 * Turns the wheel over the stream at `speed` px/s for `seconds`. With
 * DOWN_UP=1, down for half the time, then back up.
 */
async function wheel(page: Page, speed: number, seconds: number): Promise<Measured> {
    const box = (await page.locator(".daily-notes-stream-container").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    await startMeasuring(page);
    const turnAt = process.env.DOWN_UP === "1" ? (seconds * 1000) / 2 : Infinity;
    const t0 = Date.now();
    let sent = 0;
    for (let elapsed = 0; elapsed < seconds * 1000; elapsed = Date.now() - t0) {
        const due = ((elapsed < turnAt ? elapsed : 2 * turnAt - elapsed) / 1000) * speed;
        const delta = Math.round(due - sent);
        // Not awaited, because a wheel keeps turning whether or not the page
        // has caught up.
        if (delta !== 0) void page.mouse.wheel(0, delta);
        sent += delta;
        await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await page.waitForTimeout(300);
    return page.evaluate(() => (window as unknown as { stopMeasuring: () => Measured }).stopMeasuring());
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const quantile = (list: number[], q: number) => [...list].sort((a, b) => a - b)[Math.floor(list.length * q)] ?? 0;

test.describe("scroll cost on a slowed desktop", () => {
    test.skip(!process.env.SCROLL_COST, "run with SCROLL_COST=1");
    test.beforeEach(({ mobileLayout }) => test.skip(mobileLayout, "a wheel is a desktop's"));
    test.setTimeout(180_000);

    test.beforeAll(async ({ obsidian }) => {
        await obsidian.page.evaluate(
            async ({ notes, photo }) => {
                const { vault } = window.app;
                if (!vault.getAbstractFileByPath("photo.svg")) await vault.create("photo.svg", photo);
                for (const [path, text] of notes) await vault.modify(vault.getFileByPath(path)!, text);
            },
            {
                notes: Array.from({ length: NOTES }, (_, i) => [`Notes/${seededDate(i)}.md`, journalDay(i)] as const),
                photo: PHOTO,
            }
        );
        await obsidian.page.waitForTimeout(3000);
    });

    for (const rate of RATES) {
        for (const speed of SPEEDS) {
            test(`a wheel at ${speed} px/s, the CPU slowed ${rate}x, finds the notes drawn`, async ({ obsidian }) => {
                const { page } = obsidian;
                const cdp = await page.context().newCDPSession(page);
                // SCREEN=4k175: a 3840x2160 laptop screen at 175%, with the
                // window filling it.
                if (process.env.SCREEN === "4k175")
                    await cdp.send("Emulation.setDeviceMetricsOverride", {
                        width: 2194,
                        height: 1180,
                        deviceScaleFactor: 1.75,
                        mobile: false,
                    });
                await openStream(page);
                await page.waitForTimeout(1500);
                await cdp.send("Emulation.setCPUThrottlingRate", { rate });
                try {
                    const r = await wheel(page, speed, SECONDS);
                    console.log(
                        `[scroll] ${rate}x ${speed} px/s: blank ${pct(r.blankShare)} of the screen, worst ${pct(r.worstBlank)}; ` +
                            `${r.noteBlankMs.length} notes blank, p90 ${quantile(r.noteBlankMs, 0.9).toFixed(0)} ms; ` +
                            `${r.draws.length} draws, median ${quantile(r.draws, 0.5).toFixed(0)} ms, ${r.behind} behind; ` +
                            `longest frame ${r.longestFrame.toFixed(0)} ms`
                    );
                    expect(r.blankShare).toBeLessThan(0.01);
                } finally {
                    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
                    await cdp.send("Emulation.clearDeviceMetricsOverride");
                    await cdp.detach();
                }
            });
        }
    }
});
