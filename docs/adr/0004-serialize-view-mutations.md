# 0004. Serialize view mutations through one queue

- **Status:** Accepted
- **Date:** 2026-08-20 (recorded 2026-08-30)

## Context

`loadMoreNotes`, the four vault event handlers and `refresh` all mutate the same
two things, `state` and the DOM, and all of them await partway through (to
render Markdown or read files). When they interleaved, they broke each other's
work: a delete that arrived during an in-flight batch was undone by that batch's
`state.reset`, and a note created during a load could be lost. The invariant
that `state.notes` equals `service._sorted.slice(0, state.length)` broke, so
later batches skipped or repeated notes.

## Decision

Every mutating path runs through `enqueue()`, a promise chain that serializes
them in arrival order. `loadPending` is set synchronously, so a sentinel that is
still visible cannot queue a second load for the same batch.

## Consequences

- A slow batch delays a delete queued behind it. For a read-only stream, correct
  is worth more than immediate.
- Any new mutating path must be enqueued too. This is the rule most easily
  forgotten in later work, which is why `CLAUDE.md` mentions it.
- State can be reasoned about as if single-threaded: no handler sees another's
  mutation half done.

## Rejected alternatives

- **Per-note locks** — finer-grained, but the bug is about the shared ordered
  list, not single notes.
- **Re-checking state after every await** — every mutating path needs the same
  defensive code, and one place without it brings the bug back.
- **Debouncing vault events** — hides the race in small vaults without removing
  it.
