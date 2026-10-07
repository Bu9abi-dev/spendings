# Anonymised responses (live app session)

## Response A

Cold use in light and dark, at 390×844 and 375×667. About 10 screenshots and 12 findings posted live.

## Ranked findings
1. **Too many competing "left" numbers on Home, none explained:** 22,489 total, 14,520 free in ADIB, 1,850 left to spend, 86% left. The flow chart's "Kept in ADIB 290" doesn't match "14,520 free".
2. **The "Left this cycle" card flips units.** It shows 86%, and after tapping "It landed" it showed "AED 88". *(Confirmed bug: the number-roll code from the old allowance card reformats any capsule value as AED.)*
3. **ADCB:** a balance of 3,896 next to "Allowance left 1,850", with no explanation of the difference.
4. **Settings opens with the technical Google Sheet form**, and its placeholders are cut off.
5. **The tab bar and + button cover content:** "It landed" is half hidden mid-scroll, and the last rows are hidden on a small phone.
6. **The Undo toast follows you across tabs** and covers the Theme switch.
7. **Unclear wording:** "Match with my ADCB app", and the faded "Matched with bank · exact" rows.
8. **The disabled "Choose a category" button doesn't explain itself**, and the keypad hides the second row of categories.
9. **ADIB and ADCB both get the "AD" avatar.**
10. **Truncation:** the search hint, "Bills & Sub…", "Needs categ…".
11. **"AED 50 ahead of pace" is red**, so ahead reads as bad.

## Positives
- Strong polish in both themes and a distinctive liquid card.
- A clear payday checklist.
- Undo works, and there were no JS errors.

## Strongest recommendation
One headline number, "Safe to spend", with a plain-English definition. Every other figure becomes a labelled sub-figure that adds up to it, with one unit per card.

## Response B

Ran 7 loops, posting 8 screenshots and 7 findings.

## Tap counts (390×844, dark)
| Job | Taps |
| --- | --- |
| Check what's left | 0 (hero line) |
| Log a coffee from a quick-add chip | 2 |
| Log a new coffee from + | 5 (+, 1, 8, Food, Save) |
| Mark Nafis landed | scroll + 1 ("It landed" starts hidden under the tab bar). The hero's "Nafis +4,500 due now" isn't tappable. |
| Move the allowance by hand | about 9: Transfer defaults to ADCB → ADIB, the reverse of the owner's move. ("Move now" in the plan is 1 tap.) |

## Ranked findings
1. **Bug:** the "Left this cycle" card flips from 86% to "AED 88" after a change. `main.js` re-rolls `.cap-value` with an AED formatter.
2. **Make the hero Nafis line a button** that runs the same "landed" action.
3. **Category is required even for a repeat merchant.**
4. **Transfer defaults the wrong way round.**
5. **On a 375×667 phone**, one sideways-scrolling category row hides Bills, Health and Other.

## Next three changes
1. Fix the % bug.
2. Make the hero Nafis line tappable.
3. Prefill from the last spend at a merchant, and default transfers to main → allowance.

## Response C

Ran at 375×667 in dark and light: about 8 loops and 6 screenshots.

## Ranked findings
1. **Huge amounts break Home.** A 9,999,999 spend made the hero spill off the screen, so the page scrolls sideways (468 px wide on a 375 px screen). There's no warning when ADCB goes to about −10M: no overdraft or sanity check.
2. **Removing an account leaves broken payday rules.** After removing BOTIM, "BOTIM top-up" became a move from ADIB into ADIB.
3. **"Left this cycle" % moves when income lands.** The base grows from 26,001 to 30,501 with no spending in between, which is misleading.
4. **Small phone:** the category row and note field sit half under the keypad, the toast overlaps the card, and ADIB and ADCB share the "AD" badge.
5. **New spends default to ADCB**, not the ADIB hub.

## What held up
- Undo stepped back through three adds exactly.
- Removing the main or allowance account is blocked.
- A transfer can't go from an account to itself.
- Keypad decimals are handled correctly.
- No JS errors.

## Strongest recommendation
- Make numbers robust: fit or abbreviate the hero, and warn before an overdraft or a huge amount.
- When an account is removed, carry the change through to the payday plan.

## Response D

Did 3 loops and about 4 screenshots. Did not test undo, the keypad, or the payday-plan buttons.

## Ranked findings
1. **The hero is the wrong number.** "All your money 22,489" leads. The real question is "what can I spend and am I okay?", answered by "14,520 free in ADIB · 1,850 left to spend" in small text below. It is unclear which of those is the budget.
2. **"Left this cycle 86%" is redundant and misleading.** It is balance ÷ (balance + spent) and says nothing about pace. On ADIB it repeats the hero number.
3. **The pace answer is buried.** "Allowance pace" (AED 50 ahead) is only on Insights. It belongs on Home.
4. **The allowance is defined twice:** as the payday-plan move (3,000 ADIB → ADCB) and as the Budget "Allowance per cycle 3000". The two can drift apart.
5. **One money flow is shown three ways:** the payday plan, the flow chart, and the ADIB split. Responsibilities show 1,965 on Home while Settings lists 450, 2,325 and 1,500.
6. **Small phone (375×667):** the tab bar overlaps the glass card, and the demo banner plus the hero take most of the first screen.

## Strongest recommendation
Make the first screen answer "am I okay?":
- The hero is Free in ADIB.
- One line under it: "allowance X left, Y ahead or behind pace".
- Remove the % card and the flow chart from Home.
- Define the allowance once.
- Keep total money as a secondary line.

## Response E

Drove the app at 390×844 in dark mode only: Home, Insights, Settings, and the add-entry sheet.
Posted 3 screenshots, 6 findings and a `done` event to the live page, in two batches.

## Ranked ideas
1. **30-day ADIB forecast with a "lowest point" marker**, built from the payday plan (salary, Nafis, car and phone, home, fuel).
2. **Daily safe-to-spend number on Home**, based on the Insights allowance-pace chart. Extend the same pace line to BOTIM.
3. **Learn merchant → category so the inbox shrinks over time.** Show uncategorised spending as a fix-it chip instead of a pie slice (it was 325, 9%).
4. **Close the Apple Pay loop:** feed bank notifications into the Shortcut so salary and Nafis confirm "It landed" automatically and bank matches happen on their own.
5. **"Committed vs truly free"**: subtract upcoming bills and protect an emergency floor.
6. **Emirati touches:** Ramadan and Eid pacing (Eidiya, gifts), zakat or gold, a family ledger.

## Smaller notes
- The tab bar overlaps the payday "It landed" button in full-page captures. This is probably a capture artifact.

## Strongest recommendation
The 30-day ADIB forecast.
