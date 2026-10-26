# 0010. Remember every measured height between sessions

- **Status:** Accepted. Superseded in part by
  [0017](0017-forget-heights-of-edited-notes.md), so an edit forgets the
  heights, and by D-092, which uses the height that 90% of notes are below
  instead of the median
- **Date:** 2026-09-25

## Context

After a jump, the notes skipped over get a guessed height (ADR 0006). Scrolling
back up draws them at their real heights. On iOS, which does not keep the scroll
position, `ScrollAnchor` shows the growth as a shift and moves it into the
scroll once scrolling stops (D-036). Near the top, the scroll runs out of room
before that happens: in one test, the anchor still owed 6,076px, so scrolling up
by hand stopped that far below the newest note. Heights were kept in four
places, and none of them lasted after the plugin closed: each block's height, a
median for each view, Back's history state, and `BaseMeasurements`.

## Decision

`LayoutMemory`, of which the plugin has one, keeps every note's last measured
height for each layout (content width and text size), and which Bases were too
wide, in the vault's localStorage on this device. An empty block gets the saved
height, otherwise the layout's median, otherwise 400px. An edited note keeps its
last height, which is closer than any median. Back only keeps the place, and the
store holds its heights.

## Consequences

- Daily notes rarely change once written, so after the first scroll through a
  layout, a jump uses real heights, and there is little to owe.
- A note never measured in this layout still gets a guess, and the shift makes
  up for it.
- Heights are kept for each device, so a phone never uses what a laptop
  measured.
- The store is a cache. A new format changes its version number and starts
  empty.

## Rejected alternatives

- **Moving the owed shift into the scroll as an animation at the top** — the
  content still visibly moves thousands of pixels very fast.
- **Extra scroll space above the newest note** — its size is a guess, and if it
  is too big, it leaves a blank gap to scroll into.
- **Measuring skipped notes in advance, off screen** — renders up to a thousand
  notes to learn what was measured before.
- **Plugin data (`data.json`)** — it syncs, so one device's heights would reach
  another device.
- **Forgetting a height on edit** — the median it would use instead is further
  off than the old height.
