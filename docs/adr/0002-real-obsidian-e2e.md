# 0002. Test against the real Obsidian app, not only mocks

- **Status:** Accepted
- **Date:** 2026-08-21 (recorded 2026-08-30)

## Context

Unit tests run against an `obsidian` mock written by hand, in jsdom. That mock
is the plugin's own idea of the API, so nothing checked the plugin against the
real output of `MarkdownRenderer`, real `moment` parsing, or real vault events.
And jsdom loads no stylesheet at all, so nothing could say whether anything was
really _visible_. A bug in the indent of drawn lists was released for exactly
this reason.

## Decision

`e2e-tests/` controls the installed Obsidian app. Playwright connects over CDP
to a copy started with its own `--user-data-dir` and a throwaway test vault, so
the user's real vault and settings are never touched. Every test runs twice, as
a `desktop` project and as a `mobile` one that applies `emulateMobile(true)` at
an iPhone Pro's 402px, because Obsidian's mobile stylesheet is different enough
that a rule can be right in one layout and wrong in the other.

Unit tests keep the mock and keep 100% coverage. Anything about real drawing,
real events, or what is visible on screen belongs in e2e.

## Consequences

- Two sets of tests with different jobs, and each kind of test must stay on its
  side: a check in jsdom that something is visible proves nothing.
- E2E needs Obsidian installed and is slower (about 50s), so it is a check at
  the end of each task, not on each save.
- Starting the app is complicated by nature: window bounds, focus, the lock that
  allows only one copy, and the trust prompt on first run. That code is in
  `e2e-tests/obsidian.ts`.
- Obsidian's internals can change without warning. That is the point: the tests
  fail when they do.

## Rejected alternatives

- **Only mocks** — cheapest, but blind to the whole kind of bug that made this
  necessary.
- **A stricter mock, generated from Obsidian's types** — still checks our own
  reading of the API, and still has no stylesheet.
- **Checking by hand in a development vault** — kept as `docs/TESTING.md` for
  what cannot be automated, but too slow and too easy to skip to be the only
  check.
- **Running against the user's real vault** — a test that can damage real notes
  will do so one day.
