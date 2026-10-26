import { TFile } from "./obsidian";
import type { DailyNoteSettings } from "../../src/obsidian-internals";

/** The vault's files, whatever their extension. */
let mockFiles: TFile[] = [];
let mockSettings: DailyNoteSettings = {
    format: "YYYY-MM-DD",
    folder: "Notes",
};

let settingsCallCount = 0;

/** The daily notes settings, as `getDailyNoteSettings` would read them. */
export function __mockSettings() {
    settingsCallCount++;
    return mockSettings;
}

export function __getSettingsCallCount() {
    return settingsCallCount;
}

export function __resetSettingsCallCount() {
    settingsCallCount = 0;
}

// Helpers to set up the state for a test
export function __setMockNotes(paths: string[]) {
    mockFiles = paths.map((path) => new TFile(path));
}

/** What `Vault.getMarkdownFiles()` would return for them. */
export function __mockMarkdownFiles(): TFile[] {
    return mockFiles.filter((file) => file.extension === "md");
}

export function __setMockSettings(settings: DailyNoteSettings) {
    mockSettings = settings;
}
