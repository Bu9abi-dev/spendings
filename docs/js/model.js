import { CARD_COLORS } from './theme.js';
import { t, lang, locale, ltr } from './i18n.js';
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

/** The entries grouped by cycle, in their original order (a Map of cycle -> entries). Built once per entries array.
    Invalidated by: the entries array being replaced (a WeakMap, so the old one is simply forgotten). */
const cycleIndexes = new WeakMap();
export function entriesByCycle(entries) {
  let idx = cycleIndexes.get(entries);
  if (!idx) {
    idx = new Map();
    for (const e of entries) { const l = idx.get(e.cycle); if (l) l.push(e); else idx.set(e.cycle, [e]); }
    cycleIndexes.set(entries, idx);
  }
  return idx;
}
const NONE = [];
const inCycleOf = (entries, cycle) => entriesByCycle(entries).get(cycle) || NONE;

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

// The payday plan. Mirrors the sheet's Plan tab; used until the sheet answers.
export const DEFAULT_PLAN = [
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

/* ───────────────────────── Allowance ─────────────────────────
   The rules, as Abdullah set them:
   - Moving money between accounts is reallocating, never spending.
   - Unused allowance stays in the allowance account as a buffer; Safe to spend resets each cycle.
   - A refund into the allowance account adds back to the allowance, exactly undoing the spend;
     whatever it can't add back (the spend was in an earlier cycle) lands in the buffer.
   - A top-up (main → allowance, beyond the planned move) adds to the allowance of the cycle it
     lands in, and whatever of it is still unspent at payday carries into the next cycle. */

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
function allowanceCycle(entries, cycle, settings, plan) {
  const acc = settings.allowanceAccount, hub = settings.emergencyAccount;
  const moves = allowanceMoves(plan, settings);
  let spent = 0, refunds = 0, topUps = 0, lent = 0;
  for (const e of inCycleOf(entries, cycle)) {
    const v = toAED(e, settings);
    if (e.type === 'Spend' && e.account === acc) spent += v;
    else if (e.type === 'Income' && e.account === acc && e.category === 'Refund') refunds += v;
    // money owed: lending (or your friend's share of a split) from the allowance card uses allowance;
    // being paid back into it is a top-up
    else if (e.type === 'Transfer' && e.account === acc && isPerson(e.toAccount)) lent += v;
    else if (e.type === 'Transfer' && e.toAccount === acc && isPerson(e.account)) topUps += v;
    else if (e.type === 'Transfer' && acc !== hub) {
      if (e.account === hub && e.toAccount === acc && !moves.some((p) => isPlannedMove(e, p, cycle, settings))) topUps += v;
      else if (e.account === acc && e.toAccount === hub && !isPlanTagged(e)) topUps -= v; // a top-up sent back
    }
  }
  topUps = Math.max(0, topUps);
  return { spent, refunds, topUps, lent, used: Math.max(0, spent + lent - refunds) };
}

/** This cycle's allowance: the allowance, plus top-ups, plus last cycle's unspent top-ups. */
export function allowanceOf(entries, cycle, settings, plan) {
  const now = allowanceCycle(entries, cycle, settings, plan);
  const prev = allowanceCycle(entries, shiftCycle(cycle, -1), settings, plan);
  // last cycle spent its allowance first, so its top-ups are what's left above the allowance
  const carryIn = Math.round(Math.min(prev.topUps, Math.max(0, settings.allowance + prev.topUps - prev.used)) * 100) / 100;
  const pot = settings.allowance + now.topUps + carryIn;
  return { ...now, carryIn, pot, left: pot - now.used };
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
  const inCycle = inCycleOf(entries, cycle);
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
  const a = allowanceOf(entries, cycle, settings, plan);
  s.allowance = settings.allowance;
  s.allowanceSpent = s.allowanceUsed;
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
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...entries.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
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
  const inCycle = inCycleOf(entries, cycle);
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
  for (const e of inCycleOf(entries, cycle)) {
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
   always from the same summary (the one homeNumbers adjusts for spending before tracking began), so they can't
   disagree. Pace compares what's used with an even spread of the pot over the cycle, with a tolerance band.
   The "runs out" projection only exists when the state is 'over', so the alert can never sit beside "On track". */

export const PACE_RULES = {
  tolMin: 15, tolShare: 0.03, // within max(15, 3% of the pot) of an even spread counts as on track
  alertFromDay: 7,            // no projection before the 7th day of the cycle
  minDays: 3,                 // ...nor before allowance spending on at least 3 different days
  lumpShare: 0.25,            // one payment over 25% of the pot uses the pot up, but doesn't set the daily rate
  earlyDays: 3,               // only worth saying when it runs out at least 3 days before the cycle's last day
};
export const paceTolerance = (pot) => Math.max(PACE_RULES.tolMin, (pot || 0) * PACE_RULES.tolShare);
const dayIndex = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
/** Whole Dubai days from day key `a` to day key `b` (b − a). */
export const daysBetween = (a, b) => Math.round(dayIndex(b) - dayIndex(a));

/** Where this cycle's allowance stands against an even spread. `sum` is a cycle summary (use homeNumbers' m.sum
    for the current cycle). Returns { expected, spent, delta, tol, state, daysLeft, runsOut } where state is
    'spent' (over the allowance), 'over' (over pace by more than tol), 'on' or 'under', and runsOut is
    { outDay, early, perDay } (the day the allowance runs out at the steady daily rate, days before the cycle's
    last day, and that rate) or null. */
export function allowancePace(sum, cycle, settings, now = new Date()) {
  const { start, end } = cycleBounds(cycle, settings.cycleStart);
  const len = (end - start) / 864e5;
  const elapsed = Math.min(len, Math.max(0, (now - start) / 864e5));
  const pot = sum.allowancePot || 0, used = sum.allowanceUsed || 0;
  const expected = (pot * elapsed) / len;
  const delta = used - expected, tol = paceTolerance(pot);
  const state = sum.allowanceLeft < 0 ? 'spent' : delta > tol ? 'over' : delta < -tol ? 'under' : 'on';
  const pace = { expected, spent: used, delta, tol, state, daysLeft: daysLeft(cycle, settings.cycleStart, now), runsOut: null };
  if (state !== 'over' || now < start || now >= end || Math.floor(elapsed) + 1 < PACE_RULES.alertFromDay || !(elapsed > 0)) return pace;
  // the steady rate: what's used, less any single payment bigger than a quarter of the pot, over the days so far
  const lump = pot * PACE_RULES.lumpShare, days = new Set();
  let lumps = sum.spentBefore > lump ? sum.spentBefore : 0;
  for (const e of sum.entries || []) {
    if (e.type !== 'Spend' || e.account !== settings.allowanceAccount) continue;
    const v = toAED(e, settings);
    if (!(v > 0)) continue;
    days.add(dayKey(e.date));
    if (v > lump) lumps += v;
  }
  const perDay = (used - lumps) / elapsed, left = pot - used;
  if (days.size < PACE_RULES.minDays || !(perDay > 0) || !(left > 0)) return pace;
  const outDay = dayKey(new Date(now.getTime() + (left / perDay) * 864e5));
  const early = daysBetween(outDay, dayKey(new Date(end.getTime() - 1)));
  if (early >= PACE_RULES.earlyDays) pace.runsOut = { outDay, early, perDay };
  return pace;
}

/* ───────────────────────── Home numbers ───────────────────────── */

/** The numbers Home shows: total money, Safe to spend and pace. Pure, so the checks run it too. */
export function homeNumbers(entries, plan, settings, now = new Date(), dismissed = {}) {
  const s = settings, cyc = cycleOf(now, s.cycleStart);
  const bals = balances(entries, s);
  const total = moneyTotal(bals);
  const status = planStatus(plan, entries, cyc, s, now, dismissed);
  const hub = s.emergencyAccount;
  const hubB = hubBreakdown(hub, bals.get(hub)?.balance || 0, status);
  let sum = summarize(entries, cyc, s, plan);
  // Safe to spend: what's left of this cycle's allowance. Until the allowance has been moved it
  // can't be more than the allowance account holds; after that, moving money on to another
  // account is reallocating and doesn't lower it.
  const allowAcc = s.allowanceAccount;
  const allowBal = bals.get(allowAcc)?.balance || 0;
  // A move dismissed as "already done" was never logged, so neither was what got spent from it
  // before tracking began. The matched balance is the truth: whatever the allowance says is left
  // beyond what the account holds was spent before tracking, and counts as spent.
  const dismissedMove = status.find((p) => p.kind === 'Move' && p.to === allowAcc && p.dismissed);
  const spentBefore = dismissedMove && allowAcc !== hub ? Math.max(0, Math.round((sum.allowanceLeft - Math.max(allowBal, 0)) * 100) / 100) : 0;
  if (spentBefore) sum = { ...sum, allowanceUsed: sum.allowanceUsed + spentBefore, allowanceLeft: sum.allowanceLeft - spentBefore, spentBefore };
  const allowLeft = sum.allowanceLeft;
  const allowMove = status.find((p) => p.kind === 'Move' && p.to === allowAcc && !p.complete) || null;
  let safe = allowMove ? Math.min(allowLeft, Math.max(allowBal, 0)) : allowLeft;
  // one account doing both jobs: you can't safely spend more than its free money
  if (allowAcc === hub) safe = Math.min(safe, Math.max(0, hubB.free));
  const pace = allowancePace(sum, cyc, s, now);
  const allowanceUnmoved = !!allowMove && (!allowMove.due || dayKey(now) >= dayKey(allowMove.due));
  return { s, cyc, bals, total, status, hub, hubB, sum, allowAcc, allowBal, allowLeft, allowMove, safe, pace, allowanceUnmoved, spentBefore };
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
