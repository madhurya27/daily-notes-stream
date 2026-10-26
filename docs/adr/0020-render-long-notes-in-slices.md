# 0020. A long note is rendered one slice at a time

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

One `MarkdownRenderer` call drew a whole note in one task. At phone speed (CPU
slowed 4x, `e2e-tests/edit-cost.spec.ts`), opening a 10,000-line note froze the
stream for 2.4 s, and for 4.2 s if it was today's note, drawn section by section
(ADR 0019).

## Decision

A note of 6,000 characters or more is rendered in runs: groups of whole
sections, up to 2,000 characters each, cut from the note's own text. A shorter
note is rendered all at once. Today's note, and any note saved while it is
rendered, is rendered one section at a time, as before (ADR 0019). Between runs,
once 25 ms have been used, the renderer gives the thread back through a timer,
so everything already waiting runs first. If the note leaves the screen in the
meantime, it stops at its next slice and stays empty. If it is removed from the
document, it stops drawing. A note that is off the screen lets any note waiting
on the screen draw between its slices, then carries on where it stopped. The
block stays clipped at its reserved or pinned height until the note is drawn, so
nothing moves in the meantime. A note whose sections cannot stand on their own
(ADR 0019) is still rendered in one call.

## Consequences

- At phone speed, the longest task when opening a 10,000-line note falls from
  4.2 s to about 340 ms, and no timer waits more than about 550 ms. On desktop,
  it falls from 744 ms to about 200 ms.
- Scrolling past a long note no longer waits for the note to finish drawing. On
  an iPhone, tapping the title of a 16,000-line note showed its top blank for
  0.75–1.2 s, and now shows no blank (`e2e-tests/ios/header.spec.ts`).
- When scrolling up to a short newest note, past a 10,000-line note never
  measured, the glide ended with the long note within the rendering distance,
  and the long note rendered to its end first. On an iPhone, the newest note
  waited 286–341 ms, and now waits 44–49 ms.
- Below 6,000 characters, rendering all at once blocks the thread no longer than
  a slice does, and finishes sooner. At phone speed (D-131), a 5,900-character
  note blocks the thread for 26–27 ms rendered all at once, against 25–26 ms for
  each slice, and finishes in 26 ms instead of 45–49 ms. Rendering all at once
  first blocks the thread for 50 ms somewhere between 10,000 and 15,000
  characters, so the limit of 6,000 leaves a margin.
- A 10,000-line note takes 1.3–1.7 times as long to finish: 6.9 s at phone speed
  for today's note. It fills in from the top, and its end is far below the
  screen. A note after it waits for its turn to draw.
- Sections the reader folded show unfolded until the note is drawn.
- The e2e tests wait for a long note from inside the page, because Playwright's
  `expect` goes through the whole page on each check, and each check would run
  between slices.

## Rejected alternatives

- **`scheduler.yield()`** — continues rendering before every waiting timer.
  Timers waited 4.4 s, then all ran at once after the whole note, in one task of
  580–900 ms.
- **Every note one section at a time** — twice the cost of rendering an old note
  (ADR 0019).
- **Every note in slices** — a short note fits in one slice anyway, and was
  rendered up to 1.9 times slower.
- **Rendering outside the page, then inserting once** — the insert restyles and
  lays out the whole note in one task.
- **`requestIdleCallback`** — iOS does not have it, and while the reader scrolls
  there is no idle time.
- **Starting again a note that gave way to another** — loses the slices already
  drawn.
- **Hiding the note until it is drawn** — a blank note for seconds, where the
  top could already be read.
