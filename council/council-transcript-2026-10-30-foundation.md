# Council: foundation PR #6 (30 Oct 2026)

Default council (Contrarian, First Principles, Expansionist, Outsider, Executor), Sonnet advisors.
The five advisors agreed closely, so the loop thread wrote the synthesis itself and skipped the separate
anonymous peer-review and chairman agents to save credits (logged in DECISIONS.md).

## Question
Is the foundation branch sound to merge and build six features on? Is a generic key→JSON Extras store
right over per-feature tabs; what's wrong with its sync/fallback; are the rounding and same-account
changes right against the money rules?

## Where the council agreed
- Extras over per-feature tabs: unanimous. One Apps Script redeploy instead of six.
- The single global "phone-only" flag could strand keys, and the sheet could overwrite newer phone edits. (5/5)
- Undo of a brand-new key left a literal null in the sheet. (4/5)
- The rounding target should be the total itself, not the sum of rows. (3/5)
- Same-account: negative or oversized Safe to spend gives odd rows; test both. (5/5)
- Show the owner when settings are only on the phone. (2/5)

## Claims checked and rejected
- "Undo ping-pongs into redo": undo() mutes recording, so the reversal records nothing. Verified by test.
- "saveExtra_ needs its own lock": doPost already holds a script lock around every action.
- "Largest remainder can end with spare < 0": the floor sum never exceeds the total. The algorithm was still
  replaced (round, then nudge both ways) so −0.30 no longer shows as −1.

## Applied
1. Per-key `extrasUnsent` list replaces the flag. On the first sheet read after the script update, every
   phone-only key wins and is sent up, even if something else was saved first. Tested.
2. `null` clears a key on both sides; the sheet stores an empty cell, not "null". Tested.
3. Rounding targets `Math.round(m.total)`; rows round to nearest and are nudged by a dirham to add up. Tested
   with fractions and a tiny negative.
4. Same account: Safe to spend is capped at the account's free money; an overspent negative still adds up. Tested.
5. Settings shows "Some settings are only on this phone" until the script is updated.
6. Extras keys validated (letter first, no prototype keys), reads use Object.hasOwn.

## Deferred to backlog
- Apple Pay notification could say "Food 87% of budget" by reading Extras in Code.gs (Expansionist).
- A capability flag in `ping`/`list` instead of matching "Unknown action".
