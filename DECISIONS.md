# Decisions

Choices made while running the app on my own, newest first, with the reason for each.

## 30 Oct 2026

- **First-run setup guide, with "Sign in with Google" that makes the sheet** (branch `claude/setup-wizard`).
  Welcome → your cards → your money → create your sheet → Apple Pay Shortcut → done, in one tall sheet.
  - **When it opens by itself:** not connected, not in demo, never finished or put off, and the app opened at
    Home. A link straight to `#settings` (that's where the by-hand connect form is) or `?notour` skips it, which
    also keeps every existing test that starts on a fresh profile unchanged. "Not now" puts it off for good;
    Home's "Set up" button and **Settings → Set up step by step** open it again.
  - **Answers stay in `sp.setup` until a sheet is connected,** then go up through the store (`applySetup`:
    accounts, then settings, then the plan, one sync, no undo step). They are only sent to a sheet the guide
    made, or a pasted sheet that has no entries yet. "I already have a sheet" on a phone that's new to an
    existing sheet never overwrites its accounts or plan.
  - **Cards start from the current list** (ADIB, ADCB, BOTIM, Cash), so Abdullah only confirms; anyone else
    renames or removes. The plan the guide writes is just Salary (if given) and the allowance move from the pay
    account to the allowance card (none if they're the same account; then the allowance is a plain setting).
    Nafis and responsibilities are added later in Settings → Payday plan. Re-opening the guide while connected
    skips the cards and money steps, so it can never overwrite real data.
  - **Google sign-in is the Google Identity Services token model**, loaded only when the Create step opens (so
    the popup opens within the tap, which iPhone Safari requires). Scopes: `drive.file`, `script.projects`,
    `script.deployments`. The token is kept in memory only, never stored. The client ID lives in
    `docs/js/config.js` (public, not a secret) and is empty for now: then the step says it isn't switched on
    and offers the by-hand path (link to SETUP.md plus "paste URL and key"), so the guide works end to end
    without Google.
  - **Provisioning (`docs/js/provision.js`)**: one Sheets API call makes the spreadsheet *with* a "Setup" tab
    holding the app's key (A1 a marker, A2 a 24-character key from `crypto.getRandomValues`), then Apps Script
    API: bound project → code + manifest → version → web app deployment (Anyone, run as me). Each ID is saved
    to `sp.setup.progress` as soon as it exists, so Try again carries on and never makes a second sheet.
    Errors get plain words: Apps Script API off for the user (link to script.google.com/home/usersettings),
    sign-in expired or cancelled, pop-up blocked, offline, an API off in Google Cloud.
  - **The key:** scripts can't have their properties set from outside, so Code.gs's `getToken_()` now adopts
    the key from the Setup tab the first time it needs one (only when there's no key yet, so sheets set up by
    hand never look at it), then deletes the tab (or empties and renames it if it's the only one).
  - **Allowing the script:** the web app runs as the owner, who must approve its permissions once. The guide
    links to `/exec?setup=1` (Google asks there; `doGet` then shows "Spendings can use your sheet ✓") with the
    script editor as a fallback ("choose setup, tap Run"), and asks the sheet every 4 seconds (and on return to
    the app) until it answers. Then `install` builds the tabs and the answers are sent.
  - **Code.gs, backward compatible:** `setup()` is now `setupSheet_()` + the popup; new `install` action (no
    popups); any action other than ping on a sheet with no Ledger builds the tabs first. Old payloads, the
    Shortcuts and existing deployments behave exactly as before. `features` is now `['extras', 'install']`.
  - **Manifest scopes:** `spreadsheets` (what a by-hand setup already asks for, since Code.gs has no
    `@OnlyCurrentDoc`) and `script.container.ui` (the sheet's menu and popups). `spreadsheets.currentonly` would
    be narrower but couldn't be tried against real Google here, so parity with the by-hand setup won.
  - **The browser gets Code.gs from `docs/setup/Code.gs.txt`**, a byte-identical copy; `tests/verify-setup.mjs`
    fails if they differ. It isn't in the service worker's shell (59 KB, only needed online during setup).
  - **Referrer-Policy is now `strict-origin-when-cross-origin`** (was `no-referrer`): Google's sign-in checks
    the page's origin, and `no-referrer` is known to break it. Only the origin is sent cross-site; the app's
    URLs never hold the key.
  - **Done step shows the URL and key with copy buttons.** On iPhone, Safari and the Home Screen app keep
    separate storage; if setup ran in Safari, these get pasted into the Home Screen app (and the Shortcut).

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
