import { drivesIPad } from "./device";
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
 * It is put back afterwards, only into the highlights that held it, so no later
 * test finds it where the search never put it.
 */
async function paints(phone: Phone, which: number | "current", from: string[]): Promise<boolean> {
    // A screenshot can show the frame before a change. A wait that is too short
    // makes the test fail, never pass.
    const lift = async (put: boolean) => {
        await phone.run(
            (which: number | "current", from: string[], put: boolean) => {
                const page = window as unknown as { held: Held; lifted: string[] };
                const range = which === "current" ? page.held.current : page.held.shown[which]!;
                if (put) for (const name of page.lifted) CSS.highlights.get(name)!.add(range);
                else page.lifted = from.filter((name) => CSS.highlights.get(name)!.delete(range));
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

// A note hidden far away (ADR 0023), but not unloaded, is shown again for a
// step. Its Base lays out its rows again a frame later, and grows above the
// match (D-181).
test.describe("a step back to a hidden note with a Base above its match", () => {
    const WORD = "Zanzibar";
    const notes: { path: string; original: string | null }[] = [];

    test.beforeEach(async ({ phone }) => {
        for (const [days, text] of [
            [0, `${WORD} at the top.\n`],
            // Puts the next note far enough below to be hidden, and not far
            // enough to be unloaded, on an iPhone and an iPad.
            [1, "Filler.\n\n".repeat(150)],
            [2, `![[Reading.base]]\n\n${WORD} below the Base.\n`],
        ] as const) {
            const path = await phone.journalPath(days);
            notes.push({ path, original: await phone.writeNote(path, text) });
        }
        await phone.openStream();
    });

    test.afterEach(async ({ phone }) => {
        for (const { path, original } of notes.splice(0)) await phone.restoreNote(path, original);
    });

    /**
     * Steps once, and returns where the match it lands on was on each frame
     * the screen showed, null while it had no box, and whether it ends on
     * screen.
     */
    const step = async (phone: Phone) => {
        await phone.run((match: string) => {
            const page = window as unknown as Watch;
            page.frames = [];
            page.watching = true;
            const read = () => {
                const tops = new Map<Range, number | null>();
                for (const range of (CSS.highlights.get(match) ?? []) as Iterable<Range>) {
                    const { top, height } = range.getBoundingClientRect();
                    tops.set(range, height > 0 ? Math.round(top) : null);
                }
                page.frames.push(tops);
            };
            // A task after the frame reads what it showed: a resize that is put
            // right before the frame is drawn is not seen.
            const each = () => {
                if (!page.watching) return;
                setTimeout(read);
                requestAnimationFrame(each);
            };
            requestAnimationFrame(each);
        }, MATCH);
        await phone.tap('.daily-notes-search [aria-label="Next"]');
        await phone.rest();
        return phone.run((current: string) => {
            const page = window as unknown as Watch;
            page.watching = false;
            const range = [...(CSS.highlights.get(current) ?? [])][0] as Range | undefined;
            const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
            const { top, bottom } = pane.getBoundingClientRect();
            const rect = range?.getBoundingClientRect();
            return {
                onScreen: !!rect && rect.height > 0 && rect.top >= top && rect.bottom <= bottom,
                tops: range ? page.frames.map((tops) => tops.get(range) ?? null) : [],
            };
        }, CURRENT);
    };

    /** The frames after the match first reached its place where it was not. */
    const away = (tops: (number | null)[]) => {
        const last = tops.at(-1)!;
        const there = (top: number | null) => top !== null && Math.abs(top - last) <= 2;
        return tops.slice(tops.findIndex(there)).filter((top) => !there(top));
    };

    test("lands on its match and holds it still", async ({ phone }) => {
        await phone.tap('.view-action[aria-label="Search"]');
        await expect.poll(() => phone.has(BAR), "the search bar did not open").toBe(true);
        await phone.run(
            (bar: string, word: string) => {
                const input = document.querySelector<HTMLInputElement>(bar)!;
                input.value = word;
                input.dispatchEvent(new Event("input"));
                input.blur();
            },
            BAR,
            WORD
        );
        await phone.rest();
        const panes = await phone.run(
            (top: string, below: string) => {
                const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
                const at = (path: string) =>
                    document.querySelector(`[data-source-path="${path}"]`)!.getBoundingClientRect().top;
                return (at(below) - at(top)) / pane.clientHeight;
            },
            notes[0]!.path,
            notes[2]!.path
        );
        expect(panes, "pane heights between the notes").toBeGreaterThan(5);
        expect(panes).toBeLessThan(11);

        // Down to the Base's note, up to the top, and down again: twice.
        const steps = [];
        for (let i = 0; i < 4; i++) steps.push(await step(phone));

        expect(steps.map((s) => s.onScreen)).toEqual([true, true, true, true]);
        expect(
            steps.map((s) => away(s.tops)),
            JSON.stringify(steps.map((s) => s.tops))
        ).toEqual([[], [], [], []]);
    });
});

/** What `step` keeps on the page while it watches: each frame's matches. */
type Watch = { frames: Map<Range, number | null>[]; watching: boolean };

// A match under the keyboard or the navbar is on the page but not seen. A
// search must not mark it, or Enter would move past it (D-179).
test.describe("a match the reader cannot see", () => {
    const WORD = "Zanzibar";
    let path: string;
    let original: string | null;

    test.beforeEach(async ({ phone }) => {
        path = await phone.journalPath(0);
        original = await phone.writeNote(
            path,
            `${"Filler.\n\n".repeat(30)}Hidden ${WORD} here.\n\n${"Filler.\n\n".repeat(40)}`
        );
        await phone.openStream();
    });

    test.afterEach(async ({ phone }) => {
        await phone.restoreNote(path, original);
    });

    /** Scrolls the word's line to `y`, and returns where its top is now. */
    const placeLine = (phone: Phone, y: number) =>
        phone.run(
            (path: string, word: string, y: number) => {
                const block = document.querySelector(`[data-source-path="${path}"]`)!;
                const text = [...block.querySelectorAll("p")].find((p) => p.textContent!.includes(word))!;
                const pane = block.closest(".daily-notes-stream-container")!.parentElement!;
                pane.scrollTop += text.getBoundingClientRect().top - y;
                return text.getBoundingClientRect().top;
            },
            path,
            WORD,
            y
        );

    /** Searches for the word by script: these tests are not about typing. */
    const searchWord = (phone: Phone) =>
        phone.run(
            (bar: string, word: string) => {
                const input = document.querySelector<HTMLInputElement>(bar)!;
                input.value = word;
                input.dispatchEvent(new Event("input"));
            },
            BAR,
            WORD
        );

    const count = (phone: Phone) =>
        phone.run(() => document.querySelector(".daily-notes-search .document-search-count")!.textContent);

    const openBar = async (phone: Phone) => {
        await phone.tap('.view-action[aria-label="Search"]');
        await expect.poll(() => phone.has(BAR), "the search bar did not open").toBe(true);
    };

    test("is not marked under the keyboard as you type", async ({ phone }) => {
        await openBar(phone);
        await phone.raiseKeyboard();
        const keyboard = await phone.keyboardTop();
        expect(await placeLine(phone, keyboard + 20), "the line is under the keyboard").toBeGreaterThan(keyboard);

        await searchWord(phone);

        await expect.poll(() => count(phone)).toBe("1 note");
        expect(await phone.run((name: string) => CSS.highlights.get(name)?.size ?? 0, CURRENT)).toBe(0);
    });

    // Opening the bar searches its kept query again at once, before Obsidian
    // removes the navbar for the keyboard.
    test("is not marked under the navbar as the bar opens again", async ({ phone }) => {
        test.skip(drivesIPad(process.env), "an iPad has no navbar");
        const paneTop = () =>
            phone.run(
                () =>
                    document.querySelector(".daily-notes-stream-container")!.parentElement!.getBoundingClientRect().top
            );
        const closedTop = await paneTop();
        await openBar(phone);
        // The bar pushes the pane down by its height.
        const barHeight = (await paneTop()) - closedTop;
        await searchWord(phone);
        await expect.poll(() => count(phone)).not.toBe("");
        await phone.escape(BAR);
        const navbar = await phone.run(() => document.querySelector(".mobile-navbar")!.getBoundingClientRect().top);
        expect(
            (await placeLine(phone, navbar + 8 - barHeight)) + barHeight,
            "the line is under the navbar"
        ).toBeGreaterThan(navbar);

        await openBar(phone);

        await expect.poll(() => count(phone)).toBe("1 note");
        expect(await phone.run((name: string) => CSS.highlights.get(name)?.size ?? 0, CURRENT)).toBe(0);
    });
});
