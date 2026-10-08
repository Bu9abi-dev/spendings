# Spendings

A personal money tracker for iPhone. Apple Pay payments are logged as they happen through a Shortcuts automation, and everything lives in your own Google Sheet.

- **Capture:** each Apple Pay payment sends its amount, merchant and card to the sheet. You pick a category from a menu, or decide later.
- **Accounts:** ADIB (emergency/online), ADCB (personal allowance, AED 3,000 per cycle), BOTIM (extra) and Cash.
- **Entry types:** spend, income and transfers between your own accounts. Amounts are in AED, or USD at the 3.6725 peg.
- **Pay cycles:** the 27th to the 26th. Each cycle gets its own tab in the sheet.
- **Home screen:** all your money as one number, drawn over a bar whose segments are the real balances of ADIB, ADCB, BOTIM and Cash.
  - Tap or drag along the bar to focus one account; the number morphs and that account's details slide in.
  - **ADIB view:** splits into responsibilities, money still to move, and emergency money.
  - **ADCB view:** shows the allowance as liquid in a glass capsule.
- **Payday plan:** salary and Nafis wait for an "It landed" tap, and the allowance move is one tap. A to-scale flow drawing shows where ADIB's money went this cycle.
- **Your accounts:** add, rename, recolour or remove accounts. A rename follows through every past entry and the sheet. When you remove an account, the app asks where its remaining money should go first.
- **Match with bank:** type what a bank app shows and the app books the difference, so balances never drift.
- **Insights:** category donut, allowance pace, per-account and income breakdowns, and the last six cycles.
- **Design:** Apple's design language with Liquid Glass chrome, spring motion and dark mode. It respects Reduce Motion and Reduce Transparency.
- **Reliability and privacy:** works offline (queued sync), optional Face ID lock, and CSV export.

**Start here:** [SETUP.md](SETUP.md) · **What changed in each version:** [CHANGELOG.md](CHANGELOG.md)

## Layout

| Path | What |
| --- | --- |
| `docs/` | The web app: static HTML, CSS and JS modules, no build step. Hosted on Vercel (Root Directory `docs`). |
| `apps-script/Code.gs` | The Google Sheet backend. Paste it into the sheet's Apps Script. |
| `tests/apps-script.test.mjs` | Runs the backend against a fake sheet: `node tests/apps-script.test.mjs` |
| `tests/verify-sync.mjs` | Checks quiet retries, the delayed spinner and skipped re-reads in the real app: `(cd docs && python3 -m http.server 8765 &) ; node tests/verify-sync.mjs` |
| `PRODUCT.md` | Product context. |

To try it locally, run `cd docs && python3 -m http.server` and open `http://localhost:8000/?demo=1`.
