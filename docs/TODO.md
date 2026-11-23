# TODO

## Bugs

Most important first. Problems on iOS that last only a frame or two wait until
there is a screen recording of them (D-099).

- [ ] As a long note draws from its end, a Base below the pane's top pushes the
      text up, and the anchor holds the text, which moves the tail and the next
      note down: 128 px in 1 of 8 hard flicks (D-203). With its tail on screen,
      the note could hold its tail instead. On 2026-11-02, 32 runs of two
      four-stroke flicks on an iPad in portrait never moved it 30 px, so wait
      until it shows again.
- [ ] Find why about 1 iPad glide in 16 stops dead within 300 ms of the lift, in
      either direction, with or without D-229. Nothing in the page sets them
      apart: no scroll set, no batch, no late frame, the same touches.
      Obsidian's reading view of a long note had 0 in 48
      (`.dev/zcontrol.spec.ts`), but it is not a fair control: a single note
      loads, hides and adds nothing during a glide. Probe: `.dev/zcut.spec.ts`.
- [ ] If the stall error (D-164) doesn't explain the next blank stream after
      Back, add a debug report to copy: a setting records recent loads, renders
      and returns to the stream, and a command copies them with the version
      numbers. Not the console: Obsidian's lint does not allow `console.log`,
      even behind a setting.
- [ ] Remove the outline Obsidian draws around a property under the pointer: it
      suggests the property can be edited, which the read-only stream doesn't
      allow. Check desktop and the phone layout.

## Flaky tests

Seen only in tests or on CI. Most important first; removing the retry comes
last, once the others are fixed.

- [ ] Find why Back sometimes lands off when no heights are remembered, outside
      iOS. Seen only in tests so far, but a reader could meet it.
      `history.spec.ts`'s test of it lands 233 px off about 1 time in 15, only
      on Linux's mobile project, so it retries, and CI warns of each retry. The
      note above and the note read, both empty at the 2-pane guess (1526 px),
      are drawn at 1293 px before the first frame at the new place, and Chromium
      does not correct. Chromium skips its correction when its anchor changes
      height in the same layout as a note above; in the stream, nothing yet
      shown forces that. Not enough alone, in tests that never failed: wrong
      guesses at the return, both notes drawn with no frame between,
      re-estimating right after the return, and a desktop pane tall enough to
      make the guess wrong (0 in 15 on Linux). Branch
      `fix/back-place-after-load` reads the place again after loading batches,
      which a unit test shows can matter, but did not fix it.
- [ ] Find why `settings.spec.ts`'s "redraws the stream on a setting's change"
      once found its note 937 px off, on desktop on Linux, after the test
      scrolled it to the top and before any setting changed. Seen once in 4 full
      runs in the Linux container. The test retries, and CI warns of each retry.
      It may be the same as Back's 233 px, which is not shown.
- [ ] Find why `stream.spec.ts`'s "leaves the anchoring to the platform where it
      has its own" once found the fourth note 520 px above the pane for 15 s, on
      desktop in CI run 44368644564, after scrolling it to the top and before
      the note above grew. The notes above had drawn, and Chromium never moved
      it back. It may be the same as Back's 233 px and the 937 px above. Not
      seen in 130 runs on the Mac and in the Linux container, alone or after the
      tests its CI worker ran first. On failure, the test now lists each scroll
      and each change of the first five notes' heights and classes. Delete that
      log once this is fixed.
- [ ] Find why Chromium sometimes loses the promise of the e2e startup's
      `page.evaluate` that closes settings ("Resulting promise was garbage
      collected"). It failed 2 of about 22 full runs on Linux, each at a run's
      first startup, so `startUp` runs it again and CI warns of each retry. A
      reload would give a different error, and `setting.close()` returns
      nothing. Not reproduced in 1,300 startups in the Linux container: in a
      loop, in 150 fresh containers, and in 50 containers that install, build
      and run `bases-cards.spec.ts` first.
- [ ] Find why a page froze once on Linux CI: `jump.spec.ts`'s "narrows to what
      is typed", on desktop, right after a Back test on the same worker. It
      stopped drawing about 130 ms into `openStream`, as the old stream was
      closed, and answered nothing, a key press included, for the test's 60 s.
      Not seen in 4 full runs in the Linux container. The harness now logs where
      the page's JavaScript is when a page stops answering for 10 s.
- [ ] Remove the retry every e2e test gets on CI (D-233) once 10 CI runs in a
      row warn of no test that passed only on a retry. GitHub keeps the count:
      this lists `main`'s last 10 runs, with how many tests each warned of ("no
      e2e job" before 2026-11-15).

      ```bash
      gh run list -w ci.yml -b main -s completed -L 10 --json databaseId,conclusion --jq '.[] | "\(.databaseId) \(.conclusion)"' |
        while read id result; do
          job=$(gh run view "$id" --json jobs --jq '.jobs[] | select(.name == "e2e") | .databaseId')
          flaky=$([ -n "$job" ] && gh api "repos/{owner}/{repo}/check-runs/$job/annotations" --jq '[.[] | select(.title == "Flaky e2e test")] | length' || echo "no e2e job")
          echo "$id $result flaky: $flaky"
        done
      ```

      These failed once each in 4 runs of one commit on GitHub's runner, and
      passed on the rest:
    - `stream.spec.ts`'s "takes a note a few panes above out of the layout
      mid-glide", on desktop: the 12,143 px note at the top was never hidden
      during the 1.5 s glide. The glide steps on a 16 ms timer and ends one pane
      past the hiding distance, but 10 runs each on a CPU slowed 6x and 20x
      passed. It failed the same way on mobile in CI run 44383145164. Locally
      the note is hidden about 80 ms before the glide ends. On failure, the test
      now lists the block's classes at each change and in the 10 frames after
      the glide: they show whether hiding came late or never. Delete that log
      once this is fixed.
    - `note-links.spec.ts`'s "preview the linked note on mod-hover", on desktop,
      in CI run 44383145164 only: no preview of "Book 1" showed within 15 s of
      the hover with Ctrl or Cmd held. The retry showed it in 3 s.

## Waiting on others

Each starts when another project ships what it needs.

- [ ] Update to TypeScript 7 once `typescript-eslint` allows it. 8.72.2 allows
      only TypeScript below 6.1.
- [ ] Once Stryker and `typescript-eslint` accept `minimatch` 11.0.1 or later,
      update them and check that the lockfile has no `minimatch` from 7.0.0 to
      11.0.0. That clears Dependabot alert #107, a slow-down from crafted globs,
      dismissed until then: only dev tools use it, on our own globs.
- [ ] Once the directory's scorecard lint understands moment's types, go back to
      Obsidian's `moment` and delete `src/notes/moment.ts` (D-152).
- [ ] Delete the 13 PNG screenshots in `docs/images/` once the directory's
      listing shows a README that uses the WebP ones. The listing shows the
      1.3.2 README, and loads its images from `main`.

## Known limits

Measured and accepted. Opened again if a reader notices.

- A hard flick up on the iPhone scrolls faster than notes can be rendered: a
  note waits its turn in the render queue (ADR 0004) while the page moves
  200–800 px a frame. On 2026-10-16, four-stroke flicks showed a note not yet
  rendered for 1–4 frames, up to 293 px. That happened in 6 of 6 scrolls with
  heights remembered, and 3 of 6 with them forgotten. Rendering notes up to 3
  panes away was not clearly better. Other blank moments are over text already
  rendered, and Obsidian's own reading view shows those too (up to 185 ms). A
  note not yet drawn shows nothing at all; its date in the empty box might look
  less like a failure, with no drawing cost.
- On the iPad, a glide that renders a note with many Bases leaves part of the
  screen black for about 0.3 s. Longest late frame (2026-10-26):
    - eight Bases: 359 ms, filmed black for 280 ms. Three: 124 ms. One or two:
      none over 100 ms.
    - The target phone is half the iPad's speed (D-131), so expect about double.
      Desktop Chromium can't show it, because Bases is cheap there. Measure on a
      slow iPhone.
    - The pause is Obsidian's Bases code, after our rendering. Only holding back
      each Base until the glide stops would fix it, at the cost of an empty box
      and a new state in the scroll anchor (ADR 0013). Giving the thread back
      between Bases made it worse (D-211).

## Features

New things the plugin could do, unlike the fixes above. Editors inside the
stream are ruled out by D-001.

Compared in 2026-09 with Obsidian's core plugins and the community directory.
**The rule: anything that works on a _file_ is already done by other plugins.
Only what works on _the stream_ is ours**, and only where it is worth the extra
complexity. Most important first.

- [ ] Edit the note being read without scrolling up to its title: a command
      ("Edit note being read") and a button that stays reachable in a long note.
      Open the note at the place being read, not at its top. With two notes on
      screen, the command edits the note being read (D-220), at the line a third
      down the pane. The button belongs to each note, kept at the note's top
      while it is on screen (`position: sticky` in its block), so it always
      edits its own note; it opens at the top of the note's part on screen. Not
      one button for the pane: in the gap between notes, the reader can't tell
      which note it edits. Check the sticky button with `test:ios` (ADR 0013).
- [ ] On this day: the same calendar date in every year. This would be a
      `NoteFilter`, like hiding empty notes.
      [Journal Review](https://github.com/Kageetai/obsidian-plugin-journal-review)
      shows extracts of about 200 characters; ours would show the whole note.
      Better, but not new.
- [ ] Keep the place after Obsidian restarts. `StreamPlace` is only kept in the
      view's temporary state, so Back finds it, but a tab that Obsidian restores
      opens at the newest note. Save it in `getState`. A stream opened new still
      starts at today.
- [ ] Open at today's note, not the newest one. Notes made in advance for future
      days are above it, and scrolling up still reaches them. Do it as a jump
      does (D-082), so the notes above load as for any jump. With no note for
      today, open at the nearest older one (D-015). With no future notes, open
      at the top, as now.
- [ ] Labels on the title line: the day of the week (`2026-03-14 · Saturday`, or
      "Yesterday"), and the time since the note before ("12 days later"). Decide
      first whether they come from the file name, or from a label the reader
      sets up. Creating or deleting a note changes the gap shown on the note
      next to it, so that note must be re-rendered.
- [ ] Fold headings by name: a setting that lists headings (`Tasks`, `Log`) that
      start folded in every note, for template sections the reader rarely reads.
      This would be a default for `CollapsibleManager`; the reader's own fold or
      unfold wins.
- [ ] Fold a whole note to its title, with an arrow on the note's header, kept
      the same way as a section's fold (`CollapsibleManager`).
- [ ] Make each note an `article` landmark, labelled with its date, so a screen
      reader can move from note to note.
- [ ] Keyboard navigation: `j` and `k` to move between notes, `g` and `G` to go
      to the top and bottom. No other plugin can add keys inside our view.
- [ ] Jump by month or by a relative date: the prompt accepts `2025-03`,
      `last week` or `a year ago`, and goes to the nearest older note (D-015).
- [ ] Scroll date indicator: while the stream scrolls fast, show the date of the
      note being read beside the scroll bar, as photo apps do. Mostly for a
      phone, where Calendar is a closed drawer and can't show where you are.
- [ ] Month and year dividers: a heading inside the header of a month's newest
      note, not a block of its own, because the window manager and
      `StreamBlocks` treat every block as a note.
- [ ] Leave a note out by a property (`stream: false`). This would be a
      `NoteFilter`, like hiding empty notes, for days that should not show when
      the screen is shared.
- [ ] Under **Hide empty notes**, say whether the daily notes template can be
      matched, and name the block that prevents it (`if`, loops, `tp.web.*`,
      `tp.user.*`). A `tp.user.*` script may write one line or several, so for
      such a script the setting would say the note "may always show".
- [ ] Match `tp.file.include` by copying the included file into the template
      pattern (D-117), and reading its blocks the same way. Wait until a user
      includes a file in their daily template.

Out of scope:

- Random note: a core plugin already does it.
- Collecting tasks from all notes: the Tasks plugin does it, and a read-only
  stream cannot tick a box.
- Folder or tag modes: they would make the plugin about something else.
- A tag or heading filter: search does it.
- A date header that stays at the top: D-012.
- Collapse all notes: that leaves a list of dates, which the file explorer
  already is.
- A timeline down the side to drag: dragging sets the scroll position, which iOS
  ignores or undoes while the page is scrolling (ADR 0013). The jump to a date
  reaches any date.
- Support for Journals, or for Periodic Notes' weekly and monthly notes: that
  needs a second source of notes behind `DailyNoteService`. Think again if users
  ask. Periodic Notes' daily notes settings already work
  (`e2e-tests/periodic-notes.spec.ts`).
- Hiding notes that were not changed, when their Templater blocks write several
  lines: these are D-117's rejected fingerprints. Think again if users ask.
- Showing only a period of time: newest first already opens on this week, and
  the jump to a date reaches older ones.
- Exporting a range, or a header with statistics: few would use them. The core
  Word count plugin and heatmap plugins cover statistics.
- Oldest first: loading in batches, adding notes, and D-091's stop at the top
  all assume newest first.
