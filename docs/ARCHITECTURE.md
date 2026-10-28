# Architecture

An Obsidian plugin that shows every daily note, newest first, on one read-only
page that loads more as you scroll. Rules that involve more than one file are in
[.claude/rules/invariants.md](../.claude/rules/invariants.md). The reasons for
the design are in [adr/](adr/) and [DECISIONS.md](DECISIONS.md). File names are
kebab-case, and files are grouped by what they do (D-023).

## Layers

```
main.ts               the plugin: indexes and stores shared by all views, one of each
└─ ui/stream-view     one for each open tab: passes Obsidian's events to the stream
   ├─ notes/          which files are daily notes, in what order, and which are hidden
   ├─ stream/         what is loaded, where blocks are, what is rendered, and scrolling
   └─ render/         one note's DOM: Markdown, properties, Bases and the footer
```

`stream/` knows notes as `TFile`s, and gives a block to `render/` to fill. Bases
are the one exception to this direction: `render/bases/` uses the same height
hold and layout memory as `stream/`, and `stream/` finds Base placeholders by
their CSS class.

## Ownership

One for the plugin, shared by all views:

- `ParsedDates` — the date of each path, so opening a view again only reads the
  dates of new files.
- `BacklinkIndex` — `resolvedLinks` turned around: for each note, the notes that
  link to it.
- `EmptyNotes` — which notes hold only their template. `template-match.ts` reads
  the template as a pattern.
- `LinkChanges` — which daily notes gained or lost a link.
- `LayoutMemory` — for each layout: note heights (`note-heights.ts`), Bases that
  are too wide (`layout-table.ts`) and the template's height.
- `CollapsibleStateStore` — which sections are collapsed.

One for each view: `DailyNoteService` (the daily notes, including those in
nested folders, newest first), `NoteStream` with its window, blocks and state,
`NoteRenderer`, `CollapsibleManager`, `StreamSearch` and `SearchBar`.

The plugin adds its `vault` and `metadataCache` listeners before any view opens.
So when a view's own handler runs, the shared indexes are already up to date.

## Flow

1. **Open.** The view starts listening for vault changes. Then it waits for
   `service.initialize()`, which lists the vault's daily notes and leaves out
   the empty ones ([ADR 0011](adr/0011-hide-template-only-notes.md)). Then it
   waits for `stream.open()`. Vault events that arrive in the meantime wait in
   the view's queue until then.
2. **Load.** An sentinel (`infinite-scroll.ts`) scrolls into view. `NoteStream`
   then adds the next batch of 10 notes as empty blocks. `stream-blocks.ts`
   places them and indexes them by path. The service counts how many notes it
   has loaded: its `streamLength` (D-118).
3. **Render.** `NoteWindowManager` (`note-window.ts`) uses three distances from
   the screen, measured in heights of the pane. It renders blocks within 1.5
   panes, hides blocks further than 4, and, once scrolling stops, unloads blocks
   further than 12. Every block keeps its height
   ([ADR 0006](adr/0006-unload-off-screen-notes.md),
   [ADR 0023](adr/0023-hide-far-content-as-it-leaves.md)). A hidden note's
   content is taken out of the layout, while its block keeps its pinned height.
   Parts of a long note far from the screen are replaced by empty spacers
   (`far-runs.ts`, [ADR 0021](adr/0021-hide-far-runs-of-long-notes.md)), and
   `far-run-watch.ts` watches them. Hidden notes and hidden parts show again
   when they come back near the screen. Each rendered note owns a child
   `Component`, which is thrown away when the note is unloaded. When the reader
   scrolls up into a long note, it is drawn from its end
   ([ADR 0022](adr/0022-draw-long-notes-from-the-end-met.md)).
4. **Change.** Vault and metadata events become `NoteStream` mutations: insert a
   note, remove one, re-render one, or check again whether a note is hidden.
   Saves to the same path are debounced. An open search searches again once the
   stream says its notes changed.

Every mutation of the stream, whether a batch, an event, a render, a jump or a
rebuild, runs through one promise queue, so none interleaves at an `await`
([ADR 0004](adr/0004-serialize-view-mutations.md)).

## Rendering

- `note-renderer.ts` renders a note with Obsidian's `MarkdownRenderer` into
  `.markdown-rendered`, and re-renders it on the `metadataCache` "changed" event
  ([ADR 0003](adr/0003-metadata-cache-rerender.md)). A note that was saved after
  it was opened is rendered one section at a time (`note-sections.ts`), and a
  save re-renders only the sections it changed
  ([ADR 0019](adr/0019-re-render-only-changed-sections.md)). Any other note of
  6,000 characters or more is rendered in groups of sections, and a shorter one
  is rendered all at once. Either way, after each section or group, the renderer
  gives the thread back once it has used up its slice of time (`time-slice.ts`).
  A note off the screen lets a note waiting on the screen be drawn first
  ([ADR 0020](adr/0020-render-long-notes-in-slices.md)).
- Taps and clicks on titles, links and fold arrows are handled by one listener
  for each kind of gesture, on the stream's container. The view is the hover
  parent that the Page preview plugin attaches its popups to.
- Wide content: tables become cards, including Dataview's as they fill in
  (D-084). Equations shrink. Each Base draws in its own placeholder, as cards
  when it is too wide (D-033; for a kanban, D-107). `ScrollBoxGuard` tells the
  renderer about Base layouts. Each of these fits itself again when its note's
  width changes. One observer for each view reports width changes
  (`note-widths.ts`).
- On mobile, nothing inside a note scrolls. `ScrollBoxGuard` stops any box from
  scrolling ([ADR 0008](adr/0008-nothing-scrolls-on-mobile.md)), and a PDF shows
  only its first page, which opens the PDF when tapped (D-083). Desktop keeps
  Obsidian's scroll boxes.
- Nothing in the stream uses Obsidian's `.clickable-icon` class: on an iPhone, a
  flick that starts on one never scrolls (D-113).
- On mobile, `FrameDeferral` waits until scrolling stops before it loads the
  page in a frame (D-087). It shows a YouTube video's thumbnail instead of the
  video (D-088), and turns a web page's frame into a preview that links to the
  page (D-098).
- The linked mentions footer is drawn after the note, and draws itself again on
  the metadata cache's `resolved` event. `notes/linked-mentions.ts` finds the
  list item or section that holds each link.

## Scroll position

Heights change all the time: a placeholder's guessed height becomes a real note,
a Base fills in, an image loads. These parts keep the reader's place:

- `LayoutMemory` remembers each note's measured height for each layout, between
  sessions, so placeholders start at the right size
  ([ADR 0010](adr/0010-layout-memory.md)). Editing a note forgets its height
  ([ADR 0017](adr/0017-forget-heights-of-edited-notes.md)). A note not yet
  measured in a layout gets a height that 90% of the heights measured there are
  below (D-092). It never gets more than its file size times the most pixels per
  byte of any note measured there (D-135).
- `HeightHold` keeps a note at its earlier height while it is re-rendered. A
  Base's box keeps a fixed height, the tallest it has been, until the Base
  settles (D-095, D-159).
- `NoteWindowManager` pins each rendered note, and only changes it in the same
  task in which it tells `ScrollAnchor`
  ([ADR 0013](adr/0013-pin-rendered-note-heights.md)). Once scrolling stops, it
  gives unloaded notes the heights they are now expected to have
  (`reservations.ts`, [ADR 0014](adr/0014-re-reserve-placeholders-at-rest.md)).
  Before that, it moves the notes above as one shift
  ([ADR 0015](adr/0015-shift-before-shrinking-above.md)). After the screen is
  turned, it waits until the anchor has finished handling the turn (D-160).
- `StillClock` (`still-clock.ts`), owned by `NoteWindowManager`, knows when the
  pane last scrolled or resized. Re-reserving, loading frames' pages and
  checking for scroll boxes wait on it together. Work asked for once the pane is
  still runs in the next task (D-185). Unloading and `ScrollAnchor` keep their
  own waits.
- `ScrollAnchor` undoes changes in height above the reader, on platforms that
  don't do this themselves. Chromium does it itself; iOS's WebKit does not.

Jumps, search steps and Back (`getEphemeralState`) go through
`scroll-position.ts`. `scrollIntoPlace` sets the scroll again and again until
the stream stops rendering, and `keepInPlace` keeps a centered match in place
while Bases fill in. A jump or search step first draws its whole note, with its
Bases filled in (D-082). A jump starts in `jump-to-date-modal.ts`, which lists
the dates of the vault's notes in the vault's own date format.

## Search

`note-search.ts` finds notes whose title or text matches, as written or as shown
(D-182). `stream-search.ts` moves from note to note. `search-highlights.ts`
marks matches with CSS highlights, and `text-beside-blocks.ts` wraps loose text
in elements so that WebKit shows the highlights. The search bar opens with the
vault's hotkey for "Search current file" (`hotkey.ts`).

## Persistence

| What                  | Where                              | Why there                    |
| --------------------- | ---------------------------------- | ---------------------------- |
| Settings              | plugin data (`data.json`)          | it syncs with the vault      |
| Heights, Base widths  | vault localStorage, on each device | differs by device (ADR 0010) |
| Which notes are empty | vault localStorage, on each device | it is only a cache (D-072)   |
| Collapsed sections    | vault localStorage                 | `collapse-store.ts`, D-121   |

Every localStorage store saves through `saveLoggingOnce`. If a save is refused,
the error is logged once and never thrown (D-071).

## Obsidian internals

Obsidian APIs that are not officially supported are only used in
`obsidian-internals.ts`: the daily notes settings (D-127), readable line length,
the vault config "raw" event, global search's `setQuery`, property icons,
hotkeys, and a view's title element.
