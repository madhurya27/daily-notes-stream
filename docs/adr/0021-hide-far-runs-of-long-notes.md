# 0021. Parts of a long note far from the screen leave the layout

- **Status:** Accepted. Partly replaced by
  [0023](0023-hide-far-content-as-it-leaves.md): runs are hidden as they go out
  of range, not once scrolling stops
- **Date:** 2026-10-13

## Context

A drawn note stays whole in the page (ADR 0006 only empties whole notes). On an
iPhone, WebKit pauses the page for up to about 0.7 s about once a second, for
longer the more elements are laid out, on screen or not. There were 36 pauses of
over 200 ms while scrolling past a 5,000-line note, and none past a 200-line
note padded to the same height. A scroll that starts during a pause runs into
parts of the screen not yet drawn: 3.7 s blank over 5,000 lines, and up to 2.4 s
at a time over 10,000.

## Decision

`NoteWindowManager` treats the runs of a long note (ADR 0020), or its sections
grouped to the same size, the way it treats notes. Once scrolling stops, each
run past the emptying distance is hidden with `display: none`, and one spacer
with the run's height and outer margins takes its place (`render/far-runs.ts`).
When a spacer comes within the drawing distance, its run is shown again. The
hidden nodes stay in the page. Folding a section, a search step, and an update
in place each first show the runs they affect, and runs shown that way are
hidden again the next time scrolling stops. A width change shows every run,
because the spacers were measured at the old width.

## Consequences

- On an iPhone, scrolling through a drawn note: over 5,000 lines, the screen is
  blank for 0.13 s in total, and 50 ms at the longest (it was 3.7 s and 584 ms).
  Over 10,000 lines, 0.17 s, and 83 ms at the longest.
- Hiding does not change a note's height, to within 0.5 px
  (`e2e-tests/far-runs.spec.ts`).
- A save only shows the runs it affects. On an iPhone, that is one task of 31–36
  ms at 5,000 lines, and 40–43 ms at 10,000 (D-134).
- Selecting and copying across a hidden run copies none of it.

## Rejected alternatives

- **`content-visibility: auto`** — keeps every box in the layout. It only cut
  the blank time by 20%, and its size changes started a loop in our
  ResizeObserver.
- **The note in its own layer** (`will-change`) — no difference beyond the
  normal variation between runs.
- **Emptying far runs, as notes are emptied** — drawing them again is the cost
  ADR 0020 cut, and folding, search ranges and updates in place keep references
  to the nodes.
- **Hiding with an emptying observer for each run** — a run shown by a fold or a
  search would never be hidden again, because an observer only reports changes.
