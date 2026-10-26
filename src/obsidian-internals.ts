import type { App, EventRef, Hotkey, ItemView, PaneType } from "obsidian";

/**
 * Parts of Obsidian that are not in its public API. All use of them is kept in
 * this file.
 */
type VaultInternal = {
    config?: { readableLineLength?: boolean };
    /**
     * Part of the public API. Read here only because the vault is reached
     * through this cast.
     */
    configDir: string;
    on(name: "raw", callback: (path: string) => unknown): EventRef;
};

/**
 * Gets the vault without the global `app`, which the compliance rules forbid.
 */
const vaultOf = (app: App) => (app as unknown as { vault?: VaultInternal }).vault;

/**
 * There is no public API for this. Obsidian applies "Readable line length" to
 * each MarkdownView, not to the page, so a custom ItemView reads the setting
 * itself. If the setting is missing, it is on, the default.
 */
export function getReadableLineLength(app: App): boolean {
    return vaultOf(app)?.config?.readableLineLength ?? true;
}

/**
 * Fires when anything in the vault's config folder is written. This is the only
 * way to know that Obsidian's daily notes format or folder changed. The
 * undocumented "raw" vault event fires for every file in the vault, so paths
 * are filtered here.
 */
export function onVaultConfigChange(app: App, handler: () => void): EventRef {
    const vault = vaultOf(app) as VaultInternal;
    const { configDir } = vault;
    return vault.on("raw", (path) => {
        if (path.startsWith(`${configDir}/`)) handler();
    });
}

/** A workspace event that is not in Obsidian's public API. */
type WorkspaceInternal = { on(name: "post-processor-change", callback: () => unknown): EventRef };

/**
 * Fires when what draws Markdown changes: Mermaid's "Allow", or a plugin adding
 * or removing a post-processor. Obsidian's own views draw again when it fires.
 */
export function onPostProcessorChange(app: App, handler: () => void): EventRef {
    return (app.workspace as unknown as WorkspaceInternal).on("post-processor-change", handler);
}

/**
 * The core plugins, which are not in the public API, found through the plugin
 * registry.
 */
type InternalPlugins = {
    getPluginById(id: "global-search"): { instance?: { openGlobalSearch(query: string): void } } | undefined;
    getPluginById(id: "daily-notes"): { instance?: { options?: DailyNoteSettings } } | undefined;
};

/**
 * Where daily notes are and how they are named, as the user set it. Settings
 * not set are missing.
 */
export interface DailyNoteSettings {
    format?: string;
    folder?: string;
    template?: string;
}

/**
 * Periodic Notes' settings. While its daily notes are on, they replace the core
 * plugin's.
 */
type CommunityPlugins = {
    getPlugin(id: "periodic-notes"): { settings?: { daily?: DailyNoteSettings & { enabled?: boolean } } } | null;
};

/**
 * There is no public API for this. The daily notes settings come from Periodic
 * Notes while its daily notes are on, otherwise from the core plugin. If
 * Obsidian removes these internals, nothing is set.
 */
export function getDailyNoteSettings(app: App): DailyNoteSettings {
    const { internalPlugins, plugins } = app as unknown as {
        internalPlugins?: InternalPlugins;
        plugins?: CommunityPlugins;
    };
    const periodic = plugins?.getPlugin("periodic-notes")?.settings?.daily;
    const { format, folder, template } =
        (periodic?.enabled ? periodic : internalPlugins?.getPluginById("daily-notes")?.instance?.options) ?? {};
    return { format, folder, template };
}

/**
 * The core search view. When we open it in its own pane, we have to set its
 * query ourselves.
 */
type SearchView = { setQuery?(query: string): void };

/**
 * A tag written the way the search pane writes it. A tag with a space must be
 * quoted.
 */
function tagQuery(tag: string): string {
    const name = tag.startsWith("#") ? tag : `#${tag}`;
    return /\s/.test(name) ? `tag:"${name}"` : `tag:${name}`;
}

/**
 * Searches for a tag, the way clicking a tag anywhere else in Obsidian does: in
 * the sidebar, or, if `pane` is given, in a pane of its own. The search pane is
 * not in the public API, so the core plugin is found by its id. If the user
 * turned it off, nothing happens, rather than an error.
 */
export async function openTagSearch(app: App, tag: string, pane: PaneType | boolean = false): Promise<void> {
    const plugins = (app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
    const search = plugins?.getPluginById("global-search")?.instance;
    if (!search) return;
    const query = tagQuery(tag);
    if (!pane) {
        search.openGlobalSearch(query);
        return;
    }
    const { workspace } = app;
    // For Keymap, `true` means the default new pane, which is a tab.
    const leaf = workspace.getLeaf(pane === true ? "tab" : pane);
    await leaf.setViewState({ type: "search", active: true });
    (leaf.view as SearchView).setQuery?.(query);
}

/**
 * Not in the public API: the type manager finds the widget that draws a
 * property's row.
 */
type MetadataTypeManager = {
    getTypeInfo?(key: string, value: unknown): { expected: { icon: string } | null; inferred: { icon: string } | null };
};

/**
 * The icon Obsidian's own properties panel shows for a property: the icon of
 * the type set for it, otherwise of the type its value suggests. Null if
 * Obsidian removes this internal, so the caller can use another icon.
 */
export function getPropertyIcon(app: App, key: string, value: unknown): string | null {
    const manager = (app as unknown as { metadataTypeManager?: MetadataTypeManager }).metadataTypeManager;
    const info = manager?.getTypeInfo?.(key, value);
    return (info?.expected ?? info?.inferred)?.icon ?? null;
}

/**
 * The command for "Search current file". The stream opens its search on this
 * command's hotkey.
 */
const SEARCH_COMMAND = "editor:open-search";

/** Obsidian's default hotkey for it, in case the hotkey manager is removed. */
const DEFAULT_SEARCH_HOTKEYS: Hotkey[] = [{ modifiers: ["Mod"], key: "F" }];

/**
 * Not in the public API: the hotkey manager holds the user's hotkeys, and
 * Obsidian's.
 */
type HotkeyManager = {
    getHotkeys(id: string): Hotkey[] | undefined;
    getDefaultHotkeys(id: string): Hotkey[] | undefined;
};

/**
 * The current hotkeys for "Search current file": the user's, even if they set
 * none, otherwise Obsidian's default.
 */
export function getSearchHotkeys(app: App): Hotkey[] {
    const manager = (app as unknown as { hotkeyManager?: HotkeyManager }).hotkeyManager;
    if (!manager) return DEFAULT_SEARCH_HOTKEYS;
    return manager.getHotkeys(SEARCH_COMMAND) ?? manager.getDefaultHotkeys(SEARCH_COMMAND) ?? DEFAULT_SEARCH_HOTKEYS;
}

/**
 * Not in the public API: the title Obsidian draws in a view's header. Null if
 * Obsidian removes it.
 */
export function getViewTitle(view: ItemView): HTMLElement | null {
    return (view as unknown as { titleEl?: HTMLElement }).titleEl ?? null;
}

/**
 * Removes this vault's localStorage keys whose names `matches` accepts, and
 * returns how many. No public API lists them: `saveLocalStorage` puts the
 * vault's `appId`, which is not public, in front of each name. In a vault
 * without one, nothing is removed.
 */
export function removeLocalStorageKeys(
    app: App,
    matches: (name: string) => boolean,
    storage: Storage = window.localStorage
): number {
    const { appId } = app as unknown as { appId?: string };
    if (!appId) return 0;
    const prefix = `${appId}-`;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
        // Stryker disable next-line ConditionalExpression: every index below the length has a key.
        (key): key is string => key !== null && key.startsWith(prefix) && matches(key.slice(prefix.length))
    );
    for (const key of keys) storage.removeItem(key);
    return keys.length;
}
