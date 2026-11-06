import { Keymap, Notice, PaneType, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DailyNotesStreamView, STREAM_ICON, VIEW_TYPE_DAILY_NOTES_STREAM } from "./ui/stream-view";
import { DEFAULT_SETTINGS, DailyNotesStreamSettings, DailyNotesStreamSettingTab } from "./settings";
import { CollapsibleStateStore, isOldCollapseKey } from "./render/collapse-store";
import { drawMathAtOnce } from "./render/math-at-once";
import { NOTE_CONTENT_CLASS, TITLE_MENU_SOURCE } from "./render/note-renderer";
import { DailyNoteService } from "./notes/daily-note-service";
import { ParsedDates } from "./notes/parsed-dates";
import type { Moment } from "./notes/moment";
import { LayoutMemory } from "./stream/layout-memory";
import { BacklinkIndex } from "./notes/backlink-index";
import { EMPTY_NOTES_KEY, EmptyNotes, hideEmptyNotes } from "./notes/empty-notes";
import { ReadingNotes } from "./stream/reading-notes";
import { followInCalendar, takeCalendarClicks } from "./integrations/calendar";
import { LinkChanges } from "./notes/link-changes";
import { readDateFormat } from "./notes/daily-note-format";
import { getDailyNoteSettings, removeLocalStorageKeys } from "./obsidian-internals";

/**
 * Set by esbuild from the environment: names a build put on a device for
 * testing. Empty in a release.
 */
declare const BUILD_LABEL: string;

/** Unit tests run the source without bundling it, where nothing defines it. */
function buildLabel(): string {
    return typeof BUILD_LABEL === "string" ? BUILD_LABEL : "";
}

/**
 * A ribbon click or command has no caller to pass an error to, so a failure is
 * logged.
 */
function logActivationFailure(activation: Promise<unknown>): void {
    activation.catch((error) => console.error("DailyNotesStream: Failed to activate view", error));
}

/** The only filter is Hide empty notes (ADR 0011). */
const HIDDEN_NOTE =
    "This note is hidden from the stream because it's empty. To show it, turn off \"Hide empty notes\" in Daily Notes Stream's settings.";

export default class DailyNotesStreamPlugin extends Plugin {
    settings!: DailyNotesStreamSettings;
    collapseStore!: CollapsibleStateStore;
    layoutMemory!: LayoutMemory;
    backlinks!: BacklinkIndex;
    emptyNotes!: EmptyNotes;
    linkChanges!: LinkChanges;
    /**
     * Never built: it only answers which notes are daily notes, and which the
     * stream hides, with no view open.
     */
    private streamNotes!: DailyNoteService;

    /** Which note each stream is reading, for the integrations (ADR 0024). */
    readonly readingNotes = new ReadingNotes();

    async onload() {
        if (buildLabel()) new Notice(`Daily Notes Stream: ${buildLabel()}`);
        await this.loadSettings();

        this.rememberCollapse();
        this.rememberLayout();
        this.indexBacklinks();
        this.indexEmptyNotes();
        this.followLinkChanges();
        this.register(followInCalendar(this.app, this.readingNotes));
        this.register(takeCalendarClicks(this.app, (day) => this.showDayInStream(day)));

        // Each view has its own service (.claude/rules/invariants.md). They
        // only share the dates read from file names, and which notes are empty.
        const parsedDates = new ParsedDates();
        const markdownFiles = () => this.app.vault.getMarkdownFiles();
        const dailyNoteSettings = () => getDailyNoteSettings(this.app);
        const filter = hideEmptyNotes(this.emptyNotes, this.backlinks, () => this.settings);
        this.streamNotes = new DailyNoteService(markdownFiles, dailyNoteSettings, parsedDates, filter);
        this.registerView(
            VIEW_TYPE_DAILY_NOTES_STREAM,
            (leaf) =>
                new DailyNotesStreamView(
                    leaf,
                    this,
                    new DailyNoteService(markdownFiles, dailyNoteSettings, parsedDates, filter)
                )
        );

        // Before Obsidian's own math step, which runs at 0 (D-210).
        this.registerMarkdownPostProcessor(
            drawMathAtOnce((el) => el.closest(`.${NOTE_CONTENT_CLASS}`) !== null),
            -1
        );

        this.registerHoverLinkSource(VIEW_TYPE_DAILY_NOTES_STREAM, {
            display: "Daily Notes Stream",
            defaultMod: true,
        });

        this.addRibbonIcon(STREAM_ICON, "Open daily notes stream", (evt) =>
            logActivationFailure(this.activateView(Keymap.isModEvent(evt)))
        );

        this.addCommand({
            id: "open-stream",
            name: "Open stream",
            icon: STREAM_ICON,
            callback: () => logActivationFailure(this.activateView()),
        });

        this.addCommand({
            id: "jump-to-date",
            name: "Jump to date",
            icon: "calendar-1",
            callback: () => logActivationFailure(this.promptJumpToDate()),
        });

        // For every daily note: whether one is hidden is only known once it is
        // read (D-218).
        this.addCommand({
            id: "show-in-stream",
            name: "Show in stream",
            icon: STREAM_ICON,
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || !this.streamNotes.isDailyNote(file)) return false;
                if (!checking) logActivationFailure(this.showInStream(file));
                return true;
            },
        });
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file, source) => {
                // A note's title in the stream is already in it.
                if (source === TITLE_MENU_SOURCE) return;
                if (!(file instanceof TFile) || !this.streamNotes.isDailyNote(file)) return;
                menu.addItem((item) =>
                    item
                        .setTitle("Show in stream")
                        .setIcon(STREAM_ICON)
                        .setSection("open")
                        .onClick((evt) => logActivationFailure(this.showInStream(file, Keymap.isModEvent(evt))))
                );
            })
        );

        this.addCommand({
            id: "scroll-to-top",
            name: "Scroll to top",
            icon: "arrow-up-to-line",
            checkCallback: (checking) => {
                const view = this.app.workspace.getMostRecentLeaf()?.view;
                if (!(view instanceof DailyNotesStreamView)) return false;
                if (!checking) view.scrollToTop();
                return true;
            },
        });

        // A help for testing, to start with no saved heights. Only in a device
        // build.
        if (buildLabel()) {
            this.addCommand({
                id: "forget-note-heights",
                name: "Forget measured note heights",
                callback: () => this.forgetNoteHeights(),
            });
            this.addCommand({
                id: "forget-collapse-state",
                name: "Forget collapse state",
                callback: () => this.forgetCollapseState(),
            });
        }

        this.addSettingTab(new DailyNotesStreamSettingTab(this.app, this));
    }

    /**
     * Folded sections move with a note when it is renamed, and are removed when
     * it is deleted, whether or not a stream is open.
     */
    private rememberCollapse(): void {
        const store = (this.collapseStore = new CollapsibleStateStore(this.app));
        const { vault, workspace } = this.app;
        this.registerEvent(vault.on("rename", (file, oldPath) => store.migrate(oldPath, file.path)));
        this.registerEvent(vault.on("delete", (file) => store.clearForFile(file.path)));
        workspace.onLayoutReady(() => store.retainOnly(new Set(vault.getMarkdownFiles().map((file) => file.path))));
    }

    /**
     * What the stream measured. A note's measurements move with it when it is
     * renamed, and are removed when it is deleted. An edit makes its heights
     * out of date (ADR 0017). Registered before any view opens, so a view that
     * hears about the edit finds no old heights.
     */
    private rememberLayout(): void {
        const memory = (this.layoutMemory = new LayoutMemory(this.app));
        const { vault, workspace } = this.app;
        this.register(() => memory.flush());
        this.registerEvent(vault.on("rename", (file, oldPath) => memory.rename(oldPath, file.path)));
        this.registerEvent(vault.on("delete", (file) => memory.forget(file.path)));
        this.registerEvent(vault.on("modify", (file) => memory.notes.forget(file.path)));
        workspace.onLayoutReady(() => memory.retainOnly(new Set(vault.getMarkdownFiles().map((file) => file.path))));
    }

    /**
     * Every open stream estimates its notes' heights again, as on a device that
     * never measured them.
     */
    private forgetNoteHeights(): void {
        this.layoutMemory.forgetAll();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_NOTES_STREAM)) {
            if (leaf.view instanceof DailyNotesStreamView) leaf.view.forgetHeights();
        }
    }

    /**
     * Every open stream re-renders with nothing folded. The keys saved by
     * builds before D-121 are removed too.
     */
    private forgetCollapseState(): void {
        this.collapseStore.forgetAll();
        removeLocalStorageKeys(this.app, isOldCollapseKey);
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_NOTES_STREAM)) {
            if (leaf.view instanceof DailyNotesStreamView) {
                leaf.view.refresh().catch((error) => {
                    console.error("DailyNotesStream: Failed to refresh view on forgetting collapse state", error);
                });
            }
        }
    }

    /**
     * Registered before any view opens, so when a view's own `resolved` handler
     * runs, the index already knows the links changed.
     */
    private indexBacklinks(): void {
        const { metadataCache } = this.app;
        this.backlinks = new BacklinkIndex(() => metadataCache.resolvedLinks);
        this.registerEvent(metadataCache.on("resolved", () => this.backlinks.invalidate()));
    }

    /**
     * Registered after `indexBacklinks`, so a view told about a change reads an
     * up-to-date index.
     */
    private followLinkChanges(): void {
        const { vault, metadataCache } = this.app;
        const changes = (this.linkChanges = new LinkChanges(
            () => metadataCache.resolvedLinks,
            () => readDateFormat(getDailyNoteSettings(this.app)).folder
        ));
        this.registerEvent(metadataCache.on("resolve", (file) => changes.onResolve(file.path)));
        this.registerEvent(metadataCache.on("resolved", () => changes.onResolved()));
        this.registerEvent(vault.on("delete", (file) => changes.onDelete(file.path)));
        this.registerEvent(vault.on("rename", (file, oldPath) => changes.onRename(oldPath, file.path)));
    }

    /**
     * Registered before any view opens, so a renamed note's empty-or-not result
     * has moved by the time a view checks.
     */
    private indexEmptyNotes(): void {
        const { vault, metadataCache } = this.app;
        const notes = (this.emptyNotes = new EmptyNotes(
            {
                read: (file) => vault.cachedRead(file),
                resolve: (linkpath) => metadataCache.getFirstLinkpathDest(linkpath, ""),
            },
            {
                load: (): unknown => this.app.loadLocalStorage(EMPTY_NOTES_KEY),
                save: (value) => this.app.saveLocalStorage(EMPTY_NOTES_KEY, value),
            },
            () => getDailyNoteSettings(this.app)
        ));
        this.register(() => notes.flush());
        this.registerEvent(vault.on("rename", (file, oldPath) => notes.rename(oldPath, file.path)));
        this.registerEvent(vault.on("delete", (file) => notes.forget(file.path)));
    }

    /**
     * Scrolls the stream to the note dated `day`, when the stream is the tab a
     * note would open in, and makes it the active tab again: a click in
     * Calendar made Calendar's the active one. A note the stream hides gets a
     * notice instead. Returns false when there is no stream there, or no note.
     */
    private async showDayInStream(day: Moment): Promise<boolean> {
        const { workspace } = this.app;
        const leaf = workspace.getMostRecentLeaf();
        if (!(leaf?.view instanceof DailyNotesStreamView)) return false;
        if (await leaf.view.showDay(day)) {
            workspace.setActiveLeaf(leaf, { focus: true });
            return true;
        }
        if (!this.streamNotes.hidesOn(day)) return false;
        new Notice(HIDDEN_NOTE);
        return true;
    }

    /** A jump only makes sense in the stream, so open it first. */
    private async promptJumpToDate() {
        const leaf = await this.activateView();
        if (leaf.view instanceof DailyNotesStreamView) leaf.view.promptJumpToDate();
    }

    /**
     * Opens the stream as `activateView` does, at `file`. A note the stream
     * hides gets a notice instead, and the reader stays on it.
     */
    private async showInStream(file: TFile, pane: PaneType | boolean = false) {
        if (!(await this.streamNotes.belongs(file))) {
            new Notice(HIDDEN_NOTE);
            return;
        }
        const leaf = await this.activateView(pane);
        if (leaf.view instanceof DailyNotesStreamView) await leaf.view.showNote(file);
    }

    /**
     * Opens the stream the way the graph opens: in the current tab, or in the
     * pane a Ctrl/Cmd-click asks for.
     */
    async activateView(pane: PaneType | boolean = false): Promise<WorkspaceLeaf> {
        const { workspace } = this.app;
        const leaf = workspace.getLeaf(pane);
        await leaf.setViewState({ type: VIEW_TYPE_DAILY_NOTES_STREAM, active: true });
        await workspace.revealLeaf(leaf);
        return leaf;
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            (await this.loadData()) as Partial<DailyNotesStreamSettings>
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);

        // Refresh every stream view.
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_NOTES_STREAM);
        for (const leaf of leaves) {
            if (leaf.view instanceof DailyNotesStreamView) {
                leaf.view.refresh().catch((error) => {
                    console.error("DailyNotesStream: Failed to refresh view on settings change", error);
                });
            }
        }
    }
}
