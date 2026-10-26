# 0008. Nothing inside the stream scrolls, on mobile

- **Status:** Accepted
- **Date:** 2026-09-24
- **Replaces:** [0007](0007-nothing-in-the-stream-scrolls.md), which applied the
  rule everywhere

## Context

ADR 0007 did not allow scrolling boxes inside the stream, because on iOS one
stops scrolling early once notes are emptied. The problem is WebKit's, and
desktop does not have it. On desktop, cards and fitted columns replaced a table
the reader could scroll with one that is cut off or changed in shape, and gained
nothing.

## Decision

On mobile (`Platform.isMobile`: iOS and Android, phones and tablets), ADR 0007's
rule applies: no scrolling boxes, wide tables and Bases as cards, code wrapped,
and everything else cut off. Android follows it too, without being checked, so
the two platforms behave the same.

On desktop, the stream draws wide content as Obsidian's reading view does: a
table scrolls inside its own box, a Base draws its own table with its own scroll
bar, and an embedded note keeps its maximum height.

Everywhere, nothing makes the page itself wider: diagrams scale down, and URLs
wrap.

## Consequences

- The e2e check of every element is mobile only. Desktop e2e checks that a wide
  table and a wide Base scroll inside themselves, and that the page does not.
- Stylesheet rules for mobile are under `.is-mobile`.

## Rejected alternatives

- **One rule everywhere (0007)** — desktop loses its scroll bars, to fix a bug
  it does not have.
- **iOS only (`Platform.isIosApp`)** — iPhone and Android phones would behave
  differently.
- **Sideways scrolling for wide Bases and tables on mobile** — checked again on
  2026-10-09 on an iPhone 16 Pro, deep in the stream with notes emptied, with 24
  flicks over Bases and tables for each build. The current build scrolled all
  the way every time (3.4–3.8 s). With Bases and tables that scroll, 13 flicks
  stopped early, 8 of them within 0.8 s. Experiment: tag
  `archive/sideways-scroll`.
