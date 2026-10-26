# 0012. Record big decisions as ADRs, and small ones as numbered log entries

- **Status:** Accepted
- **Date:** 2026-09-29
- **Supersedes:** [0001](0001-record-decisions.md), which rejected a single
  decisions file

## Context

ADR 0001 kept every decision as a numbered record here, and rejected a single
decisions file. Since 2026-09-15, small decisions have gone into
`docs/DECISIONS.md` instead: 70 entries in two weeks, each too small for an ADR.
Code and docs referred to them by date, and one date had up to 13 entries, so a
reference did not say which entry it meant.

## Decision

- **ADR:** a change to the architecture or a larger design change, one that
  would need data to be moved, or code to be rewritten across layers, to undo
  it. Numbered here, as before.
- **Log entry:** anything smaller, in `docs/DECISIONS.md`: the decision, why,
  and what was rejected, in a few lines. Each has an ID, from `D-001` on, in the
  order the entries were written. The date stays in its heading.
- Both are only ever added to. A decision that is superseded is marked as
  superseded, with a link to what superseded it.
- A reference is the ID alone (`D-023`), never a date. IDs only exist in the
  log, so the path adds nothing.

## Consequences

- An ID is short enough for a code comment, unique, and still works when the
  title changes.
- The log is one file, which is searched, not read from start to end:
  `grep D-023`.
- A branch that adds an entry takes the next free ID. Two branches in progress
  at the same time can take the same ID, and one must change its number before
  merging.

## Rejected alternatives

- **Everything as an ADR** — a page each for 70 decisions, which nobody would
  write.
- **Referring by date and title** — long, and changing the title breaks it.
- **Naming the file in each reference** (`docs/DECISIONS.md, D-023`) — makes
  every comment longer, for what one grep finds.
- **GitHub heading links** — they include the title, so changing the title
  breaks them.
- **One file for each log entry** — ADRs again, without the bar for writing one.
