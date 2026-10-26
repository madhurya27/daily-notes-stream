# 0018. Notes stay read-only, and a note is edited where it opens

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Editing in the stream was tried twice (2026-10-08 to 10-09), with Obsidian's own
editor embedded, as a Canvas card has it. That editor only draws the lines near
the screen, estimates the rest, and corrects its estimates by scrolling its own
scrolling element. In the stream, the pane scrolls instead, so each correction
was lost: drawing a note's Bases threw the reader thousands of px, and every fix
to the anchor, the fixed heights or the keyboard showed the next problem.
Opening a note already costs little: the title opens it, ⌘-click opens it in a
tab, ⌘⌥-click in a split next to the stream, and Back returns to the place left
(`e2e-tests/history.spec.ts`).

## Decision

Every note is drawn read-only. A note is edited where Obsidian opens it, from
its title, and the stream draws it again on the save (ADR 0003).

## Consequences

- No editor is in the stream, so the anchor, the fixed heights (ADR 0013), and
  the rule against scrolling boxes on mobile (ADR 0008) only have to handle
  reading.
- On a phone, writing means leaving the stream and coming back.
- Nothing depends on Obsidian's internal Markdown embed.

## Rejected alternatives

- **Today's note as an editor in the stream** — a tap would go to the embed, not
  the stream, and today's note would look different from the others.
- **A pencil that opens any note's editor in place** — the lost corrections
  described above.
- **The open note in a box as tall as the pane, which scrolls by itself** — the
  editor keeps the place, but a box in the stream needs its own keyboard
  handling, a visible edge and a place to sit.
- **A pop-up editor** — on a phone it would be a full-screen sheet, which is
  what opening the note already gives, and it uses the same internal embed.
- **A hidden workspace leaf for each note, as Daily Notes Editor does** —
  changes to the workspace, and a fake hover popup.
