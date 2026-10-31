# Decisions

Choices made while running the app on my own, newest first, with the reason for each.

## 31 Oct 2026

- **Security headers** (v35): a Content-Security-Policy in docs/vercel.json. Scripts only from the app and
  `accounts.google.com/gsi/client`; network only to the app, the sheet's script (script.google.com /
  script.googleusercontent.com) and the Google APIs the setup guide uses; no framing; no plugins; no forms.
  `style-src 'unsafe-inline'` stays because the app uses inline `style="--x:…"` everywhere and the report page has
  an inline `<style>`; scripts never get 'unsafe-inline' or 'unsafe-eval'. Checked by tests/verify-csp.mjs on a
  server that sends the same headers (tests/csp-server.mjs).
  - Not done: constant-time key comparison in Code.gs (timing over Google's web app front end isn't measurable)
    and rate limiting (a 24-character random key can't be guessed).

- **Sign in with Google asks only for `drive.file`** (v34). Abdullah wants anyone to be able to sign in, not just
  people on Google's test-user list. The `script.projects` and `script.deployments` scopes are "sensitive": a
  published app using them needs Google's verification (weeks, a privacy policy, a demo video) and shows the
  "unverified app" screen until then. `drive.file` is non-sensitive, so the app can be published straight away.
  - Cost: the app can no longer create, push and deploy the Apps Script itself. The guide now makes the sheet
    (Drive + Sheets, as before, with the app key in the Setup tab), then shows six steps to paste the script and
    deploy it, and a box for the Web app URL. The script already adopts the key from the Setup tab
    (`installerKey_`), so the person never copies the key. No Code.gs change.
  - The "Turn on the Apps Script API" step, the `?setup=1` allow link, and the polling are gone.
  - Considered and rejected: copying a template sheet (its bound script comes along) via a `/copy` link. It
    would need a public template kept in step with Code.gs, and the deploy still has to be done by hand.
  - Supersedes the scopes and the "Apps Script API step" points in the 30 Oct setup-guide entries below.

## 30 Oct 2026

- **Setup guide: the council's fixes** (council/council-transcript-2026-10-30-setup.md; these replace the
  matching points in the setup-guide entry below).
  - **The sheet decides whether the guide's answers go in.** `install` answers `fresh: true` only when nobody
    has used the sheet: it just built the Ledger (and no Accounts/Settings/Plan/Extras/Merchants tab of yours
    had anything in it), or setup() built it and it still has no entries and the same accounts, settings, plan,
    merchants and extras that setup made (a fingerprint saved in the script's properties when the Ledger is
    built; hand edits in the sheet count too). Any other sheet keeps exactly what it has, and the guide says so.
    A sheet set up by an older script has no fingerprint, so it is never fresh. The phone no longer guesses
    from entries.
  - **`install` leaves a sheet that already has a Ledger alone**: no restyling, no tabs moved.
  - **`getToken_` takes the script lock when there's no key yet and looks again under it**, so two first
    requests can't end up with different keys. If the lock can't be had, the request is told the sheet is busy.
  - **The sheet is made through Drive** (`files.create`, mimeType `application/vnd.google-apps.spreadsheet`,
    `appProperties { spendings: '1', setupId }`), with a random setup id saved on the phone before the call. If
    the reply is lost, the retry lists `appProperties has { key='setupId' … } and trashed=false` first (drive.file
    may list files the app made), so no second sheet. Then the Setup tab (first tab renamed, A1 marker, A2 key)
    is written with the Sheets API; that step is safe to repeat.
  - **Its own "Turn on the Apps Script API" step before sign-in**, linking to script.google.com/home/usersettings
    and saying how to come back (the guide reopens on the same step). The 403 detection stays.
  - **Sign-in window failures** (`popup_failed_to_open`; `popup_closed` in a Home Screen app or a second time)
    say "Open this page in Safari to sign in", offer Open in Safari and Copy the address, and open the by-hand
    path right under the message. No endless "tap again": one Try again in a normal browser, none in the Home
    Screen app.
  - **Words:** Google's exact "Go to Spendings (unsafe)", then "come back to this app, same step"; plain
    three-step progress (Sign in · Make your sheet · Allow it); the welcome says it needs a Google account and
    about 5 minutes; the allow step notes that Safari and the Home Screen app keep separate storage; SETUP.md
    says to run the guide in Safari first.
  - **Manifest scope `spreadsheets.currentonly`** (Code.gs only uses `SpreadsheetApp.getActive()`; a test fails
    if it ever opens another spreadsheet). `script.container.ui` stays because Code.gs uses `getUi()` for the
    sheet's menu and popups.

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
  `dueBetween`/`bnplSummary` and `budgetRows` (budgets at 80% or more). (The pace alert's first rules are replaced by the next bullet.) The week summary is the
  lowest rank (`week:summary`, after `owed`), shows on Mondays and Tuesdays only and only if last week had spending.
  Opening the summary saves `{ v: 1, seen: <week key> }` in the `weekly` extra with `undoable: false`: the Undo button would
  otherwise offer to "undo" having read a summary, and it would sit on top of the real last change. It still syncs like any
  extra, so it does not reappear on another device. Tapping the pace line opens Insights on the Allowance pace card.
- **One pace definition, and a pace alert that waits for a real trend** (council fixes on the weekly branch). Home's pace line,
  the Insights "Allowance pace" text and the "runs out" alert all read `allowancePace` in model.js, from the same summary
  (homeNumbers' `m.sum`, which counts spending before tracking began; Insights now uses it for the cycle we're in, and the
  "Your week" sheet too). Same tolerance everywhere: within max(15, 3% of the pot) of an even spread is on track. The
  "runs out" projection is only worked out when that says over pace, so the alert can never sit beside "On track". It also
  waits for the 7th day of the cycle and spending on at least 3 different days, and only speaks when the allowance runs out
  3 or more days before the cycle's last day. **Lumpy purchases**: we leave any single payment over 25% of the pot out of
  the daily rate (it still uses the pot up), rather than projecting with the median day. The median day reads as zero for
  someone who shops every other day, and it would need refunds and lending worked out per day; leaving lumps out keeps the
  rate on the same "used" number Home shows. Wording: "At this pace (~AED X a day) your allowance runs out around 12 Nov,
  N days early". Tapping it saves `pace: { cycle, outDay }` in the `weekly` extra (`undoable: false`) and it stays quiet
  that cycle until the day moves 3 or more days earlier. Rank: `pace:out` sits just above "budget near", below new
  subscriptions and pay-later and subscription payments due (a payment due is more concrete than a projection). Tests
  set it aside by marking it seen, never by changing the allowance. The week sheet lists budgets under "Budgets this cycle",
  apart from what's due this week, and says "before refunds" when refunds landed that week.
- **Performance pass, part 2 (measured first).** `tests/verify-perf.mjs`: `/?demo=1` at 390x844, CPU throttled 4x, a synthetic
  ledger of 3,000 entries over 3 years. Milliseconds, median of 3, before -> after: Activity tab switch 560 -> 130, typing one
  letter in Activity search 400 -> 120, Home redraw 80-110 -> 50, Home/Insights/Settings tab switches and the add sheet unchanged
  within noise (Home 105-180 -> 90-140, Insights 140-230 -> 160-180, Settings 100-145, add sheet 40-140 -> 70). The finding that
  shaped the pass: the maths was never the cost (balances, summarize, homeNumbers are 0.5-1.5 ms each at 4x even on 3,000 entries,
  after v13's date work); the cost was DOM. Activity drew 400 rows (about 4,000 elements) on every visit and every keystroke,
  and style recalculation of that tree was most of the time. So the big win is **Activity draws 40 rows first and adds the rest as you
  scroll toward them** (an IntersectionObserver on a marker; still capped at 400 with the same footer, "Select all" still covers
  all 400 because it works on data, not on rows on screen). Smaller changes: (1) memoised model functions, all keyed on the
  `state.entries` array identity plus a short settings/plan signature plus `listsVer()` (a counter model.js bumps when the account,
  people or category lists change): `balances`, `summarize` (per cycle, so Insights' six cycles are free on a redraw), an
  `entriesByCycle` index used by allowance/planStatus/hubFlow, `entryIds`, `learn()`, Home's start-of-cycle balances and inflow,
  and BNPL `autoLink` (skipped when entries, plans and settings are unchanged). Each cache has a comment saying when it is
  invalidated. A sync badge or a tab round trip no longer recomputes anything. (2) **`updateEntry` and undo-of-edit now replace the
  entries array instead of editing it in place**; the caches (and the existing recurring.js memo, which had this latent bug) depend
  on that. (3) `homeNotice` asks the features in rank order and stops at an overdue BNPL payment or a budget already over; owed is
  only worked out when nothing else has a notice. Same winner as before. (4) `.swipe .entry { will-change: transform }` gave every
  row its own compositor layer; it is now set on the row being dragged only. (5) The tab cross-fade is skipped when the previous swap
  took over 80 ms (a long list on a slow phone); it was already off under Reduce Motion. The look is unchanged on a fast phone.
  (6) Removed 5 dead CSS rules (`.flow-label`, `.flow-val`, `.acc-tile`, `.acc-figs`, `.card-pick`); no other selector was
  unused, so the stylesheet is otherwise as small as it gets without restyling. Not done: content-visibility (the row count fix made it
  unnecessary), Insights (about 170 ms, mostly SVG and style, not maths).
- **Perf follow-ups (review).** Activity keeps a high-water mark of rows drawn per search/filter, so a redraw (selection, edit, delete, sync) redraws at least as many rows and your place holds; it resets when the search/filter changes or the tab is entered afresh. `balances` and `summarize` keep the last three (entries, settings) combinations instead of one, so Home's filtered balances call and Report/Insights alternating don't evict each other. In `homeNotice`, owed is worked out when the only other candidates are the weekly summary (it ranks above it).
- **Budget line in the Apple Pay / bank-alert reply, and features-based old-script detection.** After a payment is logged, the reply gets one last line when its category has a limit in the `budgets` extra: `Food: AED 412 of 500 this cycle (82%)`. Spend is the same gross rule as Insights (type Spend only, so transfers and income are out and refunds are not netted), for the payment's own cycle (the sheet's start day), and the name is the renamed label from the `categories` extra's `names` when there is one. It is appended after the existing text (which is unchanged), never added for moves or categories with no limit, and wrapped so missing or junk extras (or a non-positive limit) can only drop the line, never fail the logging. Bank alerts share `logCardSpend_`, so they get it too. The percentage is rounded down, like the app. The script now also sends `features` in its `ping` reply, and the app remembers the last `features` it saw (`state.scriptFeatures`, from ping, install and list): a script that lists features without `extras` is treated as old (extras stay phone-only, nothing is sent), and one without `install` is not asked to install. A script that sends no `features` (the oldest) still falls back to matching the "Unknown action" error text.
- **Accessibility pass** (`claude/a11y`, `tests/verify-a11y.mjs`). axe-core runs on every tab and the main sheets, light and dark, at
  390×844 on `?demo=1&notour=1`, and fails on serious or critical issues (before: 45 hits / 100 nodes, after: 0). axe is **not
  added to the repo**: the test finds it on `NODE_PATH`, in `$AXE_CORE`, or `npm pack`s it into the temp folder; with no network it
  skips just the axe scans (set `A11Y_REQUIRE_AXE=1` to fail instead). Choices: a sheet now switches the page behind it off with
  `inert` (not only `aria-modal`, which VoiceOver on iOS follows loosely) and hands focus back to what opened it, or to `#view`
  if that was redrawn; toasts are read out through an always-present `#announce` polite live region (text put into a region that
  appears at the same moment is often skipped) while `#toast` stays a plain group so its Undo is a normal focusable button, the
  Undo toast lasts 7 s (was 5) and waits while focus is on it; the Home account keys and Activity kind chips were `role="tab"`
  with no tab panels, so they are now a group of `aria-pressed` buttons and a `radiogroup`; entry amounts and the pace chart are
  spoken ("spent AED 37.50", "By 12 Nov: spent AED 900, AED 40 over an even pace") with `role="text"` + `aria-label` on the amount
  span, so the visible text and every test that reads it are unchanged. **Contrast**: `--label-2` is #5f5f64 (was #6e6e73, 4.4 on
  the tinted fills), `--warn` #a34809 and `--neg` #b92f27 in light, new `--placeholder` for text that must still be read
  (`--label-3` is now decorative only: chevrons, grabber), a solid red button uses `--on-neg` (white fails on the dark-mode red),
  account chips darken their colour 14% under the white letters, and a cancelled subscription is dimmed by its icon, not by
  `opacity` on the whole row. **Dynamic Type**: `html { font: -apple-system-body }` after a `106.25%` fallback, `body` is `1rem`, and
  every 10–20px text size is `rem` (÷17, so the default looks identical); inputs, keypad, tab bar, FAB and the big balance stay px
  (inputs must stay ≥16px or iOS zooms on focus). At 200% text and 200% zoom (195px wide) no tab scrolls sideways; the only
  layout change needed was letting `.btn-*` pills wrap. Not done on purpose: the white glyph on a category colour (amber, pink,
  green series colours are 2–3:1; the category name sits beside every icon, so it is never the only carrier), heading-order and
  banner-landmark notices (moderate), and per-key spoken amounts on the Home account keys (they read the compact "12.3k").
- **Arabic / English** (`claude/arabic`, `tests/verify-arabic.mjs`). Settings → Language: English (default), العربية, and
  **Match iPhone** (Arabic when the phone's first language is Arabic) as a third choice, because it costs nothing and is what
  iOS apps do; it is saved on the phone (`sp.lang`), not in the sheet, since it is a per-device choice like Face ID. Words live
  in `docs/js/strings/en.js` and `ar.js` (about 1,050 keys, grouped by screen), read through `t()` in `docs/js/i18n.js`; English
  text is unchanged, so every existing test still reads English. Arabic is short Modern Standard Arabic in the style of iOS,
  using the council glossary (council/council-transcript-2026-10-30-arabic.md): المصروف only for the allowance, spending is
  الصرف / صُرف / صرفت, an entry is معاملة, owed is لك / عليك, gender-neutral wording for people, plurals use all six Arabic forms from Intl.PluralRules. **Not translated**: user data, the ids saved
  to the sheet (category ids like "Food & Drinks" stay; built-in categories, the starting account notes and plan items get
  Arabic labels until renamed), notes the app writes into the sheet ("Split: …", "Matched with bank"), **CSV headers** (kept
  English so the sheet and other tools keep reading them), the Apps Script's replies (Code.gs untouched, so "Connected ✓"
  and its errors stay English), and the names of buttons in Apple's Shortcuts app and Google's consent screens (they're
  shown as `<b lang="en">`, since they must match what those apps show). **Currency**: in Arabic the number comes first, then a no-break
  space and "د.إ" («120 د.إ», like UAE bank apps), with the minus inside the number's left-to-right isolate; the dirham glyph
  stays for the big Home balance. English keeps "AED 120" with a normal space: changing it would change the English text
  that every test and the owner's habits read (council asked for a no-break space in both; done in Arabic only, on purpose). **Digits**: Western (as UAE bank apps), dates from Intl `ar-AE-u-nu-latn`. **Direction**:
  `<html dir="rtl">`, logical CSS throughout, the tab bar and + button mirror, swipe-to-delete goes right, chevrons/undo flip;
  amounts stay left to right (money() wraps the number in Unicode LRI/PDI marks, `.num` uses `unicode-bidi: plaintext`, filled-in
  values in a sentence are FSI isolates so "Disney+" stays "Disney+"); the number keypad stays 1-2-3 left to right like the iOS
  keypad. **Charts**: time runs right to left in Arabic, as Swift Charts does in RTL locales (flex bar charts mirror by
  themselves; the SVG pace chart mirrors its x axis in charts.js); the Home "money flow" diagram keeps sources on the left.
  Font: the system font (-apple-system has Arabic), with a little more line height in RTL.
  Council fixes (same branch): row second lines isolate names and notes (`<bdi>`, `unicode-bidi: plaintext`) so Latin text
  is cut at its own end; the buy-now-pay-later matched-payment line wraps; the report footnote has its missing space (in
  English too); date pickers read left to right with one calendar icon; the pace chart's value labels stay on the right
  (away from where the even-pace line starts in Arabic); the plan items the app ships (default and demo, e.g. "Car & phone")
  show in Arabic until renamed; text links in the Activity bar and "Manage" have 44px tap areas. The legend swatch sits
  before its label in reading order (on the right in Arabic), as on iOS. Native date pickers' own format (mm/dd/yyyy in a
  desktop browser) follows the device, not the page, so it is left to iOS.
- **Quick wins (branch claude/quick-wins).** (1) Tapping a Top places row opens Activity with a removable shop chip plus the cycle shown (This cycle, or that past cycle's dates). It filters on a new `shop` field in the Activity filter, matched by the shared `merchantKey` (categorize.js); to make the card's count equal what Activity lists, `topMerchants` (trends.js) now groups by that same key instead of plain lower-case, so bank-style spellings ("CARREFOUR MCC 5411 ABU DHABI AE") merge into one place. (2) "On pace for AED X this cycle (an estimate)" in Day by day: average daily spend so far (every account, same as the bars) times cycle length, rounded to 10, current cycle only, hidden before day 3. Not `allowancePace`: that is allowance-only and a pot-based verdict, this is a plain projection of total spending. (3) `learn()` skips entries filed by accept-all or "File all N" until their category changes by hand. Tracked as an id → category map in localStorage (`spendings.autofiled`, newest 2000), phone only: a sheet column would need an Apps Script change and a lost list only means those entries teach again. Changing the category (or re-filing singly) makes the entry learnable. Single taps and "also file N more" (your own pick) still teach.
- **Tests wait on conditions, not clocks.** Browser tests no longer sleep a fixed time (`waitForTimeout`) to let the page
  catch up: they wait for the thing they need (a selector, the outbox empty, the sheet closed, the page still for 4 frames).
  Polling that needs `import()` or `await` happens inside `p.evaluate`, because `waitForFunction` treats an async
  predicate's Promise as true at once (that was verify-categorize's flake). The 31-second "list was just read" waits in
  verify-extras move the page's `Date.now` forward instead. Waits that test real elapsed time stay (a toast lasting 6 s,
  focus keeping it up, the 3 s spinner). `tests/run-all.sh` runs every test, prints one line per test, and exits non-zero
  naming the failures.
- **Whole-app audit fixes (branch claude/polish).** (1) An account rename now also carries buy-now-pay-later plans (`plan.account`)
  and the `people` list with it, the same way goals already did (`remapExtra` in store.js: queued, no undo step of its own; undoing
  the rename renames back and remaps again). Budgets are keyed by category and the payday plan was already remapped. (2) Account
  names, roles and ids are escaped wherever they go into HTML (Home lens label and account keys, Insights By account). (3) One
  account limit, `MAX_ACCOUNTS = 20` in store.js: `addAccount` returns `{ error }` past it and the account and people screens show it.
  Code.gs `saveAccounts_` refuses more than 20 with the same message instead of quietly dropping the 21st (a refusal reaches the
  app as a sync error; an older app never sends more than it could before, so this is backward compatible). (4) Instalments
  logged by Mark paid (`source: 'BNPL'`) are never a subscription, so they aren't counted twice in Your week and the report.
  (5) Net worth rows are apportioned to the rounded total. (6) Insights "By account" and the report's use one list,
  `spentByAccount` in model.js: your active accounts plus an "Everything else" row (a friend who paid, a removed account), so both
  add up to Spent. (7) A sync's read no longer overwrites a settings change still waiting to go up (pending patches are laid
  over the sheet's copy). (8) The report's allowance for the cycle we're in comes from `homeNumbers` (as Insights), so "left"
  matches Home. (9) The CSV formula guard skips real numbers in the amount columns, so a refund's "-12.5" stays a number.
  All covered by `tests/verify-polish.mjs`.
