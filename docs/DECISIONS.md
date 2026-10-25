# Decisions

Smaller design decisions. Anything whose reversal means migrating data or
rewriting across layers belongs in [`adr/`](adr/) instead.

Entries are numbered in order and never renumbered; cite one by its bare ID
(`D-023`). A replaced decision is marked superseded by its replacement, not
rewritten.

## D-001 — Editing is an action on the note, not an editor in the stream (2026-09-15)

**Decision:** the stream stays read-only. Editing is a per-note action — open
the file in a split, or append to today's note.

**Why:** live updates, collapsing and the e2e suite all follow from rendering
the Markdown ourselves.

**Rejected:** inline editors per note, as
[Daily Notes Editor](https://github.com/Quorafind/Obsidian-Daily-Notes-Editor)
does — it needs four prototype patches, which is also why its view cannot react
to vault events.

**Rejected:** no edit affordance at all — a spotted typo has nowhere to go.

## D-002 — The stream reloads on the vault's "raw" config event (2026-09-15)

**Decision:** watch the undeclared `vault.on("raw")` event, filtered to
`vault.configDir`, and rebuild the cache when Obsidian's daily-note format or
folder actually changed. Isolated in `src/obsidian-internals.ts`.

**Why:** the format decides what counts as a daily note; nothing re-read it
after `onOpen()`. No public event announces a core-plugin settings change, and
the config file is the only signal that arrives before the next vault event.

**Rejected:** polling `getDailyNoteSettings()` on a timer — a wake-up every few
seconds forever, to catch a change made once a year.

**Rejected:** re-checking on `active-leaf-change` or on the next vault event —
free, but the stream stays wrong until the user happens to do something.

## D-003 — A placeholder's height is a CSS custom property (2026-09-20)

**Decision:** `NoteWindowManager` sets `--daily-note-placeholder-height` on an
unloaded block; `styles.css` decides what to do with it. The compliance rule
against styling from JavaScript now allows `style.setProperty("--…")` and
nothing else.

**Why:** the height is whatever the note measured before it was unloaded, so no
class can carry it, and the rule is worth keeping for everything else.

**Rejected:** assigning `style.height` directly — the same inline style, minus
the one place a reader can see which declaration uses it.

**Rejected:** a fixed placeholder height for every note — the scrollbar jumps by
the difference the moment a note renders.

## D-004 — Task checkboxes are inert (2026-09-21)

**Decision:** `pointer-events: none` on a rendered task's checkbox. It shows the
file's state and refuses the click.

**Why:** `MarkdownRenderer.render` emits a real `<input>`, which the browser
toggles; only Obsidian's own reading view writes that back. Here the tick lives
in the DOM alone, and unloading or a re-render silently reverts it.

**Rejected:** writing the toggle back to the file — the stream is read-only, and
mapping a rendered element to its source line is a feature of its own.

## D-005 — The stream repeats the checkbox nudge reading view applies (2026-09-21)

**Decision:** `top: 0.2em` on a task checkbox in `styles.css`, the value
`.markdown-preview-view` sets.

**Why:** the stream renders under `markdown-rendered` alone, so the preview
pane's own layer never lands and the box sits 3px above its label.

**Rejected:** adding `markdown-preview-view` to the content element — it brings
the whole pane stylesheet, padding and line width included.

## D-006 — A list chevron spans the line box, offset by the list padding (2026-09-21)

**Decision:** the indicator takes
`height: calc(var(--line-height-normal) * 1em)` at `top: var(--list-spacing)`,
as reading view does, rather than a 16px box centered by hand.

**Why:** a line box and its text share a center, so centering on the line box
centers on the words; `top` clears the list item's padding, which absolute
positioning measures from the inside of.

**Rejected:** halving the difference between line height and icon size — it
ignores the padding and lands 1.5px high.

## D-007 — The properties panel is Obsidian's, headed like a note heading (2026-09-21)

**Decision:** the panel is Obsidian's own stylesheet, not a copy of it: the
stream renders its classes and adds only what Obsidian cannot give a read-only
panel — the key and value typography its `input` selectors miss, collapsing, the
heading's place among the note's headings, and the read-only affordances. The
heading is a sibling above `.metadata-content`, laid out as a content heading —
the same negative margin, padding and chevron offset — and collapsing hides the
box outright. Obsidian's own rules do the rest: the chevron hidden until the row
is hovered, and the row toggling on click.

**Why:** down the note, the headings form one column and their chevrons another
beside it. Obsidian's offsets assume the margin its editor pane keeps clear and
its own icon size; with them kept, the panel sat a step in from the note, and
its chevron a hair away from the word.

**Rejected:** restating Obsidian's sizing (`font-size`, row padding, key width,
icon size) — the panel drifted to 13px text in rows built for a 28px field.

**Rejected:** a gutter of its own (`margin-left: var(--size-4-6)`) — it puts
Obsidian's layout inside the note, indented past every heading around it.

**Rejected:** the heading inside the box — it reads as one more property row,
and Obsidian puts it above.

**Rejected:** chevron-only, as headings and list items are — it needs the
chevron forced visible, a control Obsidian deliberately hides.

**Rejected:** `tabindex="0"` on the heading, for keyboard reach — Obsidian rings
it on `:focus`, so a click left that ring around the row. The chevron takes
focus instead, and reveals itself on `:focus-visible`.

## D-008 — The dev loop reloads the plugin over the debugging port (2026-09-21)

**Decision:** `pnpm run dev:vault` links the build into the test vault, watches
those files, and reloads the plugin by disabling and re-enabling it over the
`--remote-debugging-port` `pnpm run open` already exposes.

**Why:** `seed` installs copies, so a rebuild never reached the vault, and
Obsidian reads a plugin's files once, at load. Linking the files fixes the
first; reloading the plugin fixes the second.

**Rejected:** the Hot Reload community plugin — the same thing from inside, at
the price of a second plugin in the vault.

**Rejected:** Cmd+R — a phone-emulated window has no such hotkey, and reloading
the window throws away the scroll position the change is usually about.

## D-009 — Emulating a device waits for the document the reload brings back (2026-09-21)

**Decision:** `emulateDevice` stamps the window before calling `emulateMobile`
and waits for a document that no longer carries the stamp.

**Why:** the reload is asynchronous and the old document answers `layoutReady`
until it lands, so waiting on that alone returned while the window was still
mid-switch — it flipped seconds after the script reported the layout it was
leaving.

**Rejected:** waiting on the reload as a navigation — same guarantee, but it
reads as page plumbing rather than as the thing being waited for.

**Rejected:** a second command that switched the open window in place instead of
relaunching — 1.6s against 3s, for one more script to learn and maintain.

## D-010 — The e2e window is hidden from inside Obsidian (2026-09-21)

**Decision:** the harness installs `show` and `focus` listeners on the window
through Electron's remote bridge, hiding the app from its own renderer. The
window no longer stays hidden: D-124 shows it again, transparent.

**Why:** Obsidian activates itself at first paint, when the vault opens, and on
the `emulateMobile` reload. A hidden app can still be frontmost, so a run stole
the keyboard for about a second at a time on a one-screen machine.

**Rejected:** the AppleScript watcher this replaces — resolving the process by
unix id blocked 1.3s, long past the first grab; watching the frontmost process
instead answered in 800ms against the guard's 100ms.

**Rejected:** patching a copy of the app bundle with `LSUIElement`, the only way
to catch the first activation — Obsidian opens its debugging port 30ms _after_
it fronts itself, so nothing outside the app can be armed in time. Not worth
copying and re-signing 1GB to save one 150ms blip per launch.

## D-011 — List properties render as Obsidian's pills (2026-09-21)

**Decision:** `tags` and other list properties render the `multi-select-pill`
markup, with `data-property-type="tags"` on a tag value so its pills take the
tag colors. A tag pill whose text is no tag name — a scalar `tags: a, b`
included — is `is-invalid`, struck through, and searches nothing, as in
Obsidian's own panel. Only `tags` is typed as tags: Obsidian 1.9.10 dropped the
singular `tag`, and draws it as text.

**Why:** the panel restates no styling of its own
([ADR 0002](adr/0002-real-obsidian-e2e.md) measures it against Obsidian's);
matching the markup was enough to get pills.

One rule is the stream's own: Obsidian pads the near side of a pill's word and
leaves the far side to the remove button's margin, so without that button the
last letter sat on the border.

**Rejected:** styling the rest of a pill in `styles.css` — every other rule is
already in Obsidian's stylesheet, and restating one is a chance to drift from
it. Splitting `tags: a, b` into two pills — Obsidian never splits a scalar, so
the stream would show tags the vault's own panel calls invalid.

## D-012 — More air around the note separator (2026-09-21)

**Decision:** 4rem above and below the rule between notes (`--size-4-16`), up
from 3rem.

**Why:** at 3rem the stream read as a stack rather than a sequence of days. 4rem
is the widest spacing that still fits two notes on a phone screen.

**Rejected:** whitespace alone — the rule is what marks where a note ends when
it ends mid-thought.

**Rejected:** 4rem/6rem, better on the desktop — on a phone the 6rem pushes the
next note under the floating navbar.

**Rejected:** a sticky date header — sticky offsets resolve against the padded
scrollport, so it pins low on the desktop and mid-air on mobile, needing an
offset read off Obsidian's own chrome.

## D-013 — A tag click opens the search pane (2026-09-21)

**Decision:** clicking a tag in the stream — inline in the note or as a pill in
the properties panel — opens Obsidian's search on `tag:#name`, through the core
global-search plugin reached by id in `src/obsidian-internals.ts`.

**Why:** a tag is a link everywhere else in Obsidian; in the stream it was
inert. No public API exposes the search pane, so the core plugin is reached by
id and a user who disabled it gets nothing rather than an error.

**Rejected:** opening the tag pane, or a filtered stream of our own — neither is
what a tag click does in the rest of the app.

A mod-click opens it in a pane of its own instead, through `Keymap.isModEvent` —
tab, split or window, as everywhere else. The core plugin only drives the
sidebar pane, so a new leaf is given the `search` view and its query set
directly.

## D-014 — Properties are shown by default (2026-09-21)

**Decision:** `showProperties` defaults to on; the setting stays.

**Why:** the panel matches Obsidian's own reading view, and a stream of notes
whose frontmatter is invisible reads as though the notes have none.

**Rejected:** dropping the setting — a vault whose dailies carry bookkeeping
frontmatter wants it off.

## D-015 — A jump lands on the nearest older note (2026-09-22)

**Decision:** `jumpToDate` loads batches until the target is in the stream, then
scrolls to it. If that day has no note, it lands on the newest note before it;
if no note is that old, it shows a notice and doesn't move.

**Why:** a continuous feed has to leave the reader somewhere real, and the
common case is a half-remembered date. Batches are cheap under
[ADR 0006](adr/0006-unload-off-screen-notes.md): what is passed over stays
placeholders. The date suggester shows the fallback before it happens; this
stays the behavior behind it.

**Rejected:** an error rather than the older note.

**Rejected:** rendering only the target — breaks the `state.notes` / `_sorted`
pagination invariant.

## D-016 — The jump re-applies its scroll until the stream stops rendering (2026-09-22)

**Decision:** up to eight passes, ending when the target is at the top of the
pane _and_ `NoteWindowManager.layoutChanges` held still across the pass — or
when a scroll moves nothing and nothing changed since the last pass. Search
centers a match the same way (`scrollIntoPlace`).

**Why:** a note above it outgrows its placeholder estimate and pushes it down.
One `scrollIntoView` left the target 1600–1850px short in e2e, desktop and
mobile. This answers the `scrollTop`-correction item in [`TODO.md`](TODO.md) for
jumps; the item stays open for scrolling in general.

**Rejected:** stopping once the target stops moving — it is at the top the
instant it is scrolled to, and the renders that displace it land after. Waiting
a frame on a stuck scroll — the hidden e2e phone window draws no frame when
nothing changed, and the search hung waiting for one.

## D-017 — Property icons come from Obsidian's type manager (2026-09-22)

**Decision:** `getPropertyIcon` takes the icon off the widget
`metadataTypeManager.getTypeInfo(key, value)` resolves; the key-name map is the
fallback when the internal goes.

**Why:** Obsidian draws the icon for the property's _type_, assigned or
inferred, so a name guess disagreed with the note's own panel everywhere but
tags — `aliases` is an arrow, text is `lucide-text`, not `file-text`.

**Rejected:** a type→icon table of our own — Obsidian's registry ships new
types.

## D-018 — The obsidian mock hands tests the real moment (2026-09-22)

**Decision:** `tests/mocks/obsidian.ts` re-exports moment, a devDependency, in
place of the hand-written stand-in. `depend/ban-dependencies` allows it for
`package.json` only.

**Why:** the stand-in ignored the format argument and understood ISO alone, so
every test of a vault dated `DD-MM-YYYY` passed while the plugin failed. The
bundle is unaffected: `obsidian` is external, and the app supplies moment.

**Rejected:** teaching the stand-in each format — reimplementing moment to test
code that calls moment.

## D-019 — The jump prompt suggests the dates the vault has (2026-09-22)

**Decision:** a `SuggestModal` over every note's date, written and matched in
the vault's own daily-note format, with `YYYY-MM-DD` as a second haystack. A
query that parses as a date no note carries is offered as one entry that says it
will land on the nearest older note. A calendar icon opens the platform's date
wheel. The date input itself lies invisibly over the icon, since iOS opens its
wheel only for a tap on the input and does nothing on `showPicker()`; a click
also calls `showPicker()`, which desktop needs.

**Why:** a date field accepts days the vault has nothing for, so the nearest-
older fallback happened silently and the reader could not tell a jump from a
miss. Suggesting the real dates makes the common case a pick, and makes the
fallback a visible choice. The format is read per vault because filenames are: a
`DD-MM-YYYY` reader should not be offered ISO.

**Rejected:** a date field with the fallback left silent — what this replaces.

**Rejected:** `prepareFuzzySearch` — fuzzy over digits matches far too loosely.

**Rejected:** keeping the date field on mobile behind `Platform.isMobile` — two
paths to hold in step before the mobile pass has said either is needed.

## D-020 — The stream does not create notes (2026-09-22)

**Decision:** no "create today's note" action in the view.

**Why:** core Daily Notes already creates it from its ribbon icon and command.
If today's note is missing, a read-only stream is showing the vault as it is.

**Rejected:** a create button above the stream when today is missing — a
duplicate of core, plus state to keep in sync across create, delete and
midnight.

## D-021 — e2e runs fully parallel on four workers (2026-09-22)

**Decision:** `fullyParallel` with `workers: 4`; an auto fixture resets plugin
settings, collapse state and the pointer before every test.

**Why:** 3.7 min → 1.2 min. Each worker already owns its instance and vault;
only state that earlier tests left in the same instance broke when the tests
were reordered.

**Rejected:** whole-file parallelism — `stream.spec.ts` holds most tests, so it
only reached 2.3 min. More workers — the instances starve for CPU and timing
tests slip.

## D-022 — Search the stream, counted per note (2026-09-23)

**Decision:** the vault's "Search current file" hotkey, read from
`hotkeyManager` on open and on each config write (a rebind saves
`hotkeys.json`), opens Obsidian's own find bar above the pane; a header action
does too, for phones. It matches each note's title and source, frontmatter
included, counts notes ("3 / 12"), and steps through the visible highlights (CSS
highlight API) note to note. Typing marks the topmost match on screen and never
scrolls.

**Why:** off-screen notes hold no DOM (ADR 0006), so find-in-page sees a few
days. A note's source and its rendered text differ, so only a count of notes
stays accurate. Obsidian searches hidden frontmatter too (checked 2026-09-23).

**Rejected:**

- Per-match count — drifts from what is highlighted.
- `<mark>` wrappers — change the DOM collapsing walks.
- Hardcoded Mod+F, or a command of our own — the first ignores a rebind; the
  second adds a hotkey.
- Jumping to the first match as you type — a half-typed word lands years away.
- A longer typing pause — 1095 notes search in 1–3 ms.
- Skipping frontmatter when properties are off — disagrees with Obsidian.
- A tag/header filter — core search does it.
- Matching the "Properties" label, as reading view does — it is in no note's
  source, and "prop" would hit every note with frontmatter.
- Highlighting what a Base, an embed or linked mentions show — that text belongs
  to another file or to Obsidian, so no note counts it, and the bar would say
  "No results" over a highlight.

## D-023 — Kebab-case files, grouped into folders (2026-09-23)

**Decision:** every `.ts` file in `src/`, `tests/` and `e2e-tests/` is
kebab-case; `src/` groups them into `ui/`, `stream/`, `render/` and `notes/`.
Class names are unchanged. `tests/repo/compliance.test.ts` enforces the case.

**Why:** Obsidian's plugin guidelines ask for folders once there is more than
one `.ts` file, and the official sample plugin and Minimal Settings name files
in kebab-case. A single case needs no judgment to follow, so a test can hold it.

**Rejected:** PascalCase for files exporting a class — nothing can check it, and
it had already drifted. A lint plugin for the rule — the compliance test already
reads every file.

## D-024 — Search opens folds, unsaved; labels what it cannot show (2026-09-23)

**Decision:** stepping onto a match inside a collapsed heading, list item or
properties panel expands it without saving; a re-render folds it again. Typing
never unfolds. A note that matches with nothing drawn (hidden frontmatter, raw
syntax) counts as `3 / 12 · hidden`.

**Why:** Obsidian's reading view does the same; landing on a note and marking
nothing reads as a bug.

**Rejected:**

- Skipping folded matches — the note is counted but shows nothing.
- Saving the expansion — a search would rewrite the reader's layout.

## D-025 — Tests typecheck against the mocks, typed by the real API (2026-09-23)

**Decision:** `tests/tsconfig.json` maps `obsidian` to the mock, as vitest's
alias does; the mock borrows its signatures from the real declarations
(`obsidian/obsidian`), so `src/` typechecks against it too. Tests reach privates
by `view["stream"]`, and stand-ins go through `fake<T>` or `asApp`, never `any`.
ESLint runs on `tests/` without the rules that guard the shipped plugin.

**Why:** typed against the mock, a test that calls something the mock lacks
fails before it runs; the real types keep the mock from drifting off the API.

**Rejected:**

- Tests against the real types — the mock-only API (`new TFile(path)`,
  `Setting.created`) would need a cast at every use.
- Turning off `no-explicit-any` for tests — it hid ~600 unchecked accesses.

## D-026 — The note cache is built from the vault, not `getAllDailyNotes()` (2026-09-23)

**Decision:** the cache keeps the vault's markdown files whose path round-trips
through the format, as a live create does.

**Why:** `getAllDailyNotes()` keys by date whatever the extension, so
`2024-01-01.png` could evict that day's note, and it admits subfolders a create
rejects. It was also the only thing in `initialize()` that could throw.

**Rejected:** filtering its result — an evicted note is already gone.

## D-027 — Stale collapse state is pruned a day after the note's last write (2026-09-23)

**Decision:** a successful render forgets saved sections the note no longer has,
once its `mtime` is 24 hours old. The properties key is kept.

**Why:** daily notes are rarely renamed or deleted, so that cleanup never ran. A
day is long enough to cover retyping a heading, and checking `mtime` needs no
timer.

**Rejected:**

- Every render — `## Mee` on the way to `## Meeting` drops its state.
- Expiry by last view — old notes keep valid state for years.
- A size cap — bounds size, not staleness.
- Frontmatter — every toggle rewrites the file.

## D-028 — Titles and links take Obsidian's link gestures (2026-09-23)

**Decision:** amends D-001. Titles and links open as Obsidian's links do:
modifier clicks, file menu, Page preview on hover. One departure: a plain click
focuses a tab already showing the note.

**Why:** Obsidian's reading view replaces its own tab; the stream can't, so the
API alone opens a new tab per click.

**Rejected:**

- A new tab per click — tabs of one note pile up.
- A pencil button per note — the title does it.
- Append to today's note — needs the inline editor D-001 rejects.
- Rename and delete in the menu — not public API.

## D-029 — The stream is a navigable view (2026-09-23)

**Decision:** `navigation = true`. The stream's own clicks still open beside it;
Obsidian's openers (quick switcher, file explorer, the daily-note command), run
from the stream, replace it in its tab, as they do the graph.

**Why:** Obsidian takes a non-navigable view for a sidebar and keeps the last
note active behind it, so the status bar showed that note's word count and
backlinks. As a navigable view, the stream has no active file, so every per-note
status bar item clears, other plugins' included.

**Rejected:**

- Overriding the leaf's `canNavigate` to keep the stream unreplaceable — patches
  an unsupported method.
- Hiding the core items with CSS while the stream has focus — core class names,
  and other plugins' items stay stale.

## D-030 — A plain click opens in the stream's tab (2026-09-23)

**Decision:** amends the two entries above. A plain click on a title or link
replaces the stream in its tab, as a link in the reading view or the graph does;
Back returns to the note the stream was scrolled to. Mod-click keeps the stream
and opens a new tab.

**Why:** the stream is a navigable view, and Obsidian's other navigable views
navigate on click. Keeping the stream open had needed a flag set around an
Obsidian call that happened to pick its tab synchronously, and a tab-reuse rule
the rest of the app lacks.

**Rejected:**

- Opening beside the stream — the departure above, and its reliance on
  Obsidian's internals.
- Reusing a tab already showing the note — not what Obsidian's links do.

## D-031 — Views share parsed dates, not the note list (2026-09-23)

**Decision:** the plugin holds one `ParsedDates`, path → date, tagged with the
daily-notes format. Each view's service builds its own list from it, parsing
only paths it has not seen.

**Why:** a date depends only on the path and the format, so an entry cannot go
stale and nothing needs to watch the vault. A later open at 6× CPU builds in 4
ms instead of 52 (10-year vault, 5,000 other notes).

**Rejected:**

- One plugin-wide list — each view's queue must own its list's changes, or
  pagination breaks (.claude/rules/invariants.md).
- A plugin-wide list kept current by vault listeners, copied per view — it does
  work while no stream is open, and keeps state that nothing displays.

## D-032 — Unloading waits for the scroll to stop (2026-09-23)

Superseded in part by [ADR 0023](adr/0023-hide-far-content-as-it-leaves.md):
hiding no longer waits; emptying still does.

**Decision:** a rendered block that leaves the unload margin waits until the
scroll has been still for `SCROLL_IDLE_MS` (300 ms); one that comes back first
stays rendered.

**Why:** on an iPhone, a third of traced flicks stalled mid-glide while unloads
ran; none did with unloading off. A glide scrolls every frame, so a pause means
it ended.

**Rejected:**

- A wider unload margin — a long scroll crosses any margin; it only delays the
  stall.
- Exact-height placeholders — unproven as the cause.
- Scrolling an element inside `.view-content` — not needed once unloads wait
  (phone-tested).

## D-033 — A Base too wide for its note draws as cards, on mobile (2026-09-24)

**Decision:** on mobile a Base follows the Markdown table rule: cards when its
table is wider than the note, re-checked when the width changes. Desktop draws
Bases as Obsidian does (ADR 0008). Each `base` block, and each `![[X.base]]`
alone on its line, renders into its own placeholder, so one Base redraws alone.
Cards come straight away when the headers alone overrun the note (Bases' header
font and padding, measured once); otherwise the table draws and is measured on
its first layout. A measured answer is kept per note and layout.

Cards are a view-only copy: Bases saves a block only through an editor, and a
save would write `type: cards` into the file. A copy of an embedded Base redraws
when its file changes. A table-drawn embed stays the real embed, and its toolbar
edits save to the `.base` file, as in reading view.

**Why:** consistency with Markdown tables. Measured cost of a redraw, 7 columns
over a 3–10 year vault: table 100 ms (205–235 at 4× CPU), cards 62–64 ms
(84–104); vault size adds under 30 ms. The estimate skips the table draw in the
common case: many columns on a narrow note.

**Rejected:**

- Cards on any phone (`Platform.isPhone`) — cards even where the table fits.
- Cards on desktop too — desktop has no stall, and a scroll bar keeps the table.
- Taller `rowHeight` rows — the table stays cramped.
- Restyling the table as cards in CSS — Bases positions rows absolutely.
- Re-rendering the whole note on a flip — redraws everything else in it too.
- Drawing every embed as a copy, so no edit saves — inline embeds and Bases in
  callouts would still save, and every copy would need redrawing on change.

## D-034 — The stream takes a note's margins from the theme (2026-09-24)

**Decision:** the pane is padded with `--file-margins`, and the stream is a
column capped at the line width inside it, as reading view lays out a note.

**Why:** the stream added 20px a side of its own on top of the theme's width, so
under Minimal (88% line width) a phone lost ~43pt a side against ~24pt in
reading view.

**Rejected:** full width on phones — wider than every other note.

## D-035 — A redrawn Base holds its last height until Bases refills it (2026-09-24)

Superseded in part by D-054: heights are no longer kept.

**Decision:** `NoteBases` keeps the height each Base last laid out at, per note,
layout and a digest of its source, and a redraw holds it as `min-height` until
the drawn view reaches it, or for 2s. A height is kept once nothing in its note
has resized for 300ms while unheld, never at unload or before a redraw: a
closing view is not laid out, and a Base left mid-fill keeps the height it had.
The heights, and which Bases were too wide, are kept across sessions in
`LayoutMemory` ([ADR 0010](adr/0010-layout-memory.md)): Back rebuilds the view,
which forgot them. They follow the notes' rule: the 4 layouts used most
recently, a rename carrying them along, a delete taking them. An earlier cap of
500 Bases kept only an eighth of a vault whose template embeds one in every
note, and keys holding whole `.base` files ran to kilobytes each.

**Why:** Bases fills a view after it is drawn. A note coming back into view, or
a table redrawn as cards, shrank by the Base's height for a few frames and grew
back; iOS has no scroll anchoring, so the text jumped and returned.

**Rejected:**

- Holding the whole block until it settles — no signal says when a note is done,
  and only Bases was measured dipping.
- Each Base waiting only on its own resizes — tried: on a phone, notes flickered
  as they scrolled back in.

## D-036 — The stream anchors its own scroll where the platform does not (2026-09-24)

Superseded in part by D-053: what is offset; and by D-090: a bounce at the top
hands over as it ends.

**Decision:** in the iOS app, and wherever
`CSS.supports("overflow-anchor", "auto")` is false, `ScrollAnchor` turns native
anchoring off, watches every block's height and offsets the change of any block
wholly above the pane: first as a `transform` on the stream, then, once the
scroll is still, as `scrollTop` in the same frame.

**Why:** a note above the reader rendering past its placeholder estimate pushed
the text down; e2e mobile, anchoring off, measured 2673px. Chromium's native
anchoring absorbs it. iOS WebKit answers `CSS.supports` yes and anchors nothing:
a phone's Web Inspector trace showed the anchor never switched on. Tried on a
phone, the shift held the place and plain `scrollTop` writes mid-glide still
jumped.

**Rejected:** writing `scrollTop` mid-glide — jumped on a phone. Correcting only
once the scroll stops — the jump shows first. Offsetting blocks that reach into
the pane too — a chevron tapped there grows the note below the reader's place,
and moving the scroll would carry that place away. Anchoring everywhere —
doubles Chromium's own correction.

## D-037 — A tap on the header title glides to the top, on mobile (2026-09-24)

**Decision:** on mobile, a tap on the view header's title smooth-scrolls the
stream to its top. `ScrollAnchor` is told first, and a glide that arrives at the
top drops what it owes instead of handing it to the scroll.

**Why:** iOS apps scroll to the top on a tap of the title bar. Notes above the
reader render on the way up; handing their growth over to the scroll stopped the
glide 23,386px short in e2e.

**Rejected:**

- Instant jump — iOS animates it.
- Desktop too — the title there is a label, and nothing hints it is tappable.

## D-038 — Text beside a block is wrapped in a span (2026-09-25)

**Decision:** after a note renders, each bare text node sharing its parent with
a block — a list item's words above its sub-list — is wrapped in
`span.daily-note-text-run`, before sections are made collapsible.

**Why:** WebKit paints no CSS highlight on such text, and no layout of the
parent changes that; iOS search marked nothing on list items with children. The
wrap happens once per render, so collapsing, keys (`textContent`) and search see
one DOM from the start — unlike the per-search `<mark>` wrappers D-022 rejects.

**Rejected:**

- A CSS layout for the item — flow-root, flex, grid, block: WebKit paints none.
- Wrapping on WebKit only — two DOM shapes, and desktop e2e would test the
  other.
- Wrapping inline elements too — WebKit paints inside them already.

## D-039 — Release tags are annotated from 1.0.0 (2026-09-25)

**Decision:** from `1.0.0` on, each release is tagged
`git tag -a <version> -m "<version>"`.

**Why:** annotated tags are the common convention for releases: they record who
tagged and when, and `git describe` and `git push --follow-tags` act on them
alone.

**Rejected:**

- Signed tags (`-s`) — no signing key is set up.

## D-040 — The stream opens in the current tab (2026-09-25)

**Decision:** the ribbon icon and `Open stream` open the stream in the current
tab, even when another tab holds one; a mod-click on the icon opens it in the
kind of pane the modifier asks for. Run from a stream, the command keeps that
stream as it was.

**Why:** the graph and canvas do exactly this, measured in the app, so the
stream opens like Obsidian's other views.

**Rejected:**

- Revealing an open stream instead — the graph opens a second one, and each view
  owns its service (.claude/rules/invariants.md), so a second is safe.
- A new tab every time — tabs pile up; the previous behavior.

## D-041 — The stream's icon is a stack of cards (2026-09-25)

**Decision:** the ribbon icon and the view's tab draw `gallery-vertical-end`.

**Why:** `calendar-days` sat in the ribbon beside core Daily notes' `calendar`
and read as the same action. A stack of cards reads as a feed, and nothing in
the core ribbon resembles it.

**Rejected:**

- `rows-3` — close to Bases' `layout-list`.
- `scroll-text`, `notebook-text`, `book-open-text` — read as one document.

## D-042 — Tests mirror the folders they test (2026-09-25)

**Decision:** `tests/` repeats `src/`'s folders; tests of `scripts/` sit in
`tests/scripts/`, checks on root files (README, manifest, styles, release
workflow) in `tests/repo/`. Mocks, setup and the shared fixture stay at the top.

**Why:** 41 files in one folder, beside a `src/` grouped by job.

**Rejected:** tests beside their source — `src/` typechecks against the real API
and `tests/` against the mocks, through separate tsconfigs.

## D-043 — Scroll to top is offered only in the stream (2026-09-25)

**Decision:** the command is in the palette only while the most recent leaf
holds a stream, and scrolls that stream.

**Why:** a freshly opened stream is already at its top, so opening one first, as
Jump to date does, would do nothing useful.

**Rejected:**

- `getActiveViewOfType` — the tests' mock `ItemView` cannot pass as a `View`,
  whose protected `onOpen` makes the type nominal.

## D-044 — A separate demo vault for screenshots (2026-09-25)

**Decision:** `seed:demo` writes `.dev/demo-vault/`, a realistic journal whose
notes are seeded by their date; `seed` stays the test vault.

**Why:** `seed`'s notes are shaped around edge cases the checklist names, and
look like scaffolding in screenshots. Seeding by date lets a recording be
retaken.

**Rejected:**

- Realistic content in `seed` — docs/TESTING.md depends on its shapes.
- Random content per run — every retake would differ.

## D-045 — The README recording is an animated PNG, built with ImageIO (2026-09-25)

Superseded by D-116: the recordings are animated WebPs.

**Decision:** the e2e harness screencasts the scene;
`scripts/frames-to-apng.swift` encodes the frames with macOS's ImageIO and
writes the APNG chunks itself, each frame only the rectangle that changed.

**Why:** an animated PNG keeps every color, so text stays crisp, and plays in
GitHub's image tags. ImageIO ships with macOS: nothing to install. Its own APNG
writer stores whole frames: a recording of typing a sentence took 8 MB that way,
and 2.5 MB as changed rectangles.

**Rejected:**

- GIF — 256 colors rough up anti-aliased text.
- MP4 — GitHub plays only videos uploaded by hand, not ones in the repo.
- ffmpeg or gifski — an install for what the OS already does.

## D-046 — A note redraws on every save, typing or not (2026-09-25)

**Decision:** the stream redraws a note on each metadataCache `changed`, even
while someone is typing in it; it catches up save by save, about two seconds
behind the editor.

**Why:** the README promises live updates, and Obsidian's own panes update as
you type. The cost of the extra redraws is unmeasured.

**Rejected:**

- Holding the redraw until typing goes quiet (`editor-change` plus a 2.5 s
  timer) — a minute of steady typing would leave the stream stale for the
  minute. Revisit if redraws are seen to jolt the stream beside an editor.

## D-047 — A build for a phone names itself on load (2026-09-25)

**Decision:** `pnpm run build:device` bakes a two-word name into the bundle as
`BUILD_LABEL`, hashed from the commit and any uncommitted change
(`scripts/build-name.mjs`); the plugin shows it in a notice on load. Plain
`build`, which releases use, bakes an empty label and shows nothing.

**Why:** iCloud syncs the plugin to the phone late and silently, so a test could
run on the previous build.

**Rejected:**

- A setting or command showing the version — the manifest version is the same
  across every test build.
- The branch, commit and time — on a phone, they would have to be compared
  character by character.

## D-048 — Back returns to its place in one scroll (2026-09-25)

**Decision:** the place kept in Obsidian's history is the note reaching into the
pane and its offset. The rebuilt view's placeholders reserve what `LayoutMemory`
remembers ([ADR 0010](adr/0010-layout-memory.md)). Back scrolls once, before the
first frame. The iOS scroll anchor is then told the place is set, so growth the
scroll already includes, reported a frame late, is not added again. Back loads
notes past the place until the pane can scroll to it; otherwise a place near the
end of what was loaded stops short.

**Why:** Back rebuilds the view from scratch. At estimated heights, each render
pushed the place and each correction was drawn: the newest note flashed on
desktop, older ones on a phone.

**Rejected:**

- Hiding the stream until it settles — up to a second blank on a phone.
- Opening titles in a new tab so the stream survives — Back stops returning to
  it.
- Heights carried in the place — superseded by ADR 0010, which keeps them for
  every view and session.
- Note heights alone, without what Bases measured — a Base inside a note still
  draws empty and refills, whatever height its note reserved. (Superseded by
  D-054.)

## D-049 — A note's height is remembered once it settles (2026-09-25)

**Decision:** a rendered note's height goes into `LayoutMemory` once nothing in
it has resized for 300ms, as a Base's does. An unload reserves what the note
measures then, remembering it only if it had settled.

**Why:** a Base filling or an image loading measures short until done. If that
short height were saved, it would be the next session's placeholder, and the
growth would become a scroll the anchor owes.

**Rejected:** saving on scroll stop, Back and refresh — each measured whatever
was on screen, mid-fill included.

## D-050 — The pane keeps a scroll bar's room while it cannot scroll (2026-09-25)

**Decision:** the stream's pane sets `scrollbar-gutter: stable`.

**Why:** heights are remembered by the column's width
([ADR 0010](adr/0010-layout-memory.md)). With classic scroll bars (macOS with a
mouse, Windows), a stream opening empty read a width 15px wider than the one its
notes were measured at, and reserved no remembered height.

**Rejected:** leaving the scroll bar out of the layout key — it narrows the
text, so heights measured with and without it differ.

## D-051 — The mobile e2e project is an iPhone Pro's screen (2026-09-26)

**Decision:** the phone viewport is 402 × 874, an iPhone Pro's screen in points.

**Why:** the README's phone screenshots should show a phone's layout. At 402 px,
Bases measures as it does on an iPhone 16 Pro: two cards per row, 187 px wide in
Obsidian's reading view (2026-10-05).

**Rejected:**

- The old 420 × 800 — no phone's screen.
- A Pro Max's 440 — rejected at the time for fitting two cards, based on the
  reading corrected below.

Corrected 2026-10-05: this said a phone shows one card per row. It shows two, in
Obsidian's reading view and in the stream.

## D-052 — A wide equation shrinks to fit on mobile (2026-09-26)

**Decision:** on mobile, a display equation wider than its note is zoomed down
to the note's width (`src/render/wide-equations.ts`).

**Why:** the page may not scroll sideways, and nothing in a note may scroll (ADR
0008). MathJax draws HTML, which CSS cannot scale to fit, so it is measured.

**Rejected:**

- `overflow: clip`, as code blocks do — cuts off the end of the equation.
- Inline math — it sits in a line of text; shrinking it there would change the
  line's text size mid-sentence.

Updated 2026-10-07: MathJax 4 (Obsidian 1.14) pads the container 2px each side,
so the equation fits inside the padding.

## D-053 — The scroll anchor is the element at the pane's top (2026-09-26)

**Decision:** where `ScrollAnchor` runs, it offsets the stream by however far
the element at the pane's top moved. It picks that element again on each scroll
and each hand-over, with `elementsFromPoint`, walking up to the element's block;
when no part of the stream is at that point, it finds the block by halving the
list of blocks.

- The walk stops at anything held — a held note's text is not yet where Back
  measured the place.
- Before each new pick, it records what moved as owed — a note rendering between
  frames reaches the scroll event before its resize report.
- If the element is replaced, the anchor falls back to its block.

**Why:** a Base filling in above the pane, in a note that reaches into the pane,
pushed the text down: only notes wholly above the pane were offset. Nothing
above the pane's top is the reader's doing; a chevron tapped on screen changes
only what is below.

**Rejected:**

- Holding a Base's growth — the same move happens later, with rows cut off
  meanwhile.
- Walking down the note — reads every paragraph on each scroll frame.
- `IntersectionObserver` — reports a frame late.

## D-054 — Notes and Bases are held until they settle (2026-09-26)

**Decision:** each is held at `min-height` until nothing in it resizes for
300ms, and 2s at most:

- a rendered note at a height it measured before (remembered, or shown before a
  re-render), never a guess. A touch releases it, so a collapse shows at once.
- a Base at the height it showed, when it is redrawn or when it shrinks by
  itself (a live Bases refresh). It grows without a hold.

Base heights are no longer stored: a Base coming back is held by its note.

**Why:** the settle wait is the signal holding whole notes lacked (D-035), and
it covers every late fill, so per-Base heights were a second cache.

**Rejected:**

- Holding at a guessed height — a short note shows a gap.
- A note-level hold alone — a live Bases refresh dips inside a note on screen.

## D-055 — A new width changes no placeholder (2026-09-26)

Superseded in part by ADR 0014: placeholders are re-reserved once the scroll is
still. The anchor still survives the margins' rebuild.

**Decision:** on a width change, an unloaded note keeps its placeholder until it
renders; only the height it is held at on rendering comes from the new width.
The scroll anchor survives the margins' rebuild.

**Why:** shrinking placeholders shortens the stream under the scroll. The
browser clamps the scroll at once, `ScrollAnchor` counts the clamp as the
reader's own scroll, and a phone turned mid-stream landed several notes away. An
anchor rebuilt along with the margins has no place to hold while the notes on
screen reflow: the reader's place moved 120 px.

**Rejected:**

- Re-reserving every unloaded note — the clamp above.
- Only those above the pane — the browser clamps once they shrink by more than
  the content below the pane.

## D-056 — A Base redrawn under the pane's top keeps the reader's fraction (2026-09-27)

**Decision:** when the pane's top crosses a Base, `ScrollAnchor` keeps the
reader the same fraction of the way through the Base, not at the Base's top. The
fraction is of what the Base draws, not of the box held open for it. A scroll
pulled back to the stream's end is a clamp, not the reader's own scroll.

**Why:** a turned phone redraws cards as a table: the entry being read is gone,
and held at the Base's top the reader landed anywhere. Cards and rows share one
order, so the fraction carries over. Below a note the reader had jumped to, the
stream shrank by more than the content below the pane, and the anchor undid the
clamp as if the reader had scrolled.

**Rejected:**

- Holding the same entry, from card to row — Bases fills the table after drawing
  it.
- Holding the Base's top at the pane's top — the reader loses their place in the
  Base.
- A fraction of the held box — the table fills the box's top, and the reader sat
  in the blank below until the hold was released.

## D-057 — A reflow holds the block starting in the pane (2026-09-27)

**Decision:** once the pane's width changes, `ScrollAnchor` holds the first
block that starts inside the pane, below the text crossing the pane's top, until
the shift is handed to the scroll. It skips inline text, anything beside that
text, and anything that takes no space. Otherwise it holds the text crossing the
top, as before. A Base crossing the top is held by its fraction either way,
never by what it draws. The anchor keeps the place it read before the width
changed: it measures that place again each frame, but picks no new place until
the shift is handed over.

**Why:** a turned phone reflows the text crossing the top, and holding its top
moved a title just below it out of view. Native anchoring prefers what is fully
visible for the same reason.

**Rejected:**

- Always holding the block that starts in the pane — a chevron tapped in the
  text above it would scroll away.
- The next element in document order — often a span in the reflowing text, and
  dozens of reads in a highlighted code block.
- Only the first report after the width changes — the text reflows over several
  frames.
- A card, or a heading below a Base — on a phone the cards re-flow before the
  Base is redrawn, and a card's place says nothing of the reader's.
- Re-reading the place each frame — mid-turn, the place read was a Base emptied
  for its redraw, then the Base's note, whose top never moved as the Base
  shrank.

## D-058 — A search holds its match while the Bases around it fill in (2026-09-27)

**Decision:** once centered, a match is re-centered whenever the stream, or
anything above the match in its note, resizes, until it is still for `SETTLE_MS`
or the reader touches or wheels the pane (`keepInPlace`,
`src/stream/scroll-position.ts`). A note remembered at its height is held there,
so a Base filling in inside it resizes nothing outside it.

**Why:** Bases fill in after the note renders, which `scrollIntoPlace` does not
count; a Base above the match pushed the match off screen, leaving the reader on
the Base.

**Rejected:**

- Counting Base fills as layout changes — `scrollIntoPlace` would wait on them,
  and every step with it.
- Scroll anchoring — it holds the note's top, not the match.
- Checking the match's place each frame — a change made after that frame's
  `requestAnimationFrame` callback is painted with the match off screen for a
  frame; a resize report comes before paint.

## D-059 — A Base's header and summaries scroll with it, on mobile (2026-09-27)

**Decision:** on mobile, a Base table's header is `position: static` and its
summary row `bottom: auto`, sticky with no inset (`styles.css`, D-153).

**Why:** Bases pins both to its own scroll box. ADR 0008 clips that box away, so
they pinned to the stream's instead and floated over the notes.

**Rejected:**

- Leaving them pinned to the stream — they cover other notes' text.
- Giving the Base its scroll box back — ADR 0008.

## D-060 — Submission rules live in ESLint where a rule can say them (2026-09-27)

**Decision:** `eslint.config.mts` enforces the submission rules a lint rule can
express, `manifest.json` included; `tests/repo/compliance.test.ts` keeps only
the rest (file names, the license, an error's prefix, sentence case).

**Why:** a lint rule reads the syntax, whereas a test's regex matched comments
too, and the editor shows a lint error as it is typed.

**Rejected:**

- Both — two places to update, one failing after the other.
- Tests only — they grep text and fail only when the suite runs.

## D-061 — Linked mentions are the stream's own, on the public API (2026-09-28)

**Decision:** each note ends with a footer built from `resolvedLinks`, inverted
once per `resolved` by a plugin-wide `BacklinkIndex`
(`src/render/linked-mentions.ts`). Unlinked mentions are deferred.

**Why:** our footer knows when it has drawn, so the note's height can be held
until then; it needs no internals.

**Rejected:**

- Hosting Obsidian's internal backlinks component — brings Better Search Views
  and unlinked mentions, but fills on its own schedule and is reached only
  through internals.
- Scanning every source's links per rendered note — the index answers from one
  pass.

## D-062 — A render never waits on its footer; the height hold does (2026-09-28)

**Decision:** `renderInto` returns with the footer still reading its sources.
`NoteWindow` keeps the note's `HeightHold` until the footer resolves, then
settles as before. The footer redraws itself on `resolved`, per note, until the
note unloads.

**Why:** the render queue also applies vault events, and a footer reads other
notes; settling before it draws let a returning note dip, which jumps on iOS.

**Rejected:**

- Awaiting the footer in the queue — every render and vault event waits on other
  notes' reads.
- Queuing footer redraws through the view (ADR 0004) — a footer touches no
  stream state, and unloading its note already stops it.

## D-063 — The demo vault is the default; the test vault takes `--test` (2026-09-28)

**Decision:** `seed`, `open` and `demo` act on `.dev/demo-vault/`, and on
`.dev/vault/` with `--test` (`scripts/vaults.mjs`).

**Why:** the demo vault is the one used day to day; the test vault is for the
checklist's edge cases.

**Rejected:**

- Separate `seed:demo` and `seed:test` scripts — `open` and `demo` would need a
  pair each; one flag reads the same on all three.

## D-064 — One command opens a vault and keeps it current (2026-09-28)

**Decision:** `pnpm run demo` builds if there is no build, reseeds the vault,
links the build in, opens the window and reloads the plugin on every save
(`scripts/dev-vault.mjs`). It replaces `dev:vault`, `open` and `reload`, which
had to be run in the right order. The seed scripts still install a copy of the
build: the phone's iCloud vault needs files, not links.

**Why:** the edit-reload loop took three commands in the right order. The vaults
are disposable, so a reseed each run costs nothing and keeps their notes current
with the seed script and the date.

**Rejected:**

- Seeding only when the seed script or the date changed — it would need a
  fingerprint, only to protect notes nobody keeps.
- Keeping `dev:vault`, `open` and `reload` beside it — four commands for one
  loop.

## D-065 — The demo vault deals its lines from decks (2026-09-28)

**Decision:** each list of lines is a deck, shuffled per pass and dealt by day
or week, so no line returns until its deck is spent, nor within three days
across a reshuffle. Each week has one piece of news, told once and recalled on
Sunday. The default run is 90 days.

**Why:** independent picks put one line in 16 of 60 notes, some on consecutive
days, and repeated one-off events.

**Rejected:**

- Longer lists alone — picks still cluster.
- Tracking what earlier days used — a date's note would depend on the run.

## D-066 — The search action draws `text-search` (2026-09-28)

**Decision:** the header's Search action is lines of text with a magnifier.

**Why:** on a phone Obsidian's own search, a plain magnifier, sits in the navbar
right under the header; one icon for two searches reads as a duplicate.

**Rejected:**

- Search in the ⋯ menu, where Obsidian keeps Find — it costs a second tap on the
  phone.
- `text-search` on mobile only — a platform branch for an icon.
- `scan-search`, a magnifier in a viewfinder — is recognized as search faster,
  but says less about what it searches.

## D-067 — Search reads through `cachedRead`, with no cache of its own (2026-09-28)

**Decision:** stream search keeps reading every note per query and refresh.

**Why:** across 1,095 notes (`pnpm run test:memory`), with the CPU slowed 4x to
a phone's: the first query after open reads every note, 585–707 ms; later
queries and a refresh after an edit, 5 ms. So `cachedRead` answers from memory
once warm and sees the edit. A cache of our own would be as cold on open. Its
docs promise only "better performance", so the timing test is the guard.

**Rejected:**

- A source cache per path, invalidated on `modify` — duplicates Obsidian's.
- Dropping a search once a newer one replaces it — at 5 ms there is nothing to
  save.

## D-068 — Bases and wide content stay in the render (2026-09-28)

**Decision:** on mobile a render still awaits each Base, then measures its
tables and equations in place.

**Why:** scrolling 40 notes, each embedding a Base over 1,825 notes plus
equations and a wide table (`e2e-tests/render-cost.spec.ts`, CPU slowed 4x to a
phone's, on an M5, in the on-screen window of D-124): a Base held the queue 19
ms median, 29–74 ms at most; the plugin forced 797–857 layouts, 266–290 ms in
all, about 7 ms a note. The spec's budgets are about twice these.

**Rejected:**

- Bases off the queue, held by a `HeightHold` — saves 16 ms a Base, at the cost
  of a hold per Base.
- Batching width reads in one `requestAnimationFrame` — at most 1 ms of layout a
  note (2026-10): with them stubbed out, the plugin forced 80 ms less over 40
  notes but all layout fell by only 40 ms, the rest moving to the next frame.

## D-069 — A first open parses every date in one task (2026-09-28)

**Decision:** `buildSorted` keeps parsing every markdown file's name at once.

**Why:** over 4,096 files, 1,095 of them daily notes, with the CPU slowed 4x to
a phone's (`pnpm run test:memory`): the cold parse takes 17–20 ms, 30–36 ms with
no daily-notes folder set; from open to the first note, 50–88 ms. The parse is
under the 50 ms that makes a task long.

**Rejected:**

- Parsing in chunks, yielding between — splits a task that is not long.

## D-070 — Prettier wraps Markdown at 80 (2026-09-29)

**Decision:** Prettier formats every `*.md` with `proseWrap: "always"` at 80,
the width Prettier and markdownlint default to. `AGENTS.md` stays ignored: it is
the sample plugin's copy, verbatim.

**Why:** hand-wrapped docs drifted to two widths, about 80 in `DECISIONS.md` and
the ADRs, about 120 elsewhere, and nothing checked either.

**Rejected:**

- 120, the code's width — prose past 80 reads poorly in a terminal or
  side-by-side diff.
- Hand-wrapping at a written width — a rule nothing enforces drifts again.
- `proseWrap: "never"`, a line per paragraph — diffs a whole paragraph for one
  word.

## D-071 — A failure degrades one thing, and is logged (2026-09-28)

**Decision:** every async entry point and every localStorage save catches, logs
to the console, and carries on: a note that will not render says so, a read that
fails shows its note, a refused save is logged once (`saveLoggingOnce`), stored
state that does not parse counts as none, a list that fails to build lists
nothing until the next refresh. Only a failed jump raises a Notice.

**Why:** a stream is many notes; one bad one, or a full localStorage, must not
blank the rest. Failing open may show too much, but never hides anything
written.

**Rejected:**

- A Notice per failure — a full localStorage refuses every later save, so the
  notices would never stop.
- Failing closed (hiding what could not be checked) — writing vanishes silently.

## D-072 — Empty-note verdicts are cached per device, trusted by mtime (2026-09-28)

**Decision:** `EmptyNotes`, one per plugin, keeps each path's verdict keyed by
`mtime`, filled before the first batch and updated on `metadataCache` `changed`.
Only notes no bigger than the template plus 1 KB are read. It saves, in the
vault's localStorage on this device, the template it checked against, when its
last check of every note began, and each empty note's `mtime`. The next session
trusts any note unchanged since that check: empty if it was saved with that
`mtime`, otherwise written. A note that fails to read shows, and is read again
on the next check; a check that left any note unread saves nothing.

**Why:** a first open reads only the candidates, and a later open only what
changed. A written note costs nothing to save, an empty one about 40 bytes. A
note emptied on another device, synced with an `mtime` older than the last
check, shows until it next changes.

**Rejected:**

- Reading every note — thousands of reads at open for a few hundred candidates.
- Saving every note's verdict — the check's start time vouches for the written
  ones.
- Trusting a saved empty note by the check's start time — a synced edit can
  carry an older `mtime`, and a written note would stay hidden.
- Capping concurrent reads — on an iPhone 16 Pro, 1,095 cold reads at once take
  344–398 ms with no frame over 15 ms; 8 or 32 at a time is no faster.

## D-073 — Views re-check only the notes whose incoming links changed (2026-09-28)

**Decision:** `LinkChanges`, one per plugin, compares each note's links into the
daily-notes folder on every `resolve` and, once `resolved`, has each view
re-check the notes that gained or lost one (ADR 0011: a linked empty note
shows).

**Why:** a link made or removed shows or hides its target without reopening the
stream. A stream open at launch hides a linked empty note until the links
resolve, then shows it.

**Rejected:**

- Re-checking every hidden note on `resolved` — the service must track what it
  hid, for the same answer.
- Checking backlinks only at open — a new link waits for the next open.

## D-074 — A setting that changes what is listed keeps the reader's place (2026-09-29)

**Decision:** toggling Hide empty notes or Show linked mentions reloads the
stream, then returns to the note being read. When that note is now hidden, the
reader lands at the top of the next older note; with none older, at the end of
the stream. Only a stream with no notes left starts at the top.

**Why:** the next older note is what the reader was scrolling towards, and the
end is nearest when nothing older is left.

**Rejected:**

- Back to the top — what a reload did; it throws the reader years away.
- The next newer note — it is behind the reader, above where they were.

## D-078 — Settings are grouped under headings; a hidden section drops its collapse toggle (2026-09-30)

Superseded in part by D-114: groups, not heading rows; no redraw.

**Decision:** the settings tab puts Properties and Linked mentions under
`Setting.setHeading()` rows, Hide empty notes above them. A section's "Collapse
by default" is drawn only while its "Show" toggle is on; that toggle redraws the
tab.

**Why:** each collapse toggle means nothing without its show toggle, and a flat
list did not say so.

**Rejected:**

- `SettingGroup` cards — needs `minAppVersion` 1.11.0, up from 1.8.7.
- Disabling the collapse toggle — a greyed row still reads as a choice.

## D-079 — A placeholder never measured here is estimated from its text (2026-09-30)

Superseded by D-092.

**Decision:** a note with no height stored at the layout reserves the first of
these that applies:

- its height at the nearest width of the same text size, plus the change in its
  wrapped lines × line height;
- else the template's measured height here, plus its lines beyond the template's
  × a per-line rate learned from text-only notes, plus its embeds × a per-embed
  height learned at this layout (the pane's height until one is learned);
- else the layout's median. Lines come from the metadata cache, so adding a
  block stays synchronous. Benchmark: `e2e-tests/estimates.spec.ts`, scored by
  `scripts/score-estimates.mjs`.

**Why:** a turn changes a text note only by re-wrapping it, and every note is
its template plus writing (ADR 0011). After a turn, mean error for text notes
falls from 85px (the other width's height) to 18px; for notes never measured,
from ~330px (a fixed 400px) to ~50px.

**Rejected:**

- The template's height alone — a floor, 443–624px short on average.
- A fixed buffer per embed — no one value fits Bases drawn as cards in portrait
  and tables in landscape.
- Heights stored per Base — a vault's Bases differ, and one Base's height varies
  with what it draws.

## D-080 — A turned note's Bases change by what the same Base changed elsewhere (2026-10-01)

Superseded by D-092.

**Decision:** a note estimated from its height at another width (D-079) adds,
per Base it embeds, the median change per Base, beyond re-wrapped text, of other
notes embedding that Base and measured at both widths. If no such note is
measured at both widths, it adds nothing.

**Why:** only a Base switching between table and cards changes much on a turn
(up to ~1400px), and the same Base switches the same way in every note. Embed
error after a turn: 378px → 35px.

**Rejected:**

- One change per embed, or per Base — images barely change, and Bases differ: a
  single median comes out near zero, or half of what a switching Base changes.
- Adjusting only Bases flagged too wide (`BaseMeasurements`) — known per note
  only once drawn at the new width; learning per Base gets there without it.

## D-081 — Turned wider, an unlearned Base's note is estimated from its template (2026-10-01)

Superseded by D-092.

**Decision:** a note measured only at a narrower width, embedding a Base whose
change D-080 has not learned, is estimated from the template and its lines
(D-079's fallback) once the template has been measured at this layout; until
then, as D-080 says.

**Why:** cards at the narrower width may be a table here, up to ~1,400px
shorter, and until a note with that Base settles at both widths nothing says so.
Demo journal, Base notes turned to landscape: mean error 782px → 224px, worst
overestimate 1,408px → 353px.

**Rejected:**

- Also turned narrower — a table there may become cards here, but the template's
  estimate overshoots notes whose Base does not, by up to 1,131px.
- Only Bases flagged too wide at the old width (`BaseMeasurements`) — a Base
  predicted too wide from its headers draws as cards without a flag.

## D-082 — A jump or search step draws its note whole before scrolling (2026-10-01)

**Decision:** the target note renders off screen and waits for its Bases'
queries (`is-loading` cleared, a frame on, at most `BASES_LOAD_LIMIT_MS`), then
the scroll goes once: a jump to its top, a step to the match (`basesLoaded`,
`NoteStream.ready`).

**Why:** when the scroll came first, a Base showed "0 results", then filled in,
on screen; a step also painted the note's top for two frames before centering.

**Rejected:**

- Hiding a Base until it fills — blank space, then cards popping in.
- Remembering each Base's height — the space is right, the "0 results" bar still
  shows.
- Readying the notes around it too — the Bases that matter sit in the match's
  own note; the neighbours render as they do on any scroll.

## D-083 — On mobile a PDF embed is its first page, opened by a tap (2026-10-01)

**Decision:** under `.is-mobile` a PDF embed is clipped like a Base, its toolbar
hidden, and a tap anywhere on it opens the PDF at the embed's page, through the
link handlers (`NoteRenderer.linkAt`). An iframe is capped at the note's width,
everywhere.

**Why:** once clipped, Obsidian's viewer shows page 1, and its toolbar can reach
no other page; a pasted video embed's fixed width scrolled the page sideways on
a phone.

**Rejected:**

- Every page at full height — a long PDF becomes the whole stream.
- Obsidian's file card (icon and name) — loses the page a reader recognizes.
- Leaving the viewer live — a scroll box, which ends an iOS glide (ADR 0008).

## D-084 — Dataview's queries are clipped and stacked like the note's own (2026-10-01)

**Decision:**

- On mobile the stylesheet clips Dataview's blocks, which Dataview's own
  stylesheet makes scroll.
- `stackWideTables` stacks a table whenever one is added or filled in, not only
  at render.
- e2e runs a pinned Dataview release, fetched once into `.dev/`
  (`e2e-tests/dataview.ts`).

**Why:** Dataview draws after the note renders, over several passes; its wide
tables were clipped, not stacked, and each block was a scroll box until the
guard caught it at rest.

**Rejected:**

- The scroll box guard alone — it clips once the scroll is still, so a block
  drawn mid-glide scrolls for that glide.
- A stand-in plugin drawing late tables in e2e — proves nothing about Dataview's
  own stylesheet or render passes.
- Dataview committed to the repo — 2.3 MB of someone else's build.

## D-085 — No equation gets a layer of its own (2026-10-02)

**Decision:** the stylesheet sets `will-change: auto` on every `mjx-container`
in the stream, undoing MathJax 3's WebKit-only `will-change: opacity`.

**Why:** with the layers, an iPhone stopped 34 of 58 flicks dead within 0.4 s,
whether the math sat in a table or in a line of text; without them, 0 of 30, as
with no math at all. MathJax added the rule for a 2020 pinch-zoom flicker
([MathJax#2435](https://github.com/mathjax/MathJax/issues/2435)) and dropped it
in v4 as unneeded; Obsidian ships v3.

**Rejected:**

- Keeping MathJax's fonts in use — the fonts were never dropped; 28 of 54 still
  stopped.
- Overriding at MathJax's own specificity — its stylesheet comes later and wins.

Superseded 2026-10-07: Obsidian 1.14 ships MathJax 4, which sets no
`will-change`, and the plugin needs 1.14 (D-100). The rule is gone; the WebKit
check stays, against MathJax bringing the layers back.

## D-086 — The iPhone harness leaves Auto-Lock to the tester (2026-10-02)

**Decision:** `test:ios` changes no setting on the phone. `docs/TESTING.md` says
when to set Auto-Lock to Never and back.

**Why:** a run takes under a minute, and a locked phone fails setup at once.
Only many runs in a row need the phone kept awake, and setting that on someone's
phone for them left it never locking if they forgot `pnpm run ios:release`.

**Rejected:**

- Setting Never through the Settings app, held until `pnpm run ios:release` — it
  navigated Settings pages that hold Delete buttons, failed under Low Power Mode
  and on an iPad, and cost ~18 s a session.

## D-087 — On mobile a frame loads its page once the scroll is still (2026-10-03)

**Decision:** `FrameDeferral` takes the `src` off each iframe a note renders,
from a mutation observer, and puts it back once the scroll has been still for
`SCROLL_IDLE_MS`. Meanwhile the frame is shaded as a placeholder.

**Why:** a YouTube frame rendering mid-glide stopped 10–13 of 20 iPhone flicks
dead. With its `src` held back, 0 of 20; a page already loading when a flick
starts stops none. The same frame on `about:blank`, or a box its size, stops
none: starting the page is what ends the glide.

**Rejected:**

- `scrolling="no"` on the frame — 8 of 20 still stopped.
- A tap to load every frame, like the PDF (D-083) — hides a page that can work
  in place. YouTube's player fails in the app, so it is a thumbnail (D-088).
- Rewriting `src` in the Markdown before rendering — a code block showing an
  iframe would show the rewrite.

## D-088 — On mobile a YouTube embed is its thumbnail, a link to the video (2026-10-03)

**Decision:** on mobile `FrameDeferral` swaps a YouTube embed's frame for
`youtubeThumbnail`: the video's thumbnail under the play button of YouTube's
player, in the player's box, linking to the video at the embed's start. The
thumbnail is the 1,280 px one, else the 480 px one every video has. Desktop
keeps the player.

**Why:** in the iOS app the player shows only "Error 153", and a frame held back
(D-087) is a grey box that names nothing. A tap opens YouTube, or its app. The
thumbnail is an image: 0 of 20 flicks stopped over it.

**Rejected:**

- The grey placeholder, then the player once still — the player fails anyway.
- A labelled wrapper over the held frame — more DOM, and still a player that
  fails.
- A still with YouTube's button drawn in — YouTube serves none; its stills and
  oEmbed are plain.
- The 480 px thumbnail alone — stretched 2.2x across a phone's 3x screen, it
  looks blurred.

## D-089 — On mobile a Base's cards and header line up with the note's text (2026-10-03)

**Decision:** under `.is-mobile`, a cards view keeps 1px of
`--bases-view-padding` each side, for the cards' ring, and the header cancels
its own padding and its first button's, so card borders and the first icon line
up with the text's edges.

**Why:** Bases insets cards 12px and the icon 6px inside a note's text column,
which reads as a stray margin under a heading.

**Rejected:**

- Edge to edge, as Obsidian's reading view draws a Base — past the text column
  on both sides, unlike everything else in the stream's notes.

## D-090 — A glide's bounce at the top hands over as it ends (2026-10-03)

**Decision:** after the scroll goes past the top, `ScrollAnchor.onScroll` hands
what it owes to the scroll at the first scroll event back at or below the top,
instead of waiting for the scroll to be still for `SCROLL_IDLE_MS`.

**Why:** a glide up past notes that render taller than reserved runs out of
scroll first, and bounces at the top still owing their growth (ADR 0010). On a
phone the hand-over came 328 ms after the bounce; a flick made meanwhile hit the
same top and put the hand-over off again. A bounce ends the glide anyway, so the
scroll write cuts no glide short.

**Rejected:**

- Handing over as the glide reaches the top — iOS undid the write the next
  frame, mid-bounce: the stream jumped 3,000 px.

## D-091 — A glide stops at the stream's top while the stream is drawn shifted (2026-10-03)

**Decision:** while `ScrollAnchor` owes a shrink, a scroll that will bring the
stream's top into the pane within two more steps the size of its last one writes
the scroll to the top and drops the shift, freezing the pane for that frame
(`is-scroll-frozen`, `overflow: hidden`): the glide stops with the newest note
at the top. A clamp to the stream's end does not count as a step.

**Why:** when notes above render shorter than reserved, the scroll has more room
left than there is content above. The glide reached the newest note with room to
spare and went on into blank: 1.7–4.6k px in the iPhone harness. iOS carries a
glide on past a scroll write, undoing the write the next frame; with nothing
left to scroll, the glide ends. The first version, merged without the freeze,
let the newest note jump 1.5–1.7k px back after the write; its test checked only
for blank. Stopping only on arrival, a recording showed the top drawn ~65 px too
far for a frame, then back: iOS draws a frame before the page hears of the
scroll. Stopping one step ahead still went 43 px too far when a dropped frame
doubled the step.

**Rejected:**

- The write alone — iOS undid it the next frame, whatever it wrote: 0, a value
  mid-range, or with the shift added or dropped.
- Handing over once still — the blank is on screen until then.

## D-092 — A note never measured reserves the 0.9 quantile of those measured (2026-10-04)

**Decision:** a note with no height stored at the layout reserves the 0.9
quantile of the heights stored there. Where nothing is stored, it keeps what it
already reserves: after a turn, its height at the old width; if never measured,
two panes. Storing a height schedules the re-reserve at the next rest (ADR
0014), so after a turn or on opening, the notes on screen supply the heights
within moments. It replaces D-079–D-081's estimates from each note's text,
template and Bases.

**Why:** an estimate matters only off the common path: after a jump, search,
Back or turn, when gliding up through notes not yet drawn; scrolling down from
the top measures every note before it is passed. There, too tall is safe, as
D-091 stops the glide on the newest note; too short costs one more flick
(D-090). Its only input is the vault's own notes, so nothing is fitted to a
journal we made up.

**Rejected:**

- D-079–D-081's per-note estimates, made to err tall — each rule, per Base and
  per kind of embed, held only on our generated journals and was never tested
  beyond them.
- The upper quartile — on those journals, a third to half of a week's runs of
  notes came out short in portrait.
- A buffer above the newest note — room above can change only at rest: a scroll
  write mid-glide is undone or ends the glide (D-090, D-091).
- The nearest width's quantile, scaled by the widths — the notes on screen are
  measured at the new width within moments of a turn.
- A fixed 400px before anything is measured — the notes ADR 0006 measured ran
  ~709px.

## D-093 — No file menu from a long-press on a note's title on iOS (2026-10-05)

**Decision:** the note menu opens on right-click only. On iOS a long-press on a
title selects its text; a tap opens the note, whose own menu holds the same file
actions.

**Why:** iOS fires no `contextmenu` on a long-press; Obsidian synthesizes one
only for elements its drag manager handles. The menu adds a shortcut, not an
action, and a touch listener on the stream sits in the path of glides, which are
what breaks most often on iOS.

**Rejected:**

- Our own long-press — a timer that must tell a press from the start of a flick,
  and the title's text selection suppressed.
- Registering titles with Obsidian's drag manager — private API.

## D-094 — One width observer per view; the anchor keeps its own (2026-10-05)

**Decision:** tables, equations and Bases hear a note's width change through one
`ResizeObserver` per view (`note-widths.ts`), not one each per rendered note.
`NoteWindowManager` and `ScrollAnchor` keep an observer each.

**Why:** the three width observers were one piece of code written three times,
waking on every height change to find the width the same. A screen of notes on a
phone ran ~24 observers; it now runs ~6. The pin and the anchor watch different
sets — every block for the anchor, rendered ones for the pin — so one observer
would need counts of who watches what.

**Rejected:**

- One observer for the pin and the anchor — saves one observer per view, at the
  cost of rewriting the anchor's tests and sharing bookkeeping in ADR 0013's
  code.

## D-095 — ResizeObserver callbacks never resize what was observed (2026-10-05)

**Decision:**

- A pinned block is not observed. A pinned block is a rendered note held at a
  fixed height (ADR 0013); its height changes only in `repin`, which tells the
  scroll anchor directly. The anchor observes a block only while it is unpinned.
- A Base is held at the tallest height it has had since it was first laid out. A
  shrink is then already covered by the hold, so nothing has to be resized in a
  callback. The Base's callback only raises the hold. A timer releases the hold
  once the Base stops changing, or after `HOLD_LIMIT_MS`.
- When a Base must be redrawn because its width changed or Bases reported its
  layout, it is redrawn in the next task, not in the callback.

Superseded in part by D-159: a Base's box now has a fixed height, and grows in
the next task instead of in its callback.

**Why:** WebKit logs "ResizeObserver loop completed with undelivered
notifications" as an error when a ResizeObserver callback resizes an element
that is no deeper in the page than the shallowest element already reported in
that round. Each of the cases above did that, on a flick or when the phone
turned. The late size report did no harm; the logged error was the only cost.

**Rejected:**

- Ignoring the error in the iPhone tests' console check — the error is the
  plugin's own, and it came on every scroll.
- Re-pinning a frame later — the block's height would change without the anchor
  being told in the same task, which breaks ADR 0013.
- `requestAnimationFrame` for the redraws — it never runs in the e2e tests'
  hidden window.

## D-096 — No Android pass before a release (2026-10-05)

**Decision:** releases are checked on desktop e2e and a real iPhone only.
Android stays supported, held to the iOS rules (ADR 0008).

**Why:** Android's WebView is Chromium, the engine both e2e projects run. What
e2e cannot see is a native widget, such as the date wheel, and those are
Android's own.

**Rejected:**

- An emulator driven by Appium — a second device harness for an engine e2e
  already runs.
- A manual pass — no device, and a check nobody runs is no check.

## D-097 — On mobile a Base's toolbar has no New button (2026-10-05)

**Decision:** under `.is-mobile`, a Base's New button is hidden. The view name
and result count shrink to an ellipsis as in Obsidian, which the stream's
`overflow: clip` had stopped (ADR 0008).

**Why:** a Base in the stream is the text's width, 354px on a phone against
Obsidian's 402px edge to edge (D-089), so the toolbar overran by up to 41px: New
was cut off, and shrinking alone left "Resized" as "R…". Without New it reads
"Resiz…", and a short name, such as "Books", shows whole with its count. New
creates `Untitled.md` on one tap, with no prompt, which is easy to hit
mid-scroll. Opening the note or the `.base` file still shows it.

**Rejected:**

- Keeping New, names shortened — the view name tells views apart.
- Hiding it on desktop too — desktop has the room; Sort, Filter and Properties
  edit the `.base` file anyway.
- Wrapping the toolbar to two lines — adds a row's height to every Base.

## D-098 — On mobile a web page in a frame is a preview, a link to the page (2026-10-05)

**Decision:** on mobile a frame in the stream takes no touch
(`pointer-events: none`), and `FrameDeferral` wraps one showing an `http(s)`
page in a link to it (`webPageLink`). The page loads once still, as before
(D-087). Desktop keeps frames live.

**Why:** on an iPhone a flick over a page taller than its frame scrolled the
page inside it, ~5,400 px, and never the stream; flicking back worked only while
the page was at its top. The scroll box guard cannot reach a frame's page (ADR
0008). A PDF (D-083) and a video (D-088) are previews a tap opens already.

**Rejected:**

- A preview that does nothing when tapped — it looks like a link.
- A link in the frame's place — loses the preview, which is the point of a map
  or a calendar.
- Leaving the page live — any frame taller than the screen can trap a flick,
  which outweighs D-087's reason, "a page that can work in place".

## D-099 — An iOS glitch of a frame is fixed only once a recording shows it (2026-10-05)

**Decision:** three such glitches, traced by a probe or only predicted, stay
unfixed:

- A Base's table draws rows blank for a frame as a note above it renders
  mid-glide: Bases picks its visible rows again only after the paint. Traced by
  `src/probe.ts` in commit `d9cdb4f`.
- An image loading inside the note the pane's top crosses may jump a frame (ADR
  0013's consequences). Never seen: notes render a screen ahead, so their images
  have usually loaded.
- D-091's stop may write the scroll mid-touch on a slow drag past the newest
  note. The harness only flicks.

**Why:** each lasts one frame, mid-motion. A fix leans on undocumented Bases or
iOS behavior, and only a phone recording can confirm it: the harness takes its
samples before the re-pin.

**Rejected:**

- Dispatching `scroll` on each Base near the screen in `repin`'s task — relies
  on undocumented Bases behavior, and every other listener hears it.
- Measuring never-measured notes in a hidden probe while still — about 16 ms a
  Base, across 1,095 notes in a three-year vault, with no `requestIdleCallback`
  on iOS; Bases and images size again where they are drawn (ADR 0010).

## D-100 — Before 1.0 the plugin needs the latest Obsidian (2026-10-07)

**Decision:** until 1.0, `minAppVersion` is the latest public Obsidian, raised
at the next version bump; the stream drops what only older versions need.
`1.0.0` is the first public release, and `versions.json` keeps no `0.x` entry
past it (2026-10-09). The `0.x` drafts and tags are deleted (D-125).

**Why:** nothing is released publicly before 1.0, so no reader runs an older
Obsidian, and a workaround for one is dead code. Obsidian offers an older
version from `versions.json` to an app below `minAppVersion`; a `0.x` entry
would point at a draft nobody can download.

**Rejected:**

- Keeping 1.8.7 — carries rules like D-085's for readers who do not exist.
- Publishing the `0.x` drafts — releases nobody outside the project ever ran.

## D-101 — A turn's scroll change is never the reader's (2026-10-07)

**Decision:** once the pane's width changes, `ScrollAnchor` reads again the
scroll position the place was read at, so whatever moved the place since then is
owed.

**Why:** a turn upright makes the pane taller, and near the stream's end the
browser clamps the scroll. On a phone, the stream had grown 62px by the time the
clamp's scroll was read, `clamped()` read false, and the 873px clamp was taken
for the reader's own scroll: about one turn in three lost the place.

**Rejected:**

- Drawing the shift first, as ADR 0015 does — the browser clamps before any
  plugin code runs.
- A spacer at the stream's end — a second thing to remove at the right moment
  (ADR 0014).

## D-102 — A refresh reads the place once the anchor has handed over (2026-10-07)

**Decision:** `NoteStream.refresh()` has `ScrollAnchor` hand what it owes to the
scroll before reading the reader's place.

**Why:** while owed, the stream is drawn shifted, not where the scroll puts it.
At the stream's end, a clamp held as a shift drew every note above the pane, so
`place()` found no note in the pane, and hiding empty notes there reloaded at
the top.

**Rejected:**

- Reading the place through the shift — at the end, the shift draws nothing in
  the pane to read.

## D-103 — At the stream's end, the anchor owes only what the scroll can take (2026-10-07)

**Decision:** once every note is loaded, `ScrollAnchor` caps what it owes at how
far the scroll can still go down. A clamp at the end moves the place at once.

**Why:** a shift past the scroll's end draws blank below the stream until the
scroll is still, and the hand-over clamps it all the same. Short of the end, the
next batch fills the blank, and the hold keeps the place (ADR 0015).

**Rejected:**

- Capping everywhere — a jump to a note with little below would lose its place.

## D-104 — A task's checkbox centers on its words (2026-10-07)

**Decision:** the box takes the text's font size, `vertical-align: middle`, and
`top: -0.12em`. Tests hold it within 0.5px of center at 12–28px in Chromium, and
within 1px at 16px and 28px on an iPhone.

**Why:** Obsidian nudges the box by a fixed 0.2em of its own 13.33px font, and
the box grows with the text. On an iPhone that left it 1.8px high at 16px and
5.3px high at 28px; centered, it is within 0.8px. Edit view drifts too, the
other way.

**Rejected:**

- Matching reading view — copies a drift that grows with the text.
- `font-size: inherit` alone — scales the nudge, not the centering: desktop then
  drifts by 1.2–1.9px.

## D-105 — Note heights are kept to the 1/64 pixel (2026-10-07)

**Decision:** `NoteHeights` keeps a height rounded to 1/64px, the unit browsers
lay out in, not to whole pixels.

**Why:** a placeholder reserved a whole-pixel height and its note rendered up to
half a pixel off. The anchor owed the difference, and a scroll up by hand
settled 1px short of the top. With exact heights, a note unchanged since it was
measured owes nothing; an edited one is estimated (ADR 0017), and a changed
embed is owed whatever it changed, either way. Keeping sizes as measured is the
norm: browsers add up sub-pixel anchoring adjustments (web-platform-tests'
`device-pixel-adjustment.html`), and TanStack Virtual keeps
`getBoundingClientRect()` sizes unrounded.

**Rejected:**

- Whole pixels (`a5c9f52`) — saves ~26KB on a three-year journal's layout
  memory, of ~160KB, against a 5MB store; no reader sees the difference either
  way.
- Loosening the tests to a pixel — keeps the rounding they caught.

## D-106 — A wrapped task's lines start under its first (2026-10-07)

**Decision:** the checkbox hangs out of the line by its width and the gap after
it, so a task's words start at the item's edge on every line.

**Why:** Obsidian hangs it 1.5 widths out, which lines up only at a 12px box.
The box grows with the text, so the first line starts left of the rest: 3px at
16px, 10px at 28px on an iPhone, in reading view too.

**Rejected:**

- Matching reading view — copies a gap that grows with the text, the same
  problem as D-104.

## D-107 — On mobile a kanban Base too wide for its note draws as cards (2026-10-07)

**Decision:** a kanban view follows D-033: measured from the width Bases sets on
its board, it redraws as cards, its `groupBy` kept, so each column is a group.

**Why:** clipped (ADR 0008), a phone showed the first of a board's 280px columns
and none of the rest.

**Rejected:**

- Opening the `.base` file on a tap, as for a PDF (D-083) — hides a board that
  cards can show.
- Stacking the columns in CSS — Bases positions them absolutely, as D-033 found
  for tables.
- Cards for every kanban, unmeasured — a one-column board fits.

## D-108 — A Base's own height changes re-pin its note in the same task (2026-10-08)

Superseded in part by D-159: each Base slot now has a fixed height.

**Decision:** a Base slot tells its note, by a synchronous `BASE_RESIZED` event,
when its hold is released or a measured draw turns out to fit; the note re-pins
and the anchor shifts in that task (ADR 0013). A Base redrawn as written over
cards, to be measured, is clipped at the cards' height until measured.

**Why:** both changes reached the note by a `ResizeObserver` report, which iOS
paints a frame after, so text below a Base in the same note jumped and returned:
1219px for a table redrawn as cards, 510px each way for a kanban (D-107).

**Rejected:**

- Pinning every slot as notes are pinned — also clips Bases' own live growth for
  a frame; a larger change to the hold (D-035, D-054) than these two cases
  needed.
- A callback from `NoteBases` into `NoteWindowManager` — wires the renderer to
  the stream it is made before; the event needs no reference.

## D-112 — A phone run turns the keyboard's autocorrection and prediction back on (2026-10-09)

**Decision:** the iOS harness ends a run by setting both through WebDriverAgent:
on by default, `IOS_KEYBOARD_AUTOCORRECT=off` or `IOS_KEYBOARD_PREDICTION=off`
to leave one off, set on the command line or in a gitignored
`e2e-tests/ios/.env`, which the command line overrides. Tests still type with
both off.

**Why:** WebDriverAgent turns both off each time it starts, real phones
included, and never back on: the tester's keyboard stayed changed.

**Rejected:**

- Restoring what the phone had — WebDriverAgent overwrites it before any session
  can read it.
- Patching WebDriverAgent's start-up — a fork of a dependency the driver install
  replaces.

## D-113 — Nothing in the stream carries `.clickable-icon` (2026-10-09)

**Decision:** a button in the stream copies `.clickable-icon`'s look in the
stream's own class rather than taking Obsidian's.

**Why:** on an iPhone, a flick begun on a `.clickable-icon` never scrolled:
Obsidian's mobile tap handling for the class swallows the pan, with no
`preventDefault` or `touch-action` that we could see. The pencil on every title
in the editing spike (ADR 0018) failed four `e2e-tests/ios/` glides.

**Rejected:**

- Undoing the class's handling — Obsidian's script, out of reach.

## D-114 — The settings tab is declared, each section a group (2026-10-09)

**Decision:** `getSettingDefinitions()` returns Hide empty notes, then a group
per section. Obsidian draws each group as a card, hides a collapse toggle while
its section is off (`visible`), and lists every toggle in its settings search.
`setControlValue` saves through `saveSettings()`, which redraws the streams.

**Why:** the settings search finds them, and Obsidian redraws the tab itself:
the tab holds no rendering, saving or redraw code.

**Rejected:**

- `SettingGroup` cards, drawn by the tab — the same cards, but missing from the
  settings search, and keeping D-078's redraw.

## D-115 — Release notes are written by hand at release (2026-10-09)

**Decision:** each release's notes are a summary written into the draft's body
before publishing, from `git log --first-parent` since the last release tag:
what a reader notices, in plain words; internal work left out. This starts with
the first public release, 1.0.0.

**Why:** the first-parent log holds every change, merged or fast-forwarded; a
reader wants what changed for them, which takes judgment no script has.

**Rejected:**

- A `CHANGELOG.md` — repeats the release bodies; one contributor needs no
  per-branch entries.
- Notes generated from commits (a script, GitHub's) — they list commits, tests
  and docs included.

## D-116 — The README recordings are animated WebPs; the phone's is captured over USB (2026-10-09)

**Decision:** both recordings are animated WebPs encoded by `img2webp`: desktop
lossless, the phone lossy at quality 80 and 30 frames a second. The phone's
screen is captured over USB as QuickTime does (`scripts/capture-iphone.swift`),
600 px wide, trimmed to the scene.

**Why:** WebP stores the desktop recording's exact pixels in 1.3 MB, against 3.0
MB as an APNG. On the phone a glide changes the whole screen every frame:
lossless took 8 MB for the glides alone, an APNG 20 MB in all, lossy 5.3 MB; at
ten frames a second, glides stutter and key bubbles drop out. USB capture draws
a clean status bar, the same in every take.

**Rejected:**

- APNG (D-045) — over twice the size on desktop, four times on the phone.
- WebDriverAgent's screen stream — JPEG frames, and the real clock and battery
  in each take; the same size once encoded.
- `sharp` — a Node dependency for what one command does.

## D-117 — A Templater block fills in one line, as its docs predict (2026-10-09)

**Decision:** in the template pattern (ADR 0011) a Templater block stands for
any text on its line, like `{{…}}`. `tp.file.cursor()` stands for the marker
Templater writes back or nothing; `-`/`_` trim beside a block as Templater's
whitespace control does. A block whose output spans lines (`tp.file.include`,
`tp.web.daily_quote`, `if`/`else`) makes an untouched note show.

**Why:** a block read as any text across lines swallowed what was written there:
a bullet typed at `tp.file.cursor()` hid the note. A note wrongly shown is
clutter; one wrongly hidden is lost writing.

**Rejected:**

- Fingerprints of what Templater wrote, from its `templater:overwrite-file`
  event, kept in plugin data — catches multi-line output, but not notes made
  before install, where hiding matters most; it also relies on an undocumented
  event and keeps a synced record per note. Revisit if users ask
  (`docs/TODO.md`).

## D-118 — The service counts the stream's notes (2026-10-11)

**Decision:** `DailyNoteService` keeps `streamLength`, how many notes, newest
first, the stream has loaded. `insertSorted`/`removeSorted` move it, a rebuild
empties it; `NoteStream` keeps no list of its own.

**Why:** `StreamState` copied the list's first notes, and every list change had
to be repeated there or pagination skipped and repeated notes (ADR 0004). Kept
in the service beside the list, the count moves with it.

**Rejected:**

- The count in `NoteStream` — each insert and remove would still have to be
  repeated there.

## D-119 — Lookups over the notes stay linear (2026-10-11)

**Decision:** `DailyNoteService.indexOf` scans the list, and `refresh` maps
every date in order to read one.

**Why:** each runs once per event, refresh or Back, never per note: over 1,095
notes, microseconds.

**Rejected:**

- A path→index map — a second copy of the list's order that every insert and
  remove must keep in step, the kind of copy D-118 removed.

## D-120 — The service dates notes by the format it listed them with (2026-10-11)

**Decision:** `DailyNoteService` keeps the daily-notes format of its last build
and parses, formats and inserts by it; only `refreshIfSettingsChanged` reads the
settings, on each config write (D-002). The jump modal formats each choice's
label and ISO date once per open.

**Why:** a note made between a format change and the refresh was parsed by the
new format into a list sorted by the old. Reading the settings per call also
cost 1,095 reads per modal open.

**Rejected:**

- Reading the format once per modal open — still a read per insert, and still
  out of step with the list until the refresh.

## D-121 — Collapse state is one blob, its old keys dropped unread (2026-10-11)

**Decision:** `CollapsibleStateStore` saves every note's sections under
`daily-notes-stream:collapse`, read once at load and pruned to the vault's notes
at layout ready, as the layout memory is. The old `collapse:*` and
`collapse-idx:*` keys are never read; a device build's "Forget collapse state"
command deletes them with the rest.

**Why:** keys stored one per section could not be listed, so a note deleted
while the plugin wasn't listening left its keys forever, unprefixed beside other
plugins'. Every heading in every render read and parsed one key.

**Rejected:**

- Migrating the old keys — they cannot be listed, only read per path, so the
  code to read them would stay for good. The plugin was unpublished then, so
  only test devices hold any.

## D-122 — The backlink index re-inverts the cache on each `resolved` (2026-10-11)

**Decision:** `BacklinkIndex` stays lazy, inverting all of `resolvedLinks` on
its first lookup after a `resolved`; `LinkChanges` keeps its own per-source
diff.

**Why:** 5 ms per inversion at 10,000 notes and 100,000 links on a 2026 Mac,
once per save that a drawn footer is told of. A full re-read is right whatever
events Obsidian sent.

**Rejected:**

- One incremental index for both — correct only if Obsidian fires `resolve` for
  every source whose links change, renames and deletes of targets included.
  `e2e-tests/linked-mentions.spec.ts` guards the delete and rename cases, in
  case this is tried again.

## D-123 — The day's turn waits for the stream's next change, or midnight (2026-10-11)

**Decision:** before each vault event, refresh or config write it applies, the
stream asks the service whether the day turned since it last looked; if so, it
rechecks the last day's note and one made ahead for the new day. One timer per
view also catches up a minute past midnight, once the reader has stopped
scrolling, touching and wheeling. The reader's own loads, renders and jumps
never trigger the check.

**Why:** yesterday's note showing until something happens costs the reader
nothing, but a note made ahead for today would stay hidden in an idle stream.
Waiting for stillness keeps the pane from moving under the reader.

**Rejected:**

- A check each minute — a timer firing all day for one moment a day.
- Exempting the newest note instead of today's — after a skipped day, an
  untouched note stays shown until the next note is made.

## D-124 — The e2e window stays on screen, transparent (2026-10-12)

**Decision:** the harness shows every Obsidian window at opacity 0, ignoring the
mouse, instead of hiding the app, and without the phone layout's vsync flags.
Before each test it lays the page out at the project's size again, from one
session that never detaches.

**Why:** while hidden, a window whose viewport was set again drew a frame or two
a second once a tab opened, until its worker restarted, timing out whichever
frame-bound test came next. On screen it draws normally, takes screenshots, and
the phone layout glides. A detached session takes its viewport with it, and the
page falls back to its 300x200 window at its next layout, as when settings open
in their own window.

**Rejected:**

- Drawing without vsync on desktop, as the phone layout does — 4 of 5 full runs
  then failed a menu or settings test.
- Skipping the one desktop test that resizes — it checks real behavior, and the
  stall outlives it.
- A visible window behind others — the user can still see it, and macOS
  throttles a covered window.

## D-125 — History rewritten once, before the repo goes public (2026-10-12)

**Decision:** history keeps only the images at the tip of `main` and
`archive/sideways-scroll`, and the `0.x` tags and drafts are deleted. Old
commits show no images.

**Why:** old image versions were 20 MB of a 29 MB clone. Rewritten commits need
new tags, and no reader ran a `0.x` draft.

**Rejected:**

- One fresh commit — loses the messages that hold each change's why (ADR 0001).
- Recreating the `0.x` tags — they would mark releases nobody outside the
  project ran.

## D-126 — The README's desktop stills show the stream's window (2026-10-12, reframed 2026-10-19)

**Decision:** each desktop still is the stream's pane, tab bar and header
included, in a 904 px window as the listing's cards use, 960 px tall, shown as a
window: rounded corners, a hairline edge, a soft shadow
(`scripts/window-still.mjs`). Each runs from a note's date to the end of what it
shows; below its last whole line, the page's background is painted. The first
still is the stream itself: one whole note, the divider, the next note's date.

**Why:** the README is there to win readers over. A window reads as Obsidian at
a glance, and a still that starts on a date and holds its feature whole reads as
a daily note, not a fragment. One height lines the stills up; 960 px fits the
longest, linked mentions. Shown 800 px wide, text is at 88%.

**Rejected:**

- The note column alone — reads as a fragment, not the app.
- A 1024 px window — at 800 px wide its text shrinks to 78%.
- 520 px, the top of the column — cut the date off most stills and lines in
  half.
- A height per still — the stills stop lining up.
- A Base as the first still — a reader sees a feature few use, not the stream.

## D-127 — The daily-notes settings are read without a library (2026-10-12)

**Decision:** `getDailyNoteSettings(app)` in `src/obsidian-internals.ts` reads
Periodic Notes' daily settings while it has them on, else the core plugin's, and
the callers take it as a function.

**Why:** `obsidian-daily-notes-interface` was bundled for this one function. It
reached Obsidian through the bare `window.app` global, sat unmaintained since
2021, and shipped its MIT notice nowhere in `main.js`.

**Rejected:** keeping it and adding its notice to `main.js` — it would still be
a dependency for 20 lines, and the one unsupported access outside the internals
file.

## D-128 — The jump list opens on two months, a query lists a year (2026-10-13)

**Decision:** the jump prompt lists the newest 62 notes on open, and up to 366
matches once a query is typed.

**Why:** over 1,825 notes at phone speed, opening on every date took 313 ms to
its first frame, against 41 ms for 50; on an M5, 38 ms against 8. A typed year
is up to 366 notes, and the old single limit of 50 cut it off in November.

**Rejected:**

- Every date, on open and on a query — a third of a second on a phone, more with
  each year.
- Two calendar months back from today — a sparse journal opens on few notes.

## D-129 — A pinned or reserved height and the scroll shift do not inherit (2026-10-13)

**Decision:** `styles.css` registers `--daily-note-pinned-height`,
`--daily-note-placeholder-height` and `--daily-notes-scroll-shift` with
`@property`, `inherits: false`.

**Why:** a custom property inherits by default, so each change restyled every
element under the one it was set on: the whole note at each re-pin, the whole
stream at each shift. Re-pinning a 10,000-line note took 140 ms on an M5, 570 ms
with the CPU slowed 4x; 2–3 ms not inherited. A save of that note at phone speed
froze 4.9 s, now 1.8 s; a 200-line note's save froze 55 ms, now under the 50 ms
of a long task. A note drawn inside its reserved height (ADR 0020) drops that
height once done; while the property inherited, that cost one more restyle of
the whole note, ~520 ms at phone speed.

**Rejected:**

- Resetting them on the children, as `--daily-note-held-height` is — as fast (2
  ms), but it needs a rule per property at every level where inheritance must
  stop.

## D-130 — Every saved note renders by section, whatever its length (2026-10-13)

**Decision:** no length limit: any note saved while rendered re-renders only the
sections a save changed from then on (ADR 0019).

**Why:** at phone speed (CPU slowed 4x, `e2e-tests/edit-cost.spec.ts`), a
200-line note's first save by section holds one 61–96 ms task, against none
rendered whole; each save after costs nothing, against 35 ms. A length limit
tied who uses this path to an M5's speed, and left the path to the few readers
with long notes, where its faults would surface late.

**Rejected:**

- From 8,000 characters, where a whole re-render first held a 50 ms task — the
  number holds on one machine only, and the path ran for few readers.

## D-131 — Specs time a laptop slowed below every supported iPhone (2026-10-13)

**Decision:** `emulatePhoneCpu` times a fixed workload
(`e2e-tests/phone-speed.ts`) on the machine, then slows its CPU until the
workload takes 20 ms: about 2.3 times an iPhone 16 Pro's 7.6–9.0 ms.
`e2e-tests/ios/phone-speed.spec.ts` keeps that ratio to the real phone.

**Why:** the fixed 4x slowed an M5 to 22–29 ms, and a slower laptop ran slower
still. 20 ms is below an iPhone 11 (~18 ms, half a 16 Pro's single core on
Geekbench 6), the oldest iOS 26 runs on, and near the quicker mid-range Androids
(~29 ms estimated for a Galaxy A35).

**Rejected:**

- The fixed 4x, Lighthouse's preset — set for an average desktop, not an M5.
- An A15 iPhone's ~13 ms, or 16 with margin — misses the older iPhones and every
  mid-range Android.
- A mid-range Android's ~29 ms — no device here to keep the number honest.

## D-132 — The estimate is never the tallest note alone (2026-10-13)

Superseded in part by D-135: a note measured alone no longer sets the estimate.

**Decision:** D-092's 0.9 quantile is taken below the tallest note measured at
the layout, unless it is the only one.

**Why:** under 20 notes measured, `floor(0.9 n)` is the tallest or next to it. A
10,000-line note among the first measured had every unmeasured note reserve its
235,612px: a jump past it landed 1.6 million px down until the next rest. With
more notes measured, nothing changes.

**Rejected:**

- A cap at a multiple of the median — a constant fitted to no vault, and with
  two notes measured the median is half the outlier.
- A cap in panes — a vault of long notes would come out short everywhere, the
  reason D-092 rejected the upper quartile.

## D-133 — A frontmatter change draws only the properties again (2026-10-14)

**Decision:** a save that changes a note's frontmatter redraws its properties
box and updates its body in place (ADR 0019); on mobile, a note holding a Base
still renders whole.

**Why:** when rendered whole, a long note lost the elements the anchor uses to
hold the reader's place: on the iPhone, a reader at a 5,000-line note's end saw
10 blank frames and the text moved 125 px for good. No section's render reads
the frontmatter; a Base's formulas may, through `this`.

**Rejected:**

- Anchoring a whole render by the reader's distance from the note's end — wrong
  for an edit below the reader, and the blank frames stay.

## D-134 — A drawn note's runs keep their sections (2026-10-14)

**Decision:** once a note is drawn, each run (ADR 0021) keeps the sections it
started with; a save swaps sections inside their run, and shows only the runs
holding what it removes and those either side of what it inserts.

**Why:** when runs were regrouped by length on each save, lengthening one
section regrouped every run above it, so the save had to show every run first:
on the iPhone, one 140–590 ms task per save to a 5,000–10,000-line note,
wherever the edit.

**Rejected:**

- Regrouping, then showing each hidden run the new grouping splits — a save that
  moves one run's edge still shows every run above it.

## D-135 — A note's estimate is capped at its size, at the densest rate measured (2026-10-14)

**Decision:** a note never measured at the layout reserves the lesser of D-092's
quantile and its file's bytes × the most pixels per byte any note measured
there, the latter never below what a note reserves before anything is measured
(two panes).

**Why:** D-132 still let the first note measured set every estimate. With
heights forgotten, a jump to a 10,000-line note had each note below it reserve
its 234,000px; a glide down outran the drawing through that empty space, and
sprang back as the notes drew short. Too tall is not safe below the reader. The
densest rate errs tall, since a Base, tall from few bytes, loosens the cap; the
floor keeps a note of a few bytes, all title and frame, from coming out short.

**Rejected:**

- No estimate until ten notes are measured — with two long notes among them, the
  quantile is long again.
- The median rate — a note denser than the median, as any Base is, comes out
  short.
- The shortest note measured as the floor — when the long note is the only one
  measured, it is also the shortest.

## D-136 — A section's collapse key names the heading above it (2026-10-14)

**Decision:** a heading or nested list item is keyed as `{heading}/{own key}`,
where `{heading}` is the slug of the nearest heading above that outranks it
(`h1` over `h2`), or of a heading of any level for a list item; a section above
every heading keeps the bare key. Repeated keys are numbered among sections with
the same full key.

**Why:** repeats were numbered across the note, so deleting the first `Errands`
handed its saved state to the next, under another heading. Only repeats beside
each other now shift. The cost: renaming a heading reopens the sections folded
directly under it; renamed back within a day, they fold again (D-027).

**Rejected:**

- The full heading path — renaming a top heading would reopen every section
  beneath it.
- Migrating saved keys — the plugin was unpublished before `1.0.0`, and a
  section saved under a heading just reopens once.

## D-137 — A note window's flags stay apart, and `FarRuns` stays the collapser's (2026-10-14)

**Decision:** `NoteWindow` keeps `component`, `rendering`, `unloadWanted`,
`is-far` and the `leaving` set as separate fields; `CollapsibleManager` makes
`FarRuns`, and the renderer and the window reach it through the renderer.

**Why:** the flags are three axes that combine — what is drawn, whether it is
out of the layout, whether an unload waits — so a note updating in place can be
hidden and leaving at once. Threading `FarRuns` from `StreamView` would add a
parameter to two constructors to drop one getter.

**Rejected:**

- One state enum per window — it would list every combination of the three.
- `StreamView` making `FarRuns` — longer constructors for one getter less.

## D-138 — Every rendered note on mobile watches for tables drawn later (2026-10-15)

**Decision:** `stackWideTables` gives each rendered note on mobile its own
MutationObserver, table or not.

**Why:** tables arrive after the render in three ways: Dataview's, embeds
loading, and sections a save draws in place (ADR 0019), which nothing else
stacks. A note with no table yet gets one as it is typed.

**Rejected:**

- Watching only notes with a table or a Dataview block — a table typed into
  today's note would scroll sideways.
- One observer for the stream — the same work per mutation, saving only a few
  objects.

## D-139 — A far run stays watched at both edges (2026-10-15)

**Decision:** `FarRunWatch` watches the first and last element of every run
shown.

**Why:** measured on an iPhone 16 Pro, flicking past a 10,000-line note both
ways: at most 10 edges are watched at once. Watching one edge per run would save
four targets, with no frame time to gain.

**Rejected:**

- The next run's first element standing for a run's end — a run shown while the
  next stays hidden (a search step, a save) has no end watched.

## D-140 — A glide stops at the stream's drawn end once every note is loaded (2026-10-15)

**Decision:** once every note is loaded, `ScrollAnchor` stops a glide two steps
before the stream's end comes into the pane, while the end is drawn higher than
the scroll puts it. It is the same stop D-091 makes at the top.

**Why:** a shift owed for notes above that grew draws the end early: an iPhone
glide to the oldest note showed a blank pane for 1.8 s, until the scroll was
still.

**Rejected:**

- Stopping while notes still load — a batch appended below would let the glide
  go on.
- Capping the shift at the room below every frame — the reader's text moves
  mid-glide.

## D-141 — Mutation testing runs on demand, incrementally (2026-10-15)

**Decision:** `pnpm run test:mutation` runs Stryker over `src/` with workers for
30% of the cores, which take about 40% of the machine, rerunning only mutants
whose code changed. Its results and report stay in `reports/`, gitignored. Not a
quality gate. Stryker cannot see which file a vitest test is in, so it misses a
test change: after one, rerun only the source file it covers,
`--force --mutate <file>`. Do a full run (a bare `--force`) only after a change
to Stryker, vitest or the Stryker config, which can change every result. Bail is
off: with it, mutants that fail tests at once were reported as survived, a
different few each run. A survivor the JSON report marks `static` may be false:
one in `note-window.ts` failed its test when applied by hand.

**Why:** 100% line coverage says what ran, not what was checked: the first run
left 657 of 5,477 mutants alive (87.9%). A full run takes ~13 minutes on 8
workers and keeps the fans at full speed.

**Rejected:**

- A gate on every task — too slow, and many survivors are equivalent mutants.
- All cores but one, the default — the laptop runs hot for little gain.
- Half the cores — a worker takes more than a core: 5 took 6 of 10, fans at full
  speed.
- Efficiency cores only (`taskpolicy -b`) — cool, but the aim is cores left
  free, not which ones.
- Committing the results — ~10 MB rewritten each run, for one machine and no CI.
  Stryker's own repo fetches them from its dashboard instead.

## D-142 — The phone specs open the stream afresh (2026-10-15)

**Decision:** `phone.openStream()` closes the stream and opens it again, at its
top, as a reader reopens it.

**Why:** it used to write the scroll to the top of a stream left open, which
nothing in the app does. The anchor still held a place from below: over a long
newest note, the stream drew it from its end and landed some 250,000 px down.

**Rejected:**

- The app's scroll to the top, a title tap's glide — notes drawn on the way
  changed what three specs started from.
- A jump to the newest note — it lands its title at the pane's top, 8 px below
  the stream's top, so specs comparing against a title tap's top would differ.

## D-143 — A glide up owing growth stops before its scroll runs out (2026-10-15)

**Decision:** `ScrollAnchor` stops a glide up two steps before its scroll runs
out while the stream is drawn higher than its scroll, writing what it owes, as
D-140 does at the end. This doesn't apply to a scroll headed for the top, such
as a title tap's: it lands there owing nothing.

**Why:** notes above that grew mid-glide left the stream's top above the pane at
scroll 0: the glide bounced short of the newest note's top, and a pull on the
bounce opened Obsidian's pull-down action, the command palette, over the stream.

**Rejected:**

- The hand-over once the bounce ends — the bounce, and the pull on it, come
  first.
- Writing what is owed mid-glide, for the glide to reach the top — iOS undoes it
  ([ADR 0013](adr/0013-pin-rendered-note-heights.md)).

## D-144 — The phone harness patches Appium to one console listener (2026-10-15)

**Decision:** setup rewrites the XCUITest driver's `context.js` to stop its
console listeners before it starts one (`e2e-tests/ios/console-listener.ts`).

**Why:** the driver adds a listener on every switch into the web view and never
removes one. After N switches each message is logged N times into a buffer of
5,000: a full run lost a test's error before the test read it. Probed: 300
switches and 30 lines after an error lost it; patched, it was caught.

**Rejected:**

- Collecting errors in the page (`error`, `unhandledrejection`, `console.error`)
  — misses what WebKit logs itself, and errors before a reload installs it.
- Reading the log after every switch — still lossy within one long call.
- A fresh session per spec file — caps the copies per file, not per test: a long
  file can still lose one.

## D-145 — A scroll re-pins the note at the pane's top if its content moved (2026-10-16)

**Decision:** `NoteWindowManager.onScroll` first measures where the content of
the pinned note at the pane's top ends, relative to the note's top, and compares
it with where it ended when the note was pinned. If that moved, the note re-pins
before the anchor reads its place.

**Why:** Bases fills a view in a task of its own, moving the text below it
inside the pin. When a scroll came before the `ResizeObserver` report, the
anchor read its place in the already-moved text, so the later re-pin owed
nothing, and the next note dropped by the growth: 603 px in about 1 flick in 5
(D-108 covers only a Base's own holds).

**Rejected:**

- A `MutationObserver` on each Base — Bases only; misses growth with no DOM
  change.
- Re-pinning every drawn note each scroll — a forced layout per note per frame
  (ADR 0023).
- Notes marked on screen by the `IntersectionObserver` — it lags: a note ending
  at the pane's top is not yet marked when the scroll lands.

## D-146 — A glide stopped early is stopped one step further on (2026-10-16)

**Decision:** D-140's and D-143's stops write the scroll one glide step beyond
the position the page last heard, plus what is owed.

**Why:** iOS has already drawn one step beyond the scroll position the page
hears. Stopped at the heard position, the text moved back 40–52 px against the
glide in every stop recorded on an iPhone; stopped one step further, 1 stop in
25 moved back, by 88 px.

**Rejected:**

- Two steps further — no stop moves back, but each moves forward a frame more
  than the glide would.
- Stopping without a write, by freezing the scroll alone — what is owed is
  handed over on the next frame, a jump of its own.

## D-147 — Desktop scrolls to the top from a header button (2026-10-16)

**Decision:** amends D-037. On desktop, an `arrow-up-to-line` action beside
Search and Jump to date glides the stream to its top. Mobile keeps the title tap
and gets no button.

**Why:** desktop had only the command; nothing on screen offered it.

**Rejected:**

- The title on desktop too — D-037's reason stands.
- The button on mobile too — a third icon in a narrow header, for what the title
  already does.
- A floating button over the notes — covers text, and no other view has one.

## D-148 — CI runs the gates that need no Obsidian, on Linux (2026-10-17)

**Decision:** `.github/workflows/ci.yml` runs format, lint, the e2e type-check,
unit tests with coverage, and the build on `ubuntu-latest`, for pushes to `main`
and pull requests. e2e, the iPhone and memory specs stay local.

**Why:** Linux runners are free. The e2e harness launches the macOS app through
LaunchServices (`open -g -j`).

**Rejected:**

- e2e on a macOS runner — not on the free tier for a private repo.
- e2e on Linux under Xvfb with Obsidian's AppImage — a second launcher to keep
  working, never checked against the specs' timings.

## D-149 — A mutation run leaves no survivor (2026-10-17)

**Decision:** amends D-141. A surviving mutant gets a test, or, when no test can
tell it apart, a Stryker directive where it is, giving the reason:
`// Stryker disable next-line <mutator>: <why>`. A mutant only a real layout
shows says so, naming the e2e spec that covers it (ADR 0002). Directives attach
to the next node's leading comment: a `catch` block takes a `disable`/`restore`
pair around its `try`.

**Why:** after a clean run, a new survivor is the only one, so it gets read.

**Rejected:**

- `mutator.excludedMutations` in the config — drops a mutator everywhere, hiding
  real gaps with the equivalent ones.
- Tests asserting what nothing depends on, such as a zoom of 1 or a field's
  first value overwritten before it is read — they pass the metric and guard
  nothing.

## D-150 — End-to-end tests live in `e2e-tests/` (2026-10-17)

**Decision:** the Playwright suite moves from `e2e/` to `e2e-tests/`.
`tests/repo/compliance.test.ts` checks that every TypeScript folder except
`src/` sits under a path the directory's review scanner skips.

**Why:** the scanner skips `e2e-tests/**` and `*.spec.*`, not `e2e/`, so it
linted the harness as plugin code: the 1.0.0 review's three errors and most of
its warnings
([scanner config](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration)).

**Rejected:**

- Fixing the harness to the plugin rules — `fs`, `child_process` and `fetch` are
  what a Node test harness is for.

## D-151 — Lint fails on a warning (2026-10-17)

**Decision:** `pnpm run lint` runs `--max-warnings 0`, on the
`eslint-plugin-obsidianmd` and `typescript-eslint` the review scanner runs.
Rules guarding the app's runtime — popout windows, mobile, the config folder —
are off for `scripts/` and `tests/`, which run in Node.

**Why:** the scanner reports most rules as warnings; any warning lint lets
through shows up in the review.

**Rejected:**

- Raising each rule to an error by name — the list drifts from the scanner's.

## D-152 — Moment is typed locally (2026-10-18)

**Decision:** `src/notes/moment.ts` types the moment methods the plugin calls
and is the only importer of Obsidian's `moment`; lint enforces it. A moment from
anywhere else is passed in as its milliseconds. A test holds the real moment to
the type.

**Why:** the directory's scorecard lints without moment's types, which
`obsidian.d.ts` imports from its own dependency, so every moment call scored a
warning: 91 on 1.0.2, rating its Review "Caution". Hiding moment's types locally
reproduces them; with this change, there are none.

**Rejected:**

- `@types/moment` — an empty stub depending on `moment`; nldates has it and is
  still flagged.
- Waiting for a scanner fix — the rating stays meanwhile. Revert once fixed
  (`docs/TODO.md`).

## D-153 — styles.css avoids what the scorecard flags (2026-10-18)

**Decision:** no `:has`, no custom element selected by tag, and only one
`!important`, on the clip for Dataview's blocks and for the elements the scroll
box guard finds. `tests/repo/styles.test.ts` holds all three.

**Why:** the directory's scorecard warns on each. Dataview and Obsidian set
`overflow-x` inline, which only `!important` outranks; every other override wins
on specificity, or, for Bases' sticky summaries, on their inset.

**Rejected:**

- Clearing the inline overflow from code — more code in the scroll path, and an
  exception to D-003, to drop one warning.

## D-154 — A debt under a layout unit is none (2026-10-18)

**Decision:** the scroll anchor owes nothing when its debt is under 1/64 px,
WebKit's layout unit (`src/stream/scroll-anchor.ts`).

**Why:** the debt sums fractional moves, which can cancel to a remainder such as
`2.8e-14`. While that remainder counted as owed, the stream stayed shifted, and
the hand-over wrote the scroll, which stops a glide;
`e2e-tests/ios/jump.spec.ts` failed 1 run in 3.

**Rejected:**

- Rounding each move to 1/64 px — errs on every move, and the errors add up.
- `Number.EPSILON` — a remainder grows with the sums it comes from.

## D-155 — README.md is not hard-wrapped (2026-10-18)

**Decision:** Prettier writes each README paragraph on one line
(`proseWrap: "never"` in `.prettierrc.json`).

**Why:** Obsidian's community plugin view renders a single newline as a line
break, so a README wrapped at 80 broke mid-sentence on narrow screens.

**Rejected:**

- Trailing-space or `<br>` tricks — Obsidian's renderer is the problem, not the
  breaks' kind.

## D-156 — Empty notes show by default (2026-10-18)

**Decision:** Hide empty notes is off by default (`src/settings.ts`).

**Why:** a new user saw notes vanish with no cause in sight; a missing day read
as a bug. Hiding stays one toggle away.

**Rejected:**

- On by default, explained in the README — the stream itself gives no hint.

## D-157 — One card per row is a setting (2026-10-19)

**Decision:** **One card per row** (off by default) sets `cardSize: 800`, Bases'
largest, on the cards a too-wide Base is drawn as (D-033), so one card fills any
row. A view written as cards keeps its own size. Turning the setting on or off
leaves remembered heights stale until each note redraws, as toggling Show note
properties does.

**Why:** on a phone Bases fits two cards to a row, cutting each card's values
short.

**Rejected:**

- A card size slider — how many fit a row still depends on the screen.
- Cards per row, 1–3 — needs a size worked out from each width, and a redraw
  whenever the width changes.
- Resizing cards the note wrote — the note chose that size.
- The setting in the layout key — a second set of heights for one setting.
- Forgetting every height when the setting changes — most notes hold no Base,
  and would lose a correct height.

## D-158 — The iPhone suite runs on five years by choice (2026-10-19)

**Decision:** `IOS_SEED_DAYS` sets the iPhone vault's journal, 21 days unless
set; 1825 is five years. Each test costs the same either way: the test Bases
list a month of the journal (`A_MONTH`), and a trip to the oldest note starts 21
notes above it (`stream.spec.ts`). The harness waits for Obsidian's layout and
index before the first test.

**Why:** the README says the stream stays fast over years of notes; desktop
measured that (`pnpm run test:memory`), the phone did not.

**Rejected:**

- Five years always — each run reseeds the phone's vault, ~1,800 writes.
- Bases listing every file — a note a million pixels tall tests a Base's size,
  not the stream's length; tracked in `docs/TODO.md`.
- Trips through every note — 11.5 min one way, ~23 min there and back, to check
  what a 21-note trip checks.

## D-159 — A Base is held at a fixed height (2026-10-19)

**Decision:** the box each Base is drawn in has a fixed height: the tallest the
Base has been since it last settled. Anything taller is cut off. When the Base
grows, the box grows to match in the next task, and tells its note, which then
updates its pinned height (ADR 0013). A Base drawn as a table to measure whether
it fits grows the same way once that is decided.

**Why:** Bases adds a table's rows from inside its own ResizeObserver callback.
This happens when a note hidden far off screen (ADR 0023) is shown again after
its Base's data arrived while it was hidden. ResizeObserver had already reported
the note's size that frame, so the note growing there made WebKit log the D-095
error. With a fixed-height box, the rows grow inside the box, and the note
changes size only in the next task. The cost: a Base's growth shows one frame
late.

**Rejected:**

- A `min-height` hold raised from the callback (D-095) — growth inside Bases'
  own callback goes past it.
- Not observing the note's content — the scroll anchor and the width refits need
  it.
- Calling Bases' `onResize` ourselves, outside a callback — it is an Obsidian
  internal, and Bases' own observer still fires.

## D-160 — Notes are re-reserved only after a turn is handed over (2026-10-19)

**Decision:** while `ScrollAnchor` holds the place it read before the pane's
width changed (D-057), `NoteWindowManager` puts off re-reserving unloaded notes
(ADR 0014) until the next time the scroll is still. Asking whether the anchor
holds one also reads the width, so a turn no resize has reported yet counts.

**Why:** re-reserving ends with a hand-over, which also ends the hold. On a
phone, a re-reservation due as the phone turned ran in the turn's first frames;
the anchor then re-read its place each frame, landed on a Base emptied for its
redraw, and the reader ended up 409px below their place: 5 turns in 60.

**Rejected:**

- A hand-over that keeps holding the reflow — changes what every caller of
  `handOver` gets, to fix one.

## D-161 — The listing's screenshots are cards (2026-10-19)

**Decision:** each of the community listing's images is a card: a headline in
Avenir Next on a warm paper background. Its five desktop cards show the stream's
tab alone, sidebar closed, and last a light and a dark phone; its five mobile
cards show one whole phone each, the last in the dark theme. Each phone is drawn
at the 402x874 shape of its capture.

**Why:** a bare window says nothing on its own, and its sidebar took a third of
the image. A headline names the feature the picture shows. The mobile slots are
9:16, shorter than a phone's screen, so a bare capture was cut or letterboxed.

**Rejected:**

- The whole window, sidebar open — mostly Obsidian's file list, not the plugin.
- Bare phone captures cropped to 9:16 — cuts off the phone's own bars.
- White text on black beside the window — reads as a copy of other listings.
- A serif headline — looked out of place next to Obsidian's interface.

## D-162 — The plugin's name is title case (2026-10-19)

**Decision:** the plugin is named "Daily Notes Stream" in the manifest, and the
same wherever the interface names the plugin: its tab, Page preview's settings.
Commands, settings and buttons stay in sentence case.

**Why:** Obsidian's guidelines ask for sentence case in the interface but
capitalize proper nouns, and a plugin's name is one. The listing's popular
plugins are title case, and Obsidian prefixes each command with the name.

**Rejected:**

- Sentence case everywhere — reads as a description, not a name, in the listing.
- Title case for the name only, sentence case in the tab — two spellings of one
  name.

## D-163 — The desktop recording is captured at 2x and 30 frames a second (2026-10-19)

**Decision:** the desktop recording's frames are 1600 px wide, the window at the
display's 2x scale, and the README shows it 800 px wide. Motion keeps up to 30
frames a second, as the phone's does (D-116). Still lossless.

**Why:** at 1x a Retina screen doubled each pixel, and the text read soft; at
ten frames a second a scroll stepped. The file grows from 1.3 MB to 5.6 MB.

**Rejected:**

- Lossy at 2x — not needed at this size, and it trades away the exact pixels
  D-116 kept lossless for.

## D-164 — A change of the stream running 5 seconds logs an error (2026-10-19)

**Decision:** every change in the stream's queue, and each note's drawing, logs
an error in the developer console once it has run for 5 seconds, naming it, and
again when it ends. The messages ship in the published build. An error, not a
warning: the lint allows only `console.error`.

**Why:** every change waits its turn in one queue (ADR 0004). A reader on a slow
Windows laptop came Back to a stream that stayed empty until the tab reopened,
and it did not reproduce here. A change that never ends leaves every note
undrawn and logged nothing; an error is already logged.

**Rejected:**

- A timeout that abandons the change — the queue's order is what keeps the
  blocks and the note list in step; skipping ahead breaks that.
- A debug setting for the logging — a reader can only use the published build,
  and a hang can't be turned on after the fact.
- 10 seconds — a reader may give up and reopen the tab before then. The slowest
  job the e2e specs allow, the first search, runs 1.5 s; 5 s leaves room for a
  slow laptop.

## D-165 — The listing's descriptions are kept in docs/LISTING.md (2026-10-20)

**Decision:** the directory listing's short and long descriptions live in
`docs/LISTING.md`, and are pasted into the listing by hand. A test holds
`manifest.json` and `package.json` to the short one, and both to the listing's
limits: 200 and 1000 characters.

**Why:** the listing keeps no history. The manifest's description is what users
see in their installed plugins, and Obsidian expects it to match the listing's.

**Rejected:**

- Only the listing — no record of past wording.
- A copy in the README — readers would see it twice.

## D-166 — Overrides lift dev dependencies past security advisories (2026-10-20)

**Decision:** `pnpm-workspace.yaml` overrides set a minimum version for each
transitive dev dependency with an advisory that its parent's range already
allows a fix for, or that `@appium/support` pins (`shell-quote`). An entry goes
once its parent requires the fixed version itself. `esbuild` 0.27 (low, used
only by vitest's internal server) and `extract-zip` (no fix released) stay open.

**Why:** pnpm keeps an installed version while it satisfies the range, so
`pnpm update --depth Infinity` left most of them in place. None of them ships;
the plugin bundles no dependencies.

**Rejected:**

- Deleting the lockfile — re-resolves every package to fix a dozen.
- Forcing `esbuild` 0.28 — outside the range vite 7 asks for, for a low alert.

## D-167 — Nothing in the stream fades on mobile (2026-10-20)

**Decision:** on mobile, nothing in the stream has a `transition`. What a touch
changes there changes at once: Obsidian still dims a touched link (`mobile-tap`)
and shows a date's daily-note button.

**Why:** a fade that starts under the finger can stop iOS from scrolling. On an
iPad, a swipe from a link, a date in a Base, its daily-note button or a link to
a day moved the stream 0 px; without the fade, about 620 px. The fading element
gets its own layer, and since the pane is not a stacking context, WebKit then
composites every positioned element after it. Among them is a callout, which
dark themes blend (`mix-blend-mode: lighten`). If that lands before iOS starts
the pan, about 1 ms after the touch, the touch never scrolls. Reading view does
the same with a blended callout after the link; it only seemed immune because it
renders few sections at once.

**Rejected:**

- No transition on links only — a date's button fades too.
- Opacity 1 on a touched link — drops Obsidian's feedback, and leaves the
  button.
- Dropping `mobile-tap` from Obsidian's touch handler — patches Obsidian, and
  leaves the button.
- `isolation: isolate` on the pane — stops the composited cascade, but a swipe
  still stalled once in 15.
- No blending on callouts — changes how they look, and any other blended element
  would stall a swipe again.

## D-168 — The iOS harness drives an iPad too (2026-10-20)

**Decision:** `pnpm run test:ios` accepts an iPad as well as an iPhone, and
leaves either in the orientation it found it in, rather than upright.

**Why:** iPad bugs, such as a swipe that stalls on a Base, need a real iPad to
reproduce, and an iPad is read mostly in landscape. Specs that assume a phone's
size or upright start fail on it; `docs/TODO.md` tracks them.

**Rejected:**

- Skipping those specs on an iPad — some failures may be real iPad bugs.
- A separate iPad suite — the same touches and checks, twice.

## D-169 — `test:ios` drives the iPhone, `test:ipados` the iPad (2026-10-21)

**Decision:** Each command drives the device of its type on the cable, so both
stay plugged in. A spec that holds only on a phone asks which one it drives
(`drivesIPad`), and the harness strokes below an iPad's header, which sits above
the stream's pane. Amends D-168, whose phone assumptions are now sorted.

**Why:** Driving the first device found meant unplugging the other before every
run.

**Rejected:**

- A separate iPadOS suite — the same touches and checks, twice (D-168).
- One command, the device named by a flag — a command per device is what a
  reader of `package.json` finds.

## D-170 — The reader's follower reads each scroll, and excuses a glide's stop (2026-10-21)

**Decision:** `Phone.followReader` also reads the text as the page hears a
scroll, before the stream answers it. A scroll step against the glide that
carries the text on by no more than the glide's last step is the stream's write,
not drift: `ScrollAnchor.stopGlide` writes one step on, since iOS has drawn it.
A harness spec grows a note above mid-glide, unshifted, and the follower must
report it. The owing glide's spec asks that the glide was stopped owing, not
that it came within 400 px of the top.

**Why:** iOS glides on for frames the page never hears of. Read once a frame,
that step and the stop's write came as one, and the follower reported the whole
owed shift as drift; a screen recording showed the text moving on smoothly. The
recording showed the injected growth as a jump, as the follower does. The 400 px
bound failed on a 60 Hz iPad, whose steps are twice an iPhone's.

**Rejected:**

- A screen capture in the spec — it must start before Appium connects, so it
  spans the run; its frames drop and repeat (D-099).
- A fixed bound on a step — it fits one device's speed and one vault.

## D-171 — A glide is judged by how it ends, not by a time (2026-10-21)

**Decision:** `Phone.glideEnding` lets a flick's glide run out and reads every
frame the page drew from the lift on (`e2e-tests/ios/glide.ts`, D-173). It
passes if the glide slowed to under a tenth of its fastest speed, as iOS ends
one, or ended at the top, the stream's end, or the stream's stop. One cut short
at speed anywhere else fails. Replaces `glidesPast`, which asked whether the
stream still moved 500 ms after the lift.

**Why:** the stream's own stop (D-143) ended the jump spec's glide 390 ms after
the lift on an iPhone, every run, and 500–1,100 ms on an iPad: how soon depends
on the device and the vault. A stall ends a glide at speed; a stop or iOS does
not, wherever it comes.

**Rejected:**

- Longer placeholders, or a jump with more notes above — ties the spec to the
  vault's size.
- A glide that reaches the top — most flicks end mid-stream.

## D-173 — A glide is read frame by frame, so a stall is not a stop (2026-10-25)

**Decision:** `Phone.glideEnding` samples the scroll on every animation frame
from the lift, not on each scroll event, and judges each step by its speed. A
frame over 100 ms late is a stall: a glide that moved across one went on, and
one whose last move spans a stall reads "ended in a stall", which no spec fails.
The longest stall is noted on the test.

**Why:** on an iPad, `2026-08-30`'s seven Bases block the page 330–410 ms
mid-glide, every flick up over a Base, while iOS glides on behind it. Heard by
scroll events, that silence passed the 300 ms hand-over and read as a cut: 6 of
18 traced flicks, each of which glided 4.6–5.4k px and slowed to 1 px a frame. A
frame proves the page alive, so a scroll still over frames has stopped.

**Rejected:**

- A longer hand-over wait — a longer stall still reads as a cut, and the
  stream's write at rest would count as a step.
- Judging by travel alone — a cut far into a long glide travels far too.
