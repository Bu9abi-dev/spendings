# AI sync log

**Hand this file to any new AI session or assistant first.** It is the full context needed to keep working on
Spendings without asking the owner anything. Read it top to bottom, then [NOTES.md](NOTES.md) (how to work),
[BACKLOG.md](BACKLOG.md) (what's next) and [DECISIONS.md](DECISIONS.md) (why things are the way they are).

Last updated: **30 Oct 2026**, at **v29**. Whoever works on the app updates the "Current state" and "Session log"
sections at the end of every session (newest first).

---

## 1. What this is

- **Spendings** is a personal iPhone money tracker for one person, Abdullah (GitHub `Bu9abi-dev`). He's a student
  in Abu Dhabi who also works as a cashier and invests. Currency is **AED** (USD at the 3.6725 peg).
- Apple Pay payments are logged automatically by an **iPhone Shortcut** (Transaction automation) that POSTs to a
  **Google Apps Script** web app bound to **his own Google Sheet**. The web app (this repo's `docs/`) reads and edits
  the same sheet.
- Pay cycles run **27th → 26th**. Accounts: **ADIB** (main, salary lands), **ADCB** (allowance card, AED 3,000 per
  cycle, "Safe to spend"), **BOTIM**, **Cash**. He can add his own accounts and people.
- Abdullah is **not a developer** ("vibe coder"). Keep code simple, readable and commented. Explain results in
  plain words, never jargon.

## 2. How the owner wants the work done (standing instructions)

- **Work autonomously.** Don't stop to ask; pick the safest reasonable option, log it in DECISIONS.md, keep going.
- **Feature branches** (`claude/<name>`), merge to `main` only after **all tests pass** and a **council review**
  (the `council` skill, or 3–5 advisor subagents) for major features and design/architecture choices. Smaller
  fixes: one reviewer. `main` must always stay deployable.
- **Never delete or overwrite his Sheet data.** Add tabs/columns only; new feature data goes in the **Extras** tab
  via `saveExtra()`. Back up before any schema change.
- **Never commit secrets**, API keys, or Sheet IDs with write access. (A Google OAuth *client ID* is public and OK.)
- **Keep the Apple Pay Shortcut and bank-notification endpoints backward compatible.** Never break them.
- **Mobile-first**: must work great on iPhone Safari as a home-screen app. Apple design language, dark mode,
  Reduce Motion, 44px tap targets.
- Use subagents in parallel; cheapest model that can do the job (Haiku easy, Sonnet normal, Opus hard/review).
- After each merge: bump `VERSION` in `docs/sw.js`, add a CHANGELOG.md entry (plain words, for him), update
  DECISIONS.md and BACKLOG.md, and keep NOTES.md and **this file** current.

## 3. Money rules (never break)

- Transfers between his own accounts are **never spending**.
- Refunds are **income**; "Spent" is gross everywhere (Insights, budgets, report).
- Unused ADCB allowance stays as a buffer; **Safe to spend resets each cycle**. A pre-payday top-up adds to the new
  cycle's allowance. Lending from the allowance card to a person counts as allowance used.
- The **All** tab shows total money. People (money owed) and BNPL debt are shown separately, never mixed into it.
- Every number on screen must add up with the others (largest-remainder rounding, "Everything else" rows).
- Run `tests/verify-maths.mjs` and `tests/verify-undo.mjs` before touching balance, pace or undo logic.

## 4. Architecture in one minute

| Part | Where | Notes |
| --- | --- | --- |
| Web app | `docs/` | Static ES modules, no build. Vercel deploys `main` (Root Directory `docs`); every branch gets a preview. |
| Backend | `apps-script/Code.gs` | Paste into the sheet's Apps Script; **Deploy → Manage deployments → new version** (same URL). Changes do nothing until he redeploys. |
| Data | His Google Sheet | Ledger (true record), cycle tabs, Settings, Accounts, Plan, Merchants, **Extras** (one JSON value per key). |
| Offline | `docs/sw.js` + `store.js` outbox | Bump `VERSION` whenever app files change; new files go in `SHELL`. |
| Tests | `tests/` | `bash tests/run-all.sh`, or each `node tests/<name>.mjs` with `NODE_PATH=$(npm root -g)`; browser tests read `BASE`. |

Code map, extras keys and conventions: see NOTES.md. **`docs/setup/Code.gs.txt` must stay byte-identical to
`apps-script/Code.gs`** (the setup guide uploads it; a test checks). Extras keys in use: `budgets`, `recurring`, `categories`,
`bnpl`, `goals`, `investments`, `people`.

## 5. Current state (v29, 30 Oct 2026)

**Live on main** (newest first): v29 accessibility · v28 budget line in the Apple Pay reply · v27 performance pass (memoised sums, lazy Activity rows) · v26 weekly summary + allowance pace alert · v25 first-time setup guide + Sign in with Google (off until a client ID is set) · v24 money owed + split bills · v23 savings goals + net worth · v22 buy now, pay later (Tabby/Tamara, auto-linked
payments) · v21 safer syncing (outbox race fix) · v20 subscriptions + one Home notice at a time · v19 category
budgets · v18 custom categories · v17 monthly report (PDF/CSV) · v16 smarter auto-categories · v15 Activity filters
and bulk edit · v14 spending charts. Full list: CHANGELOG.md.

**In flight** (branches pushed, not merged):
- `claude/arabic`: Arabic / English toggle (i18n module, RTL). Touches every UI string; merge it before other UI work.
- `claude/test-stability`: condition waits instead of fixed sleeps; run-all.sh exits non-zero on a failure.

**Waiting on Abdullah** (things only he can do):
1. **Redeploy the Apps Script** (paste the latest `apps-script/Code.gs`, Deploy → Manage deployments → ✏️ → New
   version). Covers v12 Extras tab, v13 Shortcut fixes, v18 custom categories from the Shortcut, v22 BNPL guard,
   v24 people/split guards, v25 setup install + key adoption, v28 budget line in the
   Apple Pay notification. Until then, feature settings live on the phone only and sync later.
2. **For Sign in with Google**: create a Google Cloud OAuth client ID (steps in SETUP.md → "Switch on Sign in with Google") and put it in
   `docs/js/config.js`; turn on the Apps Script API at script.google.com/home/usersettings.
3. Check on a real iPhone: "Save as PDF" in the monthly report from the home-screen app.

**Known rough edges**: a few browser tests can fail on timing when many run at once (rerun before chasing);
categories learned from a wrong bulk filing can reinforce themselves (backlog).

## 6. How the loop runs

1. Read NOTES.md, BACKLOG.md, this file. Audit for bugs and rough edges.
2. Pick the highest-value BACKLOG item; build it on `claude/<name>` (usually a subagent in its own worktree).
3. Run every test. Council review (transcripts in `council/`). Send fixes back. Re-test.
4. Merge to main (`--no-ff`), bump VERSION, CHANGELOG entry, push. Check Vercel deployed:
   `curl -s https://api.github.com/repos/Bu9abi-dev/spendings/commits/main/status` shows "Vercel success".
5. Update DECISIONS.md, BACKLOG.md, NOTES.md, and this file's sections 5 and 7.

Gotchas: **never edit `state.entries` or an entry in place** — replace the array (sums are cached on its identity,
see model.js); feature branches never bump VERSION or edit CHANGELOG (conflicts); when merging, keep **main's** `SHELL`
and test list and add the branch's files; `categoryMeta(id)?.label` for names, `pickerCategories`/`allCategories`
for lists (never copy `SPEND_CATEGORIES` at import time); Home shows **one** notice (`homeNotice` in home.js); text sizes are rem (body follows iOS Larger Text) and
sheets make the page `inert`, so tests must wait for a sheet to close before typing elsewhere.

## 7. Session log (newest first)

### 30 Oct 2026 · loop session (v15 → v29)
- Took over six wave-1 threads that had hit their usage limit. Ran councils over every branch, applied fixes, merged:
  activity filters (v15), smart categories (v16), monthly report (v17), custom categories (v18, asked for by
  Abdullah), budgets (v19), subscriptions + one Home notice (v20), outbox race fix (v21, found while fixing a flaky
  test), BNPL tracking (v22, asked for by Abdullah as "BNPL sync"), savings goals + net worth (v23).
- Design council chose "people as accounts" for money owed; built, reviewed, fixed and merged as v24.
- Abdullah asked for a first-time setup tutorial with Sign in with Google that creates the sheet and script:
  built, security-reviewed (key race, never-overwrite), merged as v25 with Google off until a client ID is set.
- Weekly summary + pace alert: council sent the pace alert back (three pace rules disagreed); one shared
  `allowancePace` in model.js now; merged as v26.
- Performance pass (v27): DOM was the cost, not maths; lazy Activity rows + memoised sums; reviewer found and
  the builder fixed a lost-scroll bug and a notice-order trap before merge.
- Abdullah asked for this file.
