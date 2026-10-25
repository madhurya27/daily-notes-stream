import { debounce } from "obsidian";
import { SCROLL_IDLE_MS } from "./scroll-anchor";
import { LAID_OUT } from "../render/bases/bases-fit";

/** Clipped by the stylesheet already, Bases and all. */
const BASE = ".bases-embed, .block-language-base";

/**
 * Keeps scroll containers out of the stream (ADR 0008): reports each Base as it
 * lays out, for its owner to fit, clips each inline overflow-x as it appears,
 * and clips whatever else the stylesheet missed once the scroll is still.
 */
export class ScrollBoxGuard {
    private observer: MutationObserver | null = null;
    /** Roots added since the last check. */
    private readonly unchecked = new Set<HTMLElement>();
    // Reading computed styles mid-glide forces a page-wide recalc.
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
        // Stryker disable next-line CallExpression: frees memory only; attached once, it is detached as the stream closes.
        this.unchecked.clear();
    }

    /** Postpones the check until the scroll stops. */
    onScroll(): void {
        if (this.unchecked.size > 0) this.checkOnceStill();
    }

    private onMutations(records: MutationRecord[]): void {
        const views = new Set<HTMLElement>();
        for (const record of records) {
            const view = baseViewChangedBy(record);
            if (view) views.add(view);
            // Both record types observed here, childList and attributes, target an element.
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
 * The Base whose layout a mutation may have changed: rows added or removed, or
 * a new width on its table's header row or kanban board. Its own style writes, the fitted cap
 * among them, are not layout.
 */
function baseViewChangedBy(record: MutationRecord): HTMLElement | null {
    // Both record types observed here, childList and attributes, target an element.
    const target = record.target as Element;
    if (record.type === "attributes" && !target.matches(LAID_OUT)) return null;
    return target.closest<HTMLElement>(".bases-view");
}

/**
 * Obsidian sets overflow-x inline on a table's wrapper, which outranks the
 * stylesheet's clip (D-172). Read inline, it costs no style recalc mid-glide.
 */
function clipInlineOverflow(el: Element): void {
    if (!el.instanceOf(HTMLElement) || !el.style.getPropertyValue("overflow-x") || el.closest(BASE)) return;
    el.style.removeProperty("overflow-x");
    el.addClass("is-scroll-clipped");
}

/** `hidden` too: no finger scrolls it, but it is a scroll container. */
function isScrollBox(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return /auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`);
}
