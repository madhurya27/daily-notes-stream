# 0015. Show the notes above moving before giving them new heights

- **Status:** Accepted. Partly supersedes
  [0014](0014-re-reserve-placeholders-at-rest.md)
- **Date:** 2026-10-01

## Context

ADR 0014 delayed new heights that would make the stream shorter by more than
there is below the pane. After a turn near the end, a scroll up without the
scrolling ever stopping never tried again: the notes above were rendered at the
old width's heights, and a phone reached the top of its scroll still owing 5.5k
px, several notes below the newest one.

WebKit and Chromium keep a shifted stream's scroll range. The pull-back came
from the order `reserve()` worked in: it made the empty blocks shorter first, so
the anchor then read a layout that was already shorter, but not yet shifted.

## Decision

`reserve()` adds up how far the empty notes entirely above the pane move, and
`ScrollAnchor.anticipate()` shows that shift before any empty block changes. The
anchor's next read then finds nothing more owed, and the shift moves into the
scroll in the same task. `reserve()` only runs once scrolling has stopped, so
setting the scroll stops no scroll. Only a shrink below the pane's top that is
larger than the content below the pane still waits.

## Consequences

- After a turn, notes get new heights the first time scrolling stops, wherever
  the reader is.
- Any shift that is already owed, such as for a Base re-rendered late, is moved
  into the scroll at the same time.
- Each time, it reads the box of every empty block it changes.
- A note that crosses the pane's top counts as below it, and such a note is
  rarely empty.

## Rejected alternatives

- **A spacer at the stream's end** — the shift already keeps the scroll range.
- **Moving the shift into the scroll the next time scrolling stops** — a scroll
  started within 300 ms carried 7.8k px to the top.
- **Waiting, as ADR 0014 did** — a scroll that never stops never tries again.
