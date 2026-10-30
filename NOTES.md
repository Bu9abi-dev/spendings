# Notes for the next session

Read this first. It says where the app stands, how to work on it, and what's in flight.
Kept current by whoever is working on the app (Claude, running the improvement loop).

## Where things stand (30 Oct 2026)

- `main` is deployed by Vercel (Root Directory `docs`). Every branch also gets a preview deploy.
- Apps Script backend: `apps-script/Code.gs`. Changes only reach the sheet after Abdullah pastes the file
  into Apps Script and deploys a **new version of the existing deployment** (same URL).
  - Last script change: v12 (Extras tab). **Not yet redeployed** as of 30 Oct. Until it is, extras stay
    on the phone (`state.extrasLocalOnly`) and get sent up automatically afterwards.
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
- Sheet safety: never delete or overwrite Ledger data. New data goes in new tabs or the Extras tab.

## Code map

| File | What |
| --- | --- |
| `docs/js/model.js` | Pure maths: cycles, balances, allowance, Home numbers, "Where your money is" rows. |
| `docs/js/store.js` | State, localStorage cache, offline outbox, Apps Script client, undo history, Extras (`getExtra`/`saveExtra`). |
| `docs/js/main.js` | Router, Settings tab, review sheet, Shortcut guide, global click/keyboard/swipe handlers. |
| `docs/js/home.js` | Home tab (balance bar, account lenses, payday plan, match with bank). |
| `docs/js/activity.js` | Activity tab (search, filter chips, day groups). |
| `docs/js/insights.js` | Insights tab (donut, allowance pace, accounts, income, six cycles). |
| `docs/js/views.js` | Shared bits: entry row, sync badge, large title + undo button, demo banner. |
| `docs/js/entry.js` | Add/edit entry sheet with keypad. |
| `docs/js/charts.js` | SVG charts. |
| `docs/js/report.js` | Monthly report sheet: per-cycle numbers (`cycleReport`), printable page, PDF/share/CSV. |
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

## Wave 1 threads (started 30 Oct 2026)

Briefs: `/mnt/project-files/loop/wave1-briefs.md`. Each thread messages the loop thread when its PR is ready.
1 smart-categories, 2 category-budgets, 3 spend-charts, 4 recurring, 5 activity-filters, 6 monthly-report
(branches `claude/<name>`). Foundation PR: #6.
