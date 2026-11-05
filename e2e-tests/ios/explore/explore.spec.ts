import { writeFile } from "node:fs/promises";
import { test, expect, type Phone } from "../phone";
import { explorePlan, seedFrom, type Gesture } from "../explore-plan";

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

test("random swipes move the text only with the finger and its glide", async ({ phone }, testInfo) => {
    const plan = explorePlan(seedFrom(process.env), GESTURES);
    const replay = `EXPLORE_SEED=${plan.seed} pnpm run test:ios:explore`;
    testInfo.annotations.push({ type: "replay", description: replay });
    console.log(replay);
    let current: Gesture | null = null;
    let done = 0;
    try {
        if (plan.forgetHeights) await phone.forgetHeights();
        await phone.openStream();
        await phone.jumpTo(await dateAt(phone, plan.start));
        await startRecording(phone);
        await phone.consoleErrors();
        for (const gesture of plan.gestures) {
            current = gesture;
            const step = `gesture ${done + 1} of ${plan.gestures.length}, ${JSON.stringify(gesture)}`;
            await phone.run(() => (window as unknown as { exploreLog: string[] }).exploreLog.push("--- gesture"));
            await phone.followReader();
            await phone.flick(gesture.direction, gesture.strokes, { share: gesture.share, ms: gesture.ms });
            const { drifts } = await phone.stopFollowing();
            expect(Math.max(0, ...drifts.map(Math.abs)), `${step}: drifts ${drifts.join(", ")}`).toBeLessThan(
                MAX_DRIFT
            );
            expect(await owedNow(phone), `${step}: owed once still`).toBe(0);
            expect(await phone.consoleErrors(), `${step}: console errors`).toEqual([]);
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
