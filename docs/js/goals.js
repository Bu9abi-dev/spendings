// Savings goals and net worth: pure maths, no store or DOM, so Node tests can import it.
// Stored in Extras as `goals` = { v: 1, goals: [...] } and `investments` = { v: 1, items: [...] }.
// Anything that isn't that shape (an array, junk, a different version) is treated as empty.
import { cycleOf, shiftCycle } from './model.js';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '') ? +x : NaN);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const goodDate = (d) => (typeof d === 'string' && DATE.test(d) && !Number.isNaN(new Date(`${d}T12:00:00+04:00`).getTime()) ? d : '');
const r2 = (n) => Math.round(n * 100) / 100;

/** Goals from a saved extra: [{ id, name, target, date, accounts, manual }]. Junk becomes []. */
export function readGoals(x) {
  if (!isObj(x) || x.v !== 1 || !Array.isArray(x.goals)) return [];
  const out = [];
  for (const g of x.goals) {
    if (!isObj(g)) continue;
    const target = num(g.target);
    const name = typeof g.name === 'string' ? g.name.trim().slice(0, 40) : '';
    if (!name || !Number.isFinite(target) || target <= 0) continue;
    out.push({
      id: typeof g.id === 'string' && g.id ? g.id : `g${out.length}`,
      name, target,
      date: goodDate(g.date),
      accounts: Array.isArray(g.accounts) ? g.accounts.filter((a) => typeof a === 'string' && a) : [],
      manual: Number.isFinite(num(g.manual)) ? Math.max(0, num(g.manual)) : 0,
    });
  }
  return out;
}

/** Investments from a saved extra: [{ id, name, value, asOf }]. */
export function readInvestments(x) {
  if (!isObj(x) || x.v !== 1 || !Array.isArray(x.items)) return [];
  const out = [];
  for (const i of x.items) {
    if (!isObj(i)) continue;
    const value = num(i.value);
    const name = typeof i.name === 'string' ? i.name.trim().slice(0, 40) : '';
    if (!name || !Number.isFinite(value)) continue;
    out.push({ id: typeof i.id === 'string' && i.id ? i.id : `i${out.length}`, name, value, asOf: goodDate(i.asOf) });
  }
  return out;
}

export const investmentsTotal = (items) => r2(items.reduce((a, i) => a + i.value, 0));

/** Total money across every account (the same figure Home shows). `bals` is the Map from balances(). */
export const totalMoney = (bals) => r2([...bals.values()].reduce((a, b) => a + (b.balance || 0), 0));

/** What is still owed on buy-now-pay-later plans, read defensively from the `bnpl` extra
    `{ v: 1, plans }`: the sum of unpaid instalments. Returns 0 for anything unrecognised. */
export function bnplOwed(x) {
  if (!isObj(x) || x.v !== 1 || !Array.isArray(x.plans)) return 0;
  let owed = 0;
  for (const p of x.plans) {
    if (!isObj(p)) continue;
    const list = [p.instalments, p.installments, p.payments].find(Array.isArray);
    if (list) {
      for (const i of list) {
        if (isObj(i) && !i.paid && !i.done && Number.isFinite(num(i.amount))) owed += Math.max(0, num(i.amount));
      }
    } else if (Number.isFinite(num(p.remaining))) owed += Math.max(0, num(p.remaining));
  }
  return r2(owed);
}

export function netWorth({ money = 0, investments = 0, owed = 0 } = {}) {
  return r2(money + investments - owed);
}

/** Whole cycles from now's cycle to the target date's cycle, counting both (so a date in this
    cycle is 1). 0 when the date has passed. */
export function cyclesUntil(date, now = new Date(), startDay = 27) {
  const d = goodDate(date);
  if (!d) return 0;
  const target = new Date(`${d}T12:00:00+04:00`);
  const nowDay = new Date(now);
  // a date earlier today or before counts as passed (Dubai calendar day compare)
  const key = (t) => new Date(new Date(t).getTime() + 4 * 3600e3).toISOString().slice(0, 10);
  if (key(target) < key(nowDay)) return 0;
  const a = cycleOf(nowDay, startDay), b = cycleOf(target, startDay);
  let n = 0;
  let c = a;
  while (c < b && n < 1200) { c = shiftCycle(c, 1); n++; }
  return n + 1;
}

/** Where one goal stands. `bals` is a Map of account name -> { balance }. */
export function goalProgress(goal, bals, now = new Date(), startDay = 27) {
  const byAccounts = goal.accounts.length > 0;
  const saved = r2(byAccounts ? goal.accounts.reduce((a, n) => a + (bals.get(n)?.balance || 0), 0) : goal.manual);
  const pct = Math.min(1, Math.max(0, saved / goal.target));
  const toGo = r2(Math.max(0, goal.target - saved));
  const done = saved >= goal.target;
  const cycles = goal.date ? cyclesUntil(goal.date, now, startDay) : 0;
  const pastDue = !!goal.date && cycles === 0 && !done;
  const perCycle = goal.date && !done && cycles > 0 ? Math.ceil(toGo / cycles) : 0;
  return { saved, pct, toGo, done, byAccounts, cycles, pastDue, perCycle };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateLabel(d) {
  if (!goodDate(d)) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MON[m - 1]} ${y}`;
}
