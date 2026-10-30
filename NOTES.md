# Notes for the next session

Read this first (and [AI-SYNC-LOG.md](AI-SYNC-LOG.md), the hand-off file for any new AI session; keep both current). It says where the app stands, how to work on it, and what's in flight.
Kept current by whoever is working on the app (Claude, running the improvement loop).

## Where things stand (30 Oct 2026)

- `main` is deployed by Vercel (Root Directory `docs`). Every branch also gets a preview deploy.
- Apps Script backend: `apps-script/Code.gs`. Changes only reach the sheet after Abdullah pastes the file
  into Apps Script and deploys a **new version of the existing deployment** (same URL).
  - Script changes waiting for Abdullah's redeploy (one paste covers all): v12 Extras tab, v13 Shortcut test runs /
    Arabic digits, v18 custom categories from the Shortcut. Until then extras stay on the phone
    (`extrasOnPhoneOnly()`) and are sent up automatically afterwards.
- Work in progress and ideas: [BACKLOG.md](BACKLOG.md). Why things are the way they are: [DECISIONS.md](DECISIONS.md).
  What shipped: [CHANGELOG.md](CHANGELOG.md).

## How to work on it

- No build step. Static ES modules in `docs/js`. Run locally: `cd docs && python3 -m http.server 8765`, open
  `http://localhost:8765/?demo=1`.
- Run every check: `bash tests/run-all.sh` (needs Playwright; in the cloud box `NODE_PATH=$(npm root -g)`).
  Must pass before any merge.
- Money rules (from Abdullah, never break): transfers aren't spending; unused ADCB allowance stays as a
  buffer and Safe to spend resets each cycle; a refund restores exactly; a pre-payday top-up adds to the
  new cycle's allowance; the All tab shows total money. Before touching balance, pace or undo logic, run
  `tests/verify-maths.mjs` and `tests/verify-undo.mjs`.
- The Apple Pay Shortcut (`source=applepay`) and bank-notification Shortcut (`source=bank`) POSTs must keep
  working unchanged. `tests/apps-script.test.mjs` covers both.
- **Code.gs has a copy in `docs/setup/Code.gs.txt`** (the setup guide installs it). Every Code.gs change: `cp apps-script/Code.gs docs/setup/Code.gs.txt`.
- Sheet safety: never delete or overwrite Ledger data. New data goes in new tabs or the Extras tab.

## Code map

| File | What |
| --- | --- |
| `docs/js/model.js` | Pure maths: cycles, balances, allowance, Home numbers, "Where your money is" rows. |
| `docs/js/store.js` | State, localStorage cache, offline outbox, Apps Script client, undo history (`batch(label, fn)` folds several changes into one step; `topUndoId()` for toast Undo), Extras (`getExtra`/`saveExtra`). |
| `docs/js/main.js` | Router, Settings tab, review sheet, Shortcut guide, global click/keyboard/swipe handlers. |
| `docs/js/home.js` | Home tab (balance bar, account lenses, payday plan, match with bank). |
| `docs/js/activity.js` | Activity tab (search, chips, Filter sheet, filtered total, Select mode for bulk recategorise/delete). |
| `docs/js/filters.js` | Pure Activity filter matching and totals (tested in Node by `tests/verify-activity.mjs`). |
| `docs/js/insights.js` | Insights tab (donut, allowance pace, accounts, income, six cycles, Subscriptions card). |
| `docs/js/recurring.js` | Pure: finds repeating payments (subscriptions), monthly cost, next date, new/late flags, Home notice. |
| `docs/js/views.js` | Shared bits: entry row, sync badge, large title + undo button, demo banner. |
| `docs/js/entry.js` | Add/edit entry sheet with keypad. |
| `docs/js/charts.js` | SVG charts. |
| `docs/js/bnpl.js` | Pure buy-now-pay-later maths: payment amounts (last absorbs rounding), due dates, still to pay/next/overdue, auto-linking ledger payments, `likelyPayment` (Mark paid asks before double-counting), `bnplNotice` (the Home line). |
| `docs/js/bnpl-ui.js` | Buy now, pay later screens: Home line, plans sheet, plan editor, link a payment, Settings row, Insights panel; runs the auto-link and its "Linked …" toast. Plan changes save with a custom undo (`saveExtra(…, { reverse })`). |
| `docs/js/budgets.js` | Category budgets: pure maths (spent vs limit, near/over) plus the Insights card, Home line and Settings rows HTML. |
| `docs/js/budgets-settings.js` | Budgets store wiring: read/save limits in the `budgets` extra, and the Settings edit sheet. |
| `docs/js/categorize.js` | Learns merchant → category from past entries; `cleanMerchant` is the one shop-name normaliser. |
| `docs/js/categories.js` | Settings → Categories (your own, rename, hide). Lists live in model.js (`setCategoryList`, `allCategories`, `pickerCategories`, `categoryMeta(id).label`). |
| `docs/js/report.js` | Monthly report sheet: per-cycle numbers (`cycleReport`), printable page, PDF/share/CSV. |
| `docs/js/setup.js` | First-run setup guide (welcome, cards, money, create sheet, Shortcut, done). Auto-opens at Home on a fresh phone; `?notour` or `#settings` skips it. Answers in `sp.setup` until connected, then `applySetup` in store.js. |
| `docs/js/provision.js` | Pure: makes the sheet with Google's REST APIs (Sheets + Apps Script) from a sign-in token; resumable, injectable `fetch`. |
| `docs/js/config.js` | `GOOGLE_CLIENT_ID` for Sign in with Google (public; empty = by-hand setup only). |
| `docs/setup/Code.gs.txt` | **A copy of `apps-script/Code.gs`** that the guide installs. Change both: `cp apps-script/Code.gs docs/setup/Code.gs.txt` (`tests/verify-setup.mjs` checks). |
| `docs/js/people.js` | Pure money-owed maths: split shares and USD prices (`splitPrices`), linked halves (`${id}-split`), "Change both" amounts (`rescaledPartner`), settle-up preset and account (`lentFrom`), recent people, Home line text. People flags and `peopleBalances`/`moneyTotal` live in model.js (`setPeopleList`, `isPerson`, `PEOPLE_ACCOUNTS`). |
| `docs/js/people-ui.js` | Settings → People, add/rename/remove a person (`people` extra + account, one undo step), Home "Owed to you" line (in "Where your money is", or the lowest-rank notice), People sheet with Settle up, split sheet, "half of a split" question. |
| `docs/js/goals.js` | Pure maths for savings goals, investments, net worth and BNPL owed (per-cycle saving needed). Tested by `tests/verify-goals.mjs`. |
| `docs/js/goals-ui.js` | Insights Goals and Net worth cards, the Settings block, and the goal and investment sheets. |
| `docs/sw.js` | Offline cache. Bump `VERSION` when app files change; new files go in `SHELL`. |

## Saving data for a new feature

Use the Extras store, not a new sheet column:

```js
import { getExtra, saveExtra } from './store.js';
const budgets = getExtra('budgets', {});        // read, with a default
saveExtra('budgets', { ...budgets, Groceries: 600 }, 'Changed the Groceries budget'); // save + undo label
```

Keys are short names (`budgets`, `goals`, …): a letter, then letters, digits, `.`, `-` or `_`. Values are
JSON, under ~45 KB each. Make the value an object with a version, e.g. `{ v: 1, limits: {…} }`, so a later
change can migrate it. `saveExtra(key, null)` clears a key. Until Abdullah redeploys the script, extras stay
on the phone (`extrasOnPhoneOnly()`), Settings says so, and they're sent up on the first sync afterwards.

## Merging

Feature branches don't bump `VERSION` or edit CHANGELOG.md (that would make every parallel branch conflict).
The thread running the loop does both when it merges, one version per merge.

## Categories: rules for new code

- Pickers: `pickerCategories(type, current)`. Lists of everything (filters, legends): `allCategories(type)`.
  Never copy `SPEND_CATEGORIES` at import time; it changes when Abdullah edits categories.
- Names on screen: `categoryMeta(id, type)?.label || id`, escaped with `esc`. The id is what the sheet stores and
  never changes.

## People (money owed): rules for new code

- `ACCOUNTS` is your own accounts only; people are in `PEOPLE_ACCOUNTS`. `balances()` has everyone, so add up
  your money with `moneyTotal(bals)`, never by summing every balance.
- Offer people in a picker only where it makes sense (either side of a Transfer, who paid a Spend), in their own group.

## Tests on a shared machine

Browser tests read `BASE` (default `http://localhost:8765`). When several checkouts run at once, serve your own
`docs/` on a free port and run `BASE=http://localhost:<port> node tests/<name>.mjs`. Under heavy load a few
browser checks can fail on timing; rerun before chasing them (see BACKLOG "Tests: stable under load").

## How the loop runs (30 Oct 2026)

Feature work is done by subagents on `claude/<name>` branches (in their own worktrees). The loop thread reviews
each with the council (`council/council-transcript-*.md`), sends fixes back, merges to main one at a time,
bumps VERSION and writes the changelog. See BACKLOG.md "In progress" for what's out.
