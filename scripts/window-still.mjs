/**
 * Shows a screenshot of the stream's pane as a window: rounded corners, a thin
 * edge and a soft shadow on a transparent page, as the directory images show it
 * (D-126). `e2e-tests/screenshots.spec.ts` runs it for the README's desktop
 * screenshots.
 */
import { webkit } from "@playwright/test";
import { readFileSync } from "fs";

/**
 * Space around the window, in CSS pixels. The shadow's drop and blur together
 * fill it below the window, so the shadow fades out before the image ends.
 */
const PAD = 24;
const DROP = 6;
const BLUR = PAD - DROP;

/**
 * Writes `raw`, a screenshot `width` by `height` CSS pixels taken at 2x, to
 * `out` as a window.
 * @param {string} raw
 * @param {string} out
 * @param {{ width: number, height: number }} size
 */
export async function windowStill(raw, out, { width, height }) {
    const browser = await webkit.launch();
    try {
        const page = await browser.newPage({
            viewport: { width: width + 2 * PAD, height: height + 2 * PAD },
            deviceScaleFactor: 2,
        });
        await page.setContent(`<!doctype html><style>
* { margin: 0; }
body { padding: ${PAD}px; background: transparent; }
div {
    width: ${width}px; height: ${height}px; border-radius: 12px; overflow: hidden;
    box-shadow: 0 ${DROP}px ${BLUR}px rgba(60, 40, 20, 0.18), 0 0 0 1px rgba(60, 40, 20, 0.14);
}
img { display: block; width: 100%; }
</style><div><img src="data:image/png;base64,${readFileSync(raw).toString("base64")}"></div>`);
        await page.evaluate(() => document.images[0].decode());
        await page.screenshot({ path: out, omitBackground: true });
    } finally {
        await browser.close();
    }
}
