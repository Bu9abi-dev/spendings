# Outsider (live app session)

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
