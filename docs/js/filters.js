// Activity filters: which entries match, and what they add up to. Pure functions (no page, no state),
// so tests can run them in Node.
import { cycleOf, shiftCycle, dayKey, toAED, fmt } from './model.js';

// Everything the Activity tab can filter on. Empty string = "any".
export const EMPTY_FILTER = { q: '', kind: 'all', account: '', category: '', period: 'all', from: '', to: '', min: '', max: '' };

export const PERIODS = [['all', 'All time'], ['this', 'This cycle'], ['last', 'Last cycle'], ['custom', 'Pick dates']];
export const NO_CATEGORY = '__none'; // "Uncategorised" in the category picker

const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);

/** True when anything beyond the plain list is switched on (search, a chip, or a sheet filter). */
export function isFiltered(f) {
  return !!(f.q.trim() || f.kind !== 'all' || extraCount(f));
}

/** How many of the Filter sheet's own filters are on (account, category, period, amount). */
export function extraCount(f) {
  return [f.account, f.category, f.period !== 'all' && (f.period !== 'custom' || f.from || f.to), num(f.min) != null || num(f.max) != null].filter(Boolean).length;
}

/** The entries that pass every filter, newest first (same order as given). */
export function matchEntries(entries, f, settings, now = new Date()) {
  const q = f.q.trim().toLowerCase();
  const start = settings.cycleStart;
  const thisCycle = cycleOf(now, start);
  const cycle = f.period === 'this' ? thisCycle : f.period === 'last' ? shiftCycle(thisCycle, -1) : '';
  const min = num(f.min), max = num(f.max);
  return entries.filter((e) => {
    if (f.kind === 'review' && e.status !== 'Review') return false;
    if (['Spend', 'Income', 'Transfer'].includes(f.kind) && e.type !== f.kind) return false;
    // a transfer shows under both the account it left and the one it went to
    if (f.account && e.account !== f.account && e.toAccount !== f.account) return false;
    if (f.category === NO_CATEGORY && (e.category || e.type === 'Transfer' || e.type === 'Adjustment')) return false;
    if (f.category && f.category !== NO_CATEGORY && e.category !== f.category) return false;
    if (cycle && cycleOf(e.date, start) !== cycle) return false;
    if (f.period === 'custom') {
      const day = dayKey(e.date); // Abu Dhabi calendar day, same as the day headings
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (min != null || max != null) {
      const v = Math.abs(toAED(e, settings)); // compare in AED so USD entries filter fairly
      if (min != null && v < min) return false;
      if (max != null && v > max) return false;
    }
    if (q && ![e.merchant, e.note, e.category, e.account, e.toAccount, String(e.amount)].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}

/** What a list adds up to, in AED. Transfers and bank matches move money around, so they count in neither. */
export function totals(list, settings) {
  let spent = 0, income = 0, refunds = 0;
  for (const e of list) {
    if (e.type === 'Spend') spent += toAED(e, settings);
    else if (e.type === 'Income') { income += toAED(e, settings); if (e.category === 'Refund') refunds += toAED(e, settings); }
  }
  const r = (x) => Math.round(x * 100) / 100;
  // spent is gross (refunds are not netted off); refunds is the part of income that is a Refund
  return { count: list.length, spent: r(spent), income: r(income), refunds: r(refunds) };
}

/** Short labels for the filters that are on, for the removable pills under the chips. */
export function activeLabels(f) {
  const out = [];
  if (f.account) out.push(['account', f.account]);
  if (f.category) out.push(['category', f.category === NO_CATEGORY ? 'Uncategorised' : f.category]);
  if (f.period === 'this') out.push(['period', 'This cycle']);
  if (f.period === 'last') out.push(['period', 'Last cycle']);
  if (f.period === 'custom' && (f.from || f.to)) out.push(['period', `${f.from ? shortDay(f.from) : '…'} – ${f.to ? shortDay(f.to) : 'today'}`]);
  const min = num(f.min), max = num(f.max);
  if (min != null && max != null) out.push(['amount', `AED ${fmt(min)}–${fmt(max)}`]);
  else if (min != null) out.push(['amount', `AED ${fmt(min)}+`]);
  else if (max != null) out.push(['amount', `Up to AED ${fmt(max)}`]);
  return out;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MON[m - 1]}`; };
