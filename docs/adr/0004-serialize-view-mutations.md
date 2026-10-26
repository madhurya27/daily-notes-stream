# 0004. Run changes to the view one at a time, through one queue

- **Status:** Accepted
- **Date:** 2026-08-20 (recorded 2026-08-30)

## Context

`loadMoreNotes`, the four vault event handlers and `refresh` all change the same
two things, `state` and the DOM, and all of them wait partway through (for
drawing Markdown, or reading files). When they ran in between each other, they
broke each other's work: a delete that arrived during a batch was undone by that
batch's `state.reset`, and a note created during a load could be lost
completely. The rule that `state.notes` equals
`service._sorted.slice(0, state.length)` broke, which puts loading in batches
out of step, so notes are skipped or repeated on further scrolling.

## Decision

Every code path that changes things runs through `enqueue()`, a chain of
promises that runs them one at a time, in the order they arrive. `loadPending`,
which is set immediately, also stops an empty element at the end that is still
visible from queuing a second load for the same batch.

## Consequences

- Changes run in the order they arrive, and a slow batch delays a delete behind
  it. For a read-only stream that is the right choice: being correct matters
  more than being immediate.
- Any new code path that changes things must also be queued. This is the rule
  most easily forgotten in later work, which is why `CLAUDE.md` mentions it.
- State can be reasoned about as if there were one thread: no handler sees
  another's change half done.

## Rejected alternatives

- **A lock for each note** — finer-grained, but the bug is about the shared
  ordered list, not single notes.
- **Checking the state again after every await** — every code path that changes
  things needs the same defensive code, and one place without it brings the bug
  back.
- **Delaying vault events** — hides the problem with small vaults without
  removing it.
