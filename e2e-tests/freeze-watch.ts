import type { CDPSession, Page } from "@playwright/test";

/**
 * Once on CI, a page stopped drawing and answering mid-test, and nothing said
 * where its JavaScript was (docs/TODO.md). This watches each test's page, and
 * when it stops answering, pauses it in the debugger to log where it is.
 */

/** A frame of a paused stack, as CDP's `Debugger.paused` reports it. */
export type CallFrame = {
    functionName: string;
    url: string;
    location: { scriptId: string; lineNumber: number; columnNumber?: number };
};

/** One line for each frame: its function, file, line and column. */
export function describeStack(frames: CallFrame[]): string {
    return frames
        .map(({ functionName, url, location }) => {
            const file = url.split("/").pop();
            return `    at ${functionName || "(anonymous)"} (${file}:${location.lineNumber + 1}:${(location.columnNumber ?? 0) + 1})`;
        })
        .join("\n");
}

/**
 * `width` characters on each side of a place in `source`, with `>>>` at it.
 * The e2e build is minified, so its code is one long line.
 */
export function codeAround(source: string, line: number, column: number, width: number): string {
    const text = source.split("\n")[line] ?? "";
    return `${text.slice(Math.max(0, column - width), column)}>>>${text.slice(column, column + width)}`;
}

/** How often the page is asked, and how long it may take to answer. */
export type FreezeTiming = { everyMs: number; withinMs: number };
const TIMING: FreezeTiming = { everyMs: 3_000, withinMs: 10_000 };

/**
 * Asks `page` every few seconds whether it answers. The first time it does
 * not, pauses its JavaScript, reports where it is, and lets it run on. Resolves
 * to a function that stops watching. The debugger is enabled first: enabling
 * it waits for a busy page, so a pause asked for then lands after the loop.
 */
export async function watchForFreeze(
    page: Page,
    report: (text: string) => void,
    timing: FreezeTiming = TIMING
): Promise<() => Promise<void>> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Debugger.enable");
    let watching = true;
    void (async () => {
        while (watching) {
            await new Promise((r) => setTimeout(r, timing.everyMs));
            if (!watching || (await answers(page, timing.withinMs))) continue;
            if (watching) report(await whereItIs(cdp, timing.withinMs));
            return;
        }
    })();
    return async () => {
        watching = false;
        await cdp.detach().catch(() => {});
    };
}

/** Whether `page` runs a script in time. A closed page counts as answering. */
function answers(page: Page, withinMs: number): Promise<boolean> {
    return Promise.race([
        page
            .evaluate(() => 1)
            .then(
                () => true,
                () => true
            ),
        new Promise<boolean>((r) => setTimeout(() => r(false), withinMs)),
    ]);
}

/** Pauses the page's JavaScript, describes where it is, and resumes it. */
async function whereItIs(cdp: CDPSession, withinMs: number): Promise<string> {
    try {
        const paused = new Promise<{ callFrames: CallFrame[] }>((r) => cdp.once("Debugger.paused", r));
        await cdp.send("Debugger.pause");
        const event = await Promise.race([paused, new Promise<null>((r) => setTimeout(() => r(null), withinMs))]);
        if (!event) return "The page stopped answering, and the debugger could not pause it.";
        const top = event.callFrames[0]!;
        const { scriptSource } = await cdp.send("Debugger.getScriptSource", { scriptId: top.location.scriptId });
        const code = codeAround(scriptSource, top.location.lineNumber, top.location.columnNumber ?? 0, 150);
        await cdp.send("Debugger.resume");
        return `The page stopped answering. Its JavaScript was at:\n${describeStack(event.callFrames)}\n${code}`;
    } catch (error) {
        return `The page stopped answering, and pausing it failed: ${String(error)}`;
    }
}
