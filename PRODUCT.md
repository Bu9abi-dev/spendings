# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Delegated: static HTML, CSS and JavaScript (ES modules), no build step, so a non-developer can maintain it. The front end is hosted on GitHub Pages from `docs/` (the repo is private). The backend is a Google Apps Script web app bound to the user's Google Sheet.

## Users
One person in the UAE who tracks their own money on an iPhone running iOS 27, using the app installed to the home screen. They pay mostly with Apple Pay from three cards in Apple Wallet. They want each payment logged at the moment it happens, with almost no effort.

## Product Purpose
Record every dirham in and out across their accounts, and answer the daily question: "how much of my allowance is left this cycle?" Success means no payment goes unlogged, and the Google Sheet is always a complete and readable record.

## Positioning
Capture happens inside Apple Pay itself. A Shortcuts Wallet "Transaction" automation posts each payment straight to the user's own Google Sheet, before they open any app. The Sheet is theirs and stays readable without the app.

## Operating Context
- Apple Pay at a till: a Shortcut runs, the user optionally picks a category from a menu, and a notification confirms the payment with the allowance left.
- Manual entries (cash, transfers, income) are made in the app.
- Review later: payments without a category wait in a "Needs review" inbox.
- Google Sheet: one Ledger tab holds the record, and generated tabs per pay cycle (named by month) hold summaries and a chart.

## Capabilities and Constraints
- Accounts:
  - ADIB: emergency and online card. Non-emergency use should be flagged.
  - ADCB: personal allowance, AED 3,000 per cycle.
  - BOTIM: extra card.
  - Cash.
- Pay cycle runs from the 27th to the 26th. A cycle is named by the month it ends in.
- Entry types: Spend, Income, Transfer.
- Spend categories: Food & Drinks, Groceries, Transport & Fuel, Shopping, Bills & Subscriptions, Entertainment, Health, Family & Gifts, Travel, Other.
- Income categories: Salary, Allowance, Gift, Refund, Other.
- Currency is AED, with occasional USD converted at the fixed peg of 3.6725.
- An iOS web app cannot observe Apple Pay. Capture runs through Shortcuts, which open Safari rather than the installed app, so the Shortcut posts directly to the Sheet.
- Face ID app lock is a nice-to-have, delivered via WebAuthn.

## Brand Commitments
Apple's design language and the iOS 26+ Liquid Glass material, with fluid, spring-based motion. The user made this binding.

## Evidence on Hand
No real transaction data is in the repo. Demo data in the app is synthetic and labelled as such.

## Product Principles
- Capture beats completeness: an uncategorised row is still a true record.
- The user's Sheet is the source of truth. The app is a fast, cached lens on it.
- Answer "what's left" before "where did it go".
- Never lose an entry: queue offline, dedupe retries.
