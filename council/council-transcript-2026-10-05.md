# LLM Council transcript (2026-10-05)
Original question: the user's spending-tracker idea (iPhone PWA, Apple Pay prompt, Google Sheet sync with month tabs, cards ADIB/ADCB/BOTIM, income, charts, Liquid Glass).

Anonymisation map: A = Executor, B = Outsider, C = Contrarian, D = Expansionist, E = First Principles.

Peer review: all five reviewers ranked E (First Principles) the strongest, with C close behind. All five flagged A's Open-URL/local-first flow as the biggest blind spot.

# Framed question
A single user in the UAE wants a personal money-tracking web app used mainly on iPhone (home-screen PWA). Apple Pay prompt to log (via iOS Shortcuts Wallet "Transaction" automation, iOS 17+, exposes Amount/Merchant/Card). Log: amount, card, category, note; manual entries too; income as well as spending. Cards: ADIB (emergency/online), ADCB (personal allowance), BOTIM (extra). Sync to Google Sheet with a tab per month (Apps Script web app). Charts. Apple design language / iOS 26 Liquid Glass / fluid animation. Hosting likely GitHub Pages. Decision: v1 scope, architecture (Sheet vs local-first source of truth), Apple Pay capture flow, which additions are worth it.

## Response A
Executor-style: Start with the riskiest piece — Apps Script doPost (find/create tab "2026-10", append id,timestamp,type,amount,card,category,note,source; shared secret; deploy Anyone; curl test), then build the Wallet automation on the real phone and verify Amount/Merchant/Card come through (UAE banks/Botim may not fill Merchant). Capture: Shortcut opens github.io/spendings/#/add?amount&merchant&card, PWA prefilled, pick category, Save. Skip direct POST from shortcut (it skips category). Local-first: IndexedDB + outbox flushing to Apps Script via text/plain/no-cors; client UUIDs for idempotency. Stack: Vite + vanilla TS/Preact, Chart.js, GH Actions to Pages; watch base path/start_url/scope. v1: add form, list, monthly pie, in vs out, per-card balance, glass + springs. Cut budgets/AI/OCR/recurring/multi-currency/reading back from Sheet. Keep merchant→category auto-suggest. Ask: iOS version, are all 3 cards in Wallet, category list, income sources.

## Response B
Outsider-style: Open URL from a Shortcut opens Safari, not the home-screen PWA; separate storage, so local-first breaks. Shortcut should POST straight to Apps Script as "Needs review", optional in-Shortcut Choose-from-Menu for category; PWA shows Inbox badge. Sheet is landing zone, PWA cached viewer/editor. "Prompted" is a banner, set expectations. Setup is the real product: one-tap iCloud Shortcut link + setup screen with "send test transaction". Transfers between own cards, refunds, splits, cash withdrawals need handling. Daily question is "how much allowance left" — lead with ADCB remaining, flag ADIB usage; pies secondary. Wallet card names won't match; one-time mapping; BOTIM may not be in Wallet; AED default. Cut AI/OCR/gamification. Use glass lightly; backdrop-filter stutters on long lists.

## Response C
Contrarian-style: Fatal flaw: Open URL opens Safari, not PWA; separate storage; local-first + Open URL = data lost in Safari. Shortcut should do it all: Choose from Menu category, Ask for Input note, Get Contents of URL POST to Apps Script. Sheet source of truth; PWA reads Sheet, caches, queues offline manual entries. Check BOTIM supports Apple Pay. Trigger flaky: messy merchants, FX amounts, refunds, confirmation taps — need edit/delete. Transfers must be a third type. Apps Script URL public — secret token, LockService, text/plain, don't rely on response. Tab-per-month makes charts painful: one append-only Ledger tab, monthly tabs as generated views. Liquid Glass expensive; nav and sheets only. Cut AI/budgets/OCR/multi-currency.

## Response D
Expansionist-style: Zero-tap capture: Shortcut POSTs immediately as "unreviewed"; PWA inbox to swipe-categorize. Merchant→category learning (lookup table). Cards as envelopes: ADCB monthly allowance with live remaining; ADIB alert on non-emergency use. UAE-native: AED, salary-cycle months (25th–24th), Ramadan/Eid/travel annotations, currency field for trips. Lock-screen/home widget via Shortcut showing "AED X left on ADCB". Sheet as API: raw ledger tab + generated monthly tabs, enables pivots/Looker. Architecture: local-first IndexedDB with background sync; Sheet canonical history. Later: bank SMS/email ingestion.

## Response E
First-principles: The real problem is capture compliance at the moment of payment; trackers die in week two. Apple Pay moment is the product: Shortcut POSTs directly so the row exists before the phone is pocketed; notification "AED 42 at Carrefour · ADCB — tap to categorize". Data first, enrichment optional — an uncategorized row is still truth; an unsubmitted form is lost. Sheet is source of truth (PWA storage evictable on iOS; Shortcut runs outside PWA). Small local queue for offline manual entries only. Month tabs conflate storage and presentation: one Transactions tab, monthly tabs generated. Add: card-purpose semantics (ADIB warning), ADCB weekly burn-down, merchant auto-categorization. Cut AI, OCR, multi-currency, investments. Charts v1: category share + month-over-month.

# Chairman verdict

## Where the council agrees
- The Apple Pay moment is the product. Trackers die in week two because logging is a chore, not because the charts are ugly.
- Use one append-only Ledger tab as the record, and generate the monthly tabs from it. Storing data in tab-per-month breaks cross-month charts.
- A third transaction type, Transfer, is needed. Otherwise moving money ADIB→ADCB counts as both spending and income.
- Learn the category from the merchant name with a lookup table, not AI.
- The cards are really envelopes. Show what's left of the ADCB allowance, and flag non-emergency use of ADIB.
- Use Liquid Glass only on the nav and sheets. Blur on long lists stutters.
- Cut AI insights, receipt OCR, multi-currency and gamification.

## Where the council clashes
- Local-first vs Sheet as the source of truth. The Executor and Expansionist want IndexedDB for instant UI. The Contrarian, Outsider and First Principles want the Sheet. The peer review settles it: a Shortcut's Open URL opens Safari, not the home-screen PWA, and the two keep separate storage. So the Sheet must be canonical, with the PWA as a cached viewer and editor plus an offline outbox.
- A prefilled form vs a direct POST. A direct POST wins. Category is picked with a one-tap "Choose from Menu" inside the Shortcut, and anything skipped lands in a Needs-review inbox.

## Blind spots caught in peer review
- The Shortcut secret is public if it is baked into GitHub Pages JS. Enter it once on the device instead, and validate on the server.
- Duplicate triggers and retries can double-post. Dedupe with a deterministic id.
- Merchant names starting with "=" become live formulas in the Sheet, so sanitise them.
- Offline at the till: the Shortcut POST fails silently. A notification shows the failure, and there is a reconcile nudge.
- "Ask Before Running" must be turned off for true zero-tap capture.
- No backup or export, and no app lock on a lost phone.
- Setup is the real product: a setup checklist and a "send test transaction" button.
- Avoid a build step the owner cannot debug.

## Recommendation
Build a Sheet-backed, Shortcut-first capture loop. Pair it with a no-build PWA that leads with "AED left" and puts charts second. Add transfers, the merchant memory and card envelopes. Then harden it with a token, dedupe, LockService and formula sanitising.

## One thing to do first
On the real iPhone, create a Wallet Transaction automation that shows a notification with Amount, Merchant and Card. Make one Apple Pay payment with each card to confirm what iOS actually provides.
