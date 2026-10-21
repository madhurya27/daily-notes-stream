import { test, expect } from "./phone";
import { longNote } from "../long-note";

// Every test fails on an error in Obsidian's console; these prove the check
// fails, one for each way an error reaches it.
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

// The status bar's clock ticks: in a shot, two shots of a still screen differ.
test("a screenshot leaves out the status bar", async ({ phone }) => {
    const shot = Buffer.from(await phone.screenshot(), "base64");
    const screen = await phone.run(() => window.innerHeight * window.devicePixelRatio);

    expect(shot.readUInt32BE(20), "the shot's height, in pixels").toBeLessThan(screen);
});

// Written to the top, the scroll left the anchor holding a place from below: a
// long newest note drew from its end and landed some 250,000 px down.
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

// The follower judges every glide spec: a recording showed this jump, and
// none where an owing glide stops (jump.spec.ts).
test("the reader's follower reports a note above growing mid-glide, unshifted", async ({ phone }) => {
    await phone.openStream();
    await phone.flick("up");
    await phone.followReader();
    await phone.run(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        let heard = 0;
        // Pinned, its size goes unobserved: the anchor never hears of it (ADR 0013).
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

// A glide ended at speed, mid-stream, is what a staller does (ADR 0008): the
// pane frozen for a frame, as the stream's stop freezes it, ends it so.
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
