import { Platform, type Hotkey, type Modifier } from "obsidian";

type Physical = Exclude<Modifier, "Mod">;

/** Mod is Cmd on macOS and Ctrl everywhere else. */
const physical = (modifier: Modifier): Physical => {
    if (modifier !== "Mod") return modifier;
    return Platform.isMacOS ? "Meta" : "Ctrl";
};

const held = (evt: KeyboardEvent): Record<Physical, boolean> => ({
    Ctrl: evt.ctrlKey,
    Meta: evt.metaKey,
    Shift: evt.shiftKey,
    Alt: evt.altKey,
});

/**
 * Whether `evt` is exactly the key combination `hotkey` names: its key and
 * modifiers, and no other modifiers.
 */
export function matchesHotkey(evt: KeyboardEvent, hotkey: Hotkey): boolean {
    if (evt.key.toLowerCase() !== hotkey.key.toLowerCase()) return false;
    const named = new Set(hotkey.modifiers.map(physical));
    return Object.entries(held(evt)).every(([modifier, down]) => down === named.has(modifier as Physical));
}
