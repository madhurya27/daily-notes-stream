# 0005. Keep the copy button's corner free in drawn code

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

Obsidian wraps drawn code (`white-space: pre-wrap`) and places its
`.copy-code-button` absolutely in the block's top-right corner, so the end of a
long first line is under the icon and cannot be read.

The core app hides the button until the pointer is over the block, then always
shows it under `.is-mobile`, where there is no pointer. So on a phone the
overlap is permanent, and on desktop it lasts as long as the pointer is over the
block (8px of text covered).

## Decision

`.daily-note-content pre::before` floats an empty box in that corner, 3em wide
and 1.5em tall, for the first line to wrap around. It applies on every platform,
whether the pointer is over the block or not, so no character is ever hidden.

The height matters: `pre` has `overflow-x: auto` and contains the float, so at
2.5em a one-line block grew from 48px to 64px. At 1.5em, neither a one-line nor
a wrapped block changes height, and the float still covers the button. An e2e
test checks that the text and the button do not overlap at all.

## Consequences

- The first line is about 3em narrower everywhere, including on desktop before
  the pointer is over the block. That is the cost of a rule that does not depend
  on any state.
- Stricter than the core app, so the stream and a normal reading view wrap a
  long first line at different places.
- If Obsidian changes the button's style or position, the kept corner is out of
  date. The e2e test is what catches that.

## Rejected alternatives

- **The float only under `.is-mobile`** — matches the core app exactly and
  leaves desktop as it is, but keeps the core app's overlap when the pointer is
  over the block, and makes the rule depend on a class the e2e mobile project
  cannot test at 420px.
- **`padding-right` on `pre`** — shortens every line, not just the one next to
  the button.
- **Hiding the button in the stream** — the stream is read-only, so copying code
  is one of the few useful actions left.
- **Changing the button's style or position** — fighting a core element that the
  core app changes without warning.
