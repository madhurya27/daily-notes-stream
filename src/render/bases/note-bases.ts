import { App, Component, type Debouncer, MarkdownRenderer, TAbstractFile, TFile, debounce, setIcon } from "obsidian";
import { HOLD_LIMIT_MS, SETTLE_MS } from "../../stream/height-hold";
import { baseDigest, type BaseKey, type BaseMeasurements } from "./base-measurements";
import { layoutOf } from "../../stream/layout-memory";
import { asCards, BASE_SLOT_CLASS, type BaseSource } from "./bases-as-cards";
import { fitBaseToWidth, laidOutWidth } from "./bases-fit";
import { narrowestTableWidth, type HeaderMetrics } from "./bases-width";
import type { WidthWatch } from "../note-widths";

/**
 * Bases' largest card size: one card fills a whole row in any note wide enough
 * for it (D-157).
 */
const ONE_PER_ROW_CARD_SIZE = 800;

/**
 * Sent when a Base sets its height, so its note re-pins in the same task (ADR
 * 0013).
 */
export const BASE_RESIZED = "daily-notes-base-resized";

declare global {
    interface HTMLElementEventMap {
        [BASE_RESIZED]: Event;
    }
}

/**
 * A note's Bases. Each is rendered into its own placeholder as a table, or as
 * cards when the table is wider than the note, the same rule a Markdown table
 * follows (D-033). If the headers alone are wider than the note, cards are
 * rendered at once. Otherwise the table is rendered, measured when it is first
 * laid out, and re-rendered on its own if needed. The result is kept for each
 * Base and layout, so a note that comes back, or another note holding the same
 * Base, is rendered only once (D-194).
 *
 * Bases fills a view after rendering it, and fills it again on a live update.
 * So a Base is held at the height it showed until it stops changing; otherwise
 * the text below jumps away and back. A Base that comes back into view is held
 * by its note.
 */
export class NoteBases {
    /** Undefined until the first Base. Null when nothing could be measured. */
    private headers: HeaderMetrics | null | undefined;
    private readonly slots = new WeakMap<Element, BaseSlot>();
    /**
     * Embedded Bases in rendered notes, by the path of the Base file they copy.
     */
    private readonly copies = new Map<string, Set<BaseSlot>>();

    constructor(
        private readonly app: App,
        private readonly measured: BaseMeasurements,
        private readonly widths: WidthWatch,
        private readonly oneCardPerRow: () => boolean,
        /** jsdom has no layout, so tests replace this function to measure. */
        private readonly measureHeaders: (host: HTMLElement) => HeaderMetrics | null = measureHeaderMetrics
    ) {}

    /**
     * Draws each of `sources` into the placeholder that `extractBases` left for
     * it.
     */
    async render(contentEl: HTMLElement, file: TFile, noteComponent: Component, sources: BaseSource[]): Promise<void> {
        const placeholders = Array.from(contentEl.querySelectorAll<HTMLElement>(`.${BASE_SLOT_CLASS}`));
        if (placeholders.length === 0) return;
        if (this.headers === undefined) this.headers = this.measureHeaders(contentEl);

        const slots: BaseSlot[] = [];
        const width = contentEl.clientWidth;
        for (const [i, placeholder] of placeholders.entries()) {
            const source = sources[i]!;
            const base = source.kind === "embed" ? this.resolveBase(source.link, file) : null;
            const definition = base ? await this.app.vault.cachedRead(base) : blockDefinition(source);
            const cardSize = this.oneCardPerRow() ? ONE_PER_ROW_CARD_SIZE : undefined;
            const slot = new BaseSlot(
                this.app,
                contentEl,
                placeholder,
                file,
                noteComponent,
                source,
                cardSize,
                definition
            );
            this.slots.set(placeholder, slot);
            if (base) this.track(base.path, slot, noteComponent);
            slots.push(slot);
            await slot.draw(this.wantsCards(slot, width) ? "cards" : "table");
        }
        // If it were drawn again inside the report, an emptied Base would
        // resize the note one round late, which WebKit logs as an error.
        let redraw = 0;
        this.widths.watch(contentEl, noteComponent, (width) => {
            window.clearTimeout(redraw);
            redraw = window.setTimeout(() => {
                for (const slot of slots) void this.recheck(slot, width);
            });
        });
        noteComponent.register(() => window.clearTimeout(redraw));
    }

    /**
     * Bases laid out a view. If one of the note's Bases is too wide for the
     * note, it becomes cards. Any other Base is fitted to the note's width.
     */
    onLayout(view: HTMLElement): void {
        const placeholder = view.closest(`.${BASE_SLOT_CLASS}`);
        const slot = placeholder ? this.slots.get(placeholder) : undefined;
        if (!slot?.cards || slot.mode === "cards") {
            fitBaseToWidth(view);
            return;
        }
        const width = laidOutWidth(view);
        if (Number.isNaN(width)) return; // Not laid out yet, so keep measuring.
        // Bases reports its layout from inside its ResizeObserver callback. A
        // Base drawn again or grown there resizes the note too late for that
        // round, and WebKit logs an error.
        window.setTimeout(() => {
            if (slot.gone || slot.mode !== "table") return;
            if (width > view.clientWidth) void this.showCards(slot, slot.contentWidth);
            else slot.letOut();
        });
    }

    private async recheck(slot: BaseSlot, width: number): Promise<void> {
        if (slot.mode === "cards") {
            if (!this.wantsCards(slot, width)) await slot.draw("table");
            return;
        }
        const view = slot.placeholder.querySelector<HTMLElement>(".bases-view");
        if (slot.cards && view && laidOutWidth(view) > width) await this.showCards(slot, width);
    }

    private showCards(slot: BaseSlot, width: number): Promise<void> {
        this.measured.markTooWide(slot.key(width));
        return slot.draw("cards");
    }

    private wantsCards(slot: BaseSlot, width: number): boolean {
        // Stryker disable next-line ConditionalExpression: a Base with no table is never marked too wide, and measures 0.
        if (!slot.cards) return false;
        if (this.measured.isTooWide(slot.key(width))) return true;
        return this.headers ? narrowestTableWidth(slot.definition!, slot.view, this.headers) > width : false;
    }

    /**
     * A Base file changed. A copy drawn as cards cannot save, and nothing else
     * draws it again (D-033). A real embed draws itself again.
     */
    async onBaseModified(file: TAbstractFile): Promise<void> {
        const slots = this.copies.get(file.path);
        if (!slots || !(file instanceof TFile)) return;
        const definition = await this.app.vault.cachedRead(file);
        for (const slot of slots) {
            slot.redefine(definition);
            if (slot.mode === "cards") await slot.draw(this.wantsCards(slot, slot.contentWidth) ? "cards" : "table");
        }
    }

    private track(path: string, slot: BaseSlot, noteComponent: Component): void {
        const slots = this.copies.get(path) ?? new Set<BaseSlot>();
        this.copies.set(path, slots.add(slot));
        noteComponent.register(() => {
            slots.delete(slot);
            if (slots.size === 0) this.copies.delete(path);
        });
    }

    /**
     * The Base file an embed in `note` links to, or null if it is not a Base.
     */
    private resolveBase(linkpath: string, note: TFile): TFile | null {
        const base = this.app.metadataCache.getFirstLinkpathDest(linkpath, note.path);
        return base?.extension === "base" ? base : null;
    }
}

/**
 * One Base in a note: where it is drawn, from what, and how it is drawn now.
 */
class BaseSlot {
    // Stryker disable next-line StringLiteral: before the first render, it is
    // only checked for not being "cards".
    mode: "table" | "cards" = "table";
    /** The Base as cards, or null when it has no table to convert. */
    cards: string | null = null;
    readonly view: string | undefined;
    /**
     * Its note was unloaded.
     */
    gone = false;
    /**
     * The Base is drawn as written, in place of cards, until it is measured.
     * Meanwhile it is clipped at the height the cards showed, because what
     * Bases renders will likely be replaced (styles.css).
     */
    // Stryker disable next-line BooleanLiteral: the first draw finds the placeholder empty, with a height of 0 either way.
    private measuring = false;
    /** `baseDigest` of its Markdown and definition. */
    // Stryker disable next-line StringLiteral: set by redefine, which the constructor calls.
    private digest = "";
    private component: Component | null = null;
    /**
     * Watches the placeholder and what is drawn in it. A placeholder with a
     * held height stops changing size, but its contents do not.
     */
    private readonly resizes = new ResizeObserver(() => this.resized());
    /** Each resize starts this wait again. */
    private readonly letGoOnceStill: Debouncer<[], void>;
    /**
     * Releases a Base that never stops changing. Counted from its first resize
     * since it was last released.
     */
    private limit = 0;
    /**
     * The timer that grows the box in the next task, after Bases' content grew.
     */
    private growing = 0;
    /**
     * The box's fixed height: the tallest the Base has been since it last
     * settled. Shrinking waits until it settles; growing waits for the next
     * task. Bases adds rows inside its own ResizeObserver callback, and the
     * note must not change size there, or WebKit logs an error (D-159).
     */
    private laidOut = 0;

    constructor(
        private readonly app: App,
        private readonly contentEl: HTMLElement,
        readonly placeholder: HTMLElement,
        private readonly file: TFile,
        private readonly noteComponent: Component,
        private readonly source: BaseSource,
        /** The size its cards are drawn at. If undefined, Bases chooses. */
        private readonly cardSize: number | undefined,
        public definition: string | null
    ) {
        // Stryker disable next-line ConditionalExpression: a code block has no view to read.
        this.view = source.kind === "embed" ? source.view : undefined;
        this.redefine(definition);
        this.letGoOnceStill = debounce(() => this.letGo(), SETTLE_MS, true);
        this.resizes.observe(placeholder);
        noteComponent.register(() => {
            this.gone = true;
            this.resizes.disconnect();
            this.letGoOnceStill.cancel();
            window.clearTimeout(this.limit);
            window.clearTimeout(this.growing);
            this.placeholder.style.removeProperty("--daily-note-held-height");
        });
    }

    /** Uses the Base as its file now defines it. */
    redefine(definition: string | null): void {
        this.definition = definition;
        this.digest = baseDigest(this.source.markdown, definition);
        // Stryker disable next-line ConditionalExpression: asCards of null is null.
        const cards = definition === null ? null : asCards(definition, this.view, this.cardSize);
        this.cards = cards === null ? null : ["```base", cards, "```"].join("\n");
    }

    /** The width of the note it is in. */
    get contentWidth(): number {
        return this.contentEl.clientWidth;
    }

    key(width: number): BaseKey {
        return { layout: layoutOf(this.contentEl, width), path: this.file.path, base: this.digest };
    }

    /**
     * Replaces what the Base drew with `mode`, and frees what the last draw
     * registered. Keeps the height it shows now until the Base settles.
     */
    async draw(mode: "table" | "cards"): Promise<void> {
        // While it is measured, it is clipped, so it shows the height it is
        // held at.
        const shown = this.measuring ? this.laidOut : Math.max(this.laidOut, this.height());
        if (this.component) this.noteComponent.removeChild(this.component);
        this.placeholder.empty();
        this.measure(mode === "table" && this.mode === "cards" && shown > 0);
        this.mode = mode;
        this.holdAt(shown);
        this.waitForStill();
        const component = (this.component = this.noteComponent.addChild(new Component()));
        const markdown = mode === "cards" ? this.cards! : this.source.markdown;
        await MarkdownRenderer.render(this.app, markdown, this.placeholder, this.file.path, component);
        if (!this.measuring) this.rise();
        const drawn = this.placeholder.lastElementChild;
        if (drawn) this.resizes.observe(drawn);
    }

    /**
     * It was measured and fits as written. It takes the height it is drawn at,
     * and tells its note at once.
     */
    letOut(): void {
        if (!this.measuring) return;
        this.measure(false);
        this.rise();
        this.told();
    }

    private measure(measuring: boolean): void {
        this.measuring = measuring;
        this.placeholder.toggleClass("is-measuring", measuring);
    }

    /** Tells its note, in this task, about a height set here (ADR 0013). */
    private told(): void {
        this.placeholder.dispatchEvent(new Event(BASE_RESIZED, { bubbles: true }));
    }

    /**
     * Any size change restarts the wait for it to settle, and asks to grow the
     * box in the next task.
     */
    private resized(): void {
        this.growing ||= window.setTimeout(() => this.grow());
        this.waitForStill();
    }

    /**
     * Grows the box if the Base grew, and tells the note. Not while it is being
     * measured: then it stays clipped.
     */
    private grow(): void {
        this.growing = 0;
        if (!this.measuring && this.rise()) this.told();
    }

    /**
     * Grows the box to the Base's own height if that is taller. Returns whether
     * it did.
     */
    private rise(): boolean {
        const height = this.unheldHeight();
        if (height <= this.laidOut) return false;
        this.holdAt(height);
        return true;
    }

    private waitForStill(): void {
        this.letGoOnceStill();
        this.limit ||= window.setTimeout(() => this.letGo(), HOLD_LIMIT_MS);
    }

    /**
     * Sets the box to the Base's own height and holds it there. If that is
     * shorter, the Base lost rows.
     */
    private letGo(): void {
        this.letGoOnceStill.cancel();
        window.clearTimeout(this.limit);
        this.limit = 0;
        // Out of the layout, in a note far from the screen (ADR 0023), it has
        // no height to let go into. It keeps its hold, so rows Bases adds when
        // the note is shown again stay inside it (D-159).
        if (this.placeholder.getClientRects().length === 0) return;
        this.measure(false);
        this.placeholder.style.removeProperty("--daily-note-held-height");
        this.holdAt(this.height());
        this.told();
    }

    /** styles.css turns the property into the box's `height`. */
    private holdAt(height: number): void {
        this.laidOut = height;
        if (height > 0) this.placeholder.style.setProperty("--daily-note-held-height", `${height}px`);
    }

    private height(): number {
        return this.placeholder.getBoundingClientRect().height;
    }

    /**
     * The Base's own height. The fixed height is removed for the measurement
     * and put back at once.
     */
    private unheldHeight(): number {
        this.placeholder.style.removeProperty("--daily-note-held-height");
        const height = this.height();
        this.holdAt(this.laidOut);
        return height;
    }
}

/** A code block's definition. An embed's definition is in its file. */
function blockDefinition(source: BaseSource): string | null {
    // Stryker disable next-line ConditionalExpression: an embed's is undefined, which is drawn the same as null.
    return source.kind === "block" ? source.definition : null;
}

/**
 * How wide Bases draws a header, read once from a hidden copy of one: the
 * name's font, and the padding, icon and gap around it. Null when nothing is
 * laid out, so there is nothing to read.
 */
export function measureHeaderMetrics(host: HTMLElement): HeaderMetrics | null {
    // Built in full, then attached, so the page and its observers see one
    // insertion.
    // Stryker disable StringLiteral,ObjectLiteral,CallExpression: Bases' stylesheet matches these, and only a real layout shows it: e2e-tests/bases-cards.spec.ts.
    const probe = createDiv();
    probe.addClass("daily-note-bases-probe", "block-language-base", "bases-embed");
    const label = probe
        .createDiv({ cls: "bases-view" })
        .createDiv({ cls: "bases-thead" })
        .createDiv({ cls: "bases-tr" })
        .createDiv({ cls: "bases-td" })
        .createDiv({ cls: "bases-table-header" })
        .createDiv({ cls: "bases-table-header-label" });
    setIcon(label.createDiv({ cls: "bases-table-header-icon" }), "text");
    const name = label.createDiv({ cls: "bases-table-header-name", text: "M" });
    // Stryker restore StringLiteral,ObjectLiteral,CallExpression
    host.appendChild(probe);

    const font = getComputedStyle(name).font;
    const chrome = label.scrollWidth - name.scrollWidth;
    probe.remove();
    if (!font || chrome <= 0) return null;

    const context = createEl("canvas").getContext("2d");
    if (!context) return null;
    context.font = font;
    return { chrome, textWidth: (text) => context.measureText(text).width };
}
