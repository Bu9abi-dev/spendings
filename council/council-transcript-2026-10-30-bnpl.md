# Council: BNPL tracking, 30 Oct 2026

Three Sonnet advisors (Contrarian, First Principles, Outsider). Verdict from all three: merge after fixes.

## Agreed
- The core is right: "paid" is derived from a ledger entry that still exists, and what's owed never touches balances.
- **Two undo-grouping systems** (`together` on the branch, `batch` on main) must become one: `batch`.
- **Mark paid can double-count** when the Shortcut already logged the Tabby charge. Check for a match first.
- **Silent auto-links** can hide a real overdue. Every auto-link gets a toast with "Not this payment", and paid rows
  show what they were matched to. Ties between plans aren't auto-linked; the sort comparator was inconsistent.
- **Stale state**: the editor saved over fresh links; undo restored an old blob; toasts' Undo could undo something
  else (use `topUndoId`).
- **Wording**: no "BNPL" on screen ("Buy now, pay later"), one word for a payment, clearer "Already paid so far".
- **Home**: show the row only when a payment is due within 7 days or overdue, plus "AED X due before payday"
  (informational; never subtracted from balances).
- BNPL payment entries must not teach the category learner.
