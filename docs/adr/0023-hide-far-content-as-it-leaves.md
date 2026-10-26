# 0023. Content far from the screen leaves the layout as soon as it is far, for notes and runs alike

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

WebKit's compositing step stalls an iPhone scroll for longer the more elements
are laid out (ADR 0021), and nothing left the layout until scrolling stopped
(D-032, ADR 0021). The stalls grew during the glide, from 90 ms to 350 ms over
14 s. The glide got ahead of the painting, and went half as far as in Obsidian's
reading view.

## Decision

Content past the hiding distance, 4 pane heights, leaves the layout when the
observer reports it, even mid-glide:

- **A note** keeps its content and its pinned height (ADR 0013), and its
  children get `display: none`. The block's height does not change, so nothing
  is measured and the anchor owes nothing. When it comes back within the
  rendering distance, it is shown again without being re-rendered.
- **A run** is watched through its first and last elements. Once both are past
  the distance on the same side, it is hidden behind a spacer sized from the
  boxes the observer reported. A run shown by a fold, a search step or a save is
  watched again, so the observer's first report hides it again if it is still
  far away.
- **Unloading** keeps ADR 0006's limit: a hidden note past the unloading
  distance, 12 pane heights, is unloaded once scrolling stops (D-032).

This replaces waiting for scrolling to stop before hiding (D-032, ADR 0021).
Unloading still waits for it.

## Consequences

- On an iPhone, over two glides of eight strokes each, stalls over 80 ms fall
  from 18 to 2–4 past short notes, and from 21–26 (growing during the glide) to
  2–6 (steady) through a 10,000-line note. A glide goes 2.4 times as far.
- The longest blank through that note is 239 ms, down from 524–913 ms, since
  D-135 stopped a long note from setting every estimate. Most blank frames are
  over text already drawn, as in Obsidian's reading view. The others are where
  the glide gets ahead of the drawing (`docs/TODO.md`).
- A run's spacer reaches the screen for one frame, 2–8 times in two glides:
  after a WebKit stall of 70–200 ms, or where the glide moves further between
  frames than the rendering distance. The next frame shows the run. A spacer
  distance of 3 pane heights reduced this to 0–1, but left the blank time the
  same (1.4–2.5 s either way), and stalls over 80 ms went up from 7–10 to 11–13.
  The screen is blank there anyway, not yet painted instead of showing a spacer.
  `e2e-tests/ios/far-runs.spec.ts` fails if a spacer is on screen for two frames
  in a row.
- On desktop, with 1,825 notes scrolled to the end: 6 notes drawn instead of 4,
  2,654 nodes in the page instead of 2,378, and the heap grows by 7.3 MB instead
  of 5.8 MB.

## Rejected alternatives

- **Checking every 300 ms mid-glide** — goes through every run again and forces
  a layout each time.
- **`content-visibility: auto`** — tried again: the stalls did not change, and
  the blank time grew.
- **Rendering every note at the start** — ADR 0006: opening time and memory.
- **Unloading mid-glide** — D-032: a third of the flicks stalled.
