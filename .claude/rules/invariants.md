---
paths:
    - "src/**"
    - "tests/**"
    - "styles.css"
---

# Invariants

Rules that must always hold. Each one involves more than one file, so no single
file's comments can explain it.

- **The blocks are `service.streamedNotes()`, in the same order** (D-118). Load
  notes with `service.extendStream`. Handle `create`, `delete` and `rename` with
  `service.insertSorted` and `removeSorted`, which keep `streamLength` correct.
  Add a block only when `insertSorted` says the note is `inStream`.
- **Each view has its own `DailyNoteService`.** Its list must change together
  with its DOM, inside the view's queue
  ([ADR 0004](../../docs/adr/0004-serialize-view-mutations.md)). If views shared
  one list, it could change while one view is loading, and that view would skip
  or repeat notes.
- **`rename` gets `(file, oldPath)`.** Obsidian mutates the `TFile` in place, so
  the DOM's `data-source-path` still holds the _old_ path. Find the element by
  `oldPath`, and remove the note from the service by `file.path`.
- **A note is re-rendered on `metadataCache.on("changed")`, not on
  `vault.on("modify")`.** The cache is updated after the file is written, and
  the renderer reads the cache. `modify` only redraws cards copied from a
  `.base` file, because a `.base` file has no metadata.
- **A block may be empty.** Only notes near the viewport are rendered
  ([ADR 0006](../../docs/adr/0006-unload-off-screen-notes.md)). The others are
  empty `.daily-note-block` elements that keep their height. Never rely on a
  block's children: `data-source-path` is on the block itself, and the
  path-to-block index in `StreamBlocks` is the only way to find a block.
- **Only `NoteWindowManager.repin` changes the height of a rendered block**
  ([ADR 0013](../../docs/adr/0013-pin-rendered-note-heights.md)). It tells the
  scroll anchor in the same task. Changing a block's height any other way makes
  the screen jump for one frame on iOS. A Base sets its own height only where it
  sends `BASE_RESIZED`, and the handler for that event re-pins its note in the
  same task (D-108).
- **On mobile, nothing inside a note may scroll**
  ([ADR 0008](../../docs/adr/0008-nothing-scrolls-on-mobile.md)). A scroll
  container inside a note stops iOS's scrolling early. Under `.is-mobile`, clip
  overflow with `overflow: clip`, never `hidden` or `auto`.
  `e2e-tests/scroll-boxes.spec.ts` checks this. Desktop keeps Obsidian's scroll
  bars.
