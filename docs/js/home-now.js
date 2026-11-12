// Home's numbers for right now, from what's on the phone: the one call Home, Insights and Your week share,
// so Safe to spend (with the card's upcoming bills taken off) is the same number everywhere.
import { homeNumbers } from './model.js';
import { state, getExtra } from './store.js';
import { cardBills } from './bills.js';
import { readBnpl } from './bnpl.js';

/** What's still due on the allowance card before payday ({ total, items }). */
export function billsNow(now = new Date()) {
  return cardBills({
    entries: state.entries, settings: state.settings, now,
    ignored: getExtra('recurring', { v: 1, ignored: [] }).ignored || [],
    plans: readBnpl(getExtra('bnpl', null)).plans,
  });
}

export function homeNow(now = new Date()) {
  const bills = billsNow(now);
  return { ...homeNumbers(state.entries, state.plan, state.settings, now, state.dismissed, { bills: bills.total }), billItems: bills.items };
}
