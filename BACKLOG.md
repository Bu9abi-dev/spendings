# Backlog

Highest value first. Each item names its branch. "Thread" means it's being built in parallel in its own
project thread; the loop thread merges it. Move an item to Done with its version once merged.

## In progress

| # | Item | Branch | Notes |
| --- | --- | --- | --- |
| 7 | First-time setup + Sign in with Google (council fixes) | `claude/setup-wizard` | creates the sheet + script; needs a Google OAuth client ID |
| 8 | Weekly summary and pace alert | `claude/weekly` | one Home line, "Your week" sheet |

## Next

- **Arabic / English toggle.** Touches every string.
- **Tests: stable under load.** verify-iphone and verify-categorize each failed once while other Playwright runs
  shared the machine; passed on rerun. Look for fixed waits after the extras fix lands.
- **Chart follow-ups:** tap a place to filter Activity; "on pace for AED X this cycle".
- **Report for a filtered set; rules from bulk recategorise** (council wave 1, Expansionist).
- **Performance pass, part 2.** View transition on slow CPUs, the stylesheet size, Activity's 400-entry cap.
- **Accessibility pass.** VoiceOver labels, contrast, Dynamic Type.
- **Budget line in the Apple Pay notification** (Code.gs reads Extras). Batch with the next script change.
- **Use the `features` list** to detect an old script, instead of the "Unknown action" text.
- **Self-reinforcing categories** (Contrarian): a wrong bulk filing teaches the learner. Consider learning only from
  entries you filed by hand or confirmed.

## Done

- v24 · Money owed and split bills (people as accounts, Split, Settle up)
- v23 · Savings goals and net worth (manual investments, BNPL owed subtracted)
- v22 · Buy now, pay later: plans, auto-linked payments, due before payday, Home notice
- v21 · Safer syncing: a change saved while another is sending is never dropped
- v20 · Subscriptions: detector, monthly total, new-charge flag; Home shows one notice at a time
- v19 · Category budgets: monthly limits per category, Insights bars, one Home nudge
- v18 · Your own categories: add, rename (label only), hide; Shortcut accepts them after the script update
- v17 · Monthly report: printable per cycle, PDF, cycle CSV, numbers that add up
- v16 · Smarter categories: learn from past entries, bank-style names, only sure guesses act (PR #8)
- v15 · Activity filters and bulk edit with one undo (PR #10)

- v14 · Spending charts: day by day and weekly, top places, categories over six cycles (PR #7)
- v13 · ▶ test logs nothing, Arabic digits in amounts, `features` list, 3x faster date maths
- v12 · Foundation: date-proof tests, module split, money rows add up, same-account fix, Extras store (PR #6)
