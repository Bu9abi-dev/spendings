# Backlog

Highest value first. Each item names its branch. "Thread" means it's being built in parallel in its own
project thread; the loop thread merges it. Move an item to Done with its version once merged.

## In progress

| # | Item | Branch | Notes |
| --- | --- | --- | --- |
| 0 | Foundation: date-proof tests, module split, rounding + same-account fixes, Extras store | `claude/foundation` | Loop thread. Needs Apps Script redeploy for Extras. |

## Next (wave 1, parallel threads)

1. **Smarter auto-categories** · `claude/smart-categories`
   Learn from past entries, not just exact merchant names: "CARREFOUR MCC 4521 ABU DHABI" should match
   "Carrefour". Suggest a category on each Needs review card, with "file all N from this merchant".
   New `docs/js/categorize.js`; hooks in the review sheet (main.js) and the entry sheet (entry.js).
   App only, no script change.
2. **Category budgets** · `claude/category-budgets`
   A monthly limit per spending category (saved with `saveExtra('budgets', …)`), progress bars in
   Insights, and a gentle warning on Home when a category passes 80% and 100%. Set limits from Settings.
   New `docs/js/budgets.js`.
3. **Spending charts** · `claude/spend-charts`
   Daily and weekly spending bars for the cycle, top merchants, and each category's trend over six
   cycles, in Insights. `charts.js` + `insights.js`.
4. **Subscriptions and recurring payments** · `claude/recurring`
   Detect payments that repeat (same merchant, similar amount, roughly monthly or weekly). List them with
   monthly cost and next expected date, and flag a new one (a free trial that started charging).
   New `docs/js/recurring.js`.
5. **Activity filters and bulk edit** · `claude/activity-filters`
   Filter by account, category, cycle or date range, and amount; show the filtered total; select several
   entries to recategorise or delete, with one undo. `activity.js` + its click handlers.
6. **Monthly report** · `claude/monthly-report`
   A printable report per cycle (income, spending, categories, top merchants, allowance, budgets if set),
   saved as PDF from the iPhone share sheet, plus CSV export per cycle. New `docs/js/report.js`.

## Later (wave 2)

- **Money owed (split expenses).** Track what friends owe Abdullah and what he owes, as "person" accounts
  so lending is a transfer, never spending. Needs a design pass with the council first.
- **Savings goals and net worth.** Goals saved in Extras, progress from chosen accounts; net worth view
  with a manual, read-only investments value.
- **Weekly summary and overspend alerts** on Home (Monday card: last week vs usual, pace warning).
- **Arabic / English toggle.** Touches every string, so do it after wave 1 merges.
- **Performance pass.** First load on iPhone, CSS size, render cost on big ledgers (Activity caps at 400).
- **Accessibility pass.** VoiceOver labels, contrast, Dynamic Type.
- **Reject AED 0 Apple Pay test entries** in Code.gs (a manual ▶ run of the Shortcut logs one). Batch with the
  next script change.

## Done

- (none yet in this loop)
