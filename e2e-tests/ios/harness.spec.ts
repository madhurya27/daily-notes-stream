import { test, expect, type FlickStart, type Phone } from "./phone";
import { longNote } from "../long-note";

// A report says what the test ran on.
test("a test notes the device and the shape of its screen", { tag: "@portrait" }, async ({ phone }) => {
    const note = test.info().annotations.find(({ type }) => type === "screen");
    const { width, height } = await phone.run(() => ({ width: window.innerWidth, height: window.innerHeight }));

    expect(note?.description).toMatch(new RegExp(`^(iPhone|iPad) (portrait|landscape), ${width}x${height}$`));
});

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

// A stream that never settles must fail the test, not let it check a stream
// still moving.
test("rest fails a stream that never stops moving", async ({ phone }) => {
    await phone.openStream();
    await phone.run(() => {
        const stream = document.querySelector<HTMLElement>(".daily-notes-stream-container")!;
        let shift = 0;
        const move = () => {
            if (!stream.isConnected) return;
            stream.style.setProperty("--daily-notes-scroll-shift", `${++shift % 2}px`);
            requestAnimationFrame(move);
        };
        requestAnimationFrame(move);
    });
    try {
        await expect(phone.rest()).rejects.toThrow(/still moving/);
    } finally {
        await phone.openStream();
    }
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
// no jump where a glide that owes stops (jump.spec.ts).
test("the reader's follower reports a note above growing mid-glide, unshifted", async ({ phone }) => {
    await phone.openStream();
    await phone.flick("up");
    await phone.followReader();
    await phone.run(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        let heard = 0;
        // A pinned block's size is not observed, so the anchor never hears
        // about it (ADR 0013).
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

// Otherwise a test would pass on only the part of a glide the reader saw.
test("the reader's follower fails when it loses its text", async ({ phone }) => {
    await phone.openStream();
    await phone.followReader();
    try {
        await phone.runAsync(async () => {
            const hide = document.head.appendChild(document.createElement("style"));
            hide.id = "hide-notes";
            hide.textContent = ".daily-note-block > * { display: none !important; }";
            for (let frames = 0; frames < 3; frames++) await new Promise(requestAnimationFrame);
        });

        await expect(phone.stopFollowing()).rejects.toThrow("The reader lost its text");
    } finally {
        await phone.run(() => document.getElementById("hide-notes")?.remove());
    }
});

// To compare a cut glide's start with the starts of glides that were not cut.
test("a glide's ending comes with what the screen held as it started", async ({ phone }) => {
    await phone.openStream();
    const blocks = await phone.run(() => document.querySelectorAll(".daily-note-block").length);

    await phone.glide("up");

    const attached = test.info().attachments.find(({ name }) => name === "flick start");
    expect(attached, "no flick start attached").toBeDefined();
    const start = JSON.parse(attached!.body!.toString()) as FlickStart;
    expect(start.top).toBe(0);
    expect(start.blocks).toHaveLength(blocks);
    expect(start.blocks.some(({ rendered }) => !rendered)).toBe(true);
    expect(start.bases.some(({ rows }) => rows > 0)).toBe(true);
});

// A box that can scroll stops a glide (ADR 0008), even one that scrolls only
// for a few frames.
test("a glide records a box that could scroll for a moment", async ({ phone }) => {
    await phone.openStream();
    await phone.run(() => {
        const note = document.querySelector(".daily-note-block:not(.is-unloaded) .daily-note-content")!;
        document.addEventListener(
            "touchend",
            () =>
                requestAnimationFrame(() => {
                    const box = note.appendChild(document.createElement("div"));
                    box.className = "scroll-box-probe";
                    box.style.cssText = "overflow: auto; height: 10px";
                    requestAnimationFrame(() => requestAnimationFrame(() => box.remove()));
                }),
            { once: true }
        );
    });

    const { faults } = await phone.glide("up");

    expect(faults).toContainEqual(expect.stringContaining("a box that could scroll: div.scroll-box-probe"));
    const glides = test.info().attachments.filter(({ name }) => name === "glide");
    const { changes } = JSON.parse(glides.at(-1)!.body!.toString()) as { changes: { kind: string; what: string }[] };
    const probe = changes.filter(({ what }) => what.includes("scroll-box-probe")).map(({ kind }) => kind);
    expect(probe).toEqual(expect.arrayContaining(["scroll box", "scroll box gone"]));
});

// The stream must not set the scroll position while a glide moves (ADR 0013).
test("a glide records a write to the scroll position before it ended", async ({ phone }) => {
    await phone.openStream();
    await phone.flick("up");
    await phone.run(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        let heard = 0;
        const write = () => {
            if (++heard < 5) return;
            pane.removeEventListener("scroll", write);
            pane.scrollTop += 1;
        };
        document.addEventListener("touchend", () => pane.addEventListener("scroll", write), { once: true });
    });

    const { faults } = await phone.glide("up");

    expect(faults).toEqual([
        expect.stringMatching(/^scrollTop \d+ ms after the lift, \d+ ms after the scroll last moved$/),
    ]);
});

// The stream's own writes wait until the scroll is still (SCROLL_IDLE_MS).
test("a glide's faults leave out a write once the scroll is still", async ({ phone }) => {
    await phone.openStream();
    await phone.flick("up");
    await phone.run(() => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        let moved = 0;
        const heard = () => (moved = performance.now());
        document.addEventListener(
            "touchend",
            () => {
                heard();
                pane.addEventListener("scroll", heard);
                const wait = () => {
                    if (performance.now() - moved < 400) {
                        requestAnimationFrame(wait);
                        return;
                    }
                    pane.removeEventListener("scroll", heard);
                    pane.scrollTop += 1;
                };
                requestAnimationFrame(wait);
            },
            { once: true }
        );
    });

    const { faults } = await phone.glide("up");

    expect(faults).toEqual([]);
    const glides = test.info().attachments.filter(({ name }) => name === "glide");
    const { stops } = JSON.parse(glides.at(-1)!.body!.toString()) as { stops: unknown[] };
    expect(stops, "the write was recorded").toHaveLength(1);
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
        // From the lift, so it cuts the glide, not a scroll before the stroke.
        document.addEventListener("touchend", () => pane.addEventListener("scroll", freeze), { once: true });
    });
    // Scrolls before the stroke, as a late load's can be, must not spend the
    // freeze.
    await phone.runAsync(async () => {
        const pane = document.querySelector(".daily-notes-stream-container")!.parentElement!;
        for (let i = 0; i < 5; i++) {
            pane.scrollTop += 1;
            await new Promise(requestAnimationFrame);
        }
    });

    const { ending, faults } = await phone.glide("up");

    expect(ending).toBe("cut short");
    expect(faults).toEqual([
        expect.stringMatching(/^freeze \d+ ms after the lift, \d+ ms after the scroll last moved$/),
    ]);
    // What happened around the cut is attached, to explain a cut no test made.
    const attached = test.info().attachments.find(({ name }) => name === "cut-short glide")!;
    const { events } = JSON.parse(attached.body!.toString()) as { events: { kind: string; what: string }[] };
    expect(events.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["touchstart", "touchmove", "touchend"]));
    expect(events).toContainEqual(
        expect.objectContaining({ kind: "class", what: expect.stringContaining("is-scroll-frozen") })
    );
});
