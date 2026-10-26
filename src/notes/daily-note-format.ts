import { normalizePath } from "obsidian";
import type { DailyNoteSettings } from "../obsidian-internals";

/** How daily notes are named, as Obsidian's daily notes settings say. */
export interface DateFormat {
    /**
     * The full format, which may include folders (for example
     * `YYYY/MM/YYYY-MM-DD`).
     */
    path: string;
    /** Only the last part, which the file's name must match. */
    basename: string;
    /**
     * The daily notes folder, without slashes at the start or end. "" if not
     * set.
     */
    folder: string;
}

export function readDateFormat(settings: DailyNoteSettings): DateFormat {
    const path = settings.format || "YYYY-MM-DD";
    // normalizePath turns an unset folder into "/", and removes the slashes at
    // the ends of any other folder.
    const folder = normalizePath(settings.folder?.trim() ?? "");
    return {
        path,
        basename: path.split("/").pop() || "YYYY-MM-DD",
        folder: folder === "/" ? "" : folder,
    };
}
