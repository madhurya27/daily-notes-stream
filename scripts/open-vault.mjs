/**
 * Opens the demo vault, or the test vault with --test, in Obsidian, with the
 * plugin turned on and mobile emulation on. Then it disconnects and leaves the
 * window running. This is the step of `pnpm run demo` that opens the window,
 * and these are its options.
 *
 * It runs its own copy of Obsidian with `.dev/obsidian-userdata`, so your real
 * settings and vaults are not touched, and both can run at once. That folder is
 * kept between runs, so settings and the answer to the trust prompt stay.
 * Delete it to start fresh.
 */
import { chromium } from "@playwright/test";
import { spawn } from "child_process";
import { createServer } from "net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { boundsFor, emulateDevice, layoutFrom } from "./window-layout.mjs";
import { PLUGIN_ID, USER_DATA_DIR, stopObsidian, vaultFrom } from "./vaults.mjs";

const OBSIDIAN = process.env.OBSIDIAN_PATH ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const VIEW_TYPE = "daily-notes-stream-view";
const VAULT_ID = "dev00000000000001";
const args = process.argv.slice(2);

const USAGE = `pnpm run demo [options] [vault]

Opens .dev/demo-vault/ in its own Obsidian with the plugin enabled, the stream
view showing and mobile emulation on, then reloads the plugin on every save
until Ctrl-C, which closes the window. Reseeds the vault first, and builds if there is no build.

Vault (default: the demo vault)
  --test          the test vault, .dev/vault/, that docs/TESTING.md uses
  [vault]         any other vault, by path

Size and layout (default: phone portrait)
  --ipad          tablet window, 820x1180 — is-mobile without is-phone
  --landscape     turn the phone or iPad size on its side
  --desktop       desktop window, 1280x860, no mobile emulation
  --keep-size     leave the window at the size it last had

Placement (default: 40,40 on the main display)
  --position x,y  place the window (phone mode has no drag region to move it by)

  --help, -h      this message

is-phone follows the window: either dimension under 600px turns it on, so a
phone keeps the phone layout in landscape and an iPad never takes it.
Everything runs against .dev/obsidian-userdata — your real Obsidian config and
vaults are untouched, and the two can run side by side.`;

if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
}

// A typo (--ipad2) that was quietly ignored would open the wrong layout and
// look like a bug.
const KNOWN_FLAGS = new Set(["--test", "--desktop", "--ipad", "--landscape", "--keep-size", "--position"]);
const unknown = args.filter((arg) => arg.startsWith("--") && !KNOWN_FLAGS.has(arg.split("=")[0]));
if (unknown.length) {
    console.error(`Unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}\nRun: pnpm run demo --help`);
    process.exit(1);
}

/** Reads `--flag value` and `--flag=value` the same way. */
const flagValue = (name) => {
    const inline = args.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
};

const parsePosition = (value) => {
    if (value === undefined) return null;
    const match = /^(-?\d+),(-?\d+)$/.exec(value.trim());
    if (!match) {
        console.error(`--position wants x,y in pixels (e.g. --position 900,60), got: ${value}`);
        process.exit(1);
    }
    return { x: Number(match[1]), y: Number(match[2]) };
};

const layout = layoutFrom(args);
const windowSize = layout.size;
const position = parsePosition(flagValue("--position"));
// A value that belongs to an option is not the vault path.
const consumed = new Set(["--position"]);
const positional = args.filter((arg, index) => !arg.startsWith("--") && !consumed.has(args[index - 1]));
const vault = vaultFrom(positional[0], args);
const userDataDir = USER_DATA_DIR;

const freePort = () =>
    new Promise((res, rej) => {
        const srv = createServer();
        srv.on("error", rej);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => res(port));
        });
    });

const connect = async (port) => {
    const deadline = Date.now() + 60_000;
    for (;;) {
        try {
            return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        } catch (error) {
            if (Date.now() > deadline) throw error;
            await new Promise((r) => setTimeout(r, 500));
        }
    }
};

mkdirSync(userDataDir, { recursive: true });
stopObsidian();
writeFileSync(
    join(userDataDir, "obsidian.json"),
    JSON.stringify({ vaults: { [VAULT_ID]: { path: vault, ts: Date.now(), open: true } }, updateDisabled: true })
);

// Window bounds are saved for each vault and read at startup. Writing them here
// opens the window in place, instead of moving it afterwards.
{
    const boundsPath = join(userDataDir, `${VAULT_ID}.json`);
    let saved = {};
    if (existsSync(boundsPath)) {
        try {
            saved = JSON.parse(readFileSync(boundsPath, "utf8"));
        } catch {
            // A broken bounds file is not a reason to fail the launch.
        }
    }
    // Placed on every run, not only when asked, because bounds are saved, so
    // without this the window opens wherever the last run left it.
    writeFileSync(boundsPath, JSON.stringify(boundsFor({ saved, size: windowSize, position })));
}

const port = await freePort();
spawn(OBSIDIAN, [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`], {
    stdio: "ignore",
    detached: true,
}).unref();

const browser = await connect(port);
const page = browser.contexts()[0].pages()[0];
// Attaching over CDP makes Playwright switch to a light color scheme, so the
// window opens light and only goes back to the system theme when this script
// disconnects. null gives the setting back at once.
await page.emulateMedia({ colorScheme: null });
await page.waitForFunction(() => window.app?.workspace?.layoutReady === true, null, { timeout: 60_000 });

// A vault that comes with plugins shows a one-time trust prompt, whose overlay
// catches every click until it is answered. A loaded plugin means it was
// already answered. Without this check, every later run would wait the full
// timeout for a modal that never comes.
const trust = page.locator(".modal-container button", { hasText: "Trust author and enable plugins" });
await Promise.race([
    trust.waitFor({ state: "visible", timeout: 10_000 }),
    page.waitForFunction((pluginId) => Boolean(window.app.plugins.plugins[pluginId]), PLUGIN_ID, { timeout: 10_000 }),
]).catch(() => {});
if (await trust.count()) await trust.click();

await page.evaluate(async (pluginId) => {
    const { plugins } = window.app;
    if (!plugins.enabled) await plugins.setEnable(true);
    if (!plugins.plugins[pluginId]) await plugins.enablePlugin(pluginId);
}, PLUGIN_ID);
await page.waitForFunction((pluginId) => Boolean(window.app.plugins.plugins[pluginId]), PLUGIN_ID, {
    timeout: 30_000,
});

// Turning on plugins leaves the settings pane open, and an open modal keeps the
// stream leaf deferred. A deferred view never draws.
await page.evaluate(() => window.app.setting?.close?.());

// The reload removes any open leaf, so this comes before opening the view.
await emulateDevice(page, layout.mobile);

// Obsidian restores the previous session's leaves, so reuse a stream view if
// one came back, instead of adding a new tab on every run.
await page.evaluate(async (viewType) => {
    const { workspace } = window.app;
    const [existing, ...duplicates] = workspace.getLeavesOfType(viewType);
    // A run that failed partway still left its tab behind, so keep one.
    for (const duplicate of duplicates) duplicate.detach();
    const leaf = existing ?? workspace.getLeaf(true);
    await leaf.setViewState({ type: viewType, active: true });
    workspace.revealLeaf(leaf);
}, VIEW_TYPE);
// A deferred or background leaf keeps its container in the DOM but does not
// draw it, so wait for one that is really on screen.
await page.waitForFunction(
    () => [...document.querySelectorAll(".daily-notes-stream-container")].some((el) => el.offsetParent !== null),
    null,
    { timeout: 30_000 }
);

const shown = await page.evaluate(() => ({
    mobile: document.body.classList.contains("is-mobile"),
    phone: document.body.classList.contains("is-phone"),
    theme: document.body.className.match(/theme-\w+/)?.[0] ?? "unknown",
}));

await browser.close();
const classes = [shown.mobile && "is-mobile", shown.phone && "is-phone"].filter(Boolean).join(" ");
console.log(
    `Obsidian is open on ${vault} with the stream view showing.\n` +
        `Layout: ${classes || "desktop"}${windowSize ? ` in a ${windowSize.width}x${windowSize.height} window` : ""}, ${shown.theme}.\n` +
        "Other sizes and placement: pnpm run demo --help"
);
