# Contrarian (live app session)

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
