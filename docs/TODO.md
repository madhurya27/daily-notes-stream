# TODO

## Open

Most important first. Problems on iOS that last only a frame or two wait until
there is a screen recording of them (D-099).

- [ ] On the iPad, which Obsidian treats as mobile and so gives the phone
      layout:
    - [ ] Show the scroll-to-top button, as on desktop: the header has room for
          it. Like every header button there, it needs two taps (see Known
          limits). Decide whether a tap on the title should then stop scrolling
          to the top. This changes D-147.
    - [ ] Make the search bar only as wide as what is in it. Now the field is on
          the left and the close button on the right, with an empty gap between
          them.
- [ ] On the iPad, a flick up after a jump sometimes stops suddenly while still
      fast, far from the top (D-171). It happens in bursts that last minutes. On
      2026-10-21, the first test in `jump.spec.ts` failed 2 of 4 runs, then
      passed 37 in a row. On 2026-10-25, the first flicks after heights were
      forgotten failed up to 5 of 5, then about 180 flicks passed that day. No
      script sets the scroll position when it stops, and the page keeps drawing
      frames. When a burst happens, compare the stream with a test page that
      does the same drawing and the same shifts, to find what stops the scroll.
      Since D-173, a pause in drawing is no longer counted as a stop, so a stop
      that is reported is real.
- [ ] On the iPad, `far-runs.spec.ts` fails 2 of 5 runs, on `main` too
      (2026-10-25). The space kept for a hidden part of a long note stays on
      screen for two frames in a row, once or twice in a run. ADR 0023 measured
      one frame at most, on an iPhone. Before changing the distance at which
      notes are drawn, or the test, find out whether the iPad's taller screen or
      faster scrolling gets ahead of the drawing.
- [ ] On the iPad, a flick that scrolls down the stream over a Base stops the
      page from drawing for 330–410 ms, about 0.55 s after the finger lifts, on
      every flick (D-173; the test "flick up over a Base" in `stream.spec.ts`,
      named for the direction of the finger). The test vault's `2026-08-30` has
      seven Bases, which are drawn, and drawn again as cards, while the page
      scrolls. iOS keeps scrolling, but nothing new is drawn in that time. First
      check a real journal note with one or two Bases. Then either spread the
      drawing over several frames, or wait to draw the cards until scrolling
      stops.
- [ ] While the reader types a search, mark only a match the reader can see
      (D-022). `isOnScreen` checks the whole pane, so on a phone it can mark a
      match under the floating header, the bottom bar or the open keyboard.
      Enter then moves past it. Measure the pane without what covers it, and
      prove it on the phone layout and on the iPhone.
- [ ] Remove the outline Obsidian draws around a property when the pointer is
      over it: it suggests the property can be edited, which the read-only
      stream doesn't allow. Check desktop and the phone layout.
- [ ] Try adding the e2e tests to CI on Linux.
- [ ] Once the directory's scorecard lint understands moment's types, go back to
      Obsidian's `moment` and delete `src/notes/moment.ts` (D-152).
- [ ] If the stall error (D-164) doesn't explain the next time the stream is
      blank after Back, add a debug report that can be copied: a setting records
      recent loads, draws and returns to the stream, and a command copies them
      with the version numbers. Not the console: Obsidian's lint does not allow
      `console.log`, even behind a setting.

## Known limits

Measured and accepted. Opened again if a reader notices.

- [ ] On the iPad, in landscape, the first tap on a view's header only expands
      it to show the note's path; the second tap reaches the button or the
      title. This is how Obsidian works in every view, not just the stream.
- [ ] A hard flick up the stream on the iPhone scrolls faster than notes can be
      drawn. A note waits for its turn in the drawing queue (ADR 0004) while the
      page moves 200–800 px each frame. On 2026-10-16, flicks of four strokes
      showed a note not yet drawn for 1–4 frames, up to 293 px. This happened in
      6 of 6 scrolls with heights remembered, and in 3 of 6 with heights
      forgotten. Drawing notes up to 3 panes away was not clearly better. The
      other blank moments are over text that was already drawn, and Obsidian's
      own reading view shows those too (up to 185 ms).

## Features

New things the plugin could do, unlike the fixes above. Editors inside the
stream are ruled out by D-001.

Compared in 2026-09 with Obsidian's core plugins and the community directory.
**The rule: anything that works on a _file_ is already done by other plugins.
Only what works on _the stream_ is ours**, and only where it is worth the extra
complexity. Most important first.

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
      days are above it, and scrolling up still reaches them. Do it the same way
      a jump works (D-082), so the notes above load as they do for any jump.
      With no note for today, open at the nearest older one (D-015). With no
      future notes, open at the top, as now.
- [ ] Show in stream: a command, and an item in a daily note's file menu, that
      open the stream at that note, the same way a jump works (D-082). Now, the
      only way back to the stream from a note is Back.
- [ ] Go to a day chosen in the
      [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) plugin.
      With the stream open, a click on a day scrolls the stream there, the same
      way a jump works (D-082), instead of opening a new tab. That shows which
      days have notes, without a calendar of our own. Calendar opens the file
      itself, so first check whether the click can be caught (with its API, or
      the `file-open` event). In practice this is for desktop only: on a phone,
      the sidebar is a drawer.
- [ ] Labels on the title line: the day of the week (`2026-03-14 · Saturday`, or
      "Yesterday"), and the time since the note before ("12 days later"). Decide
      first whether they come from the file name, or from a label the reader
      sets up. Creating or deleting a note changes the gap shown on the note
      next to it, so that note must be drawn again.
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
