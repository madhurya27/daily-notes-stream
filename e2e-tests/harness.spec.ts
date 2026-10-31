import { test, expect, LAYOUT_VIEWPORT, openWindow } from "./obsidian";

test("the test window follows the system color scheme", async ({ obsidian }) => {
    const { page } = obsidian;
    const prefersDark = await page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

    // Playwright switches to light mode when it attaches, unless the test setup
    // clears it. Checked repeatedly, because on a busy machine the mobile
    // layout's rebuild sets the class late.
    await expect
        .poll(() => page.evaluate(() => document.body.className.match(/theme-\w+/)?.[0] ?? "none"))
        .toBe(prefersDark ? "theme-dark" : "theme-light");
});

test("the test window draws on screen, but nothing of it shows", async ({ obsidian }) => {
    test.skip(process.env.E2E_SHOW_WINDOW === "1", "the window is deliberately visible");

    // Asked of macOS, because Electron says a window is visible while its app
    // is hidden.
    const windows = obsidian.windowsOnScreen();
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.map(({ alpha }) => alpha)).toEqual(windows.map(() => 0));
});

test("shows nothing of a window Obsidian opens beside it", async ({ obsidian, mobileLayout }) => {
    test.skip(process.env.E2E_SHOW_WINDOW === "1", "the window is deliberately visible");
    test.skip(mobileLayout, "a phone opens its settings in the same window");
    const { page } = obsidian;

    const settingsWindow = page.context().waitForEvent("page");
    await page.evaluate(() => window.app.setting.open());
    await settingsWindow;
    try {
        await expect.poll(() => obsidian.windowsOnScreen().length).toBe(2);
        expect(obsidian.windowsOnScreen().map(({ alpha }) => alpha)).toEqual([0, 0]);
    } finally {
        await page.evaluate(() => window.app.setting.close());
    }
});

test("the test run never leaves Obsidian in front of the user's work", async ({ obsidian }) => {
    test.skip(process.env.E2E_SHOW_WINDOW === "1", "the window is deliberately visible");

    // Obsidian takes the focus for its own window twice while starting, so the
    // test setup hides it and gives the focus back. By the time a test runs,
    // neither may still have the focus.
    expect(obsidian.isFrontmost()).toBe(false);
});

test("shrinks the window to Obsidian's minimum", async ({ obsidian }) => {
    test.skip(process.env.E2E_SHOW_WINDOW === "1", "the window is deliberately a normal one");

    // Window bounds that are on no display at all are refused, and Obsidian
    // uses a centered full-size window instead, which then flashes over the
    // user's screen before it is hidden. An extended desktop makes that easy to
    // happen, so the corner must be on a real display.
    const sizes = obsidian.windowsOnScreen().map(({ width, height }) => ({ width, height }));
    expect(sizes).toContainEqual({ width: 300, height: 200 });
});

test("lays the page out at a normal size despite the small window", async ({ obsidian }) => {
    test.skip(process.env.E2E_SHOW_WINDOW === "1", "the window is a normal one");

    // The window itself is shrunk to Obsidian's 300x200 minimum and put in a
    // corner, so the flash before it is hidden is small. The page is laid out
    // at a normal size, so the stream's loading works as it would for a reader.
    // Each project lays out at its own size: a desktop window, or a phone.
    const expected = LAYOUT_VIEWPORT[test.info().project.name === "mobile" ? "mobile" : "desktop"];
    const inner = await obsidian.page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(inner).toEqual({ w: expected.width, h: expected.height });
});

// When a session is detached, its viewport setting goes with it, and the page
// uses the 300x200 window the next time it lays out, for example when the
// settings open.
test.describe("after a test's own viewport session ends", () => {
    test.describe.configure({ mode: "serial" });

    test("a test sets the viewport from its own session", async ({ obsidian }) => {
        const { page } = obsidian;
        const viewport = LAYOUT_VIEWPORT[test.info().project.name === "mobile" ? "mobile" : "desktop"];
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
        await cdp.detach();
    });

    test("the next test still lays out at its project's size", async ({ obsidian, mobileLayout }) => {
        test.skip(process.env.E2E_SHOW_WINDOW === "1", "the window is a normal one");
        test.skip(mobileLayout, "a phone opens its settings in the same window");
        const { page } = obsidian;
        const settingsWindow = page.context().waitForEvent("page");
        await page.evaluate(() => window.app.setting.open());
        await settingsWindow;
        try {
            const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
            expect(inner).toEqual({ w: LAYOUT_VIEWPORT.desktop.width, h: LAYOUT_VIEWPORT.desktop.height });
        } finally {
            await page.evaluate(() => window.app.setting.close());
        }
    });
});

test("keeps drawing frames after a test changes the viewport", async ({ obsidian }) => {
    const { page } = obsidian;
    const viewport = LAYOUT_VIEWPORT[test.info().project.name === "mobile" ? "mobile" : "desktop"];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
    await cdp.detach();
    // A hidden window whose viewport was set again drew two frames a second,
    // from the next time a tab opened until the window closed.
    await page.evaluate(async () => {
        const note = window.app.vault.getMarkdownFiles()[0]!;
        await window.app.workspace.getLeaf("tab").openFile(note);
    });

    const framesInASecond = await page.evaluate(
        () =>
            new Promise<number>((resolve) => {
                let frames = 0;
                const start = performance.now();
                const count = () => {
                    frames++;
                    if (performance.now() - start < 1000) requestAnimationFrame(count);
                    else resolve(frames);
                };
                requestAnimationFrame(count);
            })
    );

    expect(framesInASecond).toBeGreaterThan(30);
    await page.evaluate(() => window.app.workspace.getLeaf(false).detach());
});

test("a new worker uses the window of the one before", async ({ obsidian }, testInfo) => {
    const { app, leave } = await openWindow(`${testInfo.parallelIndex}`);
    try {
        expect(app.vaultPath).toBe(obsidian.vaultPath);
        expect(await app.page.evaluate(() => window.app.workspace.layoutReady)).toBe(true);
    } finally {
        await leave();
    }
});
