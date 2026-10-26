# 0019. A saved note only re-renders the sections a save changed

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

A save re-rendered the whole note. With an editor next to the stream, a
10,000-line note froze desktop for about 0.4 s on every automatic save, every 2
s, even after D-129, and froze a phone (CPU slowed 4x) for about 1.8 s on each
synced save (`e2e-tests/edit-cost.spec.ts`).

## Decision

Today's note, the one being written in, is rendered section by section from the
start. Any other note, whatever its length, switches to being rendered by
section at its first save while it is rendered (D-130). Each section of the
metadata cache gets one `MarkdownRenderer` call and one child `Component`, and
its nodes are at the same level in the note's content, as when the whole note is
rendered. A later save only renders the sections between the first and the last
one that changed, and replaces their nodes in place. The block keeps its pinned
height until `NoteWindowManager.repin` (ADR 0013). A heading or list item that
is kept, but whose fold key changed, takes the new key and that key's saved
state.

The whole note is rendered instead when its sections cannot stand on their own
(footnotes, inline footnotes, reference links), or when, on mobile, a save
changed a section that has a Base. A frontmatter change draws the properties
again (D-133).

## Consequences

- A save of today's note only re-renders what changed: no save takes over 50 ms
  on desktop, and under 160 ms at phone speed for 10,000 lines.
- Opening today's note costs one rendering by section, which is about twice the
  JavaScript of rendering a long note all at once: a 200-line note takes 95 ms
  at phone speed, against 68 ms rendered all at once.
- Other notes open as they did, and their first save pays for that rendering
  once.
- `e2e-tests/saved-note.spec.ts` checks a note saved in place against a note
  rendered from scratch.

## Rejected alternatives

- **Every note by section from the first rendering** — opening an old note costs
  up to twice as much, for saves that rarely happen.
- **Rendering the whole note, then matching elements to sections by position** —
  a section that renders no element, or two, moves the matching without any
  sign.
- **A wrapper element for each section** — foldable headings, Obsidian's
  stylesheet and the tests all expect headings to be siblings of the content
  around them.
- **Rendering the whole note when a kept fold key changes** — a journal repeats
  its items, so deleting one day re-rendered the whole note.
- **Waiting for edits to stop before re-rendering** — a long note still froze,
  only later.
