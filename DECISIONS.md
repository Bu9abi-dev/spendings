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

- **Charts (v14, PR #7):** the trend maths lives in a pure `trends.js` so it's testable and stays out of other
  branches' way. Refunds aren't netted against days or places, matching "Spent". "Usual" isn't pro-rated for the
  current cycle (bills land on fixed days); the card says "so far" instead. Pick a day by press-and-slide so the
  whole cycle fits on an iPhone.
- **Small changes get one Opus reviewer instead of the full council** (v13 script batch). The reviewer found
  that Arabic digits in Apple Pay amounts parsed as 0, which was fixed before merge.
- **Release bumps after a thread's PR go straight to main** as a version + changelog commit, so I don't push to
  another thread's branch while it may still be working on it.

- **Council on the foundation PR, lighter format.** Five advisors ran; they agreed so closely that I wrote the
  synthesis myself instead of spending six more agents on peer review and a chairman. Full council (with
  peer review) stays the rule for wave-1 features. Transcript: council/council-transcript-2026-10-30-foundation.md.
- **Phone-only extras win over the sheet** when the updated script first answers. They were saved later than
  anything the old script could have stored. Tracked per key, not with one flag.
- **Same account for allowance and main: Safe to spend is capped at that account's free money.** Otherwise
  Safe to spend could exceed the money that exists. Abdullah uses two accounts, so this changes nothing for him.

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
