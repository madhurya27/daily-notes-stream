import { finishRenderMath, renderMath, type MarkdownPostProcessor } from "obsidian";
import { applyMathStylesheet, isMathJaxLoaded } from "../obsidian-internals";

/**
 * A post-processor that draws the math in the stream's notes as Obsidian's own
 * does, and runs before it, so Obsidian's finds none left to draw. Obsidian's
 * makes the render wait 100 ms for MathJax's stylesheet, which held up a long
 * note's slice and the queue behind it (D-210). This one updates the
 * stylesheet at once, and lets Obsidian's flush run without waiting for it.
 * Until MathJax has loaded, it leaves the math to Obsidian, which loads it.
 */
export function drawMathAtOnce(inStream: (el: HTMLElement) => boolean): MarkdownPostProcessor {
    return (el) => {
        if (!inStream(el) || !isMathJaxLoaded()) return;
        const maths = Array.from(el.querySelectorAll<HTMLElement>(".math:not(.is-loaded)"));
        if (maths.length === 0) return;
        for (const math of maths) draw(math);
        applyMathStylesheet();
        void finishRenderMath();
    };
}

/**
 * Replaces `math`'s TeX with MathJax's drawing of it. TeX MathJax can't read
 * stays as text, as Obsidian shows it.
 */
function draw(math: HTMLElement): void {
    try {
        math.replaceChildren(renderMath(math.getText(), math.hasClass("math-block")));
    } catch {
        // Nothing replaced it.
    }
    math.addClass("is-loaded");
}
