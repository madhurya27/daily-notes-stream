# TODO

## Open

Most important first. Problems on iOS that last only a frame or two wait until
there is a screen recording of them (D-099).

- [ ] On the iPad, which Obsidian gives the phone layout:
    - [ ] Show the scroll-to-top button, as on desktop: the header has room.
          Decide whether a tap on the title still scrolls to the top (this
          changes D-147).
    - [ ] Make the search bar only as wide as its contents. Now an empty gap
          separates the field on the left from the close button on the right.
- [ ] On the iPad, a flick up after a jump sometimes stops suddenly while still
      fast, far from the top (D-171). It comes in bursts that last minutes. On
      2026-10-21, the first test in `jump.spec.ts` failed 2 of 4 runs, then
      passed 37 in a row. On 2026-10-25, the first flicks after heights were
      forgotten failed up to 5 of 5, then about 180 passed. No script sets the
      scroll position when it stops, and the page keeps painting frames. Since
      D-173, a stall in rendering does not count as a stop, so a reported stop
      is real. In the next burst, compare the stream with a test page that does
      the same rendering and shifts, to find what stops the scroll.
- [ ] On the iPad, every flick down the stream over a Base stops rendering for
      330–410 ms, about 0.55 s after the finger lifts (D-173; the test "flick up
      over a Base" in `stream.spec.ts`, named for the finger's direction). The
      test vault's `2026-08-30` has seven Bases, rendered and then re-rendered
      as cards while the page scrolls. iOS keeps scrolling, but nothing new is
      painted. First check a real journal note with one or two Bases. Then
      spread the rendering over several frames, or render the cards once
      scrolling stops.
- [ ] While the reader types a search, mark only a match they can see (D-022).
      `isOnScreen` checks the whole pane, so on a phone it can mark a match
      under the floating header, the bottom bar or the keyboard, and Enter then
      moves past it. Measure the pane without what covers it. Prove it on the
      phone layout and on the iPhone.
- [ ] Remove the outline Obsidian draws around a property under the pointer: it
      suggests the property can be edited, which the read-only stream doesn't
      allow. Check desktop and the phone layout.
- [ ] Try adding the e2e tests to CI on Linux.
- [ ] Once the directory's scorecard lint understands moment's types, go back to
      Obsidian's `moment` and delete `src/notes/moment.ts` (D-152).
- [ ] If the stall error (D-164) doesn't explain the next blank stream after
      Back, add a debug report to copy: a setting records recent loads, renders
      and returns to the stream, and a command copies them with the version
      numbers. Not the console: Obsidian's lint does not allow `console.log`,
      even behind a setting.

## Known limits

Measured and accepted. Opened again if a reader notices.

- [ ] A hard flick up on the iPhone scrolls faster than notes can be rendered: a
      note waits its turn in the render queue (ADR 0004) while the page moves
      200–800 px a frame. On 2026-10-16, four-stroke flicks showed a note not
      yet rendered for 1–4 frames, up to 293 px. That happened in 6 of 6 scrolls
      with heights remembered, and 3 of 6 with them forgotten. Rendering notes
      up to 3 panes away was not clearly better. Other blank moments are over
      text already rendered, and Obsidian's own reading view shows those too (up
      to 185 ms).

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
      days are above it, and scrolling up still reaches them. Do it as a jump
      does (D-082), so the notes above load as for any jump. With no note for
      today, open at the nearest older one (D-015). With no future notes, open
      at the top, as now.
- [ ] Show in stream: a command, and an item in a daily note's file menu, that
      open the stream at that note, as a jump does (D-082). Now, the only way
      back to the stream from a note is Back.
- [ ] Go to a day chosen in the
      [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) plugin.
      With the stream open, a click on a day scrolls the stream there, as a jump
      does (D-082), instead of opening a new tab. That shows which days have
      notes, without a calendar of our own. Calendar opens the file itself, so
      first check whether the click can be caught (with its API, or the
      `file-open` event). Desktop only in practice: on a phone, the sidebar is a
      drawer.
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
