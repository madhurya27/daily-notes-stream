# 0014. Give empty blocks new heights once scrolling stops

- **Status:** Accepted. Replaces D-055. Partly replaced by
  [0015](0015-shift-before-shrinking-above.md)
- **Date:** 2026-10-01

## Context

An empty block kept the height it was given when it was added, until its note
was drawn (D-055). After a turn, notes above the reader kept the heights from
the old width, and recordings showed a blank gap of 1.75–4.75 s at the top of
the stream in landscape. A better estimate learned later (D-079, D-080) never
reached the empty blocks already made. D-055 left them alone because shrinking
empty blocks made the stream shorter under the scroll position, and the browser
pulled the scroll back before `ScrollAnchor` could keep the reader's place.

## Decision

When scrolling stops after a turn, or after a height is saved,
`NoteWindowManager` gives each empty note the height it is now expected to have:
its saved height in this layout, otherwise a new estimate. It changes them all
in one task, and tells the anchor in that task, as `repin` does (ADR 0013). If
the change would make the stream shorter by more than the content below the
pane, the browser would pull the scroll back, so the whole change waits until
scrolling stops another time.

## Consequences

- After a turn, empty blocks have the new width's heights from the first time
  scrolling stops.
- If a note is added while a change is waiting, the change keeps waiting.
- Near the stream's end, a turn's shrink waits until more notes load below.
- Each time scrolling stops after a height is saved, every empty note's estimate
  is read again. Estimates are cached until the saved heights change.

## Rejected alternatives

- **On the turn itself** — the text reflows for several frames, and the anchor
  keeps a place read before it (D-057).
- **A spacer at the stream's end, as tall as the shrink** — a second thing that
  must be removed at the right moment, and waiting does the same near the end.
- **Correcting the scroll before shrinking** — setting the scroll position stops
  iOS's scrolling.
