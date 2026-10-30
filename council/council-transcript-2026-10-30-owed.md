# Council: money owed and split bills (design), 30 Oct 2026

Three Sonnet advisors (First Principles, Contrarian, Executor). Options: A "person" accounts, B an IOU list in
Extras, C a split field on entries.

## Agreed
- **A, not B or C.** A debt is money you have a claim on, and the ledger already has the right tool: a Transfer.
  B is a second source of truth that drifts from balances; C changes the Ledger and every sum.
- Insights, budgets and the report need no change: they read Spend only, so a split dinner counts only your share.
- **Splitting an Apple Pay payment**: "Split" on the entry → pick a person (recent first) → half / custom → Done.
  The Spend becomes your share and a linked Transfer (same card → person) holds theirs, as one undo step.
  Shares add up exactly to the charge (`apportion`, leftover fils to your share).

## The Contrarian's catches (adopted)
- People must **not** count in "All your money": `balances()` totals every account today, so a friend's +100 would
  pose as cash. Home gets its own line: "Owed to you AED X · You owe AED Y".
- **Lending from the allowance card uses allowance.** A Transfer from the allowance account to a person lowers Safe to
  spend; being paid back into it is a top-up.
- **A person can't go through "Move money & remove"** (that would invent cash). Remove only at a zero balance.
- Editing or deleting one half of a split warns about the other half.

## Decision
- A person is an account (Accounts tab, so rename-follow-through and uniqueness come for free) flagged as a person in
  the `people` extra (`{ v: 1, names: [...] }`), so no sheet schema change. People are left out of the balance bar,
  the account pickers for paying, Wallet matching, "Where your money is", Safe to spend and Emergency.
- A friend paying for you: a Spend of your share with the person as the account (their balance goes negative = you
  owe them). No cash moves, which is true.

---

# Council review of the build (branch claude/owed), 30 Oct 2026

Contrarian, Outsider, Executor (Sonnet). All: merge after fixes; the core maths holds (Spend + `-split` Transfer
add up to the original; people are out of "All your money"; lending from the allowance card counts as used).

## Must fix
1. **Bank alert after a split logs the bill twice.** `twinOf_` in Code.gs matches on the full amount; a split Spend
   only holds your share. Match an auto-logged Spend whose `id + '-split'` partner makes up the alert's amount. Test it.
2. **USD splits drift**: each half is repriced on its own. Your AED = original AED − theirs; send `amountAED` with both.
3. **Settle up repays the main account** even when you lent from the allowance card, so Safe to spend never recovers.
   Default the repayment to the account the money was lent from (the allowance account when that's where it came from).
4. Merge with v22 (store.js outbox/saveExtra/demo extras, main.js click chain, sw.js SHELL, DECISIONS.md).
## Should fix
- Home stacks the owed line under the one notice. Keep it as part of the "Where your money is"/total area, not a second
  notice line (or fold it into the notice order at the lowest rank).
- "Change both" with a changed amount: rescale the other half so the bill still adds up, or say it only syncs date
  and account. Bulk delete includes the other half.
- Shorter split toast ("Split · your share 76.26"); "Split with someone" visible above the keypad; Settle up sheet
  titled "Ahmed pays you back" / "You pay Ahmed".
- While extras are phone-only and people exist, Settings says the script update makes card matching ignore people.
- BNPL's plan account picker never offers a person.
