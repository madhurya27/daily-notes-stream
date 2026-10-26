# 0016. Control Obsidian on a real iPhone over USB

- **Status:** Accepted
- **Date:** 2026-10-02
- **Changes:** [0009](0009-webkit-render-checks.md), which leaves behavior to a
  person with a phone

## Context

What breaks on iOS is behavior: scrolling cut short, the screen jumping as notes
are drawn, and turning the screen losing the reader's place. ADR 0009's copy of
the page in WebKit is a still picture, and desktop Chromium has none of iOS's
scrolling. So the Mobile checklist in `docs/TESTING.md` was done by hand, before
every release.

## Decision

`pnpm run test:ios` runs `e2e-tests/ios/` against Obsidian on an iPhone plugged
into the Mac. Appium's XCUITest driver sends real touches through
WebDriverAgent, so a flick keeps scrolling the way a thumb's does. Obsidian's
web view, which can be inspected, shows what the stream did. The tests:

- sign WebDriverAgent with the Mac's own Apple Development certificate;
- create their own vault, `Stream E2E`, stored on the phone instead of in
  iCloud. It holds the demo journal up to a fixed day, so every phone, on every
  day, sees the same notes;
- change no setting on the phone. Auto-Lock is up to the tester (D-086).

## Consequences

- Only runs locally: it needs a phone on the cable, unlocked when a run starts,
  and setting up once by hand (`docs/TESTING.md`). Not in CI.
- A free Apple ID's profile lasts a week, and each run's setup builds and signs
  WebDriverAgent again when it runs out.
- Written for iPhones. An iPad runs them too, through `test:ipados`, and a test
  that is only true on a phone asks which device it uses (D-168, D-169).
- A lock screen on Obsidian (Face ID, Touch ID) stops a run, because no touch
  gets past it.
- It judges what the reader sees: turning the screen reflows a note, so a check
  follows the part that was in view, not the note's position.

## Rejected alternatives

- **The iOS Simulator** — apps from the App Store, including Obsidian, cannot be
  installed in it.
- **Web Inspector alone** (`pymobiledevice3`) — runs scripts, but sends no
  touches, and scrolling is what breaks.
- **The Demo vault** — iCloud syncs each test's changes, and its notes change
  with the day it was filled.
