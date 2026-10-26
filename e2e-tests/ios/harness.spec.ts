import { test, expect } from "./phone";
import { longNote } from "../long-note";

// Every test fails if there is an error in Obsidian's console. These prove the
// check fails, one for each way an error can reach it.
for (const [how, cause] of [
    ["logged", () => console.error("A logged error")],
    [
        "thrown",
        () =>
            void setTimeout(() => {
                throw new Error("A thrown error");
            }),
    ],
    [
        "thrown behind a busy page",
        () => {
            setTimeout(() => {
                for (const end = performance.now() + 1000; performance.now() < end;);
            });
            setTimeout(() => {
                throw new Error("A thrown error, late");
            });
        },
    ],
    ["rejected", () => void Promise.reject(new Error("A rejected promise"))],
] as const)
    test(`an error ${how} on the phone fails the test`, async ({ phone }) => {
        test.fail();
        await phone.run(cause);
    });

// The status bar's clock changes, so two screenshots of a screen that is not
// moving would differ.
test("a screenshot leaves out the status bar", async ({ phone }) => {
    const shot = Buffer.from(await phone.screenshot(), "base64");
    const screen = await phone.run(() => window.innerHeight * window.devicePixelRatio);

    expect(shot.readUInt32BE(20), "the shot's height, in pixels").toBeLessThan(screen);
});

// Setting the scroll to the top left the anchor keeping a place from further
// down. A long newest note drew from its end and ended up about 250,000 px
// down.
test("a stream opened from deep in it is at its top, over a long newest note", async ({ phone }) => {
    const path = await phone.journalPath(0);
    const original = await phone.writeNote(path, longNote(10000));
    try {
        await phone.openStream();
        await phone.jumpTo("2026-09-10");

        await phone.openStream();

        expect(await phone.scrollTop()).toBe(0);
        expect(await phone.newestOffset()).toBeGreaterThan(0);
    } finally {
        await phone.restoreNote(path, original);
    }
});

// The follower checks every scrolling test. A recording showed this jump, and
// no jump where a scroll that owes stops (jump.spec.ts).
test("the reader's follower reports a note above growing mid-glide, unshifted", async ({ phone }) => {
    await phone.openStream();
    await phone.flick("up");
    await phone.followReader();
    await phone.run(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        let heard = 0;
        // With a fixed height, its size is not observed, so the anchor never
        // hears about it (ADR 0013).
        const grow = () => {
            if (++heard < 5) return;
            pane.removeEventListener("scroll", grow);
            const paneTop = pane.getBoundingClientRect().top;
            const above = [...pane.querySelectorAll<HTMLElement>(".daily-note-block.is-pinned")].find(
                (block) => block.getBoundingClientRect().bottom < paneTop
            )!;
            const height = parseFloat(above.style.getPropertyValue("--daily-note-pinned-height"));
            above.style.setProperty("--daily-note-pinned-height", `${height + 300}px`);
        };
        pane.addEventListener("scroll", grow);
    });

    await phone.flick("up");

    const { drifts } = await phone.stopFollowing();
    expect(drifts.filter((drift) => Math.abs(drift - 300) <= 1).length, `drifts: ${drifts.join(", ")}`).toBeGreaterThan(
        0
    );
});

// A scroll that ends while still fast, in the middle of the stream, is what
// something that stops scrolling causes (ADR 0008). Freezing the pane for a
// frame, as the stream's stop does, ends it in the same way.
test("a glide cut short mid-stream is told from one that slows to its end", async ({ phone }) => {
    await phone.openStream();
    await phone.flick("up");
    await phone.run(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        let heard = 0;
        const freeze = () => {
            if (++heard < 5) return;
            pane.removeEventListener("scroll", freeze);
            pane.classList.add("is-scroll-frozen");
            requestAnimationFrame(() => pane.classList.remove("is-scroll-frozen"));
        };
        pane.addEventListener("scroll", freeze);
    });

    expect(await phone.glideEnding("up")).toBe("cut short");
});
