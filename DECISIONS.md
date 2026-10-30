# Decisions

Choices made while running the app on my own, newest first, with the reason for each.

## 30 Oct 2026

- **Money owed (`people.js`, `people-ui.js`), as the council decided:** a person is an account (so the sheet's
  Accounts tab, rename-follow-through and unique names come for free) flagged in the `people` extra
  (`{ v: 1, names: [...] }`). `balances()` still counts them; `ACCOUNTS` leaves them out (balance bar, pay pickers,
  Settings → Accounts, Match with bank, Insights), and `moneyTotal()` keeps them out of All your money, Where your
  money is and the report's total. Allowance: a Transfer from the allowance card to a person adds to `used` (as
  `lent`); one from a person into it is a top-up. Mirrored in Code.gs so the Shortcut's "left of your allowance"
  agrees. A split is the Spend cut to your share plus a Transfer of theirs with id `${spendId}-split` and source
  `Split` (ids survive the sheet round trip and no column changes); their share is rounded down to the fil, so the
  leftover fil is yours, in the entry's own currency (each half is then priced in AED separately, so a USD split can
  differ from the whole by a fil in AED). One person per split; a split payment can't be split again (edit their
  half instead). "Change both" copies date, currency and card to the other half (amounts: see the council fixes below). A removed person
  stays in `people` (so last cycle's loans still count as allowance used) and re-adding the name brings them back.
  People take Accounts-tab rows, and the script keeps 20, so adding stops at 20 accounts and people together.
  Code.gs: `mapCard_` and `ownAccountIn_` skip people, because `mapCard_`
  also matches a card by account name as a substring (a person called "Visa" or "Al" could have caught a card);
  with no Extras tab nothing changes.
- **Money owed, council fixes (30 Oct, after the build review):**
  - **Bank alert after a split.** `twinOf_` also matches an auto-logged Spend (Apple Pay / Bank alert) whose
    `<id>-split` Transfer (looked up by id: its source is `Split`, not an automatic one; same card and currency) makes
    the amounts add up to the alert. Still one-to-one (the Spend becomes `Apple Pay + Bank alert`), and a split Spend is
    never turned into a top-up. Old payloads and unsplit payments match exactly as before. Needs the script redeploy.
  - **USD splits add up in AED.** Their share is priced at the rate; yours is the bill's AED price minus theirs (the
    bill keeps the price it already had). Both prices go to the sheet: `updateEntry` sends `amountAED` only when the
    caller sets it on purpose (a split, "Change both"), so normal edits and new amounts are still repriced by the sheet;
    `addEntry` and the script's add keep a USD entry's given `amountAED` (an add without one is priced as before).
  - **Settle up pays back where the money came from:** the account of the latest Transfer from your own accounts to
    that person (a loan or their share of a split), else the main account. From the allowance card that's a top-up,
    so Safe to spend recovers. "You owe" still pays from the main account. The sheet is titled "Ahmed pays you back" /
    "You pay Ahmed".
  - **Home has one notice line.** The owed line sits in "Where your money is", under "All your money" (which it isn't
    part of). When that card isn't on screen (an account lens, balances not set) it joins the notices at the lowest
    rank (`owed`), so it never stacks under another.
  - **"Change both" keeps the bill adding up.** A new amount on one half: the card was charged the whole bill, so the
    bill stays and the other half takes the difference; if the new amount is the whole bill or more, the other half
    grows in proportion instead. The question sheet says which, with the new amount. Bulk delete in Activity now takes
    the other half of any ticked half too (one undo) and says so.
  - Split toast "Split · your share AED 43.68"; "Split with someone" sits above the keypad; Settings → People says,
    while extras are phone-only, that the script update makes Apple Pay card matching ignore people; the BNPL plan's
    "Paid from" never offers a person (a plan saved with one shows the allowance card).
  - `verify-owed` adds a BNPL plan and a split in one cycle: Home total, Safe to spend and `cycleReport` agree.

- **Savings goals and net worth (after the council):** goals and investments live in Extras (`goals` = `{ v: 1, goals }`, `investments` = `{ v: 1, items }`); anything without `v: 1` reads as empty. A goal follows the accounts it names, or a typed amount "set aside by hand". Money on an account is handed to goals in goal order and a goal takes only what it still needs, so no dirham counts twice; an account feeding two goals shows "Shared with <goal>". Each account counts as `max(0, balance)`. Account ids are account names, so renaming an account remaps the goals directly in `state.extras` inside `updateAccount` (queued for the sheet, no undo step of its own; undoing the rename renames back and remaps again). Archived accounts stay in a goal, labelled "(archived)"; a deleted one says "account missing". "Save AED Y per cycle" counts the cycle holding the date plus every one between, but the current cycle only if 7 or more days of it remain (at least 1 while the date is ahead). Net worth = total money + typed-in investments − the real BNPL owed (`bnplSummary(readBnpl(getExtra('bnpl')).plans, state.entries).owed`), so a deleted payment makes an instalment owed again; goals never add to it. No broker connection and no keys, by design. Both cards sit on Insights with a Manage link to Settings.
- **The flaky extras test was a test bug, but it led to a real app race, now fixed.** The test's `settle()`
  used `waitForFunction` with an `async` check. Playwright treats the Promise the check returns as "true", so
  settle never waited and the test sometimes looked at the sheet before the last change got there. It now
  waits until the outbox is really empty. Looking at the outbox also turned up a real way to lose data: the
  app took a sent change off the queue with `shift()`. If you saved the same extra (or the plan, or accounts)
  again while the first copy was still on its way, the old copy was already gone from the queue, so `shift()`
  threw away the *next* change instead, for example a different phone-only extra, which then never reached
  the sheet. An edit to an entry whose add was still sending was folded into the add after it had already
  left, so the edit was lost too. Now a sent change is removed by identity, and nothing is folded into the
  change that's sending. `verify-extras` holds a request mid-flight to check both cases.
- **BNPL (branch `claude/bnpl`):** a plan (Tabby, Tamara, Postpay, card instalments) lives in Extras under `bnpl`
  and never changes a balance. Money only counts as spent when an instalment is paid: "Mark paid" logs a normal
  Spend ("Tabby · Noon", the plan's category and account) through `addEntry`, so balances, sync and undo work as
  for any payment. Choices made along the way:
  - **Paid is derived, not stored as a flag.** An instalment points at the ledger entry that paid it and counts as
    paid only while that entry exists. Deleting or undoing the payment makes it unpaid again without a second
    write, and nothing can be "paid" twice.
  - **One Undo for Mark paid.** It's two changes (an entry and the plan), folded into one step with main's
    `batch(label, fn)` (an earlier `together()` was removed: one grouping system).
  - **Council fixes (30 Oct):** Mark paid first looks for a payment already in Activity that's probably this one
    and asks "Link this payment" or "Log a new payment", so nothing is counted twice. Every new auto-link shows a
    toast with Unlink, and paid rows show the payment they're matched to. Auto-link takes entries oldest first and
    gives each to the earliest unpaid payment it fits (a late payment pays the overdue one, up to 5 days after the
    next one is due), and when two plans fit equally it links neither. Plan changes save with their own undo
    (`saveExtra(…, { reverse })`) that touches only that change, read fresh at undo time, so undoing an edit never
    wipes links found since; the editor merges with the plan as it is at Save, and once a payment is paid the total
    and count are locked. Toast Undo uses `topUndoId()`. Plan payments are `source: 'BNPL'` and are never learned
    as merchants (categorize.js, the store and `Code.gs`; the script part needs the redeploy, harmless until then).
    On screen it's "Buy now, pay later" and "payment". Home gets one notice through `homeNotice` (`bnpl:overdue`
    first of all, `bnpl:due` within 7 days after `sub:new`); "AED X due before payday" is information in the
    sheet and Insights, never taken off a balance or Safe to spend.
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
- **Subscriptions (`recurring.js`, Insights card + one Home notice):** a place counts when its charges repeat weekly
  (6-8 days, needs 4 charges), monthly (26-35) or yearly (350-380), amounts within 15% of the previous charge, so a
  small price rise stays one subscription ("was X"). Two monthly or yearly charges are enough only if they match
  within 5%. Groceries and Food & Drinks are never detected (a weekly shop or coffee is a habit), and Transport &
  Fuel / Health need three charges, unless the name is a known subscription brand. Names are grouped by the shared
  `merchantKey` from `categorize.js`; "Not a subscription" stores that same key in the Extras key `recurring`
  (with undo and "Show again"). "New this month" = the current run started in the last 35 days (run start, not the
  place's first ever charge). "Maybe cancelled" = next payment over 7 days late, left out of the total. Detection is
  remembered per `state.entries` array. The card only shows on the current cycle. Home shows one notice, only when
  actionable: a new subscription charged in the last 7 days, else one due within 3 days (`subscriptionNotice`,
  returns `{ priority: 'new'|'due', text }` so Home can cap notices later). The notice opens the current cycle's
  Insights card, where "Not a subscription" lives. The monthly report adds "Subscriptions AED X/month".
- **Category budgets, after the council and the v18 merge:** Settings already had "Budget" (the allowance), so the
  Settings block is "Category limits" and the Insights card is "Category budgets". Names and icons come from
  `allCategories('Spend')`/`categoryMeta` (never the shown-only list), so a limit on a hidden, renamed or custom
  category keeps its look, and the label is what's shown everywhere. Settings lists only categories that have a
  limit plus an "Add a limit" row that opens a chooser of shown categories. Home's decision is the pure
  `budgetNotice(rows, { isCurrent })` returning `{ priority: 'over'|'near', text }` (or null), so Home can later cap
  itself at one notice; it only appears for the current cycle and tapping it resets Insights' sticky cycle
  (`resetInsights()`). A row under 1 AED over shows cents, exactly at the limit says "At the limit". The sheet's
  only footer is "Refunds aren't taken off; they count as money in." Deleting a custom category in Settings →
  Categories also clears its limit, as one undo step (`store.batch` around the two `saveExtra` calls).
- **Category budgets (branch `claude/category-budgets`):** limits are saved as `{ v: 1, limits: { <categoryId>: AED } }`
  under the `budgets` extra, one limit for every cycle (no per-month overrides yet). "Spent" is exactly Insights'
  `summarize().byCategory`: every account, transfers excluded, refunds not netted off (a refund doesn't free up budget).
  80% is "near", 100% is "over" (exactly at the limit counts as over). Percent is shown rounded down so "99%" never sits
  beside a red "over". Home shows at most one line, for the fullest budget, with "and N more" if several are flagged;
  it isn't a real dismiss, it just disappears when nothing is at 80%, and tapping it opens Insights. Insights shows the
  card for whichever cycle is being viewed, against the same limits; with no budgets it shows a "Set a budget" prompt that
  jumps to Settings. Settings has a Budgets section (one row per category, tap for a sheet with a number field, Save, and
  Remove); the keypad wasn't used, matching the payday plan's amount field. Unknown category ids (a category removed
  later) still get a row, called by their id. Maths and HTML are in `budgets.js` (no store import, so it runs in Node
  tests); the store wiring and sheet are in `budgets-settings.js`.
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

- **Weekly summary and allowance pace alert** (`weekly.js`, `weekly-ui.js`). A week is Monday to Sunday by Dubai days; "last
  week" is the last full one. Spent is Spend only and gross, the same rule as Insights (transfers out, refunds not netted),
  checked against `summarize` in the test. The "usual week" is the median of the six weeks before it that have any spending,
  and needs at least three of them, otherwise it is null and the line just says what was spent. Within 5% reads as "about the
  usual". "Coming up this week" runs from today to the next Monday plus anything overdue, and only reuses `detectRecurring`,
  `dueBetween`/`bnplSummary` and `budgetRows` (budgets at 80% or more). The pace alert uses Home's own pot and used numbers
  (`allowancePot`, `allowanceUsed`, so lending and refunds count as everywhere else): used divided by days gone is the daily
  rate, and it fires only from 3 days into the cycle, only when the allowance is not already spent, and only when it runs out
  on a day before the cycle's last day (the 26th). Home ranks it just after "budget over" (`pace:out`); the week summary is the
  lowest rank (`week:summary`, after `owed`), shows on Mondays and Tuesdays only and only if last week had spending.
  Opening the summary saves `{ v: 1, seen: <week key> }` in the `weekly` extra with `undoable: false`: the Undo button would
  otherwise offer to "undo" having read a summary, and it would sit on top of the real last change. It still syncs like any
  extra, so it does not reappear on another device. Tapping the pace line opens Insights on the Allowance pace card.
