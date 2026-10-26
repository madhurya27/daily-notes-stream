/**
 * Obsidian includes moment and exports it, so the mock returns the real one.
 * The plugin reads the vault's own date format, and a fake that only understood
 * ISO would pass tests that a `DD-MM-YYYY` vault fails.
 */
export { default as moment } from "moment";
import { parse, stringify } from "yaml";

// The real type declarations, imported around the `obsidian` alias. The mock's
// signatures use them, so src's types are checked against the mock the same way
// they are against the app.
import type {
    App,
    Command,
    EventRef,
    FileStats,
    HoverLinkSource,
    KeymapContext,
    PluginManifest,
    Scope as AppScope,
    SettingDefinitionItem,
    TFolder,
    UserEvent,
    Vault,
    View,
    ViewState,
    WorkspaceLeaf as AppLeaf,
} from "obsidian/obsidian";
export type {
    App,
    CachedMetadata,
    Debouncer,
    EventRef,
    Hotkey,
    HoverLinkSource,
    HoverParent,
    HoverPopover,
    Modifier,
    PaneType,
    PluginManifest,
    Pos,
    SettingDefinitionItem,
    View,
} from "obsidian/obsidian";

/**
 * A link split into the note it names and its #heading or #^block, keeping the
 * #.
 */
export function parseLinktext(linktext: string): { path: string; subpath: string } {
    const hash = linktext.indexOf("#");
    return hash === -1
        ? { path: linktext, subpath: "" }
        : { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}

/** Like Obsidian's own: the root, or an empty path, is "/". */
export function normalizePath(path: string): string {
    return path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "") || "/";
}

export class TAbstractFile {
    path: string;
    parent: TFolder | null = null;
    name: string;
    vault!: Vault;
    constructor(path: string) {
        this.path = path;
        this.name = path.split("/").pop() || "";
    }
}

export class TFile extends TAbstractFile {
    basename: string;
    extension: string;
    stat: FileStats = { ctime: 0, mtime: 0, size: 0 };
    constructor(path: string) {
        super(path);
        // Split on the last dot. Files without a dot get the extension "".
        const dot = this.name.lastIndexOf(".");
        this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
        this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
    }
}

class MockLeaf {
    view!: View;
    app: App;
    constructor(app: App) {
        this.app = app;
    }
    setViewState(_state: ViewState) {
        return Promise.resolve();
    }
    openFile(_file: TFile) {
        return Promise.resolve();
    }
}

/**
 * Uses the app's leaf type. src also gets leaves through `app.workspace`, which
 * returns the real type, so a separate mock type would not match.
 */
export const WorkspaceLeaf = MockLeaf as unknown as new (app: App) => AppLeaf;
export type WorkspaceLeaf = AppLeaf;

/**
 * Obsidian's parent and child lifecycle, which is what frees a note's drawn
 * content. `children` and `loaded` let tests see it.
 */
export class Component {
    children: Component[] = [];
    loaded = false;

    load() {
        if (this.loaded) return;
        this.loaded = true;
        for (const child of this.children) child.load();
    }

    unload() {
        if (!this.loaded) return;
        this.loaded = false;
        while (this.children.length) this.removeChild(this.children[0]!);
        for (const cb of this.cleanups.splice(0)) cb();
        this.onunload();
    }

    onunload(): void {}

    addChild<T extends Component>(child: T): T {
        this.children.push(child);
        if (this.loaded) child.load();
        return child;
    }

    removeChild<T extends Component>(child: T): T {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
        child.unload();
        return child;
    }

    private cleanups: (() => unknown)[] = [];

    /** Runs `cb` when this component unloads. */
    register(cb: () => unknown) {
        this.cleanups.push(cb);
    }

    registerDomEvent<K extends keyof HTMLElementEventMap>(
        el: HTMLElement,
        type: K,
        cb: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions
    ) {
        el.addEventListener(type, cb, options);
    }

    registerEvent(_ref: EventRef) {}
}

/** A view is a Component, and owns what its notes register. */
export class ItemView extends Component {
    /** Obsidian's default: a view the workspace never navigates. */
    navigation = false;
    contentEl: HTMLElement;
    /**
     * Obsidian passes a view's scope the keys pressed while its leaf is active.
     */
    scope: Scope | null = null;
    containerEl: HTMLElement;
    app: App;
    /** View actions, recorded so tests can call what onOpen() set up. */
    actions: { icon: string; title: string; callback: (evt: MouseEvent) => unknown }[] = [];
    constructor(leaf: WorkspaceLeaf) {
        super();
        this.app = (leaf as unknown as MockLeaf).app;
        this.containerEl = document.createElement("div");
        this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
        this.load();
    }
    getEphemeralState(): Record<string, unknown> {
        return {};
    }
    setEphemeralState(_state: unknown): void {}
    addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown) {
        this.actions.push({ icon, title, callback });
        return document.createElement("div");
    }
}

/** Records every notice shown, so tests can check the message. */
export class Notice {
    static shown: string[] = [];
    static reset() {
        Notice.shown = [];
    }
    constructor(message: string) {
        Notice.shown.push(message);
    }
}

type KeyHandler = (evt: KeyboardEvent, ctx: KeymapContext) => unknown;

/** Obsidian's keymap scope. The modal owns it, so it needs no cleanup. */
export class Scope {
    registered: { modifiers: string[] | null; key: string | null; callback: KeyHandler }[] = [];
    constructor(readonly parent?: AppScope | Scope) {}
    register(modifiers: string[] | null, key: string | null, callback: KeyHandler) {
        this.registered.push({ modifiers, key, callback });
        return callback;
    }
}

export class Modal {
    app: App;
    scope = new Scope();
    contentEl: HTMLElement = document.createElement("div");
    titleEl: HTMLElement = document.createElement("div");
    constructor(app: App) {
        this.app = app;
    }
    setTitle(title: string) {
        this.titleEl.textContent = title;
        return this;
    }
    open() {
        this.onOpen();
    }
    close() {
        this.onClose();
    }
    onOpen() {}
    onClose() {}
}

/**
 * Obsidian's suggester: a prompt input where every key runs `getSuggestions`
 * again and draws the list again. The real one handles the keyboard and the
 * scrolling. A test only needs to type a query and get a choice, so `type` and
 * `choose` act as the reader.
 */
export abstract class SuggestModal<T> extends Modal {
    inputEl: HTMLInputElement = document.createElement("input");
    resultContainerEl: HTMLElement = document.createElement("div");
    /** How many suggestions the list holds. The subclass lowers it. */
    limit = 100;
    emptyStateText = "No results";
    private suggestions: T[] = [];

    constructor(app: App) {
        super(app);
        const container = this.contentEl.createDiv({ cls: "prompt-input-container" });
        container.appendChild(this.inputEl);
        this.contentEl.appendChild(this.resultContainerEl);
        this.inputEl.addEventListener("input", () => this.type(this.inputEl.value));
    }

    setPlaceholder(text: string) {
        this.inputEl.placeholder = text;
    }

    abstract getSuggestions(query: string): T[];
    abstract renderSuggestion(value: T, el: HTMLElement): void;
    abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;

    /**
     * Like Obsidian's own: shown, with the search field focused and the full
     * list drawn.
     */
    open() {
        document.body.appendChild(this.contentEl);
        super.open();
        this.inputEl.focus();
    }

    close() {
        super.close();
        this.contentEl.remove();
    }

    onOpen() {
        this.type("");
    }

    /** Runs the query the reader typed and draws the list again. */
    type(query: string) {
        this.inputEl.value = query;
        this.suggestions = this.getSuggestions(query).slice(0, this.limit);
        this.resultContainerEl.empty();
        for (const suggestion of this.suggestions) {
            this.renderSuggestion(suggestion, this.resultContainerEl.createDiv({ cls: "suggestion-item" }));
        }
    }

    /**
     * Chooses the nth suggestion, as clicking it or pressing Enter on it would.
     */
    choose(index = 0) {
        const suggestion = this.suggestions[index];
        if (suggestion === undefined) return;
        this.onChooseSuggestion(suggestion, new KeyboardEvent("keydown"));
    }
}

export const MarkdownRenderer = {
    render: (_app: App, _markdown: string, _el: HTMLElement, _sourcePath: string, _component: Component) =>
        Promise.resolve(),
};

export const setIcon = (el: HTMLElement, iconName: string) => {
    // Record the icon so tests can check it. The real setIcon adds an SVG.
    el.dataset.icon = iconName;
};

export class MarkdownView {
    file: TFile | null = null;
}

/** A menu item as the page would show it. `click` runs its handler. */
export class MenuItem {
    title = "";
    icon = "";
    section = "";
    private handler: ((evt: MouseEvent | KeyboardEvent) => unknown) | null = null;
    setTitle(title: string) {
        this.title = title;
        return this;
    }
    setIcon(icon: string) {
        this.icon = icon;
        return this;
    }
    setSection(section: string) {
        this.section = section;
        return this;
    }
    onClick(handler: (evt: MouseEvent | KeyboardEvent) => unknown) {
        this.handler = handler;
        return this;
    }
    click() {
        this.handler?.(new MouseEvent("click"));
    }
}

/** Records its items and where it was shown, instead of drawing anything. */
export class Menu {
    readonly items: MenuItem[] = [];
    shownAt: MouseEvent | null = null;
    addItem(cb: (item: MenuItem) => unknown) {
        const item = new MenuItem();
        cb(item);
        this.items.push(item);
        return this;
    }
    showAtMouseEvent(evt: MouseEvent) {
        this.shownAt = evt;
        return this;
    }
}

/**
 * Reads modifier keys the way Obsidian does: Cmd/Ctrl-click or a middle click
 * opens a tab.
 */
export class Keymap {
    static isModEvent(evt?: UserEvent | null): "tab" | "split" | "window" | boolean {
        if (!evt) return false;
        const mod = evt.ctrlKey || evt.metaKey;
        if (mod && evt.altKey && evt.shiftKey) return "window";
        if (mod && evt.altKey) return "split";
        if (mod || (evt instanceof MouseEvent && evt.button === 1)) return "tab";
        return false;
    }
}

export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, timeout = 0, resetTimer = false) {
    let handle: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: T;
    const debounced = (...args: T) => {
        lastArgs = args;
        if (handle !== null) {
            if (!resetTimer) return debounced;
            clearTimeout(handle);
        }
        handle = setTimeout(() => {
            handle = null;
            cb(...lastArgs);
        }, timeout);
        return debounced;
    };
    debounced.cancel = () => {
        if (handle !== null) clearTimeout(handle);
        handle = null;
        return debounced;
    };
    debounced.run = () => {
        if (handle !== null) {
            clearTimeout(handle);
            handle = null;
            cb(...lastArgs);
        }
        return undefined;
    };
    return debounced;
}

export class PluginSettingTab {
    app: App;
    containerEl: HTMLElement = document.createElement("div");
    constructor(app: App, _plugin: Plugin) {
        this.app = app;
    }
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [];
    }
    setControlValue(_key: string, _value: unknown): void | Promise<void> {}
}

export class Plugin extends Component {
    app: App;
    manifest: PluginManifest;
    /** Registrations, recorded so tests can call what onload() set up. */
    views: Record<string, (leaf: AppLeaf) => ItemView> = {};
    ribbonIcons: { icon: string; title: string; callback: (evt: MouseEvent) => unknown }[] = [];
    commands: Command[] = [];
    settingTabs: PluginSettingTab[] = [];
    hoverLinkSources: Record<string, HoverLinkSource> = {};
    data: unknown = null;

    constructor(app: App, manifest: PluginManifest) {
        super();
        this.app = app;
        this.manifest = manifest;
    }
    loadData() {
        return Promise.resolve(this.data);
    }
    saveData(data: unknown) {
        this.data = data;
        return Promise.resolve();
    }
    registerHoverLinkSource(id: string, info: HoverLinkSource) {
        this.hoverLinkSources[id] = info;
    }
    registerView(type: string, cb: (leaf: AppLeaf) => ItemView) {
        this.views[type] = cb;
    }
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown) {
        this.ribbonIcons.push({ icon, title, callback });
        return document.createElement("div");
    }
    addCommand(cmd: Command) {
        this.commands.push(cmd);
        return cmd;
    }
    addSettingTab(tab: PluginSettingTab) {
        this.settingTabs.push(tab);
    }
}

/** Can be changed, so a test can act as either platform. */
export const Platform = { isMacOS: true, isMobile: false, isPhone: false, isIosApp: false };

/**
 * Obsidian's own YAML functions, which read and write YAML like the real ones.
 */
export function parseYaml(text: string): unknown {
    return parse(text);
}

export function stringifyYaml(obj: unknown): string {
    return stringify(obj);
}
