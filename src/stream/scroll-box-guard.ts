import { debounce } from "obsidian";
import { SCROLL_IDLE_MS } from "./scroll-anchor";
import { LAID_OUT } from "../render/bases/bases-fit";

/** Bases and everything in them are already clipped by the stylesheet. */
const BASE = ".bases-embed, .block-language-base";

/**
 * Keeps scrolling boxes out of the stream (ADR 0008). It reports each Base as
 * it lays out, so its owner can fit it. It clips each inline overflow-x as soon
 * as it appears. And once scrolling stops, it clips anything else the
 * stylesheet missed.
 */
export class ScrollBoxGuard {
    private observer: MutationObserver | null = null;
    /** Elements added since the last check. */
    private readonly unchecked = new Set<HTMLElement>();
    // Reading computed styles while scrolling makes the browser recalculate the
    // styles of the whole page.
    private readonly checkOnceStill = debounce(() => this.clipScrollBoxes(), SCROLL_IDLE_MS, true);

    constructor(private readonly onBaseLayout: (view: HTMLElement) => void) {}

    attach(container: HTMLElement): void {
        this.detach();
        this.observer = new MutationObserver((records) => this.onMutations(records));
        this.observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["style"],
        });
    }

    detach(): void {
        this.observer?.disconnect();
        this.observer = null;
        this.checkOnceStill.cancel();
        // Stryker disable next-line CallExpression: only frees memory; it is attached once, and detached when the stream closes.
        this.unchecked.clear();
    }

    /** Delays the check until scrolling stops. */
    onScroll(): void {
        if (this.unchecked.size > 0) this.checkOnceStill();
    }

    private onMutations(records: MutationRecord[]): void {
        const views = new Set<HTMLElement>();
        for (const record of records) {
            const view = baseViewChangedBy(record);
            if (view) views.add(view);
            // Both kinds of record observed here, childList and attributes,
            // have an element as target.
            clipInlineOverflow(record.target as Element);
            for (const node of Array.from(record.addedNodes)) {
                if (!node.instanceOf(HTMLElement)) continue;
                if (node.closest(BASE)) node.querySelectorAll<HTMLElement>(".bases-view").forEach((v) => views.add(v));
                else {
                    this.unchecked.add(node);
                    [node, ...Array.from(node.querySelectorAll("[style*=overflow]"))].forEach(clipInlineOverflow);
                }
            }
        }
        for (const view of views) this.onBaseLayout(view);
        if (this.unchecked.size > 0) this.checkOnceStill();
    }

    private clipScrollBoxes(): void {
        for (const root of this.unchecked) {
            if (!root.isConnected) continue;
            for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
                if (el.instanceOf(HTMLElement) && isScrollBox(el)) el.addClass("is-scroll-clipped");
            }
        }
        this.unchecked.clear();
    }
}

/**
 * The Base whose layout a change may have affected: rows added or removed, or a
 * new width on its table's header row or kanban board. Changes to its own
 * styles, such as the width limit set when fitting it, are not layout changes.
 */
function baseViewChangedBy(record: MutationRecord): HTMLElement | null {
    // Both kinds of record observed here, childList and attributes, have an
    // element as target.
    const target = record.target as Element;
    if (record.type === "attributes" && !target.matches(LAID_OUT)) return null;
    return target.closest<HTMLElement>(".bases-view");
}

/**
 * Obsidian sets overflow-x as an inline style on a table's wrapper, which wins
 * over the stylesheet's clip (D-172). Reading the inline style does not make
 * the browser recalculate styles while scrolling.
 */
function clipInlineOverflow(el: Element): void {
    if (!el.instanceOf(HTMLElement) || !el.style.getPropertyValue("overflow-x") || el.closest(BASE)) return;
    el.style.removeProperty("overflow-x");
    el.addClass("is-scroll-clipped");
}

/**
 * Includes `hidden`: a finger cannot scroll it, but it is still a scrolling
 * box.
 */
function isScrollBox(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return /auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`);
}
