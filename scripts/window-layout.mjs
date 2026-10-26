/**
 * What `pnpm run demo`'s layout options mean: the window to open, where, and
 * the emulation to turn on once it is open.
 *
 * `is-mobile` comes from emulateMobile, and `is-phone` from either the width or
 * height being under 600px. So a phone is still a phone on its side, and an
 * iPad never gets `is-phone`.
 */
const WINDOW_SIZES = {
    desktop: { width: 1280, height: 860 },
    phone: { width: 420, height: 900 },
    ipad: { width: 820, height: 1180 },
};

/** The device, whether it emulates mobile, and the window it asks for. */
export function layoutFrom(args) {
    const device = args.includes("--desktop") ? "desktop" : args.includes("--ipad") ? "ipad" : "phone";
    const portrait = args.includes("--keep-size") ? null : WINDOW_SIZES[device];
    const landscape = portrait && args.includes("--landscape");
    return {
        device,
        mobile: device !== "desktop",
        size: landscape ? { width: portrait.height, height: portrait.width } : portrait,
    };
}

/** Marks the document that the reload is about to throw away. */
const OLD_DOCUMENT = "__layoutSwitchPending";

/**
 * Emulates the device, and waits for the page reload this causes. The old
 * document answers `layoutReady` until the reload happens, so the mark is what
 * shows that the new document is ready.
 */
export async function emulateDevice(page, mobile) {
    if (mobile === (await page.evaluate(() => window.app.isMobile))) return false;
    await page.evaluate((key) => (window[key] = true), OLD_DOCUMENT);
    // The reload removes this call's context, and that is the expected result.
    await page.evaluate((on) => window.app.emulateMobile(on), mobile).catch(() => {});
    await page.waitForFunction(
        (key) => window[key] === undefined && window.app?.workspace?.layoutReady === true,
        OLD_DOCUMENT,
        { timeout: 60_000 }
    );
    return true;
}

/** How far inside the main display a window opens. */
const MARGIN = 40;

/**
 * Where the window opens, and how big it is. The saved bounds keep the rest of
 * the file, because Obsidian also saves the zoom there, but never a maximized
 * state, which would ignore the size just asked for. A window too big for the
 * screen needs no limit, because macOS shrinks it to fit.
 *
 * @param {{
 *     saved?: object,
 *     size: { width: number, height: number } | null,
 *     position?: { x: number, y: number } | null,
 * }} options
 */
export function boundsFor({ saved = {}, size, position = null }) {
    const bounds = { zoom: 0, ...saved, x: MARGIN, y: MARGIN, isMaximized: false, ...size };
    // A position that is given wins over the corner.
    if (position) {
        bounds.x = position.x;
        bounds.y = position.y;
    }
    return bounds;
}
