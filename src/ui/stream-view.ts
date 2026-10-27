import {
    ItemView,
    Platform,
    Scope,
    WorkspaceLeaf,
    debounce,
    type Hotkey,
    type HoverParent,
    type HoverPopover,
} from "obsidian";
import type DailyNotesStreamPlugin from "../main";
import { JumpToDateModal } from "./jump-to-date-modal";
import { NoteRenderer } from "../render/note-renderer";
import { CollapsibleManager } from "../render/collapsible";
import { NoteStream } from "../stream/note-stream";
import type { DailyNoteService } from "../notes/daily-note-service";
import { StreamSearch } from "../stream/stream-search";
import { SearchHighlighter } from "../render/search-highlights";
import { BASE_RESIZED } from "../render/bases/note-bases";
import { SearchBar } from "./search-bar";
import { matchesHotkey } from "./hotkey";
import {
    getReadableLineLength,
    getSearchHotkeys,
    getViewTitle,
    onPostProcessorChange,
    onVaultConfigChange,
} from "../obsidian-internals";
import { isStreamPlace } from "../stream/scroll-position";

export const VIEW_TYPE_DAILY_NOTES_STREAM = "daily-notes-stream-view";
// A stack of cards (D-041).
export const STREAM_ICON = "gallery-vertical-end";

/**
 * A change to the notes makes an open search read every note again. Several
 * quick changes need only one read.
 */
const SEARCH_REFRESH_DEBOUNCE_MS = 500;

export class DailyNotesStreamView extends ItemView implements HoverParent {
    hoverPopover: HoverPopover | null = null;
    /**
     * Obsidian treats a view that isn't navigable as a sidebar, and keeps the
     * last note active behind it, so its word count stays in the status bar.
     */
    navigation = true;
    private plugin: DailyNotesStreamPlugin;
    private renderer: NoteRenderer;
    private collapsible: CollapsibleManager;
    private stream: NoteStream;
    private search: StreamSearch;
    private searchBar: SearchBar;
    /**
     * Obsidian's hotkeys for "Search current file", read again whenever the
     * settings are saved.
     */
    // Stryker disable next-line ArrayDeclaration: set on open, before any key reaches the view.
    private searchHotkeys: Hotkey[] = [];
    /**
     * Obsidian restores the pane before the vault is indexed, and may close it
     * while `onOpen` is still waiting for the notes. Then the stream never
     * opens. It never goes back to "opening": Obsidian builds a new view every
     * time one opens, including for Back and when the layout is rebuilt.
     */
    // Stryker disable next-line StringLiteral: only "open" and "closed" are ever compared.
    private lifecycle: "opening" | "open" | "closed" = "opening";

    /** `service` belongs to this view only (.claude/rules/invariants.md). */
    constructor(
        leaf: WorkspaceLeaf,
        plugin: DailyNotesStreamPlugin,
        private readonly service: DailyNoteService
    ) {
        super(leaf);
        this.plugin = plugin;
        this.collapsible = new CollapsibleManager(plugin.collapseStore);
        const highlighter = new SearchHighlighter();
        this.renderer = new NoteRenderer(
            this.app,
            this,
            this.collapsible,
            // A function, not the object, because loadSettings() replaces
            // plugin.settings.
            () => plugin.settings,
            highlighter,
            plugin.layoutMemory.bases,
            plugin.backlinks,
            (file) => this.service.isToday(file.path)
        );
        this.stream = new NoteStream(this.service, this.renderer, plugin.layoutMemory, () => this.refreshSearch());

        this.search = new StreamSearch(
            {
                notes: () => this.service.getBatch(0, this.service.length),
                read: (file) => this.app.vault.cachedRead(file),
            },
            this.stream,
            highlighter,
            this.collapsible,
            (status) => this.searchBar.setStatus(status)
        );
        this.searchBar = new SearchBar(this, {
            search: (query) => void this.search.search(query),
            next: () => void this.search.next(),
            previous: () => void this.search.previous(),
            close: () => void this.search.close(),
        });

        // The active leaf's scope sees every key first. Keys it does not handle
        // go on to Obsidian's own hotkeys.
        this.scope = new Scope(this.app.scope);
        this.scope.register(null, null, (evt) => this.onKeydown(evt));
    }

    getViewType(): string {
        return VIEW_TYPE_DAILY_NOTES_STREAM;
    }
    getDisplayText(): string {
        return "Daily Notes Stream";
    }
    getIcon(): string {
        return STREAM_ICON;
    }

    async onOpen() {
        // Outside the scrolling pane, so it does not move while the notes do.
        this.containerEl.insertBefore(this.searchBar.el, this.contentEl);

        const streamContainerEl = this.contentEl.createDiv({ cls: "daily-notes-stream-container" });

        // Follows Obsidian's "Readable line length" setting.
        const syncReadableWidth = () => {
            this.contentEl.toggleClass("is-readable-line-width", getReadableLineLength(this.app));
        };
        syncReadableWidth();
        this.registerEvent(this.app.workspace.on("css-change", syncReadableWidth));

        // Obsidian's daily notes format and folder decide what the stream
        // contains, and nothing else reads them again. A changed hotkey is
        // saved in hotkeys.json.
        this.searchHotkeys = getSearchHotkeys(this.app);
        this.registerEvent(
            onVaultConfigChange(this.app, () => {
                this.searchHotkeys = getSearchHotkeys(this.app);
                this.stream.onDailyNoteSettingsChange();
            })
        );

        // Events heard while the notes are listed are applied once the stream
        // opens, so a note synced or deleted in the meantime is not missed.
        // metadataCache "changed", not vault "modify": the cache is updated
        // after the file is written, and the renderer reads the cache for the
        // frontmatter's position and the properties.
        const { metadataCache, vault } = this.app;
        this.registerEvent(metadataCache.on("changed", (f) => this.stream.onFileModify(f)));
        this.registerEvent(vault.on("create", (f) => this.stream.onFileCreate(f)));
        this.registerEvent(vault.on("delete", (f) => this.stream.onFileDelete(f)));
        this.registerEvent(vault.on("rename", (f, old) => this.stream.onFileRename(f, old)));
        // A Base file has no metadata to wait for.
        this.registerEvent(vault.on("modify", (f) => void this.renderer.onBaseModified(f)));
        this.registerEvent(onPostProcessorChange(this.app, () => void this.refresh()));
        // A link to an empty note shows it. When its last link is removed, it
        // is hidden again (ADR 0011).
        this.register(
            this.plugin.linkChanges.subscribe((paths) => {
                const files = paths.map((path) => vault.getFileByPath(path)).filter((file) => file !== null);
                void this.stream.onLinksChanged(files);
            })
        );

        // Not in onload(), because the vault may not have indexed its files
        // yet. It is awaited because the first batch must already leave out
        // hidden notes (ADR 0011).
        await this.service.initialize();
        if (this.lifecycle === "closed") return;

        this.collapsible.delegate(this, streamContainerEl);
        this.renderer.delegate(this, streamContainerEl);

        this.addAction("calendar-1", "Jump to date", () => this.promptJumpToDate());
        this.addAction("text-search", "Search", () => this.searchBar.open());
        // In iOS apps, a tap on the title bar scrolls to the top. On desktop,
        // the title is only a label.
        const title = getViewTitle(this);
        if (!Platform.isMobile) this.addAction("arrow-up-to-line", "Scroll to top", () => this.scrollToTop());
        else if (title) this.registerDomEvent(title, "click", () => this.scrollToTop());

        this.registerDomEvent(this.contentEl, "scroll", () => this.stream.onScroll());
        this.registerDomEvent(this.contentEl, "pointerdown", (evt) => this.stream.onTouch(evt.target));
        this.registerDomEvent(this.contentEl, BASE_RESIZED, (evt) => this.stream.window.onBaseResized(evt.target));
        this.registerDomEvent(this.contentEl, "wheel", () => this.stream.onWheel(), { passive: true });
        this.registerDomEvent(this.contentEl, "touchstart", () => this.stream.window.onFingerDown(), { passive: true });
        for (const lift of ["touchend", "touchcancel"] as const)
            this.registerDomEvent(this.contentEl, lift, () => this.stream.window.onFingerUp(), { passive: true });
        this.stream.open(this.contentEl, streamContainerEl);
        this.lifecycle = "open";
    }

    /**
     * Obsidian's history keeps a view's scroll position here, not in its state.
     * Back opens the stream again from its state, then passes this back.
     */
    getEphemeralState(): Record<string, unknown> {
        const place = this.lifecycle === "open" ? this.stream.place() : null;
        return place ? { ...super.getEphemeralState(), place } : super.getEphemeralState();
    }

    setEphemeralState(state: unknown): void {
        super.setEphemeralState(state);
        const place = (state as { place?: unknown } | null | undefined)?.place;
        if (isStreamPlace(place)) void this.stream.restorePlace(place);
    }

    /**
     * Obsidian calls this when a pane is resized, including at startup, while
     * `onOpen` is still waiting for the notes. Then the stream has no container
     * to lay out in yet.
     */
    onResize(): void {
        if (this.lifecycle === "open") this.stream.window.onResize();
    }

    async onClose() {
        this.lifecycle = "closed";
        this.refreshSearch.cancel();
        this.stream.close();
    }

    /**
     * Obsidian's hotkey for "Search current file" opens the search bar.
     * Returning false stops the key from going further.
     */
    private onKeydown(evt: KeyboardEvent): false | undefined {
        if (!this.searchHotkeys.some((hotkey) => matchesHotkey(evt, hotkey))) return undefined;
        this.searchBar.open();
        return false;
    }

    /** An open search reads the notes again once the stream's notes change. */
    private readonly refreshSearch = debounce(() => void this.search.refresh(), SEARCH_REFRESH_DEBOUNCE_MS, true);

    /** Asks for a date, then jumps to it. */
    promptJumpToDate(): void {
        new JumpToDateModal(this.app, this.service, (target) => void this.stream.jumpToDate(target)).open();
    }

    scrollToTop(): void {
        this.stream.window.scrollToTop();
    }

    /**
     * Before the stream opens, there is nothing to forget: its notes get
     * estimated heights as they load.
     */
    forgetHeights(): void {
        if (this.lifecycle === "open") this.stream.window.forgetHeights();
    }

    refresh(): Promise<void> {
        return this.stream.refresh();
    }
}
