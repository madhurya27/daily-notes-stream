# 0013. Pin the height of each rendered note

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

On iOS, when a note above the reader changes height, `ScrollAnchor` makes up for
it by shifting the stream, set when a `ResizeObserver` reports the change.
Recordings showed the whole screen painted one frame off by the change, and then
back, each time a note rendered: 15 times in one scroll up in landscape. A test
page outside Obsidian did the same when the shift was set in the observer, and
never when the shift was set in the same task that changed the height.
Mid-glide, iOS paints a resize before it reports it.

## Decision

A rendered block is pinned: a fixed `height` with `overflow-y: clip`, set by
`NoteWindowManager`. Nothing rendered inside it moves the stream. The block only
gets a new height in `repin`, which removes the pin, measures, and pins it again
in one task, and tells the anchor to shift in that same task. It runs when
rendering finishes, when the block's content reports a resize, and when a held
height is released.

## Consequences

- Content that gets its size late (a Base filling in, an image or a PDF loading)
  grows inside a pinned block, and moves nothing until its resize report fixes
  the block's height again.
- The growth shows cut off for the one frame between when it is painted and when
  it is reported.
- A change inside the note at the top of the pane still reaches the anchor
  through a resize report: pinning fixes a block's height, not where things are
  inside it.
- On desktop, Chromium's own scroll anchoring handles each re-pin, as it handled
  each render before.

## Rejected alternatives

- **Setting the shift in a later frame** — iOS still paints the change first.
- **Measuring notes in advance, off screen** — Bases, images and PDFs get their
  size from where they are rendered (ADR 0010).
- **Rendering off screen, then moving the note in** — a frame that is moved
  loads again, and Bases and images get their size again where they end up.
- **A stream anchored at the bottom (`column-reverse`)** — stops growth above
  the reader from moving the screen, but growth below would move it instead, and
  it reverses every scroll position in the plugin.
- **Setting the scroll position** — iOS ignores or undoes it while scrolling.
