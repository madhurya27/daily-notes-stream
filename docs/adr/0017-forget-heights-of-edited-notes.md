# 0017. Forget a note's heights once it is edited

- **Status:** Accepted. Partly replaces [0010](0010-layout-memory.md)
- **Date:** 2026-10-03

## Context

ADR 0010 kept an edited note's last height, because the layout's median was the
only other guess, and it was further off. A note that grew after it was
measured, on another device or while the plugin was off, kept its old height, so
scrolling up past it ran out of scroll before the newest note (D-090). The
estimate now leans tall (D-092).

## Decision

`NoteHeights` keeps, together with each note's heights, the note's change time
when it was measured, read from the vault in `keep`. Once the vault is indexed,
`retainOnly` removes a note whose change time changed, as it removes a deleted
note. During a session, the plugin forgets a note's heights on
`vault.on("modify")`, before any view hears about the edit. A view that has the
note empty estimates it again once scrolling stops. The store format is
version 5.

## Consequences

- A note edited somewhere else gets the estimate until it is drawn here.
- Every save of a note gives the empty blocks new heights the next time
  scrolling stops.
- A note measured again at the same height only saves its new change time once
  something else is saved.

## Rejected alternatives

- **Keeping the old height (ADR 0010)** — too short for a note that has grown
  since.
- **The taller of the old height and the estimate** — the estimate already leans
  tall.
- **Measuring again off screen after an edit** — draws a note nobody is looking
  at.
- **Checking change times on every read** — every empty block in a batch would
  look its note up in the vault, and the cached estimate would not notice.
