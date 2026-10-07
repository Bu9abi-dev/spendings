# Executor (live app session)

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
