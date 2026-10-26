import {
    App,
    Component,
    type CachedMetadata,
    Keymap,
    MarkdownRenderer,
    Menu,
    Platform,
    TAbstractFile,
    TFile,
    parseLinktext,
    setIcon,
    type HoverParent,
    type PaneType,
    type View,
} from "obsidian";
import { CollapsibleManager, PROPERTIES_SECTION_KEY } from "./collapsible";
import type { SearchHighlighter } from "./search-highlights";
import { stackWideTables } from "./wide-tables";
import { fitWideEquations } from "./wide-equations";
import { fallBackToSmallThumbnail } from "./video-thumbnails";
import { extractBases, type BaseSource } from "./bases/bases-as-cards";
import { changedSpan, noteChunks, noteSections, type ChangedSpan } from "./note-sections";
import { TimeSlice } from "./time-slice";
import { NoteBases } from "./bases/note-bases";
import { NoteWidths } from "./note-widths";
import type { BaseMeasurements } from "./bases/base-measurements";
import { getPropertyIcon, openTagSearch } from "../obsidian-internals";
import { wrapTextBesideBlocks } from "./text-beside-blocks";
import type { DailyNotesStreamSettings } from "../settings";
import type { BacklinkIndex } from "../notes/backlink-index";
import { LinkedMentionsFooter } from "./linked-mentions";
import type { FarRuns } from "./far-runs";

/**
 * The size of a group of sections drawn at once: about 10 ms on a phone (ADR
 * 0020).
 */
const CHUNK_CHARS = 2000;

/**
 * A shorter note is drawn all at once, which blocks the thread no longer than
 * one slice would (ADR 0020).
 */
const SLICED_FROM_CHARS = 6000;

/**
 * How long drawing may block the thread before it lets input and painting run
 * (ADR 0020).
 */
const SLICE_MS = 25;

/**
 * A note's groups of sections. Null when it is drawn all at once, as a short
 * note is.
 */
function chunksOf(markdown: string, cache: CachedMetadata | null): string[] | null {
    return markdown.length < SLICED_FROM_CHARS ? null : noteChunks(markdown, cache, CHUNK_CHARS);
}

/** Icons to use when Obsidian cannot tell a property's type. */
const PROPERTY_ICONS: Record<string, string> = {
    tags: "tags",
    aliases: "tags",
    created: "calendar",
    updated: "calendar",
    link: "link",
    url: "link",
    image: "image",
    cover: "image",
};

function fallbackIcon(key: string): string {
    const name = key.toLowerCase();
    const known = PROPERTY_ICONS[name];
    if (known) return known;
    if (name.includes("date") || name.includes("time")) return "calendar";
    return "file-text";
}

/**
 * The items a right-click on a title shows above Obsidian's file menu, in
 * Obsidian's own words. The file menu adds "Open in new window" itself, where
 * windows exist.
 */
const OPEN_ITEMS: { title: string; icon: string; pane: PaneType }[] = [
    { title: "Open in new tab", icon: "file-plus", pane: "tab" },
    { title: "Open to the right", icon: "separator-vertical", pane: "split" },
];

/**
 * A title or an internal link: something in the stream that points to a note.
 */
interface NoteTarget {
    /** Null for a link to a note not yet created. */
    file: TFile | null;
    /**
     * Obsidian's name for where the file menu was opened. Other plugins read
     * it.
     */
    menuSource: string;
    open(pane: PaneType | boolean): void;
}

/**
 * The view that handles the stream's taps and clicks. Page preview attaches its
 * popups to it.
 */
type HoverView = Component & HoverParent & Pick<View, "getViewType">;

/**
 * Marks the values whose pills start a search, so a click can tell them apart.
 */
const TAG_VALUE_CLASS = "daily-note-tags-value";

/**
 * The property Obsidian treats as tags, so its pills get the tag colors.
 * Obsidian stopped treating `tag` this way in 1.9.10.
 */
const TAG_KEY = "tags";

/**
 * The items a list property shows a pill for. The tags property is always a
 * list, and a single value is one item: `tags: work, daily` is one tag, "work,
 * daily".
 */
function pillItems(key: string, value: unknown): string[] | null {
    if (Array.isArray(value)) return value.map(String);
    if (key.toLowerCase() === TAG_KEY && typeof value === "string") return [value];
    return null;
}

/**
 * Whitespace, ASCII punctuation except `-`, `/` and `_`, and the two Unicode
 * punctuation blocks.
 */
const NOT_IN_A_TAG = /[\s!-,.:-@[-^`{-~\u2000-\u206F\u2E00-\u2E7F]/u;

/**
 * Whether Obsidian accepts this as a tag. It shows `#work`, but marks it as not
 * valid.
 */
function isTagName(tag: string): boolean {
    return !NOT_IN_A_TAG.test(tag) && !/^\d+$/.test(tag);
}

function displayValue(value: unknown): string {
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
}

/** One section of a note, drawn on its own (ADR 0019). */
interface RenderedSection {
    source: string;
    /**
     * The nodes it drew. They sit at the same level as the nodes of the note's
     * other sections.
     */
    nodes: ChildNode[];
    /** Owns what the section registered. A child of the note's component. */
    component: Component;
    bases: BaseSource[];
}

/**
 * Where a section drawn before `sections` goes: before the first node they
 * drew.
 */
function firstNodeOf(sections: RenderedSection[]): ChildNode | null {
    return sections.find((section) => section.nodes.length > 0)?.nodes[0] ?? null;
}

/**
 * Groups sections from the end, each group up to the group size. A note drawn
 * from the end grows at its top, so only its top group changes.
 */
function groupByLength(sections: RenderedSection[]): RenderedSection[][] {
    const runs: RenderedSection[][] = [];
    let length = Infinity;
    for (const section of [...sections].reverse()) {
        if (length + section.source.length > CHUNK_CHARS) {
            runs.unshift([]);
            length = 0;
        }
        length += section.source.length;
        runs[0]!.unshift(section);
    }
    return runs;
}

/**
 * Groups sections, each group starting at one of `starts` or at the note's top.
 */
function groupByStarts(sections: RenderedSection[], starts: WeakSet<RenderedSection>): RenderedSection[][] {
    const runs: RenderedSection[][] = [];
    for (const section of sections) {
        if (runs.length === 0 || starts.has(section)) runs.push([]);
        runs[runs.length - 1]!.push(section);
    }
    return runs;
}

/**
 * The element a note's Markdown is drawn into, below its title and properties.
 */
export const NOTE_CONTENT_CLASS = "daily-note-content";

/**
 * A note drawn in slices is drawn from its end first when the reader scrolls up
 * into it.
 */
export type DrawOrder = "from-start" | "from-end";

/**
 * Marks a block that is drawing in slices from its end, so styles.css lays it
 * out from its bottom. The stream removes the mark when drawing finishes. A
 * note drawn all at once has no end to draw first.
 */
export const DRAWING_FROM_END = "is-drawing-from-end";

/** A note drawn one section, or one group of sections, at a time. */
interface DrawnNote {
    contentEl: HTMLElement;
    /**
     * The sections drawn so far, so the stream can hide them between slices.
     */
    sections: RenderedSection[];
    /**
     * The section each group starts at, fixed once drawn, so a save only
     * changes the groups it touched.
     */
    runStarts: WeakSet<RenderedSection> | null;
    /**
     * The note's text above its body. When it changes, the properties are drawn
     * again. Null when the note was drawn in groups; then a save draws the
     * whole note again.
     */
    frontmatter: string | null;
}

/**
 * On mobile, a Base is drawn as cards (ADR 0008), into an empty slot left where
 * its source was.
 */
function withoutBases(source: string): { markdown: string; bases: BaseSource[] } {
    // Stryker disable next-line ArrayDeclaration: desktop leaves no slot, so nothing reads the list.
    return Platform.isMobile ? extractBases(source) : { markdown: source, bases: [] };
}

function hasBases(source: string): boolean {
    return extractBases(source).bases.length > 0;
}

/** The note's text before its body: the frontmatter, or nothing. */
function frontmatterOf(markdown: string, cache: CachedMetadata | null): string {
    return markdown.slice(0, cache?.frontmatterPosition?.end.offset ?? 0);
}

/** A drawn note: the component that frees it, and when its footer is drawn. */
export interface RenderedNote {
    component: Component;
    /**
     * Resolves once the linked mentions are drawn. The note itself is already
     * drawn.
     */
    footer: Promise<void>;
}

export class NoteRenderer {
    /** Each view has its own. What its Bases measured is shared, by layout. */
    private readonly bases: NoteBases;
    private readonly mentions: LinkedMentionsFooter;
    private readonly widths: NoteWidths;
    /**
     * Notes drawn one section or group at a time, by the component they were
     * drawn into.
     */
    private readonly drawn = new WeakMap<Component, DrawnNote>();
    /**
     * Notes saved while drawn, by path. From then on they are drawn by section.
     * Until a save, a note is drawn all at once, which takes half as long for a
     * long note.
     */
    private readonly saved = new Set<string>();

    constructor(
        private readonly app: App,
        private readonly component: Component,
        private readonly collapsible: CollapsibleManager,
        private readonly getSettings: () => DailyNotesStreamSettings,
        private readonly highlighter: SearchHighlighter,
        baseMeasurements: BaseMeasurements,
        backlinks: BacklinkIndex,
        /**
         * Whether a note is likely to be saved while on screen, as today's is
         * (ADR 0019).
         */
        // Stryker disable next-line ArrowFunction: undefined is as falsy as false.
        private readonly expectsSaves: (file: TFile) => boolean = () => false
    ) {
        this.widths = new NoteWidths(component);
        this.bases = new NoteBases(app, baseMeasurements, this.widths, () => getSettings().oneCardPerRow);
        this.mentions = new LinkedMentionsFooter(app, backlinks, collapsible, getSettings, this.widths, (el) =>
            this.markUnresolvedLinks(el)
        );
    }

    /**
     * The block a note always has, drawn or not. `renderInto` fills it and
     * emptying clears it, so the note can be found by its path either way.
     */
    createBlock(file: TFile): HTMLElement {
        const block = createDiv();
        block.addClass("daily-note-block");
        block.dataset.sourcePath = file.path;
        return block;
    }

    /**
     * Fills an empty block. The note is drawn into a child component, not the
     * view. What MarkdownRenderer registers lasts until that child is thrown
     * away; otherwise it would outlast the DOM it belongs to. The footer is
     * left drawing, because the render queue must not wait while other notes
     * are read. Between slices, it waits for `goOn`. It returns null, and
     * leaves the block empty, if `goOn` said stop (ADR 0020) or the note was
     * deleted in the meantime. A note drawn in slices is drawn from its end
     * first when the reader scrolls up into it.
     */
    async renderInto(
        block: HTMLElement,
        file: TFile,
        goOn: (note: Component) => Promise<boolean> = () => Promise.resolve(true),
        // Stryker disable next-line StringLiteral: only "from-end" is ever compared.
        order: DrawOrder = "from-start"
    ): Promise<RenderedNote | null> {
        const noteComponent = new Component();
        noteComponent.load();
        this.component.addChild(noteComponent);

        // A block left half drawn would get a second header on the next render.
        try {
            this.renderHeader(block, file);
            this.renderProperties(block, file);
        } catch (error) {
            this.abandon(block, noteComponent);
            throw error;
        }

        // Obsidian's whole reading view stylesheet, including list indents,
        // only applies inside "markdown-rendered". Without it, a drawn note
        // gets the browser's default styles.
        const contentEl = block.createDiv({ cls: `${NOTE_CONTENT_CLASS} markdown-rendered` });

        try {
            const markdown = await this.app.vault.cachedRead(file);
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = frontmatterOf(markdown, cache);
            const bySection = this.saved.has(file.path) || this.expectsSaves(file);
            const sources = bySection ? noteSections(markdown, cache) : chunksOf(markdown, cache);
            if (sources) {
                if (order === "from-end") block.addClass(DRAWING_FROM_END);
                const note: DrawnNote = { contentEl, sections: [], runStarts: null, frontmatter: null };
                this.drawn.set(noteComponent, note);
                if (!(await this.renderSections(note, file, noteComponent, sources, goOn, order)))
                    return this.abandon(block, noteComponent);
                // A note that failed to draw is drawn all at once on the next
                // save.
                if (bySection) note.frontmatter = frontmatter;
            } else await this.renderWhole(contentEl, file, noteComponent, markdown.slice(frontmatter.length).trim());
            const sectionKeys = this.collapsible.makeCollapsible(contentEl, file.path);
            this.collapsible.forgetRemovedSections(file, sectionKeys);
        } catch (error) {
            if (this.isDeleted(file)) return this.abandon(block, noteComponent);
            console.error(`DailyNotesStream: Failed to render note ${file.path}:`, error);
            contentEl.setText("Error rendering note");
        }

        const footer = this.mentions.render(block, file, noteComponent);
        this.highlighter.track(block, noteComponent);
        return { component: noteComponent, footer };
    }

    /**
     * Draws again only the sections of a note that a save changed (ADR 0019).
     * Returns false when the whole note must be drawn again: it was drawn all
     * at once, its sections no longer stand on their own, a Base changed, or,
     * on mobile, its frontmatter changed in a note with a Base. A failed update
     * may leave the note partly drawn until it is drawn again in full.
     */
    async update(block: HTMLElement, file: TFile, noteComponent: Component): Promise<boolean> {
        const note = this.drawn.get(noteComponent);
        if (note?.frontmatter == null) {
            this.saved.add(file.path);
            return false;
        }
        try {
            const markdown = await this.app.vault.cachedRead(file);
            const cache = this.app.metadataCache.getFileCache(file);
            const sources = noteSections(markdown, cache);
            if (!sources) return false;
            const frontmatter = frontmatterOf(markdown, cache);
            const frontmatterChanged = frontmatter !== note.frontmatter;
            const before = note.sections.map((section) => section.source);
            const span = changedSpan(before, sources);
            // Bases are drawn across the note, each into its slot in order, and
            // a Base's formulas may read the note's properties, so the Bases
            // are drawn again with the properties.
            const redrawn = frontmatterChanged
                ? [...before, ...sources]
                : [...before.slice(span.start, span.endBefore), ...sources.slice(span.start, span.endAfter)];
            if (Platform.isMobile && redrawn.some(hasBases)) return false;

            await this.replaceSections(note, span, sources, file, noteComponent);
            if (frontmatterChanged) {
                this.redrawProperties(block, note.contentEl, file);
                note.frontmatter = frontmatter;
            }

            const sectionKeys = this.collapsible.refreshCollapsible(note.contentEl, file.path);
            this.collapsible.forgetRemovedSections(file, sectionKeys);
            this.highlighter.refresh(block);
            return true;
        } catch (error) {
            if (this.isDeleted(file)) return false;
            console.error(`DailyNotesStream: Failed to update note ${file.path}:`, error);
            return false;
        }
    }

    /** Draws the sections `span` of `note` again from `sources`, in place. */
    private async replaceSections(
        note: DrawnNote,
        { start, endBefore, endAfter }: ChangedSpan,
        sources: string[],
        file: TFile,
        noteComponent: Component
    ): Promise<void> {
        // Sections replaced among hidden ones would show next to a spacer that
        // still stands in for them. So the groups they and their neighbours are
        // in are shown.
        for (const section of note.sections.slice(Math.max(0, start - 1), endBefore + 1))
            for (const node of section.nodes) this.farRuns.reveal(node);
        const removed = note.sections.slice(start, endBefore);
        const next = firstNodeOf(note.sections.slice(endBefore));
        for (const section of removed) {
            section.nodes.forEach((node) => node.remove());
            noteComponent.removeChild(section.component);
        }
        const rendered: RenderedSection[] = [];
        for (const source of sources.slice(start, endAfter)) {
            rendered.push(await this.renderSection(note.contentEl, next, source, file, noteComponent));
        }
        note.sections.splice(start, endBefore - start, ...rendered);
        const starts = note.runStarts;
        // A group that lost its first section now starts at the section that
        // replaced it.
        const heir = note.sections[start];
        if (starts && heir && removed.some((section) => starts.has(section))) starts.add(heir);
    }

    /**
     * The parts of notes hidden when far away, shared with folding (ADR 0021).
     */
    get farRuns(): FarRuns {
        return this.collapsible.farRuns;
    }

    /**
     * A note's elements in groups of about one slice each, in order, for the
     * stream to hide when far away (ADR 0021). None for a note drawn all at
     * once.
     */
    runsOf(noteComponent: Component): Element[][] {
        const note = this.drawn.get(noteComponent);
        if (!note) return [];
        const { sections, runStarts } = note;
        return (runStarts ? groupByStarts(sections, runStarts) : groupByLength(sections))
            .map((run) => run.flatMap((section) => section.nodes.filter((node) => node.instanceOf(Element))))
            .filter((run) => run.length > 0);
    }

    /** Leaves `block` empty, and frees what its note registered. */
    private abandon(block: HTMLElement, noteComponent: Component): null {
        this.discard(noteComponent);
        block.empty();
        return null;
    }

    /**
     * Whether the note was deleted from the vault. Then reading it fails, and
     * its block is about to be removed.
     */
    private isDeleted(file: TFile): boolean {
        return this.app.vault.getFileByPath(file.path) === null;
    }

    /** Draws a note all at once, as Obsidian does. */
    private async renderWhole(contentEl: HTMLElement, file: TFile, noteComponent: Component, markdown: string) {
        // On mobile, nothing in the stream may scroll (ADR 0008). Desktop draws
        // wide content as Obsidian does, scrolling in its own box.
        const { markdown: body, bases } = withoutBases(markdown);
        await MarkdownRenderer.render(this.app, body, contentEl, file.path, noteComponent);
        this.markUnresolvedLinks(contentEl);
        await this.finishNote(contentEl, file, noteComponent, bases);
        if (Platform.isMobile) fitWideEquations(contentEl, noteComponent, this.widths);
        wrapTextBesideBlocks(contentEl);
    }

    /**
     * After the whole note is drawn: on mobile, draws its Bases as cards and
     * stacks its tables.
     */
    private async finishNote(
        contentEl: HTMLElement,
        file: TFile,
        noteComponent: Component,
        bases: BaseSource[]
    ): Promise<void> {
        if (!Platform.isMobile) return;
        await this.bases.render(contentEl, file, noteComponent, bases);
        stackWideTables(contentEl, noteComponent, this.widths);
    }

    /**
     * Draws a note one section, or one group of sections, at a time, so a save
     * can draw part of it again (ADR 0019), and no long note freezes the stream
     * (ADR 0020). Returns null once `goOn` says stop. A note taken out of the
     * document is left partly drawn, to be thrown away.
     */
    private async renderSections(
        note: DrawnNote,
        file: TFile,
        noteComponent: Component,
        sources: string[],
        goOn: (note: Component) => Promise<boolean>,
        order: DrawOrder
    ): Promise<boolean> {
        const slice = new TimeSlice(SLICE_MS);
        const fromEnd = order === "from-end";
        const { contentEl, sections } = note;
        for (const source of fromEnd ? [...sources].reverse() : sources) {
            if (await slice.yieldIfSpent()) {
                if (!(await goOn(noteComponent))) return false;
                if (!contentEl.isConnected) return true;
            }
            if (!fromEnd) sections.push(await this.renderSection(contentEl, null, source, file, noteComponent));
            else
                sections.unshift(
                    await this.renderSection(contentEl, firstNodeOf(sections), source, file, noteComponent)
                );
        }
        note.runStarts = new WeakSet(groupByLength(sections).map((run) => run[0]!));
        await this.finishNote(
            contentEl,
            file,
            noteComponent,
            sections.flatMap((section) => section.bases)
        );
        return true;
    }

    /**
     * Draws one section before `next`. It is drawn into a holder element, which
     * is then replaced by what it holds. So the note's elements stay siblings,
     * as they are when the note is drawn all at once, which folding and
     * Obsidian's stylesheet need.
     */
    private async renderSection(
        contentEl: HTMLElement,
        next: ChildNode | null,
        source: string,
        file: TFile,
        noteComponent: Component
    ): Promise<RenderedSection> {
        const component = noteComponent.addChild(new Component());
        const holder = contentEl.insertBefore(createDiv(), next);
        const { markdown, bases } = withoutBases(source);
        await MarkdownRenderer.render(this.app, markdown, holder, file.path, component);
        this.markUnresolvedLinks(holder);
        if (Platform.isMobile) fitWideEquations(contentEl, component, this.widths, holder);
        wrapTextBesideBlocks(holder);
        const nodes = Array.from(holder.childNodes);
        holder.replaceWith(...nodes);
        return { source, nodes, component, bases };
    }

    /**
     * A Base file changed, so the copies of it drawn as cards are drawn again.
     */
    onBaseModified(file: TAbstractFile): Promise<void> {
        return this.bases.onBaseModified(file);
    }

    /**
     * Bases laid out a table: show cards if it is too wide for its note,
     * otherwise fit its columns.
     */
    onBaseLayout(view: HTMLElement): void {
        this.bases.onLayout(view);
    }

    /** Frees everything the note registered while it was drawn. */
    discard(noteComponent: Component): void {
        this.component.removeChild(noteComponent);
    }

    private renderHeader(block: HTMLElement, file: TFile): void {
        const header = block.createDiv({ cls: "daily-note-header" });
        const dateLink = header.createEl("a", {
            text: file.basename,
            cls: "daily-note-title",
            // href lets the title take focus and open with Enter. The click
            // handler opens the note itself.
            href: "#",
        });
        this.titles.set(dateLink, file);
    }

    /**
     * Draws the properties box again from the cache, above the note's content.
     */
    private redrawProperties(block: HTMLElement, contentEl: HTMLElement, file: TFile): void {
        block.querySelector(":scope > .metadata-container")?.remove();
        this.renderProperties(block, file);
        const properties = block.querySelector(":scope > .metadata-container");
        if (properties) contentEl.before(properties);
    }

    private renderProperties(container: HTMLElement, file: TFile): void {
        if (!this.getSettings().showProperties) return;

        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) return;

        const frontmatter = cache.frontmatter as unknown as Record<string, unknown>;
        const keys = Object.keys(frontmatter).filter((k) => k !== "position");
        if (keys.length === 0) return;

        const metadataContainer = container.createDiv({ cls: "metadata-container" });

        // The same structure as Obsidian's: the heading is a sibling above the
        // box, not a row inside it, and the whole row is the control. It is not
        // in the tab order: Obsidian draws a ring around it on :focus, and a
        // click would leave that ring behind. So the arrow takes focus.
        const heading = metadataContainer.createDiv({ cls: "metadata-properties-heading" });
        heading.createDiv({ cls: "metadata-properties-title", text: "Properties" });

        const metadataContent = metadataContainer.createDiv({ cls: "metadata-content" });
        const metadataProperties = metadataContent.createDiv({ cls: "metadata-properties" });
        for (const key of keys) {
            this.renderPropertyRow(metadataProperties, key, frontmatter[key]);
        }

        const toggle = this.collapsible.attachCollapseToggle(heading, {
            filePath: file.path,
            sectionKey: PROPERTIES_SECTION_KEY,
            defaultCollapsed: this.getSettings().propertiesCollapsed,
            apply: (collapsed) => metadataContainer.toggleClass("is-collapsed", collapsed),
            hides: (node) => metadataContent.contains(node),
        });
        this.collapsible.attachCollapseHost(heading, toggle);
    }

    /**
     * Maps each title to its note. Weak, so titles removed when a note is drawn
     * again can be freed.
     */
    private readonly titles = new WeakMap<HTMLElement, TFile>();

    /**
     * One listener for each kind of gesture, for the whole stream, so a title
     * or link drawn again needs no listener of its own.
     */
    delegate(view: HoverView, root: HTMLElement): void {
        view.registerDomEvent(root, "click", (evt) => {
            // A click's target is the element under the pointer, never a text
            // node.
            const target = evt.target as HTMLElement;

            const tag = this.tagAt(target);
            if (tag) {
                evt.preventDefault();
                void openTagSearch(this.app, tag, Keymap.isModEvent(evt));
                return;
            }

            const note = this.noteAt(target);
            if (!note) return;
            evt.preventDefault();
            note.open(Keymap.isModEvent(evt));
        });

        // A middle click fires auxclick, never click.
        view.registerDomEvent(root, "auxclick", (evt) => {
            const note = evt.button === 1 ? this.noteAt(evt.target as HTMLElement) : null;
            if (!note) return;
            evt.preventDefault();
            note.open("tab");
        });

        // On mobile, a video is shown as its thumbnail (D-088). Load and error
        // events do not bubble, so they are captured.
        view.registerDomEvent(root, "load", fallBackToSmallThumbnail, { capture: true });
        view.registerDomEvent(root, "error", fallBackToSmallThumbnail, { capture: true });

        view.registerDomEvent(root, "contextmenu", (evt) => {
            const note = this.noteAt(evt.target as HTMLElement);
            if (!note) return;
            evt.preventDefault();
            this.showNoteMenu(note, evt);
        });

        // Creating, deleting or renaming a note can fix or break a link in any
        // drawn note. The cache reports it once, after it resolves links again.
        view.registerEvent(this.app.metadataCache.on("resolved", () => this.markUnresolvedLinks(root)));

        // From here, Page preview decides whether to show a preview, based on
        // its own settings.
        view.registerDomEvent(root, "mouseover", (evt) => {
            const link = this.linkAt(evt.target as HTMLElement);
            if (!link) return;
            this.app.workspace.trigger("hover-link", {
                event: evt,
                source: view.getViewType(),
                hoverParent: view,
                targetEl: link.el,
                linktext: link.linktext,
                sourcePath: link.sourcePath,
            });
        });
    }

    /**
     * Fades the links to notes that do not exist yet. The reading view does
     * this after drawing; MarkdownRenderer leaves it to the caller.
     */
    private markUnresolvedLinks(root: HTMLElement): void {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>(".internal-link"))) {
            const link = this.linkAt(el);
            if (!link) continue;
            const { path } = parseLinktext(link.linktext);
            el.toggleClass("is-unresolved", !this.app.metadataCache.getFirstLinkpathDest(path, link.sourcePath));
        }
    }

    /** The note that the title or internal link under the pointer points to. */
    private noteAt(target: HTMLElement): NoteTarget | null {
        const title = target.closest<HTMLElement>(".daily-note-title");
        const file = title ? this.titles.get(title) : undefined;
        if (file) return { file, menuSource: "daily-notes-stream", open: (pane) => this.openNote(file, pane) };

        const link = this.linkAt(target);
        if (!link) return null;
        const { linktext, sourcePath } = link;
        return {
            file: this.app.metadataCache.getFirstLinkpathDest(parseLinktext(linktext).path, sourcePath),
            menuSource: "link-context-menu",
            open: (pane) => this.openLink(linktext, sourcePath, pane),
        };
    }

    /**
     * An internal link, and the note it was written in, which is needed to
     * resolve it. A linked mention's excerpt was written in the other note, not
     * in the daily note. On mobile, a PDF embed is a preview that links to its
     * file (D-083).
     */
    private linkAt(target: HTMLElement): { el: HTMLElement; linktext: string; sourcePath: string } | null {
        const pdf = Platform.isMobile ? target.closest<HTMLElement>(".pdf-embed") : null;
        const el = pdf ?? target.closest<HTMLElement>(".internal-link");
        const linktext = pdf ? pdf.getAttribute("src") : el?.getAttribute("data-href");
        const sourcePath =
            el?.closest<HTMLElement>("[data-link-source]")?.dataset.linkSource ??
            el?.closest<HTMLElement>(".daily-note-block")?.dataset.sourcePath;
        if (!el || !linktext || !sourcePath) return null;
        return { el, linktext, sourcePath };
    }

    /**
     * The tag that was clicked, in the note's text or as a property pill. A
     * pill only counts if Obsidian treats the property as tags: an alias pill
     * is not a tag.
     */
    private tagAt(target: HTMLElement): string | null {
        const inline = target.closest<HTMLElement>("a.tag");
        if (inline) return inline.textContent;

        const pill = target.closest<HTMLElement>(`.${TAG_VALUE_CLASS} .multi-select-pill:not(.is-invalid)`);
        return pill?.textContent ?? null;
    }

    /**
     * Shows where the note can open, then Obsidian's file menu for it, if the
     * note exists.
     */
    private showNoteMenu(note: NoteTarget, evt: MouseEvent): void {
        const menu = new Menu();
        for (const { title, icon, pane } of OPEN_ITEMS) {
            menu.addItem((item) =>
                item
                    .setTitle(title)
                    .setIcon(icon)
                    .setSection("open")
                    .onClick(() => note.open(pane))
            );
        }
        if (note.file) this.app.workspace.trigger("file-menu", menu, note.file, note.menuSource);
        menu.showAtMouseEvent(evt);
    }

    /**
     * Opens a link. A link to a note that does not exist yet creates it, as
     * Obsidian's links do.
     */
    private openLink(linktext: string, sourcePath: string, pane: PaneType | boolean): void {
        this.app.workspace.openLinkText(linktext, sourcePath, pane).catch((error) => {
            console.error("DailyNotesStream: Failed to open link", error);
        });
    }

    /**
     * A plain click opens the note in the stream's own tab, as a link in a note
     * opens in that note's tab.
     */
    private openNote(file: TFile, pane: PaneType | boolean): void {
        this.app.workspace
            .getLeaf(pane)
            .openFile(file)
            .catch((error) => {
                console.error("DailyNotesStream: Failed to open file", error);
            });
    }

    private renderPropertyRow(container: HTMLElement, key: string, value: unknown): void {
        const propertyRow = container.createDiv({ cls: "metadata-property" });

        const keyContainer = propertyRow.createDiv({ cls: "metadata-property-key" });
        const iconEl = keyContainer.createDiv({ cls: "metadata-property-icon" });
        setIcon(iconEl, getPropertyIcon(this.app, key, value) ?? fallbackIcon(key));
        // The key is a flex box, and WebKit draws no CSS highlight on loose
        // text directly inside one (D-038), so search marked no key on iOS.
        keyContainer.createSpan({ cls: "metadata-property-key-input" }).createSpan({ text: key });

        const valueEl = propertyRow.createDiv({ cls: "metadata-property-value" });
        const items = pillItems(key, value);
        if (items) {
            this.renderPills(valueEl, key, items);
            return;
        }
        valueEl.createSpan({ cls: "metadata-property-value-text", text: displayValue(value) });
    }

    /**
     * The same structure as Obsidian's multi-select, without its editing
     * controls.
     */
    private renderPills(valueEl: HTMLElement, key: string, items: string[]): void {
        const isTags = key.toLowerCase() === TAG_KEY;
        if (isTags) {
            valueEl.dataset.propertyType = "tags";
            valueEl.addClass(TAG_VALUE_CLASS);
        }
        const pills = valueEl.createDiv({ cls: "multi-select-container" });
        for (const item of items) {
            const pill = pills.createDiv({ cls: "multi-select-pill" });
            pill.createDiv({ cls: "multi-select-pill-content" }).createSpan({
                text: isTags ? item.replace(/^#/, "") : item,
            });
            if (isTags && !isTagName(item)) {
                pill.addClass("is-invalid");
                pill.setAttribute("aria-label", "Invalid tag name");
            }
        }
    }
}
