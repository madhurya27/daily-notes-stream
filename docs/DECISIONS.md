# Decisions

Smaller design decisions. A decision that would need data to be moved, or code
to be rewritten across layers, to undo it belongs in [`adr/`](adr/) instead.

Entries are numbered in order, and the numbers never change. Refer to one by its
ID alone (`D-023`). When a decision is superseded, the old entry is marked as
superseded by the new one, not rewritten.

## D-001 — Editing is an action on the note, not an editor in the stream (2026-09-15)

**Decision:** the stream stays read-only. To edit, the reader acts on one note:
open the file in a split, or add to today's note.

**Why:** live updates, folding and the e2e tests all depend on the stream
rendering the Markdown itself.

**Rejected:** an editor inside each note, as
[Daily Notes Editor](https://github.com/Quorafind/Obsidian-Daily-Notes-Editor)
does — it needs four changes to Obsidian's prototypes, which is also why its
view cannot react to vault events.

**Rejected:** no way to edit at all — a typo the reader spots has nowhere to go.

## D-002 — The stream reloads on the vault's "raw" config event (2026-09-15)

**Decision:** listen to the undocumented `vault.on("raw")` event, filtered to
`vault.configDir`, and build the list again when Obsidian's daily notes format
or folder really changed. This is kept in `src/obsidian-internals.ts`.

**Why:** the format decides which files are daily notes, and nothing read it
again after `onOpen()`. No public event says that a core plugin's settings
changed, and the config file is the only signal that arrives before the next
vault event.

**Rejected:** checking `getDailyNoteSettings()` on a timer — waking up every few
seconds forever, to catch a change made once a year.

**Rejected:** checking again on `active-leaf-change` or on the next vault event
— costs nothing, but the stream stays wrong until the user happens to do
something.

## D-003 — An empty block's height is a CSS custom property (2026-09-20)

**Decision:** `NoteWindowManager` sets `--daily-note-placeholder-height` on an
empty block, and `styles.css` decides what to do with it. The compliance rule
against styling from JavaScript now allows `style.setProperty("--…")` and, since
D-172, `style.removeProperty("overflow-x")`.

**Why:** the height is whatever the note measured before it was unloaded, so no
class can hold it, and the rule is worth keeping for everything else.

**Rejected:** setting `style.height` directly — the same inline style, but
without the one place where a reader can see which rule uses it.

**Rejected:** the same height for every empty block — the scroll bar jumps by
the difference as soon as a note is rendered.

## D-004 — Task checkboxes cannot be ticked (2026-09-21)

**Decision:** `pointer-events: none` on a rendered task's checkbox. It shows the
file's state and ignores the click.

**Why:** `MarkdownRenderer.render` makes a real `<input>`, which the browser
ticks, and only Obsidian's own reading view saves that to the file. Here the
tick only exists in the DOM, and unloading the note or re-rendering it quietly
undoes it.

**Rejected:** saving the tick to the file — the stream is read-only, and finding
the line of the file that a rendered element came from is a feature of its own.

## D-005 — The stream moves the checkbox the way reading view does (2026-09-21)

**Decision:** `top: 0.2em` on a task checkbox in `styles.css`, the value
`.markdown-preview-view` sets.

**Why:** the stream renders under `markdown-rendered` only, so the preview
pane's own styles never apply, and the box sits 3px above its label.

**Rejected:** adding `markdown-preview-view` to the content element — it brings
the whole pane's stylesheet, including padding and line width.

## D-006 — A list item's fold arrow fills the line box, moved down by the list padding (2026-09-21)

**Decision:** the arrow gets `height: calc(var(--line-height-normal) * 1em)` at
`top: var(--list-spacing)`, as reading view does, instead of a 16px box centered
by hand.

**Why:** a line box and its text have the same center, so centering on the line
box centers on the words. `top` skips the list item's padding, because absolute
positioning measures from inside the padding.

**Rejected:** using half the difference between the line height and the icon
size — it ignores the padding and ends up 1.5px too high.

## D-007 — The properties panel is Obsidian's, with a heading like a note heading (2026-09-21)

**Decision:** the panel uses Obsidian's own stylesheet, not a copy of it. The
stream uses Obsidian's classes, and only adds what Obsidian cannot give a
read-only panel: the text styles for keys and values that its `input` selectors
miss, folding, the heading's place among the note's headings, and showing that
the panel is read-only. The heading is a sibling above `.metadata-content`, laid
out like a content heading, with the same negative margin, padding and arrow
position, and folding hides the whole box. Obsidian's own rules do the rest: the
arrow is hidden until the pointer is over the row, and a click on the row folds
it.

**Why:** down the note, the headings form one column, and their arrows form
another next to it. Obsidian's positions assume the margin its editor pane keeps
empty, and its own icon size. With them kept, the panel was a step in from the
note, and its arrow slightly away from the word.

**Rejected:** setting Obsidian's sizes again (`font-size`, row padding, key
width, icon size) — the panel ended up with 13px text in rows made for a 28px
field.

**Rejected:** a margin of its own (`margin-left: var(--size-4-6)`) — it puts
Obsidian's layout inside the note, indented further than every heading around
it.

**Rejected:** the heading inside the box — it looks like one more property row,
and Obsidian puts it above.

**Rejected:** only the arrow folds, as for headings and list items — it needs
the arrow forced visible, which Obsidian hides on purpose.

**Rejected:** `tabindex="0"` on the heading, so the keyboard can reach it —
Obsidian renders a ring around it on `:focus`, so a click left that ring around
the row. The arrow takes the focus instead, and shows itself on
`:focus-visible`.

## D-008 — The development loop reloads the plugin through the debugging port (2026-09-21)

**Decision:** `pnpm run dev:vault` links the build into the test vault, watches
those files, and reloads the plugin by turning it off and on through the
`--remote-debugging-port` that `pnpm run open` already opens.

**Why:** `seed` installs copies, so a new build never reached the vault, and
Obsidian only reads a plugin's files once, when it loads. Linking the files
fixes the first problem, and reloading the plugin fixes the second.

**Rejected:** the Hot Reload community plugin — the same thing from inside, at
the cost of a second plugin in the vault.

**Rejected:** Cmd+R — a window emulating a phone has no such hotkey, and
reloading the window loses the scroll position, which the change is usually
about.

## D-009 — Emulating a device waits for the new document after the reload (2026-09-21)

**Decision:** `emulateDevice` marks the window before calling `emulateMobile`,
and waits for a document that no longer has the mark.

**Why:** the reload is asynchronous, and the old document answers `layoutReady`
until the reload is done. So waiting for that alone returned while the window
was still switching, and it switched seconds after the script reported the
layout it was leaving.

**Rejected:** waiting for the reload as a navigation — the same result, but it
reads like page internals, not like the thing being waited for.

**Rejected:** a second command that switched the open window in place instead of
starting it again — 1.6s instead of 3s, for one more script to learn and
maintain.

## D-010 — The e2e window is hidden from inside Obsidian (2026-09-21)

**Decision:** the tests add `show` and `focus` listeners to the window through
Electron's remote bridge, so the app hides itself from its own page. The window
no longer stays hidden: D-124 shows it again, transparent.

**Why:** Obsidian brings itself to the front at first paint, when the vault
opens, and on the `emulateMobile` reload. A hidden app can still be in front, so
on a machine with one screen, a run took the keyboard for about a second at a
time.

**Rejected:** the AppleScript watcher this replaces — finding the process by its
Unix id blocked for 1.3s, long after the first time it took the focus. Watching
the process in front instead took 800ms to answer, against the guard's 100ms.

**Rejected:** changing a copy of the app bundle with `LSUIElement`, the only way
to catch the first time it comes to the front — Obsidian opens its debugging
port 30ms _after_ it comes to the front, so nothing outside the app can be ready
in time. Not worth copying and signing again 1GB to save one 150ms flash per
launch.

## D-011 — List properties are rendered as Obsidian's pills (2026-09-21)

**Decision:** `tags` and other list properties use the `multi-select-pill`
markup, with `data-property-type="tags"` on a tag value so its pills get the tag
colors. A tag pill whose text is not a valid tag name, including a single value
like `tags: a, b`, is `is-invalid`, crossed out, and searches nothing, as in
Obsidian's own panel. Only `tags` is treated as tags: Obsidian 1.9.10 stopped
treating the singular `tag` that way, and draws it as text.

**Why:** the panel sets no styles of its own
([ADR 0002](adr/0002-real-obsidian-e2e.md) compares it with Obsidian's), and
using the same markup was enough to get pills.

One rule is the stream's own: Obsidian pads one side of a pill's word and leaves
the other side to the remove button's margin, so without that button the last
letter touched the border.

**Rejected:** styling the rest of a pill in `styles.css` — every other rule is
already in Obsidian's stylesheet, and setting one again could end up different.
Splitting `tags: a, b` into two pills — Obsidian never splits a single value, so
the stream would show tags that the vault's own panel calls not valid.

## D-012 — More space around the line between notes (2026-09-21)

**Decision:** 4rem above and below the line between notes (`--size-4-16`), up
from 3rem.

**Why:** at 3rem the stream looked like a pile, not a series of days. 4rem is
the widest spacing that still fits two notes on a phone screen.

**Rejected:** space alone, with no line — the line is what marks where a note
ends when it ends in the middle of a thought.

**Rejected:** 4rem above and 6rem below, better on desktop — on a phone, the
6rem pushes the next note under the floating navigation bar.

**Rejected:** a date header that stays at the top — sticky positions are
measured from the padded scroll area, so it sticks too low on desktop and in
mid-air on mobile, and would need a position read from Obsidian's own interface.

## D-013 — A click on a tag opens the search pane (2026-09-21)

**Decision:** clicking a tag in the stream, in the note's text or as a pill in
the properties panel, opens Obsidian's search for `tag:#name`. It uses the core
global search plugin, found by its id in `src/obsidian-internals.ts`.

**Why:** a tag is a link everywhere else in Obsidian, but in the stream it did
nothing. No public API gives access to the search pane, so the core plugin is
found by its id, and a user who turned it off gets nothing instead of an error.

**Rejected:** opening the tag pane, or a filtered stream of our own — neither is
what a click on a tag does in the rest of the app.

A Ctrl/Cmd-click opens it in a pane of its own instead, through
`Keymap.isModEvent`: a tab, split or window, as everywhere else. The core plugin
only controls the sidebar pane, so a new leaf gets the `search` view, and its
query is set directly.

## D-014 — Properties are shown by default (2026-09-21)

**Decision:** `showProperties` is on by default, and the setting stays.

**Why:** the panel matches Obsidian's own reading view, and a stream of notes
whose frontmatter is hidden looks as if the notes have none.

**Rejected:** removing the setting — a vault whose daily notes have frontmatter
used only for bookkeeping wants it off.

## D-015 — A jump goes to the nearest older note (2026-09-22)

**Decision:** `jumpToDate` loads batches until the target is in the stream, then
scrolls to it. If that day has no note, it goes to the newest note before it. If
no note is that old, it shows a notice and doesn't move.

**Why:** a continuous stream has to leave the reader at a real note, and the
usual case is a date the reader half remembers. Batches cost little under
[ADR 0006](adr/0006-unload-off-screen-notes.md): what is passed over stays as
empty blocks. The jump list shows the fallback before it happens; this is still
what happens behind it.

**Rejected:** an error instead of the older note.

**Rejected:** rendering only the target — it breaks the rule that `state.notes`
and `_sorted` load in the same order.

## D-016 — The jump sets its scroll again until the stream stops rendering (2026-09-22)

**Decision:** up to eight tries. It ends when the target is at the top of the
pane _and_ `NoteWindowManager.layoutChanges` did not change during the try, or
when a scroll moves nothing and nothing changed since the last try. Search
centers a match the same way (`scrollIntoPlace`).

**Why:** a note above the target grows taller than its estimated height and
pushes it down. One `scrollIntoView` left the target 1600–1850px too low in e2e,
on desktop and mobile. This settles the item about correcting `scrollTop` in
[`TODO.md`](TODO.md) for jumps; the item stays open for scrolling in general.

**Rejected:** stopping once the target stops moving — it is at the top the
moment it is scrolled to, and the renders that move it finish later. Waiting a
frame when the scroll is stuck — the hidden e2e phone window draws no frame when
nothing changed, and the search waited forever for one.

## D-017 — Property icons come from Obsidian's type manager (2026-09-22)

**Decision:** `getPropertyIcon` takes the icon from the widget that
`metadataTypeManager.getTypeInfo(key, value)` finds. The map from property names
to icons is only used if Obsidian removes this internal.

**Why:** Obsidian draws the icon for the property's _type_, whether set or
guessed from the value, so guessing from the name disagreed with the note's own
panel everywhere except tags: `aliases` is an arrow, and text is `lucide-text`,
not `file-text`.

**Rejected:** our own table from types to icons — Obsidian's registry adds new
types.

## D-018 — The obsidian mock gives tests the real moment (2026-09-22)

**Decision:** `tests/mocks/obsidian.ts` exports moment, a development
dependency, instead of a fake written by hand. `depend/ban-dependencies` allows
it in `package.json` only.

**Why:** the fake ignored the format argument and only understood ISO, so every
test of a vault dated `DD-MM-YYYY` passed while the plugin failed. The bundle is
not affected: `obsidian` is not bundled, and the app provides moment.

**Rejected:** teaching the fake each format — writing moment again to test code
that calls moment.

## D-019 — The jump prompt lists the dates the vault has (2026-09-22)

**Decision:** a `SuggestModal` over every note's date, written and matched in
the vault's own daily note format, with `YYYY-MM-DD` as a second text to match
in. A query that reads as a date no note has is offered as one entry, which says
it will go to the nearest older note. A calendar icon opens the device's date
picker. The date input itself is invisible over the icon, because iOS only opens
its picker from a tap on the input, and does nothing on `showPicker()`. A click
also calls `showPicker()`, which desktop needs.

**Why:** a date field accepts days the vault has nothing for, so the fallback to
the nearest older note happened without any sign, and the reader could not tell
a jump from a miss. Listing the real dates makes the usual case a choice from
the list, and makes the fallback a visible choice. The format is read for each
vault, because file names differ: a reader using `DD-MM-YYYY` should not be
offered ISO dates.

**Rejected:** a date field with the fallback left hidden — what this replaces.

**Rejected:** `prepareFuzzySearch` — fuzzy matching on digits matches far too
loosely.

## D-020 — The stream does not create notes (2026-09-22)

**Decision:** the view has no "create today's note" action.

**Why:** the core Daily notes plugin already creates it from its ribbon icon and
command. If today's note is missing, a read-only stream is simply showing the
vault as it is.

**Rejected:** a create button above the stream when today's note is missing — it
would repeat what the core plugin does, and add state to keep correct through
creating, deleting and midnight.

## D-021 — e2e tests run fully in parallel on four workers (2026-09-22)

**Decision:** `fullyParallel` with `workers: 4`. A setup that runs before every
test resets the plugin settings, the fold state and the pointer.

**Why:** the run went from 3.7 min to 1.2 min. Each worker already has its own
copy of Obsidian and its own vault. The only things that broke when tests ran in
a different order were left over by earlier tests in the same copy.

**Rejected:** running whole files in parallel — `stream.spec.ts` holds most
tests, so it only got down to 2.3 min. More workers — the copies do not get
enough CPU, and timing tests become unreliable.

## D-022 — Search the stream, counted by note (2026-09-23)

**Decision:** the vault's "Search current file" hotkey opens Obsidian's own
search bar above the pane. The hotkey is read from `hotkeyManager` when the view
opens and whenever the settings are saved (a changed hotkey is saved in
`hotkeys.json`). A button in the header also opens it, for phones. Search
matches each note's title and text, including frontmatter, counts notes ("3 /
12"), and moves through the visible highlights (CSS highlight API) from note to
note. Typing marks the highest match on screen and never scrolls.

**Why:** notes off screen have no DOM (ADR 0006), so the browser's find in page
only sees a few days. A note's text and what is rendered from it differ, so only
a count of notes stays correct. Obsidian searches hidden frontmatter too
(checked 2026-09-23).

**Rejected:**

- A count of matches — it stops matching what is highlighted.
- `<mark>` wrapper elements — they change the DOM that folding walks through.
- A fixed Mod+F, or a command of our own — the first ignores a changed hotkey,
  and the second adds another hotkey.
- Jumping to the first match while typing — a half-typed word goes years away.
- A longer typing pause — 1095 notes are searched in 1–3 ms.
- Skipping frontmatter when properties are hidden — it would disagree with
  Obsidian.
- A tag or heading filter — core search does it.
- Matching the "Properties" label, as reading view does — it is in no note's
  text, and "prop" would match every note with frontmatter.
- Highlighting what a Base, an embed or linked mentions show — that text belongs
  to another file or to Obsidian, so no note counts it, and the bar would say
  "No results" over a highlight.

## D-023 — Kebab-case files, grouped into folders (2026-09-23)

**Decision:** every `.ts` file in `src/`, `tests/` and `e2e-tests/` is named in
kebab-case. `src/` groups them into `ui/`, `stream/`, `render/` and `notes/`.
Class names did not change. `tests/repo/compliance.test.ts` checks the case.

**Why:** Obsidian's plugin guidelines ask for folders once there is more than
one `.ts` file, and the official sample plugin and Minimal Settings name files
in kebab-case. One case for everything needs no judgment, so a test can check
it.

**Rejected:** PascalCase for files that export a class — nothing can check it,
and it was already used inconsistently. A lint plugin for the rule — the
compliance test already reads every file.

## D-024 — Search unfolds sections without saving, and labels what it cannot show (2026-09-23)

**Decision:** moving to a match inside a folded heading, list item or properties
panel unfolds it without saving that. Re-rendering the note folds it again.
Typing never unfolds anything. A note that matches but has nothing drawn to mark
(hidden frontmatter, Markdown syntax) is counted as `3 / 12 · hidden`.

**Why:** Obsidian's reading view does the same, and going to a note and marking
nothing looks like a bug.

**Rejected:**

- Skipping folded matches — the note is counted but shows nothing.
- Saving the unfolding — a search would change the reader's layout.

## D-025 — Tests are type-checked against the mocks, which use the real API's types (2026-09-23)

**Decision:** `tests/tsconfig.json` maps `obsidian` to the mock, as vitest's
alias does. The mock takes its signatures from the real type declarations
(`obsidian/obsidian`), so the types in `src/` are checked against it too. Tests
reach private members with `view["stream"]`, and fakes go through `fake<T>` or
`asApp`, never `any`. ESLint checks `tests/` without the rules that protect the
shipped plugin.

**Why:** with types from the mock, a test that calls something the mock does not
have fails before it runs. The real types keep the mock from moving away from
the API.

**Rejected:**

- Tests against the real types — the API that only the mock has
  (`new TFile(path)`, `Setting.created`) would need a cast at every use.
- Turning off `no-explicit-any` for tests — it hid about 600 accesses that were
  not checked.

## D-026 — The note list is built from the vault, not from `getAllDailyNotes()` (2026-09-23)

**Decision:** the list keeps the vault's Markdown files whose path, read as a
date and written back, gives the same path, the same check as for a newly
created file.

**Why:** `getAllDailyNotes()` indexes by date whatever the file type, so
`2024-01-01.png` could replace that day's note, and it accepts subfolders that
the check for a new file refuses. It was also the only thing in `initialize()`
that could throw an error.

**Rejected:** filtering its result — a note that was replaced is already gone.

## D-027 — Old fold state is removed a day after the note was last written (2026-09-23)

**Decision:** when a note is rendered without errors, saved sections the note no
longer has are forgotten, once its change time is 24 hours old. The properties
key is kept.

**Why:** daily notes are rarely renamed or deleted, so that cleanup never ran. A
day is long enough to cover typing a heading again, and checking the change time
needs no timer.

**Rejected:**

- On every render — `## Mee`, typed on the way to `## Meeting`, would lose its
  state.
- Expiring by when it was last viewed — old notes keep valid state for years.
- A size limit — limits size, not how old the state is.
- Frontmatter — every fold would change the file.

## D-028 — Titles and links react like Obsidian's links (2026-09-23)

**Decision:** changes D-001. Titles and links open the way Obsidian's links do:
clicks with modifier keys, the file menu, and Page preview when the pointer is
over them. One difference: a plain click focuses a tab that already shows the
note.

**Why:** Obsidian's reading view replaces its own tab. The stream can't, so with
the API alone, every click opens a new tab.

**Rejected:**

- A new tab for every click — tabs of the same note pile up.
- A pencil button for each note — the title does it.
- Adding to today's note — needs the editor inside the stream that D-001
  rejects.
- Rename and delete in the menu — not in the public API.

## D-029 — The stream is a navigable view (2026-09-23)

**Decision:** `navigation = true`. The stream's own clicks still open next to
it. Obsidian's ways of opening notes (quick switcher, file explorer, the daily
note command), used from the stream, replace it in its tab, as they replace the
graph.

**Why:** Obsidian treats a view that is not navigable as a sidebar, and keeps
the last note active behind it, so the status bar showed that note's word count
and backlinks. As a navigable view, the stream has no active file, so every
status bar item about a note is cleared, including other plugins' items.

**Rejected:**

- Overriding the leaf's `canNavigate` so the stream cannot be replaced — it
  changes a method that is not supported.
- Hiding the core items with CSS while the stream has focus — it relies on core
  class names, and other plugins' items would stay out of date.

## D-030 — A plain click opens in the stream's tab (2026-09-23)

**Decision:** changes the two entries above. A plain click on a title or link
replaces the stream in its tab, as a link in reading view or the graph does.
Back returns to the note the stream was scrolled to. A Ctrl/Cmd-click keeps the
stream and opens a new tab.

**Why:** the stream is a navigable view, and Obsidian's other navigable views
navigate on a click. Keeping the stream open had needed a flag set around an
Obsidian call that happened to choose its tab immediately, and a rule for
reusing tabs that the rest of the app does not have.

**Rejected:**

- Opening next to the stream — the difference described above, and its reliance
  on Obsidian's internals.
- Reusing a tab that already shows the note — not what Obsidian's links do.

## D-031 — Views share the dates read from file names, not the note list (2026-09-23)

**Decision:** the plugin keeps one `ParsedDates`, which maps each path to its
date, and is marked with the daily notes format. Each view's service builds its
own list from it, and only reads the dates of paths it has not seen.

**Why:** a date only depends on the path and the format, so an entry cannot go
out of date, and nothing needs to watch the vault. Opening a view again at 6×
slower CPU builds the list in 4 ms instead of 52 (a 10-year vault with 5,000
other notes).

**Rejected:**

- One list for the whole plugin — each view's queue must control the changes to
  its list, or loading in batches breaks (.claude/rules/invariants.md).
- One list for the plugin, kept up to date by vault listeners and copied for
  each view — it does work while no stream is open, and keeps state that nothing
  shows.

## D-032 — Unloading notes waits for scrolling to stop (2026-09-23)

Superseded in part by [ADR 0023](adr/0023-hide-far-content-as-it-leaves.md):
hiding no longer waits, but unloading still does.

**Decision:** a rendered block that goes past the unloading distance waits until
scrolling has stopped for `SCROLL_IDLE_MS` (300 ms). If it comes back before
then, it stays rendered.

**Why:** on an iPhone, a third of the recorded flicks stalled mid-glide when
notes were unloaded, and none did with unloading turned off. A scroll moves on
every frame, so a pause means it ended.

**Rejected:**

- A larger unloading distance — a long scroll goes past any distance, so it only
  delays the stall.
- Empty blocks with exact heights — not proven to be the cause.
- Scrolling an element inside `.view-content` — not needed once unloading waits
  (tested on a phone).

## D-033 — A Base too wide for its note is drawn as cards, on mobile (2026-09-24)

**Decision:** on mobile, a Base follows the rule for Markdown tables: cards when
its table is wider than the note, checked again when the width changes. Desktop
draws Bases as Obsidian does (ADR 0008). Each `base` code block, and each
`![[X.base]]` on a line of its own, is rendered into its own placeholder, so one
Base can be re-rendered on its own. If the headers alone are wider than the
note, cards are drawn straight away (measured once, from Bases' header font and
padding). Otherwise the table is drawn and measured when it is first laid out.
The result is kept for each note and layout.

The cards are a copy only for display: Bases only saves a code block through an
editor, and a save would write `type: cards` into the file. A copy of an
embedded Base is re-rendered when its file changes. An embed drawn as a table
stays the real embed, and changes made in its toolbar save to the `.base` file,
as in reading view.

**Why:** to be consistent with Markdown tables. The measured cost of
re-rendering, with 7 columns over a 3–10 year vault: table 100 ms (205–235 at 4×
slower CPU), cards 62–64 ms (84–104). The size of the vault adds less than 30
ms. The check on the headers skips drawing the table in the usual case: many
columns in a narrow note.

**Rejected:**

- Cards on every phone (`Platform.isPhone`) — cards even where the table fits.
- Cards on desktop too — desktop has no stalls, and a scroll bar keeps the
  table.
- Taller rows with `rowHeight` — the table is still cramped.
- Styling the table as cards with CSS — Bases positions its rows absolutely.
- Re-rendering the whole note when switching between table and cards — renders
  everything else in the note again too.
- Drawing every embed as a copy, so no change saves — inline embeds and Bases in
  callouts would still save, and every copy would need drawing again on every
  change.

## D-034 — The stream gets a note's margins from the theme (2026-09-24)

**Decision:** the pane is padded with `--file-margins`, and the stream is a
column inside it, no wider than the line width, as reading view lays out a note.

**Why:** the stream added 20px on each side of its own, on top of the theme's
width. So with Minimal (88% line width), a phone lost about 43pt on each side,
against about 24pt in reading view.

**Rejected:** full width on phones — wider than every other note.

## D-035 — A Base re-rendered keeps its last height until Bases fills it in (2026-09-24)

Superseded in part by D-054: heights are no longer saved.

**Decision:** `NoteBases` saves the height each Base last had, for each note,
layout and digest of its source. When the Base is drawn again, it is held at
that height as `min-height` until the drawn view reaches it, or for 2s. A height
is saved once nothing in its note has changed size for 300ms without a held
height, and never when the note is unloaded or before it is re-rendered: a
closing view is not laid out, and a Base left half filled keeps the height it
had. The heights, and which Bases were too wide, are kept between sessions in
`LayoutMemory` ([ADR 0010](adr/0010-layout-memory.md)), because Back builds the
view again, which forgot them. They follow the same rules as notes: the 4 most
recently used layouts, moved with a note when it is renamed, and removed when it
is deleted. An earlier limit of 500 Bases only kept an eighth of a vault whose
template embeds a Base in every note, and keys that held whole `.base` files
were kilobytes long each.

**Why:** Bases fills a view after it is drawn. A note coming back into view, or
a table drawn again as cards, got shorter by the Base's height for a few frames
and then grew back. iOS does not keep the scroll position, so the text jumped
away and back.

**Rejected:**

- Holding the whole block until it settles — nothing says when a note is done,
  and only Bases were measured causing a dip.
- Each Base waiting only for its own size changes — tried: on a phone, notes
  flickered as they scrolled back into view.

## D-036 — The stream keeps its own scroll position where the platform does not (2026-09-24)

Superseded in part by D-053, which changes what is moved, and by D-090, which
moves the shift into the scroll when a bounce at the top ends.

**Decision:** in the iOS app, and wherever
`CSS.supports("overflow-anchor", "auto")` is false, `ScrollAnchor` turns the
browser's own anchoring off. It watches the height of every block, and makes up
for the change of any block entirely above the pane: first as a `transform` on
the stream, and then, once scrolling stops, as `scrollTop` in the same frame.

**Why:** a note above the reader that was rendered taller than its estimated
height pushed the text down: e2e mobile, with anchoring off, measured 2673px.
Chromium's own anchoring absorbs this. iOS's WebKit says yes to `CSS.supports`
but keeps no place: a trace from a phone's Web Inspector showed the anchor never
turned on. Tested on a phone, the shift kept the place, while setting
`scrollTop` during scrolling still jumped.

**Rejected:** setting `scrollTop` during scrolling — it jumped on a phone. Only
correcting once scrolling stops — the jump shows first. Also making up for
blocks that reach into the pane — a fold arrow tapped there makes the note grow
below the reader's place, and moving the scroll would take that place away.
Keeping the place on every platform — it doubles Chromium's own correction.

## D-037 — A tap on the header title scrolls smoothly to the top, on mobile (2026-09-24)

**Decision:** on mobile, a tap on the view header's title scrolls the stream
smoothly to its top. `ScrollAnchor` is told first, and a scroll that reaches the
top drops what it owes instead of moving it into the scroll position.

**Why:** in iOS apps, a tap on the title bar scrolls to the top. Notes above the
reader are rendered on the way up, and moving their growth into the scroll
stopped the scroll 23,386px before the top in e2e.

**Rejected:**

- Jumping to the top at once — iOS animates it.
- Desktop too — there the title is a label, and nothing suggests it can be
  tapped.

## D-038 — Text next to a block element is wrapped in a span (2026-09-25)

**Decision:** after a note is rendered, each piece of loose text that shares its
parent with a block element, such as a list item's words above its nested list,
is wrapped in `span.daily-note-text-run`, before sections are made foldable.

**Why:** WebKit paints no CSS highlight on such text, and no layout of the
parent changes that, so search on iOS marked nothing in list items with
children. The wrapping happens once each time a note is rendered, so folding,
keys (`textContent`) and search see the same DOM from the start, unlike the
`<mark>` wrappers for each search that D-022 rejects.

**Rejected:**

- A CSS layout for the item — with flow-root, flex, grid or block, WebKit paints
  no highlight.
- Wrapping only on WebKit — two different DOM structures, and desktop e2e would
  test the other one.
- Wrapping inline elements too — WebKit already paints highlights inside them.

## D-039 — Release tags are annotated from 1.0.0 (2026-09-25)

**Decision:** from `1.0.0` on, each release is tagged with
`git tag -a <version> -m "<version>"`.

**Why:** annotated tags are the usual choice for releases: they record who made
the tag and when, and `git describe` and `git push --follow-tags` only use
annotated tags.

**Rejected:**

- Signed tags (`-s`) — no signing key is set up.

## D-040 — The stream opens in the current tab (2026-09-25)

**Decision:** the ribbon icon and `Open stream` open the stream in the current
tab, even when another tab has one. A Ctrl/Cmd-click on the icon opens it in the
kind of pane the modifier key asks for. Run from a stream, the command leaves
that stream as it was.

**Why:** the graph and canvas do exactly this, as checked in the app, so the
stream opens like Obsidian's other views.

**Rejected:**

- Showing an open stream instead — the graph opens a second one, and each view
  has its own service (.claude/rules/invariants.md), so a second one is safe.
- A new tab every time — tabs pile up. This was the earlier behavior.

## D-041 — The stream's icon is a stack of cards (2026-09-25)

**Decision:** the ribbon icon and the view's tab use `gallery-vertical-end`.

**Why:** `calendar-days` was in the ribbon next to the core Daily notes plugin's
`calendar`, and looked like the same action. A stack of cards looks like a feed,
and nothing in the core ribbon looks like it.

**Rejected:**

- `rows-3` — too close to Bases' `layout-list`.
- `scroll-text`, `notebook-text`, `book-open-text` — look like one document.

## D-042 — Tests use the same folders as the code they test (2026-09-25)

**Decision:** `tests/` has the same folders as `src/`. Tests of `scripts/` are
in `tests/scripts/`, and checks on files at the root (README, manifest, styles,
release workflow) are in `tests/repo/`. Mocks, setup and the shared test setup
stay at the top.

**Why:** there were 41 files in one folder, next to a `src/` grouped by what the
files do.

**Rejected:** tests next to their source — the types in `src/` are checked
against the real API, and those in `tests/` against the mocks, through separate
tsconfigs.

## D-043 — Scroll to top is only offered in the stream (2026-09-25)

**Decision:** the command is only in the command palette while the most recent
leaf holds a stream, and it scrolls that stream.

**Why:** a stream that was just opened is already at its top, so opening one
first, as Jump to date does, would do nothing useful.

**Rejected:**

- `getActiveViewOfType` — the tests' mock `ItemView` cannot pass as a `View`,
  whose protected `onOpen` makes the type check by name.

## D-044 — A separate demo vault for screenshots (2026-09-25)

**Decision:** `seed:demo` writes `.dev/demo-vault/`, a realistic journal whose
notes are made from their date. `seed` stays the test vault.

**Why:** `seed`'s notes are made around edge cases the checklist names, and look
artificial in screenshots. Making each note from its date means a recording can
be made again.

**Rejected:**

- Realistic content in `seed` — docs/TESTING.md depends on its notes.
- Random content on each run — every new recording would be different.

## D-045 — The README recording is an animated PNG, made with ImageIO (2026-09-25)

Superseded by D-116: the recordings are animated WebPs.

**Decision:** the e2e tests record the scene, and `scripts/frames-to-apng.swift`
encodes the frames with macOS's ImageIO. It writes the APNG chunks itself, each
frame only being the rectangle that changed.

**Why:** an animated PNG keeps every color, so text stays sharp, and it plays in
GitHub's image tags. ImageIO comes with macOS, so there is nothing to install.
Its own APNG writer saves whole frames: a recording of typing a sentence took 8
MB that way, and 2.5 MB as changed rectangles.

**Rejected:**

- GIF — 256 colors make smoothed text look rough.
- MP4 — GitHub only plays videos uploaded by hand, not ones in the repo.
- ffmpeg or gifski — something to install for what the system already does.

## D-046 — A note is re-rendered on every save, even while typing (2026-09-25)

**Decision:** the stream re-renders a note on each metadataCache `changed`
event, even while someone is typing in it. It catches up save by save, about two
seconds behind the editor.

**Why:** the README promises live updates, and Obsidian's own panes update as
you type. The cost of the extra rendering has not been measured.

**Rejected:**

- Waiting to re-render until typing stops (`editor-change` plus a 2.5 s timer) —
  a minute of steady typing would leave the stream out of date for that minute.
  Think again if re-rendering is seen to shake the stream next to an editor.

## D-047 — A build for a phone shows its name when it loads (2026-09-25)

**Decision:** `pnpm run build:device` puts a two-word name into the bundle as
`BUILD_LABEL`, made from a hash of the commit and any changes not committed
(`scripts/build-name.mjs`). The plugin shows it in a notice when it loads. The
plain `build`, which releases use, puts in an empty name and shows nothing.

**Why:** iCloud syncs the plugin to the phone late and without any sign, so a
test could run on the previous build.

**Rejected:**

- A setting or command that shows the version — the manifest version is the same
  for every test build.
- The branch, commit and time — on a phone, they would have to be compared
  character by character.

## D-048 — Back returns to its place in one scroll (2026-09-25)

**Decision:** the place saved in Obsidian's history is the note that is at least
partly in the pane, and how far it is from the pane's top. The empty blocks in
the rebuilt view get the heights that `LayoutMemory` remembers
([ADR 0010](adr/0010-layout-memory.md)). Back scrolls once, before the first
frame. The iOS scroll anchor is then told the place is set, so growth that the
scroll already includes, reported one frame late, is not added again. Back loads
notes past the place until the pane can scroll to it; otherwise a place near the
end of what was loaded stops too early.

**Why:** Back builds the view again from nothing. With estimated heights, each
note drawn moved the place, and each correction showed on screen: the newest
note flashed on desktop, and older ones on a phone.

**Rejected:**

- Hiding the stream until it settles — up to a second of blank screen on a
  phone.
- Opening titles in a new tab so the stream stays open — then Back no longer
  returns to it.
- Saving the heights in the place — superseded by ADR 0010, which keeps them for
  every view and session.
- Only note heights, without what Bases measured — a Base inside a note is still
  drawn empty and fills in again, whatever height its note has. (Superseded by
  D-054.)

## D-049 — A note's height is remembered once it settles (2026-09-25)

**Decision:** a rendered note's height is saved in `LayoutMemory` once nothing
in it has changed size for 300ms, as a Base's is. When a note is unloaded, it
keeps the height it measures then, and that height is only remembered if the
note had stopped changing.

**Why:** a Base that is filling in, or an image that is loading, is too short
until it is done. If that short height were saved, it would be the next
session's empty block height, and the growth would become a scroll that the
anchor owes.

**Rejected:** saving when scrolling stops, on Back and on refresh — each
measured whatever was on screen, including notes that were still filling in.

## D-050 — The pane keeps space for a scroll bar even while it cannot scroll (2026-09-25)

**Decision:** the stream's pane sets `scrollbar-gutter: stable`.

**Why:** heights are remembered by the column's width
([ADR 0010](adr/0010-layout-memory.md)). With classic scroll bars (macOS with a
mouse, and Windows), a stream that opened empty read a width 15px wider than the
width its notes were measured at, and so found no remembered height.

**Rejected:** leaving the scroll bar out of the layout key — it makes the text
narrower, so heights measured with and without it differ.

## D-051 — The mobile e2e tests use an iPhone Pro's screen (2026-09-26)

**Decision:** the phone viewport is 402 × 874, an iPhone Pro's screen in points.

**Why:** the README's phone screenshots should show a phone's layout. At 402 px,
Bases measures as it does on an iPhone 16 Pro: two cards per row, 187 px wide,
in Obsidian's reading view (2026-10-05).

**Rejected:**

- The old 420 × 800 — no phone has that screen.
- A Pro Max's 440 — rejected at the time because it fit two cards, based on the
  reading corrected below.

Corrected 2026-10-05: this said a phone shows one card per row. It shows two, in
Obsidian's reading view and in the stream.

## D-052 — A wide equation shrinks to fit on mobile (2026-09-26)

**Decision:** on mobile, a display equation wider than its note is zoomed down
to the note's width (`src/render/wide-equations.ts`).

**Why:** the page may not scroll sideways, and nothing in a note may scroll (ADR
0008). MathJax draws HTML, which CSS cannot scale to fit, so it is measured.

**Rejected:**

- `overflow: clip`, as for code blocks — it clips the end of the equation.
- Inline math — it is part of a line of text, and shrinking it there would
  change the line's text size in the middle of a sentence.

Updated 2026-10-07: MathJax 4 (Obsidian 1.14) adds 2px of padding on each side
of the container, so the equation fits inside the padding.

## D-053 — The scroll anchor is the element at the pane's top (2026-09-26)

**Decision:** where `ScrollAnchor` runs, it shifts the stream by however far the
element at the pane's top moved. It chooses that element again on each scroll,
and each time the shift is moved into the scroll, with `elementsFromPoint`,
going up to the element's block. When no part of the stream is at that point, it
finds the block by binary search on the list of blocks.

- It stops at anything with a held height, because a held note's text is not yet
  where Back measured the place.
- Before each new choice, it records what moved as owed, because a note rendered
  between frames reaches the scroll event before its resize report.
- If the element is replaced, the anchor uses its block instead.

**Why:** a Base filling in above the pane, in a note that reaches into the pane,
pushed the text down, because only notes entirely above the pane were corrected.
Nothing above the pane's top was done by the reader. A fold arrow tapped on
screen only changes what is below it.

**Rejected:**

- Holding a Base's growth — the same move happens later, with rows clipped in
  the meantime.
- Going down through the note — reads every paragraph on each scroll frame.
- `IntersectionObserver` — reports one frame late.

## D-054 — Notes and Bases are held until they settle (2026-09-26)

**Decision:** each is held at `min-height` until nothing in it changes size for
300ms, and for 2s at most:

- a rendered note, at a height it measured before (remembered, or shown before
  it was re-rendered), never at a guess. A touch releases it, so a fold shows at
  once.
- a Base, at the height it showed, when it is re-rendered, or when it shrinks by
  itself (a live Bases refresh). It grows without a hold.

Base heights are no longer saved: a Base that comes back is held by its note.

**Why:** waiting until nothing changes is the signal that holding whole notes
was missing (D-035), and it covers everything that fills in late, so heights for
each Base were a second cache.

**Rejected:**

- Holding at a guessed height — a short note shows a gap.
- Only holding notes — a live Bases refresh makes a dip inside a note on screen.

## D-055 — A new width does not change an empty block's height (2026-09-26)

Superseded in part by ADR 0014: empty blocks get new heights once scrolling
stops. The anchor is still kept when the distances are computed again.

**Decision:** when the width changes, an empty note keeps its height until it is
rendered. Only the height it is held at when it is rendered comes from the new
width. The scroll anchor is kept when the distances are computed again.

**Why:** shrinking empty blocks makes the stream shorter under the scroll. The
browser pulls the scroll back at once, `ScrollAnchor` counted that as the
reader's own scroll, and a phone turned in the middle of the stream ended up
several notes away. An anchor created again with the distances has no place to
keep while the notes on screen reflow, and the reader's place moved 120 px.

**Rejected:**

- New heights for every empty note — the pull-back described above.
- Only for those above the pane — the browser pulls the scroll back once they
  shrink by more than the content below the pane.

## D-056 — A Base re-rendered under the pane's top keeps the reader the same fraction of the way through (2026-09-27)

**Decision:** when the pane's top is inside a Base, `ScrollAnchor` keeps the
reader the same fraction of the way through the Base, not at the Base's top. The
fraction is of what the Base draws, not of the box held at a fixed height for
it. When the browser pulls the scroll back to the stream's end, that is not the
reader's own scroll.

**Why:** a turned phone re-renders cards as a table, so the entry being read is
gone, and kept at the Base's top, the reader ended up anywhere. Cards and rows
are in the same order, so the fraction still works. Below a note the reader had
jumped to, the stream shrank by more than the content below the pane, and the
anchor undid the pull-back as if the reader had scrolled.

**Rejected:**

- Keeping the same entry, from card to row — Bases fills the table after drawing
  it.
- Keeping the Base's top at the pane's top — the reader loses their place in the
  Base.
- A fraction of the held box — the table fills the top of the box, and the
  reader was in the blank space below until the hold was released.

## D-057 — During a reflow, the anchor keeps the block that starts in the pane (2026-09-27)

**Decision:** once the pane's width changes, `ScrollAnchor` keeps the first
block that starts inside the pane, below the text at the pane's top, until the
shift is moved into the scroll. It skips inline text, anything next to that
text, and anything that takes no space. Otherwise it keeps the text at the top,
as before. A Base at the top is kept by its fraction either way, never by what
it draws. The anchor keeps the place it read before the width changed: it
measures that place again on each frame, but chooses no new place until the
shift is moved into the scroll.

**Why:** a turned phone reflows the text at the top, and keeping its top moved a
title just below it out of view. The browser's own anchoring prefers what is
fully visible for the same reason.

**Rejected:**

- Always keeping the block that starts in the pane — a fold arrow tapped in the
  text above it would scroll away.
- The next element in the document — often a span in the reflowing text, and
  dozens of reads in a highlighted code block.
- Only the first report after the width changes — the text reflows over several
  frames.
- A card, or a heading below a Base — on a phone, the cards reflow before the
  Base is re-rendered, and a card's position says nothing about the reader's.
- Reading the place again on each frame — during a turn, the place read was a
  Base emptied to be drawn again, and then the Base's note, whose top never
  moved as the Base shrank.

## D-058 — A search keeps its match in place while the Bases around it fill in (2026-09-27)

**Decision:** once centered, a match is centered again whenever the stream, or
anything above the match in its note, changes size, until nothing changes for
`SETTLE_MS`, or the reader touches the pane or uses the mouse wheel on it
(`keepInPlace`, `src/stream/scroll-position.ts`). A note with a remembered
height is held at it, so a Base filling in inside it changes the size of nothing
outside it.

**Why:** Bases fill in after the note is rendered, which `scrollIntoPlace` does
not count, and a Base above the match pushed it off screen, leaving the reader
on the Base.

**Rejected:**

- Counting Bases filling in as layout changes — `scrollIntoPlace` would wait for
  them, and so would every step.
- Scroll anchoring — it keeps the note's top, not the match.
- Checking the match's position on each frame — a change made after that frame's
  `requestAnimationFrame` callback is painted with the match off screen for one
  frame, while a resize report comes before the frame is painted.

## D-059 — A Base's header and summaries scroll with it, on mobile (2026-09-27)

**Decision:** on mobile, a Base table's header is `position: static`, and its
summary row is `bottom: auto`, sticky with no inset (`styles.css`, D-153).

**Why:** Bases pins both to its own scroll container. ADR 0008 removes that box,
so they were pinned to the stream's instead, and floated over the notes.

**Rejected:**

- Leaving them pinned to the stream — they cover other notes' text.
- Giving the Base back its scrolling box — ADR 0008.

## D-060 — Submission rules are in ESLint where a lint rule can check them (2026-09-27)

**Decision:** `eslint.config.mts` checks the submission rules that a lint rule
can express, including for `manifest.json`. `tests/repo/compliance.test.ts` only
keeps the others (file names, the license, an error message's prefix, sentence
case).

**Why:** a lint rule reads the syntax, while a test's regular expression also
matched comments, and the editor shows a lint error while you type.

**Rejected:**

- Both — two places to update, and one fails after the other.
- Tests only — they search the text, and only fail when the tests run.

## D-061 — Linked mentions are the stream's own, using the public API (2026-09-28)

**Decision:** each note ends with a footer built from `resolvedLinks`, turned
around once on each `resolved` event by a `BacklinkIndex` shared by the whole
plugin (`src/render/linked-mentions.ts`). Unlinked mentions are left for later.

**Why:** our footer knows when it has finished drawing, so the note's height can
be held until then, and it needs no internals.

**Rejected:**

- Using Obsidian's internal backlinks component — it brings Better Search Views
  and unlinked mentions, but fills in on its own schedule, and can only be
  reached through internals.
- Going through every note's links for each rendered note — the index answers
  from one pass.

## D-062 — Rendering a note never waits for its footer; the held height does (2026-09-28)

**Decision:** `renderInto` returns while the footer is still reading the linking
notes. `NoteWindow` keeps the note's `HeightHold` until the footer finishes,
then waits for the note to settle as before. The footer renders itself again on
`resolved`, for each note, until the note is unloaded.

**Why:** the render queue also handles vault events, and a footer reads other
notes. Ending the hold before the footer draws let a returning note dip, which
jumps on iOS.

**Rejected:**

- Waiting for the footer in the queue — every render and vault event would wait
  while other notes are read.
- Queuing the footer's rendering through the view (ADR 0004) — a footer changes
  no stream state, and unloading its note already stops it.

## D-063 — The demo vault is the default; the test vault needs `--test` (2026-09-28)

**Decision:** `seed`, `open` and `demo` work on `.dev/demo-vault/`, and on
`.dev/vault/` with `--test` (`scripts/vaults.mjs`).

**Why:** the demo vault is the one used every day. The test vault is for the
checklist's edge cases.

**Rejected:**

- Separate `seed:demo` and `seed:test` scripts — `open` and `demo` would each
  need a pair, while one option works the same for all three.

## D-064 — One command opens a vault and keeps it up to date (2026-09-28)

**Decision:** `pnpm run demo` builds if there is no build, fills the vault
again, links the build in, opens the window, and reloads the plugin on every
save (`scripts/dev-vault.mjs`). It replaces `dev:vault`, `open` and `reload`,
which had to be run in the right order. The seed scripts still install a copy of
the build, because the phone's iCloud vault needs files, not links.

**Why:** the loop of editing and reloading took three commands in the right
order. The vaults are thrown away each time, so filling them again on each run
costs nothing, and keeps their notes up to date with the seed script and the
date.

**Rejected:**

- Only filling the vault when the seed script or the date changed — it would
  need a fingerprint, only to protect notes nobody keeps.
- Keeping `dev:vault`, `open` and `reload` as well — four commands for one loop.

## D-065 — The demo vault deals its lines from decks (2026-09-28)

**Decision:** each list of lines is a deck, shuffled each time through and dealt
by day or week, so no line comes back until its deck is used up, and not within
three days across a reshuffle. Each week has one piece of news, told once and
remembered on Sunday. The default run is 90 days.

**Why:** choosing each line independently put one line in 16 of 60 notes, some
on days in a row, and repeated events that should happen once.

**Rejected:**

- Only longer lists — random choices still bunch together.
- Tracking what earlier days used — a date's note would depend on the run.

## D-066 — The search button uses the `text-search` icon (2026-09-28)

**Decision:** the header's Search button shows lines of text with a magnifying
glass.

**Why:** on a phone, Obsidian's own search, a plain magnifying glass, is in the
navigation bar just under the header, and one icon for two different searches
looks like a duplicate.

**Rejected:**

- Search in the ⋯ menu, where Obsidian keeps Find — it takes a second tap on the
  phone.
- `text-search` only on mobile — a separate case for each platform, just for an
  icon.
- `scan-search`, a magnifying glass in a viewfinder — recognized as search
  faster, but says less about what it searches.

## D-067 — Search reads notes with `cachedRead`, and has no cache of its own (2026-09-28)

**Decision:** stream search still reads every note on each query and refresh.

**Why:** across 1,095 notes (`pnpm run test:memory`), with the CPU slowed 4x to
a phone's speed, the first query after opening reads every note in 585–707 ms.
Later queries, and a refresh after an edit, take 5 ms. So `cachedRead` answers
from memory once it has read the notes, and it sees the edit. A cache of our own
would be just as empty when the view opens. Its documentation only promises
"better performance", so the timing test is what protects this.

**Rejected:**

- A cache of each note's text, cleared on `modify` — repeats Obsidian's.
- Dropping a search once a newer one replaces it — at 5 ms there is nothing to
  save.

## D-068 — Bases and wide content stay part of rendering the note (2026-09-28)

**Decision:** on mobile, rendering a note still waits for each Base, then
measures its tables and equations in place.

**Why:** scrolling through 40 notes, each embedding a Base over 1,825 notes,
plus equations and a wide table (`e2e-tests/render-cost.spec.ts`, CPU slowed 4x
to a phone's speed, on an M5, in the on-screen window of D-124): a Base held up
the queue for 19 ms (median), and 29–74 ms at most. The plugin forced 797–857
layouts, 266–290 ms in total, about 7 ms per note. The test's limits are about
twice these.

**Rejected:**

- Bases outside the queue, held by a `HeightHold` — saves 16 ms per Base, at the
  cost of a hold for each Base.
- Reading widths together in one `requestAnimationFrame` — at most 1 ms of
  layout per note (2026-10). With width reads removed, the plugin forced 80 ms
  less over 40 notes, but total layout only fell by 40 ms, because the rest
  moved to the next frame.

## D-069 — The first open reads every date in one task (2026-09-28)

**Decision:** `buildSorted` still reads every Markdown file's name at once.

**Why:** over 4,096 files, 1,095 of them daily notes, with the CPU slowed 4x to
a phone's speed (`pnpm run test:memory`), reading the dates for the first time
takes 17–20 ms, or 30–36 ms with no daily notes folder set. From opening to the
first note, it takes 50–88 ms. Reading the dates takes less than the 50 ms that
makes a task long.

**Rejected:**

- Reading in parts, giving the thread back between them — it splits a task that
  is not long.

## D-070 — Prettier wraps Markdown at 80 (2026-09-29)

**Decision:** Prettier formats every `*.md` file with `proseWrap: "always"` at
80 columns, the width Prettier and markdownlint use by default. `AGENTS.md` is
still ignored, because it is the sample plugin's copy, word for word.

**Why:** docs wrapped by hand had ended up at two widths: about 80 in
`DECISIONS.md` and the ADRs, and about 120 elsewhere, and nothing checked
either.

**Rejected:**

- 120, the code's width — text wider than 80 is hard to read in a terminal or a
  side-by-side diff.
- Wrapping by hand at a written width — a rule that nothing checks drifts again.
- `proseWrap: "never"`, one line per paragraph — a diff then shows a whole
  paragraph for one changed word.

## D-071 — A failure only breaks one thing, and is logged (2026-09-28)

**Decision:** every asynchronous entry point and every localStorage save catches
errors, logs them to the console, and carries on. A note that cannot be rendered
says so, a read that fails shows its note, a refused save is logged once
(`saveLoggingOnce`), saved state that cannot be read counts as none, and a list
that fails to build lists nothing until the next refresh. Only a failed jump
shows a notice.

**Why:** a stream has many notes, and one bad note, or a full localStorage, must
not make the rest blank. When unsure, the stream shows too much, but it never
hides anything written.

**Rejected:**

- A notice for every failure — a full localStorage refuses every later save, so
  the notices would never stop.
- Hiding what could not be checked — writing would disappear without any sign.

## D-072 — Whether a note is empty is cached on each device, and trusted by its change time (2026-09-28)

**Decision:** `EmptyNotes`, of which the plugin has one, keeps each path's
result together with its change time. It is filled before the first batch and
updated on the `metadataCache` `changed` event. Only notes no bigger than the
template plus 1 KB are read. It saves, in the vault's localStorage on this
device, the template it checked against, when its last check of every note
started, and each empty note's change time. The next session trusts any note not
changed since that check: empty if it was saved with that change time, and
otherwise written. A note that cannot be read is shown, and read again in the
next check. A check that left any note unread saves nothing.

**Why:** the first open only reads the notes that could be empty, and a later
open only reads what changed. A written note costs nothing to save, and an empty
one about 40 bytes. A note unloaded on another device, and synced with a change
time older than the last check, is shown until it next changes.

**Rejected:**

- Reading every note — thousands of reads when the view opens, for a few hundred
  notes that could be empty.
- Saving every note's result — the check's start time already shows that the
  other notes have writing.
- Trusting a saved empty note by the check's start time — a synced edit can have
  an older change time, and a written note would stay hidden.
- Limiting how many reads run at once — on an iPhone 16 Pro, 1,095 first reads
  at once take 344–398 ms, with no frame over 15 ms. Reading 8 or 32 at a time
  is no faster.

## D-073 — Views only check again the notes whose incoming links changed (2026-09-28)

**Decision:** `LinkChanges`, of which the plugin has one, compares each note's
links into the daily notes folder on every `resolve`. Once `resolved` fires,
each view checks again the notes that gained or lost a link (ADR 0011: an empty
note with a link to it is shown).

**Why:** adding or removing a link shows or hides its target without opening the
stream again. A stream open at startup hides an empty note with links until the
links are resolved, then shows it.

**Rejected:**

- Checking every hidden note again on `resolved` — the service would have to
  keep track of what it hid, for the same result.
- Checking backlinks only when the view opens — a new link would wait for the
  next open.

## D-074 — A setting that changes what is listed keeps the reader's place (2026-09-29)

**Decision:** turning Hide empty notes or Show linked mentions on or off reloads
the stream, then returns to the note being read. If that note is now hidden, the
reader goes to the top of the next older note, or, if there is none, to the end
of the stream. Only a stream with no notes left starts at the top.

**Why:** the next older note is the one the reader was scrolling towards, and
the end is closest when nothing older is left.

**Rejected:**

- Back to the top — what a reload did, and it takes the reader years away.
- The next newer note — it is behind the reader, above where they were.

## D-078 — Settings are grouped under headings; a hidden section hides its fold switch (2026-09-30)

Superseded in part by D-114: groups instead of heading rows, and nothing is
re-rendered.

**Decision:** the settings tab puts Properties and Linked mentions under
`Setting.setHeading()` rows, with Hide empty notes above them. A section's
"Collapse by default" is only drawn while its "Show" switch is on, and that
switch draws the tab again.

**Why:** each fold switch means nothing without its show switch, and a flat list
did not make that clear.

**Rejected:**

- `SettingGroup` cards — they need `minAppVersion` 1.11.0, up from 1.8.7.
- Disabling the fold switch — a greyed-out row still looks like a choice.

## D-079 — An empty block never measured here gets a height estimated from its text (2026-09-30)

Superseded by D-092.

**Decision:** a note with no height saved for the layout gets the first of these
that applies:

- its height at the closest width with the same text size, plus the change in
  its number of wrapped lines × the line height;
- otherwise the template's measured height here, plus its lines beyond the
  template's × a height per line learned from notes with only text, plus its
  embeds × a height per embed learned in this layout (the pane's height until
  one is learned);
- otherwise the layout's median. The number of lines comes from the metadata
  cache, so adding a block stays synchronous. Benchmark:
  `e2e-tests/estimates.spec.ts`, scored by `scripts/score-estimates.mjs`.

**Why:** a turn only changes a text note by wrapping it again, and every note is
its template plus writing (ADR 0011). After a turn, the average error for text
notes falls from 85px (the height at the other width) to 18px, and for notes
never measured, from about 330px (a fixed 400px) to about 50px.

**Rejected:**

- The template's height alone — only a minimum, 443–624px too short on average.
- A fixed amount for each embed — no single value fits Bases drawn as cards in
  portrait and as tables in landscape.
- Saving a height for each Base — a vault's Bases differ, and one Base's height
  changes with what it draws.

## D-080 — After a turn, a note's Bases change by what the same Base changed in other notes (2026-10-01)

Superseded by D-092.

**Decision:** a note estimated from its height at another width (D-079) adds,
for each Base it embeds, the median change for that Base, apart from text
wrapped again, in other notes that embed the same Base and were measured at both
widths. If no such note was measured at both widths, it adds nothing.

**Why:** only a Base that switches between table and cards changes much on a
turn (up to about 1400px), and the same Base switches the same way in every
note. The error for embeds after a turn went from 378px to 35px.

**Rejected:**

- One change for each embed, or for each Base — images barely change, and Bases
  differ, so a single median comes out near zero, or half of what a switching
  Base changes.
- Only adjusting Bases marked too wide (`BaseMeasurements`) — that is only known
  for a note once it is drawn at the new width, and learning for each Base gets
  there without it.

## D-081 — After a turn to a wider screen, a note with an unknown Base is estimated from its template (2026-10-01)

Superseded by D-092.

**Decision:** a note measured only at a narrower width, embedding a Base whose
change D-080 has not learned yet, is estimated from the template and its lines
(D-079's last option) once the template has been measured in this layout. Until
then, it is estimated as D-080 says.

**Why:** cards at the narrower width may be a table here, up to about 1,400px
shorter, and until a note with that Base has settled at both widths, nothing
says so. In the demo journal, with notes containing Bases turned to landscape,
the average error went from 782px to 224px, and the worst overestimate from
1,408px to 353px.

**Rejected:**

- Also when turned to a narrower screen — a table there may become cards here,
  but the template's estimate is too tall for notes whose Base does not, by up
  to 1,131px.
- Only Bases marked too wide at the old width (`BaseMeasurements`) — a Base
  predicted to be too wide from its headers is drawn as cards without being
  marked.

## D-082 — A jump or search step draws its whole note before scrolling (2026-10-01)

**Decision:** the target note is rendered off screen, and the jump waits for its
Bases' queries (`is-loading` removed, one frame later, at most
`BASES_LOAD_LIMIT_MS`). Then it scrolls once: a jump to the note's top, and a
search step to the match (`basesLoaded`, `NoteStream.ready`).

**Why:** when it scrolled first, a Base showed "0 results" and then filled in,
on screen. A search step also showed the note's top for two frames before
centering.

**Rejected:**

- Hiding a Base until it fills in — blank space, then cards suddenly appearing.
- Remembering each Base's height — the space is right, but the "0 results" bar
  still shows.
- Also rendering the notes around it first — the Bases that matter are in the
  match's own note, and the notes around it are rendered as on any scroll.

## D-083 — On mobile, a PDF embed shows its first page, and a tap opens it (2026-10-01)

**Decision:** under `.is-mobile`, a PDF embed is clipped like a Base, with its
toolbar hidden, and a tap anywhere on it opens the PDF at the embed's page,
through the link handlers (`NoteRenderer.linkAt`). An `iframe` is limited to the
note's width everywhere.

**Why:** once clipped, Obsidian's viewer shows page 1, and its toolbar cannot
reach any other page. A pasted video embed's fixed width made the page scroll
sideways on a phone.

**Rejected:**

- Every page at full height — a long PDF would become the whole stream.
- Obsidian's file card (icon and name) — loses the page a reader recognizes.
- Leaving the viewer working — it is a scrolling box, which stops iOS's
  scrolling (ADR 0008).

## D-084 — Dataview's queries are clipped and stacked like the note's own content (2026-10-01)

**Decision:**

- On mobile, the stylesheet clips Dataview's blocks, which Dataview's own
  stylesheet makes scroll.
- `stackWideTables` stacks a table whenever one is added or filled in, not only
  when the note is rendered.
- e2e uses a pinned Dataview release, downloaded once into `.dev/`
  (`e2e-tests/dataview.ts`).

**Why:** Dataview draws after the note is drawn, in several passes. Its wide
tables were clipped instead of stacked, and each block was a scrolling box until
the guard caught it after scrolling stopped.

**Rejected:**

- Only the scroll box guard — it clips blocks once scrolling stops, so a block
  drawn while scrolling scrolls during that scroll.
- A fake plugin that draws tables late in e2e — proves nothing about Dataview's
  own stylesheet or render passes.
- Dataview saved in the repo — 2.3 MB of someone else's build.

## D-085 — No equation gets its own layer (2026-10-02)

**Decision:** the stylesheet sets `will-change: auto` on every `mjx-container`
in the stream, undoing MathJax 3's `will-change: opacity`, which only applies in
WebKit.

**Why:** with the layers, an iPhone stopped 34 of 58 flicks completely within
0.4 s, whether the math was in a table or in a line of text. Without them, 0 of
30, the same as with no math at all. MathJax added the rule for a pinch-zoom
flicker in 2020
([MathJax#2435](https://github.com/mathjax/MathJax/issues/2435)), and removed it
in v4 as not needed. Obsidian came with v3.

**Rejected:**

- Keeping MathJax's fonts in use — the fonts were never removed, and 28 of 54
  flicks still stopped.
- Overriding with the same specificity as MathJax — its stylesheet comes later
  and wins.

Superseded 2026-10-07: Obsidian 1.14 comes with MathJax 4, which sets no
`will-change`, and the plugin needs 1.14 (D-100). The rule is gone. The WebKit
check stays, in case MathJax brings the layers back.

## D-086 — The iPhone tests leave Auto-Lock to the tester (2026-10-02)

**Decision:** `test:ios` changes no setting on the phone. `docs/TESTING.md` says
when to set Auto-Lock to Never, and when to set it back.

**Why:** a run takes under a minute, and a locked phone fails setup at once.
Only many runs in a row need the phone kept awake, and setting that on someone's
phone for them left it never locking if they forgot `pnpm run ios:release`.

**Rejected:**

- Setting Never through the Settings app, kept until `pnpm run ios:release` — it
  went through Settings pages that have Delete buttons, failed in Low Power Mode
  and on an iPad, and took about 18 s each session.

## D-087 — On mobile, an `iframe` loads its page once scrolling stops (2026-10-03)

**Decision:** `FrameDeferral` removes the `src` from each `iframe` a note
renders, using a mutation observer, and puts it back once scrolling has stopped
for `SCROLL_IDLE_MS`. Meanwhile, the frame has a background color, as a
placeholder.

**Why:** a YouTube frame rendered mid-glide stopped 10–13 of 20 iPhone flicks
completely. With its `src` held back, 0 of 20. A page that is already loading
when a flick starts stops none. The same frame on `about:blank`, or a box of the
same size, stops none: starting to load the page is what stops the glide.

**Rejected:**

- `scrolling="no"` on the frame — 8 of 20 still stopped.
- A tap to load every frame, like the PDF (D-083) — hides a page that can work
  in place. YouTube's player does not work in the app, so it is a thumbnail
  (D-088).
- Changing `src` in the Markdown before rendering — a code block that shows a
  frame would show the change.

## D-088 — On mobile, a YouTube embed is its thumbnail, which links to the video (2026-10-03)

**Decision:** on mobile, `FrameDeferral` replaces a YouTube embed's `iframe`
with `youtubeThumbnail`: the video's thumbnail under the play button of
YouTube's player, at the player's size, linking to the video at the embed's
start time. The thumbnail is the 1,280 px one, or otherwise the 480 px one every
video has. Desktop keeps the player.

**Why:** in the iOS app, the player only shows "Error 153", and a frame held
back (D-087) is a grey box that names nothing. A tap opens YouTube, or its app.
The thumbnail is an image, and 0 of 20 flicks stopped over it.

**Rejected:**

- The grey placeholder, then the player once scrolling stops — the player does
  not work anyway.
- A wrapper with a label over the held frame — more DOM, and still a player that
  does not work.
- A still image with YouTube's button drawn in — YouTube provides none; its
  still images and oEmbed are plain.
- Only the 480 px thumbnail — stretched 2.2x across a phone's 3x screen, it
  looks blurred.

## D-089 — On mobile, a Base's cards and header line up with the note's text (2026-10-03)

**Decision:** under `.is-mobile`, a cards view keeps 1px of
`--bases-view-padding` on each side, for the cards' ring, and the header removes
its own padding and its first button's, so card borders and the first icon line
up with the edges of the text.

**Why:** Bases moves the cards in by 12px and the icon by 6px inside a note's
text column, which looks like an extra margin under a heading.

**Rejected:**

- From edge to edge, as Obsidian's reading view draws a Base — wider than the
  text column on both sides, unlike everything else in the stream's notes.

## D-090 — When a glide bounces at the top, the shift moves into the glide as the bounce ends (2026-10-03)

**Decision:** after the scroll goes past the top, `ScrollAnchor.onScroll` moves
what it owes into the scroll position at the first scroll event back at or below
the top, instead of waiting until scrolling has stopped for `SCROLL_IDLE_MS`.

**Why:** scrolling up past notes that are rendered taller than their estimated
height runs out of scroll first, and bounces at the top while still owing their
growth (ADR 0010). On a phone, moving the shift into the scroll came 328 ms
after the bounce, and a flick made in the meantime reached the same top and
delayed it again. A bounce ends the scroll anyway, so setting the scroll
position does not cut a scroll short.

**Rejected:**

- Moving the shift into the glide as the glide reaches the top — iOS undid it in
  the next frame, during the bounce, and the stream jumped 3,000 px.

## D-091 — A glide stops at the stream's top while the stream is shifted (2026-10-03)

**Decision:** while `ScrollAnchor` owes a shrink, a scroll that will bring the
stream's top into the pane within two more steps the size of its last step sets
the scroll to the top and removes the shift. It also freezes the pane for that
frame (`is-scroll-frozen`, `overflow: hidden`), so the scroll stops with the
newest note at the top. When the browser pulls the scroll back to the stream's
end, that does not count as a step.

**Why:** when notes above are rendered shorter than their estimated height, the
scroll has more room left than there is content above. The glide reached the
newest note with room left, and went on into empty space: 1.7–4.6k px in the
iPhone tests. iOS keeps scrolling after the scroll position is set, and undoes
it in the next frame, but with nothing left to scroll, the scroll ends. The
first version, merged without the freeze, let the newest note jump back 1.5–1.7k
px after setting the scroll, and its test only checked for blank space. Stopping
only on arrival, a recording showed the top drawn about 65 px too far for one
frame, then back, because iOS draws a frame before the page hears about the
scroll. Stopping one step early still went 43 px too far when a dropped frame
doubled the step.

**Rejected:**

- Only setting the scroll position — iOS undid it in the next frame, whatever
  value it set: 0, a value in the middle, or with the shift added or removed.
- Moving the shift into the scroll once scrolling stops — the empty space is on
  screen until then.

## D-092 — A note never measured gets the height that 90% of measured notes are below (2026-10-04)

**Decision:** a note with no height saved for the layout gets the height that
90% of the heights saved there are below. Where nothing is saved, it keeps the
height it has: after a turn, its height at the old width, and if it was never
measured, two pane heights. Saving a height schedules new heights for empty
blocks for the next time scrolling stops (ADR 0014), so after a turn or when the
view opens, the notes on screen give the heights within moments. It replaces
D-079–D-081's estimates from each note's text, template and Bases.

**Why:** an estimate only matters away from the usual path: after a jump,
search, Back or turn, when scrolling up through notes not drawn yet. Scrolling
down from the top measures every note before it is passed. There, too tall is
safe, because D-091 stops the glide on the newest note, while too short costs
one more flick (D-090). It only uses the vault's own notes, so nothing is tuned
to a journal we made up.

**Rejected:**

- D-079–D-081's estimates for each note, made to lean tall — each rule, for each
  Base and each kind of embed, only worked on our generated journals, and was
  never tested on anything else.
- The height that 75% are below — on those journals, a third to a half of a
  week's runs of notes came out too short in portrait.
- Extra space above the newest note — the space above can only change while
  scrolling is stopped, because setting the scroll while scrolling is undone or
  stops the scroll (D-090, D-091).
- The same value from the closest width, scaled by the widths — the notes on
  screen are measured at the new width within moments of a turn.
- A fixed 400px before anything is measured — the notes ADR 0006 measured were
  about 709px.

## D-093 — No file menu from a long-press on a note's title on iOS (2026-10-05)

**Decision:** the note menu only opens on a right-click. On iOS, a long-press on
a title selects its text, and a tap opens the note, whose own menu has the same
file actions.

**Why:** iOS fires no `contextmenu` on a long-press, and Obsidian only makes one
up for elements its drag manager handles. The menu adds a shortcut, not a new
action, and a touch listener on the stream would be in the path of scrolling,
which is what breaks most often on iOS.

**Rejected:**

- Our own long-press — a timer that must tell a press apart from the start of a
  flick, and the title's text selection would have to be blocked.
- Registering titles with Obsidian's drag manager — private API.

## D-094 — One width observer for each view; the anchor keeps its own (2026-10-05)

**Decision:** tables, equations and Bases hear about a note's width change
through one `ResizeObserver` for each view (`note-widths.ts`), not one each for
every rendered note. `NoteWindowManager` and `ScrollAnchor` keep one observer
each.

**Why:** the three width observers were the same code written three times,
waking up on every height change only to find the width the same. A screen of
notes on a phone ran about 24 observers, and now runs about 6. The pinned
heights and the anchor watch different sets: the anchor watches every block, and
the pinned heights only rendered ones. So one observer would need to count who
watches what.

**Rejected:**

- One observer for the pinned heights and the anchor — saves one observer per
  view, at the cost of rewriting the anchor's tests and sharing bookkeeping in
  ADR 0013's code.

## D-095 — ResizeObserver callbacks never change the size of what was observed (2026-10-05)

**Decision:**

- A pinned block is not observed: a rendered note held at a fixed height (ADR
  0013). Its height only changes in `repin`, which tells the scroll anchor
  directly. The anchor only observes a block while it is not pinned.
- A Base is held at the tallest height it has had since it was first laid out. A
  shrink is then already covered by the hold, so nothing has to change size in a
  callback. The Base's callback only raises the hold. A timer releases the hold
  once the Base stops changing, or after `HOLD_LIMIT_MS`.
- When a Base must be re-rendered because its width changed or Bases reported
  its layout, it is re-rendered in the next task, not in the callback.

Superseded in part by D-159: a Base's box now has a fixed height, and grows in
the next task instead of in its callback.

**Why:** WebKit logs "ResizeObserver loop completed with undelivered
notifications" as an error when a ResizeObserver callback changes the size of an
element that is no deeper in the page than the highest element already reported
in that round. Each of the cases above did that, on a flick or when the phone
turned. The late size report did no harm; the logged error was the only cost.

**Rejected:**

- Ignoring the error in the iPhone tests' console check — the error is the
  plugin's own, and it came on every scroll.
- Re-pinning one frame later — the block's height would change without the
  anchor being told in the same task, which breaks ADR 0013.
- `requestAnimationFrame` for drawing again — it never runs in the e2e tests'
  hidden window.

## D-096 — No Android check before a release (2026-10-05)

**Decision:** releases are only checked with the desktop e2e tests and a real
iPhone. Android stays supported, and follows the iOS rules (ADR 0008).

**Why:** Android's WebView is Chromium, the browser engine both e2e projects
run. What e2e cannot see are native controls, such as the date picker, and those
are Android's own.

**Rejected:**

- An emulator controlled by Appium — a second device test setup for an engine
  that e2e already runs.
- A check by hand — there is no device, and a check nobody runs is no check.

## D-097 — On mobile, a Base's toolbar has no New button (2026-10-05)

**Decision:** under `.is-mobile`, a Base's New button is hidden. The view name
and result count shrink and end in "…" as in Obsidian, which the stream's
`overflow: clip` had stopped (ADR 0008).

**Why:** a Base in the stream is as wide as the text, 354px on a phone, while
Obsidian's is 402px from edge to edge (D-089). So the toolbar was up to 41px too
wide: New was clipped, and shrinking alone left "Resized" as "R…". Without New,
it shows "Resiz…", and a short name, such as "Books", shows in full with its
count. New creates `Untitled.md` with one tap, without asking, which is easy to
hit while scrolling. Opening the note or the `.base` file still shows it.

**Rejected:**

- Keeping New, with shorter names — the view name is what tells views apart.
- Hiding it on desktop too — desktop has the room, and Sort, Filter and
  Properties change the `.base` file anyway.
- Wrapping the toolbar onto two lines — adds a row's height to every Base.

## D-098 — On mobile, a web page in an `iframe` is a preview that links to the page (2026-10-05)

**Decision:** on mobile, an `iframe` in the stream gets no touches
(`pointer-events: none`), and `FrameDeferral` wraps a frame showing an `http(s)`
page in a link to it (`webPageLink`). The page loads once scrolling stops, as
before (D-087). Desktop keeps frames working.

**Why:** on an iPhone, a flick over a page taller than its frame scrolled the
page inside it, about 5,400 px, and never the stream. Flicking back only worked
while the page was at its top. The scroll box guard cannot reach a frame's page
(ADR 0008). A PDF (D-083) and a video (D-088) are already previews that a tap
opens.

**Rejected:**

- A preview that does nothing when tapped — it looks like a link.
- A link instead of the frame — loses the preview, which is the point of a map
  or a calendar.
- Leaving the page working — any frame taller than the screen can catch a flick,
  which matters more than D-087's reason, "a page that can work in place".

## D-099 — An iOS problem that lasts one frame is only fixed once a recording shows it (2026-10-05)

**Decision:** three such problems, found by a probe or only predicted, are not
fixed:

- A Base's table draws rows blank for one frame when a note above it is drawn
  mid-glide, because Bases only chooses its visible rows again after the frame
  is drawn. Found by `src/probe.ts` in commit `d9cdb4f`.
- An image loading inside the note at the pane's top may jump for one frame (ADR
  0013's consequences). Never seen, because notes are rendered a screen ahead,
  so their images have usually loaded.
- D-091's stop may set the scroll while a finger is on the screen, during a slow
  drag past the newest note. The tests only use flicks.

**Why:** each lasts one frame, while things are moving. A fix depends on
undocumented Bases or iOS behavior, and only a phone recording can confirm it,
because the tests take their measurements before the re-pin.

**Rejected:**

- Sending `scroll` to each Base near the screen in `repin`'s task — depends on
  undocumented Bases behavior, and every other listener hears it too.
- Measuring notes never measured in a hidden copy while scrolling has stopped —
  about 16 ms per Base, across 1,095 notes in a three-year vault, with no
  `requestIdleCallback` on iOS. Bases and images also size themselves again
  where they are drawn (ADR 0010).

## D-100 — Before 1.0, the plugin needs the latest Obsidian (2026-10-07)

**Decision:** until 1.0, `minAppVersion` is the latest public Obsidian version,
raised at the next version change, and the stream removes what only older
versions need. `1.0.0` is the first public release, and `versions.json` keeps no
`0.x` entry after it (2026-10-09). The `0.x` drafts and tags are deleted
(D-125).

**Why:** nothing is released publicly before 1.0, so no reader runs an older
Obsidian, and a workaround for one is code that never runs. Obsidian offers an
app below `minAppVersion` an older version from `versions.json`, and a `0.x`
entry would point to a draft nobody can download.

**Rejected:**

- Keeping 1.8.7 — keeps rules like D-085's for readers who do not exist.
- Publishing the `0.x` drafts — releases that nobody outside the project ever
  ran.

## D-101 — A scroll change caused by turning the screen is never the reader's (2026-10-07)

**Decision:** once the pane's width changes, `ScrollAnchor` reads again the
scroll position at which the place was read, so whatever moved the place since
then is owed.

**Why:** turning a phone upright makes the pane taller, and near the stream's
end the browser pulls the scroll back. On a phone, the stream had grown 62px by
the time the pulled-back scroll was read, so `clamped()` returned false, and the
873px pull-back was taken for the reader's own scroll. About one turn in three
lost the place.

**Rejected:**

- Showing the shift first, as ADR 0015 does — the browser pulls the scroll back
  before any plugin code runs.
- A spacer at the stream's end — a second thing that must be removed at the
  right moment (ADR 0014).

## D-102 — A refresh reads the place after the anchor has moved its shift into the scroll (2026-10-07)

**Decision:** `NoteStream.refresh()` has `ScrollAnchor` move what it owes into
the scroll position before it reads the reader's place.

**Why:** while something is owed, the stream is shifted, not where the scroll
position says. At the stream's end, a pulled-back scroll kept as a shift
rendered every note above the pane, so `place()` found no note in the pane, and
hiding empty notes there reloaded at the top.

**Rejected:**

- Reading the place through the shift — at the end, the shift leaves nothing in
  the pane to read.

## D-103 — At the stream's end, the anchor only owes what the scroll can take (2026-10-07)

**Decision:** once every note is loaded, `ScrollAnchor` limits what it owes to
how far the scroll can still go down. When the browser pulls the scroll back at
the end, the place moves at once.

**Why:** a shift past the scroll's end shows empty space below the stream until
scrolling stops, and moving the shift into the scroll is pulled back anyway.
Before the end, the next batch fills the space, and the hold keeps the place
(ADR 0015).

**Rejected:**

- Limiting it everywhere — a jump to a note with little below it would lose its
  place.

## D-104 — A task's checkbox is centered on its words (2026-10-07)

**Decision:** the box gets the text's font size, `vertical-align: middle`, and
`top: -0.12em`. Tests keep it within 0.5px of the center at 12–28px in Chromium,
and within 1px at 16px and 28px on an iPhone.

**Why:** Obsidian moves the box by a fixed 0.2em of its own 13.33px font, and
the box grows with the text. On an iPhone, that left it 1.8px too high at 16px
and 5.3px too high at 28px. Centered, it is within 0.8px. Edit view is off too,
in the other direction.

**Rejected:**

- Matching reading view — copies an error that grows with the text.
- Only `font-size: inherit` — scales Obsidian's move, but does not center the
  box, so desktop is then off by 1.2–1.9px.

## D-105 — Note heights are kept to 1/64 of a pixel (2026-10-07)

**Decision:** `NoteHeights` keeps heights rounded to 1/64px, the unit browsers
lay out in, not to whole pixels.

**Why:** an empty block got a whole-pixel height, and its note was rendered up
to half a pixel different. The anchor owed the difference, and scrolling up by
hand stopped 1px before the top. With exact heights, a note not changed since it
was measured owes nothing. An edited note is estimated (ADR 0017), and a changed
embed owes whatever it changed, either way. Keeping sizes as measured is normal
practice: browsers add up anchoring corrections smaller than a pixel
(web-platform-tests' `device-pixel-adjustment.html`), and TanStack Virtual keeps
`getBoundingClientRect()` sizes without rounding.

**Rejected:**

- Whole pixels (`a5c9f52`) — saves about 26KB of a three-year journal's layout
  memory of about 160KB, against a 5MB store. No reader sees the difference
  either way.
- Allowing a pixel of difference in the tests — keeps the rounding they caught.

## D-106 — A wrapped task's lines start under its first line (2026-10-07)

**Decision:** the checkbox sits outside the line by its width and the gap after
it, so a task's words start at the item's edge on every line.

**Why:** Obsidian puts it 1.5 widths outside the line, which only lines up for a
12px box. The box grows with the text, so the first line starts left of the
others: 3px at 16px, and 10px at 28px on an iPhone, in reading view too.

**Rejected:**

- Matching reading view — copies a gap that grows with the text, the same
  problem as D-104.

## D-107 — On mobile, a kanban Base too wide for its note is drawn as cards (2026-10-07)

**Decision:** a kanban view follows D-033. Measured by the width Bases sets on
its board, it is re-rendered as cards, with its `groupBy` kept, so each column
becomes a group.

**Why:** when clipped (ADR 0008), a phone showed the first of a board's 280px
columns, and none of the others.

**Rejected:**

- Opening the `.base` file on a tap, as for a PDF (D-083) — hides a board that
  cards can show.
- Stacking the columns with CSS — Bases positions them absolutely, as D-033
  found for tables.
- Cards for every kanban, without measuring — a board with one column fits.

## D-108 — When a Base changes its own height, its note re-pins in the same task (2026-10-08)

Superseded in part by D-159: each Base's box now has a fixed height.

**Decision:** a Base's box tells its note, with a synchronous `BASE_RESIZED`
event, when its hold is released, or when a draw that was being measured turns
out to fit. The note then re-pins, and the anchor shifts, in that task (ADR
0013). A Base rendered as written in place of cards, so it can be measured, is
clipped at the cards' height until it is measured.

**Why:** both changes reached the note through a `ResizeObserver` report, which
iOS paints one frame later, so text below a Base in the same note jumped away
and back: 1219px for a table painted again as cards, and 510px each way for a
kanban (D-107).

**Rejected:**

- Pinning every Base's box, as notes are pinned — this would also clip Bases'
  own live growth for a frame, and would be a bigger change to the hold (D-035,
  D-054) than these two cases needed.
- A callback from `NoteBases` to `NoteWindowManager` — connects the renderer to
  the stream, which is created after it. The event needs no reference.

## D-112 — A phone run turns the keyboard's autocorrection and prediction back on (2026-10-09)

**Decision:** the iOS tests end a run by setting both through WebDriverAgent.
Both are on by default. `IOS_KEYBOARD_AUTOCORRECT=off` or
`IOS_KEYBOARD_PREDICTION=off` leaves one off. These can be set on the command
line, or in a gitignored `e2e-tests/ios/.env`, and the command line wins. Tests
still type with both off.

**Why:** WebDriverAgent turns both off each time it starts, on real phones too,
and never turns them back on, so the tester's keyboard stayed changed.

**Rejected:**

- Restoring what the phone had — WebDriverAgent changes it before any session
  can read it.
- Changing how WebDriverAgent starts — a fork of a dependency that installing
  the driver replaces.

## D-113 — Nothing in the stream uses `.clickable-icon` (2026-10-09)

**Decision:** a button in the stream copies how `.clickable-icon` looks, using
the stream's own class instead of Obsidian's.

**Why:** on an iPhone, a flick that started on a `.clickable-icon` never
scrolled. Obsidian's mobile tap handling for the class catches the drag, with no
`preventDefault` or `touch-action` that we could see. The pencil on every title
in the editing experiment (ADR 0018) failed four `e2e-tests/ios/` scrolling
tests.

**Rejected:**

- Undoing what the class does — it is Obsidian's script, which we cannot change.

## D-114 — The settings tab is declared, with each section as a group (2026-10-09)

**Decision:** `getSettingDefinitions()` returns Hide empty notes, then a group
for each section. Obsidian draws each group as a card, hides a fold switch while
its section is off (`visible`), and lists every switch in its settings search.
`setControlValue` saves through `saveSettings()`, which re-renders the streams.

**Why:** the settings search finds them, and Obsidian re-renders the tab itself,
so the tab has no code for rendering, saving or re-rendering.

**Rejected:**

- `SettingGroup` cards, drawn by the tab — the same cards, but missing from the
  settings search, and keeping D-078's drawing again.

## D-115 — Release notes are written by hand when releasing (2026-10-09)

**Decision:** each release's notes are a summary written into the draft before
publishing, from `git log --first-parent` since the last release tag. They say,
in plain words, what a reader notices, and leave out internal work. This starts
with the first public release, 1.0.0.

**Why:** the first-parent log has every change, whether merged or
fast-forwarded. A reader wants to know what changed for them, which needs
judgment that no script has.

**Rejected:**

- A `CHANGELOG.md` — repeats the release notes, and one contributor needs no
  entries for each branch.
- Notes generated from commits (by a script, or GitHub's) — they list commits,
  including tests and docs.

## D-116 — The README recordings are animated WebPs; the phone's is recorded over USB (2026-10-09)

**Decision:** both recordings are animated WebPs encoded by `img2webp`: desktop
is lossless, and the phone's is lossy at quality 80 and 30 frames a second. The
phone's screen is recorded over USB, as QuickTime does
(`scripts/capture-iphone.swift`), 600 px wide, and cut to the scene.

**Why:** WebP keeps the desktop recording's exact pixels in 1.3 MB, against 3.0
MB as an APNG. On the phone, scrolling changes the whole screen every frame:
lossless took 8 MB for the scrolling alone, an APNG 20 MB in total, and lossy
5.3 MB. At ten frames a second, scrolling looks jerky and key bubbles go
missing. Recording over USB draws a clean status bar, the same in every
recording.

**Rejected:**

- APNG (D-045) — over twice the size on desktop, and four times on the phone.
- WebDriverAgent's screen stream — JPEG frames, with the real clock and battery
  in each recording, and the same size once encoded.
- `sharp` — a Node dependency for what one command does.

## D-117 — A Templater block fills in one line, as its documentation says (2026-10-09)

**Decision:** in the template pattern (ADR 0011), a Templater block matches any
text on its line, like `{{…}}`. `tp.file.cursor()` matches the marker Templater
writes back, or nothing. `-` and `_` trim next to a block, as Templater's
whitespace control does. A block whose output covers several lines
(`tp.file.include`, `tp.web.daily_quote`, `if`/`else`) makes a note that was not
changed show.

**Why:** a block that matched any text across lines swallowed what was written
there: a bullet typed at `tp.file.cursor()` hid the note. A note wrongly shown
is clutter, but a note wrongly hidden is lost writing.

**Rejected:**

- Fingerprints of what Templater wrote, from its `templater:overwrite-file`
  event, kept in plugin data — catches output over several lines, but not notes
  made before the plugin was installed, where hiding matters most. It also
  relies on an undocumented event, and keeps a synced record for each note.
  Think again if users ask (`docs/TODO.md`).

## D-118 — The service counts the stream's notes (2026-10-11)

**Decision:** `DailyNoteService` keeps `streamLength`: how many notes, newest
first, the stream has loaded. `insertSorted` and `removeSorted` change it, and a
rebuild resets it. `NoteStream` keeps no list of its own.

**Why:** `StreamState` copied the list's first notes, and every change to the
list had to be repeated there, or loading in batches skipped and repeated notes
(ADR 0004). Kept in the service next to the list, the count changes with it.

**Rejected:**

- The count in `NoteStream` — each insert and remove would still have to be
  repeated there.

## D-119 — Lookups in the note list stay linear (2026-10-11)

**Decision:** `DailyNoteService.indexOf` goes through the list, and `refresh`
maps every date in order to read one.

**Why:** each runs once for each event, refresh or Back, never once for each
note. Over 1,095 notes, that takes microseconds.

**Rejected:**

- A map from path to index — a second copy of the list's order, which every
  insert and remove must keep in step. That is the kind of copy D-118 removed.

## D-120 — The service reads dates with the format it built the list with (2026-10-11)

**Decision:** `DailyNoteService` keeps the daily notes format of its last build,
and uses it to read, write and add dates. Only `refreshIfSettingsChanged` reads
the settings, each time the settings are saved (D-002). The jump list formats
each choice's label and ISO date once each time it opens.

**Why:** a note made between a format change and the refresh was read with the
new format into a list sorted with the old one. Reading the settings on each
call also cost 1,095 reads each time the jump list opened.

**Rejected:**

- Reading the format once each time the jump list opens — still one read for
  each added note, and still out of step with the list until the refresh.

## D-121 — Fold state is saved in one place, and its old keys are dropped without being read (2026-10-11)

**Decision:** `CollapsibleStateStore` saves every note's sections under
`daily-notes-stream:collapse`. It is read once at load, and notes no longer in
the vault are removed when the layout is ready, as for the layout memory. The
old `collapse:*` and `collapse-idx:*` keys are never read. A device build's
"Forget collapse state" command deletes them together with the rest.

**Why:** with one key for each section, the keys could not be listed, so a note
deleted while the plugin was not listening left its keys forever, without a
prefix, next to other plugins' keys. Every heading, every time a note was
rendered, read and parsed one key.

**Rejected:**

- Moving the old keys over — they cannot be listed, only read path by path, so
  the code to read them would have to stay forever. The plugin was not published
  then, so only test devices have any.

## D-122 — The backlink index rebuilds itself from the cache on each `resolved` event (2026-10-11)

**Decision:** `BacklinkIndex` stays lazy. On its first lookup after a `resolved`
event, it turns all of `resolvedLinks` around. `LinkChanges` keeps its own
comparison for each note.

**Why:** turning it around takes 5 ms at 10,000 notes and 100,000 links on a
2026 Mac, once for each save that a drawn footer is told about. Reading
everything again is right, whatever events Obsidian sent.

**Rejected:**

- One index for both, updated a little at a time — only correct if Obsidian
  fires `resolve` for every note whose links change, including when the notes
  they link to are renamed or deleted. `e2e-tests/linked-mentions.spec.ts`
  checks the delete and rename cases, in case this is tried again.

## D-123 — A new day waits for the stream's next change, or for midnight (2026-10-11)

**Decision:** before each vault event, refresh or settings change it applies,
the stream asks the service whether the day changed since it last checked. If
so, it checks again yesterday's note and any note made in advance for the new
day. One timer for each view also catches up a minute after midnight, once the
reader has stopped scrolling, touching and using the mouse wheel. The reader's
own loads, renders and jumps never start the check.

**Why:** yesterday's note showing until something happens costs the reader
nothing, but a note made in advance for today would stay hidden in a stream
nobody is using. Waiting until the reader is still keeps the pane from moving
under them.

**Rejected:**

- A check every minute — a timer firing all day, for one moment a day.
- Always showing the newest note instead of today's — after a skipped day, an
  untouched note stays shown until the next note is made.

## D-124 — The e2e window stays on screen, transparent (2026-10-12)

**Decision:** the tests show every Obsidian window at opacity 0, ignoring the
mouse, instead of hiding the app, and without the phone layout's vsync options.
Before each test, they lay out the page at the project's size again, from one
session that never disconnects.

**Why:** while hidden, a window whose viewport was set again drew one or two
frames a second once a tab opened, until its worker restarted, which made
whichever test that depends on frames came next time out. On screen, it draws
normally, takes screenshots, and the phone layout scrolls smoothly. When a
session disconnects, its viewport setting goes with it, and the page uses its
300x200 window the next time it lays out, for example when settings open in
their own window.

**Rejected:**

- Drawing without vsync on desktop, as the phone layout does — 4 of 5 full runs
  then failed a menu or settings test.
- Skipping the one desktop test that resizes — it checks real behavior, and the
  slowness lasts beyond it.
- A visible window behind others — the user can still see it, and macOS slows
  down a covered window.

## D-125 — History is rewritten once, before the repo is made public (2026-10-12)

**Decision:** the history only keeps the images at the latest commit of `main`
and `archive/sideways-scroll`, and the `0.x` tags and drafts are deleted. Old
commits show no images.

**Why:** old versions of images were 20 MB of a 29 MB clone. Rewritten commits
need new tags, and no reader ran a `0.x` draft.

**Rejected:**

- One new commit — loses the messages that explain why each change was made (ADR
  0001).
- Making the `0.x` tags again — they would mark releases that nobody outside the
  project ran.

## D-126 — The README's desktop screenshots show the stream's window (2026-10-12, changed 2026-10-19)

**Decision:** each desktop screenshot is the stream's pane, including its tab
bar and header, in a 904 px window, the same as the directory images use, and
960 px tall. It is shown as a window, with rounded corners, a thin edge and a
soft shadow (`scripts/window-still.mjs`). Each one goes from a note's date to
the end of what it shows, and below its last whole line, the page's background
is painted. The first screenshot is the stream itself: one whole note, the line
between notes, and the next note's date.

**Why:** the README is there to win readers over. A window looks like Obsidian
at a glance, and a screenshot that starts on a date and shows its feature in
full looks like a daily note, not a piece of one. One height lines the
screenshots up, and 960 px fits the longest, linked mentions. Shown 800 px wide,
the text is at 88% of its size.

**Rejected:**

- Only the note column — looks like a piece, not the app.
- A 1024 px window — at 800 px wide, its text shrinks to 78%.
- 520 px, the top of the column — cut the date off most screenshots, and cut
  lines in half.
- A different height for each screenshot — the screenshots stop lining up.
- A Base as the first screenshot — a reader sees a feature few people use, not
  the stream.

## D-127 — The daily notes settings are read without a library (2026-10-12)

**Decision:** `getDailyNoteSettings(app)` in `src/obsidian-internals.ts` reads
Periodic Notes' daily notes settings while they are on, otherwise the core
plugin's, and the code that uses them calls it as a function.

**Why:** `obsidian-daily-notes-interface` was bundled for this one function. It
reached Obsidian through the global `window.app`, had not been maintained since
2021, and its MIT notice was not included anywhere in `main.js`.

**Rejected:** keeping it and adding its notice to `main.js` — it would still be
a dependency for 20 lines, and the only unsupported access outside the internals
file.

## D-128 — The jump list opens on two months, and a query lists a year (2026-10-13)

**Decision:** the jump list shows the newest 62 notes when it opens, and up to
366 matches once a query is typed.

**Why:** over 1,825 notes at phone speed, opening with every date took 313 ms to
the first frame, against 41 ms for 50 notes. On an M5, it was 38 ms against 8. A
typed year can match up to 366 notes, and the old single limit of 50 cut it off
in November.

**Rejected:**

- Every date, when opening and for a query — a third of a second on a phone, and
  more with each year.
- Two calendar months back from today — a journal with few notes would open on
  few notes.

## D-129 — A fixed or empty block's height and the scroll shift are not inherited (2026-10-13)

**Decision:** `styles.css` registers `--daily-note-pinned-height`,
`--daily-note-placeholder-height` and `--daily-notes-scroll-shift` with
`@property`, `inherits: false`.

**Why:** a custom property is inherited by default, so each change restyled
every element under the one it was set on: the whole note at each re-pin, and
the whole stream at each shift. Re-pinning a 10,000-line note took 140 ms on an
M5, and 570 ms with the CPU slowed 4x; not inherited, it takes 2–3 ms. A save of
that note at phone speed froze the page for 4.9 s, and now for 1.8 s. A 200-line
note's save froze it for 55 ms, and now for less than the 50 ms that makes a
task long. A note drawn inside its empty block's height (ADR 0020) drops that
height once it is done; while the property was inherited, that cost one more
restyle of the whole note, about 520 ms at phone speed.

**Rejected:**

- Resetting them on the children, as for `--daily-note-held-height` — just as
  fast (2 ms), but it needs a rule for each property at every level where
  inheriting must stop.

## D-130 — Every saved note is rendered by section, whatever its length (2026-10-13)

**Decision:** there is no length limit. Any note saved while rendered only
re-renders the sections a save changed, from then on (ADR 0019).

**Why:** at phone speed (CPU slowed 4x, `e2e-tests/edit-cost.spec.ts`), a
200-line note's first save by section causes one task of 61–96 ms, against none
when rendered all at once. Each save after that costs nothing, against 35 ms. A
length limit tied who uses this path to an M5's speed, and left the path to the
few readers with long notes, where its problems would only be found late.

**Rejected:**

- From 8,000 characters, where re-rendering the whole note first caused a 50 ms
  task — that number is only true on one machine, and few readers would use the
  path.

## D-131 — Tests are timed on a laptop slowed below every supported iPhone (2026-10-13)

**Decision:** `emulatePhoneCpu` times a fixed piece of work
(`e2e-tests/phone-speed.ts`) on the machine, then slows its CPU until the work
takes 20 ms. That is about 2.3 times as long as an iPhone 16 Pro's 7.6–9.0 ms.
`e2e-tests/ios/phone-speed.spec.ts` checks that a real iPhone is faster.

**Why:** the fixed 4x slowed an M5 to 22–29 ms, and a slower laptop ran slower
still. 20 ms is slower than an iPhone 11 (about 18 ms, half a 16 Pro's
single-core speed on Geekbench 6), the oldest iPhone that runs iOS 26, and close
to the faster mid-range Android phones (about 29 ms estimated for a Galaxy A35).

**Rejected:**

- The fixed 4x, Lighthouse's preset — made for an average desktop, not an M5.
- An A15 iPhone's 13 ms, or 16 ms with some margin — misses the older iPhones
  and every mid-range Android phone.
- A mid-range Android phone's 29 ms — there is no such device here to check the
  number against.

## D-132 — The estimate is never just the tallest note (2026-10-13)

Superseded in part by D-135: a note measured alone no longer sets the estimate.

**Decision:** D-092's height that 90% of notes are below is taken without the
tallest note measured in the layout, unless it is the only one.

**Why:** with fewer than 20 notes measured, `floor(0.9 n)` is the tallest note
or the next one. A 10,000-line note among the first measured gave every note not
yet measured its 235,612px, so a jump past it ended up 1.6 million px down until
scrolling next stopped. With more notes measured, nothing changes.

**Rejected:**

- A limit at a multiple of the median — a number tuned to no real vault, and
  with two notes measured, the median is half the unusual note.
- A limit in pane heights — a vault of long notes would come out too short
  everywhere, the reason D-092 rejected the height that 75% are below.

## D-133 — A frontmatter change only draws the properties again (2026-10-14)

**Decision:** a save that changes a note's frontmatter renders its properties
box again and updates its body in place (ADR 0019). On mobile, a note with a
Base is still rendered all at once.

**Why:** when rendered all at once, a long note lost the elements the anchor
uses to keep the reader's place. On the iPhone, a reader at the end of a
5,000-line note saw 10 blank frames, and the text moved 125 px for good. No
section reads the frontmatter when rendered, but a Base's formulas may, through
`this`.

**Rejected:**

- Keeping the reader's distance from the note's end when rendering the whole
  note — wrong for an edit below the reader, and the blank frames stay.

## D-134 — A drawn note's runs keep their sections (2026-10-14)

**Decision:** once a note is drawn, each run (ADR 0021) keeps the sections it
started with. A save replaces sections inside their run, and only shows the runs
that contain what it removes, and those on either side of what it adds.

**Why:** when runs were grouped again by length on each save, making one section
longer regrouped every run above it, so the save had to show every run first. On
the iPhone, that meant one task of 140–590 ms for each save to a note of
5,000–10,000 lines, wherever the edit was.

**Rejected:**

- Grouping again, then showing each hidden run that the new grouping splits — a
  save that moves the edge of one run still shows every run above it.

## D-135 — A note's estimate is limited by its size, at the highest rate measured (2026-10-14)

**Decision:** a note never measured in the layout gets whichever is smaller:
D-092's height that 90% of notes are below, or its file's size in bytes × the
most pixels per byte of any note measured there. The second is never less than
what a note gets before anything is measured (two pane heights).

**Why:** D-132 still let the first note measured set every estimate. With
heights forgotten, a jump to a 10,000-line note gave each note below it that
note's 234,000px. Scrolling down went faster than drawing through that empty
space, and jumped back as the notes were drawn short. Too tall is not safe below
the reader. The highest rate leans tall, because a Base, which is tall from few
bytes, raises the limit. The minimum stops a note of a few bytes, all title and
frame, from coming out too short.

**Rejected:**

- No estimate until ten notes are measured — with two long notes among them, the
  estimate is long again.
- The median rate — a note with more pixels per byte than the median, as any
  Base has, comes out too short.
- The shortest note measured as the minimum — when the long note is the only one
  measured, it is also the shortest.

## D-136 — A section's fold key includes the heading above it (2026-10-14)

**Decision:** a heading or nested list item gets the key `{heading}/{own key}`,
where `{heading}` is the slug of the nearest heading above it of a higher level
(`h1` over `h2`), or of any level for a list item. A section above every heading
keeps the plain key. Repeated keys are numbered among sections with the same
full key.

**Why:** repeats were numbered across the whole note, so deleting the first
`Errands` passed its saved state to the next one, under another heading. Now
only repeats next to each other shift. The cost: renaming a heading unfolds the
sections folded directly under it, and renaming it back within a day folds them
again (D-027).

**Rejected:**

- The full path of headings — renaming a top heading would unfold every section
  under it.
- Moving saved keys over — the plugin was not published before `1.0.0`, and a
  section saved under a heading just unfolds once.

## D-137 — A note window's flags stay separate, and `FarRuns` belongs to the folding manager (2026-10-14)

**Decision:** `NoteWindow` keeps `component`, `rendering`, `unloadWanted`,
`is-far` and the `leaving` set as separate fields. `CollapsibleManager` creates
`FarRuns`, and the renderer and the window reach it through the renderer.

**Why:** the flags are three separate things that combine: what is drawn,
whether it is out of the layout, and whether unloading is waiting. So a note
being updated in place can be hidden and waiting to be unloaded at the same
time. Passing `FarRuns` down from `StreamView` would add a parameter to two
constructors, only to remove one getter.

**Rejected:**

- One state value for each window — it would have to list every combination of
  the three.
- `StreamView` creating `FarRuns` — longer constructors, for one getter less.

## D-138 — Every drawn note on mobile watches for tables drawn later (2026-10-15)

**Decision:** `stackWideTables` gives each rendered note on mobile its own
MutationObserver, whether or not it has a table.

**Why:** tables arrive after drawing in three ways: Dataview's tables, embeds
loading, and sections a save draws in place (ADR 0019), which nothing else
stacks. A note with no table yet gets one as it is typed.

**Rejected:**

- Only watching notes with a table or a Dataview block — a table typed into
  today's note would scroll sideways.
- One observer for the stream — the same work for each change, saving only a few
  objects.

## D-139 — A far run is watched at both ends (2026-10-15)

**Decision:** `FarRunWatch` watches the first and last element of every shown
run.

**Why:** measured on an iPhone 16 Pro, flicking past a 10,000-line note both
ways, at most 10 ends are watched at once. Watching one end of each run would
save four targets, with no frame time to gain.

**Rejected:**

- Using the next run's first element for a run's end — a run shown while the
  next one stays hidden (after a search step or a save) would have no end
  watched.

## D-140 — A glide stops at the stream's shifted end once every note is loaded (2026-10-15)

**Decision:** once every note is loaded, `ScrollAnchor` stops a scroll two steps
before the stream's end comes into the pane, while the end is shifted higher
than the scroll position puts it. It is the same stop D-091 makes at the top.

**Why:** a shift owed for notes above that grew shows the end too early. On an
iPhone, scrolling to the oldest note showed a blank pane for 1.8 s, until
scrolling stopped.

**Rejected:**

- Stopping while notes are still loading — a batch added below would let the
  glide go on.
- Limiting the shift to the space below on every frame — the reader's text would
  move mid-glide.

## D-141 — Mutation testing runs when asked, and only for what changed (2026-10-15)

**Decision:** `pnpm run test:mutation` runs Stryker on `src/` with workers for
30% of the cores, which use about 40% of the machine, and only runs again the
mutants whose code changed. Its results and report stay in `reports/`, which is
gitignored. It is not a quality gate. Stryker cannot see which file a vitest
test is in, so it misses a change to a test. After one, run again only the
source file it covers, with `--force --mutate <file>`. Only do a full run (a
plain `--force`) after a change to Stryker, vitest or the Stryker config, which
can change every result. Bail is off: with it, mutants that made tests fail at
once were reported as surviving, a different few on each run. A survivor that
the JSON report marks `static` may be wrong: one in `note-window.ts` failed its
test when applied by hand.

**Why:** 100% line coverage says what ran, not what was checked. The first run
left 657 of 5,477 mutants alive (87.9%). A full run takes about 13 minutes on 8
workers, and keeps the fans at full speed.

**Rejected:**

- A gate on every task — too slow, and many survivors are mutants that behave
  the same as the real code.
- All cores but one, the default — the laptop gets hot for little gain.
- Half the cores — a worker uses more than one core: 5 workers used 6 of 10
  cores, with the fans at full speed.
- Only the efficiency cores (`taskpolicy -b`) — cool, but the aim is to leave
  cores free, not to choose which ones.
- Committing the results — about 10 MB changed on each run, for one machine and
  no CI. Stryker's own repo downloads them from its dashboard instead.

## D-142 — The phone tests open the stream again (2026-10-15)

**Decision:** `phone.openStream()` closes the stream and opens it again, at its
top, as a reader would.

**Why:** it used to set the scroll of a stream left open to the top, which
nothing in the app does. The anchor still kept a place from further down, so
over a long newest note, the stream rendered it from its end and ended up about
250,000 px down.

**Rejected:**

- The app's own scroll to the top, the scroll from a tap on the title — notes
  drawn on the way changed what three tests started from.
- A jump to the newest note — it puts the title at the pane's top, 8 px below
  the stream's top, so tests comparing with the top after a title tap would
  differ.

## D-143 — A scroll up that owes growth stops before it runs out of scroll (2026-10-15)

**Decision:** `ScrollAnchor` stops a scroll up two steps before it reaches a
scroll position of zero while the stream is shifted up, and sets the scroll
position to include what it owes, as D-140 does at the end. This does not apply
to a scroll to the top, such as after a tap on the title, which ends there owing
nothing.

**Why:** notes above that grew while scrolling left the stream's top above the
pane at a scroll position of zero. The scroll bounced before the newest note's
top, and a pull on the bounce opened Obsidian's pull-down action, the command
palette, over the stream.

**Rejected:**

- Moving the shift into the scroll once the bounce ends — the bounce, and the
  pull on it, come first.
- Setting what is owed mid-glide, so the glide reaches the top — iOS undoes it
  ([ADR 0013](adr/0013-pin-rendered-note-heights.md)).

## D-144 — The phone tests change Appium to use one console listener (2026-10-15)

**Decision:** setup changes the XCUITest driver's `context.js` so it stops its
console listeners before it starts a new one
(`e2e-tests/ios/console-listener.ts`).

**Why:** the driver adds a listener every time it switches into the web view,
and never removes one. After N switches, each message is logged N times, into a
buffer of 5,000. A full run lost a test's error before the test read it. Tested:
300 switches and 30 lines after an error lost it, and with the change, the error
was caught.

**Rejected:**

- Collecting errors in the page (`error`, `unhandledrejection`, `console.error`)
  — misses what WebKit logs itself, and errors from before a reload sets it up
  again.
- Reading the log after every switch — can still lose messages during one long
  call.
- A new session for each test file — limits the copies for each file, not for
  each test, so a long file can still lose one.

## D-145 — A scroll re-pins the note at the pane's top if its content moved (2026-10-16)

**Decision:** `NoteWindowManager.onScroll` first measures where the content of
the note at the pane's top ends, relative to the note's top, and compares that
with where it ended when the note was pinned. If that moved, the note re-pins
before the anchor reads its place.

**Why:** Bases fills a view in a task of its own, which moves the text below it
inside the pin. When a scroll came before the `ResizeObserver` report, the
anchor read its place in the text that had already moved, so re-pinning later
owed nothing, and the next note dropped by the growth: 603 px in about 1 flick
in 5 (D-108 only covers a Base's own holds).

**Rejected:**

- A `MutationObserver` on each Base — only covers Bases, and misses growth with
  no DOM change.
- Re-pinning every rendered note on each scroll — a forced layout for each note
  on each frame (ADR 0023).
- Notes marked as on screen by the `IntersectionObserver` — it lags behind, so a
  note ending at the pane's top is not yet marked when the scroll arrives.

## D-146 — A glide stopped early is stopped one step further on (2026-10-16)

**Decision:** D-140's and D-143's stops set the scroll position one scroll step
beyond the position the page last heard, plus what is owed.

**Why:** iOS has already drawn one step beyond the scroll position the page
hears. Stopped at the heard position, the text moved back 40–52 px against the
glide in every stop recorded on an iPhone. Stopped one step further, 1 stop in
25 moved back, by 88 px.

**Rejected:**

- Two steps further — no stop moves back, but each moves forward one frame more
  than the glide would have.
- Stopping without setting the scroll, only by freezing it — what is owed is
  moved into the scroll on the next frame, which is a jump of its own.

## D-147 — On desktop, a header button scrolls to the top (2026-10-16)

**Decision:** changes D-037. On desktop, an `arrow-up-to-line` button next to
Search and Jump to date scrolls the stream smoothly to its top. Mobile keeps the
tap on the title, and gets no button.

**Why:** desktop only had the command, and nothing on screen offered it.

**Rejected:**

- The title on desktop too — D-037's reason still holds.
- The button on mobile too — a third icon in a narrow header, for what the title
  already does.
- A floating button over the notes — covers text, and no other view has one.

## D-148 — CI runs the checks that need no Obsidian, on Linux (2026-10-17)

**Decision:** `.github/workflows/ci.yml` runs formatting, lint, the e2e type
check, the unit tests with coverage, and the build, on `ubuntu-latest`, for
pushes to `main` and for pull requests. e2e, the iPhone tests and the memory
tests are run locally.

**Why:** Linux runners are free. The e2e tests start the macOS app through
LaunchServices (`open -g -j`).

**Rejected:**

- e2e on a macOS runner — not on the free tier for a private repo.
- e2e on Linux under Xvfb with Obsidian's AppImage — a second way of starting
  the app to keep working, never checked against the tests' timings.

## D-149 — A mutation run leaves no surviving mutant (2026-10-17)

**Decision:** changes D-141. A surviving mutant gets a test, or, when no test
can tell it apart from the real code, a Stryker directive where it is, with the
reason: `// Stryker disable next-line <mutator>: <why>`. A mutant that only a
real layout shows says so, and names the e2e test that covers it (ADR 0002).
Directives attach to the next node's leading comment, so a `catch` block needs a
`disable` and `restore` pair around its `try`.

**Why:** after a clean run, a new survivor is the only one, so it gets read.

**Rejected:**

- `mutator.excludedMutations` in the config — turns off a mutator everywhere,
  hiding real gaps along with the mutants that behave the same.
- Tests that check things nothing depends on, such as a zoom of 1, or a field's
  first value that is replaced before it is read — they pass the measure, and
  protect nothing.

## D-150 — End-to-end tests are in `e2e-tests/` (2026-10-17)

**Decision:** the Playwright tests move from `e2e/` to `e2e-tests/`.
`tests/repo/compliance.test.ts` checks that every TypeScript folder except
`src/` is under a path the directory's review scanner skips.

**Why:** the scanner skips `e2e-tests/**` and `*.spec.*`, but not `e2e/`, so it
linted the test code as plugin code. That caused the 1.0.0 review's three errors
and most of its warnings
([scanner config](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration)).

**Rejected:**

- Changing the test code to follow the plugin rules — `fs`, `child_process` and
  `fetch` are what Node test code is for.

## D-151 — Lint fails on a warning (2026-10-17)

**Decision:** `pnpm run lint` runs with `--max-warnings 0`, using the same
`eslint-plugin-obsidianmd` and `typescript-eslint` that the review scanner runs.
Rules that protect the app while it runs (pop-out windows, mobile, the config
folder) are off for `scripts/` and `tests/`, which run in Node.

**Why:** the scanner reports most rules as warnings, and any warning that lint
lets through shows up in the review.

**Rejected:**

- Making each rule an error by name — the list would drift from the scanner's.

## D-152 — Moment's types are written in this repo (2026-10-18)

**Decision:** `src/notes/moment.ts` writes the types of the moment methods the
plugin calls, and is the only file that imports Obsidian's `moment`, which lint
checks. A moment from anywhere else is passed in as its milliseconds. A test
checks that the real moment matches the type.

**Why:** the directory's scorecard lints without moment's types, which
`obsidian.d.ts` imports from its own dependency, so every moment call got a
warning: 91 on 1.0.2, which rated its Review as "Caution". Hiding moment's types
locally shows the same warnings, and with this change there are none.

**Rejected:**

- `@types/moment` — an empty package that depends on `moment`. nldates has it
  and is still flagged.
- Waiting for the scanner to be fixed — the rating stays bad in the meantime.
  Undo this once it is fixed (`docs/TODO.md`).

## D-153 — styles.css avoids what the scorecard flags (2026-10-18)

**Decision:** no `:has`, no custom element selected by its tag name, and no
`!important`. `tests/repo/styles.test.ts` checks all three.

**Why:** the directory's scorecard warns about each. Every override wins by
being more specific, or, for Bases' sticky summaries, by their inset. The one
inline style it cannot beat is removed from code (D-172).

## D-154 — An amount owed smaller than a layout unit counts as nothing (2026-10-18)

**Decision:** the scroll anchor owes nothing when the amount is less than 1/64
px, WebKit's layout unit (`src/stream/scroll-anchor.ts`).

**Why:** the amount adds up moves of parts of a pixel, which can cancel out to a
tiny remainder such as `2.8e-14`. While that remainder counted as owed, the
stream stayed shifted, and moving the shift into the scroll set the scroll
position, which stops a scroll. `e2e-tests/ios/jump.spec.ts` failed 1 run in 3.

**Rejected:**

- Rounding each move to 1/64 px — makes an error on every move, and the errors
  add up.
- `Number.EPSILON` — a remainder grows with the numbers it comes from.

## D-155 — README.md is not wrapped (2026-10-18)

**Decision:** Prettier writes each README paragraph on one line
(`proseWrap: "never"` in `.prettierrc.json`).

**Why:** Obsidian's community plugin view shows a single newline as a line
break, so a README wrapped at 80 columns broke in the middle of sentences on
narrow screens.

**Rejected:**

- Ending lines with two spaces or `<br>` — Obsidian's renderer is the problem,
  not the kind of break.

## D-156 — Empty notes are shown by default (2026-10-18)

**Decision:** Hide empty notes is off by default (`src/settings.ts`).

**Why:** a new user saw notes disappear with no visible reason, and a missing
day looked like a bug. Hiding them is still one switch away.

**Rejected:**

- On by default, explained in the README — the stream itself gives no hint.

## D-157 — One card per row is a setting (2026-10-19)

**Decision:** **One card per row** (off by default) sets `cardSize: 800`, Bases'
largest size, on the cards that a Base too wide for its note is drawn as
(D-033), so one card fills any row. A view written as cards keeps its own size.
Turning the setting on or off leaves remembered heights out of date until each
note is re-rendered, as turning Show note properties on or off does.

**Why:** on a phone, Bases fits two cards in a row, which cuts each card's
values short.

**Rejected:**

- A card size slider — how many cards fit in a row still depends on the screen.
- Cards per row, from 1 to 3 — needs a size worked out from each width, and
  re-rendering whenever the width changes.
- Resizing cards that the note itself wrote — the note chose that size.
- Including the setting in the layout key — a second set of heights for one
  setting.
- Forgetting every height when the setting changes — most notes have no Base,
  and would lose a correct height.

## D-158 — The iPhone tests run on five years of notes only when asked (2026-10-19)

**Decision:** `IOS_SEED_DAYS` sets the length of the iPhone vault's journal: 21
days unless set, and 1825 for five years. Each test costs the same either way:
the test Bases list one month of the journal (`A_MONTH`), and a trip to the
oldest note starts 21 notes above it (`stream.spec.ts`). The tests wait for
Obsidian's layout and index before the first test.

**Why:** the README says the stream stays fast over years of notes. Desktop
measured that (`pnpm run test:memory`), but the phone did not.

**Rejected:**

- Always five years — each run fills the phone's vault again, about 1,800
  writes.
- Bases that list every file — a note a million pixels tall tests a Base's size,
  not the stream's length. Tracked in `docs/TODO.md`.
- Trips through every note — 11.5 min one way, about 23 min there and back, to
  check what a 21-note trip checks.

## D-159 — A Base is held at a fixed height (2026-10-19)

**Decision:** the box each Base is drawn in has a fixed height: the tallest the
Base has been since it last settled. Anything taller is cut off. When the Base
grows, the box grows to match in the next task, and tells its note, which then
updates its pinned height (ADR 0013). A Base drawn as a table to measure whether
it fits grows the same way once that is decided. A Base in a note far from the
screen (ADR 0023) has no box, so it keeps its hold instead of letting go.

**Why:** Bases adds a table's rows from inside its own ResizeObserver callback.
This happens when a note hidden far off screen (ADR 0023) is shown again after
its Base's data arrived while it was hidden. ResizeObserver had already reported
the note's size in that frame, so the note growing then made WebKit log the
D-095 error. With a box of fixed height, the rows grow inside the box, and the
note only changes size in the next task. The cost: a Base's growth shows one
frame late. A glide can draw a note and carry it out of the layout before Bases
lays out its rows. Letting go there held nothing, so the rows grew the note
inside Bases' callback when it came back (`e2e-tests/ios/bases.spec.ts`).

**Rejected:**

- A `min-height` hold raised from the callback (D-095) — growth inside Bases'
  own callback goes past it.
- Not observing the note's content — the scroll anchor and fitting to the width
  need it.
- Calling Bases' `onResize` ourselves, outside a callback — it is an Obsidian
  internal, and Bases' own observer still fires.

## D-160 — Empty notes only get new heights after the turn has been moved into the scroll (2026-10-19)

**Decision:** while `ScrollAnchor` keeps the place it read before the pane's
width changed (D-057), `NoteWindowManager` waits to give empty notes new heights
(ADR 0014) until the next time scrolling stops. Asking whether the anchor is
keeping a place also reads the width, so a turn that no resize has reported yet
counts.

**Why:** giving new heights ends with moving the shift into the scroll, which
also stops keeping that place. On a phone, new heights due as the phone turned
were set in the first frames of the turn. The anchor then read its place again
on each frame, ended up on a Base emptied to be drawn again, and the reader
ended up 409px below their place in 5 turns out of 60.

**Rejected:**

- Moving the shift into the scroll while still keeping the place read before the
  reflow — changes what every caller of `handOver` gets, to fix one.

## D-161 — The directory's screenshots are images with headlines (2026-10-19)

**Decision:** each of the plugin directory's images has a headline in Avenir
Next on a warm paper-colored background. The five desktop images show the
stream's tab alone, with the sidebar closed, and the last one shows a light and
a dark phone. The five mobile images show one whole phone each, the last one in
the dark theme. Each phone is drawn at the 402x874 shape of its screenshot.

**Why:** a plain window says nothing on its own, and its sidebar took a third of
the image. A headline names the feature the picture shows. The mobile image
slots are 9:16, shorter than a phone's screen, so a plain screenshot was cut off
or had empty bars.

**Rejected:**

- The whole window with the sidebar open — mostly Obsidian's file list, not the
  plugin.
- Plain phone screenshots cut to 9:16 — cuts off the phone's own bars.
- White text on black next to the window — looks like a copy of other listings.
- A serif headline — looked out of place next to Obsidian's interface.

## D-162 — The plugin's name is in title case (2026-10-19)

**Decision:** the plugin is named "Daily Notes Stream" in the manifest, and the
same wherever the interface names the plugin: its tab, and Page preview's
settings. Commands, settings and buttons stay in sentence case.

**Why:** Obsidian's guidelines ask for sentence case in the interface, but
capitalize proper nouns, and a plugin's name is one. The directory's popular
plugins use title case, and Obsidian puts the name in front of each command.

**Rejected:**

- Sentence case everywhere — in the directory, it looks like a description, not
  a name.
- Title case only for the name, and sentence case in the tab — two spellings of
  one name.

## D-163 — The desktop recording is made at 2x and 30 frames a second (2026-10-19)

**Decision:** the desktop recording's frames are 1600 px wide, the window at the
display's 2x scale, and the README shows it 800 px wide. Movement keeps up to 30
frames a second, like the phone's recording (D-116). It is still lossless.

**Why:** at 1x, a Retina screen doubled each pixel, and the text looked soft. At
ten frames a second, scrolling moved in jumps. The file grows from 1.3 MB to 5.6
MB.

**Rejected:**

- Lossy at 2x — not needed at this size, and it gives up the exact pixels that
  D-116 kept lossless for.

## D-164 — A change to the stream that runs for 5 seconds logs an error (2026-10-19)

**Decision:** every change in the stream's queue, and the drawing of each note,
logs an error in the developer console once it has run for 5 seconds, with its
name, and again when it ends. The messages are in the published build. It is an
error, not a warning, because the lint only allows `console.error`.

**Why:** every change waits for its turn in one queue (ADR 0004). A reader on a
slow Windows laptop came back with Back to a stream that stayed empty until the
tab was opened again, and it did not happen here. A change that never ends
leaves every note undrawn, and logged nothing, while an error is already logged.

**Rejected:**

- A timeout that gives up on the change — the queue's order is what keeps the
  blocks and the note list in step, and skipping ahead breaks that.
- A debug setting for the logging — a reader can only use the published build,
  and logging cannot be turned on after something has already stopped.
- 10 seconds — a reader may give up and open the tab again before then. The
  slowest work the e2e tests allow, the first search, takes 1.5 s, so 5 s leaves
  room for a slow laptop.

## D-165 — The directory descriptions are kept in docs/LISTING.md (2026-10-20)

**Decision:** the plugin directory's short and long descriptions are in
`docs/LISTING.md`, and are copied into the directory by hand. A test checks that
`manifest.json` and `package.json` match the short one, and that both fit the
directory's limits of 200 and 1000 characters.

**Why:** the directory keeps no history. The manifest's description is what
users see in their installed plugins, and Obsidian expects it to match the
directory's.

**Rejected:**

- Only in the directory — no record of earlier wording.
- A copy in the README — readers would see it twice.

## D-166 — Overrides raise development dependencies past security warnings (2026-10-20)

**Decision:** overrides in `pnpm-workspace.yaml` set a minimum version for each
indirect development dependency that has a security warning, where its parent's
version range already allows the fixed version, or where `@appium/support` fixes
the version (`shell-quote`). An entry is removed once its parent requires the
fixed version itself. `esbuild` 0.27 (low severity, only used by vitest's
internal server) and `extract-zip` (no fix released) are still open.

**Why:** pnpm keeps an installed version as long as it is in the range, so
`pnpm update --depth Infinity` left most of them as they were. None of them
ships, because the plugin bundles no dependencies.

**Rejected:**

- Deleting the lockfile — resolves every package again, to fix a dozen.
- Forcing `esbuild` 0.28 — outside the range vite 7 asks for, for a low-severity
  warning.

## D-167 — Nothing in the stream fades on mobile (2026-10-20)

**Decision:** on mobile, nothing in the stream has a `transition`. What a touch
changes there changes at once: Obsidian still dims a touched link
(`mobile-tap`), and shows a date's daily note button.

**Why:** a fade that starts under the finger can stop iOS from scrolling. On an
iPad, a swipe starting on a link, a date in a Base, its daily note button, or a
link to a day moved the stream 0 px, and about 620 px without the fade. The
fading element gets its own layer, and because the pane is not a stacking
context, WebKit then composites every positioned element after it. Among them is
a callout, which dark themes blend (`mix-blend-mode: lighten`). If that happens
before iOS starts the pan, about 1 ms after the touch, the touch never scrolls.
Reading view does the same with a blended callout after the link. It only seemed
not to, because it renders few sections at once.

**Rejected:**

- No transition on links only — a date's button fades too.
- Opacity 1 on a touched link — removes Obsidian's feedback, and still leaves
  the button.
- Removing `mobile-tap` from Obsidian's touch handler — changes Obsidian, and
  still leaves the button.
- `isolation: isolate` on the pane — stops the chain of composited layers, but a
  swipe still stopped once in 15.
- No blending on callouts — changes how they look, and any other blended element
  would stop a swipe again.

## D-168 — The iOS tests also run on an iPad (2026-10-20)

**Decision:** `pnpm run test:ios` accepts an iPad as well as an iPhone, and
leaves either in the orientation it found it in, instead of upright.

**Why:** iPad bugs, such as a swipe that stops on a Base, need a real iPad to
reproduce, and an iPad is mostly used in landscape. Tests that assume a phone's
size, or that start upright, fail on it, and `docs/TODO.md` tracks them.

**Rejected:**

- Skipping those tests on an iPad — some failures may be real iPad bugs.
- A separate set of iPad tests — the same touches and checks, twice.

## D-169 — `test:ios` uses the iPhone, `test:ipados` the iPad (2026-10-21)

**Decision:** each command uses the device of its type on the cable, so both can
stay plugged in. A test that is only true on a phone asks which one it uses
(`drivesIPad`), and the tests make strokes below an iPad's header, which is
above the stream's pane. This changes D-168, whose assumptions about phones are
now dealt with.

**Why:** using the first device found meant unplugging the other one before
every run.

**Rejected:**

- A separate set of iPadOS tests — the same touches and checks, twice (D-168).
- One command, with the device named by an option — a command for each device is
  what a reader of `package.json` finds.

## D-170 — The follower reads the text on each scroll event, and allows for a scroll's stop (2026-10-21)

**Decision:** `Phone.followReader` also reads the text when the page gets a
scroll event, before the stream reacts to it. A scroll step against the
scrolling, which moves the text on by no more than the scroll's last step, was
set by the stream and is not drift: `ScrollAnchor.stopGlide` sets the scroll one
step further, because iOS has already drawn that step. A test of the tests grows
a note above the reader mid-glide, without a shift, and the follower must report
it. The test of a glide that owes checks that the glide was stopped while owing,
not that it ended within 400 px of the top.

**Why:** iOS keeps scrolling for frames that the page never hears about. Read
once a frame, that step and the stop's change to the scroll came together, and
the follower reported the whole shift owed as drift, while a screen recording
showed the text moving on smoothly. The recording showed the added growth as a
jump, as the follower does. The 400 px limit failed on a 60 Hz iPad, whose steps
are twice as big as an iPhone's.

**Rejected:**

- A screen recording in the test — it must start before Appium connects, so it
  covers the whole run, and its frames are dropped and repeated (D-099).
- A fixed limit on a step — it only fits one device's speed and one vault.

## D-171 — A glide is judged by how it ends, not by a time (2026-10-21)

**Decision:** `Phone.glideEnding` lets a flick's scroll run out, and reads every
frame the page drew from when the finger lifts (`e2e-tests/ios/glide.ts`,
D-173). It passes if the glide slowed to less than a tenth of its fastest speed,
as iOS ends a glide, or if it ended at the top, at the stream's end, or at the
stream's stop. A scroll stopped while still fast anywhere else fails. It
replaces `glidesPast`, which checked whether the stream was still moving 500 ms
after the finger lifted.

**Why:** the stream's own stop (D-143) ended the jump test's scroll 390 ms after
the finger lifted on an iPhone, in every run, and 500–1,100 ms after on an iPad,
so how soon depends on the device and the vault. A stall ends a glide while it
is fast, but the stream's stop and iOS do not, wherever they happen.

**Rejected:**

- Taller empty blocks, or a jump with more notes above — ties the test to the
  vault's size.
- A glide that reaches the top — most flicks end in the middle of the stream.

## D-172 — The scroll box guard removes an inline overflow-x at once (2026-10-25)

**Decision:** on mobile, `ScrollBoxGuard` removes an inline `overflow-x` from
each element as soon as it is added or its style changes, outside a Base, and
clips it (`src/stream/scroll-box-guard.ts`). This is the only exception to
D-003: `style.removeProperty("overflow-x")`.

**Why:** Obsidian's reading view sets `overflow-x: auto` inline on a table's
wrapper, which only `!important` can beat, and the scorecard warns about that
(D-153). Its style rule flags setting a style, not removing one. Reading the
inline style does not make the browser recalculate styles, so the box is clipped
before it is painted, even while scrolling, where the check after scrolling
stopped used to leave it scrolling.

**Rejected:**

- Keeping `!important` — a scorecard warning.
- Removing it in the check once scrolling stops — the box scrolls until then,
  and can stop the scroll it appeared in (ADR 0008).

## D-173 — A glide is read frame by frame, so a stall is not a stop (2026-10-25)

**Decision:** `Phone.glideEnding` reads the scroll position on every animation
frame after the finger lifts, not on scroll events, and judges each step by its
speed. A frame over 100 ms late is a stall. A glide whose last move covers a
stall "ended in a stall", which no test fails. The longest stall is noted on the
test.

**Why:** on an iPad, `2026-08-30`'s Bases block the page for 330–410 ms
mid-glide while iOS keeps scrolling. Read by scroll events, that silence
outlasted the 300 ms wait before the shift moves into the scroll, and 6 of 18
such flicks looked cut short. A scroll that does not move over running frames
has stopped.

**Rejected:**

- A longer wait before moving the shift into the scroll — a longer stall would
  still look like a cut.
- Judging by distance — a glide cut short in a long scroll also goes far.

## D-174 — The iPad tests type on iOS's keyboard, even with one attached (2026-10-25)

**Decision:** `search` and `jump` type on iOS's on-screen keyboard, even with a
keyboard attached to the iPad. If it has not appeared within 5 s,
`Phone.raiseKeyboard` presses Right Arrow through XCTest, which types nothing
and brings it up. The README recording skips on an iPad.

**Why:** with a keyboard attached, iOS hides its own, and these tests failed.
One key pressed through XCTest shows it again, until the keyboard is detached
and attached again. iOS does not always say whether a keyboard is attached, so
the key is pressed whenever the on-screen keyboard is missing.

**Rejected:**

- Skipping the tests with a keyboard attached — search and the jump list would
  go untested on such an iPad.
- Typing on the attached keyboard through XCTest — the first key brings up the
  on-screen keyboard anyway.
- Checking where iOS says its keyboard is — iOS places it below the screen only
  the first time an input is focused after the keyboard is attached.

## D-175 — Comments wrap at 80 columns, and lint checks it (2026-10-25)

**Decision:** comment lines are at most 80 columns, counting indentation; code
stays at Prettier's 120. `@stylistic/max-len` checks comments in every
TypeScript and JavaScript file, and is the only rule in `e2e-tests/` and the
root config files. `eslint.config.mts` lists the lines that may be longer.
`tests/repo/comment-width.test.ts` checks `styles.css` and the Swift scripts.

**Why:** Prettier never wraps comments, so comments wrapped by hand drifted to
different widths. Prose reads best at about 65–75 characters a line, and 80
matches the Markdown docs (D-070). The full rules misfire on `e2e-tests/` and
the config files: about 1,960 problems, mostly type rules on untyped
`page.evaluate` code.

**Rejected:**

- 120 columns — long lines of prose are harder to read.
- `prettier-plugin-jsdoc` — rewraps only `/** */` blocks, in its own style.
- All the lint rules on `e2e-tests/` — fixing those problems is a project of its
  own.
- Stylelint for `styles.css` — it dropped its line length rule.

## D-176 — A glide stops three steps ahead, and may still bounce on an iPad (2026-10-26)

**Decision:** changes D-091, D-140 and D-143. Each stop fires when the stream's
top or end, or a scroll position of zero, is within three steps the size of the
last one (`STEPS_AHEAD`), not two. D-146's step further is still one step. On an
iPad, about 1 glide in 30 still bounces at the top while owing, so the phone
test only checks that the text never jumps.

**Why:** on an iPad, scroll events come unevenly: one brings one frame's move
(about 50 px), the next three or four frames' (170–340 px). With two steps, the
test failed 5 of 98 runs; with three, 2 of 60. A glide stopped a step sooner
still owes thousands of pixels above, so the reader hardly sees it. A bounce
needs notes above far shorter than their heights, which saved heights (ADR 0010)
and a tall estimate (D-092) make rare.

**Rejected:**

- The largest step of the last 150 ms — passed 60 of 60 runs, but needs a list
  of timed steps and rules for a turn. Try it if a bounce opens the pull-down
  action in real use.
- The glide's speed times the longest gap between events — event times are when
  the page ran, not when iOS moved.

## D-177 — Nothing owed, the stream has no transform (2026-10-26)

Superseded in part by D-178: tag pills stopped the glides, not the transform.

**Decision:** `ScrollAnchor` only puts the stream's shift on it while something
is owed. When a move adds up to less than a layout unit, which counts as nothing
owed, the stream is drawn without the transform (`is-scroll-shifted`).

**Why:** a note above that grew by a fraction of a pixel mid-glide gave the
stream `translateY(0px)`. During a burst of stopped flicks on an iPad (see the
TODO), 8 of 10 flicks over a framed web page stopped dead 150–250 ms after it
appeared; just after, without it, 1 of 10 did. Outside a burst, 0 of 30 stopped
with or without it, so it may not be what stops them. A transform that moves
nothing has no use either way.

## D-178 — The stylesheet clips the properties panel on mobile (2026-10-26)

**Decision:** on mobile, `styles.css` clips the properties panel's rows, values,
tag lists and tag pills (`overflow: clip`), in place of Obsidian's
`overflow: hidden`.

**Why:** a tag pill's text is 16 px tall in a 14 px pill, so the pill is a
scroll container that overflows (ADR 0008). The scroll box guard clips such
boxes only once scrolling stops, so a note rendered mid-glide brought them on
screen. In a burst on an iPad, 26 of 30 flicks after a jump stopped 1–4 frames
after a note with tags rendered; clipped, 1 of 30. Outside a burst, the pills
stop nothing.

On 2026-10-27, 22 flicks after a jump on the iPad, in the conditions that cut
before, all glided on, and no pill overflowed during a glide. No burst came, so
a burst is still untested.

**Rejected:**

- Clipping every element in the panel — it would also clip what overflows
  without a scroll container today, such as a focus ring.
- Running the guard on every new note mid-glide — reading computed styles then
  makes the browser recalculate the whole page's styles.

## D-179 — A search marks a match only where nothing covers it (2026-10-27)

**Decision:** a match counts as on screen (D-022) only if the element at the top
and bottom of its line, from `elementFromPoint`, is inside the pane, and both
are inside the visual viewport.

**Why:** opening the bar searches its kept query again at once. On an iPhone,
the navbar still floats over the pane then, so a match under it was marked, and
Enter moved past it. Measured on 2026-10-27: Obsidian then removes the navbar
for the keyboard, and on both an iPhone and an iPad it shrinks the pane above
the keyboard, so typing alone met neither. The visual viewport covers a device
where the keyboard does not shrink the pane.

**Rejected:**

- Subtracting the header and navbar by their class names — it misses anything
  else that floats over the pane, and breaks when Obsidian renames them.
