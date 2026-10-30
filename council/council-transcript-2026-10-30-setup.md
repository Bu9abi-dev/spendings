# Council: first-time setup + Sign in with Google (branch claude/setup-wizard), 30 Oct 2026

Contrarian (Opus, security lens), Outsider, Executor (Sonnet).

## Agreed
- The Google API calls and manifest match Google's documented APIs; key hijack isn't possible (the Setup tab is only
  read when the script has no key yet); user text is escaped; Shortcut payloads unchanged.
- **Nothing real has touched Google yet.** With no client ID the Google path is off and the manual path works.

## Must fix
1. **Overwriting a pasted sheet**: "empty" was judged by entries alone, so a sheet with accounts/settings/plan but no
   entries got them replaced. The server decides: `install` reports `fresh: true` only when it just built the Ledger;
   answers are pushed only then. `install` skips restyling a sheet that already has a Ledger.
2. **Key race**: two first requests could both see "no key"; one adopts the Setup tab key, the other invents a random
   one → locked out. Take the script lock in `getToken_` and re-read under it.
3. **iPhone home-screen sign-in may not open Google's window**: on popup errors say "Open this page in Safari to sign
   in" and make the by-hand path prominent, never an endless "tap again".
4. **Google's real wording**: "Go to Spendings (unsafe)"; say how to come back to the app and land on the same step.
5. **Turn on the Apps Script API before sign-in**, as its own step (every new user needs it); keep the 403 detection.
6. Duplicate sheet after a lost reply: look for an app-made sheet first (Drive `appProperties`) or at least warn.
## Should fix
- Plain three-step progress (Sign in · Make your sheet · Allow it), say up front it needs a Google account and ~5 min.
- Script scope `spreadsheets.currentonly`.
- Safari vs home-screen storage note on the allow step; SETUP.md: run the guide in Safari first.
- Keep docs/setup/Code.gs.txt identical to Code.gs after v24's script changes.

## Decision
Merge after the fixes with the Google path off until Abdullah adds a client ID (SETUP.md has the steps). The tutorial
is still useful without it (cards, money, by-hand connect), and the Google path is only switched on deliberately.
