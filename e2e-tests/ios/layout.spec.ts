import { drivesIPad } from "./device";
import { test, expect, type Phone } from "./phone";
import { EMBEDS_NOTE, FREE_DAYS, KANBAN } from "./vault";

const NOTE = `.daily-note-block[data-source-path="${EMBEDS_NOTE}"]`;

/**
 * What in the note with every kind of embed shows past its text's right edge,
 * as far as the boxes that cut it off allow, and whether the pane scrolls
 * sideways.
 */
const overflow = (phone: Phone) =>
    phone.run((note: string) => {
        const block = document.querySelector(note)!;
        const content = block.querySelector(".daily-note-content")!;
        const right = content.getBoundingClientRect().right;
        const pane = block.closest(".daily-notes-stream-container")!.parentElement!;
        const over = [...content.querySelectorAll("*")]
            .filter((el) => {
                const box = el.getBoundingClientRect();
                let shown = box.right;
                // Clipped inside the text, as a Base's table cell clips its
                // header. This looks past the text's own clip.
                for (let clip = el.parentElement; clip && clip !== content; clip = clip.parentElement)
                    if (getComputedStyle(clip).overflowX !== "visible")
                        shown = Math.min(shown, clip.getBoundingClientRect().right);
                return box.width > 0 && shown > right + 1;
            })
            .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
        if (pane.scrollWidth > pane.clientWidth) over.unshift(`the pane, ${pane.scrollWidth} wide`);
        return over.slice(0, 10);
    }, NOTE);

/**
 * The items of each Base's toolbar in the note that the toolbar clips. Obsidian
 * shrinks the view name and count to fit.
 */
const toolbarCut = (phone: Phone) =>
    phone.run((note: string) => {
        const cut = [...document.querySelectorAll(`${note} .bases-toolbar`)].flatMap((bar) => {
            const right = bar.getBoundingClientRect().right;
            // An item's margin goes past its button, so use the button, as the
            // item cuts it off.
            return [...bar.children].filter((item) => {
                const button = item.firstElementChild!.getBoundingClientRect().right;
                return Math.min(button, item.getBoundingClientRect().right) > right + 1;
            });
        });
        return cut.map((item) => item.className);
    }, NOTE);

/**
 * Narrow.base, the note's second Base: it is wider than a phone held upright,
 * and fits one on its side. Middle.base, which the note says switches, stays as
 * cards on a phone either way. It switches on a tablet.
 */
const FLIPPING = `${NOTE} .daily-note-content > .daily-note-base:nth-child(2 of .daily-note-base)`;
const MATH = `${NOTE} .daily-note-content > h2:nth-of-type(4)`;

/** How `FLIPPING` is drawn now: as cards, or as a table. */
const form = (phone: Phone) =>
    phone.run((base: string) => {
        const el = document.querySelector(base)!;
        if (el.querySelector(".bases-cards-item")) return "cards";
        return el.querySelector(".bases-table") ? "table" : "nothing";
    }, FLIPPING);

/** Whether the kanban is drawn as cards, once it is near the screen. */
const kanbanAsCards = async (phone: Phone) => {
    await phone.placeAt(KANBAN, -40);
    await expect.poll(() => phone.has(`${KANBAN} .bases-cards-item`)).toBe(true);
    return !(await phone.has(`${KANBAN} .bases-kanban-card`));
};

/** How wide the note's equation is drawn, and how wide the note's text is. */
const widths = (phone: Phone) =>
    phone.run((note: string) => {
        const block = document.querySelector(note)!;
        const width = (selector: string) => Math.round(block.querySelector(selector)!.getBoundingClientRect().width);
        return { equation: width("mjx-container[display]"), text: width(".daily-note-content") };
    }, NOTE);

/** Where the equation's section starts below the pane's top. */
const mathTop = (phone: Phone) =>
    phone.run((math: string) => {
        const el = document.querySelector(math)!;
        const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
        return Math.round(el.getBoundingClientRect().top - pane.getBoundingClientRect().top);
    }, MATH);

/**
 * How far a turn may move the place, because the text above it wraps again at
 * the new width.
 */
const REWRAP_PX = 100;

/**
 * The Base's form and the equation's width in the phone's current orientation,
 * once nothing goes past the note. Ends with the equation in view.
 */
async function drawn(phone: Phone) {
    await phone.placeAt(FLIPPING, -100);
    const base = await form(phone);
    expect(await overflow(phone)).toEqual([]);
    await phone.placeAt(MATH, -20);
    return { base, ...(await widths(phone)) };
}

test("nothing in the note of every embed scrolls sideways, reaches past its text or is cut off", async ({ phone }) => {
    await phone.openStream();
    // Section by section, because Bases only draw what is near the screen.
    for (let section = 1; section <= 6; section++) {
        await phone.placeAt(`${NOTE} .daily-note-content > h2:nth-of-type(${section})`, -20);
        expect(await overflow(phone), `section ${section}`).toEqual([]);
        expect(await toolbarCut(phone), `section ${section}'s Base toolbars`).toEqual([]);
    }
});

// On an iPad, the note is the readable line length in either orientation, which
// is narrower than a phone on its side. So the Base stays a table, and the
// equation keeps its width.
const DEVICE = drivesIPad(process.env) ? { upright: "table", widens: false } : { upright: "cards", widens: true };

test("a turn flips a wide Base between cards and a table on a phone, and fits the equation to the note", async ({
    phone,
}) => {
    await phone.openStream();
    const found = await phone.orientation();
    await phone.turn("PORTRAIT");
    try {
        const upright = await drawn(phone);
        expect(upright.base).toBe(DEVICE.upright);
        expect(upright.equation).toBeLessThanOrEqual(upright.text);

        const place = await mathTop(phone);
        await phone.turn("LANDSCAPE");
        expect(Math.abs((await mathTop(phone)) - place), "the place, on a turn").toBeLessThanOrEqual(REWRAP_PX);
        expect(await kanbanAsCards(phone), "a kanban wider than the phone on its side").toBe(true);
        const onItsSide = await drawn(phone);
        expect(onItsSide.base).toBe("table");
        expect(onItsSide.equation > upright.equation, "the equation wider on its side").toBe(DEVICE.widens);
        expect(onItsSide.equation).toBeLessThanOrEqual(onItsSide.text);

        await phone.turn("PORTRAIT");
        expect(Math.abs((await mathTop(phone)) - place), "the place, on the turn back").toBeLessThanOrEqual(REWRAP_PX);
        expect((await drawn(phone)).base).toBe(DEVICE.upright);
    } finally {
        await phone.turn(found);
    }
});

/** Sets Obsidian's text size on the phone, or back to the default with null. */
const setTextSize = (phone: Phone, size: number | null) =>
    phone.run((size: number | null) => {
        window.app.saveLocalStorage("base-font-size", size);
        window.app.updateFontSize();
    }, size);

/**
 * How far below its words' center the checkbox of the first task in the pane
 * is.
 */
const checkboxOffset = (phone: Phone) =>
    phone.run(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!.getBoundingClientRect();
        const li = [...document.querySelectorAll(".daily-note-content li.task-list-item")].find(
            (el) => el.getBoundingClientRect().top >= pane.top
        )!;
        const box = li.querySelector(":scope > input.task-list-item-checkbox")!;
        const words = [...li.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim())!;
        const range = document.createRange();
        range.selectNodeContents(words);
        const text = range.getBoundingClientRect();
        const check = box.getBoundingClientRect();
        return check.top + check.height / 2 - (text.top + text.height / 2);
    });

// iOS uses its own system font. Obsidian's fixed move left the box 5px too high
// at 28px here, three times what Chromium's phone layout shows (D-104).
test("centers a task's checkbox on its words at the default and a large text size", async ({ phone }) => {
    await phone.openStream();
    try {
        for (const size of [16, 28]) {
            await setTextSize(phone, size);
            await phone.placeAt(".daily-note-content li.task-list-item", -100);
            expect(Math.abs(await checkboxOffset(phone)), `${size}px`).toBeLessThan(1);
        }
    } finally {
        await setTextSize(phone, null);
    }
});

// iOS's system font draws the box bigger than Chromium's phone layout.
// Obsidian's margin left the first line 10px left of the rest at 28px here
// (D-106).
test("lines a wrapped task's words up under its first line at the default and a large text size", async ({ phone }) => {
    const note = FREE_DAYS[0];
    const task = `.daily-note-block[data-source-path="${note}"] li.task-list-item`;
    await phone.runAsync(async (path: string) => {
        await window.app.vault.create(
            path,
            "- [ ] A wrapping task, its words running on past the width of a phone so the line breaks and carries on\n"
        );
    }, note);
    try {
        await phone.openStream();
        for (const size of [16, 28]) {
            await setTextSize(phone, size);
            await phone.placeAt(task, -100);
            const lines = await phone.run((sel: string) => {
                const li = document.querySelector(sel)!;
                const range = document.createRange();
                range.selectNodeContents(li);
                range.setStartAfter(li.querySelector(":scope > input.task-list-item-checkbox")!);
                return [...range.getClientRects()].map((line) => line.left);
            }, task);
            expect(lines.length, `${size}px: lines`).toBeGreaterThan(1);
            for (const left of lines.slice(1)) expect(Math.abs(left - lines[0]!), `${size}px`).toBeLessThan(1);
        }
    } finally {
        await setTextSize(phone, null);
        await phone.runAsync(async (path: string) => {
            await window.app.vault.delete(window.app.vault.getFileByPath(path)!);
        }, note);
    }
});
