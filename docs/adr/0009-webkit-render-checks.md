# 0009. Check the phone layout in WebKit, from a copy of real Obsidian

- **Status:** Accepted
- **Date:** 2026-09-25
- **Changes:** [0002](0002-real-obsidian-e2e.md), whose mobile project runs
  Chromium

## Context

Obsidian on iOS runs in WKWebView. The e2e tests use desktop Obsidian, which is
Electron, so their `mobile` project is the phone layout in Chromium. Search
highlights showed there, but not at all on an iPhone: WebKit only reads
`-webkit-user-select`, and paints no highlight on text next to a block element.
Neither problem could make a test fail. Playwright's WebKit cannot run Obsidian
itself.

## Decision

`e2e-tests/webkit.ts` gives a mobile project test `inWebKit()`. It takes a copy
of the live page (the markup, the stylesheets as raw text, scroll positions, and
CSS highlight ranges) and renders it in Playwright's WebKit as an iPhone 17
(pixel density, touch, user agent), at the phone layout's viewport size.
`e2e-tests/webkit.spec.ts` checks there what the two browser engines disagree
on: what is painted, and what the CSS rules compute.

## Consequences

- It covers reading CSS, applying the CSS rules, and painting in iOS's browser
  engine, but not behavior. The page is a still picture, with no scripts,
  events, scrolling or flicks. Those are still tested on a real phone
  (`docs/TESTING.md`).
- It is macOS WebKit, not iOS: what only iOS does (momentum scrolling, touch
  handling, tiling) cannot be tested.
- Stylesheets are copied as source text, because the CSSOM changes `-webkit-`
  properties to Chromium's names, which hid the first bug.
- Obsidian's fonts and images do not load, so sizes differ slightly. Check what
  is painted, not where.
- Needs `pnpm exec playwright install webkit` once.

## Rejected alternatives

- **Obsidian in WebKit** — `app.js` needs Electron and Node.
- **The iOS Simulator with Obsidian installed** — no Playwright driver, and it
  needs Xcode and a signed-in App Store.
- **Fixed HTML test files** — our own reading of Obsidian's DOM and CSS, which
  is what went wrong.
