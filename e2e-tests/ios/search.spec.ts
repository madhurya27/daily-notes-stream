import { test, expect, type Phone } from "./phone";

const MATCH = "daily-notes-search-match";
const CURRENT = "daily-notes-search-current";
const BAR = ".daily-notes-search:not(.is-closed) input";

/**
 * Types `query` into the open stream's search bar, then removes its cursor so
 * the screen stays still.
 */
async function search(phone: Phone, query: string): Promise<void> {
    await phone.tap('.view-action[aria-label="Search"]');
    await expect.poll(() => phone.has(BAR), "the search bar did not open").toBe(true);
    await phone.raiseKeyboard();
    await phone.type(query);
    expect(await phone.run((bar: string) => document.querySelector<HTMLInputElement>(bar)!.value, BAR)).toBe(query);
    await phone.run((bar: string) => document.querySelector<HTMLInputElement>(bar)!.blur(), BAR);
    // An iPad's pane shrinks above its keyboard, so typing marks no match below
    // it (D-022). The reader moves to one.
    const current = () => phone.run((name: string) => CSS.highlights.get(name)?.size ?? 0, CURRENT);
    if ((await current()) === 0) await phone.tap('.daily-notes-search [aria-label="Next"]');
    await expect.poll(current).toBe(1);
    await phone.rest();
}

/**
 * The ranges being tested, kept fixed, because a range added back goes to the
 * end of its highlight.
 */
type Held = { shown: Range[]; current: Range };

/**
 * Keeps the matches inside the pane, and the current one. Returns how many are
 * on screen.
 */
function holdMatches(phone: Phone): Promise<number> {
    return phone.run(
        (match: string, current: string) => {
            const pane = document
                .querySelector(".daily-notes-stream-container")!
                .parentElement!.getBoundingClientRect();
            const shown = ([...CSS.highlights.get(match)!] as Range[]).filter((range) => {
                const { top, bottom } = range.getBoundingClientRect();
                return top >= pane.top && bottom <= pane.bottom;
            });
            const held: Held = { shown, current: [...CSS.highlights.get(current)!][0] as Range };
            (window as unknown as { held: Held }).held = held;
            return shown.length;
        },
        MATCH,
        CURRENT
    );
}

/**
 * Whether taking a kept range out of the `from` highlights changes the screen.
 * It is put back afterwards.
 */
async function paints(phone: Phone, which: number | "current", from: string[]): Promise<boolean> {
    // A screenshot can show the frame before a change. A wait that is too short
    // makes the test fail, never pass.
    const lift = async (put: boolean) => {
        await phone.run(
            (which: number | "current", from: string[], put: boolean) => {
                const { held } = window as unknown as { held: Held };
                const range = which === "current" ? held.current : held.shown[which]!;
                for (const name of from) CSS.highlights.get(name)![put ? "add" : "delete"](range);
            },
            which,
            from,
            put
        );
        await new Promise((settle) => setTimeout(settle, 250));
    };
    const before = await phone.screenshot();
    await lift(false);
    const after = await phone.screenshot();
    await lift(true);
    return after !== before;
}

test.afterEach(async ({ phone }) => {
    if (await phone.has(BAR)) await phone.escape(BAR);
});

// WebKit paints no highlight on text the reader cannot select
// (e2e-tests/webkit.spec.ts). Only the phone shows what iOS's own WebKit
// paints.
test("a search paints every match on screen, the current one apart from the rest", async ({ phone }) => {
    await phone.openStream();
    // Twice in each of the newest notes' Stallers section, so more than one is
    // on screen.
    await search(phone, "Effort");
    expect(await phone.screenshot(), "the screen holds still between shots").toBe(await phone.screenshot());

    const shown = await holdMatches(phone);
    expect(shown, "matches on screen").toBeGreaterThan(1);
    for (let i = 0; i < shown; i++) expect(await paints(phone, i, [MATCH, CURRENT]), `match ${i}`).toBe(true);
    expect(await paints(phone, "current", [CURRENT]), "the current match, painted as any other").toBe(true);
});

test("a long-press selects a note's text", async ({ phone }) => {
    await phone.openStream();

    await phone.longPress(".daily-note-content > p");

    const selected = await phone.run(() => {
        const selection = window.getSelection()!;
        const inNote = !!selection.anchorNode?.parentElement?.closest(".daily-note-content");
        const text = selection.toString();
        selection.removeAllRanges();
        return { text, inNote };
    });
    expect(selected.text, "nothing selected").not.toBe("");
    expect(selected.inNote, "selected outside the note").toBe(true);
});
