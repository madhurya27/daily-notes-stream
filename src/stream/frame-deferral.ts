import type { StillClock } from "./still-clock";

/**
 * What permanently replaces a frame, such as a video's thumbnail. Null keeps
 * the frame.
 */
export type FrameStandIn = (frame: HTMLIFrameElement, src: string) => HTMLElement | null;
/**
 * What a kept frame is wrapped in, such as a link to its page. Null leaves it
 * as it is.
 */
export type FrameWrapper = (frame: HTMLIFrameElement, src: string) => HTMLElement | null;

/**
 * Loads a frame's page only once scrolling stops (D-087). On iOS, if a frame
 * starts loading its page while a note is drawn during scrolling, the scrolling
 * stops. A frame that is replaced never loads its page.
 */
export class FrameDeferral {
    private observer: MutationObserver | null = null;
    /** Each frame that was held back, with the page it was given. */
    private readonly held = new Map<HTMLIFrameElement, string>();
    private readonly load = () => this.loadHeld();

    constructor(
        private readonly clock: StillClock,
        private readonly standIn: FrameStandIn,
        private readonly wrapper: FrameWrapper
    ) {}

    attach(container: HTMLElement): void {
        this.detach();
        // This is reported before the frame's page can start loading: one
        // microtask after the frame is inserted.
        this.observer = new MutationObserver((records) => this.onMutations(records));
        this.observer.observe(container, { childList: true, subtree: true });
    }

    detach(): void {
        this.observer?.disconnect();
        this.observer = null;
        this.clock.cancel(this.load);
        // Stryker disable next-line CallExpression: only frees memory; it is attached once, and detached when the stream closes.
        this.held.clear();
    }

    private onMutations(records: MutationRecord[]): void {
        for (const record of records) {
            for (const node of Array.from(record.addedNodes)) {
                if (!node.instanceOf(HTMLElement)) continue;
                const frames = node.instanceOf(HTMLIFrameElement) ? [node] : node.querySelectorAll("iframe");
                for (const frame of Array.from(frames)) this.hold(frame);
            }
        }
        if (this.held.size > 0) this.clock.whenStill(this.load);
    }

    private hold(frame: HTMLIFrameElement): void {
        const src = frame.getAttribute("src");
        if (src === null) return;
        const standIn = this.standIn(frame, src);
        if (standIn) {
            frame.replaceWith(standIn);
            return;
        }
        this.held.set(frame, src);
        frame.removeAttribute("src");
        frame.addClass("is-frame-held");
        // A frame moved without a page is reported again by the move, and
        // skipped.
        const wrapper = this.wrapper(frame, src);
        if (wrapper) {
            frame.replaceWith(wrapper);
            wrapper.appendChild(frame);
        }
    }

    private loadHeld(): void {
        for (const [frame, src] of this.held) {
            if (!frame.isConnected) continue;
            frame.removeClass("is-frame-held");
            frame.setAttribute("src", src);
        }
        this.held.clear();
    }
}
