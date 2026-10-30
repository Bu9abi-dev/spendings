# Council: spending charts (PR #7), 30 Oct 2026

Default council (Contrarian, First Principles, Expansionist, Outsider, Executor), Sonnet advisors.
To save credits, the peer review and chairman steps were done by the thread itself, not by separate agents.

**Question.** Is PR #7 (Insights: day/week spend bars, top places, six-cycle category trends) ready to merge? What has to be fixed first?

## Where the council agreed
- The money maths is right. Only Spend counts, transfers are left out, and refunds stay income, the same as the donut.
- Every chart must add up to the "Spent" already on screen, and tests should prove it.
- The day boundaries need a test (23:59 and 00:01 Dubai time).
- The "usual" figure must be honest. There should be no "Usual AED 0" for a new category, and a part-logged first cycle shouldn't drag it down.

## Fixes applied
1. **Thin day bars are hard to tap (Contrarian, First Principles).** A finger now picks the nearest bar and can slide along to scrub. Tapping the picked bar again clears it. Vertical scrolling still works (`touch-action: pan-y`).
2. **A future-dated spend could show in the week but not the day (Contrarian).** Days to come are now drawn empty only when nothing is on them.
3. **"Usual" was biased (Contrarian, Outsider).** It now skips the first-ever cycle when a later one exists, and it's null ("Nothing before this") instead of 0 when the category had nothing earlier.
4. **The short last week looked like a spending drop (Contrarian, First Principles).** It's now labelled "2 days". The week readout says weeks count from the cycle's first day.
5. **Top places didn't add up to Spent (Contrarian).** Added an "Everything else" row.
6. **Labels (Outsider).** Short category names (no "Bills & Subscripti…"). The legend now explains the dashed average line, the current cycle reads "so far", and the six-cycle card explains its bars. The card is titled "Day by day".
7. **Tests (Executor, First Principles).** Added Dubai day-boundary, reconciliation (trends, top places), cycle-id ordering, short-week label, scrub and keyboard checks. Now 32 checks.

## Not done (with reasons)
- **sw.js VERSION bump.** The loop thread bumps it once per merge, to avoid conflicts between parallel branches.
- **Fuzzier merchant matching ("Carrefour Marina" vs "CARREFOUR").** That belongs to the smart-categories branch. `merchantKey` can be swapped for its matcher later.
- **Expansionist ideas.** These are logged as backlog follow-ups, not part of this PR: tap a place to filter Activity, an "over usual" flag feeding the weekly summary, and "on pace for X this cycle".
