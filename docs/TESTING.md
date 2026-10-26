# Testing

## Setup

```bash
pnpm test                            # unit
pnpm run test:e2e                    # every spec twice, desktop and mobile
pnpm run test:e2e --project=mobile   # one project
pnpm run test:e2e webkit.spec.ts     # the phone layout in iOS's engine (ADR 0009)
pnpm run test:ios                    # Obsidian on a plugged-in iPhone or iPad (ADR 0016)
pnpm run demo --test                 # the test vault, below; --help lists every option
```

`pnpm run demo` runs its own Obsidian against `.dev/obsidian-userdata`, beside
your real one, on the main display: it is meant to be watched, unlike the
transparent e2e window. Each run builds if there is no build, reseeds the vault,
links its plugin files to the repo's build, and reloads the plugin on every save
until Ctrl-C, which closes the window. Anything typed into the vault lasts until
the next run; `.obsidian` is kept, so your layout survives. Phone mode has no
draggable region, so `--position` moves the window.

### Test vault: `--test`, `.dev/vault/`

What the checklist below is written against. `pnpm run seed --test` alone takes
`--days N` for the filler count (`400` for deep history, `12` for barely past
one batch) and a path to seed elsewhere.

- 123 daily notes in `Notes/`: 120 filler notes and the three the checklist
  names by date.
- Filler cycles eight shapes, among them long notes, a wide code block, a wide
  table, tasks and a blockquote, H1–H6 nesting, no frontmatter (so the
  properties panel is tested by its absence), and Bases (so they recur all the
  way down).
- **2026-08-30**, the newest: one of each embed the e2e tests cover. Bases wide,
  narrow, too wide only in their values, resized by hand, a named view, a kanban
  and inline (the Bases live in `Bases/`), plus embedded notes, a PDF, a video
  iframe, display math, Mermaid and a wide table.
- **2026-08-29**, the newest filler note: linked mentions of every kind, from a
  nested list item, a paragraph, a wide table and a property. `[[Agenda]]` in
  `Projects/Plan.md` must open `Projects/Agenda.md`, not `Notes/Agenda.md`.
- **2026-02-01**: nested lists, repeated headings, a heading holding a link and
  `test-image.svg`. It and **2026-01-15** carry the frontmatter listed under
  Properties.
- A dated `.png` and a dated note outside the daily-notes folder, which must
  _not_ appear.

### Demo vault: the default, `.dev/demo-vault/`

90 days of a journal that reads like a real one: properties, links to people and
projects, tasks, callouts, run logs, a sketch, a reading-list Base every Sunday,
and project logs linking the newest days. Each note is seeded by its date, so a
retake shows the same content; `pnpm run seed` alone takes `--days N` and
`--until YYYY-MM-DD`. Screenshots and recordings come from it.

### iPhone or iPad: `pnpm run test:ios`, `pnpm run test:ipados`

Real touches on Obsidian on an iPhone or iPad plugged into the Mac, in a vault
the harness seeds, `Stream E2E`, stored on the phone. A run leaves the phone as
it found it: Obsidian reopens the vault it had open, then closes, back to the
Home Screen. WebDriverAgent turns off the keyboard's autocorrection and
predictive text; the run turns both back on at the end. To leave one off, set
`IOS_KEYBOARD_AUTOCORRECT=off` or `IOS_KEYBOARD_PREDICTION=off` (D-112), on the
command line or in a gitignored `e2e-tests/ios/.env`. `IOS_SEED_DAYS=1825` seeds
five years of journal in place of 21 days (D-158). `test:ios` drives the iPhone
on the cable, `test:ipados` the iPad, so both can stay plugged in (D-169). An
iPad runs in the orientation it was found in. Its keyboard can be attached or
not: the tests type on iOS's on-screen keyboard and make it appear if a keyboard
is attached. After a run with a keyboard attached, iOS keeps showing its
keyboard until you detach and attach the keyboard again (D-174). Once per Mac
and device; "phone" below means either:

1. Install Xcode, open it once, and add an Apple ID under Settings → Accounts.
   Then Manage Certificates → + → Apple Development. A free account is enough.
   Point the shell at it, so `xcrun devicectl list devices` finds the phone:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
2. Plug the phone in, unlock it and tap Trust.
3. On the phone: Settings → Privacy & Security → Developer Mode on (it
   restarts), and Settings → Apps → Safari → Advanced → Web Inspector on.
4. Obsidian must open without Face ID or Touch ID: long-press its icon → Don't
   Require.
5. Run `pnpm run test:ios`. Its first run fails to launch WebDriverAgent until
   the phone trusts the certificate: Settings → General → VPN & Device
   Management → Apple Development → Trust. Run it again.

Each run:

- **Before:** plug the phone in and unlock it. Auto-Lock must be longer than the
  pauses in a run, which last under a minute: a locked phone fails the run at
  once, and one that locks mid-run fails every test after. Low Power Mode holds
  Auto-Lock at 30 seconds.
- **For many runs in a row**, as in an agent's session: Settings → Display &
  Brightness → Auto-Lock → Never, or the phone locks between them.
- **After:** set Auto-Lock back. At Never the phone does not lock.

Appium's log is `.dev/appium.log`; WebDriverAgent's build log is
`.dev/wda-build.log`.

A free account's profile lasts 7 days; each run renews it, if Xcode still has
the account. When a run fails:

| Error                                                                   | Fix                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `xcodebuild build-for-testing` failed; the build log says "No Accounts" | Xcode → Settings → Accounts: sign the Apple ID back in                                 |
| Every test fails at once, "Unable to launch WebDriverAgent", code 65    | On the phone: Settings → General → VPN & Device Management → Apple Development → Trust |

## Verification

What `pnpm run test:e2e` cannot check; the specs in `e2e-tests/` hold the rest.
**[e2e]** marks an item the suite covers in part, **[ios]** one
`pnpm run test:ios` does.

### Core

- On iOS, scroll through the stream, quit Obsidian, reopen it and jump to an old
  date; scroll back up by hand: the glide stops on the newest note, and nothing
  jumps once it stops. **[e2e]** with anchoring off; **[ios]**. The harness
  learns of a scroll only after iOS has drawn it, so a frame drawn past the
  newest note shows up only in a screen recording (D-091). Any change to where
  the glide stops needs one.
- On iOS, flicks glide to a natural stop, however far the stream has scrolled.
  **[e2e]** for the wait; **[ios]**.

### Jump to date

- On a phone the suggester opens with the keyboard down; a tap on the query
  raises it. **[e2e]** for focus; **[ios]**.
- The calendar button opens iOS's date wheel. The e2e mobile project runs
  desktop Chromium, which opens a picker iOS never would, so it checks only that
  a tap on the icon lands on the date input. **[ios]**

### Mobile

Run before a release: `isDesktopOnly: false` is a promise no static check keeps.

Emulate first. `pnpm run demo` gives `is-mobile` and `is-phone`, `--ipad` the
tablet layout without `is-phone`, `--landscape` either on its side, and
`--desktop` neither. Re-run it to switch: each flag sizes the window to match.
The mobile CSS catches layout and touch-target problems in seconds, but
Electron's Chromium cannot reproduce a WKWebView bug.

Then a real device:

| Platform      | Route                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS           | Vault in iCloud Drive: copy the three built files on the Mac into `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<vault>/.obsidian/plugins/daily-notes-stream/`. The Files app hides dot-folders. |
| iOS, no cable | BRAT against a published pre-release — also exercises the real release artifacts.                                                                                                                           |
| Either        | Obsidian Sync with "Installed plugins" enabled.                                                                                                                                                             |

Checks:

- Nothing scrolls sideways: code and URLs wrap, wide tables stack, wide Bases
  draw as cards, wide equations shrink to fit. **[e2e]** **[ios]** Each case is
  in **2026-08-30**.
- A Base's toolbar fits the note: no New button, a long view name ends in an
  ellipsis. **[e2e]** **[ios]**
- A kanban wider than the note draws as cards, every column a group, upright and
  on its side. **[e2e]** **[ios]**
- With **One card per row** on, each card of a wide Base drawn as cards fills
  the note's width; a Base written as cards keeps its own size. **[e2e]**
- A PDF shows its first page without a toolbar; a tap opens the PDF. **[e2e]**
  **[ios]**
- A web page in a frame shows; a flick over it scrolls the stream, and a tap
  opens the page. **[e2e]** **[ios]**
- The video shows its thumbnail under a play button; a tap opens it on YouTube.
  **[e2e]** **[ios]**
- Rotation reflows without clipping. With a Base on screen, a wide one turns to
  cards or back to a table; a wide equation grows or shrinks with the note.
  **[ios]**
- Turn the phone both ways with a title just below the screen's top, then with
  the top on a Base's last card and a heading below: what was at the top stays
  there, and no note is skipped. **[e2e]** with anchoring off, but Chromium
  redraws a Base in a different order, so only the device proves it. **[ios]**
  for text and a Base at the top, turned to landscape and back, and for a
  heading in a tall note with Bases above the screen's top.
- Scroll through a Base table with summaries: its header and summary row move
  with it, never floating over the page. **[e2e]** **[ios]**, in landscape,
  since in portrait a phone draws every Base as cards.
- Scroll far, pause, flick both ways past Bases and tables: each flick glides to
  its natural end. **[ios]** for Bases.
- A Base on screen gains a row from another pane: the text below never jumps and
  returns. **[ios]**
- A kanban just above the screen's top redraws from a board to cards: the next
  note's text stays still. **[ios]**
- Jump to an old date, then flick up: the text under your finger does not jump
  as the notes above render, and the glide is not cut short. **[ios]**
- A Base filling just above the screen's top leaves the text below still.
  **[e2e]** with anchoring off; **[ios]**.
- Jump to an old date, then tap "Daily Notes Stream" in the header: it glides to
  the newest note and stays at the very top. Tapping the search or jump action
  does not scroll. **[e2e]** **[ios]**
- Tap a note's title, then Back: the stream comes back at the same place and
  does not move after. Try it with a Base at the top of the screen, and near the
  end of the 10th or 20th note (a batch's last). **[e2e]** for Chromium's
  timing; iOS hands the place over a frame later, so only the phone shows its
  failures. **[ios]**
- Search a word: every match on screen is highlighted, the current one in the
  selection color. A long-press selects text in a note. **[ios]**
- Chevrons on headers, list items and the properties row are tappable without
  zooming, and a tap on heading _text_ still selects. **[ios]**
- Flick hard down a 10,000-line note and back: the screen never goes blank.
  **[ios]** checks that no hidden run's spacer reaches the screen; only a screen
  capture (`scripts/capture-iphone.swift`) shows a blank (ADR 0021).
- Flick hard past a 10,000-line note to the oldest note: the glide stops at it,
  with nothing blank below but iOS's bounce (D-140). **[unit]**; only the phone
  shows the blank.
- Jump to a day below a long note not seen yet, then flick up into it: its end
  shows at once, under no title, and what shows stays put as the note finishes.
  **[e2e]**; only a screen capture shows that the screen stays filled (ADR
  0022).
- A hard flick to the bottom loads the next batch without duplicates or a stall;
  repeated flicks keep loading. **[ios]**
- Backgrounding and returning keeps position and keeps scrolling. **[ios]**
- Editing a visible note elsewhere re-renders it in place. **[ios]**
- No console errors (Safari → Develop). **[ios]**

No Android pass (D-096).

## Debugging

Developer Console (`Cmd+Opt+I`), `DailyNotesStream:` prefixed logs. "No daily
notes found" means the core daily notes plugin is unconfigured or nothing
matches.

An e2e failure is in `test-results/runs/<start time>.json`, one per run and
kept. Traces for the latest run are in `test-results/artifacts/`; the next run
wipes them.
