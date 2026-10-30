// Weekly summary and the allowance pace alert: the maths. Pure on purpose (no store import, no DOM), so
// tests/verify-weekly.mjs can run it in Node. The screens (Home line, "Your week" sheet, Insights card) are in weekly-ui.js.
//
// A week is Monday to Sunday by Dubai days (dayKey from model.js). "Last week" is the last FULL week,
// so on a Monday it is the one that ended yesterday. Spent counts Spend entries only and is gross, exactly like
// Insights: transfers are never spending, and a refund is income, so it is not netted off.
import { dayKey, toAED, categoryMeta, cycleOf, summarize, fmt, daysBetween } from './model.js';
import { detectRecurring } from './recurring.js';
import { dueBetween, bnplSummary, addDays, shortDay } from './bnpl.js';
import { budgetRows } from './budgets.js';

export const USUAL_WEEKS = 6;   // how many earlier full weeks make up "the usual week"
export const MIN_WEEKS = 3;     // fewer weeks with spending than this and there is no usual yet

const dayNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };

/** 0 = Monday … 6 = Sunday, for a "YYYY-MM-DD" day. */
export const weekdayOf = (key) => (new Date(dayNum(key) * 864e5).getUTCDay() + 6) % 7;

/** The Monday ("YYYY-MM-DD") of the Dubai week a day falls in. */
export const mondayOf = (key) => addDays(key, -weekdayOf(key));

/** The last full week as of `now`: { key (its Monday), from (Monday), to (its Sunday), next (the Monday after) }. */
export function lastFullWeek(now = new Date()) {
  const thisMonday = mondayOf(dayKey(now));
  const from = addDays(thisMonday, -7);
  return { key: from, from, to: addDays(from, 6), next: thisMonday };
}

/** Spend per week, as a Map of Monday → { spent, count, byCategory, biggest, refunds }, for the `weeks` full weeks ending at
    `lastMonday` (inclusive). `refunds` is the refunds that landed that week (not taken off `spent`; the screens say
    "before refunds" when there are any). One pass over the entries; weeks with nothing in them are simply absent. */
export function weekTotals(entries, settings, lastMonday, weeks = USUAL_WEEKS + 1) {
  const oldest = addDays(lastMonday, -7 * (weeks - 1)), end = addDays(lastMonday, 7);
  const out = new Map();
  const weekOf = (mon) => out.get(mon) || out.set(mon, { spent: 0, count: 0, byCategory: new Map(), biggest: null, refunds: 0 }).get(mon);
  for (const e of entries) {
    const refund = e.type === 'Income' && e.category === 'Refund';
    if (e.type !== 'Spend' && !refund) continue;
    const dk = dayKey(e.date);
    if (dk < oldest || dk >= end) continue;
    const v = toAED(e, settings);
    if (!(v > 0)) continue;
    const w = weekOf(mondayOf(dk));
    if (refund) { w.refunds += v; continue; }
    w.spent += v; w.count++;
    const cat = e.category || 'Uncategorised';
    w.byCategory.set(cat, (w.byCategory.get(cat) || 0) + v);
    if (!w.biggest || v > w.biggest.amount) w.biggest = { amount: v, merchant: String(e.merchant || '').trim(), category: cat, day: dk, id: e.id };
  }
  return out;
}

/** Middle value (the mean of the two middle ones for an even count). */
export function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** The usual week: the median of the (up to) six full weeks before `lastMonday` that have any spending.
    null when fewer than MIN_WEEKS of them have. */
export function usualWeek(totals, lastMonday) {
  const prior = [];
  for (let k = 1; k <= USUAL_WEEKS; k++) {
    const w = totals.get(addDays(lastMonday, -7 * k));
    if (w && w.spent > 0) prior.push(w.spent);
  }
  return prior.length >= MIN_WEEKS ? median(prior) : null;
}

/** Name for a category id on screen (not yet escaped). */
export const categoryLabel = (id) => (id === 'Uncategorised' ? 'Needs category' : categoryMeta(id)?.label || id);

/** The three biggest categories of a week: [{ id, label, amount }]. */
export function topCategories(byCategory, n = 3) {
  return [...byCategory].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, amount]) => ({ id, label: categoryLabel(id), amount }));
}

/** Last week against the usual one: { usual, delta, pct, tone: 'more' | 'less' | 'same' }, or null with no usual yet.
    Within 5% either way counts as "same". */
export function compareToUsual(spent, usual) {
  if (usual == null || !(usual > 0)) return null;
  const delta = spent - usual, pct = delta / usual;
  return { usual, delta, pct, tone: Math.abs(pct) < 0.05 ? 'same' : delta > 0 ? 'more' : 'less' };
}

/** What lands in the week ahead (today up to the next Monday, plus anything overdue):
    { subs: [{ name, amount, day }], bnpl: [{ name, amount, due, overdue }], budgets: [{ id, label, status, ratio, left }] }.
    Reuses recurring.js, bnpl.js and budgets.js; nothing is worked out twice. */
export function comingUp({ entries, settings, plan = [], now = new Date(), ignored = [], plans = [], limits = {} }) {
  const today = dayKey(now), end = addDays(mondayOf(today), 7);
  const subs = detectRecurring(entries, settings, { now, ignored })
    .filter((s) => !s.isLate && s.next >= today && s.next < end)
    .map((s) => ({ name: s.name, amount: s.amount, day: s.next }));
  const owed = bnplSummary(plans, entries, today);
  const bnpl = [...owed.overdue, ...dueBetween(plans, entries, today, end, today).filter((x) => !x.paid && !x.overdue)]
    .map((x) => ({ name: [x.plan.provider, x.plan.merchant].filter(Boolean).join(' · '), amount: x.amount, due: x.due, overdue: x.overdue }));
  const cyc = cycleOf(now, settings.cycleStart);
  const byCategory = summarize(entries, cyc, settings, plan).byCategory;
  const budgets = budgetRows(byCategory, limits).filter((r) => r.status !== 'ok')
    .sort((a, b) => b.ratio - a.ratio)
    .map((r) => ({ id: r.id, label: r.meta.label || r.id, status: r.status, ratio: r.ratio, left: r.left }));
  return { subs, bnpl, budgets, empty: !subs.length && !bnpl.length && !budgets.length };
}

/** The whole summary for the last full week:
    { week, spent, count, hasData, vs (compareToUsual or null), top, biggest, coming }.
    `ctx` is { entries, settings, plan, now, ignored, plans, limits } (plans = the BNPL plans, limits = budget limits). */
export function weeklySummary(ctx) {
  const now = ctx.now || new Date();
  const week = lastFullWeek(now);
  const totals = weekTotals(ctx.entries, ctx.settings, week.from);
  const w = totals.get(week.from) || { spent: 0, count: 0, byCategory: new Map(), biggest: null, refunds: 0 };
  return {
    week, spent: w.spent, count: w.count, hasData: w.count > 0, refunds: w.refunds,
    vs: compareToUsual(w.spent, usualWeek(totals, week.from)),
    top: topCategories(w.byCategory), biggest: w.biggest,
    coming: comingUp({ ...ctx, now }),
  };
}

/** The allowance pace alert, or null. It only puts model.js allowancePace's `runsOut` into words; runsOut exists only
    when Home and Insights say "over pace", from the 7th day, after spending on 3 different days, at the steady rate
    (without any one payment over a quarter of the pot), and when that is 3 or more days before the cycle's last day.
    `pace` is homeNumbers' m.pace. Returns { outDay, early, perDay, text }. */
export function paceAlert(pace, now = new Date()) {
  const r = pace?.runsOut;
  if (!r) return null;
  const when = r.outDay === dayKey(now) ? 'today' : shortDay(r.outDay);
  return { ...r, text: `At this pace (~AED ${fmt(r.perDay, { whole: true })} a day) your allowance runs out around ${when}, ${r.early} ${r.early === 1 ? 'day' : 'days'} early` };
}

/** Has this alert been seen? `seenPace` is the `weekly` extra's `pace`: { cycle, outDay }, saved when the alert was tapped.
    It stays quiet for that cycle until the projected day moves 3 or more days earlier than the one seen. */
export function paceSeen(alert, cycle, seenPace) {
  if (!alert || !seenPace || seenPace.cycle !== cycle || typeof seenPace.outDay !== 'string') return false;
  return daysBetween(alert.outDay, seenPace.outDay) < 3;
}

/** Mondays and Tuesdays only (Dubai days), until the week's summary has been opened. `seen` is the week key saved last. */
export function summaryDue(now, seen, week = lastFullWeek(now)) {
  const wd = weekdayOf(dayKey(now));
  return (wd === 0 || wd === 1) && seen !== week.key;
}

/** "Last week you spent AED 1,240, 12% more than usual" (plain text; escape it where it goes into HTML).
    With refunds that week it says "AED 1,240 before refunds", since spent is gross. */
export function summaryLine(spent, vs, money, refunds = 0) {
  const base = `Last week you spent ${money(spent)}${refunds > 0 ? ' before refunds' : ''}`;
  if (!vs) return base;
  if (vs.tone === 'same') return `${base}, about the usual`;
  return `${base}, ${Math.round(Math.abs(vs.pct) * 100)}% ${vs.tone === 'more' ? 'more' : 'less'} than usual`;
}
