# 0013. Fix the height of each drawn note

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

On iOS, when a note above the reader changes height, `ScrollAnchor` makes up for
it by shifting the stream, set when a `ResizeObserver` reports the change.
Recordings showed the whole screen drawn one frame off by the change, and then
back, each time a note was drawn: 15 times in one scroll up in landscape. A test
page outside Obsidian did the same when the shift was set in the observer, and
never when the shift was set in the same task that changed the height. While
scrolling, iOS draws a resize before it reports it.

## Decision

A drawn block gets a fixed height: a fixed `height` with `overflow-y: clip`, set
by `NoteWindowManager`. Nothing drawn inside it moves the stream. The block only
gets a new height in `repin`, which removes the fixed height, measures, and
fixes the height again in one task, and tells the anchor to shift in that same
task. It runs when drawing finishes, when the block's content reports a resize,
and when a held height is released.

## Consequences

- Content that gets its size late (a Base filling in, an image or a PDF loading)
  grows inside a block with a fixed height, and moves nothing until its resize
  report fixes the block's height again.
- The growth shows cut off for the one frame between when it is drawn and when
  it is reported.
- A change inside the note at the top of the pane still reaches the anchor
  through a resize report: fixing a block's height fixes its height, not where
  things are inside it.
- On desktop, Chromium's own scroll anchoring handles each new fixed height, as
  it handled each drawn note before.

## Rejected alternatives

- **Setting the shift in a later frame** — iOS still draws the change first.
- **Measuring notes in advance, off screen** — Bases, images and PDFs get their
  size from where they are drawn (ADR 0010).
- **Drawing off screen, then moving the note in** — a frame that is moved loads
  again, and Bases and images get their size again where they end up.
- **A stream anchored at the bottom (`column-reverse`)** — stops growth above
  the reader from moving the screen, but growth below would move it instead, and
  it reverses every scroll position in the plugin.
- **Setting the scroll position** — iOS ignores or undoes it while scrolling.
