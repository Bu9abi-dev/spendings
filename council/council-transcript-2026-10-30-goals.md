# Council: savings goals and net worth, 30 Oct 2026

Three Sonnet advisors (Contrarian, Outsider, Executor). All: merge after fixes.

## Must fix
1. **Net worth ignored BNPL debt**: the branch guessed the BNPL data shape and always got 0. Use `bnplSummary(readBnpl(getExtra('bnpl')).plans, state.entries).owed` from docs/js/bnpl.js (on main once BNPL merges) and delete the guess and its test fixtures. Test with a real plan + ledger entries, including a deleted payment that makes an instalment unpaid again.
2. **The same money counted in two goals**: two goals on one account each showed its full balance. Allocate each account's money to goals in goal order (no dirham counted twice), and show "shared with <goal>" when an account feeds more than one goal. Test it.
3. **Negative balances**: use Math.max(0, balance) per account in a goal.
4. **Missing, archived or renamed accounts**: account ids ARE account names (model.js setAccountList: id = name). In store.js updateAccount, inside the rename branch, remap the `goals` extra's account ids from old to new name directly in state.extras (no second undo step; the rename's undo reverses it) and make sure the change reaches the sheet (enqueue the extra like saveExtra does, without recording). Keep archived accounts in a goal (label "(archived)") instead of dropping them on edit; show "account missing" rather than a silent 0.
5. **cyclesUntil**: the current cycle counts as a full one even on the 26th. Count the current cycle only if ≥ 7 days remain in it (state the rule in a comment), and test the 26th/27th boundaries.
## Should fix
- Fallback ids can collide (`g${n}`): use uid() from model.js.
- Sheets capture the goals list when opened; read fresh at Save time.
- Net worth card sub-line: "What you own minus what you owe." and "Goals don't add to this."
- Wording: "set aside by hand". Tap targets ≥44px for sheet text buttons and account chips.
- Cards on Insights get a "Manage" link to Settings #goals / #investments.
