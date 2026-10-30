// Subscriptions and recurring payments: finds Spend entries that repeat (same place, similar amount,
// roughly weekly, monthly or yearly). Pure functions (no DOM, no store), so tests can run them.
//
// Only Spend counts. Transfers move your own money and income isn't a payment, so both are left out.
import { toAED, dayKey } from './model.js';

const CADENCES = [
  // gap in days between two charges, how many charges we need, and how many months' worth one charge is
  { id: 'weekly', label: 'Weekly', min: 6, max: 8, need: 3, perMonth: 52 / 12 },
  { id: 'monthly', label: 'Monthly', min: 26, max: 35, need: 2, perMonth: 1 },
  { id: 'yearly', label: 'Yearly', min: 350, max: 380, need: 2, perMonth: 1 / 12 },
];
const SIMILAR = 0.15;      // amounts within 15% of the one before count as the same payment
const PAIR = 0.05;         // with only two charges, they must match this closely (two similar shop visits are common)
const NEW_DAYS = 40;       // first seen this recently = maybe a trial that started charging
const LATE_DAYS = 7;       // expected date passed by more than this = probably cancelled

// words that only say where a shop is, not which shop it is
const PLACES = /\b(abu\s*dhabi|dubai|sharjah|ajman|al\s*ain|ras\s*al\s*khaimah|fujairah|uae|are|ae)\s*$/;

/**
 * A key that is the same for every spelling of one place:
 * "CARREFOUR 4521 ABU DHABI", "Carrefour #12" and "carrefour" all become "carrefour".
 * Drops a "PAYPAL *" style prefix, store numbers and a trailing city. "APPLE.COM/BILL" stays as it is.
 */
export function recurringKey(name) {
  let s = String(name || '').toLowerCase();
  if (s.includes('*')) s = s.slice(s.lastIndexOf('*') + 1);         // "paypal *spotify" -> "spotify"
  s = s.replace(/\d+/g, ' ');                                        // store numbers and other digits
  s = s.replace(/[^\p{L}\p{N}./& -]+/gu, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) s = s.replace(PLACES, '').trim();      // trailing city (twice: "dubai uae")
  return s.replace(/[\s./&-]+$/g, '').trim();
}

/** Days since 1970 for a Dubai calendar day, so gaps count whole days whatever the time of the charge. */
const dayNum = (e) => { const [y, m, d] = dayKey(e.date).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const keyOfDay = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

/** Some months after a day number (a 31st becomes the month's last day). */
function addMonths(n, months) {
  const dt = new Date(n * 864e5);
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + months, d = dt.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d, last)) / 864e5;
}

const similar = (a, b) => a === b || Math.abs(a - b) <= SIMILAR * Math.max(a, b);
const cadenceOfGap = (g) => CADENCES.find((c) => g >= c.min && g <= c.max);

/**
 * Find the payments that repeat. Returns them soonest next payment first (late ones last):
 * { key, name, cadence, cadenceLabel, amount, was, monthly, last, next, count, first, isNew, isLate, lateDays }
 *  - amount: the latest charge in AED; was: the charge before it when the price changed, else null
 *  - monthly: what it costs per month; last/next: "YYYY-MM-DD" (Dubai days)
 *  - isNew: the first charge from this place was in the last ~40 days
 *  - isLate: the next payment is over 7 days overdue, so it was probably cancelled
 * options: { now, ignored: keys the user said are not subscriptions }
 */
export function detectRecurring(entries, settings, { now = new Date(), ignored = [] } = {}) {
  const skip = new Set(ignored);
  const groups = new Map();
  for (const e of entries) {
    if (e.type !== 'Spend') continue;
    const key = recurringKey(e.merchant);
    if (!key || skip.has(key)) continue;
    const amount = toAED(e, settings);
    if (!(amount > 0)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ day: dayNum(e), amount, name: String(e.merchant).trim() });
  }

  const today = dayNum({ date: now });
  const found = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.day - b.day);
    // walk back from the latest charge while the gap fits one cadence and the amount is close to the
    // one after it, so old history or a skipped month doesn't hide a current subscription
    let from = list.length - 1, cadence = null;
    while (from > 0) {
      const c = cadenceOfGap(list[from].day - list[from - 1].day);
      if (!c || (cadence && c !== cadence) || !similar(list[from].amount, list[from - 1].amount)) break;
      cadence = c; from--;
    }
    const run = list.slice(from);
    if (!cadence || run.length < cadence.need) continue;
    if (run.length === 2 && Math.abs(run[0].amount - run[1].amount) > PAIR * Math.max(run[0].amount, run[1].amount)) continue;

    const latest = run[run.length - 1], before = run[run.length - 2];
    const nextDay = cadence.id === 'weekly' ? latest.day + 7 : addMonths(latest.day, cadence.id === 'yearly' ? 12 : 1);
    const lateDays = today - nextDay;
    found.push({
      key, name: latest.name, cadence: cadence.id, cadenceLabel: cadence.label,
      amount: latest.amount, was: before.amount !== latest.amount ? before.amount : null,
      monthly: latest.amount * cadence.perMonth,
      last: keyOfDay(latest.day), next: keyOfDay(nextDay), count: run.length,
      first: keyOfDay(list[0].day),
      isNew: today - list[0].day <= NEW_DAYS,
      isLate: lateDays > LATE_DAYS, lateDays,
    });
  }
  return found.sort((a, b) => (a.isLate - b.isLate) || (a.next < b.next ? -1 : a.next > b.next ? 1 : 0));
}

/** Monthly cost of the subscriptions still going (late ones are probably cancelled). */
export const monthlyTotal = (subs) => subs.filter((s) => !s.isLate).reduce((a, s) => a + s.monthly, 0);

/** Whole days from today to a "YYYY-MM-DD" day (negative = in the past). */
export const daysUntil = (key, now = new Date()) => Math.round(Date.parse(`${key}T00:00:00Z`) / 864e5 - dayNum({ date: now }));

/**
 * The one line for Home, or null: a subscription that started charging in the last week, otherwise
 * the soonest payment due in the next 3 days. Returns { text, tone: 'warn' | '' }.
 */
export function homeNote(subs, now = new Date()) {
  const aed = (v) => `AED ${Math.round(v * 100) / 100}`;
  const fresh = subs.find((s) => s.isNew && !s.isLate && daysUntil(s.last, now) >= -7);
  if (fresh) return { text: `${fresh.name} started charging: ${aed(fresh.amount)}`, tone: 'warn' };
  const due = subs.find((s) => !s.isLate && daysUntil(s.next, now) >= 0 && daysUntil(s.next, now) <= 3);
  if (!due) return null;
  const d = daysUntil(due.next, now);
  return { text: `${due.name} ${aed(due.amount)} is due ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`, tone: '' };
}
