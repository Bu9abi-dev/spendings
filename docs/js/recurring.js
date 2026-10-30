// Subscriptions and recurring payments: finds Spend entries that repeat (same place, similar amount,
// roughly weekly, monthly or yearly). Pure functions (no DOM, no store), so tests can run them.
//
// Only Spend counts. Transfers move your own money and income isn't a payment, so both are left out.
import { toAED, dayKey, amtAED } from './model.js';
import { merchantKey } from './categorize.js';
import { t } from './i18n.js';

const CADENCES = [
  // gap in days between two charges, how many charges we need, and how many months' worth one charge is
  { id: 'weekly', label: 'Weekly', min: 6, max: 8, need: 4, perMonth: 52 / 12 },
  { id: 'monthly', label: 'Monthly', min: 26, max: 35, need: 2, perMonth: 1 },
  { id: 'yearly', label: 'Yearly', min: 350, max: 380, need: 2, perMonth: 1 / 12 },
];
const SIMILAR = 0.15;      // amounts within 15% of the one before count as the same payment
const PAIR = 0.05;         // with only two charges, they must match this closely (two similar shop visits are common)
const NEW_DAYS = 35;       // the run started this recently = maybe a trial that started charging
const LATE_DAYS = 7;       // expected date passed by more than this = probably cancelled

// Groceries and food are habits, not subscriptions: a weekly shop or coffee repeats on a rhythm too.
// With only two monthly charges, trips to the doctor or the petrol station look the same, so those wait for a third.
const NEVER = new Set(['Groceries', 'Food & Drinks']);
const NEED_THREE = new Set(['Transport & Fuel', 'Health']);
// Well-known subscription brands (keys from merchantKey) are trusted whatever category they were filed under.
const BRANDS = /\b(netflix|spotify|shahid|osn|icloud|apple|youtube|disney|anghami|chatgpt|openai|anthropic|claude|google|microsoft|adobe|dropbox|amazon prime|prime video|noon one|talabat pro|deliveroo plus|gym|fitness|crossfit|etisalat|du)\b/;

/** Same key as the rest of the app (categorize.js merchantKey), so "PAYPAL *SPOTIFY" and "Spotify" are one place. */
export const recurringKey = merchantKey;

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
 *  - isNew: the current run of charges started in the last ~35 days (run[0], not the place's first ever charge)
 *  - isLate: the next payment is over 7 days overdue, so it was probably cancelled
 * options: { now, ignored: keys the user said are not subscriptions }
 */
export function detectRecurring(entries, settings, { now = new Date(), ignored = [] } = {}) {
  // Home and Insights both ask on every render; the answer only changes with the entries, settings, ignore list or day.
  const sig = `${ignored.join('|')}@${dayKey(now)}`;
  if (memo && memo.entries === entries && memo.settings === settings && memo.sig === sig) return memo.result;
  const result = detect(entries, settings, now, ignored);
  memo = { entries, settings, sig, result };
  return result;
}
let memo = null;

function detect(entries, settings, now, ignored) {
  const skip = new Set(ignored);
  const groups = new Map();
  for (const e of entries) {
    if (e.type !== 'Spend') continue;
    const key = recurringKey(e.merchant);
    if (!key || skip.has(key)) continue;
    const amount = toAED(e, settings);
    if (!(amount > 0)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ day: dayNum(e), amount, name: String(e.merchant).trim(), category: e.category });
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
    const brand = BRANDS.test(key), cat = run[run.length - 1].category;
    if (!brand && NEVER.has(cat)) continue;
    if (!brand && run.length === 2 && NEED_THREE.has(cat)) continue;
    if (run.length === 2 && Math.abs(run[0].amount - run[1].amount) > PAIR * Math.max(run[0].amount, run[1].amount)) continue;

    const latest = run[run.length - 1], before = run[run.length - 2];
    const nextDay = cadence.id === 'weekly' ? latest.day + 7 : addMonths(latest.day, cadence.id === 'yearly' ? 12 : 1);
    const lateDays = today - nextDay;
    found.push({
      key, name: latest.name, cadence: cadence.id, cadenceLabel: cadence.label,
      amount: latest.amount, was: before.amount !== latest.amount ? before.amount : null,
      monthly: latest.amount * cadence.perMonth,
      last: keyOfDay(latest.day), next: keyOfDay(nextDay), count: run.length,
      first: keyOfDay(run[0].day),
      isNew: today - run[0].day <= NEW_DAYS,
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
 * The one notice Home may show, or null (only when there is something to act on):
 *  - 'new': a new subscription charged in the last 7 days
 *  - 'due': a payment due within 3 days
 * Pure, so a later change can pick one notice among several kinds. Returns { priority, text }.
 */
export function subscriptionNotice(subs, now = new Date()) {
  const aed = (v) => amtAED(String(Math.round(v * 100) / 100));
  const fresh = subs.find((s) => s.isNew && !s.isLate && daysUntil(s.last, now) >= -7);
  if (fresh) return { priority: 'new', text: t('sub.new', { name: fresh.name, amt: aed(fresh.amount) }) };
  const due = subs.find((s) => !s.isLate && daysUntil(s.next, now) >= 0 && daysUntil(s.next, now) <= 3);
  if (!due) return null;
  const d = daysUntil(due.next, now);
  return { priority: 'due', text: t('sub.due', { name: due.name, amt: aed(due.amount), when: d === 0 ? t('home.today') : d === 1 ? t('bn.tomorrow') : t('sub.inDays', { n: d }) }) };
}
