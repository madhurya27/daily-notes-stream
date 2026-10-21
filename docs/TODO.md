# TODO

## Open

Ordered by priority. Frame-level iOS glitches wait on a recording (D-099).

- [ ] On the iPad, which Obsidian counts as mobile, so it gets the phone layout:
    - [ ] Show the scroll-to-top button, as on desktop: the header has room for
          it. Like every header button there, it takes two taps (see Known
          limits). Decide whether the title tap then stops scrolling to the top.
          Amends D-147.
    - [ ] Fit the search bar to its contents: the field sits on the left and the
          close button on the right, with an empty gap between them.
- [ ] On the iPad, a flick up from a jump is sometimes killed at speed:
      `jump.spec.ts`'s first spec fails about 1 run in 3. Some 120 ms after the
      lift the stream starts owing a shift as the notes above render; some 100
      ms later the glide stops dead at 230 px a step, far from the top (D-171).
      Find what ends it.
- [ ] Make typing a search mark only a match the reader can see (D-022):
      `isOnScreen` checks the whole pane, so on a phone it marks one under the
      floating header or bottom bar, or under the open keyboard. Enter then
      steps past it. Measure the pane minus what covers it; prove it on the
      phone layout and the iPhone.
- [ ] Drop the outline Obsidian draws around a property on hover: it offers an
      edit the read-only stream doesn't allow. Check desktop and the phone
      layout.
- [ ] Explore adding e2e tests to CI on Linux.
- [ ] Once the scorecard's lint resolves moment's types, return to Obsidian's
      `moment` and drop `src/notes/moment.ts` (D-152).
- [ ] If the scorecard still warns on `styles.css`'s last `!important` (D-153),
      clear Dataview's and Obsidian's inline `overflow-x` from code instead;
      needs a D-003 exception.
- [ ] If the stall error (D-164) doesn't explain the next blank stream after
      Back, add a copyable debug report: a setting records recent loads, draws
      and returns, and a command copies them with the versions. Not the console:
      Obsidian's lint forbids `console.log`, even behind a setting.

## Known limits

Measured and accepted. Reopened if a reader notices.

- [ ] On the iPad, in landscape, the first tap on a view's header only expands
      it to show the note's path; the second reaches the button or title.
      Obsidian's behaviour, in every view, not the stream's.
- [ ] A hard flick up the stream on the iPhone outruns the drawing of notes: a
      note waits its turn in the render queue (ADR 0004) while the glide moves
      200–800 px a frame. On 2026-10-16, 4-stroke flicks showed an undrawn note
      for 1–4 frames, up to 293 px: in 6 of 6 glides with heights remembered, 3
      of 6 with them forgotten. A render margin of 3 panes was not clearly
      better. The other blanks are over text already drawn, and Obsidian's
      reading view shows those too (up to 185 ms).

## Features

New capability, as opposed to the fixes above. Embedded editors are ruled out by
D-001.

Surveyed 2026-09 against core and the community directory. **The filter: what
operates on a _file_ is already solved elsewhere; only what operates on _the
stream_ is ours**, and only where it is worth its complexity. Ordered by
priority.

- [ ] On this day — one calendar date across years: a `NoteFilter`, like hiding
      empty notes.
      [Journal Review](https://github.com/Kageetai/obsidian-plugin-journal-review)
      shows ~200-char excerpts; ours would show the full note. Better, not new.
- [ ] Keep the place across a restart. `StreamPlace` lives only in ephemeral
      state, so Back finds it but a restored tab opens at the newest note.
      Persist it in `getState`; a stream opened fresh still starts at today.
- [ ] Open at today's note, not the newest: notes made ahead for future days sit
      above it, and scrolling up still reaches them. Through the jump's path
      (D-082), so the notes above load as for any jump. With no note today, the
      nearest older one (D-015); with no future notes, the top as now.
- [ ] Show in stream: a command and a file-menu item on a daily note that open
      the stream at it, through the jump's path (D-082). From a note, only Back
      reaches the stream now.
- [ ] Land on a day from the
      [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) plugin:
      with the stream open, a click on a day scrolls it there through the jump's
      path (D-082), not a new tab. That gives an overview of which days have
      notes, without a calendar of our own. Calendar opens the file itself:
      check first whether the click can be caught (its API, or `file-open`).
      Desktop only in practice; a phone's sidebar is a drawer.
- [ ] Labels on the title line: the weekday (`2026-03-14 · Saturday`, or
      "Yesterday") and the gap since the note before ("12 days later"). Decide
      first: from the file name, or a label the reader configures. Creating or
      deleting a note changes its neighbour's gap, so that note re-renders.
- [ ] Fold headings by name: a setting listing headings (`Tasks`, `Log`) that
      start folded in every note, for template sections read rarely. A default
      for `CollapsibleManager`; the reader's own fold or unfold wins.
- [ ] Fold a whole note to its title, from a chevron on its header, kept like a
      section's (`CollapsibleManager`).
- [ ] Notes as `article` landmarks labelled with their date, so a screen reader
      steps note to note.
- [ ] Keyboard navigation — `j`/`k` between notes, `g`/`G` for ends. No other
      plugin can add keys inside our view.
- [ ] Jump by month or relative date: the prompt takes `2025-03`, `last week`,
      `a year ago`, landing on the nearest older note (D-015).
- [ ] Month and year dividers — a heading inside the header of a month's newest
      note, not a block of its own: the window manager and `StreamBlocks` take
      every block for a note.
- [ ] Leave out a note by property (`stream: false`): a `NoteFilter`, like
      hiding empty notes, for days not to show when the screen is shared.
- [ ] Say under **Hide empty notes** whether the daily-notes template can be
      matched, naming the block that stops it (`if`, loops, `tp.web.*`,
      `tp.user.*`). A `tp.user.*` script may write one line or several, so for
      one the setting would say the note "may always show".
- [ ] Match `tp.file.include` by inlining the included file into the template
      pattern (D-117), reading its blocks the same way. Wait for a user who
      includes a file in their daily template.

Out of scope:

- Random note — core ships it.
- Task rollup — Tasks owns it, and read-only cannot check a box.
- Folder or tag modes — dilute what the plugin is.
- A tag or header filter — search does it.
- A sticky date header — D-012.
- Collapse-all — leaves a list of dates, which the file explorer already is.
- A gutter timeline — scrubbing writes the scroll, which iOS drops or undoes
  mid-glide (ADR 0013); the jump modal reaches any date.
- Journals support, or Periodic Notes' weekly and monthly notes — a second note
  source behind `DailyNoteService`. Revisit if users ask. Periodic Notes' daily
  settings already work (`e2e-tests/periodic-notes.spec.ts`).
- Hiding untouched notes whose Templater blocks write several lines — D-117's
  rejected fingerprints. Revisit if users ask.
- Period scope — newest-first already opens on this week; the jump modal reaches
  past ones.
- Range export, a stats header — niche; core Word count and heatmap plugins
  cover stats.
- Oldest-first — newest-first is assumed by pagination, inserts and D-091's stop
  at the top.
