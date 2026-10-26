/**
 * Lays out the raw screenshots for the plugin directory as images with a
 * headline: above the stream's pane or a pair of phones for the desktop images,
 * and above one phone for the mobile images. `pnpm run capture:listing` runs it
 * once `e2e-tests/listing.spec.ts` has taken the screenshots. Avenir Next comes
 * with macOS; on other systems the headline uses sans-serif.
 */
import { webkit } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { isMain } from "./reload-plugin.mjs";

/**
 * Each layout's size in CSS pixels. Drawn at twice this size, to give the
 * directory's 2400x1600 and 900x1600.
 */
const SIZES = {
    pane: { width: 1200, height: 800 },
    phones: { width: 1200, height: 800 },
    phone: { width: 450, height: 800 },
};

/**
 * @typedef {{ name: string, headline: string, subtitle: string, layout: keyof SIZES, shots: string[] }} Card
 * Words in a headline between asterisks are shown in the accent color.
 */

/** What each feature's images say, the same on desktop and phone. */
const COPY = {
    stream: {
        headline: "Your journal,\nas *one long page*.",
        subtitle: "Every daily note, newest first.",
    },
    search: {
        headline: "Search your *whole journal*.",
        subtitle: "Step through every note that mentions a word.",
    },
    jump: {
        headline: "*Jump* to any date.",
        subtitle: "Pick one of your newest notes, or type a date or a year.",
    },
    bases: {
        headline: "Every note, *shown in full*.",
        subtitle: "Properties, tables, embeds, and Bases,\nas reading view draws them.",
    },
};

const FEATURES = /** @type {(keyof COPY)[]} */ (Object.keys(COPY));

/** The directory's desktop images: the stream's pane, then a pair of phones. */
/** @type {Card[]} */
export const DESKTOP_CARDS = [
    ...FEATURES.map((feature, index) => ({
        name: `${index + 1}-${feature}`,
        ...COPY[feature],
        layout: /** @type {const} */ ("pane"),
        shots: [`${feature}-desktop.png`],
    })),
    {
        name: "5-phone",
        headline: "In your *pocket*, too.",
        subtitle: "The same stream on your phone, in light or dark.",
        layout: "phones",
        shots: ["stream-phone.png", "dark-phone.png"],
    },
];

/**
 * The directory's mobile images: one phone each, the last one in the dark
 * theme.
 */
/** @type {Card[]} */
export const PHONE_CARDS = [
    ...FEATURES.map((feature, index) => ({
        name: `${index + 1}-${feature}`,
        ...COPY[feature],
        layout: /** @type {const} */ ("phone"),
        shots: [`${feature}-phone.png`],
    })),
    {
        name: "5-dark",
        headline: "Easy on the eyes *at night*.",
        subtitle: "The stream follows Obsidian's dark theme.",
        layout: "phone",
        shots: ["dark-phone.png"],
    },
];

/** @param {string} text */
function escape(text) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A headline or subtitle as HTML, with words between asterisks in `<em>`, and a
 * newline as a line break that only the narrow phone images use.
 * @param {string} text
 */
export function cardTextHtml(text) {
    return escape(text)
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replaceAll("\n", '<br class="narrow"> ');
}

const STYLE = `
* { margin: 0; box-sizing: border-box; }
body {
    width: 100vw; height: 100vh; overflow: hidden; position: relative;
    background: radial-gradient(120% 90% at 50% 0%, #fbf8f3 0%, #efe9df 100%);
    font-family: -apple-system, sans-serif; color: #2b2622;
}
.copy { text-align: center; padding-top: 52px; text-wrap: balance; }
h1 { font-family: "Avenir Next", sans-serif; font-size: 50px; font-weight: 500; letter-spacing: -1.2px; line-height: 1.1; }
h1 em { color: #7c5ce0; font-style: normal; }
p { margin-top: 14px; font-size: 21px; color: #7a7067; }
.pane {
    position: absolute; left: 50%; transform: translateX(-50%); top: 212px; width: 860px;
    border-radius: 14px 14px 0 0; overflow: hidden;
    box-shadow: 0 30px 80px rgba(60, 40, 20, 0.18), 0 0 0 1px rgba(60, 40, 20, 0.12);
}
.pane img { width: 100%; display: block; }
.phones { position: absolute; top: 200px; left: 0; right: 0; display: flex; justify-content: center; gap: 56px; }
.phone {
    width: 244px; aspect-ratio: 402 / 874; border-radius: 44px; padding: 9px; background: #1d1b1a;
    box-shadow: 0 30px 70px rgba(60, 40, 20, 0.25);
}
.screen { width: 100%; height: 100%; border-radius: 36px; overflow: hidden; position: relative; }
.screen img { width: 100%; height: 100%; display: block; }
br.narrow { display: none; }
.portrait br.narrow { display: inline; }
.portrait .copy { padding: 44px 24px 0; }
.portrait h1 { font-size: 34px; letter-spacing: -0.8px; }
.portrait p { margin-top: 12px; font-size: 16px; }
.portrait .phones { top: 184px; }
.portrait .phone { width: 256px; }
.island { position: absolute; top: 9px; left: 50%; transform: translateX(-50%); width: 76px; height: 22px; border-radius: 11px; background: #000; }
`;

/**
 * The image as a page, with its screenshots' paths relative to it.
 * @param {Card} card
 */
export function cardHtml({ headline, subtitle, layout, shots }) {
    const shown =
        layout === "pane"
            ? `<div class="pane"><img src="${shots[0]}"></div>`
            : `<div class="phones">${shots
                  .map(
                      (shot) =>
                          `<div class="phone"><div class="screen"><img src="${shot}"><div class="island"></div></div></div>`
                  )
                  .join("")}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body class="${layout === "phone" ? "portrait" : ""}">
<div class="copy"><h1>${cardTextHtml(headline)}</h1><p>${cardTextHtml(subtitle)}</p></div>
${shown}
</body></html>`;
}

/**
 * Draws `cards` from the screenshots in `rawDir` into `outDir`, at twice their
 * size.
 * @param {Card[]} cards
 * @param {string} rawDir
 * @param {string} outDir
 */
export async function renderCards(cards, rawDir, outDir) {
    mkdirSync(outDir, { recursive: true });
    const browser = await webkit.launch();
    try {
        for (const card of cards) {
            const page = await browser.newPage({ viewport: SIZES[card.layout], deviceScaleFactor: 2 });
            const html = join(rawDir, `${card.layout}-${card.name}.html`);
            writeFileSync(html, cardHtml(card));
            await page.goto(`file://${html}`);
            // Loaded does not mean drawn: a screenshot can catch an image
            // before it is decoded.
            await page.evaluate(() =>
                Promise.all([document.fonts.ready, ...[...document.images].map((img) => img.decode())])
            );
            await page.screenshot({ path: join(outDir, `${card.name}.png`) });
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

if (isMain(import.meta.url)) {
    const listing = resolve(import.meta.dirname, "..", ".dev", "listing");
    const raw = join(listing, "raw");
    await renderCards(DESKTOP_CARDS, raw, join(listing, "cards", "desktop"));
    await renderCards(PHONE_CARDS, raw, join(listing, "cards", "phone"));
}
