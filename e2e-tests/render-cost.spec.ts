import { test, expect, openStream, emulatePhoneCpu, seededDate, SEEDED_DAYS } from "./obsidian";

/**
 * On mobile, rendering a note waits for each Base, then measures tables and
 * equations (D-068). Needs a vault of three years or more, so it runs with
 * `pnpm run test:memory`.
 */

/** Notes given a Base and equations. The scroll goes past all of them. */
const NOTES = 40;

const JOURNAL_BASE = [
    "filters:",
    "  and:",
    '    - file.inFolder("Notes")',
    "views:",
    "  - type: table",
    "    name: Recent",
    "    limit: 10",
    "    order:",
    "      - file.name",
    "      - mood",
    "      - file.mtime",
    "",
].join("\n");

const EXTRA = [
    "",
    "## Recent days",
    "",
    "![[Journal.base]]",
    "",
    "## Maths",
    "",
    "Euler: $e^{i\\pi} + 1 = 0$, and the Gaussian integral:",
    "",
    "$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi} \\quad\\text{and}\\quad \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} \\quad\\text{and}\\quad \\prod_{p} \\frac{1}{1 - p^{-s}} = \\zeta(s)$$",
    "",
].join("\n");

/** One trace event, as Chromium reports it. */
interface TraceEvent {
    name: string;
    ph: string;
    dur?: number;
    args?: {
        beginData?: { stackTrace?: { functionName: string; url: string; lineNumber: number; columnNumber: number }[] };
    };
}

test.describe("render cost on mobile, a Base and equations per note", () => {
    test.skip(SEEDED_DAYS < 3 * 365, "run via pnpm run test:memory");
    test.beforeEach(({ mobileLayout }) =>
        test.skip(!mobileLayout, "desktop draws Bases and equations as Obsidian does")
    );
    test.setTimeout(300_000);

    test("holds the queue briefly per Base, and forces little layout", async ({ obsidian }) => {
        const { page } = obsidian;
        await page.evaluate(
            async ({ base, extra, paths }) => {
                const { vault } = window.app;
                await vault.create("Journal.base", base);
                for (const path of paths) await vault.append(vault.getAbstractFileByPath(path), extra);
            },
            {
                base: JOURNAL_BASE,
                extra: EXTRA,
                paths: Array.from({ length: NOTES }, (_, i) => `Notes/${seededDate(i)}.md`),
            }
        );
        await page.waitForTimeout(2000);

        // Every time a Base draws, it holds up the render queue (ADR 0004).
        // Timed on the prototype, so the view opened again below has the timing
        // too.
        await openStream(page);
        await page.evaluate(() => {
            const view = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0].view;
            const proto = Object.getPrototypeOf(view.renderer.bases);
            const render = proto.render;
            (window as unknown as { baseMs: number[] }).baseMs = [];
            proto.render = async function (...args: unknown[]) {
                const start = performance.now();
                await render.apply(this, args);
                (window as unknown as { baseMs: number[] }).baseMs.push(performance.now() - start);
            };
        });

        const restoreCpu = await emulatePhoneCpu(page);
        const cdp = await page.context().newCDPSession(page);
        const events: TraceEvent[] = [];
        cdp.on("Tracing.dataCollected", ({ value }) => events.push(...(value as unknown as TraceEvent[])));
        await cdp.send("Tracing.start", {
            categories:
                "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack",
            transferMode: "ReportEvents",
        });

        const container = await openStream(page);
        const pane = container.locator("xpath=..");
        const last = container.locator(`.daily-note-block[data-source-path="Notes/${seededDate(NOTES - 1)}.md"]`);
        // One screen at a time, as a reader would, until the last of them is on
        // screen.
        const reached = () =>
            pane.evaluate(
                (el, path) => {
                    const block = el.querySelector(`.daily-note-block[data-source-path="${path}"]`);
                    return !!block && block.getBoundingClientRect().top < el.getBoundingClientRect().bottom;
                },
                `Notes/${seededDate(NOTES - 1)}.md`
            );
        for (let step = 0; step < 300 && !(await reached()); step++) {
            await pane.evaluate((el) => el.scrollBy({ top: el.clientHeight, behavior: "instant" }));
            await page.waitForTimeout(250);
        }
        await expect(last.locator(".daily-note-content")).toBeVisible();
        await page.waitForTimeout(2000);

        // Proof that the scroll rendered what it says it measures.
        await last.evaluate((el) =>
            el.querySelector(".bases-view")!.scrollIntoView({ block: "start", behavior: "instant" })
        );
        await page.waitForTimeout(1500);
        const drawn = await last.evaluate((el) => ({
            rows: el.querySelectorAll(".bases-tr, .bases-cards-item[draggable]").length,
            equations: el.querySelectorAll("mjx-container").length,
        }));

        const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
        await cdp.send("Tracing.end");
        await done;
        await restoreCpu();

        const baseMs = await page.evaluate(() => (window as unknown as { baseMs: number[] }).baseMs);
        const layouts = events.filter((e) => e.name === "Layout" && e.ph === "X");
        const ours = layouts.filter((e) =>
            e.args?.beginData?.stackTrace?.some((f) => f.url.includes("daily-notes-stream"))
        );
        const ms = (list: TraceEvent[]) => list.reduce((sum, e) => sum + (e.dur ?? 0), 0) / 1000;
        const sorted = [...baseMs].sort((a, b) => a - b);

        console.log(
            [
                `[render] last note: ${drawn.rows} Base rows, ${drawn.equations} equations`,
                `[render] Base draws: ${baseMs.length}, median ${sorted[sorted.length >> 1]?.toFixed(0)} ms, ` +
                    `max ${sorted.at(-1)?.toFixed(0)} ms, total ${baseMs.reduce((a, b) => a + b, 0).toFixed(0)} ms`,
                `[render] layouts: ${layouts.length}, ${ms(layouts).toFixed(0)} ms; forced by the plugin: ` +
                    `${ours.length}, ${ms(ours).toFixed(0)} ms`,
            ].join("\n")
        );

        expect(drawn.rows).toBeGreaterThan(0);
        expect(drawn.equations).toBe(2);
        expect(baseMs.length).toBeGreaterThanOrEqual(NOTES);
        // About twice the most measured (D-068). The CPU runs at the target
        // phone's speed (D-131), so the times hold on any machine at least that
        // fast.
        expect(ours.length).toBeLessThan(1700);
        expect(sorted.at(-1)).toBeLessThan(150);
        expect(ms(ours)).toBeLessThan(580);
    });
});
