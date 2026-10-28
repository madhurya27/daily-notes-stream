import {
    test as base,
    chromium,
    expect,
    type Browser,
    type CDPSession,
    type Locator,
    type Page,
} from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { TARGET_PHONE_WORKLOAD_MS, WORKLOAD_NOTE, cpuSlowdown, timeWorkload } from "./phone-speed";

const OBSIDIAN = process.env.OBSIDIAN_PATH ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const OBSIDIAN_BUNDLE = process.env.OBSIDIAN_BUNDLE ?? "/Applications/Obsidian.app";
/** Set this to watch the run. Otherwise none of the window is visible. */
const SHOW_WINDOW = process.env.E2E_SHOW_WINDOW === "1";
const VAULT_ID = "e2e0000000000001";

// A window that is out of sight counts as covered, and Chromium throttles
// covered windows: timers become very slow, and IntersectionObserver stops
// firing, which the scroll tests wait for.
const NO_THROTTLE = [
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
];
/**
 * Turns off macOS's window animations in this copy of Obsidian only, as a
 * setting passed at launch. While a window grows or shrinks, macOS reports its
 * size part way, so the harness tests read the wrong size (D-183).
 */
const NO_ANIMATION = ["-NSAutomaticWindowAnimationsEnabled", "NO"];
/**
 * Shrunk to Obsidian's minimum size and placed in a corner, so the flash before
 * the window is hidden is a small square. The page is laid out at VIEWPORT
 * anyway.
 */
const MIN_WINDOW = { width: 300, height: 200 };
const VIEWPORT = { width: 1024, height: 800 };
/**
 * An iPhone Pro's screen in points, so layouts that depend on width, such as
 * Bases' cards per row, match the phone.
 */
const PHONE_VIEWPORT = { width: 402, height: 874 };
const PLUGIN_ID = "daily-notes-stream";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * How many daily notes each test vault gets. Raise it for a run that needs a
 * vault the size of a real journal; see `pnpm run test:memory`.
 */
export const SEEDED_DAYS = Number(process.env.E2E_SEED_DAYS ?? 14);

/** The newest test note. The others go back from here, one per day. */
const NEWEST_DAY = Date.UTC(2026, 2, 14);

/** `daysBack` days before the newest note, as YYYY-MM-DD. */
export function seededDate(daysBack: number): string {
    return new Date(NEWEST_DAY - daysBack * 86_400_000).toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD, by the app's clock. */
export const today = (page: Page) => page.evaluate(() => new Date().toLocaleDateString("en-CA"));

/**
 * Today's daily note. The core plugin may have created it when the vault
 * opened.
 */
export const todayNote = async (page: Page) => `Notes/${await today(page)}.md`;

/**
 * Writes `text` to `path`, creating it if missing. Returns what it held before,
 * or null if nothing.
 */
export async function writeNote(page: Page, path: string, text: string): Promise<string | null> {
    return page.evaluate(
        async ({ path, text }) => {
            const { vault } = window.app;
            const file = vault.getFileByPath(path);
            if (!file) {
                await vault.create(path, text);
                return null;
            }
            const before = await vault.read(file);
            await vault.modify(file, text);
            return before;
        },
        { path, text }
    );
}

/**
 * Undoes `writeNote`: puts back what `path` held, or deletes it if it held
 * nothing.
 */
export async function restoreNote(page: Page, path: string, before: string | null): Promise<void> {
    await page.evaluate(
        async ({ path, before }) => {
            const { vault } = window.app;
            const file = vault.getFileByPath(path)!;
            if (before === null) await vault.delete(file);
            else await vault.modify(file, before);
        },
        { path, before }
    );
}

/** The core Daily notes settings every test vault starts with. */
export const DAILY_NOTES_CONFIG = { folder: "Notes", format: "YYYY-MM-DD" };

/** Sets Hide empty notes and saves it, as its switch does. */
export async function setHideEmptyNotes(page: Page, on: boolean) {
    await page.evaluate(async (on) => {
        const plugin = window.app.plugins.plugins["daily-notes-stream"];
        plugin.settings.hideEmptyNotes = on;
        await plugin.saveSettings();
    }, on);
}

/**
 * Writes the core Daily notes settings, which the plugin reads, as their
 * settings pane does.
 */
export function writeDailyNotesConfig(vaultPath: string, config: Record<string, string>) {
    writeFileSync(join(vaultPath, ".obsidian", "daily-notes.json"), JSON.stringify(config));
}

function freePort(): Promise<number> {
    return new Promise((res, rej) => {
        const srv = createServer();
        srv.on("error", rej);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address() as { port: number };
            srv.close(() => res(port));
        });
    });
}

function noteBody(day: number): string {
    return [
        "---",
        `mood: day-${day}`,
        "tags:",
        "  - daily",
        "---",
        "",
        "## Morning",
        "",
        `Ran ${day} km before work. #running`,
        "",
        "### Warm-up",
        "",
        "Stretching first.",
        "",
        "## Evening",
        "",
        "- Groceries",
        "    - Milk",
        "    - Bread",
        "- Read a chapter of [[Reading list]], then [[Someday]], then [[Reading list#Later|what's next]]",
        "",
        "## Wide content",
        "",
        "| Day | Distance | Pace | Heart rate | Weather | Route | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        `| ${day} | 8 km | 5:12 | 148 | Overcast | Riverside loop | Felt easy |`,
        "",
        "```ts",
        "const wide = { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5, zeta: 6, eta: 7, theta: 8 };",
        "```",
        "",
        "https://example.com/a/deliberately/long/path/that/has/no/spaces/to/break/at/so/it/must/wrap/mid-word?query=value",
        "",
        "## Tasks",
        "",
        "- [ ] Parent task",
        "    - [ ] Child task",
        "",
    ].join("\n");
}

/**
 * Creates a vault with `SEEDED_DAYS` daily notes and the built plugin
 * installed.
 */
function seedVault(): string {
    const vault = mkdtempSync(join(tmpdir(), "dns-vault-"));
    const config = join(vault, ".obsidian");
    mkdirSync(join(vault, "Notes"), { recursive: true });
    mkdirSync(join(config, "plugins", PLUGIN_ID), { recursive: true });

    for (let daysBack = 0; daysBack < SEEDED_DAYS; daysBack++) {
        const date = seededDate(daysBack);
        writeFileSync(join(vault, "Notes", `${date}.md`), noteBody(SEEDED_DAYS - daysBack));
    }

    // What the test notes link to. [[Someday]] is left without a note. It is
    // long, so a link to its last heading has somewhere to scroll to.
    const books = Array.from({ length: 80 }, (_, i) => `- Book ${i + 1}`);
    writeFileSync(
        join(vault, "Reading list.md"),
        ["# Reading list", "", ...books, "", "## Later", "", "- Middlemarch", ""].join("\n")
    );

    writeDailyNotesConfig(vault, DAILY_NOTES_CONFIG);
    // Follow the system's light or dark setting, not Obsidian's own default.
    writeFileSync(join(config, "appearance.json"), JSON.stringify({ theme: "system" }));
    writeFileSync(join(config, "community-plugins.json"), JSON.stringify([PLUGIN_ID]));
    writeFileSync(join(config, "core-plugins.json"), JSON.stringify({ "daily-notes": true }));

    for (const asset of ["main.js", "manifest.json", "styles.css"]) {
        copyFileSync(join(REPO, asset), join(config, "plugins", PLUGIN_ID, asset));
    }
    return vault;
}

export interface WindowOnScreen {
    x: number;
    y: number;
    width: number;
    height: number;
    alpha: number;
}

export interface ObsidianApp {
    page: Page;
    vaultPath: string;
    isFrontmost: () => boolean;
    windowsOnScreen: () => WindowOnScreen[];
}

async function launch(): Promise<{
    app: ObsidianApp;
    dispose: () => Promise<void>;
}> {
    const vaultPath = seedVault();
    const userDataDir = mkdtempSync(join(tmpdir(), "dns-userdata-"));
    writeFileSync(
        join(userDataDir, "obsidian.json"),
        JSON.stringify({
            vaults: { [VAULT_ID]: { path: vaultPath, ts: Date.now(), open: true } },
            updateDisabled: true,
        })
    );

    // Window bounds are saved for each vault. A window fully off screen is
    // refused (and centered at 1024x800 instead). A corner is moved to fit,
    // which is what we want.
    if (!SHOW_WINDOW) {
        // The corner must be on some display, or Obsidian centers a full-size
        // window over the user's work. With an extended desktop, a position
        // past the edge is no longer moved to fit.
        const screen = secondaryScreen() ?? mainScreen();
        writeFileSync(
            join(userDataDir, `${VAULT_ID}.json`),
            JSON.stringify({
                ...MIN_WINDOW,
                x: screen.x + screen.width - MIN_WINDOW.width,
                y: screen.y + screen.height - MIN_WINDOW.height,
                isMaximized: false,
                zoom: 0,
            })
        );
    } else {
        // Put a watched run on a second display, not over the user's work.
        const secondary = secondaryScreen();
        if (secondary) {
            writeFileSync(
                join(userDataDir, `${VAULT_ID}.json`),
                JSON.stringify({
                    width: Math.min(VIEWPORT.width, secondary.width - 80),
                    height: Math.min(VIEWPORT.height, secondary.height - 80),
                    x: secondary.x + 40,
                    y: secondary.y + 40,
                    isMaximized: false,
                    zoom: 0,
                })
            );
        }
    }

    const port = await freePort();
    const args = [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, ...NO_THROTTLE, ...NO_ANIMATION];
    // detached: Electron's helper processes survive if only the parent is
    // killed, so signal the whole group.
    const proc: ChildProcess | null = SHOW_WINDOW
        ? spawn(OBSIDIAN, args, { stdio: "ignore", detached: true })
        : launchHidden(args, userDataDir);

    let browser: Browser | null = null;
    // Defined before startup, so an error below still shuts the instance down.
    const dispose = async () => {
        await browser?.close().catch(() => {});
        if (proc) await killTree(proc);
        else killByUserDataDir(userDataDir);
        rmSync(vaultPath, { recursive: true, force: true });
        rmSync(userDataDir, { recursive: true, force: true });
    };

    try {
        // Set up as soon as Playwright can reach the page. The focus grab
        // before that is the only one left.
        const app = await startUp((browser = await connectWithRetry(port)), userDataDir, vaultPath);
        // Makes sure the window is hidden, instead of trusting the last event.
        if (!SHOW_WINDOW) await showCloaked(app.page);
        return { app, dispose };
    } catch (error) {
        await dispose();
        throw error;
    }
}

/**
 * Goes through Obsidian's first-run steps until the plugin is running and the
 * window is hidden.
 */
async function startUp(browser: Browser, userDataDir: string, vaultPath: string): Promise<ObsidianApp> {
    const context = browser.contexts()[0]!;
    const page = context.pages()[0]!;
    // The window is 300x200. Lay out the page at a normal size so scrolling
    // works.
    if (!SHOW_WINDOW) {
        await cloakWindow(page);
        await layOut(page, VIEWPORT);
    }
    // Playwright switches to light mode when it attaches. null restores the
    // system setting.
    await page.emulateMedia({ colorScheme: null });
    await page.waitForLoadState("domcontentloaded");
    // layoutReady fires once the workspace, and plugin loading, have finished.
    await page.waitForFunction(() => window.app?.workspace?.layoutReady === true, null, {
        timeout: 60_000,
    });

    // A vault that comes with plugins shows a trust prompt, whose overlay
    // catches clicks.
    const trustButton = page.locator(".modal-container button", {
        hasText: "Trust author and enable plugins",
    });
    await trustButton.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    if (await trustButton.count()) await trustButton.click();

    await page.evaluate(async (pluginId) => {
        const plugins = window.app.plugins;
        // Restricted mode blocks community plugins, so the test turns it off.
        if (!plugins.enabled) await plugins.setEnable(true);
        if (!plugins.plugins[pluginId]) await plugins.enablePlugin(pluginId);
    }, PLUGIN_ID);
    await page.waitForFunction((pluginId) => Boolean(window.app.plugins.plugins[pluginId]), PLUGIN_ID, {
        timeout: 30_000,
    });

    // An open settings pane keeps the leaf deferred, and a deferred view never
    // renders.
    await page.evaluate(() => window.app.setting?.close?.());
    await expect(page.locator(".modal-container")).toHaveCount(0);

    const isFrontmost = () => {
        const pid = mainProcessPid(userDataDir);
        return pid !== null && systemEvents(pid, "get frontmost") === "true";
    };

    const windowsOnScreen = () => {
        const pid = mainProcessPid(userDataDir);
        return pid === null ? [] : onScreen(pid);
    };

    return { page, vaultPath, isFrontmost, windowsOnScreen };
}

/**
 * LaunchServices with -g -j: starts hidden and never takes the focus. `open`
 * returns no process id, so cleanup matches the user-data-dir, which also finds
 * the helper processes.
 */
function launchHidden(args: string[], userDataDir: string): null {
    execFileSync("open", ["-n", "-g", "-j", "-a", OBSIDIAN_BUNDLE, "--args", ...args], { stdio: "ignore" });
    return null;
}

/** The main display's size, so the window can be put in its far corner. */
function screenSize(): { width: number; height: number } {
    try {
        const out = execFileSync("osascript", ["-e", 'tell application "Finder" to get bounds of window of desktop'], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        const [, , width, height] = out.split(",").map((n) => Number(n.trim()));
        if (width && height) return { width, height };
    } catch {
        // Use a size that no display is much bigger than. macOS moves the
        // window to fit anyway.
    }
    return { width: 5000, height: 3000 };
}

interface Screen {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The main display's size, or, if macOS won't say, a size that no display is
 * much bigger than.
 */
function mainScreen(): Screen {
    const { width, height } = screenSize();
    return { x: 0, y: 0, width, height };
}

/**
 * The display next to the main one, in the top-left coordinates Obsidian saves
 * window bounds in. NSScreen reports Cocoa frames, with the origin at the
 * bottom left and y going up.
 */
function secondaryScreen(): Screen | null {
    const script =
        "ObjC.import('AppKit'); $.NSScreen.screens.js.map(s => " +
        "[s.frame.origin.x, s.frame.origin.y, s.frame.size.width, s.frame.size.height].join(',')).join(';')";
    try {
        const out = execFileSync("osascript", ["-l", "JavaScript", "-e", script], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const frames = out.split(";").map((frame) => frame.split(",").map(Number));
        const mainHeight = frames[0]?.[3];
        const second = frames[1];
        if (!mainHeight || !second) return null;
        const [x, y, width, height] = second as [number, number, number, number];
        return { x, y: mainHeight - (y + height), width, height };
    } catch {
        return null;
    }
}

/**
 * Gets the window out of the user's way from inside the app, but keeps it on
 * screen. A hidden window can drop to one or two frames a second, for good
 * (D-124). Shown fully transparent, with clicks passing through, it renders
 * like any other window.
 *
 * `open -g -j` stops LaunchServices from bringing it to the front, but not
 * Obsidian from doing so itself: at first paint, when the vault opens, and on
 * the reload that `emulateMobile` causes. When it takes the focus, the app is
 * hidden, which gives the focus back, and the window is shown again without the
 * focus. An accessory process has no menu bar, and macOS will not bring it to
 * the front, so it stops taking the focus, instead of having it undone each
 * time. The listeners cover the window between launch and this call. A reload
 * removes them, and the policy with them, so callers set them up again.
 */
async function cloakWindow(page: Page): Promise<void> {
    // The preload script sets up the bridge. On a busy machine, Playwright can
    // attach before it runs.
    await page.waitForFunction(() => window.electron?.remote !== undefined, null, { polling: 10 });
    await page.evaluate(async () => {
        const { remote } = window.electron;
        /** The parts of Electron's BrowserWindow that the guard uses. */
        type Win = {
            isVisible(): boolean;
            showInactive(): void;
            setOpacity(opacity: number): void;
            setIgnoreMouseEvents(ignore: boolean): void;
            on(event: string, listener: () => void): void;
        };
        const windows = (): Win[] => remote.BrowserWindow.getAllWindows();
        const cloak = (win: Win) => {
            win.setOpacity(0);
            win.setIgnoreMouseEvents(true);
        };
        /**
         * Resolves once the windows are shown again. The hide happens later,
         * and would undo a show before it.
         */
        const handBackFocus = () =>
            new Promise<void>((resolve) => {
                const shown = windows().filter((win) => win.isVisible());
                remote.app.hide();
                const giveUp = Date.now() + 2000;
                const showOnceHidden = () => {
                    if (!remote.app.isHidden() && Date.now() < giveUp) return void setTimeout(showOnceHidden, 10);
                    for (const win of shown) win.showInactive();
                    resolve();
                };
                showOnceHidden();
            });
        // On desktop, settings open in a window of their own.
        const guard = (win: Win) => {
            cloak(win);
            win.on("show", () => cloak(win));
            win.on("focus", () => void handBackFocus());
        };
        windows().forEach(guard);
        remote.app.on("browser-window-created", (_event: unknown, win: Win) => guard(win));
        remote.app.setActivationPolicy("accessory");
        await handBackFocus();
    });
}

/** Shows the hidden main window, whatever state startup left it in. */
async function showCloaked(page: Page): Promise<void> {
    await page.evaluate(() => {
        const win = window.electron.remote.getCurrentWindow();
        win.setOpacity(0);
        win.setIgnoreMouseEvents(true);
        // Even when Electron says it is visible, because it says so while the
        // app is hidden.
        win.showInactive();
    });
}

/**
 * A process's windows on screen, as the window server sees them. System Events
 * lists none for a window shown again after its app was hidden.
 */
function onScreen(pid: number): WindowOnScreen[] {
    const script =
        "ObjC.import('CoreGraphics'); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject(" +
        "$.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))).filter(w => " +
        `w.kCGWindowOwnerPID === ${pid} && w.kCGWindowLayer === 0).map(w => ({ ` +
        "x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, width: w.kCGWindowBounds.Width, " +
        "height: w.kCGWindowBounds.Height, alpha: w.kCGWindowAlpha })))";
    const out = execFileSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" });
    return JSON.parse(out) as WindowOnScreen[];
}

/**
 * Runs one System Events statement for a process. Null when the process cannot
 * be reached yet.
 */
function systemEvents(pid: number, statement: string): string | null {
    try {
        const script = `tell application "System Events" to tell (first process whose unix id is ${pid}) to ${statement}`;
        return execFileSync("osascript", ["-e", script], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return null;
    }
}

/**
 * The Electron main process for this run: our user-data-dir, and no --type=
 * flag, which helpers have.
 */
function mainProcessPid(userDataDir: string): number | null {
    const ps = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    for (const line of ps.split("\n")) {
        if (!line.includes(userDataDir) || line.includes("--type=")) continue;
        const pid = Number(line.trim().split(/\s+/)[0]);
        if (Number.isFinite(pid)) return pid;
    }
    return null;
}

/** Kills every process whose command line includes this run's user-data-dir. */
function killByUserDataDir(userDataDir: string): void {
    for (const signal of ["-TERM", "-KILL"]) {
        try {
            execFileSync("pkill", [signal, "-f", userDataDir], { stdio: "ignore" });
        } catch {
            // pkill exits with 1 when nothing matched, which means the process
            // is already gone.
        }
    }
}

/**
 * Signals the whole Electron process group, and uses a stronger signal if it
 * does not stop.
 */
async function killTree(proc: ChildProcess): Promise<void> {
    if (proc.pid === undefined) return;
    const exited = new Promise<void>((res) => proc.once("exit", () => res()));
    try {
        process.kill(-proc.pid, "SIGTERM");
    } catch {
        proc.kill("SIGTERM");
    }
    const timer = new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 5_000));
    if ((await Promise.race([exited, timer])) === "timeout") {
        try {
            process.kill(-proc.pid, "SIGKILL");
        } catch {
            proc.kill("SIGKILL");
        }
    }
}

/** Obsidian needs a moment before the debugging port accepts connections. */
async function connectWithRetry(port: number): Promise<Browser> {
    const deadline = Date.now() + 60_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        } catch (error) {
            lastError = error;
            // Checked often, because the window is not protected until this
            // connects.
            await new Promise((r) => setTimeout(r, 50));
        }
    }
    throw new Error(`Could not attach to Obsidian on port ${port}: ${String(lastError)}`);
}

interface TestFixtures {
    freshPluginState: void;
    projectLayout: void;
}

interface WorkerFixtures {
    obsidian: ObsidianApp;
    /**
     * Set for each project. Every test runs once as desktop and once as a
     * phone.
     */
    mobileLayout: boolean;
}

/**
 * Undoes what an earlier test left in the shared instance, because the test
 * order is not fixed.
 */
async function resetPluginState(page: Page): Promise<void> {
    await page.evaluate(async (pluginId) => {
        const plugin = window.app.plugins.plugins[pluginId];
        await plugin.saveData({});
        await plugin.loadSettings();
        for (const file of window.app.vault.getMarkdownFiles()) plugin.collapseStore.clearForFile(file.path);
        plugin.layoutMemory.notes.restore(null);
        plugin.layoutMemory.bases.restore(null);
    }, PLUGIN_ID);
    await page.mouse.move(0, 0);
}

/**
 * One Obsidian instance for each worker. Tests share it, and each opens a new
 * view.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
    freshPluginState: [
        async ({ obsidian }, use) => {
            await resetPluginState(obsidian.page);
            await use();
        },
        { auto: true },
    ],
    // A test's own session may have set the viewport, and removed it when it
    // ended.
    projectLayout: [
        async ({ obsidian, mobileLayout }, use) => {
            if (mobileLayout) await layOut(obsidian.page, PHONE_VIEWPORT);
            else if (!SHOW_WINDOW) await layOut(obsidian.page, VIEWPORT);
            await use();
        },
        { auto: true },
    ],
    mobileLayout: [false, { scope: "worker", option: true }],
    obsidian: [
        async ({ mobileLayout }, use: (app: ObsidianApp) => Promise<void>) => {
            const { app, dispose } = await launch();
            if (mobileLayout) await applyMobileLayout(app.page);
            await use(app);
            await dispose();
        },
        { scope: "worker", timeout: 120_000 },
    ],
});

/**
 * Puts the instance in Obsidian's phone layout for the whole worker. is-mobile
 * comes from emulateMobile, and is-phone only from a narrow viewport. The bugs
 * this catches, such as a wide table pushing the page sideways, or a cursor
 * suggesting a tap that does nothing, need both.
 */
async function applyMobileLayout(page: Page): Promise<void> {
    await layOut(page, PHONE_VIEWPORT);
    await page.evaluate(() => window.app.emulateMobile(true));
    // emulateMobile removes the workspace and builds it again. Every leaf is
    // removed with it, so tests must open their own view afterwards (they all
    // do).
    await page.waitForFunction(() => window.app?.workspace?.layoutReady === true, null, { timeout: 60_000 });
    // The reload shows the window again, and removed the guard.
    if (!SHOW_WINDOW) await cloakWindow(page);
}

/**
 * Each page's layout session. When a session is detached, its viewport setting
 * goes with it.
 */
const layoutSessions = new WeakMap<Page, CDPSession>();

/** Lays out the page at a size its small window cannot give it. */
async function layOut(page: Page, viewport: { width: number; height: number }): Promise<void> {
    let cdp = layoutSessions.get(page);
    if (!cdp) {
        cdp = await page.context().newCDPSession(page);
        layoutSessions.set(page, cdp);
    }
    // Setting the same size again is ignored, even if another session's detach
    // cleared it.
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
}

/** The option playwright.config.ts sets for each project. */
export interface MobileLayoutOptions {
    mobileLayout: boolean;
}

/** The viewport each project lays out at. */
export const LAYOUT_VIEWPORT = { desktop: VIEWPORT, mobile: PHONE_VIEWPORT };

/**
 * The stream's column, not the copy of it that the template is measured in
 * while the stream opens.
 */
export const STREAM = ".daily-notes-stream-container";

/**
 * Opens a *new* stream view and returns its container locator. Tests share one
 * Obsidian instance, so an existing view would bring the previous test's loaded
 * notes and scroll position into this one.
 */
export async function openStream(page: Page) {
    await page.evaluate(async () => {
        const type = "daily-notes-stream-view";
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        window.app.workspace.detachLeavesOfType(type);

        // Removing the unloaded tab takes longer than the leaf count dropping
        // to 0, and a view opened during that time is removed with it. Try
        // again until one stays, instead of guessing a delay.
        for (let attempt = 0; attempt < 5; attempt++) {
            await wait(300);
            await window.app.commands.executeCommandById("daily-notes-stream:open-stream");
            await wait(300);
            if (window.app.workspace.getLeavesOfType(type).length > 0) return;
        }
        throw new Error("stream view never opened");
    });
    const container = page.locator(STREAM);
    await expect(container).toBeVisible();
    await expect(container.locator(".daily-note-block").first()).toBeVisible();
    return container;
}

/**
 * Keeps each note at the top in turn until its height is remembered, then waits
 * until scrolling counts as stopped. Moving a screen at a time skips notes,
 * because a note above the screen growing from its estimate moves the page
 * further.
 */
export async function scrollThroughStream(container: Locator) {
    const blocks = container.locator(".daily-note-block");
    const pane = container.locator("xpath=..");
    for (let i = 0; i < SEEDED_DAYS; i++) {
        // The next batch loads when the end comes into view.
        await expect
            .poll(async () => {
                const count = await blocks.count();
                if (count <= i) await pane.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));
                return count;
            })
            .toBeGreaterThan(i);
        const block = blocks.nth(i);
        const path = await block.getAttribute("data-source-path");
        // Brought back each time, because a batch arriving, or the place being
        // kept, can move the page.
        await expect
            .poll(
                () =>
                    block.evaluate((el) => {
                        el.scrollIntoView({ block: "start", behavior: "instant" });
                        const notes: [string, [string, number][]][] =
                            window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes.toJSON().heights;
                        return notes.some(([, heights]) => heights.some(([key]) => key === el.dataset.sourcePath));
                    }),
                { message: `${path} is remembered` }
            )
            .toBe(true);
    }
    await container.page().waitForTimeout(500);
}

/**
 * Unloads a note scrolled out of the layout, as going past the unloading
 * distance would once scrolling stops (ADR 0023). No test vault is twelve pane
 * heights tall around it.
 */
export async function unloadFar(note: Locator) {
    await expect(note).toHaveClass(/is-far/);
    // While still rendering, it only marks the note to be unloaded. Ask again
    // after the idle wait until it is unloaded.
    await expect
        .poll(
            () =>
                note.evaluate((el) => {
                    const block = el as HTMLElement;
                    const view = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!
                        .view as unknown as {
                        stream: { window: { unload(block: HTMLElement): void } };
                    };
                    if (!block.classList.contains("is-unloaded")) view.stream.window.unload(block);
                    return block.classList.contains("is-unloaded");
                }),
            { intervals: [1000] }
        )
        .toBe(true);
}

/**
 * Runs `body` with Obsidian's text size at `px`, then sets it back to the
 * default. Since 1.14, the size is saved for each device, in localStorage. The
 * vault's `baseFontSize` is only read while that is not set.
 */
export async function atTextSize(page: Page, px: number, body: () => Promise<void>) {
    const setTextSize = (size: number | null) =>
        page.evaluate((size) => {
            window.app.saveLocalStorage("base-font-size", size);
            window.app.updateFontSize();
        }, size);
    await setTextSize(px);
    try {
        await body();
    } finally {
        await setTextSize(null);
    }
}

/**
 * Runs `body` with iOS's text size setting at `scale`, as Obsidian on a phone
 * sets it, then sets it back. At any value other than 1, a size that ignores
 * the setting shows up.
 */
export async function atTextScale(page: Page, scale: number, body: () => Promise<void>) {
    await page.evaluate((s) => document.documentElement.style.setProperty("--preferred-text-scale", `${s}`), scale);
    try {
        await body();
    } finally {
        await page.evaluate(() => document.documentElement.style.removeProperty("--preferred-text-scale"));
    }
}

/**
 * Makes Chromium act as iOS's WebKit, which does not keep the scroll position.
 * From the next view opened, the stream keeps the reader's place itself.
 * `restoreScrollAnchoring` undoes it, because tests share the instance.
 */
export async function withoutScrollAnchoring(page: Page) {
    await page.evaluate(() => {
        const supports = CSS.supports.bind(CSS);
        (window as unknown as { realSupports: typeof supports }).realSupports = supports;
        CSS.supports = ((...args: [string, string]) =>
            args[0] === "overflow-anchor" ? false : supports(...args)) as typeof CSS.supports;
    });
}

export async function restoreScrollAnchoring(page: Page) {
    await page.evaluate(() => {
        CSS.supports = (window as unknown as { realSupports: typeof CSS.supports }).realSupports;
    });
}

/**
 * How long the workload takes in each instance unthrottled, timed once.
 */
const machineWorkloadMs = new WeakMap<Page, number>();

/**
 * Slows the CPU down to a slow phone's speed, for timings taken in the mobile
 * project, whose Chromium otherwise runs at laptop speed. It slows it by as
 * much as makes the workload take as long on this machine as on that phone
 * (`phone-speed.ts`). The stream must be open. Returns a function that undoes
 * it, because tests share the instance.
 */
export async function emulatePhoneCpu(page: Page): Promise<() => Promise<void>> {
    let machineMs = machineWorkloadMs.get(page);
    if (machineMs === undefined) {
        machineMs = await page.evaluate(timeWorkload, WORKLOAD_NOTE);
        machineWorkloadMs.set(page, machineMs);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown(machineMs, TARGET_PHONE_WORKLOAD_MS) });
    return async () => {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await cdp.detach();
    };
}

/**
 * Closes every search pane. Tests share one Obsidian instance, so a search
 * opened by an earlier test would still be on screen, and this test could match
 * it.
 */
export async function closeSearchPanes(page: Page) {
    await page.evaluate(() => window.app.workspace.detachLeavesOfType("search"));
}

export { expect };
