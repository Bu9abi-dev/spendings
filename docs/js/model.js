import { CARD_COLORS } from './theme.js';
// Domain constants, cycle maths, money formatting and aggregations. No DOM here.

// The account list lives in the sheet's Accounts tab. ACCOUNTS (active) and the archive are
// refreshed in place by setAccountList(), so every module always sees the current accounts.
export const DEFAULT_ACCOUNTS = [
  { name: 'ADIB', note: 'Main · pay lands here', color: 'teal', wallet: 'adib', archived: false },
  { name: 'ADCB', note: 'Personal allowance', color: 'red', wallet: 'adcb', archived: false },
  { name: 'BOTIM', note: 'Extra card', color: 'purple', wallet: 'botim', archived: false },
  { name: 'Cash', note: 'Notes & coins', color: 'green', wallet: '', archived: false },
];
export const ACCOUNTS = [];
const ALL_ACCOUNTS = [];
export const colorHex = (id) => (CARD_COLORS.find((c) => c.id === id) || CARD_COLORS[CARD_COLORS.length - 1]).hex;
export function setAccountList(list) {
  const view = (a) => ({ id: a.name, name: a.name, role: a.note || '', colorId: a.color, color: colorHex(a.color), wallet: a.wallet || '', archived: !!a.archived });
  ALL_ACCOUNTS.splice(0, ALL_ACCOUNTS.length, ...list.map(view));
  ACCOUNTS.splice(0, ACCOUNTS.length, ...ALL_ACCOUNTS.filter((a) => !a.archived));
}
setAccountList(DEFAULT_ACCOUNTS);

// Fixed order = validated palette order (dataviz reference palette, adjacent pairs pass CVD).
export const SPEND_CATEGORIES = [
  { id: 'Food & Drinks', short: 'Food', icon: 'fork', slot: 1 },
  { id: 'Transport & Fuel', short: 'Transport', icon: 'car', slot: 2 },
  { id: 'Groceries', short: 'Groceries', icon: 'basket', slot: 3 },
  { id: 'Entertainment', short: 'Fun', icon: 'ticket', slot: 4 },
  { id: 'Shopping', short: 'Shopping', icon: 'bag', slot: 5 },
  { id: 'Travel', short: 'Travel', icon: 'plane', slot: 6 },
  { id: 'Bills & Subscriptions', short: 'Bills', icon: 'bolt', slot: 7 },
  { id: 'Health', short: 'Health', icon: 'heart', slot: 8 },
  { id: 'Family & Gifts', short: 'Family', icon: 'gift', slot: 0 },
  { id: 'Other', short: 'Other', icon: 'dots', slot: 0 },
];
export const INCOME_CATEGORIES = [
  { id: 'Salary', short: 'Salary', icon: 'briefcase' },
  { id: 'Nafis', short: 'Nafis', icon: 'in' },
  { id: 'Allowance', short: 'Allowance', icon: 'wallet' },
  { id: 'Gift', short: 'Gift', icon: 'gift' },
  { id: 'Refund', short: 'Refund', icon: 'undo' },
  { id: 'Other', short: 'Other', icon: 'dots' },
];
export const TYPES = ['Spend', 'Income', 'Transfer'];

// The payday plan. Mirrors the sheet's Plan tab; used until the sheet answers.
export const DEFAULT_PLAN = [
  { id: 'salary', name: 'Salary', kind: 'Income', amount: 6000, day: 27, from: '', to: 'ADIB', category: 'Salary' },
  { id: 'nafis', name: 'Nafis', kind: 'Income', amount: 4500, day: 1, from: '', to: 'ADIB', category: 'Nafis' },
  { id: 'allowance', name: 'Allowance', kind: 'Move', amount: 3000, day: 27, from: 'ADIB', to: 'ADCB', category: '' },
  { id: 'fuel', name: 'Fuel', kind: 'Responsibility', amount: 0, day: null, from: 'ADIB', to: '', category: 'Transport & Fuel' },
];

export const DEFAULT_SETTINGS = {
  allowance: 3000,
  allowanceAccount: 'ADCB',
  emergencyAccount: 'ADIB',
  cycleStart: 27,
  usdRate: 3.6725,
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TZ = 'Asia/Dubai';

export function categoryMeta(id, type = 'Spend') {
  const list = type === 'Income' ? INCOME_CATEGORIES : SPEND_CATEGORIES;
  return list.find((c) => c.id === id) || null;
}
export const seriesColor = (slot) => (slot ? `var(--series-${slot})` : 'var(--series-other)');
export const accountMeta = (id) => ALL_ACCOUNTS.find((a) => a.id === id) || { id, name: id || 'Unknown', role: '', colorId: 'graphite', color: 'var(--series-other)', archived: true };

/** Calendar parts of a date as seen in Dubai. */
export function dubaiParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(date)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

/** Same rule as the sheet: with start day 27, 27 Sep → 26 Oct is cycle "2026-10". */
export function cycleOf(date, startDay = 27) {
  let { y, m, d } = dubaiParts(date);
  if (startDay > 1 && d >= startDay) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function shiftCycle(cycle, delta) {
  let [y, m] = cycle.split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Start (inclusive) and end (exclusive) instants of a cycle, in Dubai time (UTC+4, no DST). */
export function cycleBounds(cycle, startDay = 27) {
  const [y, m] = cycle.split('-').map(Number);
  const mk = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd, 0, 0) - 4 * 3600e3);
  if (startDay <= 1) return { start: mk(y, m, 1), end: mk(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) };
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return { start: mk(py, pm, startDay), end: mk(y, m, startDay) };
}

export function cycleName(cycle, long = true) {
  const [y, m] = cycle.split('-').map(Number);
  return long ? MONTHS_LONG[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

export function cycleRange(cycle, startDay = 27) {
  const { start, end } = cycleBounds(cycle, startDay);
  const last = new Date(end.getTime() - 1);
  const a = dubaiParts(start), b = dubaiParts(last);
  return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
}

export function daysLeft(cycle, startDay = 27, now = new Date()) {
  const { start, end } = cycleBounds(cycle, startDay);
  if (now < start) return Math.round((end - start) / 864e5);
  return Math.max(0, Math.ceil((end - now) / 864e5));
}

export function cycleLength(cycle, startDay = 27) {
  const { start, end } = cycleBounds(cycle, startDay);
  return Math.round((end - start) / 864e5);
}

export function toAED(e, settings) {
  if (e.amountAED != null && e.amountAED !== '' && !Number.isNaN(+e.amountAED)) return +e.amountAED;
  if (e.currency === 'USD') return Math.round(e.amount * settings.usdRate * 100) / 100;
  if (!e.currency || e.currency === 'AED') return +e.amount;
  return 0;
}

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
/** 1234.5 → "1,234.50"; whole numbers drop the decimals unless `fixed`. */
export function fmt(n, { fixed = false, whole = false } = {}) {
  const v = Math.round((+n || 0) * 100) / 100;
  if (whole) return nf0.format(Math.round(v));
  if (!fixed && Number.isInteger(v)) return nf0.format(v);
  return nf2.format(v);
}
export const money = (n, cur = 'AED', opts) => `${cur} ${fmt(n, opts)}`;
/** 456484 → "456.5k", 1250000 → "1.25M"; below 100k stays whole. */
export function fmtCompact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `${+(n / 1e3).toFixed(1)}k`;
  return fmt(n, { whole: true });
}

export function dayKey(date) {
  const { y, m, d } = dubaiParts(date);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function dayLabel(key, now = new Date()) {
  const today = dayKey(now);
  const yest = dayKey(new Date(now.getTime() - 864e5));
  if (key === today) return 'Today';
  if (key === yest) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  return `${wd}, ${d} ${MONTHS[m - 1]}`;
}

export function timeLabel(date) {
  const { h, min } = dubaiParts(date);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Everything the screens need for one cycle. */
export function summarize(entries, cycle, settings) {
  const inCycle = entries.filter((e) => e.cycle === cycle);
  const s = {
    cycle, entries: inCycle, income: 0, spent: 0, allowanceUsed: 0, review: 0,
    byCategory: new Map(), byIncome: new Map(), byAccount: new Map(), daily: new Map(),
  };
  for (const a of ACCOUNTS) s.byAccount.set(a.id, { spent: 0, received: 0, count: 0 });
  for (const e of inCycle) {
    const v = toAED(e, settings);
    if (e.status === 'Review') s.review++;
    const acc = s.byAccount.get(e.account) || s.byAccount.set(e.account, { spent: 0, received: 0, count: 0 }).get(e.account);
    acc.count++;
    if (e.type === 'Spend') {
      s.spent += v;
      acc.spent += v;
      if (e.account === settings.allowanceAccount) s.allowanceUsed += v;
      const k = e.category || 'Uncategorised';
      s.byCategory.set(k, (s.byCategory.get(k) || 0) + v);
      const dk = dayKey(e.date);
      s.daily.set(dk, (s.daily.get(dk) || 0) + v);
    } else if (e.type === 'Income') {
      s.income += v;
      acc.received += v;
      s.byIncome.set(e.category || 'Other', (s.byIncome.get(e.category || 'Other') || 0) + v);
    } else if (e.type === 'Transfer') {
      acc.spent += 0;
      const to = s.byAccount.get(e.toAccount);
      if (to) to.count++;
    }
  }
  s.net = s.income - s.spent;
  s.allowance = settings.allowance;
  s.allowanceLeft = settings.allowance - s.allowanceUsed;
  return s;
}

export function uid() {
  return 'm-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 13);
}

export function toCSV(entries) {
  const cols = ['id', 'date', 'cycle', 'type', 'amount', 'currency', 'amountAED', 'account', 'toAccount', 'category', 'merchant', 'note', 'source', 'status'];
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...entries.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
}

/* ───────────────────────── Balances ───────────────────────── */

/** What each account holds now (AED). matchedAt = last time it was matched to the bank. */
export function balances(entries, settings) {
  const out = new Map(ACCOUNTS.map((a) => [a.id, { balance: 0, matchedAt: null }]));
  const get = (id) => out.get(id) || out.set(id, { balance: 0, matchedAt: null }).get(id);
  for (const e of entries) {
    const v = toAED(e, settings);
    if (e.type === 'Income') get(e.account).balance += v;
    else if (e.type === 'Spend') get(e.account).balance -= v;
    else if (e.type === 'Adjustment') {
      const a = get(e.account);
      a.balance += v;
      if (!a.matchedAt || e.date > a.matchedAt) a.matchedAt = e.date;
    } else if (e.type === 'Transfer') {
      get(e.account).balance -= v;
      if (e.toAccount) get(e.toAccount).balance += v;
    }
  }
  for (const a of out.values()) a.balance = Math.round(a.balance * 100) / 100;
  return out;
}

/** The calendar date inside `cycle` that falls on day-of-month `day`. */
export function dateInCycle(cycle, day, startDay = 27) {
  const [y, m] = cycle.split('-').map(Number);
  let yy = y, mm = m;
  if (startDay > 1 && day >= startDay) { mm -= 1; if (mm < 1) { mm = 12; yy -= 1; } }
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return new Date(Date.UTC(yy, mm - 1, Math.min(day, last), 6) - 4 * 3600e3);
}

/** Where each plan item stands this cycle. */
export function planStatus(plan, entries, cycle, settings, now = new Date()) {
  const inCycle = entries.filter((e) => e.cycle === cycle);
  return plan.map((p) => {
    const tagged = (e) => e.source === `Plan:${p.id}`;
    const due = p.day ? dateInCycle(cycle, p.day, settings.cycleStart) : null;
    let done = 0;
    if (p.kind === 'Income') {
      done = inCycle.filter((e) => e.type === 'Income' && (tagged(e) || (e.account === p.to && e.category === p.category && p.category))).reduce((a, e) => a + toAED(e, settings), 0);
    } else if (p.kind === 'Move') {
      done = inCycle.filter((e) => e.type === 'Transfer' && (tagged(e) || (e.account === p.from && e.toAccount === p.to))).reduce((a, e) => a + toAED(e, settings), 0);
    } else {
      done = inCycle.filter((e) => e.type === 'Spend' && e.account === p.from && e.category === p.category).reduce((a, e) => a + toAED(e, settings), 0);
    }
    const remaining = Math.max(0, p.amount - done);
    const complete = p.kind === 'Responsibility' ? false : p.amount > 0 && done >= p.amount * 0.95;
    const state = complete ? 'done' : !due ? 'open' : now >= due ? 'due' : 'upcoming';
    return { ...p, due, done, remaining, complete, state };
  });
}

/** The main account split into what it still owes, what it still has to move out, and what is free. */
export function hubBreakdown(hub, bal, status) {
  const reserved = status.filter((p) => p.kind === 'Responsibility' && p.from === hub).reduce((a, p) => a + p.remaining, 0);
  const toMove = status.filter((p) => p.kind === 'Move' && p.from === hub && !p.complete).reduce((a, p) => a + p.remaining, 0);
  const expected = status.filter((p) => p.kind === 'Income' && p.to === hub && !p.complete).reduce((a, p) => a + p.remaining, 0);
  return { balance: bal, reserved, toMove, expected, free: bal - reserved - toMove };
}

/** This cycle's money through the main account: where it came from and where it went. */
export function hubFlow(entries, cycle, hub, settings) {
  const sources = new Map(), outs = new Map();
  for (const e of entries) {
    if (e.cycle !== cycle) continue;
    const v = toAED(e, settings);
    if (e.type === 'Income' && e.account === hub) sources.set(e.category || 'Other', (sources.get(e.category || 'Other') || 0) + v);
    if (e.type === 'Transfer' && e.account === hub && e.toAccount) outs.set(e.toAccount, (outs.get(e.toAccount) || 0) + v);
    if (e.type === 'Spend' && e.account === hub) outs.set('Spent', (outs.get('Spent') || 0) + v);
  }
  const inTotal = [...sources.values()].reduce((a, b) => a + b, 0);
  const outTotal = [...outs.values()].reduce((a, b) => a + b, 0);
  if (inTotal > outTotal) outs.set('Kept', inTotal - outTotal);
  return { sources, outs, inTotal, outTotal };
}
