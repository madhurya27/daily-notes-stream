import { test, expect, type Phone } from "./phone";
import { SHORT_NOTE } from "./vault";

const PARAGRAPH = `.daily-note-block[data-source-path="${SHORT_NOTE}"] .daily-note-content > p`;

/** Writes `text` to the short note, as a sync from another device would. */
const rewrite = (phone: Phone, text: string) =>
    phone.runAsync(
        async (path: string, t: string) =>
            void (await window.app.vault.modify(window.app.vault.getFileByPath(path)!, t)),
        SHORT_NOTE,
        text
    );

test("a note on screen edited elsewhere re-renders in place", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(PARAGRAPH, -20);
    const left = await phone.place();
    const before = await phone.runAsync(async (path: string) => window.app.vault.adapter.read(path), SHORT_NOTE);

    try {
        // Still one line, so the note keeps its height.
        await rewrite(phone, "A short day, one paragraph edited.\n");

        await expect
            .poll(() => phone.run((p: string) => document.querySelector(p)!.textContent, PARAGRAPH))
            .toBe("A short day, one paragraph edited.");
        await phone.rest();
        expect(await phone.place()).toEqual(left);
    } finally {
        await rewrite(phone, before);
    }
});
