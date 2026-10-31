# Testing

## Setup

```bash
pnpm test                            # unit tests
pnpm run test:e2e                    # every e2e test twice, as desktop and as mobile
pnpm run test:e2e --project=mobile   # only one of the two
pnpm run test:e2e webkit.spec.ts     # the phone layout in iOS's browser engine (ADR 0009)
pnpm run test:ios                    # Obsidian on a plugged-in iPhone or iPad (ADR 0016)
pnpm run demo --test                 # the test vault, described below; --help lists every option
```

`pnpm run demo` runs its own copy of Obsidian with `.dev/obsidian-userdata`,
next to your real one, on the main display. It is meant to be watched, unlike
the e2e window, which is transparent. Each run builds the plugin if there is no
build, fills the vault again, links the vault's plugin files to the repo's
build, and reloads the plugin on every save. Ctrl-C stops it and closes the
window. Anything you type into the vault lasts until the next run. `.obsidian`
is kept, so your layout stays. In phone mode the window has no area to drag it
by, so use `--position` to move it.

### Test vault: `--test`, `.dev/vault/`

The checklist below is written for this vault. `pnpm run seed --test` takes
`--days N`, the number of filler notes (`400` for a long history, `12` for just
over one batch), and a path to create the vault somewhere else.

- 123 daily notes in `Notes/`: 120 filler notes, and the three the checklist
  names by date.
- The filler notes repeat eight shapes. Among them: long notes, a wide code
  block, a wide table, tasks and a quote, headings nested from H1 to H6, a note
  with no frontmatter (to test that the properties panel is absent), and Bases
  (so there are Bases all the way down).
- **2026-08-30**, the newest note: one of each kind of embed the e2e tests
  cover. Bases that are wide, narrow, too wide only because of their values,
  resized by hand, with a named view, as a kanban and inline (the Bases are in
  `Bases/`). Also embedded notes, a PDF, a video in an `iframe`, display math,
  Mermaid and a wide table.
- **2026-08-29**, the newest filler note: linked mentions of every kind, from a
  nested list item, a paragraph, a wide table and a property. `[[Agenda]]` in
  `Projects/Plan.md` must open `Projects/Agenda.md`, not `Notes/Agenda.md`.
- **2026-02-01**: nested lists, repeated headings, a heading with a link in it,
  and `test-image.svg`. This note and **2026-01-15** have the frontmatter listed
  under Properties.
- A `.png` with a date as its name, and a dated note outside the daily notes
  folder. Neither may appear.

### Demo vault: the default, `.dev/demo-vault/`

90 days of a journal that reads like a real one: properties, links to people and
projects, tasks, callouts, running logs, a sketch, a reading-list Base every
Sunday, and project logs that link to the newest days. Each note is made from
its date, so making the vault again gives the same notes. `pnpm run seed` takes
`--days N` and `--until YYYY-MM-DD`. The README's screenshots and recordings
come from this vault.

### iPhone or iPad: `pnpm run test:ios`, `pnpm run test:ipados`

These tests use real touches on Obsidian, on an iPhone or iPad plugged into the
Mac. They use a vault called `Stream E2E`, stored on the phone, which the tests
create. A run leaves the phone as it found it: Obsidian opens the vault it had
open before, then closes, and the phone goes back to the Home Screen.
WebDriverAgent turns off the keyboard's autocorrection and predictive text, and
the run turns both back on at the end. To leave one of them off, set
`IOS_KEYBOARD_AUTOCORRECT=off` or `IOS_KEYBOARD_PREDICTION=off` (D-112), on the
command line or in `e2e-tests/ios/.env`, which is gitignored.
`IOS_SEED_DAYS=1825` creates five years of notes instead of 21 days (D-158).
`test:ios` uses the iPhone on the cable and `test:ipados` the iPad, so both can
stay plugged in (D-169). A run tests an iPad in landscape, then the tests tagged
`@portrait` in portrait, and an iPhone in portrait, and turns the device back at
the end (D-193). `IOS_ORIENTATION=PORTRAIT` or `LANDSCAPE` runs every test in
that one. Its keyboard can be attached or not: the tests type on iOS's on-screen
keyboard and make it appear if a keyboard is attached. After a run with a
keyboard attached, iOS keeps showing its keyboard until you detach and attach
the keyboard again (D-174).

Do this once for each Mac and each device. "Phone" below means either one.

1. Install Xcode, open it once, and add an Apple ID under Settings → Accounts.
   Then choose Manage Certificates → + → Apple Development. A free account is
   enough. Point the shell at Xcode, so that `xcrun devicectl list devices`
   finds the phone:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
2. Plug the phone in, unlock it and tap Trust.
3. On the phone, turn on Settings → Privacy & Security → Developer Mode (the
   phone restarts), and Settings → Apps → Safari → Advanced → Web Inspector.
4. Obsidian must open without Face ID or Touch ID: long-press its icon and
   choose Don't Require.
5. Run `pnpm run test:ios`. The first run cannot start WebDriverAgent until the
   phone trusts the certificate: on the phone, go to Settings → General → VPN &
   Device Management → Apple Development → Trust. Then run it again.

For each run:

- **Before:** plug the phone in and unlock it. Auto-Lock must be longer than the
  pauses in a run, which are under a minute. If the phone is locked, the run
  fails at once. If it locks during the run, every test after that fails. Low
  Power Mode keeps Auto-Lock at 30 seconds.
- **For many runs in a row**, as in a session with an agent: set Settings →
  Display & Brightness → Auto-Lock to Never, or the phone locks between runs.
- **After:** set Auto-Lock back. At Never, the phone does not lock at all.

Appium's log is `.dev/appium.log`. WebDriverAgent's build log is
`.dev/wda-build.log`.

A free account's profile lasts 7 days. Each run renews it, as long as Xcode
still has the account. When a run fails:

| Error                                                                   | Fix                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `xcodebuild build-for-testing` failed; the build log says "No Accounts" | Xcode → Settings → Accounts: sign in to the Apple ID again                             |
| Every test fails at once, "Unable to launch WebDriverAgent", code 65    | On the phone: Settings → General → VPN & Device Management → Apple Development → Trust |

## Verification

This is what `pnpm run test:e2e` cannot check. The tests in `e2e-tests/` check
the rest. **[e2e]** marks an item the e2e tests partly cover, and **[ios]** one
that `pnpm run test:ios` covers.

### Core

- On iOS, scroll through the stream, quit Obsidian, open it again and jump to an
  old date. Then scroll back up by hand. The scrolling stops on the newest note,
  and nothing jumps once it stops. **[e2e]** with scroll anchoring off;
  **[ios]**. The tests only learn about a scroll after iOS has drawn it. So a
  frame drawn past the newest note only shows up in a screen recording (D-091).
  Any change to where the scrolling stops needs one.
- On iOS, a flick keeps scrolling until it slows to a natural stop, however far
  down the stream is. **[e2e]** for the wait; **[ios]**.

### Jump to date

- On a phone, the list of dates opens with the keyboard down. A tap on the
  search field brings the keyboard up. **[e2e]** for the focus; **[ios]**.
- The calendar button opens iOS's date wheel. The e2e mobile tests run in
  desktop Chromium, which opens a date picker iOS never would. So they only
  check that a tap on the icon reaches the date input. **[ios]**

### Mobile

Do this before a release. `isDesktopOnly: false` promises that the plugin works
on mobile, and no automatic check can keep that promise.

Start with an emulated phone. `pnpm run demo` gives `is-mobile` and `is-phone`.
`--ipad` gives the tablet layout without `is-phone`, `--landscape` turns either
one on its side, and `--desktop` gives neither. Run it again to switch: each
option sets the window to the right size. The mobile CSS shows layout problems
and too-small touch targets in seconds, but Electron's Chromium cannot show a
bug that only iOS's WKWebView has.

Then use a real device:

| Platform      | How                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS           | Vault in iCloud Drive: copy the three built files on the Mac into `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<vault>/.obsidian/plugins/daily-notes-stream/`. The Files app hides dot-folders. |
| iOS, no cable | BRAT with a published pre-release. This also tests the real release files.                                                                                                                                  |
| Either        | Obsidian Sync with "Installed plugins" turned on.                                                                                                                                                           |

Checks:

- Nothing scrolls sideways: code and URLs wrap, wide tables stack, wide Bases
  are shown as cards, and wide equations shrink to fit. **[e2e]** **[ios]** Each
  case is in **2026-08-30**.
- A Base's toolbar fits the note: there is no New button, and a long view name
  ends in "…". **[e2e]** **[ios]**
- A kanban wider than the note is shown as cards, with one group for each
  column, upright and on its side. **[e2e]** **[ios]**
- With **One card per row** on, each card of a wide Base shown as cards is as
  wide as the note. A Base that is set to cards keeps its own card size.
  **[e2e]**
- A PDF shows its first page without a toolbar. A tap opens the PDF. **[e2e]**
  **[ios]**
- A web page in an `iframe` shows. A flick over it scrolls the stream, and a tap
  opens the page. **[e2e]** **[ios]**
- The video shows its thumbnail under a play button. A tap opens it on YouTube.
  **[e2e]** **[ios]**
- Turning the phone lays the notes out again without cutting anything off. With
  a Base on screen, a wide one changes to cards or back to a table, and a wide
  equation grows or shrinks with the note. **[ios]**
- Turn the phone both ways, first with a title just below the top of the screen,
  then with the top on a Base's last card and a heading below it. What was at
  the top stays there, and no note is skipped. **[e2e]** with scroll anchoring
  off, but Chromium draws a Base in a different order, so only the device proves
  it. **[ios]** for text and for a Base at the top, turned to landscape and
  back, and for a heading in a tall note with Bases above the top of the screen.
- Scroll through a Base table with summaries. Its header and summary row move
  with it, and never float over the page. **[e2e]** **[ios]**, in landscape,
  because in portrait a phone shows every Base as cards.
- Scroll far, pause, then flick both ways past Bases and tables. Each flick
  scrolls until it slows to its natural end. **[ios]** for Bases.
- A Base on screen gets a new row from another pane. The text below it never
  jumps away and back. **[ios]**
- A kanban just above the top of the screen changes from a board to cards. The
  next note's text stays still. **[ios]**
- Jump to an old date, then flick up. The text under your finger does not jump
  as the notes above are rendered, and the scrolling is not cut short. **[ios]**
- A Base that fills in just above the top of the screen leaves the text below it
  still. **[e2e]** with scroll anchoring off; **[ios]**.
- Jump to an old date, then tap "Daily Notes Stream" in the header. The stream
  scrolls to the newest note and stays at the very top. Tapping the search or
  jump button does not scroll. **[e2e]** **[ios]**
- Tap a note's title, then Back. The stream comes back at the same place and
  does not move after that. Try it with a Base at the top of the screen, and
  near the end of the 10th or 20th note (the last note of a batch). **[e2e]**
  for Chromium's timing. iOS gives back the place one frame later, so only the
  phone shows when this fails. **[ios]**
- Search for a word. Every match on screen is highlighted, and the current one
  is in the selection color. A long-press selects text in a note. **[ios]**
- The arrows on headings, list items and the properties row can be tapped
  without zooming, and a tap on a heading's _text_ still selects it. **[ios]**
- Flick hard down a 10,000-line note and back. The screen never goes blank.
  **[ios]** checks that the space kept for a hidden part of the note never
  reaches the screen. Only a screen recording (`scripts/capture-iphone.swift`)
  shows a blank screen (ADR 0021).
- Flick hard past a 10,000-line note to the oldest note. The scrolling stops
  there, with nothing blank below it except iOS's bounce (D-140). **[unit]**;
  only the phone shows the blank.
- Jump to a day below a long note you have not seen yet, then flick up into it.
  Its end shows at once, without a title above, and what is on screen stays
  still while the rest of the note is rendered. **[e2e]**; only a screen
  recording shows that the screen stays filled (ADR 0022).
- A hard flick to the bottom loads the next batch with no repeated notes and no
  stall. More flicks keep loading. **[ios]**
- Switching to another app and back keeps the place, and scrolling still works.
  **[ios]**
- Editing a note that is on screen somewhere else re-renders it where it is.
  **[ios]**
- There are no errors in the console (Safari → Develop). **[ios]**

There is no Android check (D-096).

## Debugging

Open the Developer Console (`Cmd+Opt+I`). The plugin's messages start with
`DailyNotesStream:`. "No daily notes found" means the core Daily notes plugin is
not set up, or no file matches.

An e2e failure is recorded in `test-results/runs/<start time>.json`. There is
one file per run, and they are kept. Traces for the latest run are in
`test-results/artifacts/`; the next run deletes them.
