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
