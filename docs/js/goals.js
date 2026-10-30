// Savings goals and net worth: pure maths, no store or DOM, so Node tests can import it.
// Stored in Extras as `goals` = { v: 1, goals: [...] } and `investments` = { v: 1, items: [...] }.
// Anything that isn't that shape (an array, junk, a different version) is treated as empty.
import { cycleOf, shiftCycle, cycleBounds, dayKey, uid } from './model.js';

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
      id: typeof g.id === 'string' && g.id ? g.id : uid(),
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
    out.push({ id: typeof i.id === 'string' && i.id ? i.id : uid(), name, value, asOf: goodDate(i.asOf) });
  }
  return out;
}

export const investmentsTotal = (items) => r2(items.reduce((a, i) => a + i.value, 0));

/** Total money across every account (the same figure Home shows). `bals` is the Map from balances(). */
export const totalMoney = (bals) => r2([...bals.values()].reduce((a, b) => a + (b.balance || 0), 0));

export function netWorth({ money = 0, investments = 0, owed = 0 } = {}) {
  return r2(money + investments - owed);
}

const DAY = 864e5;
const dayNum = (key) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY;
/** Calendar days left in `now`'s cycle, counting today (the 20th of a cycle ending on the 26th is 7). */
function daysInCycleLeft(now, startDay) {
  const { end } = cycleBounds(cycleOf(now, startDay), startDay);
  return dayNum(dayKey(new Date(end.getTime() - 1))) - dayNum(dayKey(now)) + 1;
}

/** Pay cycles available to save in before the target date. Counts the cycle holding the date and
    every one between. The CURRENT cycle only counts when at least 7 days of it remain: with a few
    days left there is no real payday-to-payday stretch to save in, so "save X per cycle" would
    promise too little. A date that is still ahead always gets at least 1 cycle. 0 = date has passed. */
export const MIN_DAYS_LEFT = 7;
export function cyclesUntil(date, now = new Date(), startDay = 27) {
  const d = goodDate(date);
  if (!d) return 0;
  const target = new Date(`${d}T12:00:00+04:00`);
  if (dayKey(target) < dayKey(now)) return 0;
  const a = cycleOf(now, startDay), b = cycleOf(target, startDay);
  let n = 0;
  let c = a;
  while (c < b && n < 1200) { c = shiftCycle(c, 1); n++; }
  const total = n + 1;
  return daysInCycleLeft(now, startDay) >= MIN_DAYS_LEFT ? total : Math.max(1, total - 1);
}

/** Where every goal stands, in goal order. `bals` is a Map of account name -> { balance };
    `known` is a Map of account name -> { archived } for accounts that still exist (archived or not).
    Each account's money (never below 0) is handed to goals in order, so one dirham never counts
    twice: a goal takes only what it still needs and the rest stays for the next goal.
    A goal's accounts[] come back with the amount each gave, plus archived / missing flags, and
    `sharedWith` names the other goals using any of the same accounts. */
export function allocateGoals(goals, bals, known = null, now = new Date(), startDay = 27) {
  const left = new Map();
  const avail = (n) => (left.has(n) ? left.get(n) : Math.max(0, bals.get(n)?.balance || 0));
  return goals.map((goal) => {
    const byAccounts = goal.accounts.length > 0;
    let need = goal.target;
    const accounts = goal.accounts.map((name) => {
      const meta = known ? known.get(name) : bals.has(name) ? {} : null;
      const missing = !meta && !bals.has(name);
      const take = byAccounts && !missing ? Math.min(avail(name), Math.max(0, need)) : 0;
      left.set(name, avail(name) - take);
      need -= take;
      return { name, amount: r2(take), archived: !!meta?.archived, missing };
    });
    const sharedWith = byAccounts
      ? goals.filter((o) => o !== goal && o.accounts.some((n) => goal.accounts.includes(n))).map((o) => o.name) : [];
    const saved = r2(byAccounts ? accounts.reduce((a, x) => a + x.amount, 0) : goal.manual);
    const pct = Math.min(1, Math.max(0, saved / goal.target));
    const toGo = r2(Math.max(0, goal.target - saved));
    const done = saved >= goal.target;
    const cycles = goal.date ? cyclesUntil(goal.date, now, startDay) : 0;
    const pastDue = !!goal.date && cycles === 0 && !done;
    const perCycle = goal.date && !done && cycles > 0 ? Math.ceil(toGo / cycles) : 0;
    return { saved, pct, toGo, done, byAccounts, cycles, pastDue, perCycle, accounts, sharedWith };
  });
}

/** One goal on its own (no sharing with others). */
export const goalProgress = (goal, bals, now = new Date(), startDay = 27, known = null) => allocateGoals([goal], bals, known, now, startDay)[0];

/** A saved `goals` extra with account `from` renamed to `to` in every goal; null when nothing used it.
    Used by store.js when an account is renamed (account ids are account names). */
export function remapGoalAccounts(x, from, to) {
  if (!isObj(x) || x.v !== 1 || !Array.isArray(x.goals)) return null;
  let hit = false;
  const goals = x.goals.map((g) => {
    if (!isObj(g) || !Array.isArray(g.accounts) || !g.accounts.includes(from)) return g;
    hit = true;
    return { ...g, accounts: [...new Set(g.accounts.map((a) => (a === from ? to : a)))] };
  });
  return hit ? { ...x, goals } : null;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateLabel(d) {
  if (!goodDate(d)) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MON[m - 1]} ${y}`;
}
