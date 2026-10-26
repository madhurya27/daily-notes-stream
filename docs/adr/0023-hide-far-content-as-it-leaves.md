# 0023. Content far from the screen leaves the layout as soon as it is far, for notes and runs alike

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

WebKit's compositing step pauses an iPhone scroll for longer the more elements
are laid out (ADR 0021), and nothing left the layout until scrolling stopped
(D-032, ADR 0021). The pauses grew during the scroll, from 90 ms to 350 ms over
14 s. The scroll got ahead of the drawing, and went half as far as in Obsidian's
reading view.

## Decision

Content past the hiding distance, 4 pane heights, leaves the layout when the
observer reports it, even while scrolling:

- **A note** keeps its content and its fixed height (ADR 0013), and its children
  get `display: none`. The block's height does not change, so nothing is
  measured and the anchor owes nothing. When it comes back within the drawing
  distance, it is shown again without being drawn again.
- **A run** is watched through its first and last elements. Once both are past
  the distance on the same side, it is hidden behind a spacer sized from the
  boxes the observer reported. A run shown by a fold, a search step or a save is
  watched again, so the observer's first report hides it again if it is still
  far away.
- **Emptying** keeps ADR 0006's limit: a hidden note past the emptying distance,
  12 pane heights, is emptied once scrolling stops (D-032).

This replaces waiting for scrolling to stop before hiding (D-032, ADR 0021).
Emptying still waits for it.

## Consequences

- On an iPhone, over two scrolls of eight strokes each, pauses over 80 ms fall
  from 18 to 2–4 past short notes, and from 21–26 (growing during the scroll) to
  2–6 (steady) through a 10,000-line note. A scroll goes 2.4 times as far.
- The longest blank through that note is 239 ms, down from 524–913 ms, since
  D-135 stopped a long note from setting every estimate. Most blank frames are
  over text already drawn, as in Obsidian's reading view. The others are where
  the scroll gets ahead of the drawing (`docs/TODO.md`).
- A run's spacer reaches the screen for one frame, 2–8 times in two scrolls:
  after a WebKit pause of 70–200 ms, or where the scroll moves further between
  frames than the drawing distance. The next frame shows the run. A spacer
  distance of 3 pane heights reduced this to 0–1, but left the blank time the
  same (1.4–2.5 s either way), and pauses over 80 ms went up from 7–10 to 11–13.
  The screen is blank there anyway, not yet drawn instead of showing a spacer.
  `e2e-tests/ios/far-runs.spec.ts` fails if a spacer is on screen for two frames
  in a row.
- On desktop, with 1,825 notes scrolled to the end: 6 notes drawn instead of 4,
  2,654 nodes in the page instead of 2,378, and the heap grows by 7.3 MB instead
  of 5.8 MB.

## Rejected alternatives

- **Checking every 300 ms while scrolling** — goes through every run again and
  forces a layout each time.
- **`content-visibility: auto`** — tried again: the pauses did not change, and
  the blank time grew.
- **Drawing every note at the start** — ADR 0006: opening time and memory.
- **Emptying while scrolling** — D-032: a third of the flicks paused.
