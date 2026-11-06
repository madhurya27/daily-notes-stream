# 0024. Calendar follows the stream through a private event and an adapter

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Readers of the stream want the
[Calendar](https://github.com/liamcain/obsidian-calendar-plugin) plugin to
highlight the day they are reading, as it does for an open daily note. Calendar
1.5.10, which the directory installs, has no API. It highlights
`workspace.activeLeaf.view.file` when its view's `updateActiveFile()` runs, and
only for a `FileView`. Its `revealActiveNote()` moves it to that note's month.

## Decision

- The stream reports the note under its reading line (D-220) through a private
  event, `reading-note`, with the note and whether the stream is still
  scrolling. It never mentions Calendar.
- `src/integrations/calendar.ts` listens. When Calendar is visible, it acts on
  every change; when hidden, only once scrolling stops. It sets the stream's
  `file` to the note and checks that `getActiveFile()` now returns it, so the
  stream is the active tab. It calls `updateActiveFile()`, then
  `revealActiveNote()` when the month changed, and sets `file` back to `null` in
  a `finally`. A month the reader turned by hand stays until the stream reaches
  another month: Calendar turns its month only when asked.
- Calendar's **Reveal active note** looks for an open file, and the stream shows
  none. The adapter replaces the method on Calendar's view, which the command
  looks up each time, so it turns Calendar to the month of the note being read
  while the stream is the active tab.
- Obsidian loads the view of a tab not yet shown, such as Calendar's in a
  sidebar closed since launch, only when it is shown. Until then the view has
  neither method. On `layout-change`, the adapter tells a Calendar view it has
  not told yet the last note read.
- A click on a day scrolls the stream to its note, as a jump does, when the
  stream is the tab Calendar would open the note in. The adapter replaces
  Calendar's handler with `view.calendar.$set({ onClickDay })`, as Calendar sets
  it only once, and again on `layout-change` for a reopened Calendar. The plugin
  then makes the stream the active tab again, since the click made Calendar's
  active. A note the stream hides gets the notice Show in stream gives (D-218).
  A Ctrl/Cmd-click, a day with no note, and a stream behind another tab go to
  Calendar's own handler, which opens the note. On unload, Calendar gets its
  handler back.
- The stream is a `FileView` with `allowNoFile`, because Calendar checks for
  one. Outside that call its `file` is `null`, so Obsidian sees no open file, as
  before (D-029).

## Consequences

- File commands, the status bar, Outline and Backlinks are unchanged. Only
  Calendar reacts.
- On a slowed CPU, one Calendar update took 0.1 ms (median), 0.6 ms at most.
- The adapter depends on two methods Calendar does not publish. It checks for
  them and does nothing without them. `e2e-tests/calendar.spec.ts` runs against
  Calendar pinned at 1.5.10, so a new release that changes them fails there.
  `e2e-tests/ios/calendar.spec.ts` checks it on a device, with real scrolling.
- The event is private (D-221).

## Rejected alternatives

- **The note being read as the stream's open file** — file commands act on it:
  Clear file properties wiped its properties without asking.
- **Firing `file-open` with the note set only during the event** — Outline,
  Backlinks and the status bar reload too, too costly to run during a scroll.
- **Changing Calendar's page ourselves** — breaks whenever Calendar redraws.
- **A pull request to Calendar** — no release since 2021.
- **Turning Calendar to the note's month at every stop** — undoes a month the
  reader turned by hand.
- **Never turning the month, as Calendar does for an opened note** — scrolling
  crosses months, and the highlight would leave the month shown.
- **Replacing `openOrCreateDailyNote` on Calendar's view** — its component
  already holds the old function.
- **Letting Calendar open a note the stream hides** — the stream is replaced by
  an empty note, with no word of why it did not scroll.
