# Council: wave 1 branches (smart-categories #8, activity-filters #10, monthly-report), 30 Oct 2026

Default council, Sonnet advisors, each reviewing all three branches at once (one council instead of three, to save
credits). Synthesis by the loop thread. Framed question: `are these three PRs ready to merge, and what must be fixed first?`

## Where the council agreed
- **Merge order: activity-filters → smart-categories → monthly-report.** Both #8 and #10 add a `batch()` to store.js;
  keep activity-filters' (defers persist, emit and sync to the end), drop smart-categories'.
- **smart-categories files wrong categories silently.** Prefix matching makes "Noon" = "Noon Food", "Careem" =
  "Careem Food", "Uber" = "Uber Eats". Medium confidence is acted on (accept-all, "File all N", the add sheet's
  auto-pick). Only `high` may act automatically; same shop must mean the same cleaned name.
- **monthly-report doesn't add up.** Spent tile is net of refunds; category rows are gross. Pick the app's rule
  (gross Spent, refunds as income) everywhere, with rounding that adds up.
- **One shop-name normaliser** shared by categorize, report and (later) recurring.
- **window.print() on an iPhone home-screen app is unverified**; "Share" sends an .html, not a PDF.

## Fixes ordered
- activity-filters: prune the selection to visible matches; confirm sheet lists entries; label the filtered total;
  long-lived undo; tests for bulk delete → undo (before and after sync) leaving each sheet row exactly once.
- smart-categories: exact-key same-shop, only high confidence acts, keep "7 Eleven", clearer undo labels and
  wording, export the normaliser, more tests.
- monthly-report: gross Spent + Refunds line, largest-remainder rounding, shared shop grouping with "Everything
  else", honest PDF/share labels with a fallback, budgets read as `{ v: 1, limits }`, categories via categoryMeta.

## Not done (with reasons)
- **Report for a filtered set, rules from bulk recategorise, BNPL "committed spend" in the report (Expansionist).**
  Good follow-ups; logged in BACKLOG.md.
