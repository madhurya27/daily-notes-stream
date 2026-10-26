import { test, expect, openStream } from "./obsidian";

/**
 * Newer than every test note, so it is rendered as the stream opens.
 */
const NOTE = "Notes/2026-03-16.md";
const PAGE = "about:blank#video";
/**
 * What happened to one frame: each page it was given, and its background color
 * each time it was held.
 */
type FrameLog = { srcs: (string | null)[]; shades: string[] };

// A frame that starts loading its page while scrolling stops iOS's scrolling
// (D-087). On mobile, the page waits for scrolling to stop, then loads. Desktop
// loads it at once.
test("a frame in a note gets its page, on mobile once the stream is still, shaded until then", async ({
    obsidian,
    mobileLayout,
}) => {
    const { page } = obsidian;
    // As an earlier test leaves it: with a stream open, which renders the note
    // too.
    await openStream(page);
    await page.evaluate(
        async ({ note, src }) => {
            // For each frame, because a stream left open holds its own copy of
            // the note's frame.
            const logs = new WeakMap<HTMLIFrameElement, FrameLog>();
            Object.assign(window, { frameLogs: logs });
            new MutationObserver((records) => {
                for (const { target, attributeName } of records) {
                    if (!(target instanceof HTMLIFrameElement)) continue;
                    const log = logs.get(target) ?? { srcs: [], shades: [] };
                    logs.set(target, log);
                    if (attributeName === "src") log.srcs.push(target.getAttribute("src"));
                    else if (target.classList.contains("is-frame-held"))
                        log.shades.push(getComputedStyle(target).backgroundColor);
                }
            }).observe(document.body, { attributes: true, attributeFilter: ["src", "class"], subtree: true });
            await window.app.vault.create(
                note,
                `## Video\n\n<iframe src="${src}" width="560" height="315"></iframe>\n`
            );
        },
        { note: NOTE, src: PAGE }
    );
    try {
        const container = await openStream(page);
        const frame = container.locator(`.daily-note-block[data-source-path="${NOTE}"] iframe`);

        await expect(frame).toHaveAttribute("src", PAGE);
        const log = await frame.evaluate(
            (el) =>
                (window as unknown as { frameLogs: WeakMap<HTMLIFrameElement, FrameLog> }).frameLogs.get(
                    el as HTMLIFrameElement
                ) ?? { srcs: [], shades: [] }
        );
        expect(log.srcs).toEqual(mobileLayout ? [null, PAGE] : []);
        // Meanwhile a placeholder is shown, in Obsidian's secondary background
        // color.
        const secondary = await page.evaluate(() => {
            const probe = document.body.appendChild(document.createElement("div"));
            probe.style.backgroundColor = "var(--background-secondary)";
            const color = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return color;
        });
        expect(log.shades).toEqual(mobileLayout ? [secondary] : []);
    } finally {
        await page.evaluate(async (note) => {
            const file = window.app.vault.getFileByPath(note);
            if (file) await window.app.vault.delete(file);
        }, NOTE);
    }
});

// The player does not work inside the app, and its page would stop scrolling
// (D-088).
test("on mobile a YouTube embed is its thumbnail, a link to the video", async ({ obsidian, mobileLayout }) => {
    const { page } = obsidian;
    await page.evaluate(
        // Returning the TFile would try to send the whole app.
        async (note) => {
            await window.app.vault.create(
                note,
                '## Video\n\n<iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ?start=30" width="560" height="315"></iframe>\n'
            );
        },
        NOTE
    );
    try {
        const block = (await openStream(page)).locator(`.daily-note-block[data-source-path="${NOTE}"]`);
        await expect(block.locator(".daily-note-content")).toBeVisible();

        if (!mobileLayout) {
            await expect(block.locator("iframe")).toHaveAttribute("src", /youtube\.com\/embed/);
            return;
        }
        await expect(block.locator("iframe")).toHaveCount(0);
        const link = block.locator("a.daily-note-video");
        await expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30");
        // The player's shape, as wide as the note, with the play button in the
        // middle.
        const [box, play, content] = await Promise.all([
            link.boundingBox(),
            link.locator(".daily-note-video-play").boundingBox(),
            block.locator(".daily-note-content").boundingBox(),
        ]);
        expect(box!.width).toBeCloseTo(Math.min(560, content!.width), 0);
        expect(box!.height).toBeCloseTo((box!.width * 315) / 560, 0);
        expect(play!.x + play!.width / 2).toBeCloseTo(box!.x + box!.width / 2, 0);
        expect(play!.y + play!.height / 2).toBeCloseTo(box!.y + box!.height / 2, 0);
        // Spaced like a paragraph, where the player was on a line of its own.
        const [margins, paragraph] = await link.evaluate((el) => {
            const probe = document.body.appendChild(document.createElement("p"));
            probe.style.marginBlock = "var(--p-spacing)";
            const spacing = getComputedStyle(probe).marginTop;
            probe.remove();
            const style = getComputedStyle(el);
            return [[style.marginTop, style.marginBottom], spacing];
        });
        expect(margins).toEqual([paragraph, paragraph]);
        // No arrow after it, unlike the one Obsidian draws after a web link.
        expect(await link.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
    } finally {
        await page.evaluate(async (note) => {
            const file = window.app.vault.getFileByPath(note);
            if (file) await window.app.vault.delete(file);
        }, NOTE);
    }
});

// A page in a frame would scroll inside it, which ends the flick that should
// scroll the stream. On mobile, it is shown as a preview that links to the
// page.
test("on mobile a web page in a frame is a preview, a tap on it the link's", async ({ obsidian, mobileLayout }) => {
    const { page } = obsidian;
    const site = "https://example.com/map";
    await page.evaluate(
        async ({ note, src }) => {
            await window.app.vault.create(note, `A map:\n\n<iframe src="${src}" width="560" height="400"></iframe>\n`);
        },
        { note: NOTE, src: site }
    );
    try {
        const block = (await openStream(page)).locator(`.daily-note-block[data-source-path="${NOTE}"]`);
        const frame = block.locator("iframe");
        await expect(frame).toHaveAttribute("src", site);

        const link = block.locator("a.daily-note-frame-link");
        if (!mobileLayout) {
            await expect(link).toHaveCount(0);
            return;
        }
        await expect(link).toHaveAttribute("href", site);
        // What a finger lands on in the middle of the frame, and the link's box
        // compared with the frame's.
        const [tapped, linkBox, frameBox] = await Promise.all([
            frame.evaluate((el) => {
                const box = el.getBoundingClientRect();
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                if (hit === el) return "frame";
                return hit?.closest("a.daily-note-frame-link") ? "link" : (hit?.tagName.toLowerCase() ?? null);
            }),
            link.boundingBox(),
            frame.boundingBox(),
        ]);
        expect(tapped).toBe("link");
        expect(linkBox).toEqual(frameBox);
    } finally {
        await page.evaluate(async (note) => {
            const file = window.app.vault.getFileByPath(note);
            if (file) await window.app.vault.delete(file);
        }, NOTE);
    }
});
