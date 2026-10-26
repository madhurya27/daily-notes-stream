# 0003. Render notes again from `metadataCache`, not `vault.modify`

- **Status:** Accepted
- **Date:** 2026-08-20 (recorded 2026-08-30)

## Context

The view re-rendered a note on `vault.on("modify")`. That event fires as soon as
the file is written, before `metadataCache` is updated, and the renderer reads
the cache to cut the frontmatter off the body. So the note was re-rendered with
the frontmatter's old position: old properties, and body text that had been part
of the frontmatter a moment earlier.

## Decision

Render notes again on `metadataCache.on("changed")`, which fires after the cache
has the new reading of that file. The handler replaces the note's DOM element in
place, instead of building the batch again.

`create`, `delete` and `rename` stay on vault events. They change _which_ notes
exist, not what is read from a note, and they go through `service.insertSorted`
and `removeSorted`, so the sort order and the loaded range stay in step.

## Consequences

- Re-rendering comes after the key press by the cache's own delay. In a
  read-only stream, nobody notices.
- Anything else that reads `metadataCache` while a note is rendered reads the
  same version the event announced.
- The two kinds of event must not be merged again because they look similar.
  They answer different questions.

## Rejected alternatives

- **Keep `vault.modify`, and read the file directly** — goes around the cache
  the renderer already uses, so the position can still disagree.
- **Keep `vault.modify` with a delay** — a guess at the cache's timing, which is
  wrong when the machine is busy.
- **Render the whole batch again on any change** — loses the scroll position and
  the fold state, for an edit to one note.
