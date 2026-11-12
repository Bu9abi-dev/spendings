import { CARD_COLORS } from './theme.js';
import { t, lang, locale, ltr } from './i18n.js';
// Domain constants, cycle maths, money formatting and aggregations. No DOM here.

// The account list lives in the sheet's Accounts tab. ACCOUNTS (active) and the archive are
// refreshed in place by setAccountList(), so every module always sees the current accounts.
// A new user starts with plain names they rename in the setup guide or Settings: no bank is assumed.
// Once a sheet is connected its Accounts tab wins, so an existing setup (ADIB, ADCB, BOTIM…) never sees these.
export const DEFAULT_ACCOUNTS = [
  { name: 'Account 1', note: 'Main · pay lands here', color: 'teal', wallet: '', archived: false },
  { name: 'Account 2', note: 'Personal allowance', color: 'red', wallet: '', archived: false },
  { name: 'Cash', note: 'Notes & coins', color: 'green', wallet: '', archived: false },
];
// The sample setup the demo (and the tests) use: the owner's own banks, so the demo looks like a real month.
export const SAMPLE_ACCOUNTS = [
  { name: 'ADIB', note: 'Main · pay lands here', color: 'teal', wallet: 'adib', archived: false },
  { name: 'ADCB', note: 'Personal allowance', color: 'red', wallet: 'adcb', archived: false },
  { name: 'BOTIM', note: 'Extra card', color: 'purple', wallet: 'botim', archived: false },
  { name: 'Cash', note: 'Notes & coins', color: 'green', wallet: '', archived: false },
];
export const ACCOUNTS = [];
const ALL_ACCOUNTS = [];
// People (money owed): an account flagged as a person in the `people` extra. Every balance still
// counts them, but they are not your money, so ACCOUNTS (balance bar, pay pickers, totals) leaves
// them out. PEOPLE_ACCOUNTS holds the active ones. Removed people stay flagged, so old entries keep their meaning.
export const PEOPLE_ACCOUNTS = [];
const PEOPLE = new Set();
export const isPerson = (id) => !!id && PEOPLE.has(id);
export const colorHex = (id) => (CARD_COLORS.find((c) => c.id === id) || CARD_COLORS[CARD_COLORS.length - 1]).hex;
/* ───── Caches ─────
   The screens ask for the same totals again and again (every redraw, every tab). The answers only change when
   the entries array is replaced (the store never edits it in place), the settings object is replaced, or the
   account / people / category lists change. `listsVersion` counts that last case, so each cache below is keyed
   on: the entries array identity + a short signature of the settings (and plan) + listsVersion. */
let listsVersion = 0;
export const listsVer = () => listsVersion;
const settingsSig = (s) => `${s.usdRate}|${s.cycleStart}|${s.allowance}|${s.allowanceAccount}|${s.emergencyAccount}`;
const planSig = (plan) => (plan || []).map((p) => `${p.id}:${p.kind}:${p.from}:${p.to}:${p.amount}:${p.day}`).join(',');

/** The entries grouped by cycle, in their original order (a Map of cycle -> entries). Built once per entries array
    (and start day). The cycle always comes from the entry's own date, never from when it was added or a stale
    Cycle column, so an entry dated 25 Oct never counts in a cycle that starts on the 27th.
    Without a start day it falls back to each entry's saved `cycle` (old callers, tests).
    Invalidated by: the entries array being replaced (a WeakMap, so the old one is simply forgotten). */
const cycleIndexes = new WeakMap();
export function entriesByCycle(entries, startDay = null) {
  let byStart = cycleIndexes.get(entries);
  if (!byStart) cycleIndexes.set(entries, (byStart = new Map()));
  let idx = byStart.get(startDay);
  if (!idx) {
    idx = new Map();
    for (const e of entries) {
      const c = startDay == null ? e.cycle : cycleOf(e.date, startDay);
      const l = idx.get(c); if (l) l.push(e); else idx.set(c, [e]);
    }
    byStart.set(startDay, idx);
  }
  return idx;
}
const NONE = [];
const inCycleOf = (entries, cycle, startDay = null) => entriesByCycle(entries, startDay).get(cycle) || NONE;

/** Set of every entry id. Invalidated by: the entries array being replaced. */
const idSets = new WeakMap();
export function entryIds(entries) {
  let ids = idSets.get(entries);
  if (!ids) idSets.set(entries, (ids = new Set(entries.map((e) => e.id))));
  return ids;
}

function refreshAccountLists() {
  listsVersion++;
  for (const a of ALL_ACCOUNTS) a.person = PEOPLE.has(a.id);
  ACCOUNTS.splice(0, ACCOUNTS.length, ...ALL_ACCOUNTS.filter((a) => !a.archived && !a.person));
  PEOPLE_ACCOUNTS.splice(0, PEOPLE_ACCOUNTS.length, ...ALL_ACCOUNTS.filter((a) => !a.archived && a.person));
}
// The starting accounts' notes are shown in the current language until you change them (then they're yours).
const DEFAULT_NOTES = { 'Main · pay lands here': 'acc.note.main', 'Personal allowance': 'acc.note.allowance', 'Extra card': 'acc.note.extra', 'Notes & coins': 'acc.note.cash' };
export function setAccountList(list) {
  const view = (a) => {
    const o = { id: a.name, name: a.name, role: a.note || '', colorId: a.color, color: colorHex(a.color), wallet: a.wallet || '', archived: !!a.archived };
    const k = DEFAULT_NOTES[o.role];
    if (k) Object.defineProperty(o, 'role', { get: () => t(k), enumerable: true });
    return o;
  };
  ALL_ACCOUNTS.splice(0, ALL_ACCOUNTS.length, ...list.map(view));
  refreshAccountLists();
}
/** names: the `people` extra's names (account names). */
export function setPeopleList(names) {
  PEOPLE.clear();
  for (const n of Array.isArray(names) ? names : []) if (typeof n === 'string' && n.trim()) PEOPLE.add(n);
  refreshAccountLists();
}
setAccountList(DEFAULT_ACCOUNTS);

// Built-in categories. Fixed order = validated palette order (dataviz reference palette, adjacent pairs pass CVD).
export const DEFAULT_SPEND_CATEGORIES = [
  { id: 'Food & Drinks', short: 'Food', icon: 'fork', slot: 1 },
  { id: 'Transport & Fuel', short: 'Transport', icon: 'car', slot: 2 },
  { id: 'Groceries', short: 'Groceries', icon: 'basket', slot: 3 },
  { id: 'Entertainment', short: 'Fun', icon: 'ticket', slot: 4 },
  { id: 'Shopping', short: 'Shopping', icon: 'bag', slot: 5 },
  { id: 'Travel', short: 'Travel', icon: 'plane', slot: 6 },
  { id: 'Bills & Subscriptions', short: 'Bills', icon: 'bolt', slot: 7 },
  { id: 'Health', short: 'Health', icon: 'heart', slot: 8 },
  { id: 'Family & Gifts', short: 'Family', icon: 'gift', slot: 0 },
  // money you put aside to invest (IBKR, eToro…): it leaves your account, but it isn't spending (see isExcluded)
  { id: 'Investing', short: 'Investing', icon: 'chart', slot: 0, notSpending: true },
  { id: 'Other', short: 'Other', icon: 'dots', slot: 0 },
];
export const DEFAULT_INCOME_CATEGORIES = [
  { id: 'Salary', short: 'Salary', icon: 'briefcase' },
  { id: 'Nafis', short: 'Nafis', icon: 'in' },
  { id: 'Allowance', short: 'Allowance', icon: 'wallet' },
  { id: 'Gift', short: 'Gift', icon: 'gift' },
  { id: 'Refund', short: 'Refund', icon: 'undo' },
  { id: 'Other', short: 'Other', icon: 'dots' },
];

// The lists the app shows: built-ins plus your own (Settings → Categories), minus hidden ones.
// Refreshed in place by setCategoryList(), like ACCOUNTS, so every module sees the current list.
// Hidden and removed categories stay findable through categoryMeta(), so past entries keep their names.
export const SPEND_CATEGORIES = [];
export const INCOME_CATEGORIES = [];
const ALL_CATEGORIES = { Spend: [], Income: [] };
export const CATEGORY_ICONS = ['fork', 'car', 'basket', 'ticket', 'bag', 'plane', 'bolt', 'heart', 'gift', 'briefcase', 'wallet', 'cash', 'card', 'store', 'home', 'calendar', 'note', 'sparkle', 'dots'];

/** Key for a category in the hidden/names settings. "Other" is both a spending and a money-in category,
    so money-in ones are prefixed to keep the two apart. */
export const categoryKey = (id, type = 'Spend') => (type === 'Income' ? `Income:${id}` : id);

/** cfg is the `categories` extra: { v: 1, custom: [{ id, type, icon }], hidden: [key], names: { key: label } } */
export function setCategoryList(cfg) {
  listsVersion++;
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const hidden = new Set(Array.isArray(c.hidden) ? c.hidden : []);
  const names = c.names && typeof c.names === 'object' ? c.names : {};
  const custom = Array.isArray(c.custom) ? c.custom.filter((x) => x && typeof x.id === 'string' && x.id.trim()) : [];
  for (const [type, defaults, shown] of [['Spend', DEFAULT_SPEND_CATEGORIES, SPEND_CATEGORIES], ['Income', DEFAULT_INCOME_CATEGORIES, INCOME_CATEGORIES]]) {
    const mine = custom
      .filter((x) => (x.type || 'Spend') === type && !defaults.some((d) => d.id === x.id))
      // your own categories share the grey "other" colour: the eight-colour palette is checked for colour blindness
      .map((x) => ({ id: x.id, short: x.id, icon: CATEGORY_ICONS.includes(x.icon) ? x.icon : 'dots', slot: 0, custom: true }));
    const all = [...defaults, ...mine].map((x) => {
      const k = categoryKey(x.id, type);
      const o = { ...x, short: names[k] || x.short, label: names[k] || x.id, hidden: hidden.has(k), renamed: !!names[k] };
      // a built-in category you haven't renamed is shown in the current language (strings: cat.<key>, catS.<key>);
      // its id (what the sheet stores) never changes
      if (!names[k] && !x.custom) {
        Object.defineProperty(o, 'label', { get: () => t(`cat.${k}`), enumerable: true });
        Object.defineProperty(o, 'short', { get: () => t(`catS.${k}`), enumerable: true });
      }
      return o;
    });
    ALL_CATEGORIES[type].splice(0, ALL_CATEGORIES[type].length, ...all);
    shown.splice(0, shown.length, ...all.filter((x) => !x.hidden));
  }
}
setCategoryList(null);

/** Every category of a type, hidden ones included (for Settings and for reading old entries). */
export const allCategories = (type = 'Spend') => ALL_CATEGORIES[type === 'Income' ? 'Income' : 'Spend'];

/** The categories to offer in a picker. A hidden one stays in the list while it's the one already chosen,
    so editing an old entry never silently drops its category. */
export function pickerCategories(type = 'Spend', current = '') {
  const shown = type === 'Income' ? INCOME_CATEGORIES : SPEND_CATEGORIES;
  const extra = current && !shown.some((c) => c.id === current) ? allCategories(type).filter((c) => c.id === current) : [];
  return [...shown, ...extra];
}

export const TYPES = ['Spend', 'Income', 'Transfer'];

// The payday plan. Mirrors the sheet's Plan tab; used until the sheet answers. A new user starts with none:
// the setup guide adds their salary and allowance move from what they type.
export const DEFAULT_PLAN = [];
// The sample (owner's) plan, for tests that check his real setup.
export const SAMPLE_PLAN = [
  { id: 'salary', name: 'Salary', kind: 'Income', amount: 6000, day: 27, from: '', to: 'ADIB', category: 'Salary' },
  { id: 'nafis', name: 'Nafis', kind: 'Income', amount: 4500, day: 1, from: '', to: 'ADIB', category: 'Nafis' },
  { id: 'allowance', name: 'Allowance', kind: 'Move', amount: 3000, day: 27, from: 'ADIB', to: 'ADCB', category: '' },
  { id: 'fuel', name: 'Fuel', kind: 'Responsibility', amount: 0, day: null, from: 'ADIB', to: '', category: 'Transport & Fuel' },
];

/** A plan item's name on screen: the starting items (Salary, Nafis, Allowance, Fuel) are shown in the current
    language while they keep their original name; a name you typed is yours. */
// names the app ships (the default plan and the demo's): shown in the current language while unchanged
const SHIPPED_PLAN_NAMES = { salary: 'Salary', nafis: 'Nafis', allowance: 'Allowance', fuel: 'Fuel', botim: 'BOTIM top-up', bills: 'Car & phone', home: 'Home' };
export function planName(p) {
  return p && SHIPPED_PLAN_NAMES[p.id] && SHIPPED_PLAN_NAMES[p.id] === p.name ? t(`plan.${p.id}`) : p?.name || '';
}

// A new user: no allowance yet, cycles follow the calendar month, until the setup guide asks.
export const DEFAULT_SETTINGS = {
  allowance: 0,
  allowanceAccount: 'Account 2',
  emergencyAccount: 'Account 1',
  cycleStart: 1,
  usdRate: 3.6725,
};
// The sample (owner's) settings: AED 3,000 a cycle on ADCB, pay into ADIB, cycles 27th → 26th. The demo uses these.
export const SAMPLE_SETTINGS = {
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
  return allCategories(type).find((c) => c.id === id) || null;
}
export const seriesColor = (slot) => (slot ? `var(--series-${slot})` : 'var(--series-other)');
export const accountMeta = (id) => ALL_ACCOUNTS.find((a) => a.id === id) || { id, name: id || t('acc.unknown'), role: '', colorId: 'graphite', color: 'var(--series-other)', archived: true };

/** Calendar parts of a date as seen in Dubai. Dubai is UTC+4 all year (no daylight saving), so
    shifting by four hours and reading the UTC parts gives the same answer as a time-zone formatter,
    far faster: this runs for every entry on every screen. */
export function dubaiParts(date) {
  const t = new Date(date).getTime() + 4 * 3600e3;
  if (Number.isNaN(t)) return { y: NaN, m: NaN, d: NaN, h: NaN, min: NaN };
  const u = new Date(t);
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate(), h: u.getUTCHours(), min: u.getUTCMinutes() };
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

/* Month names in the current language. Arabic uses Intl ('ar-AE', Western digits); Arabic has no short month
   names, so short and long are the same there. English keeps the fixed lists (same text as always). */
const monthFmts = {};
export function monthName(m, long = false) {
  if (lang() !== 'ar') return (long ? MONTHS_LONG : MONTHS)[m - 1];
  const f = monthFmts[locale()] || (monthFmts[locale()] = new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' }));
  return f.format(Date.UTC(2001, m - 1, 15));
}
/** "12 Oct" (or "12 أكتوبر") from a "YYYY-MM-DD" key. */
export const shortDay = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${monthName(m)}`; };

export function cycleName(cycle, long = true) {
  const [y, m] = cycle.split('-').map(Number);
  return long ? monthName(m, true) : `${monthName(m)} ${y}`;
}

export function cycleRange(cycle, startDay = 27) {
  const { start, end } = cycleBounds(cycle, startDay);
  const last = new Date(end.getTime() - 1);
  const a = dubaiParts(start), b = dubaiParts(last);
  return `${a.d} ${monthName(a.m)} – ${b.d} ${monthName(b.m)}`;
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
export const money = (n, cur = 'AED', opts) => amtCur(fmt(n, opts), cur);
/** A formatted number with its currency: "AED 1,234" (English, unchanged) or, in Arabic, the number first and then
    the currency with a no-break space, like UAE bank apps: «1,234 د.إ». The number (and its minus sign) is kept
    left to right inside an isolate, so "−12.50" never turns into "12.50−". */
export function amtCur(s, cur = 'AED') {
  if (lang() !== 'ar') return `${cur} ${s}`;
  return `${ltr(s)}\u00A0${cur === 'USD' ? t('cur.usd') : cur === 'AED' ? t('cur.aed') : cur}`;
}
/** "AED " + an already formatted number. */
export const amtAED = (s) => amtCur(s, 'AED');
/** An entry's own amount as typed: "$12.50" for USD, "AED 12.50" otherwise. */
export const amtOf = (n, currency, opts) => (currency === 'USD' ? ltr(`$${fmt(n, opts)}`) : money(n, 'AED', opts));
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
  if (key === today) return t('day.today');
  if (key === yest) return t('day.yesterday');
  const [y, m, d] = key.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale(), { weekday: 'long', timeZone: 'UTC' });
  return t('day.label', { wd, d, month: monthName(m) });
}

export function timeLabel(date) {
  const { h, min } = dubaiParts(date);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/* ───────────────────────── What counts as spending ─────────────────────────
   ONE definition, used by every number that talks about spending: Spent, the category totals and donut, the
   daily bars and average, the allowance (left, % spent, pace, runs-out date, Safe to spend), category limits,
   Your week, the monthly report and the sheet's Apple Pay reply (Code.gs mirrors these rules).

   Spending = entries of type Spend, in the cycle their own DATE falls in, minus refunds in that cycle.
   Never spending:
   - Transfers (moving money between your own accounts is reallocating)
   - "Checked with bank" adjustments (they only correct a balance)
   - Income of any kind (a refund only takes spending back off; it is not money earned)
   - Entries marked "Not my spending" (money that passes through you: paid for mom, money you forward, reimbursable)
   - The Investing category (an IBKR deposit leaves your account but isn't spent)
   Excluded entries still move balances exactly as before: only what counts as spending changes. */

/** Spend categories that never count as spending, whoever logs them. */
export const NOT_SPENDING_CATEGORIES = new Set(DEFAULT_SPEND_CATEGORIES.filter((c) => c.notSpending).map((c) => c.id));
// the sheet stores a tick as TRUE / "Yes"; an old row (no column) or a blank cell means "no"
const ticked = (v) => v === true || v === 1 || /^(true|yes|y|1)$/i.test(String(v ?? '').trim());
/** Is this entry kept out of spending, income and every average? (Marked "Not my spending", or an Investing payment.) */
export const isExcluded = (e) => !!e && (ticked(e.exclude) || (e.type === 'Spend' && NOT_SPENDING_CATEGORIES.has(e.category)));
/** Was this transfer into the allowance account marked "Add to my allowance"? Only then does a top-up raise the budget. */
export const addsToAllowance = (e) => !!e && e.type === 'Transfer' && ticked(e.addToAllowance);
/** A refund: money back that takes spending off (not income). */
export const isRefund = (e) => !!e && e.type === 'Income' && e.category === 'Refund' && !isExcluded(e);
/** The cycle an entry belongs to: always from its date. */
export const entryCycle = (e, settings) => cycleOf(e.date, settings?.cycleStart ?? 27);
/** Real personal spending? With a cycle (and settings), also: does its date fall in that cycle? */
export function isPersonalSpend(e, cycle = null, settings = null) {
  if (!e || e.type !== 'Spend' || isExcluded(e)) return false;
  return cycle == null || entryCycle(e, settings) === cycle;
}

// a shop name reduced to letters and digits, so "NOON.COM" and "Noon com" match (a refund finds its purchase)
const shopKey = (m) => String(m || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

/** Gross amounts per key, less refunds: each refund comes off its own key first (as far as that key has spending),
    and whatever is left (or a refund we can't place) comes off every key in proportion. So the values always
    add up to max(0, gross − refunds), and none goes below zero. offs: [[key or null, amount]]. */
export function lessRefunds(gross, offs) {
  const out = new Map(gross);
  let pool = 0;
  for (const [k, amt] of offs) {
    const have = k != null ? out.get(k) || 0 : 0;
    const take = Math.min(have, amt);
    if (take > 0) out.set(k, have - take);
    pool += amt - take;
  }
  const rest = [...out.values()].reduce((a, v) => a + v, 0);
  if (pool > 0 && rest > 0) {
    const f = Math.max(0, 1 - pool / rest);
    for (const [k, v] of out) out.set(k, v * f);
  }
  // round to fils so the parts still add up to the rounded whole (largest remainder), and drop empty keys
  const fils = [...out].map(([k, v]) => [k, Math.max(0, v * 100)]);
  let spare = Math.round(fils.reduce((a, [, v]) => a + v, 0)) - fils.reduce((a, [, v]) => a + Math.floor(v + 1e-6), 0);
  const order = [...fils].sort((a, b) => (b[1] - Math.floor(b[1] + 1e-6)) - (a[1] - Math.floor(a[1] + 1e-6)));
  const bump = new Set();
  for (const [k] of order) { if (spare <= 0) break; bump.add(k); spare--; }
  out.clear();
  for (const [k, v] of fils) { const f = Math.floor(v + 1e-6) + (bump.has(k) ? 1 : 0); if (f > 0) out.set(k, f / 100); }
  return out;
}

/** One cycle's personal spending (optionally on one account). Cached per entries array, settings and cycle.
    Returns { gross, refunds, net, excluded, count, byCategory, byAccount, daily, entries }:
    - gross: Spend that counts; refunds: refunds that landed; net = max(0, gross − refunds) = "Spent"
    - excluded: Spend kept out (Not my spending, Investing), for information only
    - byCategory / byAccount / daily ("YYYY-MM-DD"): net amounts that add up to `net`. A refund comes off the
      category of the last purchase at the same shop (else every category in proportion), off its own
      account, and off its own day.
    The result is shared, so callers must not edit it. */
const spendMemo = new WeakMap();
export function cycleSpend(entries, cycle, settings, { account = null } = {}) {
  let rec = spendMemo.get(entries);
  const sig = `${settingsSig(settings)}#${listsVersion}`;
  if (!rec || rec.sig !== sig) spendMemo.set(entries, (rec = { sig, map: new Map() }));
  const key = `${cycle}|${account ?? ''}`;
  let r = rec.map.get(key);
  if (!r) rec.map.set(key, (r = computeCycleSpend(entries, cycle, settings, account)));
  return r;
}
function computeCycleSpend(entries, cycle, settings, account) {
  const list = inCycleOf(entries, cycle, settings.cycleStart);
  let gross = 0, refunds = 0, excluded = 0, count = 0;
  const cat = new Map(), acc = new Map(), day = new Map(), catOff = [], accOff = [], dayOff = [], refundList = [];
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const e of list) {
    if (account != null && e.account !== account) continue;
    const v = toAED(e, settings);
    if (isPersonalSpend(e)) {
      gross += v; count++;
      add(cat, e.category || 'Uncategorised', v);
      add(acc, e.account, v);
      add(day, dayKey(e.date), v);
    } else if (e.type === 'Spend') excluded += v;
    else if (isRefund(e) && v > 0) { refunds += v; refundList.push([e, v]); }
  }
  for (const [e, v] of refundList) {
    catOff.push([refundCategory(e, entries), v]);
    accOff.push([e.account, v]);
    dayOff.push([dayKey(e.date), v]);
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const byCategory = lessRefunds(cat, catOff);
  return {
    gross: r2(gross), refunds: r2(refunds), net: r2(Math.max(0, gross - refunds)), excluded: r2(excluded), count,
    byCategory, byAccount: lessRefunds(acc, accOff), daily: lessRefunds(day, dayOff), entries: list,
  };
}
/** The spend category a refund gives back to: the last personal purchase at the same shop on or before it, else null. */
function refundCategory(refund, entries) {
  const k = shopKey(refund.merchant);
  if (!k) return null;
  let best = null;
  for (const e of entries) {
    if (!isPersonalSpend(e) || e.date > refund.date || shopKey(e.merchant) !== k) continue;
    if (!best || e.date > best.date) best = e;
  }
  return best ? best.category || 'Uncategorised' : null;
}

/* ───────────────────────── Allowance ─────────────────────────
   The rules, as Abdullah set them:
   - The budget is the planned allowance (e.g. AED 3,000). Moving money between accounts is reallocating, never
     spending, so a top-up from the main account only refills the card's balance. It raises the budget only when
     you mark it "Add to my allowance"; whatever of a marked top-up is unspent at payday carries into the next cycle.
   - Allowance used = personal spending on the allowance card this cycle, minus refunds to it (never below 0;
     a refund for an older purchase lands in the buffer). Lending to a person from the card uses allowance, and
     being paid back gives it back. Excluded entries ("Not my spending", Investing) never use allowance.
   - Unused allowance stays in the allowance account as a buffer; Safe to spend resets each cycle. */

const isPlanTagged = (e) => String(e.source || '').startsWith('Plan:');

/** The planned move(s) into the allowance account; without one, a single move of the allowance. */
function allowanceMoves(plan, settings) {
  const moves = (plan || []).filter((p) => p.kind === 'Move' && p.to === settings.allowanceAccount);
  return moves.length ? moves : [{ id: 'allowance', amount: settings.allowance, day: null }];
}

/** Is this transfer into the allowance account a planned move (vs a top-up)? Tagged by the
    "Move now" button, or typed by hand on/after its due day for (about) the full amount. */
function isPlannedMove(e, p, cycle, settings) {
  if (e.source === `Plan:${p.id}`) return true;
  if (isPlanTagged(e) || !(p.amount > 0) || toAED(e, settings) < p.amount * 0.95) return false;
  return !p.day || dayKey(e.date) >= dayKey(dateInCycle(cycle, p.day, settings.cycleStart));
}

/** One cycle's money in and out of the allowance account, transfers kept apart from spending. */
function allowanceCycle(entries, cycle, settings) {
  const acc = settings.allowanceAccount;
  const sp = cycleSpend(entries, cycle, settings, { account: acc });
  let topUps = 0, lent = 0, repaid = 0;
  for (const e of inCycleOf(entries, cycle, settings.cycleStart)) {
    if (e.type !== 'Transfer' || isExcluded(e) || isPlanTagged(e)) continue;
    const v = toAED(e, settings);
    // money owed: lending (or your friend's share of a split) from the allowance card uses allowance; being paid back gives it back
    if (e.account === acc && isPerson(e.toAccount)) lent += v;
    else if (e.toAccount === acc && isPerson(e.account)) repaid += v;
    else if (e.toAccount === acc && addsToAllowance(e)) topUps += v;
    else if (e.account === acc && addsToAllowance(e)) topUps -= v; // a marked top-up sent back
  }
  topUps = Math.max(0, topUps);
  const used = Math.max(0, Math.round((sp.gross - sp.refunds + lent - repaid) * 100) / 100);
  return { spent: sp.gross, refunds: sp.refunds, topUps, lent, repaid, used };
}

/** This cycle's allowance: the allowance, plus top-ups marked "Add to my allowance", plus last cycle's unspent marked top-ups. */
export function allowanceOf(entries, cycle, settings, plan) {
  const now = allowanceCycle(entries, cycle, settings, plan);
  const prev = allowanceCycle(entries, shiftCycle(cycle, -1), settings, plan);
  // last cycle spent its allowance first, so its top-ups are what's left above the allowance
  const carryIn = Math.round(Math.min(prev.topUps, Math.max(0, settings.allowance + prev.topUps - prev.used)) * 100) / 100;
  const pot = settings.allowance + now.topUps + carryIn;
  return { ...now, carryIn, pot, left: pot - now.used };
}

/** What the allowance card used on each day of the cycle (an array, day 0 = the cycle's first day): personal
    spending, less refunds, plus lending, less being paid back. Same entries as allowanceOf, so the pace chart
    ends where "used" does. */
export function allowanceDaily(entries, cycle, settings) {
  const acc = settings.allowanceAccount;
  const { start } = cycleBounds(cycle, settings.cycleStart);
  const len = cycleLength(cycle, settings.cycleStart);
  const days = new Array(len).fill(0);
  for (const e of inCycleOf(entries, cycle, settings.cycleStart)) {
    let sign = 0;
    if (e.account === acc && isPersonalSpend(e)) sign = 1;
    else if (e.account === acc && isRefund(e)) sign = -1;
    else if (e.type === 'Transfer' && !isExcluded(e) && !isPlanTagged(e) && e.account === acc && isPerson(e.toAccount)) sign = 1;
    else if (e.type === 'Transfer' && !isExcluded(e) && !isPlanTagged(e) && e.toAccount === acc && isPerson(e.account)) sign = -1;
    if (!sign) continue;
    const i = Math.min(len - 1, Math.max(0, Math.floor((new Date(e.date) - start) / 864e5)));
    days[i] += sign * toAED(e, settings);
  }
  return days;
}

/** Everything the screens need for one cycle. Cached per cycle (Insights asks for six, Home for one, on every redraw).
    Invalidated by: a new entries array, a change to the settings or plan that matters here, or the account list changing.
    The result is shared, so callers must not edit it. */
let summaries = []; // the last three (entries, settings) combinations, newest first: Home's filtered balances and Report vs Insights alternate
export function summarize(entries, cycle, settings, plan = []) {
  const sig = `${settingsSig(settings)}#${planSig(plan)}#${listsVersion}`;
  let rec = summaries.find((x) => x.entries === entries && x.sig === sig);
  if (!rec) { rec = { entries, sig, byCycle: new Map() }; summaries = [rec, ...summaries].slice(0, 3); }
  let r = rec.byCycle.get(cycle);
  if (!r) rec.byCycle.set(cycle, (r = computeSummary(entries, cycle, settings, plan)));
  return r;
}
function computeSummary(entries, cycle, settings, plan) {
  const inCycle = inCycleOf(entries, cycle, settings.cycleStart);
  const sp = cycleSpend(entries, cycle, settings);
  const s = {
    cycle, entries: inCycle, income: 0, spent: sp.net, gross: sp.gross, refunds: sp.refunds, excluded: sp.excluded,
    review: 0, byCategory: sp.byCategory, byIncome: new Map(), byAccount: new Map(), daily: sp.daily,
  };
  for (const a of ACCOUNTS) s.byAccount.set(a.id, { spent: 0, received: 0, count: 0 });
  const row = (id) => s.byAccount.get(id) || s.byAccount.set(id, { spent: 0, received: 0, count: 0 }).get(id);
  for (const e of inCycle) {
    if (e.status === 'Review') s.review++;
    row(e.account).count++;
    if (e.type === 'Transfer') { const to = s.byAccount.get(e.toAccount); if (to) to.count++; }
    // money in: income that is really yours (a refund takes spending off instead; excluded money passes through)
    if (e.type === 'Income' && !isRefund(e) && !isExcluded(e)) {
      const v = toAED(e, settings);
      s.income += v;
      row(e.account).received += v;
      s.byIncome.set(e.category || 'Other', (s.byIncome.get(e.category || 'Other') || 0) + v);
    }
  }
  for (const [id, v] of sp.byAccount) row(id).spent = v;
  s.net = s.income - s.spent;
  const a = allowanceOf(entries, cycle, settings, plan);
  s.allowance = settings.allowance;
  s.allowanceSpent = a.spent;
  s.allowanceUsed = a.used;
  s.allowanceRefunds = a.refunds;
  s.topUps = a.topUps;
  s.carryIn = a.carryIn;
  s.allowancePot = a.pot;
  s.allowanceLeft = a.left;
  return s;
}

export function uid() {
  return 'm-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 13);
}

export function toCSV(entries) {
  const cols = ['id', 'date', 'cycle', 'type', 'amount', 'currency', 'amountAED', 'account', 'toAccount', 'category', 'merchant', 'note', 'source', 'status'];
  const numeric = new Set(['amount', 'amountAED']); // numbers stay numbers: a refund's "-12.5" isn't a formula
  const esc = (v, col) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s) && !(numeric.has(col) && s.trim() !== '' && Number.isFinite(+s))) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...entries.map((e) => cols.map((c) => esc(e[c], c)).join(','))].join('\n');
}

/* ───────────────────────── Balances ───────────────────────── */

/** What each account holds now (AED). matchedAt = last time it was matched to the bank.
    Cached (the last three answers). Invalidated by: a new entries array, a different usdRate, the account list
    changing. The Map is shared, so callers must not edit it. */
let balMemo = []; // the last three answers, newest first (Home also asks about a filtered slice of the entries)
export function balances(entries, settings) {
  const sig = `${settings.usdRate}#${listsVersion}`;
  const hit = balMemo.find((x) => x.entries === entries && x.sig === sig);
  if (hit) return hit.result;
  const result = computeBalances(entries, settings);
  balMemo = [{ entries, sig, result }, ...balMemo].slice(0, 3);
  return result;
}
function computeBalances(entries, settings) {
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

/** Your money: every balance except people's (they are money owed, not money you hold). */
export const moneyTotal = (bals) => [...bals].reduce((a, [id, b]) => (isPerson(id) ? a : a + b.balance), 0);

/** What each person's account says: > 0 they owe you, < 0 you owe them. Active people always, a removed
    one only while something is still owed. owedToYou and youOwe are the two sums (both ≥ 0). */
export function peopleBalances(entries, settings, bals = balances(entries, settings)) {
  const ids = new Set([...PEOPLE_ACCOUNTS.map((a) => a.id), ...[...bals.keys()].filter(isPerson)]);
  const people = [...ids].map((id) => ({ id, name: accountMeta(id).name, archived: !PEOPLE_ACCOUNTS.some((a) => a.id === id), balance: bals.get(id)?.balance || 0 }))
    .filter((p) => !p.archived || Math.abs(p.balance) >= 0.005);
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    people,
    owedToYou: r2(people.reduce((a, p) => a + Math.max(0, p.balance), 0)),
    youOwe: r2(people.reduce((a, p) => a + Math.max(0, -p.balance), 0)),
  };
}

/** The calendar date inside `cycle` that falls on day-of-month `day`. */
export function dateInCycle(cycle, day, startDay = 27) {
  const [y, m] = cycle.split('-').map(Number);
  let yy = y, mm = m;
  if (startDay > 1 && day >= startDay) { mm -= 1; if (mm < 1) { mm = 12; yy -= 1; } }
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return new Date(Date.UTC(yy, mm - 1, Math.min(day, last), 6) - 4 * 3600e3);
}

/** Where each plan item stands this cycle. `dismissed` ({ planId: cycle }) marks items you said
    were already done this cycle: they count as complete, nothing is left of them, and the
    dismissal expires when the cycle ends. */
export function planStatus(plan, entries, cycle, settings, now = new Date(), dismissed = {}) {
  const inCycle = inCycleOf(entries, cycle, settings.cycleStart);
  return plan.map((p) => {
    const tagged = (e) => e.source === `Plan:${p.id}`;
    const due = p.day ? dateInCycle(cycle, p.day, settings.cycleStart) : null;
    let done = 0;
    if (p.kind === 'Income') {
      done = inCycle.filter((e) => e.type === 'Income' && (tagged(e) || (e.account === p.to && e.category === p.category && p.category))).reduce((a, e) => a + toAED(e, settings), 0);
    } else if (p.kind === 'Move' && p.to === settings.allowanceAccount) {
      // a top-up is not the allowance move: only the tagged move, or a full one on/after payday
      done = inCycle.filter((e) => e.type === 'Transfer' && e.account === p.from && e.toAccount === p.to && isPlannedMove(e, p, cycle, settings)).reduce((a, e) => a + toAED(e, settings), 0);
    } else if (p.kind === 'Move') {
      done = inCycle.filter((e) => e.type === 'Transfer' && (tagged(e) || (e.account === p.from && e.toAccount === p.to))).reduce((a, e) => a + toAED(e, settings), 0);
    } else {
      done = inCycle.filter((e) => e.type === 'Spend' && e.account === p.from && e.category === p.category).reduce((a, e) => a + toAED(e, settings), 0);
    }
    const isDismissed = dismissed?.[p.id] === cycle;
    const remaining = isDismissed ? 0 : Math.max(0, p.amount - done);
    const complete = isDismissed || (p.kind === 'Responsibility' ? false : p.amount > 0 && done >= p.amount * 0.95);
    const state = isDismissed ? 'dismissed' : complete ? 'done' : !due ? 'open' : now >= due ? 'due' : 'upcoming';
    return { ...p, due, done, remaining, complete, dismissed: isDismissed, state };
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
  for (const e of inCycleOf(entries, cycle, settings.cycleStart)) {
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

/* ───────────────────────── Allowance pace ─────────────────────────
   One definition, read by Home's pace line, the Insights "Allowance pace" card and the Home "runs out" alert,
   always from the same summary, so they can't disagree:
   - daily pace = allowance used ÷ days of the cycle so far (today counts, so at least 1)
   - projected run-out = today + what's left ÷ daily pace
   - "on track" while that day is after the cycle's last day; "over pace" (with the run-out date) when it's before. */

export const PACE_RULES = {
  tolMin: 15, tolShare: 0.03, // the Insights chart's "even spread" band: within max(15, 3% of the pot)
};
export const paceTolerance = (pot) => Math.max(PACE_RULES.tolMin, (pot || 0) * PACE_RULES.tolShare);
const dayIndex = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
/** Whole Dubai days from day key `a` to day key `b` (b − a). */
export const daysBetween = (a, b) => Math.round(dayIndex(b) - dayIndex(a));

/** Where this cycle's allowance stands. `sum` is a cycle summary (summarize, or homeNumbers' m.sum).
    Returns { expected, spent, delta, tol, days, perDay, left, state, daysLeft, runsOut } where state is
    'spent' (over the allowance), 'over' (at this pace it runs out before the cycle ends) or 'on', and runsOut is
    { outDay, early, perDay } (the day it runs out, days before the cycle's last day, the daily pace) or null. */
export function allowancePace(sum, cycle, settings, now = new Date()) {
  const { start, end } = cycleBounds(cycle, settings.cycleStart);
  const len = Math.round((end - start) / 864e5);
  const elapsed = Math.min(len, Math.max(0, (now - start) / 864e5));
  const lastDay = dayKey(new Date(end.getTime() - 1));
  const days = Math.min(len, Math.max(1, daysBetween(dayKey(start), dayKey(now < end ? now : new Date(end.getTime() - 1))) + 1));
  const pot = sum.allowancePot || 0, used = sum.allowanceUsed || 0, left = pot - used;
  const expected = (pot * elapsed) / len;
  const perDay = used / days;
  const pace = { expected, spent: used, delta: used - expected, tol: paceTolerance(pot), days, perDay, left, state: 'on', daysLeft: daysLeft(cycle, settings.cycleStart, now), runsOut: null };
  if (left < 0) { pace.state = 'spent'; return pace; }
  // a past or future cycle has no "from today" projection
  if (now < start || now >= end || !(perDay > 0)) return pace;
  const outDay = dayKey(new Date(now.getTime() + (left / perDay) * 864e5));
  if (outDay <= lastDay) {
    pace.state = 'over';
    pace.runsOut = { outDay, early: daysBetween(outDay, lastDay), perDay };
  }
  return pace;
}

/* ───────────────────────── Home numbers ───────────────────────── */

/** The numbers Home shows: total money, Safe to spend and pace. Pure, so the checks run it too.
    `bills` is what's still due on the allowance card before the cycle ends (bills.js cardBills), in AED. */
export function homeNumbers(entries, plan, settings, now = new Date(), dismissed = {}, { bills = 0 } = {}) {
  const s = settings, cyc = cycleOf(now, s.cycleStart);
  const bals = balances(entries, s);
  const total = moneyTotal(bals);
  const status = planStatus(plan, entries, cyc, s, now, dismissed);
  const hub = s.emergencyAccount;
  const hubB = hubBreakdown(hub, bals.get(hub)?.balance || 0, status);
  const sum = summarize(entries, cyc, s, plan);
  const allowAcc = s.allowanceAccount;
  const allowBal = bals.get(allowAcc)?.balance || 0;
  const allowLeft = sum.allowanceLeft;
  const allowMove = status.find((p) => p.kind === 'Move' && p.to === allowAcc && !p.complete) || null;
  const dismissedMove = status.find((p) => p.kind === 'Move' && p.to === allowAcc && p.dismissed) || null;
  // Safe to spend: what's left of this cycle's allowance, less the bills still due on the card, never below 0.
  // Until the allowance has really been moved (or when it was moved before tracking began), it also can't be more
  // than the card holds. After a logged move, moving money on to another account is reallocating and doesn't lower it.
  const billsDue = Math.max(0, +bills || 0);
  let safe = Math.max(0, allowLeft - billsDue);
  if (allowMove || (dismissedMove && allowAcc !== hub)) safe = Math.min(safe, Math.max(allowBal, 0));
  // one account doing both jobs: you can't safely spend more than its free money
  if (allowAcc === hub) safe = Math.min(safe, Math.max(0, hubB.free));
  const pace = allowancePace(sum, cyc, s, now);
  const allowanceUnmoved = !!allowMove && (!allowMove.due || dayKey(now) >= dayKey(allowMove.due));
  return { s, cyc, bals, total, status, hub, hubB, sum, allowAcc, allowBal, allowLeft, allowMove, safe, bills: billsDue, pace, allowanceUnmoved };
}

/** Whole numbers for `values` that add up to `target` (default: their rounded total): round every one
    down, then give the leftover units to the biggest fractions (largest remainder). */
export function apportion(values, target = Math.round(values.reduce((a, v) => a + v, 0))) {
  const shown = values.map((v) => Math.floor(v));
  let spare = target - shown.reduce((a, v) => a + v, 0);
  values.map((v, i) => i).sort((a, b) => (values[b] - Math.floor(values[b])) - (values[a] - Math.floor(values[a])))
    .forEach((i) => { if (spare > 0) { shown[i]++; spare--; } });
  return shown;
}

/** "By account" for one cycle (Insights and the monthly report use this one list, so they agree): what each of
    your active accounts spent, plus an `other` row for the rest (a friend who paid, a removed account), so the rows
    add up to Spent. `shown` are whole dirhams that add up to the rounded Spent. */
export function spentByAccount(sum) {
  const rows = ACCOUNTS.map((a) => ({ id: a.id, spent: sum.byAccount.get(a.id)?.spent || 0 }));
  const own = rows.reduce((x, r) => x + r.spent, 0);
  const other = Math.max(0, Math.round((sum.spent - own) * 100) / 100);
  const all = other >= 0.005 ? [...rows, { id: '', other: true, spent: other }] : rows;
  apportion(all.map((r) => r.spent), Math.round(sum.spent)).forEach((n, i) => { all[i].shown = n; });
  return all;
}

/** "Where your money is": every part of the total, so the numbers visibly add up. */
export function whereRows(m) {
  const all = [];
  const add = (label, v, c, sub = '') => all.push({ label, v, c, sub });
  const allowColor = accountMeta(m.allowAcc).color, hubColor = accountMeta(m.hub).color;
  const same = m.allowAcc === m.hub;
  // rows say where money physically is, so only the part of Safe to spend still in the allowance
  // account sits here; any part moved on shows under the account it went to
  const safeHere = same ? m.safe : Math.min(Math.max(0, m.safe), Math.max(0, m.allowBal));
  const movedOn = Math.max(0, m.safe) - safeHere;
  add(t('where.safe'), safeHere, allowColor, movedOn >= 0.5 ? t('where.safeSub', { acc: m.allowAcc, n: fmt(movedOn, { whole: true }) }) : t('where.allowLeft', { acc: m.allowAcc }));
  if (!same) add(t('where.carried', { acc: m.allowAcc }), m.allowBal - safeHere, allowColor, t('where.unspent'));
  // one account doing both jobs: Safe to spend is already part of its free money, so count it once
  add(t('where.emerg'), m.hubB.free - (same ? safeHere : 0), hubColor, t('where.emergSub', { acc: m.hub }));
  add(t('where.resp'), m.hubB.reserved, 'var(--warn)', t('where.heldIn', { acc: m.hub }));
  add(t('where.toMove'), m.hubB.toMove, 'var(--label-3)', t('where.waitingIn', { acc: m.hub }));
  for (const a of ACCOUNTS) if (a.id !== m.hub && a.id !== m.allowAcc) add(a.name, m.bals.get(a.id)?.balance || 0, a.color, a.role);
  // money still sitting in an archived (or unknown) account is part of the total too
  for (const [id, x] of m.bals) {
    if (id === m.hub || id === m.allowAcc || isPerson(id) || ACCOUNTS.some((a) => a.id === id)) continue;
    const a = accountMeta(id);
    add(a.name, x.balance, a.color, a.archived ? t('where.removed') : a.role);
  }
  // whole numbers that add up to the rounded total (largest remainder)
  apportion(all.map((r) => r.v)).forEach((n, i) => { all[i].shown = n; });
  return all.filter((r) => r.shown !== 0);
}
