import { test as base, expect } from "@playwright/test";
import { drivesIPad } from "./device";
import { glideEnding, longestStall, type GlideEnding, type Heard } from "./glide";
import { keyboardAfterRun } from "./keyboard";
import { connect, OBSIDIAN } from "./session";
import { returnToTestersVault, useVault } from "./vault";

/**
 * Obsidian on a USB-connected iPhone (ADR 0016). Touches are real ones, sent
 * through WebDriverAgent, so a flick glides as a thumb's does; what the stream
 * did is read from Obsidian's web view.
 */

const STREAM = ".daily-notes-stream-container";

export type Orientation = "PORTRAIT" | "LANDSCAPE";
type Layer = "letters" | "numbers";
/** What a key's name escapes in the screen's XML, `&amp;` last. */
const XML_ENTITIES = [
    ["&quot;", '"'],
    ["&apos;", "'"],
    ["&lt;", "<"],
    ["&gt;", ">"],
    ["&amp;", "&"],
] as const;
type Seen = { path: string; kind: string; index: number; text: string; top: number };
/** A point in the web view, in CSS pixels, and the viewport's width they are measured against. */
export type Point = { x: number; y: number; viewport: number };
/** A touch the harness sent: from where to where, in the screen's points, and when, in Unix ms, for how long. */
export type SentTouch = { from: { x: number; y: number }; to: { x: number; y: number }; start: number; ms: number };
/** Where the stream is, as it keeps its place: a note, and its top's offset from the pane's. */
export type Place = { path: string; offset: number };

/** How far inside the pane's top a stroke stays, clear of the header above it. */
const PANE_EDGE = 20;

/** How long to wait for iOS's keyboard to appear. If it has not appeared by then, a keyboard is attached. */
const KEYBOARD_RISE = 5_000;

/** XCTest's code for the Right Arrow key. Pressing it in an input types nothing. */
const RIGHT_ARROW = "\uF703";

/** How far `placeAt` looks: past the first two batches of the harness's notes, some 20 screens each. */
const SCREENS = 60;

/**
 * A note's blocks as the reader takes them in: its title, property rows,
 * Markdown blocks and mentions. A block is known by its place among its own
 * kind: a property added, or a hidden run's spacer, moves no other kind's.
 */
const TEXT_KINDS = [
    ".daily-note-title",
    ".metadata-property",
    // Not a Base: it redraws its rows as it scrolls, and its text, changed, reads as a blank.
    ".daily-note-content > :not(.daily-note-far-run, .daily-note-base)",
    ".daily-note-mention",
];

/** The `.daily-note-block` selector `target` starts with, if any: up to the first space outside brackets. */
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
 * iOS's WebKit does not know. Its own reading view logs this, the stream closed.
 */
const OBSIDIANS_SANDBOX_NOTICE =
    "Error while parsing the 'sandbox' attribute: 'allow-presentation' is an invalid sandbox flag.";

export class Phone {
    /** WebDriverAgent takes up to half a second to answer, more during a glide; it changes only on a turn. */
    private screen: { width: number; height: number } | undefined;
    /** Where the stream's pane starts on the screen; changes only on a turn. */
    private pane: number | undefined;
    /** Each touch sent since `logTouches`, or none kept. */
    private sent: SentTouch[] | null = null;
    /** Where the keyboard's keys are, by layout; changes only on a turn. */
    private readonly keyboards = new Map<Layer, Map<string, { x: number; y: number }>>();

    constructor(private readonly driver: WebdriverIO.Browser) {}

    /** Starts keeping each touch sent, for `sentTouches`: a recording draws them. */
    logTouches(): void {
        this.sent = [];
    }

    sentTouches(): SentTouch[] {
        return this.sent ?? [];
    }

    /** The screen's size in points, what touches are measured in. */
    screenSize(): Promise<{ width: number; height: number }> {
        return this.windowSize();
    }

    /**
     * Sends `actions`, logging `touches` if kept: each `after` ms into a
     * gesture `length` ms long, which ended as the command returned.
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

    /** Runs `fn` in Obsidian's web view; like Playwright's `evaluate`, it closes over nothing. */
    async run<R, A extends unknown[]>(fn: (...args: A) => R, ...args: A): Promise<R> {
        await this.inWebView();
        return (await this.driver.execute(`return (${fn.toString()})(...arguments)`, ...args)) as R;
    }

    /** `run` for a function that settles later. */
    async runAsync<R, A extends unknown[]>(fn: (...args: A) => Promise<R>, ...args: A): Promise<R> {
        await this.inWebView();
        // A rejection has to answer too, or the driver waits out its script
        // timeout. Not as `error`: WebdriverIO takes that key for its own.
        const script = `const done = arguments[arguments.length - 1];
            (${fn.toString()})(...arguments[0]).then((value) => done({ value }), (e) => done({ failure: String(e) }));`;
        const { value, failure } = (await this.driver.executeAsync(script, args)) as { value: R; failure?: string };
        if (failure !== undefined) throw new Error(`On the phone: ${failure}\nin: ${fn.toString().slice(0, 200)}`);
        return value;
    }

    /** Opens `url` as a tapped link would, in whatever app claims it. */
    async openUrl(url: string): Promise<void> {
        await this.native();
        await this.driver.execute("mobile: deepLink", { url, bundleId: OBSIDIAN });
    }

    /** The bundle id of the app in front: another one once a tap leaves Obsidian. */
    async frontApp(): Promise<string> {
        await this.native();
        return ((await this.driver.execute("mobile: activeAppInfo")) as { bundleId: string }).bundleId;
    }

    /** Back into Obsidian from whatever app is in front, as from its icon. */
    async returnToObsidian(): Promise<void> {
        await this.native();
        await this.driver.execute("mobile: activateApp", { bundleId: OBSIDIAN });
    }

    /**
     * Whether iOS shows its on-screen keyboard. With a hardware keyboard
     * attached, iOS sometimes says its keyboard is shown when it is not.
     */
    async keyboardShown(): Promise<boolean> {
        await this.native();
        if (!(await this.driver.isKeyboardShown())) return false;
        const { y } = await this.driver.$("-ios class chain:**/XCUIElementTypeKeyboard").getLocation();
        return y < (await this.windowSize()).height;
    }

    /**
     * Waits for iOS's on-screen keyboard to appear. When a keyboard is
     * attached to an iPad, iOS hides its own. Pressing one key through
     * XCTest makes iOS show it again, and it stays shown until the keyboard
     * is detached and attached again. So if the keyboard has not appeared,
     * this presses Right Arrow on an iPad.
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
     * `text` typed on iOS's on-screen keyboard, a finger on each key; a
     * newline is Return. Shift is never pressed: a letter takes the case iOS
     * gives it, as it would a reader's. Keys go `burst` to a gesture: one
     * gesture lands its keys some 30 ms apart, and each costs a round trip of
     * about 560 ms, so 2 types in pairs, at about a reader's pace. Each key is
     * held 30 ms: held past the next key's landing, iOS types extra letters.
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
            // An unread layout is read off the screen, so it must be showing.
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
                // Alone: a key landing while it is still held goes to the old layout.
                await flush();
                layer = layer === "letters" ? "numbers" : "letters";
                keys = await keysOf(layer);
            }
            const key = keys.get(name);
            if (!key) throw new Error(`No ${JSON.stringify(char)} key on iOS's keyboard.`);
            taps.push(key);
            // Either can take iOS from its digits back to its letters.
            if (layer === "numbers" && (char === " " || char === "\n")) {
                await flush();
                layer = await this.keyboardLayer();
            }
        }
        await flush();
    }

    /** Which of its layouts the keyboard shows: letters, or digits and punctuation. */
    private async keyboardLayer(): Promise<Layer> {
        const q = await this.driver.$('-ios predicate string:type == "XCUIElementTypeKey" AND name ==[c] "q"');
        return (await q.isExisting()) ? "letters" : "numbers";
    }

    /** Where each key of a layout is, by name, letters in lower case: read once, from one dump of the screen. */
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

    /** To the Home Screen for `seconds`, then back into Obsidian, as a reader switching apps. */
    async background(seconds: number): Promise<void> {
        await this.native();
        await this.driver.execute("mobile: backgroundApp", { seconds });
    }

    /** Quits Obsidian and opens it again, as from its icon; returns once the plugin is loaded. */
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

    /** The path of the daily note `days` back from today, as the test vault names it. */
    journalPath(days: number): Promise<string> {
        return this.run(
            (days: number) => `Journal/${new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA")}.md`,
            days
        );
    }

    /** Writes `text` to the note at `path`, once indexed; returns what it held, null where it was new. */
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

    /** Puts back what `writeNote` returned: the note's text, or no note. */
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

    /** Closes the stream and forgets every note's measured height: an open stream lays out by estimates. */
    async forgetHeights(): Promise<void> {
        await this.run(() => {
            window.app.workspace.detachLeavesOfType("daily-notes-stream-view");
            window.app.plugins.plugins["daily-notes-stream"].layoutMemory.notes.restore(null);
        });
    }

    /**
     * Shortens every unrendered note's placeholder, then waits for rest.
     * Measured on an earlier run, a placeholder is exact and a render moves
     * nothing; short, every note grows as it renders: the case that jumped.
     */
    async shortenPlaceholders(): Promise<void> {
        await this.run(() => {
            for (const block of document.querySelectorAll<HTMLElement>(".daily-note-block.is-unloaded"))
                block.style.setProperty("--daily-note-placeholder-height", "100px");
        });
        await this.rest();
    }

    /**
     * The stream, opened afresh, at its top and at rest. Reopened, not
     * scrolled there: a scroll written to the top leaves the anchor holding a
     * place from below (D-142).
     */
    async openStream(): Promise<void> {
        await this.run(() => {
            // A pull past the top, as a flick up the stream can end, opens Obsidian's command palette.
            for (const modal of document.querySelectorAll<HTMLElement>(".modal-container .modal-bg")) modal.click();
            window.app.workspace.detachLeavesOfType("daily-notes-stream-view");
        });
        // Opened in the same task as the close, it never drew.
        await this.run(() => window.app.commands.executeCommandById("daily-notes-stream:open-stream"));
        await expect
            .poll(() => this.run((s: string) => document.querySelectorAll(`${s} .daily-note-block`).length, STREAM))
            .toBeGreaterThan(0);
        await this.rest();
    }

    /** As the jump modal would, to the newest note on or before `date` (`YYYY-MM-DD`), at rest. */
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
     * Starts following the text at or just below the pane's middle, each frame, as the
     * reader's eye would; `stopFollowing` reports it. By its place in its
     * note, as `topOf` finds it: a note may render again under the reader.
     * Text that leaves the screen hands the eye to the text then at the
     * middle; a blank where it was on screen is a drift of NaN. Also read as
     * the page hears a scroll, before the stream answers it: iOS glides on
     * unheard, and a frame's read held that step and the stream's answer as one.
     */
    async followReader(): Promise<void> {
        await this.run(
            (s: string, kinds: string[]) => {
                const blocks = kinds.join(", ");
                const pane = document.querySelector(s)!.parentElement!;
                const box = pane.getBoundingClientRect();
                const middle = box.top + box.height / 2;
                const onScreen = (el: Element) => {
                    const { top, bottom } = el.getBoundingClientRect();
                    return bottom > box.top && top < box.bottom;
                };
                // A scroll the text does not follow on screen is none of the reader's: the
                // anchor's hand-over (ScrollAnchor), or a leap no one has traced yet.
                let unseen = 0;
                let lastScroll = pane.scrollTop;
                /** The glide's last step, as the page heard it. */
                let glide = 0;
                /**
                 * Written by the stream, not glided: the text stayed, or a write
                 * against the glide carried it on one step at most, as a stop
                 * does, iOS having drawn that step already (`ScrollAnchor.stopGlide`).
                 */
                const written = (step: number, moved: number) =>
                    Math.abs(moved) <= 1 ||
                    (Math.sign(step) === -Math.sign(glide) &&
                        Math.sign(moved) === -Math.sign(glide) &&
                        Math.abs(moved) <= Math.abs(glide) + 1);
                const scrolled = () => pane.scrollTop - unseen;
                const pick = () => {
                    const at = [...pane.querySelectorAll(blocks)].find(
                        (el) => el.getBoundingClientRect().bottom > middle
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
                    };
                };
                let eye = pick();
                if (!eye) throw new Error("No text at or below the pane's middle.");
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
                /** Reads where the text is; false once there is no text to follow. */
                const read = (): boolean => {
                    if (!follow.on || !eye) return false;
                    const scroll = pane.scrollTop;
                    const step = scroll - lastScroll;
                    lastScroll = scroll;
                    follow.rendered = Math.max(follow.rendered, follow.unloaded - unloaded());
                    const block = pane.querySelector(`.daily-note-block[data-source-path="${eye.path}"]`);
                    const at = block?.querySelectorAll(eye.kind)[eye.index];
                    // Another block in its place: its note is drawing again, short of it so far.
                    const text = at?.textContent === eye.text ? at : null;
                    if (!text) {
                        // Its note on screen without it: a blank where the reader was, until it is back.
                        if (block && onScreen(block)) follow.drifts.push(NaN);
                        else eye = pick();
                        return true;
                    }
                    // Where the text is, against where the scroll alone puts it.
                    const top = text.getBoundingClientRect().top;
                    const moved = top - eye.last;
                    eye.last = top;
                    if (Math.abs(step) > 1 && written(step, moved)) unseen += step + moved;
                    else if (Math.abs(step) > 1) glide = step;
                    follow.drifts.push(Math.round(top - eye.start - (eye.from - scrolled())));
                    // Where the text is on screen, as a still reader sees it.
                    follow.moves.push(Math.round(top - eye.start));
                    if (!onScreen(text)) eye = pick();
                    return true;
                };
                const frame = () => read() && requestAnimationFrame(frame);
                requestAnimationFrame(frame);
                // Captured on the document: before the pane's own listeners, the stream's among them.
                document.addEventListener("scroll", (event) => event.target === pane && read(), {
                    capture: true,
                    signal: follow.heard.signal,
                });
            },
            STREAM,
            TEXT_KINDS
        );
    }

    /**
     * Since `followReader`, each read: how far the text moved other than
     * with the scroll (`drifts`, for a glide), and on screen (`moves`, for a
     * still reader); and how many notes rendered.
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
     * Starts watching each rendered note's height, as a task ends and each
     * frame; `stopWatchingPins` reports a change made with no re-pin or
     * unload beside it (ADR 0013). Also counts the notes seen rendered.
     */
    async watchPins(): Promise<void> {
        await this.run((s: string) => {
            const pane = document.querySelector(s)!.parentElement!;
            /** What only a re-pin or an unload changes. */
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

    /** Since `watchPins`: each height change made with no re-pin, and how many notes rendered. */
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

    /** The stream's place: the first note reaching into the pane. */
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
     * Starts noting each place the stream shows, frame by frame, as `place`
     * reads it, even before a stream is open; `places` reports them. From
     * `now`, or from Obsidian's return from the background: a still stream
     * would be done before it left.
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

    /** Each place the stream showed since `followPlaces`, once it held still 30 frames. */
    places(): Promise<Place[]> {
        return this.runAsync(() => (window as unknown as { streamPlaces: Promise<Place[]> }).streamPlaces);
    }

    /**
     * Quick thumb strokes, `up` to move down the stream, each caught mid-glide
     * by the next as a reader's are; returns once the last glide stops. Each
     * `share` of the screen tall over `ms`: by default a hard flick.
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
     * One stroke, and how its glide ended (`glide.ts`), once the pane is
     * still: a full glide runs 1–3.5 s. Read every frame from the lift, so a
     * stall is told from a stop; the longest is noted on the test.
     */
    async glideEnding(direction: "up" | "down", { share = 0.7, ms = 60 } = {}): Promise<GlideEnding> {
        await this.run((s: string) => {
            const stream = document.querySelector(s)!;
            const pane = stream.parentElement!;
            const glide = { heard: [] as Heard[], done: new AbortController() };
            (window as unknown as { streamGlide: typeof glide }).streamGlide = glide;
            const draw = () => {
                if (glide.done.signal.aborted) return;
                glide.heard.push({
                    at: performance.now(),
                    top: pane.scrollTop,
                    owing: stream.classList.contains("is-scroll-shifted"),
                    bottom: pane.scrollHeight - pane.clientHeight,
                });
                requestAnimationFrame(draw);
            };
            document.addEventListener("touchend", draw, { capture: true, signal: glide.done.signal, once: true });
        }, STREAM);
        await this.stroke(direction, share, ms);
        await this.rest();
        const heard = await this.run(() => {
            const glide = (window as unknown as { streamGlide: { heard: Heard[]; done: AbortController } }).streamGlide;
            glide.done.abort();
            return glide.heard;
        });
        if (heard.length === 0) throw new Error("The stroke never lifted.");
        base.info().annotations.push({ type: "longest stall", description: `${longestStall(heard)} ms` });
        return glideEnding(heard);
    }

    /**
     * A quick tap on each of `points`, in the screen's points, as one gesture:
     * WebDriverAgent lands them some 30 ms apart, whatever pauses it is given.
     * A finger each: it lands every tap twice in one finger's chain of them.
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
            // Unlogged: a key shows its own bubble, as under a thumb.
            []
        );
    }

    /**
     * An unhurried thumb stroke up a third of the screen, starting on the
     * middle of the first `selector` a finger could reach; returns once the
     * stream holds still.
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
     * A thumb stroke `share` of the screen tall over `duration` ms, centred;
     * returns as the finger lifts. Moved down onto the stream's pane if it
     * would start or end above it: an iPad's header sits there, where a
     * stroke scrolls nothing.
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
        // One command per stroke: within one, WebDriverAgent drags the finger
        // back to the start between strokes, scrolling the stream back.
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

    /** The top of the stream's pane, in the screen's points: read before a glide, whose web view runs no script. */
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

    /** Fails if iOS holds Obsidian behind Face ID or Touch ID: no touch reaches the app until someone unlocks it. */
    async assertUnlocked(): Promise<void> {
        await this.native();
        const lock = await this.driver.$(
            // In English only; flick() catches a lock in any language by the stream not moving.
            `-ios predicate string:label CONTAINS " ID Required" OR label BEGINSWITH "Passcode Required"`
        );
        if (await lock.isExisting())
            throw new Error("Obsidian is locked behind Face ID or Touch ID: long-press its icon → Don't Require.");
    }

    /**
     * A finger's tap, as iOS delivers one: touches, then a click. On the
     * middle of the first `selector` a finger could reach there, on screen
     * and under nothing else; `offset` CSS pixels from it, for a finger off
     * the mark.
     */
    async tap(selector: string, offset = { x: 0, y: 0 }): Promise<void> {
        const { x, y, viewport } = await this.reach(selector);
        await this.tapAt({ x: x + offset.x, y: y + offset.y, viewport });
    }

    /** Where `tap` would land on `selector`, looked up ahead: a reader's tap has no pause before it. */
    pointOf(selector: string): Promise<Point> {
        return this.reach(selector);
    }

    /** A tap on a point `pointOf` found. */
    tapAt(point: Point): Promise<void> {
        return this.touch(point, 50);
    }

    /** A finger held on the middle of the first `selector` it could reach, as `tap` finds it, for a second. */
    async longPress(selector: string): Promise<void> {
        await this.touch(await this.reach(selector), 1000);
    }

    /** The screen as a PNG, the status bar, whose clock ticks, left out: the web view runs under it. */
    async screenshot(): Promise<string> {
        await this.native();
        return (await this.driver.execute("mobile: viewportScreenshot")) as string;
    }

    /** Where `tap` touches for `selector`, once it holds still. */
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
            // Where it holds still for 10 frames: a modal slides in as it opens.
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
        // The web view fills the screen, so a CSS pixel is a point, scaled only if the page is zoomed.
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

    /** Escape, as a hardware keyboard sends it, at `selector`: what closes a modal or the search bar. */
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
     * Picks `date` (`YYYY-MM-DD`) in iOS's open calendar popover, the date
     * input's picker, and closes it with its checkmark. Finds months and
     * days by their English labels, as `assertUnlocked` does.
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

    /** What Obsidian's console has shown as an error since last asked: logged, thrown or rejected. */
    async consoleErrors(): Promise<string[]> {
        // A timer already queued, behind a busy page, throws after the read.
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
     * The note at the pane's top, by its index in the stream, and how far
     * into it the top is. Not the scroll: placeholders above re-reserved at
     * rest move it by as much as they change (ADR 0014), the reader not at all.
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

    /** How far the newest note's top sits below the pane's. */
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
     * Returns once the pane has its new width and holds still: a turn starts
     * some frames after it is asked for. Already so turned, it does nothing.
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
     * Scrolls the pane's top `depth` px into the first `target` at least a
     * screen down the stream, or with a negative `depth` that far above it,
     * and waits for it to hold still there. Only notes near the screen are
     * rendered (ADR 0006), so it goes a screen at a time until one is, or at
     * once to the target's block, always in the stream, when the target
     * names one; and what renders, a Base filling above the target, may move
     * it, so it scrolls again until the target is where it was put.
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
            // Already there, from a step at rest: nothing moved, so nothing to wait out.
            if (off !== null && Math.abs(off) <= 1) return;
            await this.rest();
            // Or as near as the pane scrolls: a target near the stream's end cannot reach its top.
            if (off !== null && (await this.atEnd())) return;
        }
        throw new Error(`Could not hold the pane's top at ${target} in ${SCREENS} screens.`);
    }

    /** Whether a `selector` spans the pane's top edge. */
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
     * What the reader sees at the pane's top: the first of the top note's
     * blocks still in view, by its text, and how far its top is from the
     * pane's. A turn reflows the note, so the note's own offset says nothing
     * about which text is in view; follow it with `topOf`.
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

    /** Where `seen`'s block is now, from the pane's top: found by its place in the note, since a Base redraws its text on a turn. */
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

    /** Until the pane has held still for half a second: a glide, a turn and the loads they set off are over. */
    rest(): Promise<void> {
        return this.runAsync(async (s: string) => {
            const pane = document.querySelector(s)!.parentElement!;
            let last = "";
            let stillSince = performance.now();
            for (const deadline = performance.now() + 10_000; performance.now() < deadline;) {
                await new Promise(requestAnimationFrame);
                const now = `${pane.scrollTop} ${pane.scrollHeight} ${pane.clientWidth}`;
                if (now !== last) [last, stillSince] = [now, performance.now()];
                else if (performance.now() - stillSince > 500) return;
            }
        }, STREAM);
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
    // Errors in a test fail it, wherever they surface: no check has to ask.
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
            // WebDriverAgent otherwise waits after each gesture for animations
            // to end, 15 s in Obsidian; rest() waits for the stream instead.
            await driver.updateSettings({ animationCoolOffTimeout: 0, waitForIdleTimeout: 0 });
            const phone = new Phone(driver);
            // An iPad is read in landscape, an iPhone upright: the run leaves it as it found it.
            const found = (await driver.getOrientation()) as Orientation;
            try {
                await phone.assertUnlocked();
                await useVault(phone);
                expect(await phone.consoleErrors(), "errors in Obsidian's console, opening the vault").toEqual([]);
                await use(phone);
            } finally {
                await driver.setOrientation(found);
                // The phone as the tester left it: their vault, Obsidian closed, the Home Screen.
                await returnToTestersVault(phone);
                await driver.execute("mobile: terminateApp", { bundleId: OBSIDIAN });
                await driver.execute("mobile: pressButton", { name: "home" });
                await driver.updateSettings(keyboardAfterRun(process.env));
                await driver.deleteSession();
            }
        },
        // Seeding and indexing a five-year vault outlast a test's timeout.
        { scope: "worker", timeout: 900_000 },
    ],
});

export { expect };
