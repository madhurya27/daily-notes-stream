import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HeightHold, HOLD_LIMIT_MS } from "../../src/stream/height-hold";

const PROPERTY = "--daily-note-held-height";

describe("HeightHold", () => {
    let el: HTMLElement;
    const held = () => el.style.getPropertyValue(PROPERTY);

    beforeEach(() => {
        vi.useFakeTimers();
        el = document.createElement("div");
    });
    afterEach(() => vi.useRealTimers());

    it("holds the element at the height, through the custom property styles.css reads", () => {
        new HeightHold(el, 812);

        expect(held()).toBe("812px");
    });

    it("lets go when released", () => {
        const hold = new HeightHold(el, 812);

        hold.release();

        expect(held()).toBe("");
        expect(vi.getTimerCount()).toBe(0);
    });

    // Something that never stops changing, such as a Base updating live, is not
    // held forever.
    it("lets go by itself once the limit passes", async () => {
        new HeightHold(el, 812);

        await vi.advanceTimersByTimeAsync(HOLD_LIMIT_MS - 1);
        expect(held()).toBe("812px");
        await vi.advanceTimersByTimeAsync(1);
        expect(held()).toBe("");
    });

    it("leaves a later hold alone once released", async () => {
        new HeightHold(el, 812).release();
        await vi.advanceTimersByTimeAsync(HOLD_LIMIT_MS / 2);
        const later = new HeightHold(el, 900);

        await vi.advanceTimersByTimeAsync(HOLD_LIMIT_MS / 2);

        expect(held()).toBe("900px");
        later.release();
    });

    // A pinned block keeps its height after a release, until it is told (ADR
    // 0013).
    it("says it let go, by release or by the limit, once each", async () => {
        const released = vi.fn();
        const hold = new HeightHold(el, 812, released);
        const timed = vi.fn();
        new HeightHold(document.createElement("div"), 812, timed);

        hold.release();
        hold.release();
        await vi.advanceTimersByTimeAsync(HOLD_LIMIT_MS);

        expect(released).toHaveBeenCalledOnce();
        expect(timed).toHaveBeenCalledOnce();
    });

    it("says whether it still holds", async () => {
        const hold = new HeightHold(el, 812);
        expect(hold.holding).toBe(true);

        await vi.advanceTimersByTimeAsync(HOLD_LIMIT_MS);

        expect(hold.holding).toBe(false);
    });
});
