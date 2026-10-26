import { isRecord, parseDefinition } from "./bases-as-cards";

/**
 * Bases' own minimum and maximum column widths
 * (`--bases-table-column-min-width` and `-max-width`).
 */
const MIN_COLUMN_PX = 40;
const MAX_COLUMN_PX = 300;

/**
 * Bases' labels for the file properties whose label differs from their name.
 */
const FILE_LABELS: Record<string, string> = {
    "file.name": "file name",
    "file.path": "file path",
    "file.ext": "file extension",
    "file.size": "file size",
    "file.ctime": "created time",
    "file.mtime": "modified time",
};

/** How wide a header is drawn: its label's text, plus padding, icon and gap. */
export interface HeaderMetrics {
    chrome: number;
    textWidth(label: string): number;
}

/**
 * The narrowest the view's table can be drawn, using only its definition. Bases
 * makes a column as wide as its header or its longest value, whichever is
 * wider. The values need the query to run, so the headers give the minimum. 0
 * if the view draws no table.
 */
export function narrowestTableWidth(definition: string, view: string | undefined, headers: HeaderMetrics): number {
    const parsed = parseDefinition(definition);
    // Stryker disable next-line ArrayDeclaration: a first view that is not a record draws no table, the same as no view.
    const views = Array.isArray(parsed?.views) ? (parsed.views as unknown[]) : [];
    const shown = views.find((v) => isRecord(v) && v.name === view) ?? views[0];
    if (!isRecord(shown) || shown.type !== "table" || !Array.isArray(shown.order)) return 0;

    const sizes = isRecord(shown.columnSize) ? shown.columnSize : {};
    const properties = isRecord(parsed!.properties) ? parsed!.properties : {};
    return (shown.order as unknown[]).map(String).reduce((sum, column) => {
        const size = sizes[column];
        if (typeof size === "number") return sum + Math.max(MIN_COLUMN_PX, size);
        const header = headers.textWidth(label(column, properties)) + headers.chrome + 1;
        return sum + Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, header));
    }, 0);
}

/** The header Bases draws for a column. */
function label(column: string, properties: Record<string, unknown>): string {
    const bare = column.replace(/^(note|formula|file)\./, "");
    for (const key of [column, bare, `note.${bare}`]) {
        const configured = properties[key];
        if (isRecord(configured) && typeof configured.displayName === "string") return configured.displayName;
    }
    return FILE_LABELS[column] ?? bare;
}
