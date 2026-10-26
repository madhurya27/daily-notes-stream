import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamBlocks, blockAt } from "../../src/stream/stream-blocks";

describe("StreamBlocks", () => {
    let container: HTMLElement;
    let sentinel: HTMLElement | null;
    let blocks: StreamBlocks;

    beforeEach(() => {
        container = document.createElement("div");
        sentinel = null;
        blocks = new StreamBlocks(() => sentinel);
        blocks.attach(container);
    });

    /**
     * Puts the empty element that loads more notes last in the container, as
     * the scroll controller does.
     */
    function addSentinel(): HTMLElement {
        sentinel = container.appendChild(document.createElement("div"));
        sentinel.id = "sentinel";
        return sentinel;
    }

    // Each block is separate: `toEqual` compares elements by their markup.
    let made = 0;
    const block = () => Object.assign(document.createElement("div"), { id: `block-${made++}` });

    describe("get", () => {
        // A querySelector on every lookup made reading the place O(n^2) during
        // a refresh, and the window manager calls it often too.
        it("resolves a block through the index, not a DOM query", () => {
            const querySelector = vi.spyOn(container, "querySelector");
            const el = block();
            blocks.append("Notes/2025-01-01.md", el);

            expect(blocks.get("Notes/2025-01-01.md")).toBe(el);
            expect(querySelector).not.toHaveBeenCalled();
        });

        it("matches paths containing CSS selector metacharacters", () => {
            const path = 'Notes/2025-01-01 [a\\b"c].md';
            const el = block();
            blocks.append(path, el);
            expect(blocks.get(path)).toBe(el);
        });

        it("returns null for a note that is not loaded", () => {
            expect(blocks.get("Notes/2025-01-01.md")).toBeNull();
        });
    });

    describe("append", () => {
        it("appends to the container when there is no sentinel", () => {
            const el = block();
            blocks.append("a", el);
            expect(container.lastChild).toBe(el);
        });

        it("keeps the sentinel last", () => {
            const s = addSentinel();
            const el = block();
            blocks.append("a", el);
            expect([...container.children]).toEqual([el, s]);
        });
    });

    describe("insertBefore", () => {
        it("lands ahead of the next note's block", () => {
            const next = block();
            blocks.append("next", next);
            const el = block();

            blocks.insertBefore("new", el, "next");

            expect([...container.children]).toEqual([el, next]);
            expect(blocks.get("new")).toBe(el);
        });

        it("lands before the sentinel when there is no next note", () => {
            const s = addSentinel();
            const el = block();
            blocks.insertBefore("new", el, undefined);
            expect([...container.children]).toEqual([el, s]);
        });

        it("lands before the sentinel when the next note has no block", () => {
            const s = addSentinel();
            const el = block();
            blocks.insertBefore("new", el, "unloaded");
            expect([...container.children]).toEqual([el, s]);
        });

        it("appends when there is neither a next block nor a sentinel", () => {
            const el = block();
            blocks.insertBefore("new", el, "unloaded");
            expect(container.lastChild).toBe(el);
        });
    });

    describe("remove", () => {
        it("takes the block out of the DOM and the index, and hands it back", () => {
            const el = block();
            blocks.append("a", el);

            expect(blocks.remove("a")).toBe(el);
            expect(container.contains(el)).toBe(false);
            expect(blocks.get("a")).toBeNull();
        });

        it("returns null for a path with no block", () => {
            expect(blocks.remove("missing")).toBeNull();
        });
    });

    it("clear forgets every block but leaves the DOM", () => {
        const el = block();
        blocks.append("a", el);

        blocks.clear();

        expect(blocks.get("a")).toBeNull();
        expect(container.contains(el)).toBe(true);
    });

    it("empty clears the container and the index", () => {
        blocks.append("a", block());

        blocks.empty();

        expect(container.children).toHaveLength(0);
        expect(blocks.get("a")).toBeNull();
    });

    it("lists every indexed block by path", () => {
        const a = block();
        const b = block();
        blocks.append("a", a);
        blocks.append("b", b);
        expect([...blocks.entries()]).toEqual([
            ["a", a],
            ["b", b],
        ]);
    });

    it("exposes the container it was attached to", () => {
        expect(blocks.el).toBe(container);
    });

    describe("empty state", () => {
        const emptyStates = () => container.querySelectorAll(".daily-notes-empty-state");

        it("shows one message before the sentinel", () => {
            const s = addSentinel();
            blocks.showEmptyState("No notes.");
            expect(emptyStates()).toHaveLength(1);
            expect(container.lastChild).toBe(s);
        });

        it("never shows a second message", () => {
            blocks.showEmptyState("No notes.");
            blocks.showEmptyState("No notes.");
            expect(emptyStates()).toHaveLength(1);
        });

        it("rewords the message it shows", () => {
            blocks.showEmptyState("No notes.");
            blocks.showEmptyState("Every note is hidden.");
            expect([...emptyStates()].map((el) => el.textContent)).toEqual(["Every note is hidden."]);
        });

        it("hides the message", () => {
            blocks.showEmptyState("No notes.");
            blocks.hideEmptyState();
            expect(emptyStates()).toHaveLength(0);
        });

        it("hiding without a message is a no-op", () => {
            expect(() => blocks.hideEmptyState()).not.toThrow();
        });
    });
});

describe("blockAt", () => {
    /**
     * A stream of `count` blocks, each 100px tall, the first starting at `top`.
     */
    function stacked(count: number, top = 0) {
        const stream = document.createElement("div");
        const reads = { count: 0 };
        for (let i = 0; i < count; i++) {
            const block = stream.createDiv();
            block.getBoundingClientRect = () => {
                reads.count++;
                return { top: top + i * 100, bottom: top + (i + 1) * 100 } as DOMRect;
            };
        }
        return { stream, reads };
    }

    it("is the block the pane's top crosses", () => {
        const { stream } = stacked(5);

        expect(blockAt(stream, 250)).toBe(stream.children[2]);
    });

    it("is the next block when the pane's top is on a boundary", () => {
        const { stream } = stacked(5);

        expect(blockAt(stream, 200)).toBe(stream.children[2]);
    });

    it("is the first block when the stream starts below the pane's top", () => {
        const { stream } = stacked(5, 300);

        expect(blockAt(stream, 0)).toBe(stream.children[0]);
    });

    it("is none past the stream's end, or in an empty stream", () => {
        expect(blockAt(stacked(5).stream, 500)).toBeNull();
        expect(blockAt(stacked(0).stream, 0)).toBeNull();
    });

    // A stream holds thousands of blocks, and the place is read on every
    // refresh and Back.
    it("measures a few blocks, not every one above the pane's top", () => {
        const { stream, reads } = stacked(1000);

        expect(blockAt(stream, 99_950)).toBe(stream.children[999]);
        expect(reads.count).toBeLessThanOrEqual(11);
    });
});
