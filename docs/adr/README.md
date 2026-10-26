# Architecture Decision Records

One record for each decision that was not obvious: why it was made, and what was
rejected. Everything else already has a place: `CLAUDE.md` and `docs/TESTING.md`
say what is true now, and commit messages say why _that change_ was made. An ADR
is the only place where a rejected option is written down, so link to it instead
of repeating it.

Rules:

- One page, about 300 words, and one line for each rejected option. If it is
  longer, it is usually two decisions.
- Numbered in order, and the numbers never change. A decision that is superseded
  gets a new record, and the old one is marked as superseded. Records are a
  history that is only added to, not a description of the current system.
- Written in the branch that makes the decision, together with the code.
