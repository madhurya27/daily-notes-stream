# 0006. Empty the content of notes that are off screen

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

Nothing removed a drawn note. Every note the user scrolled past kept all of its
Markdown elements in the DOM, plus the child components
`MarkdownRenderer.render()` registers, which stay on the view until it closes,
so removing the DOM alone would not have freed them. A vault of several years,
scrolled all the way, held all of it at once, which limits how far the stream
can usefully scroll.

## Decision

Every loaded note has a `.daily-note-block`, but only blocks near the screen
hold content. `NoteWindowManager` draws a block when it comes within 1.5 screen
heights, and empties it once it is 4 screen heights away, keeping the height it
measured so nothing below moves. The distances are in screen heights, not
pixels, because how far ahead of the reader the stream works is the same
question on a phone and on a tall monitor. They are computed again from the
pane's height on `onResize`. Each note is drawn into its own `Component`, which
is thrown away together with its DOM.

The block element, not its content, has `data-source-path`, and it is what the
view's index from path to element holds, so a note can still be found while it
is empty. `loadBatch` adds empty blocks instead of drawn notes. Adding takes a
constant amount of DOM work for each note, which is what keeps a jump to a
distant date cheap.

## Consequences

- The scroll height is only approximate until a note has been drawn once. A
  block that was never drawn gets the median of what this vault's notes
  measured, corrected when it is first drawn. The fixed number it replaced was
  400px, while notes measure about 709px.
- A refresh after a settings change builds the stream again as empty blocks, so
  it costs the same with ten notes as with a thousand.
- Anything that scrolls to a note may arrive at an empty block. That works,
  because the observer fills it in, but only because the block always exists.
- A flick can carry a block past both distances between two frames. An
  IntersectionObserver only reports changes, so the block gets one report, the
  request to empty it, and no other until it comes back. A render that has
  already started records the request and carries it out when it finishes. A
  render that is still queued is skipped instead of holding up the queue.
- jsdom has no layout, so emptying can only be proven in `e2e-tests/` (ADR
  0002).

## Rejected alternatives

- **Full virtualization** (absolute positioning, and only the visible part of
  the DOM) — the set of blocks is already limited to what was scrolled to, and
  absolute positioning conflicts with Obsidian's reading view CSS.
- **Removing blocks completely and building them again on scrolling back** —
  loses the scroll height, so the scroll bar jumps every time a note is emptied.
- **Limiting the number of loaded notes** — breaks the idea of the stream: the
  vault should be scrollable to its end.
- **One observer for both edges** — a block right on the boundary is drawn and
  emptied on every tiny movement.
- **Fixed distances in pixels** — a phone and a tall monitor would get a
  different number of screens ahead.
