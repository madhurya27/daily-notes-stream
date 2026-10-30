import { test, expect } from "./phone";
import { SHORT_NOTE } from "./vault";

test("back from the Home Screen, the stream is where it was, and a flick still glides", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(`.daily-note-block[data-source-path="${SHORT_NOTE}"] .daily-note-content > p`, -20);
    const left = await phone.place();
    await phone.followPlaces("return");

    await phone.background(3);

    const shown = await phone.places();
    expect(shown, "the stream drew no frame on return").not.toEqual([]);
    for (const { path, offset } of shown) {
        expect(path).toBe(left.path);
        // Rounded to either side of a half pixel, which is not a jump.
        expect(Math.abs(offset - left.offset), `shown at ${offset}, left at ${left.offset}`).toBeLessThanOrEqual(1);
    }
    expect((await phone.glide("up")).faults).toEqual([]);
});

// The glide up ends at the top while the notes above are rendered. Once the
// glide stops, the stream must not keep the reader's place below the top (ADR
// 0013).
test("after a quit and a jump to an old date, flicks up stop on the newest note, and it stays", async ({ phone }) => {
    await phone.openStream();
    const top = await phone.newestOffset();
    await phone.flick("up", 3);
    await phone.relaunch();
    // As on a first open, or after a change of width: every note above has an
    // estimated height.
    await phone.forgetHeights();
    await phone.openStream();
    await phone.jumpTo("2026-09-12");

    for (let flicks = 0; flicks < 30 && (await phone.scrollTop()) > 0; flicks++) await phone.flick("down", 3);

    expect(await phone.scrollTop()).toBe(0);
    expect(await phone.newestOffset()).toBe(top);
});
