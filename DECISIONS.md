# Decisions

Choices made while running the app on my own, newest first, with the reason for each.

## 30 Oct 2026

- **BNPL (branch `claude/bnpl`):** a plan (Tabby, Tamara, Postpay, card instalments) lives in Extras under `bnpl`
  and never changes a balance. Money only counts as spent when an instalment is paid: "Mark paid" logs a normal
  Spend ("Tabby · Noon", the plan's category and account) through `addEntry`, so balances, sync and undo work as
  for any payment. Choices made along the way:
  - **Paid is derived, not stored as a flag.** An instalment points at the ledger entry that paid it and counts as
    paid only while that entry exists. Deleting or undoing the payment makes it unpaid again without a second
    write, and nothing can be "paid" twice.
  - **One Undo for Mark paid.** It's two changes (an entry and the plan), so `store.js` got `together(label, fn)`,
    which folds them into one history step.
  - **"Sync" matches every unpaid instalment, not just the next one** (merchant contains the provider name, within
    AED 1 and ±5 days of that instalment's own due day; closest day wins; one entry pays one instalment). A plan
    added halfway through picks up all its past payments at once. It runs after each change to entries or extras,
    saves only when it found something new, and isn't an Undo step (`saveExtra(…, { undoable: false })`): the app
    did it, not Abdullah. "Unlink" remembers the entry so it's never auto-linked to that plan again.
  - **The editor is a form, not the keypad sheet.** A plan has nine fields; the payday-plan form pattern fits them
    on one screen, with a live preview ("2 × AED 333.33, then AED 333.34 … last on 27 Nov").
  - **"Already paid" for a new plan** marks the first instalments paid with no entry (the first one is usually
    taken at the till, before tracking), so no fake spending is logged.
  - **Deleting a plan keeps its payments** in Activity: they were real spending.
  - Demo mode gets two plans whose instalments are already in the demo ledger as Apple Pay payments, so the
    linking is visible straight away.
  - Fixed a date-dependent check in `verify-iphone.mjs`: it compared the Where rows on screen with unrounded
    numbers instead of the largest-remainder whole numbers the card actually shows, so it failed whenever the
    demo numbers needed a nudge.
- **Custom categories keep the sheet's names fixed.** A category's id is what the Ledger stores, so renaming one
  (built-in or yours) only changes the label the app shows, and hiding only takes it out of the pickers. Past entries,
  the Apple Pay Shortcut's menu and remembered merchants keep working, and no Ledger cell is ever rewritten. Your
  own categories share the grey "other" colour, because the eight-colour palette is the checked colour-blind-safe set.
  Saved in the `categories` extra. A category can only be deleted while no entry uses it; otherwise hide it.
- **Apps Script accepts your own categories from the Shortcut** (`spendCategories_()` reads the Extras tab), and a
  renamed label maps back to its id. Needs the script redeploy, like v12's Extras; until then a custom category sent
  by the Shortcut lands in Needs review, which is the old behaviour.
- **Ran one council over three branches** (smart-categories, activity-filters, monthly-report): five Sonnet advisors,
  each reviewing all three, synthesis by the loop thread. Transcript: council/council-transcript-2026-10-30-wave1.md.
- **Took over the wave-1 threads that hit their limit.** Budgets, subscriptions and BNPL were rebuilt by subagents
  on their own branches from main.

- **Charts (v14, PR #7):** the trend maths lives in a pure `trends.js` so it's testable and stays out of other
  branches' way. Refunds aren't netted against days or places, matching "Spent". "Usual" isn't pro-rated for the
  current cycle (bills land on fixed days); the card says "so far" instead. Pick a day by press-and-slide so the
  whole cycle fits on an iPhone.
- **Small changes get one Opus reviewer instead of the full council** (v13 script batch). The reviewer found
  that Arabic digits in Apple Pay amounts parsed as 0, which was fixed before merge.
- **Release bumps after a thread's PR go straight to main** as a version + changelog commit, so I don't push to
  another thread's branch while it may still be working on it.

- **Bulk edits are one undo step.** `batch(label, fn)` in store.js groups the changes: one undo entry, one
  save, one redraw and one sync at the end. Undo replays the reversals backwards. Each entry still goes to
  the sheet as its own add/update/delete, so Code.gs didn't change (a bulk delete of 50 is 50 quick calls).
- **Activity filter totals count spending and income only.** Transfers and bank matches move money, they
  aren't spending (money rule). Refunds show under "In", as they are income entries.
- **Amount filters compare AED value**, so a USD entry is filtered by what it cost in dirhams.
- **A transfer matches the account filter on either side**, so "ADCB" shows the allowance landing.
- **Bulk category change only touches spending and income entries.** Transfers and bank matches have no
  category; the sheet says how many stay as they are. Spending and income get their own category rows.
- **Select mode hides the tab bar and + button** and puts Category and Delete in their place (like Photos).
  Leaving the Activity tab drops the selection. Filters stay until cleared, so coming back keeps the view.

- **Council on the foundation PR, lighter format.** Five advisors ran; they agreed so closely that I wrote the
  synthesis myself instead of spending six more agents on peer review and a chairman. Full council (with
  peer review) stays the rule for wave-1 features. Transcript: council/council-transcript-2026-10-30-foundation.md.
- **Phone-only extras win over the sheet** when the updated script first answers. They were saved later than
  anything the old script could have stored. Tracked per key, not with one flag.
- **Same account for allowance and main: Safe to spend is capped at that account's free money.** Otherwise
  Safe to spend could exceed the money that exists. Abdullah uses two accounts, so this changes nothing for him.

- **Monthly report is one HTML page with its own light "paper" styles**, not a PDF library. iPhone Safari
  turns any page into a PDF from the print sheet, so "Save as PDF" prints just the report (the app is hidden
  while printing). Because print can be unreliable from a Home Screen app, **Share** also hands the report
  over as a stand-alone web page file (Save to Files, AirDrop, or Print from there). No new dependency, works offline.
- **The report counts money like the rest of the app**: transfers listed apart and never as spending,
  refunds shown separately and taken off "Spent", bank matches only change "Total money". "Total money
  at the end" uses only entries dated before the cycle ended. Budgets are read from Extras `budgets` as
  `{ Category: 600 }` or `{ Category: { limit: 600 } }`, so it works with either shape the budgets branch picks.
- **Per-cycle CSV uses the same columns as the full export**, so the two files line up in a spreadsheet.

- **Review step uses the council skill.** The `council:council` skill is installed, so major features
  go through it before merging. Smaller fixes get an Opus code-review subagent instead.
- **Feature branches don't bump the version or the changelog.** Several threads build features at the
  same time. If each bumped `VERSION` in `docs/sw.js` and edited CHANGELOG.md, every merge would conflict.
  The loop thread bumps once per merge.
- **New features save their data in an "Extras" tab, one JSON value per key.** Abdullah's rule is "add
  tabs or columns only, never overwrite". One generic tab means budgets, goals and the rest need only one
  Apps Script update instead of one each. If the sheet still runs the old script, the app keeps extras on
  the phone and sends them up after the update, so nothing waits on the redeploy.
- **Split Activity and Insights out of main.js** into their own files (plus `views.js` for shared bits),
  so parallel threads edit different files. No behaviour change.
- **Fixed two date-dependent tests**, not the app: the fake sheet's `getSheets()` returned a live array
  (real Apps Script returns a copy), and the dismiss test assumed today was before the 1st's Nafis payday.
  The dismiss test now pins the clock to 5 Oct 2026.
- **"Where your money is" rows use largest-remainder rounding**, so the whole numbers shown always add up
  to the total shown. Rows that round to 0 are hidden.
- **Allowance account = main account is handled, not blocked.** Settings allows it, so Safe to spend is
  now subtracted from Emergency money instead of counted twice.
