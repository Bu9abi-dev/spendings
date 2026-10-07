# LLM Council transcript: Spendings v2 (2026-10-07)

The question is in q2-framed.md. The anonymised responses are in q2-responses.md.
Mapping: A = Executor, B = Expansionist, C = Contrarian, D = Outsider, E = First Principles.

## Peer reviews (summary)
- **R1, iOS feasibility.** Strongest A. Biggest blind spot B (DeviceMotion permission, battery, gesture clashes). All missed: render budgets, Apps Script cold starts, Low Power Mode, testing on real hardware.
- **R2, originality.** Strongest B, as the only committed metaphor. Biggest blind spot A, because a Wallet card stack is a template. All missed: a visual identity, i.e. material, typographic voice, UAE vocabulary (dirham symbol, Arabic numerals), tactile details.
- **R3, finance correctness.** Strongest C, with A runner-up. Biggest blind spot B. All missed: the mid-cycle dip between salary and Nafis, expected income shown apart from the actual balance, per-currency balances, the cycle-versus-continuous-balance view.
- **R4, motion.** Strongest E (the only one to name interruptibility). Biggest blind spot B. All missed: drag-scrubbable transitions, velocity retargeting, the total number morphing into the account balance, haptics at settle, transform/opacity only, reduced motion.
- **R5, daily habit.** Strongest E, then D. Biggest blind spot B. All missed: a one-line daily verdict, a "waiting for Nafis" state, a "last matched N days ago" cue, widgets.

## Chairman verdict

**Where the council agrees**
- Balances must be real and trusted. Enter opening balances once, add a one-tap "Match my bank" that books an adjustment, and show when an account was last matched.
- Transfers are first-class.
- Salary and Nafis are expected income the user confirms with a tap. They are never auto-logged.
- ADIB is the hub. Its balance splits into money still reserved for responsibilities, money still to move (the allowance), and the rest, which is emergency money.
- Motion only where it carries meaning: money moving, numbers morphing, interruptible springs.
- Use the user's own words, not "net" or "received".

**Where it clashes**
- *Navigation.* The Wallet stack (A, D, E) is cheap and native, but critics call it the most template-like option and say it hides the total. The river metaphor (B) is the most original but decorative and risky. Resolution: neither. The total's own proportional bar becomes the account switcher.
- *Responsibilities list.* C worries it will go stale. Resolution: it updates itself from what ADIB actually spends in each category, so it needs no upkeep.

**Blind spots caught**
- A "waiting for Nafis" state.
- The mid-cycle dip between the two paydays.
- The total number morphing into each account's balance.
- A drag-scrubbable switcher.
- UAE-specific identity, starting with the new dirham symbol.

**Recommendation**
1. Build the home around one true number, total money, drawn over a bar whose segments are the real account balances. Drag or tap the bar to focus an account; the number morphs and the details slide in from the side you moved towards.
2. Add a Payday plan: salary, Nafis, the allowance move and responsibilities. It becomes a checklist each cycle and powers the ADIB emergency figure.
3. Add a flow drawing of the cycle: income → ADIB → the other accounts and spending.
4. Glass stays only on floating chrome.

**One thing to do first:** the balance model, meaning adjustments, plan items and a balance per account. Everything else depends on it.
