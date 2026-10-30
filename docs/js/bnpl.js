// Buy now, pay later (Tabby, Tamara, Postpay, card instalment plans): the schedule maths. No DOM here.
//
// The money rule: a BNPL purchase is only spending when an instalment actually leaves an account.
// So a plan never touches a balance. Paying an instalment is an ordinary Spend entry in the ledger,
// and what's still owed is a separate liability, shown on its own.
//
// Saved in Extras as { v: 1, plans: [plan] }. A plan:
//   { id, provider, merchant, item, category, total, count, cadence: '2w' | '1m', first: 'YYYY-MM-DD',
//     account, paid: [ null | { entry: 'm-…' | '', on: 'YYYY-MM-DD', auto? } ], skip: ['m-…'] }
// paid[i] = { entry: id } links instalment i to the ledger entry that paid it. The instalment counts as
// paid only while that entry exists, so deleting or undoing the payment makes it unpaid again.
// { entry: '' } means "paid before I started tracking": paid, with no entry to point at.
// auto: true marks a link the app found by itself. skip lists entries you unlinked from this plan,
// so the app never links them to it again.
import { dayKey, toAED, money } from './model.js';

export const PROVIDERS = ['Tabby', 'Tamara', 'Postpay', 'Cashew', 'Card plan'];
export const CADENCES = [{ id: '2w', label: 'Every 2 weeks' }, { id: '1m', label: 'Monthly' }];
// how close a ledger payment must be to count as a plan's payment ("sync"); see windows()
export const MATCH_AED = 1, MATCH_DAYS = 5;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ───── Days as 'YYYY-MM-DD' (Dubai calendar days, like dayKey) ───── */

const toUTC = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (key, n) => fromUTC(toUTC(key) + n * 864e5);
/** Whole days from a to b (b later = positive). */
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
/** "6 Nov" */
export const shortDay = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
/** Midday Dubai time on that day, for code that wants a Date (cycles, sorting). */
export const dayDate = (key) => new Date(`${key}T12:00:00+04:00`);

/* ───── The schedule ───── */

/** Each instalment's amount in AED. Equal shares in fils; the last one takes the rounding,
    so they always add up to the total exactly. */
export function instalmentAmounts(total, count) {
  const n = Math.max(1, Math.floor(+count || 1));
  const cents = Math.round((+total || 0) * 100);
  const each = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (i < n - 1 ? each : cents - each * (n - 1)) / 100);
}

/** Each instalment's due day. Monthly plans keep the first day of the month, or the month's last
    day when it's shorter (31 Jan → 28 Feb → 31 Mar). */
export function dueDates(first, count, cadence = '2w') {
  const n = Math.max(1, Math.floor(+count || 1));
  if (cadence !== '1m') return Array.from({ length: n }, (_, i) => addDays(first, i * 14));
  const [y, m, d] = first.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const mm = m - 1 + i, yy = y + Math.floor(mm / 12), mo = ((mm % 12) + 12) % 12;
    const last = new Date(Date.UTC(yy, mo + 1, 0)).getUTCDate();
    return fromUTC(Date.UTC(yy, mo, Math.min(d, last)));
  });
}

/** Ids of every ledger entry in `entries` (a Set, for quick lookups). */
const idSet = (entries) => new Set(entries.map((e) => e.id));

/** Is instalment i paid? A link only counts while its entry is still in the ledger. */
function isPaid(rec, ids) { return !!rec && (rec.entry === '' || ids.has(rec.entry)); }

/** Where one plan stands today. */
export function planState(plan, entries, today = dayKey(new Date()), ids = idSet(entries)) {
  const amounts = instalmentAmounts(plan.total, plan.count);
  const dues = dueDates(plan.first, amounts.length, plan.cadence);
  const list = amounts.map((amount, i) => {
    const rec = plan.paid?.[i] || null;
    const paid = isPaid(rec, ids);
    return { i, amount, due: dues[i], paid, entry: paid ? rec.entry : '', overdue: !paid && dues[i] < today };
  });
  const unpaid = list.filter((x) => !x.paid);
  const paidCount = list.length - unpaid.length;
  const owed = Math.round(unpaid.reduce((a, x) => a + x.amount, 0) * 100) / 100;
  return { plan, list, paidCount, owed, next: unpaid[0] || null, overdue: unpaid.filter((x) => x.overdue), done: !unpaid.length };
}

/** Everything Home and Insights show: total still owed, the next instalment across every plan, what's overdue. */
export function bnplSummary(plans, entries, today = dayKey(new Date())) {
  const ids = idSet(entries);
  const states = (plans || []).map((p) => planState(p, entries, today, ids));
  const open = states.filter((s) => !s.done);
  const owed = Math.round(open.reduce((a, s) => a + s.owed, 0) * 100) / 100;
  // the next instalment due anywhere (overdue ones first, since they're the earliest)
  const upcoming = open.flatMap((s) => s.list.filter((x) => !x.paid).map((x) => ({ ...x, plan: s.plan })))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const overdue = upcoming.filter((x) => x.overdue);
  return { states, owed, next: upcoming[0] || null, upcoming, overdue, overdueAmount: Math.round(overdue.reduce((a, x) => a + x.amount, 0) * 100) / 100 };
}

/** Instalments falling due between two days (inclusive start, exclusive end), paid or not. */
export function dueBetween(plans, entries, from, to, today = dayKey(new Date())) {
  const ids = idSet(entries);
  return (plans || []).flatMap((p) => planState(p, entries, today, ids).list.filter((x) => x.due >= from && x.due < to).map((x) => ({ ...x, plan: p })))
    .sort((a, b) => (a.due < b.due ? -1 : 1));
}

/* ───── Paying and "sync" ───── */

/** The Spend entry for paying instalment i. It goes through the app's normal add path. */
export function paymentEntry(plan, i, date = new Date().toISOString()) {
  const n = instalmentAmounts(plan.total, plan.count);
  return {
    type: 'Spend', amount: n[i], currency: 'AED', account: plan.account, category: plan.category,
    merchant: [plan.provider, plan.merchant].filter(Boolean).join(' · '),
    note: `Payment ${i + 1} of ${n.length}${plan.item ? ` · ${plan.item}` : ''}`,
    source: 'BNPL', date,
  };
}

/** A copy of the plan with instalment i linked to an entry (or marked paid with '' for no entry). */
export function withPaid(plan, i, entry, on, extra = {}) {
  const paid = Array.from({ length: Math.max(1, +plan.count || 1) }, (_, k) => plan.paid?.[k] || null);
  paid[i] = entry == null ? null : { entry, on, ...extra };
  return { ...plan, paid };
}

/** Unlink instalment i: it's unpaid again, and the entry it pointed at is never auto-linked to this plan again. */
export function withUnlinked(plan, i) {
  const entry = plan.paid?.[i]?.entry;
  const next = withPaid(plan, i, null);
  return entry ? { ...next, skip: [...new Set([...(plan.skip || []), entry])] } : next;
}

/** Letters and digits only, lower case: "TABBY*NOON FZ" → "tabbynoonfz". */
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');

/** Every entry id already linked to some instalment (so it's never used twice). */
export function linkedIds(plans) {
  const out = new Set();
  for (const p of plans || []) for (const r of p.paid || []) if (r?.entry) out.add(r.entry);
  return out;
}

/* How close a payment has to be. It can come up to MATCH_DAYS before the due day. Late, it still pays
   that payment until MATCH_DAYS after the next one is due (the last one: one period more), so a payment
   made a week late counts for the overdue one, not for the next one it happens to be near. */
const periodDays = (plan) => (plan.cadence === '1m' ? 31 : 14);
function windows(plan) {
  const amounts = instalmentAmounts(plan.total, plan.count), dues = dueDates(plan.first, amounts.length, plan.cadence);
  return amounts.map((amount, i) => ({
    i, amount, due: dues[i],
    from: addDays(dues[i], -MATCH_DAYS),
    to: addDays(dues[i + 1] || addDays(dues[i], periodDays(plan)), MATCH_DAYS),
  }));
}

/** Does the entry's name mention the plan's provider / shop? ("TABBY*NOON FZ": provider yes, shop yes) */
function nameMatch(plan, merchant) {
  const m = squash(merchant), prov = squash(plan.provider), shop = squash(plan.merchant);
  return { provider: prov.length >= 3 && m.includes(prov), shop: shop.length >= 3 && m.includes(shop) };
}

/** The unpaid payment of `plan` that an entry (AED v, on `day`) could be: the EARLIEST unpaid one whose
    window holds the day and whose amount is within AED 1. null if none. `filled`: Set of paid indexes. */
function slotFor(plan, v, day, filled) {
  for (const w of windows(plan)) {
    if (filled.has(w.i)) continue;
    if (day < w.from || day > w.to || Math.abs(v - w.amount) > MATCH_AED + 1e-9) continue;
    return { ...w, dDay: Math.abs(daysBetween(w.due, day)), dAmt: Math.abs(v - w.amount) };
  }
  return null;
}

/** Orders the plans one entry could pay: a shop-name match first, then the closest day, the closest amount,
    the earliest due day, the plan id. A proper ordering: 0 only for the same plan and payment. */
export function byFit(a, b) {
  return (b.shop - a.shop) || (a.dDay - b.dDay) || (a.dAmt - b.dAmt)
    || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)
    || (a.plan.id < b.plan.id ? -1 : a.plan.id > b.plan.id ? 1 : 0) || (a.i - b.i);
}
/** Just as good on name, day and amount: the app can't tell which plan it paid, so it leaves it to you. */
const tied = (a, b) => !!b && a.shop === b.shop && a.dDay === b.dDay && Math.abs(a.dAmt - b.dAmt) < 0.005;

/**
 * "Sync": find Spend entries already in the ledger that look like a plan's payment (the merchant names the
 * provider: TABBY, TAMARA, POSTPAY…; the amount is within AED 1; the day is in that payment's window, see
 * windows()) and link them, instead of the payment being logged twice. Pure.
 * Entries are taken oldest first, and each goes to the earliest unpaid payment it fits, so a plan added
 * halfway through picks up its past payments in order. One entry pays one payment at most. When two plans
 * fit an entry equally well it isn't linked at all: you pick in the app.
 * Returns { plans, linked, links: [{ planId, i, entry }] } (links: what's new, for the "Linked …" toast).
 */
export function autoLink(plans, entries, settings) {
  const ids = idSet(entries);
  const used = linkedIds(plans);
  // only links whose entry still exists block a match; a stale link frees the entry again
  for (const id of [...used]) if (!ids.has(id)) used.delete(id);
  // "Card plan" style names don't appear on statements: link those by hand
  const open = (plans || []).filter((p) => squash(p.provider).length >= 3);
  if (!open.length) return { plans, linked: 0, links: [] };
  const filled = new Map(open.map((p) => [p.id, new Set(windows(p).filter((w) => isPaid(p.paid?.[w.i], ids)).map((w) => w.i))]));
  const found = [];
  const list = entries.filter((e) => e.type === 'Spend' && e.merchant && !used.has(e.id))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of list) {
    const v = toAED(e, settings), day = dayKey(e.date);
    const cands = [];
    for (const p of open) {
      const nm = nameMatch(p, e.merchant);
      if (!nm.provider || (p.skip || []).includes(e.id)) continue;
      const s = slotFor(p, v, day, filled.get(p.id));
      if (s) cands.push({ ...s, plan: p, shop: nm.shop ? 1 : 0 });
    }
    if (!cands.length) continue;
    cands.sort(byFit);
    if (tied(cands[0], cands[1])) continue;
    const c = cands[0];
    filled.get(c.plan.id).add(c.i);
    found.push({ planId: c.plan.id, i: c.i, entry: e.id, day });
  }
  if (!found.length) return { plans, linked: 0, links: [] };
  const next = plans.map((p) => found.filter((l) => l.planId === p.id).reduce((q, l) => withPaid(q, l.i, l.entry, l.day, { auto: true }), p));
  return { plans: next, linked: found.length, links: found.map(({ planId, i, entry }) => ({ planId, i, entry })) };
}

/** Before "Mark paid" logs a new Spend: is a payment already in the ledger probably this one? Looser than
    autoLink, because it only asks you: not linked anywhere, not one you said wasn't this plan's, in the
    payment's window, within AED 1, and naming the provider or shop or the exact amount. Best one, or null. */
export function likelyPayment(plan, i, plans, entries, settings) {
  const w = windows(plan)[i];
  if (!w) return null;
  const ids = idSet(entries), used = linkedIds(plans), skip = new Set(plan.skip || []);
  for (const id of [...used]) if (!ids.has(id)) used.delete(id);
  const hits = [];
  for (const e of entries) {
    if (e.type !== 'Spend' || used.has(e.id) || skip.has(e.id)) continue;
    const v = toAED(e, settings), day = dayKey(e.date), nm = nameMatch(plan, e.merchant), dAmt = Math.abs(v - w.amount);
    if (day < w.from || day > w.to || dAmt > MATCH_AED + 1e-9 || !(nm.provider || nm.shop || dAmt < 0.005)) continue;
    hits.push({ e, named: nm.provider || nm.shop ? 1 : 0, dDay: Math.abs(daysBetween(w.due, day)), dAmt });
  }
  hits.sort((a, b) => (b.named - a.named) || (a.dDay - b.dDay) || (a.dAmt - b.dAmt) || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
  return hits[0]?.e || null;
}

/** Ledger payments that could be payment i, for "Link a payment": Spend entries not yet linked, within
    ±30 days of the due day, closest amount first. Looser than autoLink on purpose. */
export function linkCandidates(plan, i, plans, entries, settings, limit = 8) {
  const amount = instalmentAmounts(plan.total, plan.count)[i];
  const due = dueDates(plan.first, plan.count, plan.cadence)[i];
  const used = linkedIds(plans);
  return entries
    .filter((e) => e.type === 'Spend' && !used.has(e.id) && Math.abs(daysBetween(due, dayKey(e.date))) <= 30)
    .map((e) => ({ e, dAmt: Math.abs(toAED(e, settings) - amount), dDay: Math.abs(daysBetween(due, dayKey(e.date))) }))
    .sort((a, b) => a.dAmt - b.dAmt || a.dDay - b.dDay || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0))
    .slice(0, limit)
    .map((x) => x.e);
}

/* ───── Home notice ───── */

/** Unpaid payments due before `payday` ('YYYY-MM-DD', the next cycle's first day), overdue ones included.
    Information only: never taken off a balance or Safe to spend. */
export function dueBeforePayday(plans, entries, payday, today = dayKey(new Date())) {
  const s = bnplSummary(plans, entries, today);
  return Math.round(s.upcoming.filter((x) => x.due < payday).reduce((a, x) => a + x.amount, 0) * 100) / 100;
}

/**
 * The one line Home may show, or null. Only when something is overdue (always shown) or a payment is due
 * within 7 days, so a plan with nothing coming up stays out of the way. Pure, so a later "one notice at a
 * time" cap can rank it: { priority: 'overdue' | 'due', text, sub, owed, beforePayday }.
 */
export function bnplNotice(plans, entries, today = dayKey(new Date()), payday = '') {
  if (!plans?.length) return null;
  const s = bnplSummary(plans, entries, today);
  if (!s.next) return null;
  const late = s.overdue.length > 0, d = daysBetween(today, s.next.due);
  if (!late && d > 7) return null;
  const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${shortDay(s.next.due)}`;
  const beforePayday = payday ? dueBeforePayday(plans, entries, payday, today) : 0;
  const text = late
    ? `Buy now, pay later: ${money(s.overdueAmount)} overdue since ${shortDay(s.overdue[0].due)}`
    : `Buy now, pay later: ${money(s.owed)} still to pay · next ${money(s.next.amount)} ${when}`;
  const sub = [late ? `${money(s.owed)} still to pay` : '', beforePayday ? `${money(beforePayday)} due before payday` : ''].filter(Boolean).join(' · ');
  return { priority: late ? 'overdue' : 'due', text, sub, owed: s.owed, beforePayday };
}


/** A clean plan from the editor's fields: sensible bounds, and the paid list sized to the count. */
export function normalizePlan(p) {
  const count = Math.min(24, Math.max(1, Math.floor(+p.count || 4)));
  return {
    id: p.id, provider: String(p.provider || '').trim() || 'Plan', merchant: String(p.merchant || '').trim(), item: String(p.item || '').trim(),
    category: p.category || 'Shopping', total: Math.round(Math.max(0, +p.total || 0) * 100) / 100, count,
    cadence: p.cadence === '1m' ? '1m' : '2w', first: /^\d{4}-\d{2}-\d{2}$/.test(p.first || '') ? p.first : dayKey(new Date()),
    account: p.account || '', paid: Array.from({ length: count }, (_, k) => p.paid?.[k] || null),
    skip: Array.isArray(p.skip) ? p.skip : [],
  };
}

/** The saved value, always in the current shape (v1). */
export function readBnpl(value) {
  return { v: 1, plans: Array.isArray(value?.plans) ? value.plans : [] };
}
