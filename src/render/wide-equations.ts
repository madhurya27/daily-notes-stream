import type { Component } from "obsidian";
import type { WidthWatch } from "./note-widths";

/**
 * Shrinks a display equation wider than the note until it fits. This is checked
 * again when the note's width changes. It may not scroll sideways inside the
 * stream (ADR 0008), and if it were clipped, its end would be lost. MathJax
 * draws HTML, which CSS cannot scale to fit, so this measures it. `within`
 * limits it to part of the note: a section re-rendered on its own (ADR 0019).
 */
export function fitWideEquations(
    contentEl: HTMLElement,
    noteComponent: Component,
    widths: WidthWatch,
    within: ParentNode = contentEl
): void {
    const equations = Array.from(within.querySelectorAll<HTMLElement>('mjx-container[display="true"] > mjx-math'));
    if (equations.length === 0) return;

    const fit = () => {
        for (const math of equations) {
            // Measure it at its own size, because shrunk it is exactly as wide
            // as the note.
            math.style.removeProperty("--daily-note-equation-zoom");
            const room = contentWidth(math.parentElement!);
            // Stryker disable next-line EqualityOperator: at equal widths the zoom is 1, which is no zoom.
            if (math.offsetWidth > room)
                math.style.setProperty("--daily-note-equation-zoom", String(room / math.offsetWidth));
        }
    };
    fit();
    widths.watch(contentEl, noteComponent, fit);
}

/**
 * The width inside the padding MathJax 4 gives a display equation's container.
 */
function contentWidth(el: HTMLElement): number {
    const { paddingLeft, paddingRight } = getComputedStyle(el);
    return el.clientWidth - (parseFloat(paddingLeft) || 0) - (parseFloat(paddingRight) || 0);
}
