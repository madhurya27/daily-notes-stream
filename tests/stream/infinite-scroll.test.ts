import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InfiniteScrollController } from "../../src/stream/infinite-scroll";

describe("InfiniteScrollController", () => {
    let mockObserve: ReturnType<typeof vi.fn>;
    let mockUnobserve: ReturnType<typeof vi.fn>;
    let mockDisconnect: ReturnType<typeof vi.fn>;
    let capturedCallback: IntersectionObserverCallback;

    beforeEach(() => {
        mockObserve = vi.fn();
        mockUnobserve = vi.fn();
        mockDisconnect = vi.fn();
        // A regular function, not an arrow function, so it can be called with
        // `new`.
        vi.stubGlobal(
            "IntersectionObserver",
            vi.fn(function (cb: IntersectionObserverCallback) {
                capturedCallback = cb;
                return { observe: mockObserve, unobserve: mockUnobserve, disconnect: mockDisconnect };
            })
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // getSentinel
    // -------------------------------------------------------------------------

    it("getSentinel returns null before attach", () => {
        const ctrl = new InfiniteScrollController();
        expect(ctrl.getSentinel()).toBeNull();
    });

    it("getSentinel returns the sentinel element after attach", () => {
        const ctrl = new InfiniteScrollController();
        ctrl.attach(document.createElement("div"), document.createElement("div"), vi.fn().mockResolvedValue(undefined));
        const sentinel = ctrl.getSentinel();
        expect(sentinel).not.toBeNull();
        expect(sentinel!.classList.contains("daily-notes-stream-sentinel")).toBe(true);
    });

    it("getSentinel returns null after detach", () => {
        const ctrl = new InfiniteScrollController();
        ctrl.attach(document.createElement("div"), document.createElement("div"), vi.fn().mockResolvedValue(undefined));
        ctrl.detach();
        expect(ctrl.getSentinel()).toBeNull();
    });

    // -------------------------------------------------------------------------
    // attach
    // -------------------------------------------------------------------------

    it("attach appends sentinel as last child of container", () => {
        const ctrl = new InfiniteScrollController();
        const container = document.createElement("div");
        container.appendChild(document.createElement("p")); // pre-existing child
        ctrl.attach(document.createElement("div"), container, vi.fn().mockResolvedValue(undefined));
        expect(container.lastChild).toBe(ctrl.getSentinel());
    });

    it("attach creates IntersectionObserver with correct root and rootMargin", () => {
        const ctrl = new InfiniteScrollController();
        const scrollRoot = document.createElement("div");
        ctrl.attach(scrollRoot, document.createElement("div"), vi.fn().mockResolvedValue(undefined));
        expect(IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), {
            root: scrollRoot,
            rootMargin: "200px",
        });
    });

    it("attach calls observer.observe on the sentinel", () => {
        const ctrl = new InfiniteScrollController();
        ctrl.attach(document.createElement("div"), document.createElement("div"), vi.fn().mockResolvedValue(undefined));
        expect(mockObserve).toHaveBeenCalledWith(ctrl.getSentinel());
    });

    it("second attach detaches the first observer before creating a new one", () => {
        const ctrl = new InfiniteScrollController();
        const container = document.createElement("div");
        ctrl.attach(document.createElement("div"), container, vi.fn().mockResolvedValue(undefined));
        ctrl.attach(document.createElement("div"), container, vi.fn().mockResolvedValue(undefined));
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it("second attach results in exactly one sentinel in container", () => {
        const ctrl = new InfiniteScrollController();
        const container = document.createElement("div");
        ctrl.attach(document.createElement("div"), container, vi.fn().mockResolvedValue(undefined));
        ctrl.attach(document.createElement("div"), container, vi.fn().mockResolvedValue(undefined));
        expect(container.querySelectorAll(".daily-notes-stream-sentinel").length).toBe(1);
    });

    // -------------------------------------------------------------------------
    // Intersection callback
    // -------------------------------------------------------------------------

    it("calls onTrigger when entry is intersecting", () => {
        const ctrl = new InfiniteScrollController();
        const trigger = vi.fn().mockResolvedValue(undefined);
        ctrl.attach(document.createElement("div"), document.createElement("div"), trigger);
        capturedCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        expect(trigger).toHaveBeenCalledOnce();
    });

    it("does not call onTrigger when entry is not intersecting", () => {
        const ctrl = new InfiniteScrollController();
        const trigger = vi.fn().mockResolvedValue(undefined);
        ctrl.attach(document.createElement("div"), document.createElement("div"), trigger);
        capturedCallback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
        expect(trigger).not.toHaveBeenCalled();
    });

    it("does not call onTrigger when entries array is empty", () => {
        const ctrl = new InfiniteScrollController();
        const trigger = vi.fn().mockResolvedValue(undefined);
        ctrl.attach(document.createElement("div"), document.createElement("div"), trigger);
        capturedCallback([], {} as IntersectionObserver);
        expect(trigger).not.toHaveBeenCalled();
    });

    it("logs error to console when onTrigger rejects", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const ctrl = new InfiniteScrollController();
        const error = new Error("boom");
        const trigger = vi.fn().mockRejectedValue(error);
        ctrl.attach(document.createElement("div"), document.createElement("div"), trigger);
        capturedCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(consoleSpy).toHaveBeenCalledExactlyOnceWith("DailyNotesStream: Failed to load more notes", error);
        consoleSpy.mockRestore();
    });

    // -------------------------------------------------------------------------
    // detach
    // -------------------------------------------------------------------------

    it("detach disconnects the observer", () => {
        const ctrl = new InfiniteScrollController();
        ctrl.attach(document.createElement("div"), document.createElement("div"), vi.fn().mockResolvedValue(undefined));
        ctrl.detach();
        expect(mockDisconnect).toHaveBeenCalledOnce();
    });

    it("detach removes sentinel from the DOM", () => {
        const ctrl = new InfiniteScrollController();
        const container = document.createElement("div");
        ctrl.attach(document.createElement("div"), container, vi.fn().mockResolvedValue(undefined));
        ctrl.detach();
        expect(container.querySelector(".daily-notes-stream-sentinel")).toBeNull();
    });

    it("detach is a no-op when not attached (no throw)", () => {
        const ctrl = new InfiniteScrollController();
        expect(() => ctrl.detach()).not.toThrow();
    });
    // -------------------------------------------------------------------------
    // recheck
    // -------------------------------------------------------------------------

    it("recheck re-observes the sentinel to force a fresh callback", () => {
        const ctrl = new InfiniteScrollController();
        ctrl.attach(document.createElement("div"), document.createElement("div"), vi.fn().mockResolvedValue(undefined));
        mockObserve.mockClear();

        ctrl.recheck();

        expect(mockUnobserve).toHaveBeenCalledWith(ctrl.getSentinel());
        expect(mockObserve).toHaveBeenCalledWith(ctrl.getSentinel());
    });

    it("recheck is a no-op before attach (no throw)", () => {
        const ctrl = new InfiniteScrollController();
        expect(() => ctrl.recheck()).not.toThrow();
        expect(mockObserve).not.toHaveBeenCalled();
    });

    it("recheck is a no-op after detach (no throw)", () => {
        const ctrl = new InfiniteScrollController();
        ctrl.attach(document.createElement("div"), document.createElement("div"), vi.fn().mockResolvedValue(undefined));
        ctrl.detach();
        mockObserve.mockClear();

        expect(() => ctrl.recheck()).not.toThrow();
        expect(mockObserve).not.toHaveBeenCalled();
    });
});
