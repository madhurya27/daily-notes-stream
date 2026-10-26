import type { Locator, Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeWebp } from "../scripts/recording.mjs";

/**
 * Records the page while `scene` plays, and writes it to `output` as a lossless
 * animated WebP. Frames come from Chromium's screencast. They are only at the
 * display's scale when the window is shown (E2E_SHOW_WINDOW=1), as for
 * screenshots.
 */
export async function record(page: Page, output: string, scene: () => Promise<void>): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    const frames: { timestamp: number; data: string }[] = [];
    cdp.on("Page.screencastFrame", (event) => {
        frames.push({ timestamp: event.metadata.timestamp ?? Date.now() / 1000, data: event.data });
        void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
    });
    await showPointer(page, pointers.get(page));
    await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1600, maxHeight: 1600 });
    try {
        await scene();
    } finally {
        await cdp.send("Page.stopScreencast");
        await cdp.detach();
    }

    const dir = mkdtempSync(join(tmpdir(), "dns-frames-"));
    try {
        const files = frames.map(({ timestamp, data }, i) => {
            const path = join(dir, `${String(i).padStart(5, "0")}.png`);
            writeFileSync(path, Buffer.from(data, "base64"));
            return { timestamp, path };
        });
        writeWebp(files, output, { minInterval: 1 / 30 });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Scrolls `distance` pixels over `area` as a trackpad flick does: a quick
 * series of wheel events, large at first and then smaller, as uneven as a real
 * hand. It scrolls from wherever the pointer is. The pointer only moves if it
 * is outside `area`, to the nearest point inside it. The pattern is fixed, so a
 * new recording scrolls the same way.
 */
export async function flick(page: Page, distance: number, area: Locator): Promise<void> {
    const box = await area.boundingBox();
    if (!box) throw new Error("nothing on screen to scroll");
    const at = pointers.get(page);
    const inset = 40;
    const x = Math.min(Math.max(at?.x ?? box.x + box.width * 0.6, box.x + inset), box.x + box.width - inset);
    const y = Math.min(Math.max(at?.y ?? box.y + box.height * 0.6, box.y + inset), box.y + box.height - inset);
    if (!at || at.x !== x || at.y !== y) await glideTo(page, x, y);

    const steps = 22;
    const weights = Array.from({ length: steps }, (_, i) => (1 - i / steps) ** 2 * (1 + 0.15 * Math.sin(i * 2.3)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    for (const [i, weight] of weights.entries()) {
        await page.mouse.wheel(0, (distance * weight) / total);
        await page.waitForTimeout(14 + (i % 3) * 3);
    }
}

/**
 * Types `text` at a person's speed: keys 90–180 ms apart, with a longer pause
 * after a space or punctuation. The pattern is fixed, so a new recording types
 * the same way.
 */
export async function typeLikeAPerson(page: Page, text: string): Promise<void> {
    for (const [i, key] of [...text].entries()) {
        await page.keyboard.type(key);
        const beat = 90 + ((i * 37) % 90);
        await page.waitForTimeout(/[\s.,]/.test(key) ? beat + 120 : beat);
    }
}

/**
 * Draws what a recording would otherwise not show: the pointer, shaped as macOS
 * shapes it for what is under it and hidden while typing, and each click, as a
 * ring that grows and fades. Without them, a tab that closes on a click looks
 * like it closed by itself.
 */
async function showPointer(page: Page, resting?: { x: number; y: number }): Promise<void> {
    await page.evaluate((resting) => {
        const layer = (css: Partial<CSSStyleDeclaration>) => {
            const el = document.body.appendChild(document.createElement("div"));
            Object.assign(el.style, { position: "fixed", pointerEvents: "none", zIndex: "2147483647" }, css);
            return el;
        };
        const disc = (x: number, y: number, size: number) =>
            layer({
                left: "0",
                top: "0",
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: "50%",
                background: "rgba(120, 120, 120, 0.35)",
                border: "2px solid rgba(255, 255, 255, 0.85)",
                transform: `translate(${x - size / 2}px, ${y - size / 2}px)`,
            });
        const fade = (el: HTMLElement, ms: number) => {
            el.style.transition = `opacity ${ms}ms ease-out`;
            requestAnimationFrame(() => (el.style.opacity = "0"));
            window.setTimeout(() => el.remove(), ms + 100);
        };

        // The shapes macOS draws, each with the point that is its tip.
        const outline = 'stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none"';
        const ink = 'stroke="#111" stroke-width="1.4" stroke-linecap="round" fill="none"';
        const beam = "M8 3.5c1.5 0 2.5.5 3 1.5.5-1 1.5-1.5 3-1.5M11 5v12M8 18.5c1.5 0 2.5-.5 3-1.5.5 1 1.5 1.5 3 1.5";
        const shapes = {
            arrow: {
                hotspot: [2, 1],
                svg:
                    '<path d="M2 1v17l4.6-4.2 3.1 7 2.9-1.3-3.1-6.9H16z" fill="#111" stroke="#fff" ' +
                    'stroke-width="1.5" stroke-linejoin="round"/>',
            },
            beam: { hotspot: [11, 11], svg: `<path d="${beam}" ${outline}/><path d="${beam}" ${ink}/>` },
            hand: {
                hotspot: [9.5, 1.5],
                svg:
                    '<path d="M8 2.5a1.5 1.5 0 0 1 3 0V10h.5V8.5a1.5 1.5 0 0 1 3 0V10h.5V9.5a1.5 1.5 0 0 1 3 0V11h.3' +
                    "v-.5a1.5 1.5 0 0 1 3 0V16c0 3.5-2.5 6-6 6h-2c-2.2 0-3.6-1-4.8-2.6L3.2 14.6a1.6 1.6 0 0 1 2.4-2L8 15z" +
                    '" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>',
            },
        };
        type Shape = keyof typeof shapes;

        /**
         * What macOS shows at (x, y). CSS `auto` is a text cursor over text or
         * anything editable.
         */
        const shapeAt = (x: number, y: number): Shape => {
            const el = document.elementFromPoint(x, y) as HTMLElement | null;
            if (!el) return "arrow";
            const cursor = getComputedStyle(el).cursor;
            if (cursor === "pointer") return "hand";
            if (cursor === "text" || el.isContentEditable) return "beam";
            if (cursor !== "auto") return "arrow";
            const caret = document.caretRangeFromPoint(x, y);
            const text = caret?.startContainer;
            if (!caret || !text || text.nodeType !== Node.TEXT_NODE) return "arrow";
            const glyph = document.createRange();
            glyph.setStart(text, Math.max(0, caret.startOffset - 1));
            glyph.setEnd(text, Math.min(text.textContent?.length ?? 0, caret.startOffset + 1));
            const box = glyph.getBoundingClientRect();
            return x >= box.left - 2 && x <= box.right + 2 && y >= box.top && y <= box.bottom ? "beam" : "arrow";
        };

        const pointer = layer({ left: "0", top: "0", width: "22px", height: "24px" });
        let shown: Shape | null = null;
        const place = (x: number, y: number) => {
            const shape = shapeAt(x, y);
            if (shape !== shown) {
                pointer.innerHTML = `<svg width="22" height="24" viewBox="0 0 22 24">${shapes[shape].svg}</svg>`;
                shown = shape;
            }
            const [hx, hy] = shapes[shape].hotspot as [number, number];
            pointer.style.transform = `translate(${x - hx}px, ${y - hy}px)`;
            pointer.style.visibility = "visible";
        };
        // Where the hand already is. Off screen until it moves, if nothing sets
        // it.
        if (resting) place(resting.x, resting.y);
        else pointer.style.visibility = "hidden";
        document.addEventListener("mousemove", (event) => place(event.clientX, event.clientY), true);
        // macOS hides the pointer while you type, until the mouse moves again.
        document.addEventListener("keydown", () => (pointer.style.visibility = "hidden"), true);
        document.addEventListener(
            "mousedown",
            (event) => {
                const ring = disc(event.clientX, event.clientY, 36);
                ring.style.transition = "transform 500ms ease-out";
                requestAnimationFrame(() => (ring.style.transform += " scale(1.5)"));
                fade(ring, 500);
            },
            true
        );
    }, resting);
}

/** Where each page's pointer last went, and how many moves it has made. */
const pointers = new WeakMap<Page, { x: number; y: number; glides: number }>();

/**
 * Moves the pointer to (x, y) as a hand does: along a slight curve, speeding up
 * then slowing down, taking longer for longer moves, and going a few pixels
 * past the target before coming back to it. The pattern is fixed, so a new
 * recording moves the same way.
 */
export async function glideTo(page: Page, x: number, y: number): Promise<void> {
    const from = pointers.get(page) ?? { x: x + 160, y: y + 120, glides: 0 };
    const dx = x - from.x;
    const dy = y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return;
    // The curve bends to one side, then the other, as a wrist turns one way
    // then the other.
    const bow = (from.glides % 2 === 0 ? 1 : -1) * Math.min(60, distance * 0.12);
    const control = { x: from.x + dx / 2 - (dy / distance) * bow, y: from.y + dy / 2 + (dx / distance) * bow };
    // Go a little past, in the direction of the move, then come back.
    const past = Math.min(6, distance * 0.03);
    const end = { x: x + (dx / distance) * past, y: y + (dy / distance) * past };
    const steps = Math.round(Math.min(40, 14 + distance / 25));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        const u = 1 - eased;
        await page.mouse.move(
            u * u * from.x + 2 * u * eased * control.x + eased * eased * end.x,
            u * u * from.y + 2 * u * eased * control.y + eased * eased * end.y
        );
        await page.waitForTimeout(14 + (i % 4) * 2);
    }
    for (const t of [0.5, 1]) {
        await page.mouse.move(end.x + (x - end.x) * t, end.y + (y - end.y) * t);
        await page.waitForTimeout(40);
    }
    pointers.set(page, { x, y, glides: from.glides + 1 });
}

/**
 * Puts the pointer at (x, y) at once: where a hand is before the recording
 * starts.
 */
export async function restAt(page: Page, x: number, y: number): Promise<void> {
    await page.mouse.move(x, y);
    pointers.set(page, { x, y, glides: 0 });
}

/**
 * Moves the pointer a little down and left, as a hand moves away from a button
 * it clicked.
 */
export async function driftOff(page: Page): Promise<void> {
    const at = pointers.get(page);
    if (at) await glideTo(page, at.x - 46, at.y + 58);
}

/**
 * Moves to the middle of `target` and clicks it, holding `modifiers` while it
 * does.
 */
export async function clickLikeAPerson(page: Page, target: Locator, modifiers: string[] = []): Promise<void> {
    const box = await target.boundingBox();
    if (!box) throw new Error("nothing on screen to click");
    await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, modifiers);
}

/** Moves to (x, y) and clicks there, holding `modifiers` while it does. */
export async function clickAt(page: Page, x: number, y: number, modifiers: string[] = []): Promise<void> {
    await glideTo(page, x, y);
    await page.waitForTimeout(180);
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.down();
    await page.waitForTimeout(70);
    await page.mouse.up();
    for (const key of modifiers) await page.keyboard.up(key);
}
