import { App, Platform, SuggestModal, setIcon } from "obsidian";
import type { DailyNoteService } from "../notes/daily-note-service";
import { moment, type Moment } from "../notes/moment";

/** One format every reader can use, whatever format their vault uses. */
const ISO_FORMAT = "YYYY-MM-DD";

/**
 * About two months of notes when the list opens, so it is drawn fast on a phone
 * (D-128).
 */
export const JUMP_OPEN_LIMIT = 62;
/** About a year once the reader types, so typing a year lists all its notes. */
export const JUMP_SEARCH_LIMIT = 366;

/**
 * A date the reader can jump to. `fallback` is set when no note has that date.
 */
interface JumpChoice {
    date: Moment;
    /** The date written as this vault's file names write it. */
    label: string;
    /** What the jump will do instead, when there is no note on the date. */
    fallback: string | null;
    /**
     * The label in lower case, and the ISO date: the text a query is searched
     * in, built once each time the list opens.
     */
    searchText: string;
}

/**
 * Lists the days this vault has a note for, so a jump goes to a note the reader
 * chose, not quietly to the nearest older note. A date with no note can still
 * be chosen, as one entry that says what it will do.
 */
export class JumpToDateModal extends SuggestModal<JumpChoice> {
    private readonly service: DailyNoteService;
    private readonly onSubmit: (_target: Moment) => void;
    /**
     * Copied when the list opens, because the vault cannot change while a modal
     * is open.
     */
    private readonly choices: JumpChoice[];

    constructor(app: App, service: DailyNoteService, onSubmit: (_target: Moment) => void) {
        super(app);
        this.service = service;
        this.onSubmit = onSubmit;
        this.limit = JUMP_SEARCH_LIMIT;
        this.choices = service.dates().map((date) => this.choice(date, null));

        this.setPlaceholder(`Jump to a date, e.g. ${service.formatDate(moment())}`);
        this.emptyStateText = "No daily note, and no date to jump to.";
        this.addCalendarButton();
    }

    /**
     * On a phone, the list opens without the keyboard covering half of it. The
     * reader taps the search field to type, or taps the calendar.
     */
    open(): void {
        super.open();
        if (Platform.isMobile) this.inputEl.blur();
    }

    getSuggestions(query: string): JumpChoice[] {
        const needle = query.trim().toLowerCase();
        if (!needle) return this.choices.slice(0, JUMP_OPEN_LIMIT);

        const matches = this.choices.filter((choice) => choice.searchText.includes(needle));
        if (matches.length > 0) return matches;

        const typed = this.readDate(query.trim());
        return typed ? [this.choice(typed, "Jump to the nearest older note")] : [];
    }

    renderSuggestion(choice: JumpChoice, el: HTMLElement): void {
        el.createDiv({ text: choice.fallback ? `${choice.label} has no note` : choice.label });
        if (choice.fallback) el.createDiv({ cls: "daily-notes-jump-fallback", text: choice.fallback });
    }

    onChooseSuggestion(choice: JumpChoice): void {
        this.onSubmit(choice.date);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /** Reads the date in this vault's own format first, then as ISO. */
    private readDate(text: string): Moment | null {
        const own = this.service.parseNoteDate(text);
        if (own) return own;
        const iso = moment(text, ISO_FORMAT, true);
        return iso.isValid() ? iso : null;
    }

    private choice(date: Moment, fallback: string | null): JumpChoice {
        const label = this.service.formatDate(date);
        // Both, because the reader may type an ISO date, whatever their file
        // names look like. The separator stops a query from matching across the
        // two.
        return { date, label, fallback, searchText: `${label.toLowerCase()}\u0000${date.format(ISO_FORMAT)}` };
    }

    /**
     * The device's own date picker, next to the search field, not instead of
     * it. Typing is faster for a date the reader knows, and picking is easier
     * for one they are looking for. What the reader taps on the icon is the
     * date input itself, invisible over the icon: iOS has `showPicker()` but
     * opens nothing from it, only from a tap on the input. Desktop needs
     * `showPicker()`, because a click on a date input's text only focuses it.
     */
    private addCalendarButton(): void {
        // SuggestModal always puts its input inside the prompt's container. The
        // cast states this, instead of checking for it.
        const container = this.inputEl.parentElement as HTMLElement;
        const icon = container.createDiv({ cls: "clickable-icon daily-notes-jump-calendar" });
        setIcon(icon, "calendar");
        const picker = icon.createEl("input", {
            type: "date",
            cls: "daily-notes-jump-picker",
            attr: { "aria-label": "Pick a date" },
        });

        picker.onclick = () => {
            if (typeof picker.showPicker === "function") picker.showPicker();
        };
        // Set as a property, not registered, because the picker is removed with
        // the modal, and one element only needs one handler.
        picker.onchange = () => {
            // Stryker disable next-line BooleanLiteral: a date input's value is a complete ISO date or empty.
            const picked = moment(picker.value, ISO_FORMAT, true);
            if (!picked.isValid()) return;
            // Put the date in the search field instead of jumping at once, so
            // the reader sees what they picked, and can correct it without
            // opening the picker again. The focus stays where it is: iOS fires
            // this when its picker opens, and moving the focus would close it.
            // Enter still reaches the modal from the picker.
            this.inputEl.value = this.service.formatDate(picked);
            this.inputEl.dispatchEvent(new Event("input"));
        };
    }
}
