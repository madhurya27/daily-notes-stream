import { Component, TFile, setIcon } from "obsidian";
import { CollapsibleStateStore } from "./collapse-store";
import { FarRuns } from "./far-runs";

/**
 * Keeps letters, their accents and digits in any script. ASCII text gets the
 * same slug as before.
 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "");
}

/**
 * The key kept for the properties panel. A heading's slug can never contain
 * ":".
 */
export const PROPERTIES_SECTION_KEY = ":properties";

/** The key kept for the linked mentions footer. */
export const LINKED_MENTIONS_SECTION_KEY = ":linked-mentions";

/**
 * If a note was not written for this long, its missing sections were deleted,
 * not in the middle of an edit (D-027).
 */
const SETTLED_AFTER_MS = 24 * 60 * 60 * 1000;

/** A section whose folded state is saved for each note. */
export interface CollapsibleSection {
    filePath: string;
    sectionKey: string;
    /** Used until the user folds or unfolds the section for the first time. */
    defaultCollapsed: boolean;
    /** Applies the state to the DOM. */
    apply(collapsed: boolean): void;
    /** Whether collapsing the section hides `node`. */
    hides(node: Node): boolean;
}

/**
 * A section with its fold arrow. Search opens it; drawing the note again closes
 * it again or gives it a new key.
 */
interface Fold {
    section: CollapsibleSection;
    /** Shows the section folded or not, without saving it. */
    show(collapsed: boolean): void;
}

/**
 * A section's key: its slug, under the heading above it, numbered if repeated.
 */
type KeyFor = (el: Element, slug: string) => string;

/** The fold arrows of folded sections match this, so a query can find them. */
const COLLAPSED_CHEVRON = '.collapse-indicator[aria-expanded="false"]';

/**
 * Adds fold arrows to headings and list items, and saves whether each is
 * folded, for each note.
 */
export class CollapsibleManager {
    constructor(
        private readonly store: CollapsibleStateStore,
        /**
         * Parts of notes the stream hid because they were far away. A section
         * shows them before it opens or closes (ADR 0021).
         */
        readonly farRuns: FarRuns = new FarRuns()
    ) {}

    /**
     * Maps each element to its toggle. Weak, so elements removed when a note is
     * drawn again can be freed.
     */
    private readonly toggles = new WeakMap<HTMLElement, () => void>();
    /** Maps each fold arrow to its section. */
    private readonly sections = new WeakMap<Element, Fold>();
    /**
     * Maps each foldable element to its section, so a note drawn again in place
     * can tell kept elements from new ones.
     */
    private readonly keyed = new WeakMap<HTMLElement, Fold>();

    /**
     * One pair of listeners for the whole stream, so a fold arrow drawn again
     * needs no listener of its own.
     */
    delegate(component: Component, root: HTMLElement): void {
        component.registerDomEvent(root, "click", (evt) => {
            const toggle = this.toggleFor(evt.target);
            if (!toggle) return;
            evt.stopPropagation();
            toggle();
        });

        component.registerDomEvent(root, "keydown", (evt) => {
            if (evt.key !== "Enter" && evt.key !== " ") return;
            const toggle = this.toggleFor(evt.target);
            if (!toggle) return;
            evt.preventDefault(); // Otherwise Space would scroll the stream.
            evt.stopPropagation();
            toggle();
        });
    }

    /**
     * Makes a second element fold the same section: the properties heading row.
     * Obsidian hides its arrow unless the pointer is over it, so on a phone
     * there would be nothing to tap.
     */
    attachCollapseHost(host: HTMLElement, toggle: () => void): void {
        this.toggles.set(host, toggle);
    }

    /**
     * The toggle of the nearest element that an event happened in, if it has
     * one. Going up from the target finds the arrow before the row that also
     * has the toggle, so a click on either runs the toggle exactly once.
     */
    private toggleFor(target: EventTarget | null): (() => void) | undefined {
        let el = target as HTMLElement | null;
        while (el) {
            const toggle = this.toggles.get(el);
            if (toggle) return toggle;
            el = el.parentElement;
        }
        return undefined;
    }

    /**
     * Binds the toggle to the arrow only: a click on a heading's text, or on a
     * link in it, must not fold it. Returns the toggle, so other elements can
     * use it too.
     */
    attachCollapseToggle(host: HTMLElement, section: CollapsibleSection): () => void {
        const indicator = createSpan();
        indicator.addClass("collapse-indicator");
        indicator.setAttribute("role", "button");
        indicator.setAttribute("tabindex", "0");
        setIcon(indicator, "chevron-right");
        host.prepend(indicator);

        let collapsed = this.store.collapsedOr(section.filePath, section.sectionKey, section.defaultCollapsed);
        // The DOM starts unfolded. Unfolding it again would show content hidden
        // by a folded parent.
        if (collapsed) section.apply(true);
        indicator.setAttribute("aria-expanded", String(!collapsed));

        const set = (next: boolean) => {
            collapsed = next;
            section.apply(collapsed);
            indicator.setAttribute("aria-expanded", String(!collapsed));
        };
        const toggle = () => {
            set(!collapsed);
            this.store.setCollapsed(section.filePath, section.sectionKey, collapsed);
        };

        this.toggles.set(indicator, toggle);
        const fold = { section, show: set };
        this.keyed.set(host, fold);
        this.sections.set(indicator, fold);
        return toggle;
    }

    /**
     * Whether a folded section, or a part hidden because it is far away, hides
     * `node`.
     */
    folds(node: Node): boolean {
        return this.farRuns.hides(node) || this.foldsAround(node).length > 0;
    }

    /**
     * Unfolds every folded section that hides `node`, without saving it, as
     * Obsidian's reading view does for a search match (D-024). Also shows the
     * hidden part it is in.
     */
    unfold(node: Node): void {
        this.farRuns.reveal(node);
        for (const fold of this.foldsAround(node)) fold.show(false);
    }

    private foldsAround(node: Node): Fold[] {
        const root = node.getRootNode() as ParentNode;
        return Array.from(root.querySelectorAll(COLLAPSED_CHEVRON))
            .map((chevron) => this.sections.get(chevron))
            .filter((fold): fold is Fold => fold !== undefined && fold.section.hides(node));
    }

    /**
     * Adds a fold arrow to every heading and nested list. Returns their section
     * keys.
     */
    makeCollapsible(contentEl: HTMLElement, filePath: string): string[] {
        const above = this.headingsAbove(contentEl);
        // Shared by headings and lists, so every key in a note is unique.
        const seenKeys = new Map<string, number>();
        const keyFor: KeyFor = (el, slug) => {
            const heading = above.get(el);
            return this.uniqueKey(heading === undefined ? slug : `${heading}/${slug}`, seenKeys);
        };
        return [...this.processHeaders(contentEl, filePath, keyFor), ...this.processLists(contentEl, filePath, keyFor)];
    }

    /**
     * After sections are drawn again in place (ADR 0019): adds arrows to what
     * is new, and folds each folded section again over it.
     */
    refreshCollapsible(contentEl: HTMLElement, filePath: string): string[] {
        const keys = this.makeCollapsible(contentEl, filePath);
        for (const chevron of Array.from(contentEl.querySelectorAll(COLLAPSED_CHEVRON))) {
            this.sections.get(chevron)?.show(true);
        }
        return keys;
    }

    /**
     * Maps each heading and list item to the slug of the heading it is under.
     * So repeated text is only numbered among the items under the same heading,
     * and deleting one under another heading does not pass its saved state on.
     * No slug contains "/".
     */
    private headingsAbove(contentEl: HTMLElement): Map<Element, string> {
        const above = new Map<Element, string>();
        // Stryker disable next-line ArrayDeclaration: an extra entry has no slug, so it affects no key.
        const open: { level: number; slug: string }[] = [];
        for (const el of Array.from(contentEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, li"))) {
            const level = this.headingLevel(el);
            // Stryker disable next-line ConditionalExpression: a list item's parent is a list, never an item.
            if (level !== null && el.parentElement!.tagName === "LI") continue;
            while (level !== null && open.length > 0 && open[open.length - 1]!.level >= level) open.pop();
            const nearest = open[open.length - 1];
            if (nearest) above.set(el, nearest.slug);
            if (level !== null) open.push({ level, slug: slugify(el.getText()) });
        }
        return above;
    }

    /**
     * Whether `el` already has its arrow. If its key changed, because a section
     * with the same text was added or removed before it, it takes the new key
     * and that key's saved state, as drawing the whole note would.
     */
    private kept(el: HTMLElement, key: string): boolean {
        const fold = this.keyed.get(el);
        if (!fold) return false;
        const { section } = fold;
        if (section.sectionKey !== key) {
            section.sectionKey = key;
            fold.show(this.store.collapsedOr(section.filePath, key, section.defaultCollapsed));
        }
        return true;
    }

    /**
     * Forgets saved sections that `file` no longer has. The panels' keys are
     * kept, because a hidden panel draws no key.
     */
    forgetRemovedSections(file: TFile, sectionKeys: readonly string[]): void {
        if (Date.now() - file.stat.mtime < SETTLED_AFTER_MS) return;
        this.store.retainSections(
            file.path,
            new Set([...sectionKeys, PROPERTIES_SECTION_KEY, LINKED_MENTIONS_SECTION_KEY])
        );
    }

    /**
     * Headings with the same text would share one saved state. The first one
     * keeps the plain key, so state saved before numbering was added still
     * applies. The others get a "#", which no slug contains, so a heading "Foo
     * 2" keeps its own key.
     */
    private uniqueKey(key: string, seenKeys: Map<string, number>): string {
        const occurrence = (seenKeys.get(key) ?? 0) + 1;
        seenKeys.set(key, occurrence);
        return occurrence === 1 ? key : `${key}#${occurrence}`;
    }

    private processHeaders(contentEl: HTMLElement, filePath: string, keyFor: KeyFor): string[] {
        const headers = Array.from(contentEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
        return headers
            .filter((header) => header.parentElement!.tagName !== "LI")
            .map((header) => {
                const sectionKey = keyFor(header, slugify(header.getText()));
                if (this.kept(header, sectionKey)) return sectionKey;
                header.addClass("is-collapsible");
                this.attachCollapseToggle(header, {
                    filePath,
                    sectionKey,
                    defaultCollapsed: false,
                    apply: (collapsed) => {
                        header.toggleClass("is-collapsed", collapsed);
                        this.applyHeaderCollapse(header, collapsed);
                    },
                    hides: (node) => this.sectionBody(header).some((el) => el.contains(node)),
                });
                return sectionKey;
            });
    }

    private processLists(contentEl: HTMLElement, filePath: string, keyFor: KeyFor): string[] {
        const listItems = Array.from(contentEl.querySelectorAll<HTMLElement>("li"));
        return listItems
            .filter((li) => li.querySelector("ul, ol"))
            .map((li) => {
                const depth = this.getListDepth(li);
                const sectionKey = keyFor(li, `li-${depth}-${slugify(this.ownText(li))}`);
                if (this.kept(li, sectionKey)) return sectionKey;
                li.addClass("is-collapsible");
                this.attachCollapseToggle(li, {
                    filePath,
                    sectionKey,
                    defaultCollapsed: false,
                    apply: (collapsed) => li.toggleClass("is-collapsed", collapsed),
                    hides: (node) =>
                        // Stryker disable next-line Regex: no other HTML tag name contains these letters.
                        Array.from(li.children).some((el) => /^(UL|OL)$/.test(el.tagName) && el.contains(node)),
                });
                return sectionKey;
            });
    }

    private applyHeaderCollapse(header: HTMLElement, isCollapsed: boolean): void {
        // A spacer's height was measured with the part shown, so the section
        // must fold or unfold the part itself.
        for (const el of this.sectionBody(header)) this.farRuns.reveal(el);
        // A folded heading inside the section keeps its content hidden: skip
        // siblings until a heading at that level or higher.
        let collapsedNestedLevel: number | null = null;
        for (const el of this.sectionBody(header)) {
            const level = this.headingLevel(el);
            // Stryker disable next-line ConditionalExpression: no heading's level is 0 or less, which is what null compares as.
            if (level !== null && collapsedNestedLevel !== null && level <= collapsedNestedLevel) {
                collapsedNestedLevel = null;
            }
            if (collapsedNestedLevel === null) {
                el.toggleClass("is-hidden", isCollapsed);
                // Stryker disable next-line ConditionalExpression,LogicalOperator: when folding, a folded section's body is hidden either way; only headings fold here.
                if (!isCollapsed && level !== null && el.hasClass("is-collapsed")) collapsedNestedLevel = level;
            }
        }
    }

    /**
     * The siblings in a heading's section: up to the next heading at its level
     * or higher.
     */
    private sectionBody(header: HTMLElement): Element[] {
        const level = parseInt(header.tagName.substring(1));
        const body: Element[] = [];
        for (let el = header.nextElementSibling; el; el = el.nextElementSibling) {
            const nextLevel = this.headingLevel(el);
            if (nextLevel !== null && nextLevel <= level) break;
            body.push(el);
        }
        return body;
    }

    private headingLevel(el: Element): number | null {
        // Stryker disable next-line Regex: no other HTML tag name contains these letters.
        return /^H[1-6]$/.test(el.tagName) ? parseInt(el.tagName.substring(1)) : null;
    }

    /**
     * The item's own text, without nested lists: a fold key that does not
     * change. A key based on position would change with every edit elsewhere,
     * and the saved state would then apply to the wrong item.
     */
    private ownText(li: HTMLElement): string {
        let text = "";
        for (const node of Array.from(li.childNodes)) {
            // Stryker disable next-line ConditionalExpression,Regex: a text node has no tag name to match, and no other HTML tag name contains these letters.
            if (node.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((node as HTMLElement).tagName)) continue;
            text += node.textContent;
        }
        return text;
    }

    private getListDepth(li: HTMLElement): number {
        let depth = 0;
        let el: HTMLElement | null = li.parentElement;
        while (el) {
            if (el.tagName === "UL" || el.tagName === "OL") depth++;
            el = el.parentElement;
        }
        return depth;
    }
}
