import { test, expect, type Phone } from "./phone";
import { NESTED_LIST_NOTE } from "./vault";

const NOTE = `.daily-note-block[data-source-path="${NESTED_LIST_NOTE}"]`;
const HEADING = `${NOTE} .daily-note-content > h2.is-collapsible`;
const LIST_ITEM = `${NOTE} li.is-collapsible`;
const PROPERTIES = `${NOTE} .metadata-container`;

const collapsed = (phone: Phone, section: string) =>
    phone.run((s: string) => document.querySelector(s)!.classList.contains("is-collapsed"), section);

/**
 * The note's first heading a little below the pane's top, with every fold arrow
 * of the note on screen.
 */
async function openNote(phone: Phone): Promise<void> {
    await phone.openStream();
    await phone.placeAt(`${NOTE} .daily-note-title`, -20);
}

// A fold arrow's icon is 16 px, and a finger can land anywhere in the 44 px
// around it (styles.css). 12 px from its middle, the finger misses the icon.
for (const [what, section, target, offset] of [
    ["a heading's chevron", HEADING, `${HEADING} > .collapse-indicator`, { x: 12, y: 0 }],
    ["a list item's chevron", LIST_ITEM, `${LIST_ITEM} > .collapse-indicator`, { x: -12, y: 0 }],
    // Its arrow only shows when the pointer is over it, so the whole row is the
    // target.
    ["the properties row", PROPERTIES, `${PROPERTIES} .metadata-properties-heading`, { x: 0, y: 0 }],
] as const)
    test(`a tap on ${what}, off the icon, folds the section and a second unfolds it`, async ({ phone }) => {
        await openNote(phone);

        await phone.tap(target, offset);
        await expect.poll(() => collapsed(phone, section), "folded").toBe(true);

        await phone.tap(target, offset);
        await expect.poll(() => collapsed(phone, section), "unfolded").toBe(false);
    });

test("a tap on a heading's text leaves it unfolded", async ({ phone }) => {
    await openNote(phone);

    await phone.tap(HEADING);
    await phone.rest();

    expect(await collapsed(phone, HEADING)).toBe(false);
});
