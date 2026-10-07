# Council question: redesigning "Spendings" v2

## The product today (built, working)
- iPhone home-screen web app (PWA), no build step (plain HTML/CSS/JS), Apple design language with "Liquid Glass" chrome (floating glass capsule tab bar, glass + button, sheets). Data is stored in the user's own Google Sheet via Apps Script.
- Apple Pay capture: an iOS Shortcuts Wallet "Transaction" automation POSTs each payment (amount, merchant, card) straight to the sheet, asks for a category, and shows a notification.
- Home screen today: a big glass "capsule" that fills with liquid showing ALLOWANCE LEFT (ADCB, AED 3,000 per cycle); money in / out / net for the cycle; "Accounts this cycle" list showing only SPENT and RECEIVED per account (there are no balances); Quick add chips; Recent entries.
- Other tabs: Activity (search, filters, swipe to delete), Insights (category donut, allowance pace line, by-account bars, last 6 cycles), Settings (sheet connection, Apple Pay Shortcut guide, budget, appearance with 8 accent presets + per-card colours, Face ID lock).
- Motion: spring-based sheets with drag-to-dismiss, a tab "droplet" that springs between tabs, number roll on the capsule, liquid level springs.
- Pay cycle: 27th to 26th. Currency: AED (sometimes USD at 3.6725 peg).

## The user (Emirati, UAE, one person, uses it daily on iPhone)
- Income each month: 6,000 AED salary + 4,500 AED Nafis (UAE government salary top-up). They arrive on DIFFERENT days.
- Accounts: ADIB, ADCB, BOTIM (all three cards in Apple Wallet), plus cash.
- Money flow in their own words: "All my money lands initially in ADIB, then I distribute to whichever account I need to or spend directly from ADIB. ADIB is my liability and responsibilities; after paying those (fuel etc.) it leaves me my emergency money." ADCB = personal allowance (3,000 per cycle). BOTIM = extra card.

## What the user just asked for
1. Main screen = ALL accounts combined: show TOTAL MONEY (actual balances), not just spending flows.
2. A way to switch to each account individually to see how much is in it and how much is left.
3. More fluid animations.
4. "Less AI vibes and more innovation." (They feel it looks generic / AI-generated.)

## The decision
What should v2's home and account experience be? Specifically:
- The balance model: how do we get real balances (opening balances? reconcile? recurring income auto-logged on payday?), and how do ADIB's "hub → obligations → emergency money" role and ADCB's allowance show up?
- The navigation pattern for "combined vs each account" (tabs, swipeable cards, a stack like Apple Wallet, something else?) that feels genuinely native and inventive rather than template-like.
- What specifically makes it read as "AI-generated" today, and what concrete design moves replace that?
- Which animations would make it feel fluid rather than decorated?
