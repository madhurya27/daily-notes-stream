import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveWebp } from "../demo";
import { screenshotsAsked } from "../recording-asked";
import { drivesIPad } from "./device";
import { test, expect, type Phone } from "./phone";

/**
 * Takes the README's phone screenshots on a real iPhone, so they show iOS's
 * own status bar and WebKit's rendering. Each scene is set up by script, as on
 * desktop in `screenshots.spec.ts`. Only runs when asked, through
 * `pnpm run capture:screenshots:ios`.
 */

const STREAM = ".daily-notes-stream-container";
const SEARCH = ".daily-notes-search";
const ACTION = (label: string) =>
    `.workspace-leaf-content[data-type="daily-notes-stream-view"] .view-action[aria-label="${label}"]`;
const note = (path: string) => `${STREAM} [data-source-path="${path}"]`;
/**
 * The width of the README's phone images: twice the 260 px the README shows
 * them at, for high-resolution screens.
 */
const WIDTH = 520;

/**
 * Saves the whole screen as `docs/images/<name>-phone.webp`, with no keyboard
 * and the stream still.
 */
async function capture(phone: Phone, name: string): Promise<void> {
    await phone.run(() => (document.activeElement as HTMLElement | null)?.blur());
    // A keyboard that closes while it is looked up fails the lookup: still
    // closing, so asked again.
    await expect.poll(() => phone.keyboardShown().catch(() => true)).toBe(false);
    await phone.rest();
    // iOS's scroll bar fades a second after scrolling stops.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const raw = join(tmpdir(), `${name}-phone.png`);
    writeFileSync(raw, Buffer.from(await phone.wholeScreen(), "base64"));
    execFileSync("sips", ["--resampleWidth", String(WIDTH), raw], { stdio: "ignore" });
    saveWebp(raw, `${name}-phone`);
}

/**
 * Scrolls `part` of the note `block` to the pane's middle, as on desktop. Only
 * notes near the screen are rendered, so the note is brought on screen first.
 */
async function centre(phone: Phone, block: string, part = ""): Promise<void> {
    const centred = (sel: string) => document.querySelector(sel)!.scrollIntoView({ block: "center" });
    await phone.run(centred, block);
    await expect.poll(() => phone.has(`${block} .daily-note-content`)).toBe(true);
    await phone.run(centred, `${block} ${part}`.trim());
    await phone.rest();
}

/**
 * Scrolls the pane so that `selector`'s top is `margin` px below the view's
 * header, or below the search bar while it is open. Each scene's margin hides
 * the line above it behind the header or the bar.
 */
async function toTop(phone: Phone, selector: string, margin: number): Promise<void> {
    for (let step = 0; step < 5; step++) {
        const off = await phone.run(
            (s: string, sel: string, bar: string, margin: number) => {
                const pane = document.querySelector(s)!.parentElement!;
                const leaf = pane.closest(".workspace-leaf-content")!;
                const search = leaf.querySelector(`${bar}:not(.is-closed)`);
                const above = (search ?? leaf.querySelector(".view-header")!).getBoundingClientRect().bottom;
                const off = document.querySelector(sel)!.getBoundingClientRect().top - (above + margin);
                pane.scrollTop += off;
                return off;
            },
            STREAM,
            selector,
            SEARCH,
            margin
        );
        await phone.rest();
        if (Math.abs(off) < 1) return;
    }
    throw new Error(`Could not scroll ${selector} to the top.`);
}

/** Sets `input`'s text as typing would, without the keyboard. */
async function fill(phone: Phone, input: string, text: string): Promise<void> {
    await phone.run(
        (sel: string, value: string) => {
            const el = document.querySelector<HTMLInputElement>(sel)!;
            el.value = value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        },
        input,
        text
    );
}

/**
 * Folds, or unfolds, every section of the two newest notes, linked mentions
 * included. A click on a fold arrow toggles it, so only those in the other
 * state are clicked.
 */
async function foldNewest(phone: Phone, folded: boolean): Promise<void> {
    const unlike = (s: string, fold: boolean) =>
        [...document.querySelectorAll(`${s} .daily-note-block`)]
            .slice(0, 2)
            .flatMap((block) => [...block.querySelectorAll(".daily-note-content h2, .daily-note-mentions")])
            .filter((section) => section.classList.contains("is-collapsed") !== fold).length;
    await phone.run(
        (s: string, fold: boolean) => {
            const sections = [...document.querySelectorAll(`${s} .daily-note-block`)]
                .slice(0, 2)
                .flatMap((block) => [...block.querySelectorAll(".daily-note-content h2, .daily-note-mentions")]);
            for (const section of sections)
                if (section.classList.contains("is-collapsed") !== fold)
                    section.querySelector<HTMLElement>(".collapse-indicator")!.click();
        },
        STREAM,
        folded
    );
    await expect.poll(() => phone.run(unlike, STREAM, folded)).toBe(0);
}

const click = (phone: Phone, selector: string) =>
    phone.run((sel: string) => document.querySelector<HTMLElement>(sel)!.click(), selector);

test.describe("README screenshots on the phone", () => {
    test.skip(!screenshotsAsked(), "set CAPTURE_SCREENSHOTS=1 to capture");
    test.skip(drivesIPad(process.env), "the README shows an iPhone, not an iPad");
    test.describe.configure({ mode: "serial" });

    // The phone's vault keeps folds between runs, and folded mentions show
    // nothing.
    test.beforeEach(async ({ phone }) => {
        await phone.openStream();
        await foldNewest(phone, false);
    });

    /**
     * The boundary between 2026-09-23 and 2026-09-22 in the middle of the
     * screen, as on desktop.
     */
    const showStream = (phone: Phone) => centre(phone, note("Journal/2026-09-22.md"), ".daily-note-header");

    test("the stream", async ({ phone }) => {
        await showStream(phone);
        await capture(phone, "stream");
    });

    test("the stream in dark mode", async ({ phone }) => {
        const theme = (name: string) => phone.run((t: string) => window.app.changeTheme(t), name);
        await theme("obsidian");
        try {
            await expect.poll(() => phone.has("body.theme-dark")).toBe(true);
            await showStream(phone);
            await capture(phone, "stream-dark");
        } finally {
            await theme("moonstone");
        }
    });

    test("search", async ({ phone }) => {
        await click(phone, ACTION("Search"));
        const input = `${SEARCH}:not(.is-closed) input`;
        await expect.poll(() => phone.has(input)).toBe(true);
        await fill(phone, input, "Mara");
        // The third match, in a note the other screenshots don't show.
        const count = () =>
            phone.run((sel: string) => document.querySelector(sel)!.textContent!, `${SEARCH} .document-search-count`);
        await expect.poll(count).toMatch(/^(\d+ \/ \d+|\d+ notes)$/);
        for (let text = await count(); !/^3 \//.test(text);) {
            await click(phone, `${SEARCH} .document-search-button[aria-label="Next"]`);
            await expect.poll(count).not.toBe(text);
            text = await count();
        }
        await phone.rest();
        // From the match's date, which a step leaves cut in half under the
        // search bar.
        await phone.run(() => {
            const [match] = CSS.highlights.get("daily-notes-search-current")!;
            const node = (match as Range).startContainer;
            const line = node instanceof Element ? node : node.parentElement!;
            line.closest(".daily-note-block")!.setAttribute("data-still-start", "");
        });
        await toTop(phone, "[data-still-start] .daily-note-header", 16);
        await capture(phone, "search");
    });

    test("jump to date", async ({ phone }) => {
        await click(phone, ACTION("Jump to date"));
        await expect.poll(() => phone.has(".prompt .suggestion-item")).toBe(true);
        await fill(phone, ".prompt input.prompt-input", "2026-09-1");
        await expect
            .poll(() => phone.run(() => document.querySelector(".prompt .suggestion-item")!.textContent))
            .toBe("2026-09-19");
        try {
            await capture(phone, "jump");
        } finally {
            await phone.run(() => document.querySelector<HTMLElement>(".modal-container .modal-bg")?.click());
        }
    });

    // Before the folding screenshot, which folds these footers and leaves them
    // folded.
    test("linked mentions", async ({ phone }) => {
        const newest = `${STREAM} .daily-note-block:first-child`;
        await expect.poll(() => phone.has(`${newest} .daily-note-mention`)).toBe(true);
        await centre(phone, newest, ".daily-note-mentions");
        await capture(phone, "mentions");
    });

    test("collapsed sections", async ({ phone }) => {
        // Every section of the first two notes is folded, including linked
        // mentions, so the arrows show and more dates fit.
        await foldNewest(phone, true);
        // Folding moves the page under the scroll anchor, so start from the
        // newest note again.
        await phone.run((s: string) => (document.querySelector(s)!.parentElement!.scrollTop = 0), STREAM);
        await capture(phone, "collapse");
    });

    test("a Base in a Sunday review", async ({ phone }) => {
        const sunday = note("Journal/2026-09-20.md");
        // Only notes near the screen are rendered, so bring the note on screen
        // first, then its Reading heading to the top.
        await centre(phone, sunday);
        await phone.run((sel: string) => {
            const headings = [...document.querySelectorAll(`${sel} h3`)];
            headings.find((h) => h.textContent === "Reading")!.setAttribute("data-still-start", "");
        }, sunday);
        await toTop(phone, `${sunday} [data-still-start]`, 8);
        await expect.poll(() => phone.has(`${sunday} :is(.bases-thead, .bases-cards-item)`)).toBe(true);
        await capture(phone, "bases");
    });
});
