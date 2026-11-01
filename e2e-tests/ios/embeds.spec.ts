import { test, expect, type Phone } from "./phone";
import { OBSIDIAN } from "./session";
import { EMBEDS_NOTE, FREE_DAYS, KANBAN } from "./vault";

const NOTE = `.daily-note-block[data-source-path="${EMBEDS_NOTE}"]`;
const PDF = `${NOTE} .pdf-embed`;
const VIDEO = `${NOTE} a.daily-note-video`;
/**
 * Narrow.base, with a summary row: cards on a phone held upright, and a table
 * on its side.
 */
const SUMMED = `${NOTE} .bases-view:has(.bases-table-footer)`;

test.afterEach(async ({ phone }) => {
    if ((await phone.frontApp()) !== OBSIDIAN) await phone.returnToObsidian();
    await phone.run(() => window.app.workspace.detachLeavesOfType("pdf"));
});

// A preview, with its toolbar clipped, and a link to the file (D-083).
test("a PDF shows its first page without a toolbar, and a tap opens it", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(PDF, -40);
    await expect.poll(() => phone.run((pdf: string) => !!document.querySelector(`${pdf} canvas`), PDF)).toBe(true);

    const toolbars = await phone.run((pdf: string) => {
        const embed = document.querySelector(pdf)!;
        return [...embed.querySelectorAll(".pdf-toolbar")].filter((bar) => {
            const { left, top, width, height } = bar.getBoundingClientRect();
            const hit = document.elementFromPoint(left + width / 2, top + height / 2);
            return width > 0 && height > 0 && !!hit && bar.contains(hit);
        }).length;
    }, PDF);
    expect(toolbars, "toolbars a finger could reach").toBe(0);

    await phone.tap(PDF);

    await expect.poll(() => phone.run(() => window.app.workspace.getActiveFile()?.path)).toBe("Attachments/Manual.pdf");
});

const PDF_DAY = FREE_DAYS[0].slice("Journal/".length, -".md".length);

/**
 * Opens the stream with a note holding a PDF on a free day for `body`, and puts
 * the note back.
 */
async function withPdfNote<T>(phone: Phone, body: () => Promise<T>): Promise<T> {
    const path = FREE_DAYS[0];
    const original = await phone.writeNote(path, "Words first.\n\n![[Manual.pdf]]\n\nWords after.\n");
    try {
        await phone.openStream();
        return await body();
    } finally {
        await phone.restoreNote(path, original);
    }
}

// The note's text is there at once, and the queue does not wait for the PDF to
// load (D-202).
test("a note with a PDF finishes drawing before the PDF has loaded", async ({ phone }) => {
    await withPdfNote(phone, async () => {
        const path = FREE_DAYS[0];
        await phone.run((path: string) => {
            const { renderer } = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view.stream.window;
            const renderInto = renderer.renderInto;
            renderer.renderInto = async function (this: unknown, block: HTMLElement, ...rest: unknown[]) {
                const drawn = await renderInto.call(this, block, ...rest);
                if (block.dataset.sourcePath === path)
                    (window as unknown as { pdfAtDrawn: unknown }).pdfAtDrawn = {
                        words: block.textContent!.includes("Words after."),
                        box: !!block.querySelector(".pdf-embed"),
                        canvas: !!block.querySelector("canvas"),
                        height: block.querySelector(".pdf-embed")!.getBoundingClientRect().height,
                    };
                return drawn;
            };
        }, path);

        await phone.jumpTo(PDF_DAY);

        const atDrawn = await phone.run(
            () =>
                (
                    window as unknown as {
                        pdfAtDrawn: { words: boolean; box: boolean; canvas: boolean; height: number };
                    }
                ).pdfAtDrawn
        );
        expect(atDrawn).toMatchObject({ words: true, box: true, canvas: false });
        const note = `.daily-note-block[data-source-path="${path}"]`;
        await expect
            .poll(() => phone.run((pdf: string) => !!document.querySelector(pdf), `${note} .pdf-embed canvas`))
            .toBe(true);
        // Starting a page's shape, the text below it barely moves as it loads.
        const loaded = await phone.run(
            (box: string) => document.querySelector(box)!.getBoundingClientRect().height,
            `${note} .pdf-embed`
        );
        expect(Math.abs(loaded - atDrawn.height), `from ${atDrawn.height} to ${loaded}`).toBeLessThan(10);
    });
});

// A PDF now loads outside the queue, so its note can go away first. Every test
// fails on an error in the console.
test("closing the stream while a PDF loads logs no error", async ({ phone }) => {
    await withPdfNote(phone, async () => {
        await phone.runAsync(async (date: string) => {
            const view = window.app.workspace.getLeavesOfType("daily-notes-stream-view")[0]!.view;
            const moved = view.stream.jumpToDate(window.moment(date, "YYYY-MM-DD"));
            const pdf = () => document.querySelector(".pdf-embed");
            while (!pdf()) await new Promise(requestAnimationFrame);
            window.app.workspace.detachLeavesOfType("daily-notes-stream-view");
            await moved;
        }, PDF_DAY);
        await new Promise((resolve) => setTimeout(resolve, 1500));
    });
});

test("a video shows its thumbnail under a play button, and a tap opens it on YouTube", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(VIDEO, -40);
    await expect
        .poll(() =>
            phone.run((video: string) => document.querySelector<HTMLImageElement>(`${video} img`)!.naturalWidth, VIDEO)
        )
        .toBeGreaterThan(120);
    expect(await phone.has(`${VIDEO} .daily-note-video-play`)).toBe(true);

    await phone.tap(VIDEO);

    await expect.poll(() => phone.frontApp()).not.toBe(OBSIDIAN);
});

/**
 * Scrolls the view's `edge` 100px past the pane's edge. Returns how far it
 * went, and where each bar was on the view before and after.
 */
const scrollPast = (phone: Phone, edge: "top" | "bottom") =>
    phone.run(
        (view: string, edge: "top" | "bottom") => {
            const el = document.querySelector(view)!;
            const pane = el.closest(".daily-notes-stream-container")!.parentElement!;
            const sign = edge === "top" ? -1 : 1;
            const past = () => sign * (el.getBoundingClientRect()[edge] - pane.getBoundingClientRect()[edge]);
            const offset = (bar: string) =>
                el.querySelector(bar)!.getBoundingClientRect()[edge] - el.getBoundingClientRect()[edge];
            const bars = () => ({ header: offset(".bases-thead"), footer: offset(".bases-table-footer") });
            const before = bars();
            pane.scrollTop -= sign * (100 - past());
            return { past: past(), before, after: bars() };
        },
        SUMMED,
        edge
    );

// Bases pins both to its own scroll container. Clipped on a phone, they would
// be pinned to the stream's.
test("a Base table's header and summary row stay on it as the stream scrolls past", async ({ phone }) => {
    await phone.openStream();
    const found = await phone.orientation();
    await phone.turn("LANDSCAPE");
    try {
        await phone.placeAt(SUMMED, -40);

        const top = await scrollPast(phone, "top");
        expect(top.past).toBeGreaterThan(50);
        expect(top.after.header).toBe(top.before.header);
        const bottom = await scrollPast(phone, "bottom");
        expect(bottom.past).toBeGreaterThan(50);
        expect(bottom.after.footer).toBe(bottom.before.footer);
    } finally {
        await phone.turn(found);
    }
});

// A preview that links to the page (D-098), because a touch on the page would
// scroll it, not the stream.
test("a web page in a frame shows, and a tap opens it", async ({ phone }) => {
    const note = FREE_DAYS[1];
    const link = `.daily-note-block[data-source-path="${note}"] a.daily-note-frame-link`;
    await phone.runAsync(async (path: string) => {
        await window.app.vault.create(
            path,
            'A page:\n\n<iframe src="https://example.com/" width="560" height="400"></iframe>\n'
        );
    }, note);
    try {
        await phone.openStream();
        await phone.placeAt(link, -40);
        await expect
            .poll(() => phone.run((sel: string) => document.querySelector(`${sel} iframe`)!.getAttribute("src"), link))
            .toBe("https://example.com/");

        await phone.tap(link);

        await expect.poll(() => phone.frontApp()).not.toBe(OBSIDIAN);
    } finally {
        // In the background, iOS stops IndexedDB writes, and Obsidian does not
        // handle the rejection.
        if ((await phone.frontApp()) !== OBSIDIAN) await phone.returnToObsidian();
        await phone.runAsync(async (path: string) => {
            await window.app.vault.delete(window.app.vault.getFileByPath(path)!);
        }, note);
    }
});

// When clipped, a phone only showed the first column (D-107).
test("a kanban wider than the phone shows every column as a group of cards", async ({ phone }) => {
    await phone.openStream();
    await phone.placeAt(KANBAN, -40);
    const columns = await phone.run(() =>
        [...new Set<string>(window.app.vault.getFiles().map((f: { extension: string }) => f.extension))].sort()
    );

    const shown = () =>
        phone.run((kanban: string) => {
            const slot = document.querySelector(kanban)!;
            if (slot.querySelector(".bases-kanban-card")) return ["a kanban"];
            const right = slot.closest(".daily-note-content")!.getBoundingClientRect().right;
            return [...slot.querySelectorAll(".bases-group-heading .bases-group-value")]
                .filter((value) => {
                    const box = value.getBoundingClientRect();
                    return box.width > 0 && box.right <= right + 1;
                })
                .map((value) => value.textContent!)
                .sort();
        }, KANBAN);
    await expect.poll(shown).toEqual(columns);
});
