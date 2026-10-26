# 0001. Keep architecture decisions in this log

- **Status:** Superseded by [0012](0012-two-tier-decision-log.md), which adds a
  numbered log for smaller decisions
- **Date:** 2026-08-30

## Context

Decisions were being worked out again from commit messages and the text in
`CLAUDE.md`. Both record _what_ the code does, but neither records what was
considered and rejected, so a later change argues again about something already
settled, or quietly undoes it. `CLAUDE.md` had started to collect reasons, which
was turning it into a design document instead of a map of the current system.

## Decision

Numbered records in `docs/adr/`, one for each decision that is not obvious,
written in the same branch as the code. Each has the context, the decision, its
consequences, and one line for each rejected option. Records are only ever added
to: undoing a decision means a new record that supersedes the old one, never an
edit to it.

`CLAUDE.md` and `docs/TESTING.md` stay descriptions of the present, and link
here for the reasons. Commit messages stay about their own change.

## Consequences

- A decision costs one page, written while the reasons are still fresh.
- Two places to update when a decision changes: the ADR (marked as superseded),
  and the docs that describe the current behavior.
- Not everything qualifies. A decision with only one reasonable option is not an
  ADR, and neither are formatting, naming, or library choices that the ecosystem
  already settles.
- Older decisions are only added afterwards where the reasons still matter and
  can still be found. That an old decision has no record does not mean it can be
  changed freely.

## Rejected alternatives

- **A single `DECISIONS.md`** — grows into a file nobody reads, and the status
  of each decision is hard to keep track of.
- **Reasons in `CLAUDE.md`** — what was done before. It mixes "what is true now"
  with "why we chose it", and has no room for rejected options.
- **Only commit messages** — the reasons survive, but only for someone who
  thinks to run `git log` on the right file.
- **GitHub issues or the PR description** — outside the repo, without versions,
  and invisible to anyone reading the code offline.
