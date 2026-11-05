import { writeFile } from "node:fs/promises";
import { test, expect, TO_TOP, type Phone } from "../phone";
import { explorePlan, seedFrom, type Gesture, type Swipe } from "../explore-plan";

// Random real swipes, to find what the regular tests miss (D-216). iOS's
// glides differ from run to run, so a seed repeats the gestures, not always the
// failure. The recording attached to a failure is what explains it; a regular
// test that sets up that screen by script then fails every time.

/** How many gestures one run makes. */
const GESTURES = Number(process.env.EXPLORE_GESTURES ?? 40);
/** How far the text may move apart from the scroll, as glide tests allow. */
const MAX_DRIFT = 5;
/** How many of the last frames and anchor calls a failure keeps. */
const KEPT = 4000;

test("random swipes move the text only with the finger, and Scroll to top reaches the newest note", async ({
    phone,
}, testInfo) => {
    const plan = explorePlan(seedFrom(process.env), GESTURES);
    const replay = `EXPLORE_SEED=${plan.seed} pnpm run test:ios:explore`;
    testInfo.annotations.push({ type: "replay", description: replay });
    console.log(replay);
    let current: Gesture | null = null;
    let done = 0;
    try {
        if (plan.forgetHeights) await phone.forgetHeights();
        await phone.openStream();
        const newest = await phone.newestOffset();
        await phone.jumpTo(await dateAt(phone, plan.start));
        await startRecording(phone);
        await phone.consoleErrors();
        for (const gesture of plan.gestures) {
            current = gesture;
            const step = `gesture ${done + 1} of ${plan.gestures.length}, ${JSON.stringify(gesture)}`;
            await phone.run(() => (window as unknown as { exploreLog: string[] }).exploreLog.push("--- gesture"));
            if (gesture.kind === "swipe") await swipe(phone, gesture, step);
            else await tapToTop(phone, newest, step);
            expect(await owedNow(phone), `${step}: owed once still`).toBe(0);
            expect(await phone.consoleErrors(), `${step}: console errors`).toEqual([]);
            const closed = await closeModals(phone);
            if (closed.length > 0) console.log(`${step}: closed ${closed.join(", ")}`);
            done++;
        }
    } catch (error) {
        const log = await phone
            .run(() => (window as unknown as { exploreLog?: string[] }).exploreLog ?? [])
            .catch(() => []);
        // A file, not text in the report, which cuts it short.
        const path = testInfo.outputPath("explore-recording.txt");
        const lines = [replay, `plan: ${JSON.stringify(plan)}`, `failed at: ${JSON.stringify(current)}`, ...log];
        await writeFile(path, lines.join("\n"));
        await testInfo.attach("explore-recording.txt", { path, contentType: "text/plain" });
        throw error;
    }
});

/** Makes `gesture`, and checks the text moved only with it. */
async function swipe(phone: Phone, gesture: Swipe, step: string): Promise<void> {
    await phone.followReader();
    await phone.flick(gesture.direction, gesture.strokes, { share: gesture.share, ms: gesture.ms });
    const { drifts } = await phone.stopFollowing();
    expect(Math.max(0, ...drifts.map(Math.abs)), `${step}: drifts ${drifts.join(", ")}`).toBeLessThan(MAX_DRIFT);
}

/**
 * Taps Scroll to top, and checks the stream lands on the newest note where it
 * opened, `newest` px down the pane. Not the drift: on the way to the top, the
 * notes above may move the text (`ScrollAnchor.headForTop`).
 */
async function tapToTop(phone: Phone, newest: number, step: string): Promise<void> {
    await phone.tap(TO_TOP.selector);
    await phone.rest();
    expect(await phone.scrollTop(), `${step}: the scroll reached the top`).toBe(0);
    expect(await phone.newestOffset(), `${step}: the newest note's place`).toBe(newest);
}

/**
 * Closes any modal, and returns what each one was. Pulling down past the top
 * opens Obsidian's command palette, which would take the next gesture's touch.
 */
async function closeModals(phone: Phone): Promise<string[]> {
    const closed = await phone.run(() =>
        [...document.querySelectorAll<HTMLElement>(".modal-container")].map((modal) => {
            const what = modal.querySelector(".prompt") ? "the command palette" : "a modal";
            modal.querySelector<HTMLElement>(".modal-bg")?.click();
            return what;
        })
    );
    if (closed.length > 0) await phone.rest();
    return closed;
}

/** The dated note `fraction` of the way down the stream, as `YYYY-MM-DD`. */
function dateAt(phone: Phone, fraction: number): Promise<string> {
    return phone.run((f: number) => {
        const dates = (window.app.vault.getMarkdownFiles() as { basename: string }[])
            .map(({ basename }) => basename)
            .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
            .sort()
            .reverse();
        return dates[Math.floor(f * dates.length)]!;
    }, fraction);
}

const owedNow = (phone: Phone) =>
    phone.run(
        () =>
            (
                window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.stream.window
                    .anchor as unknown as { owed: number }
            ).owed
    );

/**
 * Records each frame (the scroll, what the anchor owes, its shift, whether a
 * finger is down) and each anchor call that moves the scroll or what it owes,
 * with its callers. Only the last `KEPT` lines are kept.
 */
function startRecording(phone: Phone): Promise<void> {
    return phone.run((kept: number) => {
        const anchor = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.stream.window
            .anchor as unknown as Record<string, unknown> & { owed: number; scrollRoot: HTMLElement };
        const log: string[] = [];
        (window as unknown as { exploreLog: string[] }).exploreLog = log;
        const push = (line: string) => {
            log.push(line);
            if (log.length > kept) log.splice(0, log.length - kept);
        };
        const t0 = performance.now();
        const state = () =>
            `t${Math.round(performance.now() - t0)} scroll${Math.round(anchor.scrollRoot.scrollTop)} owed${Math.round(anchor.owed)} touching${String(anchor["touching"])}`;
        const proto = Object.getPrototypeOf(anchor) as Record<string, (...args: unknown[]) => unknown>;
        for (const name of [
            "settle",
            "stopGlide",
            "handOver",
            "placed",
            "unshift",
            "resized",
            "anticipate",
            "streamScrolled",
            "fingerDown",
            "fingerUp",
        ]) {
            const call = proto[name]!;
            anchor[name] = function (this: unknown, ...args: unknown[]) {
                const before = state();
                const result = call.apply(this, args);
                const callers = new Error().stack!.split("\n").slice(2, 6);
                push(
                    `${name}(${args.map(String).join(", ")}) ${before} -> owed${Math.round(anchor.owed)} from ${callers.map((c) => c.trim().split("@")[0]).join(" < ")}`
                );
                return result;
            };
        }
        const stream = anchor.scrollRoot.querySelector<HTMLElement>(".daily-notes-stream-container")!;
        const frame = () => {
            if (!anchor.scrollRoot.isConnected) return;
            push(`frame ${state()} shift${stream.style.getPropertyValue("--daily-notes-scroll-shift") || 0}`);
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }, KEPT);
}
