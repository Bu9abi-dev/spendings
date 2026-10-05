# Spendings

A personal money tracker for iPhone. Apple Pay payments are logged as they happen through a Shortcuts automation, and everything lives in your own Google Sheet.

- **Capture:** each Apple Pay payment sends its amount, merchant and card to the sheet. You pick a category from a menu, or decide later.
- **Accounts:** ADIB (emergency/online), ADCB (personal allowance, AED 3,000 per cycle), BOTIM (extra) and Cash.
- **Entry types:** spend, income and transfers between your own accounts. Amounts are in AED, or USD at the 3.6725 peg.
- **Pay cycles:** the 27th to the 26th. Each cycle gets its own tab in the sheet.
- **Home screen:** shows the allowance left as liquid in a glass capsule, money in/out, accounts, and a *Needs review* inbox.
- **Insights:** category donut, allowance pace, per-account and income breakdowns, and the last six cycles.
- **Design:** Apple's design language with Liquid Glass chrome, spring motion and dark mode. It respects Reduce Motion and Reduce Transparency.
- **Reliability and privacy:** works offline (queued sync), optional Face ID lock, and CSV export.

**Start here:** [SETUP.md](SETUP.md)

## Layout

| Path | What |
| --- | --- |
| `docs/` | The web app: static HTML, CSS and JS modules, no build step. Served by GitHub Pages. |
| `apps-script/Code.gs` | The Google Sheet backend. Paste it into the sheet's Apps Script. |
| `tests/apps-script.test.mjs` | Runs the backend against a fake sheet: `node tests/apps-script.test.mjs` |
| `PRODUCT.md` | Product context. |

To try it locally, run `cd docs && python3 -m http.server` and open `http://localhost:8000/?demo=1`.
