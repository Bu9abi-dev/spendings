// Subscriptions and recurring payments: finds Spend entries that repeat (same place, similar amount,
// roughly weekly, monthly or yearly). Pure functions (no DOM, no store), so tests can run them.
//
// Only Spend counts. Transfers move your own money and income isn't a payment, so both are left out.
import { toAED, dayKey } from './model.js';
import { merchantKey } from './categorize.js';

const CADENCES = [
  // gap in days between two charges, how many charges we need, and how many months' worth one charge is
  { id: 'weekly', label: 'Weekly', min: 6, max: 8, need: 4, perMonth: 52 / 12 },
  { id: 'monthly', label: 'Monthly', min: 26, max: 35, need: 2, perMonth: 1 },
  { id: 'yearly', label: 'Yearly', min: 350, max: 380, need: 2, perMonth: 1 / 12 },
];
const SIMILAR = 0.15;      // amounts within 15% of the one before count as the same payment
const BRAND_SIMILAR = 0.6; // for well-known brands, a big price rise (Netflix 39 → 56) is still the same subscription
const PAIR = 0.05;         // with only two charges, they must match this closely (two similar shop visits are common)
const NEW_DAYS = 35;       // the run started this recently = maybe a trial that started charging
const LATE_DAYS = 7;       // expected date passed by more than this = probably cancelled

// Groceries and food are habits, not subscriptions: a weekly shop or coffee repeats on a rhythm too.
// With only two monthly charges, trips to the doctor or the petrol station look the same, so those wait for a third.
const NEVER = new Set(['Groceries', 'Food & Drinks']);
const NEED_THREE = new Set(['Transport & Fuel', 'Health']);
// Well-known subscription brands (keys from merchantKey) are trusted whatever category they were filed under.
// "du" (the phone company) only as the whole name or at the start, so "Cafe du Liban" isn't a phone bill.
const BRANDS = /\b(netflix|spotify|shahid|osn|icloud|apple|youtube|disney|anghami|chatgpt|openai|anthropic|claude|google|microsoft|adobe|dropbox|amazon prime|prime video|noon one|talabat pro|deliveroo plus|gym|fitness|crossfit|etisalat)\b|^du\b/;

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

const similar = (a, b, band = SIMILAR) => a === b || Math.abs(a - b) <= band * Math.max(a, b);
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
    // `price` is what the merchant charged in its own currency: a USD subscription whose AED amount moves
    // with the exchange rate hasn't changed price
    groups.get(key).push({ day: dayNum(e), amount, price: e.currency === 'USD' ? +e.amount : amount, name: String(e.merchant).trim(), category: e.category });
  }

  const today = dayNum({ date: now });
  const found = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.day - b.day);
    // the same charge logged twice (Apple Pay Shortcut + bank alert) within a day counts once
    const charges = list.filter((c, i) => !list.slice(0, i).some((p) => c.day - p.day <= 1 && Math.abs(c.price - p.price) <= 0.01 * p.price + 0.01));
    if (charges.length < 2) continue;
    const brand = BRANDS.test(key);
    // try the latest charge and the one before it as the end of the run (the latest may be a one-off
    // purchase from the same place, like an App Store buy after the iCloud charge); keep the longer run
    let best = null;
    for (const end of [charges.length - 1, charges.length - 2]) {
      const found = walkBack(charges.slice(0, end + 1), brand);
      if (found && (!best || found.run.length > best.run.length)) best = found;
    }
    if (!best) continue;
    const { run, cadence } = best;
    if (run.length < cadence.need) continue;
    const cat = run[run.length - 1].category;
    if (!brand && NEVER.has(cat)) continue;
    if (!brand && run.length === 2 && NEED_THREE.has(cat)) continue;
    if (run.length === 2 && Math.abs(run[0].amount - run[1].amount) > PAIR * Math.max(run[0].amount, run[1].amount)) continue;

    const latest = run[run.length - 1], before = run[run.length - 2];
    const changed = Math.abs(latest.price - before.price) > 0.005;
    const nextDay = cadence.id === 'weekly' ? latest.day + 7 : addMonths(latest.day, cadence.id === 'yearly' ? 12 : 1);
    const lateDays = today - nextDay;
    found.push({
      key, name: latest.name, cadence: cadence.id, cadenceLabel: cadence.label,
      amount: latest.amount, was: changed ? before.amount : null,
      monthly: latest.amount * cadence.perMonth,
      last: keyOfDay(latest.day), next: keyOfDay(nextDay), count: run.length,
      first: keyOfDay(run[0].day),
      isNew: today - run[0].day <= NEW_DAYS,
      isLate: lateDays > LATE_DAYS, lateDays,
    });
  }
  return found.sort((a, b) => (a.isLate - b.isLate) || (a.next < b.next ? -1 : a.next > b.next ? 1 : 0));
}

/** Walk back from the last charge while the gap fits one cadence and the price is close to the one
    after it, so old history or a skipped month doesn't hide a current subscription. One charge that
    comes too soon (a one-off buy from the same place) is stepped over. Returns { run, cadence } or null. */
function walkBack(list, brand) {
  const band = brand ? BRAND_SIMILAR : SIMILAR;
  const run = [list[list.length - 1]];
  let cadence = null, skipped = false;
  for (let i = list.length - 2; i >= 0; i--) {
    const gap = run[0].day - list[i].day;
    const c = cadenceOfGap(gap);
    if (c && (!cadence || c === cadence) && similar(run[0].price, list[i].price, band)) { cadence = c; run.unshift(list[i]); continue; }
    // too soon for the rhythm (or a different price inside a gap that could still fit): step over it once
    if (!skipped && gap < (cadence ? cadence.max : 26)) { skipped = true; continue; }
    break;
  }
  return cadence ? { run, cadence } : null;
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
  const aed = (v) => `AED ${Math.round(v * 100) / 100}`;
  const fresh = subs.find((s) => s.isNew && !s.isLate && daysUntil(s.last, now) >= -7);
  if (fresh) return { priority: 'new', text: `${fresh.name} is a new subscription: ${aed(fresh.amount)}` };
  const due = subs.find((s) => !s.isLate && daysUntil(s.next, now) >= 0 && daysUntil(s.next, now) <= 3);
  if (!due) return null;
  const d = daysUntil(due.next, now);
  return { priority: 'due', text: `${due.name} ${aed(due.amount)} is due ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}` };
}
