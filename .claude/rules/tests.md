---
paths:
    - "tests/**"
    - "e2e-tests/**"
---

# Tests

- Unit tests use Vitest and jsdom. `obsidian` is replaced by the mocks in
  `tests/mocks/`; `daily-notes.ts` there holds the vault's notes and the daily
  notes settings. The mocks copy their types from the real API, so the tests'
  types are checked against it (D-025).
- **Keep each kind of test on its side**
  ([ADR 0002](../../docs/adr/0002-real-obsidian-e2e.md)). jsdom loads no
  stylesheet, so a check there that something is visible proves nothing. Real
  rendering, real events and what is visible on screen are tested in
  `e2e-tests/`, which runs the installed app on a throwaway vault.
- Every e2e test runs twice, as desktop and as mobile, both in Chromium. What
  iOS's browser engine paints or measures differently is checked in
  `e2e-tests/webkit.spec.ts`, on a copy of the mobile run's page
  ([ADR 0009](../../docs/adr/0009-webkit-render-checks.md)).
- After a mutation run, no mutant may survive (D-149). Write a test that fails
  for each one. If no test can tell the mutant from the real code, disable it
  with `// Stryker disable next-line <mutator>: <why>`, and check that the
  reason is true.
- **Each test checks one thing, as fast as it can.** It sets up and crosses only
  what that thing needs, so a failure names its cause (D-190).
