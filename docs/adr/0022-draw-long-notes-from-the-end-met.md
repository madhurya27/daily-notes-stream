# 0022. A long note is drawn from the end the reader reaches first

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

ADR 0020 draws a long note in slices from its top. A reader who scrolls up into
one from below, as after a jump to an older day, reaches its end first, which is
drawn last. On an iPhone, with heights forgotten, a 10,000-line note left the
screen white for 0.55–0.77 s in 3 out of 10 scrolls. Once drawn, its runs stayed
in the layout until scrolling stopped (ADR 0021), so the scrolling paused
afterwards.

## Decision

When a note's middle is above the pane's middle, `NoteWindowManager` draws it
from its end: `NoteRenderer` draws its runs, or sections, last first, each one
inserted before the one drawn before it. Meanwhile, the block, still at its
empty height, is laid out from its bottom (`is-drawing-from-end`), so what is
drawn is where the reader is, and the note's title and properties stay out of
view. Before drawing finishes, the scroll anchor reads the reader's place in
what was drawn. Nothing scrolled or changed size while it drew, so nothing else
would have told it. When drawing finishes, the block's height is fixed again,
and the anchor keeps that text in place as the note takes its real height.

If scrolling brought the note's top into the pane in the meantime, the anchor
keeps whichever of this note and the note above is in the middle of the pane,
because that is what the reader is reading, and the other one moves away to make
room. With the scroll at the top, there is no note above, so the stream's top is
kept, as a tap on the title would leave it. If the pane's top is in a gap in the
note's content, the anchor keeps the text below the gap, never the content
element, whose top rises with each slice drawn above.

Only content near the reader stays in the layout while the note is drawn.
Between slices, the stream hides each run drawn past the emptying distance (ADR
0021), except the top one, which may still grow. Runs are grouped from the
note's end, so runs already drawn keep their limits as the note grows at its
top. The stream hides the other far runs when drawing finishes, after the height
is fixed again, because how far away a run is depends on where the anchor put
the reader.

## Consequences

- When a reader scrolls up into a 3,000-line note that was never drawn, the text
  under them, in the last tenth of the note, shows before drawing finishes, and
  moves less than a pixel when it finishes
  (`e2e-tests/long-note-from-end.spec.ts`).
- At phone speed, less than 10% of a 10,000-line note is laid out in any frame
  while it is drawn, against 98% when it is only hidden once drawing finishes.
- The iPhone measurements are in the merge commit.
- A note reached from above, or by a jump, is drawn from its top as before.
- A save that draws a long note all at once again still draws it from its top.

## Rejected alternatives

- **Keeping a long note drawn after the reader leaves it, with all its runs
  hidden** — returning to it is instant, but it does not help a note that was
  never drawn, which is the case after a jump. Memory grows with each long note
  passed, a turn shows every run at once (ADR 0021), and its embeds and queries
  keep running off screen.
- **Only drawing the runs near the reader** — needs space kept for the rest,
  folding sections that cover parts not drawn, and search into those parts. A
  bigger change, for the same white screen.
