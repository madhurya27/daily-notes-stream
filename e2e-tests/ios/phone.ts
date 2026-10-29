import { test as base, expect } from "@playwright/test";
import { drivesIPad } from "./device";
import { glideEnding, longestStall, neverScrolled, type GlideEnding, type GlideEvent, type Heard } from "./glide";
import { keyboardAfterRun } from "./keyboard";
import { connect, OBSIDIAN, SAFARI } from "./session";
import { returnToTestersVault, useVault } from "./vault";

/** XCUIKeyModifierCommand, for `mobile: keys`. */
const COMMAND = 1 << 4;

/**
 * Obsidian on an iPhone connected by USB (ADR 0016). The touches are real, sent
 * through WebDriverAgent, so a flick keeps scrolling the way a thumb's does.
 * What the stream did is read from Obsidian's web view.
 */

const STREAM = ".daily-notes-stream-container";

/** What the tests use of the plugin's saved note heights (note-heights.ts). */
type NoteHeights = {
    estimate(layout: string, path: string, floor?: number): number | undefined;
    forget(path: string): void;
    toJSON(): unknown;
    restore(saved: unknown): void;
};

/** A scroll container the tests add, with nothing in it that scrolls. */
const PLAIN_PAGE = "#glide-check";

export type Orientation = "PORTRAIT" | "LANDSCAPE";
type Layer = "letters" | "numbers";
/**
 * The characters escaped in a key's name in the screen's XML, with `&amp;`
 * last.
 */
const XML_ENTITIES = [
    ["&quot;", '"'],
    ["&apos;", "'"],
    ["&lt;", "<"],
    ["&gt;", ">"],
    ["&amp;", "&"],
] as const;
type Seen = { path: string; kind: string; index: number; text: string; top: number };
/**
 * A point in the web view, in CSS pixels, and the viewport width they are
 * measured against.
 */
export type Point = { x: number; y: number; viewport: number };
/**
 * A touch the tests sent: from where to where, in the screen's points, and when
 * (in Unix ms) and for how long.
 */
export type SentTouch = { from: { x: number; y: number }; to: { x: number; y: number }; start: number; ms: number };
/**
 * Where the stream is, as it keeps its place: a note, and how far its top is
 * from the pane's top.
 */
export type Place = { path: string; offset: number };

/**
 * How far below the pane's top a stroke stays, away from the header above it.
 */
const PANE_EDGE = 20;

/**
 * How long to wait for iOS's keyboard to appear. If it has not appeared by
 * then, a keyboard is attached.
 */
const KEYBOARD_RISE = 5_000;

/**
 * XCTest's code for the Right Arrow key. Pressing it in an input types nothing.
 */
const RIGHT_ARROW = "\uF703";

/**
 * How far `placeAt` looks: past the first two batches of the test notes, about
 * 20 screens each.
 */
const SCREENS = 60;

/**
 * A note's parts as the reader sees them: its title, property rows, Markdown
 * blocks and mentions. A part is identified by its position among parts of the
 * same kind, so adding a property, or a hidden run's spacer, does not change
 * the position of parts of other kinds.
 */
const TEXT_KINDS = [
    ".daily-note-title",
    ".metadata-property",
    // Not a Base: it renders its rows again as it scrolls, and its changed text
    // would look like a blank.
    ".daily-note-content > :not(.daily-note-far-run, .daily-note-base)",
    ".daily-note-mention",
];

/**
 * The `.daily-note-block` selector that `target` starts with, if any: up to the
 * first space outside brackets.
 */
function blockOf(target: string): string | undefined {
    if (!target.startsWith(".daily-note-block")) return undefined;
    let nesting = 0;
    for (const [i, c] of [...target].entries()) {
        if (c === "(" || c === "[") nesting++;
        else if (c === ")" || c === "]") nesting--;
        else if (c === " " && nesting === 0) return target.slice(0, i);
    }
    return undefined;
}

/**
 * Obsidian's sanitizer gives each embedded frame `allow-presentation`, a flag
 * iOS's WebKit does not know. Obsidian's own reading view logs this too, with
 * the stream closed.
 */
const OBSIDIANS_SANDBOX_NOTICE =
    "Error while parsing the 'sandbox' attribute: 'allow-presentation' is an invalid sandbox flag.";

export class Phone {
    /**
     * WebDriverAgent takes up to half a second to answer, more while scrolling.
     * It only changes when the screen turns.
     */
    private screen: { width: number; height: number } | undefined;
    /**
     * Where the stream's pane starts on the screen. It only changes when the
     * screen turns.
     */
    private pane: number | undefined;
    /**
     * Each touch sent since `logTouches`, or null if touches are not being
     * kept.
     */
    private sent: SentTouch[] | null = null;
    /**
     * Where the keyboard's keys are, for each layout. It only changes when the
     * screen turns.
     */
    private readonly keyboards = new Map<Layer, Map<string, { x: number; y: number }>>();

    constructor(private readonly driver: WebdriverIO.Browser) {}

    /**
     * Starts keeping each touch sent, for `sentTouches`. A recording draws
     * them.
     */
    logTouches(): void {
        this.sent = [];
    }

    sentTouches(): SentTouch[] {
        return this.sent ?? [];
    }

    /** The screen's size in points, the unit touches are measured in. */
    screenSize(): Promise<{ width: number; height: number }> {
        return this.windowSize();
    }

    /**
     * Sends `actions`, and logs `touches` if they are being kept. Each touch
     * starts `after` ms into a gesture `length` ms long, which ended when the
     * command returned.
     */
    private async perform(
        actions: Parameters<WebdriverIO.Browser["performActions"]>[0],
        length: number,
        touches: (Omit<SentTouch, "start"> & { after: number })[]
    ): Promise<void> {
        await this.driver.performActions(actions);
        const end = Date.now();
        this.sent?.push(...touches.map(({ after, ...touch }) => ({ ...touch, start: end - length + after })));
    }

    /**
     * Runs `fn` in Obsidian's web view. Like Playwright's `evaluate`, `fn`
     * cannot use variables from outside it.
     */
    async run<R, A extends unknown[]>(fn: (...args: A) => R, ...args: A): Promise<R> {
        await this.inWebView();
        return (await this.driver.execute(`return (${fn.toString()})(...arguments)`, ...args)) as R;
    }

    /** `run` for a function that finishes later. */
    async runAsync<R, A extends unknown[]>(fn: (...args: A) => Promise<R>, ...args: A): Promise<R> {
        await this.inWebView();
        // A rejection must also call back, or the driver waits until its script
        // timeout. Not as `error`, because WebdriverIO uses that key itself.
        const script = `const done = arguments[arguments.length - 1];
            (${fn.toString()})(...arguments[0]).then((value) => done({ value }), (e) => done({ failure: String(e) }));`;
        const { value, failure } = (await this.driver.executeAsyncScript(script, [args])) as {
            value: R;
            failure?: string;
        };
        if (failure !== undefined) throw new Error(`On the phone: ${failure}\nin: ${fn.toString().slice(0, 200)}`);
        return value;
    }

    /** Opens `url` as a tapped link would, in whatever app handles it. */
    async openUrl(url: string): Promise<void> {
        await this.native();
        await this.driver.execute("mobile: deepLink", { url, bundleId: OBSIDIAN });
    }

    /**
     * The bundle id of the app in front. It changes once a tap leaves Obsidian.
     */
    async frontApp(): Promise<string> {
        await this.native();
        return ((await this.driver.execute("mobile: activeAppInfo")) as { bundleId: string }).bundleId;
    }

    /**
     * Goes back to Obsidian from whatever app is in front, as if from its icon.
     * A page a test opened in Safari is closed first, so runs leave no tabs
     * behind. Safari's other tabs are left alone.
     */
    async returnToObsidian(): Promise<void> {
        await this.native();
        if ((await this.frontApp()) === SAFARI) await this.closeSafariTab();
        await this.driver.execute("mobile: activateApp", { bundleId: OBSIDIAN });
    }

    /** Closes the tab Safari shows, as Command-W does. */
    private async closeSafariTab(): Promise<void> {
        await this.driver.execute("mobile: keys", { keys: [{ key: "w", modifierFlags: COMMAND }] });
    }

    /**
     * Whether iOS shows its on-screen keyboard. With a hardware keyboard
     * attached, iOS sometimes says its keyboard is shown when it is not.
     */
    async keyboardShown(): Promise<boolean> {
        await this.native();
        if (!(await this.driver.isKeyboardShown())) return false;
        return (await this.keyboardY()) < (await this.windowSize()).height;
    }

    /** The top of iOS's on-screen keyboard, in the page's CSS pixels. */
    async keyboardTop(): Promise<number> {
        const y = await this.keyboardY();
        const viewport = await this.run(() => window.innerWidth);
        return y * (viewport / (await this.windowSize()).width);
    }

    /** The top of iOS's on-screen keyboard, in the screen's points. */
    private async keyboardY(): Promise<number> {
        await this.native();
        const { y } = await this.driver.$("-ios class chain:**/XCUIElementTypeKeyboard").getLocation();
        return y;
    }

    /**
     * Waits for iOS's on-screen keyboard to appear. When a keyboard is attached
     * to an iPad, iOS hides its own. Pressing one key through XCTest makes iOS
     * show it again, and it stays shown until the keyboard is detached and
     * attached again. So if the keyboard has not appeared, this presses Right
     * Arrow on an iPad.
     */
    async raiseKeyboard(): Promise<void> {
        const rose = await expect
            .poll(() => this.keyboardShown(), { timeout: KEYBOARD_RISE })
            .toBe(true)
            .then(
                () => true,
                () => false
            );
        if (rose) return;
        if (drivesIPad(process.env)) await this.driver.execute("mobile: keys", { keys: [RIGHT_ARROW] });
        await expect.poll(() => this.keyboardShown(), "iOS's keyboard did not rise").toBe(true);
    }

    /**
     * Types `text` on iOS's on-screen keyboard, tapping each key; a newline is
     * Return. Shift is never pressed, so a letter gets the case iOS gives it,
     * as it would for a reader. `burst` keys are sent in one gesture. One
     * gesture presses its keys about 30 ms apart, and each gesture takes a
     * round trip of about 560 ms, so 2 types in pairs, at about a reader's
     * speed. Each key is held for 30 ms: held until the next key is pressed,
     * iOS types extra letters.
     */
    async type(text: string, burst = Infinity): Promise<void> {
        await this.native();
        let layer = await this.keyboardLayer();
        let taps: { x: number; y: number }[] = [];
        const flush = async () => {
            for (let from = 0; from < taps.length; from += burst) await this.pressAll(taps.slice(from, from + burst));
            taps = [];
        };
        const keysOf = async (l: Layer) => {
            // A layout not yet read is read from the screen, so it must be
            // showing.
            if (!this.keyboards.has(l)) {
                await flush();
                await expect.poll(() => this.keyboardLayer()).toBe(l);
            }
            return this.keysOf(l);
        };
        for (const char of text) {
            const name = char === "\n" ? "return" : char === " " ? "space" : char.toLowerCase();
            let keys = await keysOf(layer);
            if (!keys.has(name)) {
                const other = keys.get("more");
                if (!other) throw new Error(`No key for ${JSON.stringify(char)} among ${[...keys.keys()].join(" ")}`);
                taps.push(other);
                // On its own: a key pressed while this one is still held goes
                // to the old layout.
                await flush();
                layer = layer === "letters" ? "numbers" : "letters";
                keys = await keysOf(layer);
            }
            const key = keys.get(name);
            if (!key) throw new Error(`No ${JSON.stringify(char)} key on iOS's keyboard.`);
            taps.push(key);
            // Either one can switch iOS from its digits back to its letters.
            if (layer === "numbers" && (char === " " || char === "\n")) {
                await flush();
                layer = await this.keyboardLayer();
            }
        }
        await flush();
    }

    /** Which layout the keyboard shows: letters, or digits and punctuation. */
    private async keyboardLayer(): Promise<Layer> {
        const q = await this.driver.$('-ios predicate string:type == "XCUIElementTypeKey" AND name ==[c] "q"');
        return (await q.isExisting()) ? "letters" : "numbers";
    }

    /**
     * Where each key of a layout is, by name, with letters in lower case. Read
     * once, from one copy of the screen's XML.
     */
    private async keysOf(layer: Layer): Promise<Map<string, { x: number; y: number }>> {
        const known = this.keyboards.get(layer);
        if (known) return known;
        const source = await this.driver.getPageSource();
        const keyboard = source.slice(
            source.indexOf("<XCUIElementTypeKeyboard"),
            source.indexOf("</XCUIElementTypeKeyboard>")
        );
        const keys = new Map<string, { x: number; y: number }>();
        for (const [, attributes] of keyboard.matchAll(/<XCUIElementType(?:Key|Button) ([^>]*)>/g)) {
            const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes!)?.[1];
            const name = attribute("name");
            if (!name || name.startsWith("Padding")) continue;
            const [x, y, width, height] = ["x", "y", "width", "height"].map((a) => Number(attribute(a)));
            keys.set(XML_ENTITIES.reduce((n, [entity, char]) => n.replaceAll(entity, char), name).toLowerCase(), {
                x: x! + width! / 2,
                y: y! + height! / 2,
            });
        }
        this.keyboards.set(layer, keys);
        return keys;
    }

    /**
     * Goes to the Home Screen for `seconds`, then back to Obsidian, as a reader
     * switching apps would.
     */
    async background(seconds: number): Promise<void> {
        await this.native();
        await this.driver.execute("mobile: backgroundApp", { seconds });
    }

    /**
     * Quits Obsidian and opens it again, as if from its icon. Returns once the
     * plugin is loaded.
     */
    async relaunch(): Promise<void> {
        await this.native();
        await this.driver.execute("mobile: terminateApp", { bundleId: OBSIDIAN });
        await this.driver.execute("mobile: activateApp", { bundleId: OBSIDIAN });
        await expect
            .poll(() => this.run(() => !!window.app?.plugins?.plugins?.["daily-notes-stream"]).catch(() => false), {
                timeout: 30_000,
            })
            .toBe(true);
    }

    /**
     * The path of the daily note `days` before today, as the test vault names
     * it.
     */
    journalPath(days: number): Promise<string> {
        return this.run(
            (days: number) => `Journal/${new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA")}.md`,
            days
        );
    }

    /**
     * Writes `text` to the note at `path`, and waits until it is indexed.
     * Returns what it held before, or null if it was new.
     */
    writeNote(path: string, text: string): Promise<string | null> {
        return this.runAsync(
            async (path: string, text: string) => {
                const { vault, metadataCache } = window.app;
                const file = vault.getFileByPath(path);
                const original: string | null = file ? await vault.read(file) : null;
                await new Promise<void>((indexed) => {
                    const ref = metadataCache.on("changed", (changed: { path: string }) => {
                        if (changed.path !== path) return;
                        metadataCache.offref(ref);
                        indexed();
                    });
                    void (file ? vault.modify(file, text) : vault.create(path, text));
                });
                return original;
            },
            path,
            text
        );
    }

    /** Puts back what `writeNote` returned: the note's old text, or no note. */
    async restoreNote(path: string, original: string | null): Promise<void> {
        await this.runAsync(
            async (path: string, original: string | null) => {
                const file = window.app.vault.getFileByPath(path);
                if (!file) return;
                if (original === null) await window.app.vault.delete(file);
                else await window.app.vault.modify(file, original);
            },
            path,
            original
        );
    }

    /**
     * Closes the stream and forgets every note's measured height, so a stream
     * opened next uses estimates.
     */
    async forgetHeights(): Promise<void> {
        await this.run(() => {
            window.app.workspace.detachLeavesOfType("daily-notes-stream-view");
            window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes.restore(null);
        });
    }

    /**
     * Forgets the heights of the notes newer than `date` (`YYYY-MM-DD`), and
     * estimates each one at 100 px, until `restoreHeights`. Run it before the
     * stream opens, which gives each empty note its height. When an estimate
     * is too short, every note grows as it is rendered, which is the case that
     * used to jump. The plugin's own estimate is set, so the stream keeps it
     * (ADR 0014).
     */
    async estimateShortAbove(date: string): Promise<void> {
        await this.run((after: string) => {
            const notes: NoteHeights = window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes;
            (window as unknown as { savedHeights: unknown }).savedHeights = notes.toJSON();
            const short = new Set(
                (window.app.vault.getMarkdownFiles() as { path: string; basename: string }[])
                    .filter(({ basename }) => /^\d{4}-\d{2}-\d{2}$/.test(basename) && basename > after)
                    .map(({ path }) => path)
            );
            for (const path of short) notes.forget(path);
            const estimate = notes.estimate.bind(notes);
            notes.estimate = (layout, path, floor) => (short.has(path) ? 100 : estimate(layout, path, floor));
        }, date);
    }

    /** Undoes `estimateShortAbove`, for the tests after it. */
    async restoreHeights(): Promise<void> {
        await this.run(() => {
            const notes: NoteHeights = window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes;
            delete (notes as Partial<NoteHeights>).estimate;
            notes.restore((window as unknown as { savedHeights: unknown }).savedHeights);
        });
    }

    /**
     * Opens the stream again, at its top, and waits until it is still. It is
     * opened again, not scrolled to the top, because setting the scroll to the
     * top leaves the anchor keeping a place from further down (D-142).
     */
    async openStream(): Promise<void> {
        await this.run(() => {
            // Pulling past the top, which a flick up the stream can end in,
            // opens Obsidian's command palette.
            for (const modal of document.querySelectorAll<HTMLElement>(".modal-container .modal-bg")) modal.click();
            window.app.workspace.detachLeavesOfType("daily-notes-stream-view");
        });
        // If opened in the same task as the close, it never rendered.
        await this.run(() => window.app.commands.executeCommandById("daily-notes-stream:open-stream"));
        await expect
            .poll(() => this.run((s: string) => document.querySelectorAll(`${s} .daily-note-block`).length, STREAM))
            .toBeGreaterThan(0);
        await this.rest();
    }

    /**
     * Jumps, as the jump list would, to the newest note on or before `date`
     * (`YYYY-MM-DD`), and waits until it is still.
     */
    async jumpTo(date: string): Promise<void> {
        await this.runAsync(
            (d: string) =>
                window.app.workspace
                    .getLeavesOfType("daily-notes-stream-view")[0]
                    .view.stream.jumpToDate(window.moment(d, "YYYY-MM-DD")),
            date
        );
        await this.rest();
    }

    /**
     * Starts following the text at or just below `at` on every frame, as the
     * reader's eye would: the pane's middle, or its top, which is what the
     * scroll anchor holds. `stopFollowing` reports what it saw. The text is
     * found by its position in its note, as `topOf` finds it, because a note
     * may be re-rendered under the reader. When the text leaves the screen,
     * the eye moves to the text then at `at`. A blank where the text was on
     * screen counts as a drift of NaN. It also reads the text when the page
     * gets a scroll event, before the stream reacts to it: iOS keeps scrolling
     * without events, and reading only once a frame mixed that step and the
     * stream's reaction into one.
     *
     * A Base on screen above the text that grows may push it down, by as much
     * as the Base grew: Bases draws a table's rows as it comes on screen. That
     * is no drift.
     */
    async followReader({ at = "middle" }: { at?: "middle" | "top" } = {}): Promise<void> {
        await this.run(
            (s: string, kinds: string[], at: string) => {
                const blocks = kinds.join(", ");
                const pane = document.querySelector(s)!.parentElement!;
                const box = pane.getBoundingClientRect();
                const line = at === "top" ? box.top : box.top + box.height / 2;
                /**
                 * Inside its note's box: a pinned note clips what has grown
                 * past its height until it re-pins (ADR 0013).
                 */
                const inNote = (el: Element) => {
                    const { top, bottom } = el.getBoundingClientRect();
                    const note = el.closest(".daily-note-block")?.getBoundingClientRect() ?? box;
                    return bottom > note.top && top < note.bottom;
                };
                const onScreen = (el: Element) => {
                    const { top, bottom } = el.getBoundingClientRect();
                    return inNote(el) && bottom > box.top && top < box.bottom;
                };
                // A scroll that the text on screen does not follow was not made
                // by the reader: the anchor moving its shift into the scroll
                // (ScrollAnchor), or a jump nobody has explained yet.
                let unseen = 0;
                let lastScroll = pane.scrollTop;
                /** The scroll's last step, as the page heard it. */
                let glide = 0;
                /**
                 * Set by the stream, not by scrolling: the text stayed still,
                 * or setting the scroll against the scrolling moved it on by
                 * one step at most, as stopping does, because iOS has already
                 * drawn that step (`ScrollAnchor.stopGlide`).
                 */
                const written = (step: number, moved: number) =>
                    Math.abs(moved) <= 1 ||
                    (Math.sign(step) === -Math.sign(glide) &&
                        Math.sign(moved) === -Math.sign(glide) &&
                        Math.abs(moved) <= Math.abs(glide) + 1);
                const scrolled = () => pane.scrollTop - unseen;
                // Below the screen too: a Base may fill it below the line.
                const pick = () => {
                    const at = [...pane.querySelectorAll(blocks)].find(
                        (el) => el.getBoundingClientRect().bottom > line && inNote(el)
                    );
                    if (!at) return null;
                    const note = at.closest<HTMLElement>(".daily-note-block")!;
                    const kind = kinds.find((k) => at.matches(k))!;
                    return {
                        path: CSS.escape(note.dataset.sourcePath!),
                        kind,
                        index: [...note.querySelectorAll(kind)].indexOf(at),
                        text: at.textContent,
                        start: at.getBoundingClientRect().top,
                        last: at.getBoundingClientRect().top,
                        from: scrolled(),
                        /** How far Bases on screen above it pushed it. */
                        pushed: 0,
                        base: null as { el: Element; bottom: number; height: number; scrolled: number } | null,
                    };
                };
                /** The Base nearest above `top` whose end is on screen. */
                const baseAbove = (top: number) =>
                    [...pane.querySelectorAll(".daily-note-base")]
                        .filter((el) => {
                            const { bottom } = el.getBoundingClientRect();
                            return bottom > box.top && bottom <= top;
                        })
                        .at(-1);
                /**
                 * Adds to `pushed` how far the Base above the text moved apart
                 * from the scroll since the last read, as far as it grew. A
                 * jump moves the Base too, but does not grow it.
                 */
                const pushedBy = (current: NonNullable<typeof eye>, top: number) => {
                    const el = baseAbove(top);
                    const was = current.base;
                    current.base = null;
                    if (!el) return;
                    const { bottom, height } = el.getBoundingClientRect();
                    if (was?.el === el) {
                        const moved = bottom - was.bottom + (scrolled() - was.scrolled);
                        const grew = height - was.height;
                        current.pushed += Math.min(Math.max(moved, Math.min(grew, 0)), Math.max(grew, 0));
                    }
                    current.base = { el, bottom, height, scrolled: scrolled() };
                };
                let eye = pick();
                if (!eye) throw new Error(`No text at or below the pane's ${at}.`);
                const unloaded = () => pane.querySelectorAll(".daily-note-block.is-unloaded").length;
                const follow = {
                    drifts: [] as number[],
                    moves: [] as number[],
                    unloaded: unloaded(),
                    rendered: 0,
                    on: true,
                    heard: new AbortController(),
                };
                (window as unknown as { streamReader: typeof follow }).streamReader = follow;
                /**
                 * Reads where the text is. Returns false once there is no text
                 * to follow.
                 */
                const read = (): boolean => {
                    if (!follow.on || !eye) return false;
                    const scroll = pane.scrollTop;
                    const step = scroll - lastScroll;
                    lastScroll = scroll;
                    follow.rendered = Math.max(follow.rendered, follow.unloaded - unloaded());
                    const block = pane.querySelector(`.daily-note-block[data-source-path="${eye.path}"]`);
                    const at = block?.querySelectorAll(eye.kind)[eye.index];
                    // Another part is in its place: its note is being drawn
                    // again, and has not reached it yet.
                    const text = at?.textContent === eye.text ? at : null;
                    if (!text) {
                        // Its note is on screen without it: a blank where the
                        // reader was, until it is back.
                        if (block && onScreen(block)) follow.drifts.push(NaN);
                        else eye = pick();
                        return true;
                    }
                    // Where the text is, compared with where the scroll alone
                    // would put it.
                    const top = text.getBoundingClientRect().top;
                    const moved = top - eye.last;
                    eye.last = top;
                    if (Math.abs(step) > 1 && written(step, moved)) unseen += step + moved;
                    else if (Math.abs(step) > 1) glide = step;
                    pushedBy(eye, top);
                    follow.drifts.push(Math.round(top - eye.start - eye.pushed - (eye.from - scrolled())));
                    // Where the text is on screen, as a reader who is not
                    // scrolling sees it.
                    follow.moves.push(Math.round(top - eye.start));
                    if (!onScreen(text)) eye = pick();
                    return true;
                };
                const frame = () => read() && requestAnimationFrame(frame);
                requestAnimationFrame(frame);
                // Captured on the document, so it runs before the pane's own
                // listeners, including the stream's.
                document.addEventListener("scroll", (event) => event.target === pane && read(), {
                    capture: true,
                    signal: follow.heard.signal,
                });
            },
            STREAM,
            TEXT_KINDS,
            at
        );
    }

    /**
     * Each read since `followReader`: how far the text moved apart from the
     * scroll (`drifts`, while scrolling), and on screen (`moves`, for a reader
     * who is not scrolling), and how many notes were rendered.
     */
    stopFollowing(): Promise<{ drifts: number[]; moves: number[]; rendered: number }> {
        return this.run(() => {
            const follow = (
                window as unknown as {
                    streamReader: {
                        drifts: number[];
                        moves: number[];
                        rendered: number;
                        on: boolean;
                        heard: AbortController;
                    };
                }
            ).streamReader;
            follow.on = false;
            follow.heard.abort();
            return { drifts: follow.drifts, moves: follow.moves, rendered: follow.rendered };
        });
    }

    /**
     * Starts watching each rendered note's height, at the end of each task and
     * on each frame. `stopWatchingPins` reports any change made without the
     * height being re-pinned or the note being unloaded (ADR 0013). Also counts
     * the notes seen rendered.
     */
    async watchPins(): Promise<void> {
        await this.run((s: string) => {
            const pane = document.querySelector(s)!.parentElement!;
            /**
             * What only re-pinning or unloading the note changes.
             */
            const state = (block: HTMLElement) =>
                [
                    block.style.getPropertyValue("--daily-note-pinned-height"),
                    block.classList.contains("is-pinned"),
                    block.classList.contains("is-unloaded"),
                ].join();
            const seen = new Map<HTMLElement, { state: string; height: number }>();
            const rendered = new Set<string>();
            const watch = { unpinned: [] as string[], rendered: 0, on: true, tasks: null as MutationObserver | null };
            (window as unknown as { streamPins: typeof watch }).streamPins = watch;
            const check = () => {
                for (const block of pane.querySelectorAll<HTMLElement>(".daily-note-block")) {
                    const now = { state: state(block), height: block.getBoundingClientRect().height };
                    const was = seen.get(block);
                    seen.set(block, now);
                    if (block.classList.contains("is-unloaded")) continue;
                    rendered.add(block.dataset.sourcePath!);
                    if (was && now.state === was.state && Math.abs(now.height - was.height) > 0.5)
                        watch.unpinned.push(`${block.dataset.sourcePath}: ${was.height} → ${now.height}`);
                }
                watch.rendered = rendered.size;
            };
            watch.tasks = new MutationObserver(check);
            watch.tasks.observe(pane, { subtree: true, childList: true, attributes: true, characterData: true });
            const frame = () => {
                if (!watch.on) return;
                check();
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        }, STREAM);
    }

    /**
     * Since `watchPins`: each height change made without re-pinning, and how
     * many notes were rendered.
     */
    stopWatchingPins(): Promise<{ unpinned: string[]; rendered: number }> {
        return this.run(() => {
            const watch = (
                window as unknown as {
                    streamPins: { unpinned: string[]; rendered: number; on: boolean; tasks: MutationObserver };
                }
            ).streamPins;
            watch.on = false;
            watch.tasks.disconnect();
            return { unpinned: watch.unpinned, rendered: watch.rendered };
        });
    }

    /**
     * The stream's place: the first note that is at least partly in the pane.
     */
    place(): Promise<Place> {
        return this.run((s: string) => {
            const pane = document.querySelector(s)!.parentElement!;
            const paneTop = pane.getBoundingClientRect().top;
            const first = [...pane.querySelectorAll<HTMLElement>(".daily-note-block")].find(
                (block) => block.getBoundingClientRect().bottom > paneTop
            )!;
            return { path: first.dataset.sourcePath!, offset: Math.round(first.getBoundingClientRect().top - paneTop) };
        }, STREAM);
    }

    /**
     * Starts recording each place the stream shows, frame by frame, as `place`
     * reads it, even before a stream is open. `places` reports them. Starts
     * `now`, or when Obsidian comes back from the background, because a stream
     * that is not moving would be done before it left.
     */
    async followPlaces(from: "now" | "return" = "now"): Promise<void> {
        await this.run(
            (s: string, start: "now" | "return") => {
                const place = () => {
                    const pane = document.querySelector(s)?.parentElement;
                    if (!pane) return undefined;
                    const paneTop = pane.getBoundingClientRect().top;
                    const first = [...pane.querySelectorAll<HTMLElement>(".daily-note-block")].find(
                        (block) => block.getBoundingClientRect().bottom > paneTop
                    );
                    return (
                        first &&
                        `${first.dataset.sourcePath}\n${Math.round(first.getBoundingClientRect().top - paneTop)}`
                    );
                };
                const seen: string[] = [];
                const returned = new Promise<void>((resolve) => {
                    const back = () =>
                        document.hidden || resolve(document.removeEventListener("visibilitychange", back));
                    document.addEventListener("visibilitychange", back);
                });
                (window as unknown as { streamPlaces: Promise<Place[]> }).streamPlaces = (async () => {
                    if (start === "return") await returned;
                    const deadline = performance.now() + 15_000;
                    for (let quiet = 0; quiet < 30 && performance.now() < deadline;) {
                        await new Promise(requestAnimationFrame);
                        const now = place();
                        if (now === undefined) continue;
                        quiet = now === seen.at(-1) ? quiet + 1 : 0;
                        seen.push(now);
                    }
                    return [...new Set(seen)].map((key) => {
                        const [path, offset] = key.split("\n");
                        return { path: path!, offset: Number(offset) };
                    });
                })();
            },
            STREAM,
            from
        );
    }

    /**
     * Each place the stream showed since `followPlaces`, once it stayed still
     * for 30 frames.
     */
    places(): Promise<Place[]> {
        return this.runAsync(() => (window as unknown as { streamPlaces: Promise<Place[]> }).streamPlaces);
    }

    /**
     * Quick thumb strokes, `up` to move down the stream, each one caught while
     * the last is still scrolling, as a reader's are. Returns once the last
     * scroll stops. Each stroke is `share` of the screen tall and takes `ms`;
     * by default, a hard flick.
     */
    async flick(direction: "up" | "down", strokes = 1, { share = 0.7, ms = 60 } = {}): Promise<void> {
        const before = await this.readerAt();
        for (let i = 0; i < strokes; i++) await this.stroke(direction, share, ms);
        await this.rest();
        const after = await this.readerAt();
        const down = after.note > before.note || (after.note === before.note && after.into > before.into);
        const up = after.note < before.note || (after.note === before.note && after.into < before.into);
        const atTop = before.note === 0 && before.into <= 0;
        const blocked = direction === "up" ? !down && !(await this.atEnd()) : !up && !atTop;
        if (blocked)
            throw new Error(
                `A flick ended no further than ${before.into} px into note ${before.note}, at ${after.into} px into note ${after.note}: the stream moved itself back, ` +
                    "or something is in front of Obsidian, such as its Face ID lock."
            );
    }

    /**
     * One stroke, and how its scrolling ended (`glide.ts`), once the pane is
     * still. A full scroll lasts 1–3.5 s. It is read on every frame from when
     * the finger lifts, so a stall can be told apart from a stop. The longest
     * stall is noted on the test. A glide cut short attaches its frames, and
     * the touches and changes from the stroke on. A stroke that never scrolled
     * the stream fails as such, not as a glide cut short.
     *
     * A glide cut short is checked against a plain page's glide at once
     * (D-184). If that is cut short too, iOS is cutting every glide, as it does
     * for a few minutes at a time on the iPad, and the stream is not to blame.
     */
    async glideEnding(
        direction: "up" | "down",
        { share = 0.7, ms = 60 } = {}
    ): Promise<GlideEnding | "cut short by iOS"> {
        const ending = await this.recordedEnding(`:has(> ${STREAM})`, direction, share, ms);
        if (ending !== "cut short") return ending;
        const plain = await this.plainPageEnding(direction, share, ms);
        base.info().annotations.push({ type: "plain page's glide", description: plain });
        return plain === "cut short" ? "cut short by iOS" : ending;
    }

    /**
     * How a stroke's glide ends on a page of plain paragraphs, over all of
     * Obsidian. Neither the plugin nor Obsidian draws it, and nothing in it
     * scrolls, which would stop a glide (ADR 0008). It is removed after the
     * stroke.
     */
    private async plainPageEnding(direction: "up" | "down", share: number, ms: number): Promise<GlideEnding> {
        await this.run(
            (s: string, down: boolean) => {
                const page = document.createElement("div");
                page.id = s.slice(1);
                page.style.cssText =
                    "position: fixed; inset: 0; z-index: 1000; overflow-y: auto; background: white; color: black";
                for (let i = 0; i < 300; i++)
                    page.append(
                        Object.assign(document.createElement("p"), {
                            textContent: `Paragraph ${i}: plain words, to give the page height.`,
                        })
                    );
                document.body.append(page);
                page.scrollTop = down ? page.scrollHeight : 0;
            },
            PLAIN_PAGE,
            direction === "down"
        );
        try {
            return await this.recordedEnding(PLAIN_PAGE, direction, share, ms);
        } finally {
            await this.run((s: string) => document.querySelector(s)?.remove(), PLAIN_PAGE);
        }
    }

    /** One stroke, and how the glide of the scroll container `pane` ended. */
    private async recordedEnding(
        pane: string,
        direction: "up" | "down",
        share: number,
        ms: number
    ): Promise<GlideEnding> {
        const before = await this.run(
            (p: string, s: string) => {
                const pane = document.querySelector<HTMLElement>(p)!;
                const stream = pane.querySelector(s);
                const glide = { heard: [] as Heard[], events: [] as GlideEvent[], done: new AbortController() };
                (window as unknown as { streamGlide: typeof glide }).streamGlide = glide;
                const signal = glide.done.signal;
                const log = (kind: string, what: string) => {
                    if (glide.events.length < 5000) glide.events.push({ at: performance.now(), kind, what });
                };
                const name = (node: Node) =>
                    node instanceof Element
                        ? `${node.tagName.toLowerCase()}.${[...node.classList].join(".")}`
                        : node.nodeName;
                for (const kind of ["touchstart", "touchmove", "touchend", "touchcancel"])
                    document.addEventListener(
                        kind,
                        (e) =>
                            log(
                                kind,
                                `${(e as TouchEvent).touches.length} at y ${(e as TouchEvent).changedTouches[0]?.clientY}`
                            ),
                        { capture: true, passive: true, signal }
                    );
                const changes = new MutationObserver((records) => {
                    for (const { type, target, attributeName } of records)
                        log(type === "childList" ? "nodes" : attributeName!, name(target));
                });
                changes.observe(pane, { subtree: true, childList: true, attributeFilter: ["class", "style"] });
                signal.addEventListener("abort", () => changes.disconnect());
                const draw = () => {
                    if (glide.done.signal.aborted) return;
                    glide.heard.push({
                        at: performance.now(),
                        top: pane.scrollTop,
                        owing: !!stream?.classList.contains("is-scroll-shifted"),
                        bottom: pane.scrollHeight - pane.clientHeight,
                    });
                    requestAnimationFrame(draw);
                };
                document.addEventListener("touchend", draw, { capture: true, signal: glide.done.signal, once: true });
                return pane.scrollTop;
            },
            pane,
            STREAM
        );
        await this.stroke(direction, share, ms);
        await this.rest();
        const { heard, events } = await this.run(() => {
            const glide = (
                window as unknown as { streamGlide: { heard: Heard[]; events: GlideEvent[]; done: AbortController } }
            ).streamGlide;
            glide.done.abort();
            return { heard: glide.heard, events: glide.events };
        });
        if (heard.length === 0) throw new Error("The stroke never lifted.");
        if (neverScrolled(before, heard))
            throw new Error(`The stroke never scrolled ${pane}, which stayed at ${before}.`);
        base.info().annotations.push({ type: "longest stall", description: `${longestStall(heard)} ms` });
        const ending = glideEnding(heard);
        // To read why, when a test fails on it.
        if (ending === "cut short")
            await base.info().attach("cut-short glide", {
                body: JSON.stringify({ frames: heard, events }),
                contentType: "application/json",
            });
        return ending;
    }

    /**
     * A quick tap on each of `points`, in the screen's points, as one gesture.
     * WebDriverAgent presses them about 30 ms apart, whatever pauses it is
     * given. Each tap uses its own finger, because one finger doing a series of
     * taps presses each tap twice.
     */
    private async pressAll(points: { x: number; y: number }[]): Promise<void> {
        if (points.length === 0) return;
        await this.perform(
            points.map(({ x, y }, i) => ({
                type: "pointer",
                id: `finger${i}`,
                parameters: { pointerType: "touch" },
                actions: [
                    { type: "pause", duration: i * 80 },
                    { type: "pointerMove", duration: 0, x: Math.round(x), y: Math.round(y) },
                    { type: "pointerDown", button: 0 },
                    { type: "pause", duration: 30 },
                    { type: "pointerUp", button: 0 },
                ],
            })),
            points.length * 30,
            // Not logged: a key shows its own bubble, as under a thumb.
            []
        );
    }

    /**
     * A slow thumb stroke up a third of the screen, starting on the middle of
     * the first `selector` a finger could reach. Returns once the stream is
     * still.
     */
    async swipeFrom(selector: string): Promise<void> {
        const at = await this.reach(selector);
        await this.native();
        const { width, height } = await this.windowSize();
        const scale = width / at.viewport;
        const start = { x: Math.round(at.x * scale), y: Math.round(at.y * scale) };
        const end = { x: start.x, y: Math.max(0, start.y - Math.round(height / 3)) };
        const ms = 300;
        await this.perform(
            [
                {
                    type: "pointer",
                    id: "thumb",
                    parameters: { pointerType: "touch" },
                    actions: [
                        { type: "pointerMove", duration: 0, ...start },
                        { type: "pointerDown", button: 0 },
                        { type: "pointerMove", duration: ms, ...end },
                        { type: "pointerUp", button: 0 },
                    ],
                },
            ],
            ms,
            [{ from: start, to: end, after: 0, ms }]
        );
        await this.rest();
    }

    /**
     * A thumb stroke `share` of the screen tall, taking `duration` ms,
     * centered. Returns as the finger lifts. Moved down onto the stream's pane
     * if it would start or end above it: an iPad's header is there, and a
     * stroke on it scrolls nothing.
     */
    private async stroke(direction: "up" | "down", share: number, duration: number): Promise<void> {
        const top = await this.paneTop();
        await this.native();
        const { width, height } = await this.windowSize();
        const [from, to] = direction === "up" ? [0.5 + share / 2, 0.5 - share / 2] : [0.5 - share / 2, 0.5 + share / 2];
        const below = Math.max(0, top + PANE_EDGE - height * Math.min(from, to));
        const x = Math.round(width / 2);
        const [start, end] = [
            { x, y: Math.round(height * from + below) },
            { x, y: Math.round(height * to + below) },
        ];
        // One command for each stroke. Within one command, WebDriverAgent drags
        // the finger back to the start between strokes, which scrolls the
        // stream back.
        await this.perform(
            [
                {
                    type: "pointer",
                    id: "thumb",
                    parameters: { pointerType: "touch" },
                    actions: [
                        { type: "pointerMove", duration: 0, ...start },
                        { type: "pointerDown", button: 0 },
                        { type: "pointerMove", duration, ...end },
                        { type: "pointerUp", button: 0 },
                    ],
                },
            ],
            duration,
            [{ from: start, to: end, after: 0, ms: duration }]
        );
    }

    private async windowSize(): Promise<{ width: number; height: number }> {
        return (this.screen ??= await this.driver.getWindowSize());
    }

    /**
     * The top of the stream's pane, in the screen's points. Read before
     * scrolling, because the web view runs no script mid-glide.
     */
    private async paneTop(): Promise<number> {
        if (this.pane !== undefined) return this.pane;
        const { top, viewport } = await this.run(
            (s: string) => ({
                top: document.querySelector(s)!.parentElement!.getBoundingClientRect().top,
                viewport: window.innerWidth,
            }),
            STREAM
        );
        return (this.pane = top * ((await this.windowSize()).width / viewport));
    }

    /**
     * Fails if iOS keeps Obsidian locked behind Face ID or Touch ID, because no
     * touch reaches the app until someone unlocks it.
     */
    async assertUnlocked(): Promise<void> {
        await this.native();
        const lock = await this.driver.$(
            // Only in English. flick() detects a lock in any language, because
            // the stream does not move.
            `-ios predicate string:label CONTAINS " ID Required" OR label BEGINSWITH "Passcode Required"`
        );
        if (await lock.isExisting())
            throw new Error("Obsidian is locked behind Face ID or Touch ID: long-press its icon → Don't Require.");
    }

    /**
     * A finger's tap, as iOS delivers it: touches, then a click. On the middle
     * of the first `selector` a finger could reach, on screen and not covered
     * by anything. `offset` moves it that many CSS pixels, for a finger that
     * misses slightly.
     */
    async tap(selector: string, offset = { x: 0, y: 0 }): Promise<void> {
        const { x, y, viewport } = await this.reach(selector);
        await this.tapAt({ x: x + offset.x, y: y + offset.y, viewport });
    }

    /**
     * Where `tap` would land on `selector`, looked up in advance, because a
     * reader's tap has no pause before it.
     */
    pointOf(selector: string): Promise<Point> {
        return this.reach(selector);
    }

    /** A tap on a point `pointOf` found. */
    tapAt(point: Point): Promise<void> {
        return this.touch(point, 50);
    }

    /**
     * A finger held for a second on the middle of the first `selector` it could
     * reach, found as `tap` finds it.
     */
    async longPress(selector: string): Promise<void> {
        await this.touch(await this.reach(selector), 1000);
    }

    /**
     * The screen as a PNG, without the status bar, whose clock changes. The web
     * view goes under the status bar.
     */
    async screenshot(): Promise<string> {
        await this.native();
        return (await this.driver.execute("mobile: viewportScreenshot")) as string;
    }

    /** Where `tap` touches for `selector`, once it stops moving. */
    private reach(selector: string): Promise<Point> {
        return this.runAsync(async (sel: string) => {
            const target = () => {
                for (const el of document.querySelectorAll(sel)) {
                    const { left, top, width, height } = el.getBoundingClientRect();
                    const [x, y] = [left + width / 2, top + height / 2];
                    const hit = document.elementFromPoint(x, y);
                    if (hit && el.contains(hit)) return { x, y, viewport: window.innerWidth };
                }
                return null;
            };
            // Where it stays still for 10 frames, because a modal slides in as
            // it opens.
            let last = "";
            for (let still = 0, frames = 0; still < 10 && frames < 120; frames++) {
                await new Promise(requestAnimationFrame);
                const now = JSON.stringify(target());
                still = now === last ? still + 1 : 0;
                last = now;
            }
            const at = target();
            if (!at) throw new Error(`Nothing to tap: no ${sel} on screen.`);
            return at;
        }, selector);
    }

    /** A finger down on `at` for `ms`, then lifted. */
    private async touch(at: Point, ms: number): Promise<void> {
        await this.native();
        // The web view fills the screen, so a CSS pixel is a point, unless the
        // page is zoomed.
        const scale = (await this.windowSize()).width / at.viewport;
        const point = { x: Math.round(at.x * scale), y: Math.round(at.y * scale) };
        await this.perform(
            [
                {
                    type: "pointer",
                    id: "finger",
                    parameters: { pointerType: "touch" },
                    actions: [
                        { type: "pointerMove", duration: 0, ...point },
                        { type: "pointerDown", button: 0 },
                        { type: "pause", duration: ms },
                        { type: "pointerUp", button: 0 },
                    ],
                },
            ],
            ms,
            [{ from: point, to: point, after: 0, ms }]
        );
    }

    /**
     * Sends Escape to `selector`, as a hardware keyboard would. It closes a
     * modal or the search bar.
     */
    async escape(selector: string): Promise<void> {
        await this.run(
            (sel: string) =>
                document
                    .querySelector(sel)!
                    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })),
            selector
        );
    }

    /** The value of the input `selector` names. */
    inputValue(selector: string): Promise<string> {
        return this.run((sel: string) => document.querySelector<HTMLInputElement>(sel)!.value, selector);
    }

    /**
     * Picks `date` (`YYYY-MM-DD`) in iOS's open calendar popup, the date
     * input's picker, and closes it with its tick button. Finds months and days
     * by their English labels, as `assertUnlocked` does.
     */
    async pickDate(date: string): Promise<void> {
        await this.native();
        const day = new Date(`${date}T12:00:00Z`);
        const month = day.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
        const shown = this.driver.$("~Month");
        await shown.waitForExist();
        for (let steps = 0; (await shown.getAttribute("value")) !== month; steps++) {
            if (steps === 24) throw new Error(`The picker never showed ${month}.`);
            const later = new Date(`1 ${await shown.getAttribute("value")} UTC`) > day;
            await this.driver.$(later ? "~DatePicker.PreviousMonth" : "~DatePicker.NextMonth").click();
        }
        const label = day.toLocaleString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
        await this.driver.$(`-ios predicate string:label ENDSWITH ", ${label}"`).click();
        await this.driver.$("~Done").click();
    }

    /**
     * What Obsidian's console has shown as an error since the last call:
     * logged, thrown or rejected.
     */
    async consoleErrors(): Promise<string[]> {
        // A timer already queued behind a busy page throws after the read.
        await this.runAsync(() => new Promise<void>((done) => setTimeout(done)));
        const entries = (await this.driver.getLogs("safariConsole")) as { level: string; message: string }[];
        return entries
            .filter(({ level }) => level === "SEVERE")
            .map(({ message }) => (JSON.parse(message) as { text: string }).text)
            .filter((text) => text !== OBSIDIANS_SANDBOX_NOTICE);
    }

    /** Whether anything matches `selector`. */
    has(selector: string): Promise<boolean> {
        return this.run((sel: string) => !!document.querySelector(sel), selector);
    }

    /**
     * The note at the pane's top, by its index in the stream, and how far into
     * it the top is. Not the scroll position: when empty blocks above get new
     * heights after scrolling stops, the scroll position moves by as much as
     * they change (ADR 0014), but the reader does not move at all.
     */
    private readerAt(): Promise<{ note: number; into: number }> {
        return this.run((s: string) => {
            const pane = document.querySelector(s)!.parentElement!;
            const paneTop = pane.getBoundingClientRect().top;
            const blocks = [...pane.querySelectorAll<HTMLElement>(".daily-note-block")];
            const note = blocks.findIndex((block) => block.getBoundingClientRect().bottom > paneTop);
            return { note, into: Math.round(paneTop - blocks[note]!.getBoundingClientRect().top) };
        }, STREAM);
    }

    scrollTop(): Promise<number> {
        return this.run((s: string) => document.querySelector(s)!.parentElement!.scrollTop, STREAM);
    }

    /** How far the newest note's top is below the pane's top. */
    newestOffset(): Promise<number> {
        return this.run((s: string) => {
            const stream = document.querySelector(s)!;
            const newest = stream.querySelector(".daily-note-block")!.getBoundingClientRect().top;
            return Math.round(newest - stream.parentElement!.getBoundingClientRect().top);
        }, STREAM);
    }

    async orientation(): Promise<Orientation> {
        await this.native();
        return (await this.driver.getOrientation()) as Orientation;
    }

    /**
     * Returns once the pane has its new width and is still. A turn starts a few
     * frames after it is asked for. If the screen is already turned that way,
     * it does nothing.
     */
    async turn(orientation: Orientation): Promise<void> {
        if ((await this.orientation()) === orientation) return;
        const width = () => this.run((s: string) => document.querySelector(s)!.parentElement!.clientWidth, STREAM);
        const before = await width();
        await this.native();
        await this.driver.setOrientation(orientation);
        this.screen = undefined;
        this.pane = undefined;
        this.keyboards.clear();
        await expect.poll(width).not.toBe(before);
        await this.rest();
    }

    /**
     * Scrolls so the pane's top is `depth` px into the first `target` at least
     * a screen down the stream, or, with a negative `depth`, that far above it.
     * Then waits for it to stay still there. Only notes near the screen are
     * rendered (ADR 0006), so it moves a screen at a time until one is found.
     * If the target names a block, which is always in the stream, it goes there
     * at once. What is rendered, such as a Base filling in above the target,
     * may move it, so it scrolls again until the target is where it was put.
     */
    async placeAt(target: string, depth: number): Promise<void> {
        const block = blockOf(target);
        // Or to the stream's end, until the batch with the block loads.
        for (let found = block === undefined; !found;) {
            found = await this.run(
                (s: string, b: string) => {
                    const pane = document.querySelector(s)!.parentElement!;
                    const top = (el: Element) => el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
                    const el = [...pane.querySelectorAll(b)].find((e) => top(e) + pane.scrollTop > pane.clientHeight);
                    pane.scrollTop = el ? pane.scrollTop + top(el) : pane.scrollHeight;
                    return el !== undefined;
                },
                STREAM,
                block!
            );
            await this.rest();
            if (!found && (await this.atEnd())) break;
        }
        for (let steps = 0; steps < SCREENS; steps++) {
            const off = await this.run(
                (s: string, t: string, d: number) => {
                    const stream = document.querySelector(s)!;
                    const pane = stream.parentElement!;
                    const top = (el: Element) => el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
                    const el = [...stream.querySelectorAll(t)].find((e) => top(e) + pane.scrollTop > pane.clientHeight);
                    const off = el ? top(el) + d : null;
                    if (off === null || Math.abs(off) > 1) pane.scrollTop += off ?? pane.clientHeight;
                    return off;
                },
                STREAM,
                target,
                depth
            );
            // Already there after a step while still: nothing moved, so there
            // is nothing to wait for.
            if (off !== null && Math.abs(off) <= 1) return;
            await this.rest();
            // Or as close as the pane can scroll: a target near the stream's
            // end cannot reach the pane's top.
            if (off !== null && (await this.atEnd())) return;
        }
        throw new Error(`Could not hold the pane's top at ${target} in ${SCREENS} screens.`);
    }

    /** Whether a `selector` crosses the pane's top edge. */
    atTop(selector: string): Promise<boolean> {
        return this.run(
            (s: string, sel: string) => {
                const stream = document.querySelector(s)!;
                const top = stream.parentElement!.getBoundingClientRect().top;
                return [...stream.querySelectorAll(sel)].some((el) => {
                    const box = el.getBoundingClientRect();
                    return box.top <= top && box.bottom > top;
                });
            },
            STREAM,
            selector
        );
    }

    /** Scrolled to the bottom with nothing left to load. */
    atEnd(): Promise<boolean> {
        return this.run((s: string) => {
            const pane = document.querySelector(s)!.parentElement!;
            return pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
        }, STREAM);
    }

    /**
     * What the reader sees at the pane's top: the first part of the top note
     * still in view, by its text, and how far its top is from the pane's top. A
     * turn reflows the note, so the note's own position says nothing about
     * which text is in view. Follow it with `topOf`.
     */
    seen(): Promise<Seen> {
        return this.run(
            (s: string, kinds: string[]) => {
                const stream = document.querySelector(s)!;
                const pane = stream.parentElement!.getBoundingClientRect();
                for (const note of stream.querySelectorAll<HTMLElement>(".daily-note-block")) {
                    if (note.getBoundingClientRect().bottom <= pane.top) continue;
                    const el = [...note.querySelectorAll<HTMLElement>(kinds.join(", "))].find(
                        (b) => b.getBoundingClientRect().bottom > pane.top
                    );
                    if (!el) continue;
                    const kind = kinds.find((k) => el.matches(k))!;
                    const index = [...note.querySelectorAll(kind)].indexOf(el);
                    const top = Math.round(el.getBoundingClientRect().top - pane.top);
                    const text = el.innerText.trim().slice(0, 60);
                    return { path: note.dataset.sourcePath!, kind, index, text, top };
                }
                throw new Error("No text in view.");
            },
            STREAM,
            TEXT_KINDS
        );
    }

    /**
     * Where `seen`'s part is now, from the pane's top. Found by its position in
     * the note, because a Base renders its text again when the screen turns.
     */
    topOf(seen: Seen): Promise<number> {
        return this.run(
            (s: string, { path, kind, index, text }: Seen) => {
                const stream = document.querySelector(s)!;
                const note = stream.querySelector(`.daily-note-block[data-source-path="${CSS.escape(path)}"]`)!;
                const el = note.querySelectorAll<HTMLElement>(kind)[index];
                if (!el) throw new Error(`"${text}" is gone from ${path}.`);
                return Math.round(el.getBoundingClientRect().top - stream.parentElement!.getBoundingClientRect().top);
            },
            STREAM,
            seen
        );
    }

    /**
     * Waits until the pane has been still for half a second, so scrolling,
     * turning and the loads they start are over. The stream's shift counts: a
     * note above that grows once the scroll is still is owed until the stream
     * hands it over, without changing the scroll. Fails if it is still moving
     * after 10 s.
     */
    async rest(): Promise<void> {
        const moving = await this.runAsync(async (s: string) => {
            const stream = document.querySelector<HTMLElement>(s)!;
            const pane = stream.parentElement!;
            let last = "";
            let stillSince = performance.now();
            for (const deadline = performance.now() + 10_000; performance.now() < deadline;) {
                await new Promise(requestAnimationFrame);
                const shift = stream.style.getPropertyValue("--daily-notes-scroll-shift");
                const now = `scroll ${pane.scrollTop}, height ${pane.scrollHeight}, width ${pane.clientWidth}, shift ${shift || 0}`;
                if (now !== last) [last, stillSince] = [now, performance.now()];
                else if (performance.now() - stillSince > 500) return null;
            }
            return last;
        }, STREAM);
        if (moving !== null) throw new Error(`The stream is still moving after 10 s, last at ${moving}.`);
    }

    private async inWebView(): Promise<void> {
        const contexts = (await this.driver.getContexts()) as string[];
        const webView = contexts.find((c) => c.startsWith("WEBVIEW"));
        if (!webView) throw new Error(`Obsidian's web view is not inspectable: ${contexts.join(", ")}`);
        if ((await this.driver.getContext()) !== webView) await this.driver.switchContext(webView);
    }

    private async native(): Promise<void> {
        if ((await this.driver.getContext()) !== "NATIVE_APP") await this.driver.switchContext("NATIVE_APP");
    }
}

export const test = base.extend<{ quietConsole: void }, { phone: Phone }>({
    // Errors during a test fail it, wherever they appear, so no check has to
    // ask for them.
    quietConsole: [
        async ({ phone }, use) => {
            await use();
            expect(await phone.consoleErrors(), "errors in Obsidian's console").toEqual([]);
        },
        { auto: true },
    ],
    phone: [
        async ({}, use) => {
            const driver = await connect();
            // Otherwise WebDriverAgent waits after each gesture for animations
            // to end, which takes 15 s in Obsidian. rest() waits for the stream
            // instead.
            await driver.updateSettings({ animationCoolOffTimeout: 0, waitForIdleTimeout: 0 });
            const phone = new Phone(driver);
            // An iPad is used in landscape, and an iPhone upright. The run
            // leaves it as it found it.
            const found = (await driver.getOrientation()) as Orientation;
            try {
                await phone.assertUnlocked();
                await useVault(phone);
                expect(await phone.consoleErrors(), "errors in Obsidian's console, opening the vault").toEqual([]);
                await use(phone);
            } finally {
                await driver.setOrientation(found);
                // Leave the phone as the tester left it: their vault, Obsidian
                // closed, and the Home Screen showing.
                await returnToTestersVault(phone);
                await driver.execute("mobile: terminateApp", { bundleId: OBSIDIAN });
                await driver.execute("mobile: pressButton", { name: "home" });
                await driver.updateSettings(keyboardAfterRun(process.env));
                await driver.deleteSession();
            }
        },
        // Creating and indexing a five-year vault takes longer than a test's
        // timeout.
        { scope: "worker", timeout: 900_000 },
    ],
});

export { expect };
