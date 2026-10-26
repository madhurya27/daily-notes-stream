# 0011. Hide daily notes that only hold their template

- **Status:** Accepted. How a Templater block is read was superseded by D-117
- **Date:** 2026-09-28

## Context

A daily note created from a template and never written in is clutter in the
stream. The metadata cache can see notes that only have frontmatter, but to the
cache, a template with headings or prompts (`## Log`, `- `) looks like content.
Telling template text apart from written text needs the note's text.

## Decision

A note is empty when its whole text, including the frontmatter, is blank, or
matches the daily notes template (`getDailyNoteSettings().template`) read as a
pattern: the text must match exactly, `{{…}}` placeholders match any text on one
line, Templater's `<% … %>` blocks match any text across lines, and whitespace
at the ends of lines is ignored. An added or changed property counts as writing,
so the note is shown.

Each view's service lists notes through this filter, before the first batch.
Today's note is always shown, and so is a note that another note links to, while
linked mentions are shown, because those are content under it. A setting, on by
default, turns hiding off. D-072 describes how results are kept between
sessions, and D-073 how link changes reach the views.

## Consequences

- Notes made from an older version of the template do not match, so they are
  shown.
- A Templater block that writes a whole section makes the pattern match too
  much.
- Whether a note is empty changes when it is edited, so a note is added to or
  removed from `_sorted` on `changed`, through `insertSorted` and
  `removeSorted`.
- Yesterday's empty note is hidden, and one made in advance for the new day is
  shown, a minute after midnight once the reader is still, or on the stream's
  next change (D-123).
- If the template cannot be read, nothing is hidden.

## Rejected alternatives

- **Only notes with nothing but frontmatter, from the cache** — misses every
  template with a heading.
- **Section shapes (only headings and empty list items)** — a guess, and a
  template of prompts looks like normal text.
- **Only the body, ignoring frontmatter** — would hide a note whose only entry
  is a property.
- **Hiding after rendering** — notes appear, then disappear, which moves the
  scroll.
- **A list of earlier templates** — a setting for a rare case.
