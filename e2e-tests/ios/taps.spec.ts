import { test, expect, type Phone } from "./phone";
import { NESTED_LIST_NOTE } from "./vault";

// While iOS handles a tap, something tappable appearing on the page, as a note
// drawing on screen draws it, makes iOS take the tap for a hover and send no
// click (D-209). Plain text does not.

const LINK = '<a class="internal-link" href="Elsewhere">a link</a>';
const CHECKBOX = '<input type="checkbox" class="task-list-item-checkbox">';

const TITLE = '.workspace-leaf-content[data-type="daily-notes-stream-view"] .view-header-title';
/** An old note. Every note between it and the top was never drawn. */
const OLD = "2026-09-10";

for (const [what, html] of [
    ["links", LINK],
    ["checkboxes", CHECKBOX],
] as const)
    test(`a tap on the title glides to the top while a note on screen draws ${what}`, async ({ phone }) => {
        await phone.openStream();
        await phone.jumpTo(OLD);

        await phone.tapWhileDrawing(await phone.pointOf(TITLE), html);
        await phone.rest();

        expect(await phone.scrollTop()).toBe(0);
    });

const NOTE = `.daily-note-block[data-source-path="${NESTED_LIST_NOTE}"]`;
const HEADING = `${NOTE} .daily-note-content > h2.is-collapsible`;
const CHEVRON = `${HEADING} > .collapse-indicator`;

const folded = (phone: Phone) =>
    phone.run((s: string) => document.querySelector(s)!.classList.contains("is-collapsed"), HEADING);

test("a tap on a heading's chevron folds it while a note on screen draws links", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(`${NOTE} .daily-note-title`, -20);
    try {
        await phone.tapWhileDrawing(await phone.pointOf(CHEVRON), LINK);

        await expect.poll(() => folded(phone)).toBe(true);
    } finally {
        // The stream remembers a fold.
        if (await folded(phone)) await phone.tap(CHEVRON);
        await expect.poll(() => folded(phone)).toBe(false);
    }
});

/** A link in a note's text to a note that exists, so a tap creates none. */
const NOTE_LINK = ".daily-note-content > p .internal-link:not(.is-unresolved)";

test("a tap on a link opens its note while a note on screen draws links", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(NOTE_LINK, -300);

    await phone.tapWhileDrawing(await phone.pointOf(NOTE_LINK), LINK);

    await expect.poll(() => phone.run(() => window.app.workspace.getActiveFile()?.path ?? null)).not.toBeNull();
});
