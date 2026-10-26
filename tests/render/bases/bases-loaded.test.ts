import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASES_LOAD_LIMIT_MS, basesLoaded } from "../../../src/render/bases/bases-loaded";
import { BASE_SLOT_CLASS } from "../../../src/render/bases/bases-as-cards";

/** A frame, at the fake clock's 60 fps. */
const FRAME_MS = 16;

describe("basesLoaded", () => {
    let note: HTMLElement;
    let loaded: boolean;

    /** A Base as Bases first draws it, before its query has run. */
    function loadingBase(): HTMLElement {
        return note.createDiv({ cls: BASE_SLOT_CLASS }).createDiv({ cls: "bases-cards-container is-loading" });
    }

    function waitForBases(): void {
        loaded = false;
        void basesLoaded(note).then(() => (loaded = true));
    }

    beforeEach(() => {
        vi.useFakeTimers();
        note = document.body.createDiv();
    });
    afterEach(() => {
        note.remove();
        vi.useRealTimers();
    });

    it("resolves at once for a note with no Base", async () => {
        note.createEl("p", { text: "Roast squash soup" });

        waitForBases();
        await vi.advanceTimersByTimeAsync(0);

        expect(loaded).toBe(true);
    });

    it("resolves a frame on for a Base already filled in", async () => {
        loadingBase().removeClass("is-loading");

        waitForBases();
        await vi.advanceTimersByTimeAsync(FRAME_MS);

        expect(loaded).toBe(true);
    });

    it("waits while a Base runs its query", async () => {
        loadingBase();

        waitForBases();
        await vi.advanceTimersByTimeAsync(10 * FRAME_MS);

        expect(loaded).toBe(false);
    });

    it("resolves a frame after the Base fills in", async () => {
        const view = loadingBase();
        waitForBases();

        view.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(FRAME_MS);

        expect(loaded).toBe(true);
    });

    it("resolves a frame after Bases swaps the loading view for a filled one", async () => {
        const view = loadingBase();
        waitForBases();
        await vi.advanceTimersByTimeAsync(FRAME_MS);

        const filled = document.createElement("div");
        filled.className = "bases-cards-container";
        view.replaceWith(filled);
        await vi.advanceTimersByTimeAsync(FRAME_MS);

        expect(loaded).toBe(true);
    });

    // A table too wide for its note is drawn again as cards once it is laid
    // out.
    it("waits on for a Base redrawn within the frame", async () => {
        const view = loadingBase();
        waitForBases();

        view.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(0);
        view.addClass("is-loading");
        await vi.advanceTimersByTimeAsync(10 * FRAME_MS);

        expect(loaded).toBe(false);
    });

    it("gives up on a Base that never fills in", async () => {
        loadingBase();
        waitForBases();

        await vi.advanceTimersByTimeAsync(BASES_LOAD_LIMIT_MS);

        expect(loaded).toBe(true);
    });

    it("asks for one frame however many times a Base changes in it", async () => {
        const view = loadingBase();
        waitForBases();

        view.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(0);
        view.createDiv({ cls: "bases-cards-item" });
        await vi.advanceTimersByTimeAsync(0);

        // The limit's timer, and one frame.
        expect(vi.getTimerCount()).toBe(2);
    });

    it("stops watching once a Base fills in", async () => {
        const view = loadingBase();
        waitForBases();
        view.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(FRAME_MS);
        expect(loaded).toBe(true);

        // Drawn again afterwards, so it asks for no frame.
        view.addClass("is-loading");
        view.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(0);

        expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves no frame pending once given up on", async () => {
        const view = loadingBase();
        waitForBases();
        await vi.advanceTimersByTimeAsync(BASES_LOAD_LIMIT_MS - 1);

        view.removeClass("is-loading");
        await vi.advanceTimersByTimeAsync(1);

        expect(loaded).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
