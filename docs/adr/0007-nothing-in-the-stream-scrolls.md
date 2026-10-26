# 0007. Nothing inside the stream scrolls

- **Status:** Superseded by [0008](0008-nothing-scrolls-on-mobile.md), which
  only applies the rule on mobile
- **Date:** 2026-09-24

## Context

On iOS, once notes are unloaded (ADR 0006), a flick stops 0.1–0.4 s after the
finger lifts. Obsidian's own notes do too, because the cause is WebKit. It was
found by ruling things out over about 15 phone builds:

| Build                          | Result                                 |
| ------------------------------ | -------------------------------------- |
| Unloading off                  | No stops; uneven scrolling after sleep |
| Base embeds hidden             | No stops                               |
| Every scroll container removed | No stops, except over inline math      |
| Only `.bases-view` clipped     | Fewer stops, but not none              |

The cause is any scroll container inside the scroller, including
`overflow: hidden`.

## Decision

No element inside the stream is a scroll container.

- Wide content is made to fit: code wraps, tables that are too wide are stacked
  as cards, Bases lower their maximum column width, diagrams scale down, and
  embedded notes grow.
- Everything else is clipped with `overflow: clip`, which is not a scroll
  container.
- `ScrollBoxGuard` clips what the stylesheet misses, once scrolling stops,
  because reading styles while scrolling makes the browser recalculate the whole
  page's styles.

## Consequences

- Overflow is clipped, and cannot be reached: a Base column resized by hand is
  clipped.
- `e2e-tests/scroll-boxes.spec.ts` checks that no element computes `auto`,
  `scroll` or `hidden`.
- PDFs, embedded web pages (`iframe`) and canvases are not checked.

## Rejected alternatives

- **Keeping notes loaded** — with every note in memory, scrolling is uneven
  after the phone wakes from sleep.
- **Clipping Bases only mid-glide** — a swipe that started on a Base no longer
  worked.
- **Only fitting `.bases-view`** — other boxes still stalled.
- **Stable heights when re-rendering, Bases rendered later, Bases' scroll
  changes blocked, or a scrolling element inside the pane** — scrolling still
  stopped.
- **`* { overflow: clip }`** — clips bullets, checkboxes and fold arrows.
