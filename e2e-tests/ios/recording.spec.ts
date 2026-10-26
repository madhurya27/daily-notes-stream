import { writeFileSync } from "fs";
import { join } from "path";
import { OUT } from "../demo";
import { recordingAsked } from "../recording-asked";
import { drivesIPad } from "./device";
import { test, expect, type Phone, type Point } from "./phone";
import { FRAMES, type Scene } from "./screen-capture";

/**
 * Records the README's animated WebP of the stream on a real iPhone, its
 * screen captured over USB: flicks that glide, search, a jump to a date, and a
 * tap on the title back to the top. Opt-in, through
 * `pnpm run capture:recording:ios`.
 */

const HEADER = '.workspace-leaf-content[data-type="daily-notes-stream-view"] .view-header';
const SEARCH = ".daily-notes-search";
/** A reader's flick, not the harness's hard one: shorter and slower, so the glide fits the thumb. */
const FLICK = { share: 0.4, ms: 220 };
const DAY = ".prompt .suggestion-item:nth-child(2)";
/** Keys typed per gesture in the scene: pairs, a thumb's bursts at a reader's pace (`Phone.type`). */
const PAIRS = 2;

/**
 * Plays the search and the jump once, before the scene: iOS's keyboard is
 * read off the screen the first time each layout shows, some seconds a
 * layout, and each button looked up the first time it is tapped. Returns
 * where the scene taps.
 */
async function rehearse(
    phone: Phone
): Promise<Record<"search" | "next" | "close" | "jump" | "input" | "day" | "title", Point>> {
    const search = await phone.pointOf(`${HEADER} .view-action[aria-label="Search"]`);
    const jump = await phone.pointOf(`${HEADER} .view-action[aria-label="Jump to date"]`);
    const title = await phone.pointOf(`${HEADER} .view-header-title`);
    await phone.tapAt(search);
    await expect.poll(() => phone.keyboardShown()).toBe(true);
    await phone.type("Mara");
    const next = await phone.pointOf(`${SEARCH} .document-search-button[aria-label="Next"]`);
    const close = await phone.pointOf(`${SEARCH} .document-search-close-button`);
    // Emptied: the bar keeps its query, and would open on it selected.
    await phone.run((bar: string) => {
        const input = document.querySelector<HTMLInputElement>(bar)!;
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }, `${SEARCH} input`);
    await phone.tapAt(close);
    await phone.tapAt(jump);
    await expect.poll(() => phone.has(".prompt .suggestion-item")).toBe(true);
    const input = await phone.pointOf(".prompt input.prompt-input");
    await phone.tapAt(input);
    await expect.poll(() => phone.keyboardShown()).toBe(true);
    await phone.type("09-0");
    const day = await phone.pointOf(DAY);
    await phone.run(() => document.querySelector<HTMLElement>(".modal-container .modal-bg")?.click());
    await expect.poll(() => phone.has(".prompt")).toBe(false);
    return { search, next, close, jump, input, day, title };
}

test("README recording on the phone", async ({ phone }) => {
    test.skip(!recordingAsked(), "set CAPTURE_RECORDING=1 to record");
    test.skip(drivesIPad(process.env), "the README records a Mac and an iPhone, not an iPad");
    test.setTimeout(300_000);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    await phone.openStream();
    const at = await rehearse(phone);
    await phone.openStream();
    // The frames to keep: global-setup.ts captures the screen and encodes this scene.
    phone.logTouches();
    const start = Date.now() / 1000;
    await pause(1000);

    // Reading down through a few days: three flicks, each catching the last glide as a thumb does.
    await phone.flick("up", 3, FLICK);
    await pause(300);

    // Search: typed on the phone's own keyboard, then stepped note to note.
    await phone.tapAt(at.search);
    await expect.poll(() => phone.keyboardShown()).toBe(true);
    await pause(150);
    await phone.type("Mara", PAIRS);
    await pause(400);
    for (let step = 0; step < 2; step++) {
        await phone.tapAt(at.next);
        await phone.rest();
        await pause(500);
    }
    await phone.tapAt(at.close);
    await phone.rest();
    await pause(300);

    // Jump: the list first, the keyboard on a tap, a few keys to narrow it, a tap on the day.
    await phone.tapAt(at.jump);
    await expect.poll(() => phone.has(".prompt .suggestion-item")).toBe(true);
    await pause(400);
    await phone.tapAt(at.input);
    await expect.poll(() => phone.keyboardShown()).toBe(true);
    await phone.type("09-0", PAIRS);
    await pause(400);
    expect(await phone.run((s: string) => document.querySelector(s)?.textContent, DAY)).toBe("2026-09-08");
    await phone.tapAt(at.day);
    await phone.rest();
    expect((await phone.place()).path).toBe("Journal/2026-09-08.md");
    await pause(900);

    // Back to the newest, as on any iPhone screen: a tap on the title at the top.
    await phone.tapAt(at.title);
    await phone.rest();
    await pause(1200);

    const scene: Scene = {
        start,
        end: Date.now() / 1000,
        output: join(OUT, "demo-phone.webp"),
        touches: phone.sentTouches(),
        screenWidth: (await phone.screenSize()).width,
    };
    writeFileSync(join(FRAMES, "scene.json"), JSON.stringify(scene));
});
