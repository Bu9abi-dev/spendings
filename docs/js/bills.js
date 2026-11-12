// Bills still to come on the allowance card before this cycle ends, for Safe to spend.
// Known bills only: subscriptions the app has spotted (recurring.js) whose last charge was on the card, and
// buy-now-pay-later instalments (bnpl.js) set to be paid from it. Pure (no DOM, no store), so tests run it.
import { cycleOf, cycleBounds, dayKey } from './model.js';
import { detectRecurring } from './recurring.js';
import { bnplSummary } from './bnpl.js';

/** { total, items: [{ name, amount, day }] } due from today up to the cycle's last day (overdue instalments too). */
export function cardBills({ entries, settings, now = new Date(), ignored = [], plans = [] }) {
  const acc = settings.allowanceAccount;
  const today = dayKey(now);
  const end = dayKey(cycleBounds(cycleOf(now, settings.cycleStart), settings.cycleStart).end); // the next cycle's first day
  const items = [];
  for (const s of detectRecurring(entries, settings, { now, ignored })) {
    if (!s.isLate && s.account === acc && s.next >= today && s.next < end) items.push({ name: s.name, amount: s.amount, day: s.next });
  }
  for (const x of bnplSummary(plans, entries, today).upcoming) {
    if (x.plan.account === acc && x.due < end) items.push({ name: [x.plan.provider, x.plan.merchant].filter(Boolean).join(' · '), amount: x.amount, day: x.due });
  }
  return { total: Math.round(items.reduce((a, x) => a + x.amount, 0) * 100) / 100, items };
}
