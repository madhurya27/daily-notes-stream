import { BASE_SLOT_CLASS } from "./bases-as-cards";

/**
 * Bases fills a view in tens of milliseconds. A view that never fills is not
 * waited for longer than this.
 */
export const BASES_LOAD_LIMIT_MS = 500;

/**
 * Bases marks a view whose query has not run yet. Meanwhile an empty "0
 * results" is drawn.
 */
const LOADING = `.${BASE_SLOT_CLASS} .is-loading`;

/**
 * Resolves once no Base in `note` is loading, or after `BASES_LOAD_LIMIT_MS`.
 * It checks again one frame later, because a table too wide for its note is
 * drawn again as cards once it is laid out, and loads again.
 */
export function basesLoaded(note: HTMLElement): Promise<void> {
    if (!note.querySelector(`.${BASE_SLOT_CLASS}`)) return Promise.resolve();
    return new Promise((resolve) => {
        const loading = () => note.querySelector(LOADING) !== null;
        let frame = 0;
        const check = () => {
            // Wait one frame for all the changes in it, because a Base makes
            // many.
            cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => loading() || done());
        };
        const observer = new MutationObserver(check);
        const limit = window.setTimeout(done, BASES_LOAD_LIMIT_MS);
        function done(): void {
            observer.disconnect();
            window.clearTimeout(limit);
            cancelAnimationFrame(frame);
            resolve();
        }
        observer.observe(note, { subtree: true, childList: true, attributeFilter: ["class"] });
        check();
    });
}
