# Council: budgets, subscriptions, custom categories (wave 2), 30 Oct 2026

Default council, five Sonnet advisors, each reviewing all three branches; synthesis by the loop thread.

## Where the council agreed
- **Custom categories first**, then budgets and subscriptions on top, so every module reads the live category lists.
- **One way to name a category**: `categoryMeta(id).label` (renamed name), escaped. Budgets printed the id, the report
  printed the id, Activity printed `short` unescaped.
- **categorize.js froze the category list at import**, so custom categories were never learned and hidden ones were
  still suggested. Now looked up per call.
- **Subscriptions over-detect**: three weekly coffees became a "subscription" with an amber Home line. Weekly now
  needs four charges and everyday categories are left out; "new" is measured from the start of the run.
- **Home must not stack notices** (budget, subscription, BNPL, review). Each feature now exposes a pure
  `…Notice()`; Home will show one at a time.
- **Settings had "Budget" and "Budgets"**: the new block is "Category limits".

## Clashes
- First Principles wanted custom categories held back as the riskiest; the others wanted it first because budgets
  depend on it. Went with first, after fixing every consumer the Executor listed.

## Fixes applied (custom categories, by the loop thread)
Live lists in categorize, report labels, Activity filter lists hidden categories with labels, review picker keeps a
hidden category, donut keeps hidden built-ins' colour, money-in renames kept apart from spending ("Other" is in both),
can't hide the last category, Shortcut fuzzy match only for built-ins ("Car" no longer catches "Carrefour"), the
sheet's summary tab lists your own categories.

## Sent back to the branches
Budgets: labels and hidden categories, "Category limits", only set limits listed, nudge wording and current cycle,
clear a deleted category's limit. Subscriptions: false positives, shared shop key, memoised, wording, current cycle only.
