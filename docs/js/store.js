// App state: a local cache of the Sheet, an offline outbox, and the Apps Script client.
import { DEFAULT_SETTINGS, DEFAULT_PLAN, DEFAULT_ACCOUNTS, setAccountList, balances, cycleOf, toAED, uid, money } from './model.js';
import { demoEntries, DEMO_PLAN } from './demo.js';

const K = { conn: 'sp.conn', cache: 'sp.cache', outbox: 'sp.outbox', prefs: 'sp.prefs', dismissed: 'sp.dismissed' };

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

const listeners = new Set();
export const state = {
  conn: read(K.conn, { url: '', token: '' }),
  entries: [],
  settings: { ...DEFAULT_SETTINGS },
  merchants: {},
  plan: DEFAULT_PLAN.map((p) => ({ ...p })),
  accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
  outbox: read(K.outbox, []),
  prefs: { lock: false, demo: false, credId: '', appearance: null, ...read(K.prefs, {}) },
  sync: { status: 'idle', error: '', at: 0 },
  sheetUrl: '',
  // payday prompts hidden for one cycle: { planId: cycle }. Kept on this phone; changes no balances.
  dismissed: read(K.dismissed, {}),
};

const cache = read(K.cache, null);
if (cache) Object.assign(state, { entries: cache.entries || [], settings: { ...DEFAULT_SETTINGS, ...cache.settings }, merchants: cache.merchants || {}, sheetUrl: cache.sheetUrl || '', plan: cache.plan?.length ? cache.plan : state.plan, accounts: cache.accounts?.length ? cache.accounts : state.accounts });
setAccountList(state.accounts);

export const isConnected = () => !!(state.conn.url && state.conn.token);
export const isDemo = () => !!state.prefs.demo;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { for (const fn of listeners) fn(reason); }

function persist() {
  if (state.prefs.demo) return;
  write(K.cache, { entries: state.entries, settings: state.settings, merchants: state.merchants, sheetUrl: state.sheetUrl, plan: state.plan, accounts: state.accounts });
  write(K.outbox, state.outbox);
}

export function setPrefs(patch) { Object.assign(state.prefs, patch); write(K.prefs, state.prefs); emit('prefs'); }

export function setConnection(url, token) {
  state.conn = { url: url.trim(), token: token.trim() };
  write(K.conn, state.conn);
  emit('conn');
}

/* ───── Apps Script client ───── */

async function call(body, { timeout = 20000 } = {}) {
  if (!isConnected()) throw new Error('Not connected to your Google Sheet yet.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
    const res = await fetch(state.conn.url, {
      method: 'POST', body: JSON.stringify({ token: state.conn.token, ...body }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal, redirect: 'follow',
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'The sheet said no.');
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The sheet took too long to answer.');
    if (e instanceof TypeError) throw new Error(navigator.onLine ? 'Couldn’t reach the sheet. Check the Web app URL.' : 'You’re offline. Changes will sync later.');
    throw e;
  } finally { clearTimeout(t); }
}

export async function ping(url, token) {
  const prev = state.conn;
  state.conn = { url, token };
  try { return await call({ action: 'ping' }, { timeout: 15000 }); } finally { state.conn = prev; }
}

/* ───── Sync ───── */

let syncing = null;
let again = false;
export function sync() {
  if (state.prefs.demo || !isConnected()) return Promise.resolve();
  // a change made mid-sync gets its own pass straight after
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    state.sync = { ...state.sync, status: 'syncing', error: '' };
    emit('sync');
    try {
      await flushOutbox();
      const data = await call({ action: 'list' });
      state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      state.merchants = data.merchants || {};
      if (Array.isArray(data.plan) && !state.outbox.some((o) => o.op === 'plan')) state.plan = data.plan;
      if (Array.isArray(data.accounts) && data.accounts.length && !state.outbox.some((o) => o.op === 'accounts' || o.op === 'rename')) { state.accounts = data.accounts; setAccountList(state.accounts); }
      state.sheetUrl = data.sheetUrl || '';
      const pending = new Map(state.outbox.map((o) => [o.id, o]));
      const server = (data.entries || []).filter((e) => !(pending.get(e.id)?.op === 'delete'));
      const ids = new Set(server.map((e) => e.id));
      // keep optimistic local entries the sheet hasn't seen yet
      const local = state.entries.filter((e) => pending.has(e.id) && pending.get(e.id).op !== 'delete' && !ids.has(e.id));
      // the cycle always follows the date and today's start day, even if the sheet's column is stale
      state.entries = sortEntries([...server.map((e) => overlay(e, pending.get(e.id))), ...local]
        .map((e) => ({ ...e, cycle: cycleOf(e.date, state.settings.cycleStart) })));
      state.sync = { status: state.outbox.length ? 'pending' : 'ok', error: '', at: Date.now() };
      persist();
    } catch (e) {
      state.sync = { status: 'error', error: e.message, at: state.sync.at };
    } finally {
      syncing = null;
      emit('sync');
      if (again) { again = false; if (state.sync.status !== 'error') sync(); }
    }
  })();
  return syncing;
}

const overlay = (e, op) => (op && op.op === 'update' ? { ...e, ...op.fields } : e);
const sortEntries = (list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

async function flushOutbox() {
  while (state.outbox.length) {
    const op = state.outbox[0];
    if (op.op === 'add') await call({ action: 'add', entry: op.entry });
    else if (op.op === 'update') await call({ action: 'update', id: op.id, fields: op.fields });
    else if (op.op === 'delete') await call({ action: 'delete', id: op.id });
    else if (op.op === 'settings') await call({ action: 'settings', settings: op.settings });
    else if (op.op === 'plan') await call({ action: 'plan', plan: op.plan });
    else if (op.op === 'accounts') await call({ action: 'accounts', accounts: op.accounts });
    else if (op.op === 'rename') await call({ action: 'renameAccount', from: op.from, to: op.to });
    else if (op.op === 'reset') await call({ action: 'reset' }, { timeout: 60000 });
    state.outbox.shift();
    persist();
  }
}

function enqueue(op) {
  // collapse edits to something that hasn't left the phone yet
  const i = state.outbox.findIndex((o) => o.id === op.id && op.id);
  if (i >= 0) {
    const prev = state.outbox[i];
    if (op.op === 'delete' && prev.op === 'add') { state.outbox.splice(i, 1); persist(); return; }
    if (op.op === 'update' && prev.op === 'add') { prev.entry = { ...prev.entry, ...op.fields }; persist(); return; }
    if (op.op === 'update' && prev.op === 'update') { prev.fields = { ...prev.fields, ...op.fields }; persist(); return; }
  }
  state.outbox.push(op);
  persist();
}

/* ───── Mutations (optimistic) ───── */

function finalize(e, { keepAED = false } = {}) {
  const out = { ...e };
  if (!out.date || Number.isNaN(new Date(out.date).getTime())) out.date = new Date().toISOString();
  out.cycle = cycleOf(out.date, state.settings.cycleStart);
  if (!keepAED) out.amountAED = toAED({ ...out, amountAED: null }, state.settings);
  if (out.type === 'Transfer' || out.type === 'Adjustment') out.category = '';
  if (out.type !== 'Transfer') out.toAccount = '';
  out.status = out.type === 'Adjustment' ? 'OK' : (out.type !== 'Transfer' && !out.category) || !(out.amount > 0) ? 'Review' : 'OK';
  return out;
}

/* ───── Undo ─────
   Every change records how to reverse itself. undo() replays the reversal without recording it. */
const history = [];
let muted = 0;
function record(label, reverse) {
  if (muted) return;
  history.push({ label, reverse });
  if (history.length > 30) history.shift();
  emit('history');
}
export const canUndo = () => history.length > 0;
export const lastAction = () => history[history.length - 1]?.label || '';
export function undo() {
  const h = history.pop();
  if (!h) return '';
  muted++;
  try { h.reverse(); } finally { muted--; }
  emit('history');
  return h.label;
}
const describe = (e) => `${money(e.amount, e.currency)}${e.merchant ? ` · ${e.merchant}` : e.type === 'Transfer' ? ` · ${e.account} → ${e.toAccount}` : ''}`;
const ENTRY_FIELDS = ['type', 'amount', 'currency', 'account', 'toAccount', 'category', 'merchant', 'note', 'date', 'source'];

export function addEntry(fields) {
  const e = finalize({ id: uid(), source: 'App', currency: 'AED', note: '', merchant: '', ...fields });
  state.entries = sortEntries([e, ...state.entries]);
  if (e.merchant && e.category && e.type === 'Spend') state.merchants[merchantKey(e.merchant)] = e.category;
  if (!state.prefs.demo) enqueue({ op: 'add', id: e.id, entry: e });
  record(e.type === 'Adjustment' ? `Matched ${e.account} with bank` : `Added ${describe(e)}`, () => deleteEntry(e.id));
  persist(); emit('entries');
  sync();
  return e;
}

export function updateEntry(id, fields) {
  const i = state.entries.findIndex((x) => x.id === id);
  if (i < 0) return;
  const before = state.entries[i];
  record(`Edited ${describe(before)}`, () => putBack(before));
  // a USD entry keeps the rate it was priced at unless its amount or currency changes
  const repriced = ('amount' in fields && +fields.amount !== +before.amount) || ('currency' in fields && fields.currency !== before.currency);
  const e = finalize({ ...before, ...fields }, { keepAED: !repriced && before.amountAED != null && before.amountAED !== '' });
  state.entries[i] = e;
  sortEntries(state.entries);
  const sent = { ...fields, cycle: undefined };
  delete sent.cycle; delete sent.status; delete sent.amountAED;
  if (!state.prefs.demo) enqueue({ op: 'update', id, fields: sent });
  persist(); emit('entries');
  sync();
  return e;
}

/** Undo of an edit: the entry exactly as it was, price and status included. */
function putBack(before) {
  const i = state.entries.findIndex((x) => x.id === before.id);
  if (i < 0) return;
  state.entries[i] = { ...before };
  sortEntries(state.entries);
  const fields = Object.fromEntries([...ENTRY_FIELDS, 'amountAED', 'status'].map((k) => [k, before[k]]));
  if (!state.prefs.demo) enqueue({ op: 'update', id: before.id, fields });
  persist(); emit('entries');
  sync();
}

export function deleteEntry(id) {
  const removed = state.entries.find((x) => x.id === id);
  state.entries = state.entries.filter((x) => x.id !== id);
  if (removed) record(`Deleted ${describe(removed)}`, () => restoreEntry(removed));
  if (!state.prefs.demo) enqueue({ op: 'delete', id });
  persist(); emit('entries');
  sync();
  return removed;
}

export function restoreEntry(entry) {
  state.entries = sortEntries([entry, ...state.entries.filter((x) => x.id !== entry.id)]);
  if (!state.prefs.demo) enqueue({ op: 'add', id: entry.id, entry });
  persist(); emit('entries');
  sync();
}

export function saveSettings(patch) {
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, state.settings[k]]));
  record('Changed a setting', () => saveSettings(before));
  state.settings = { ...state.settings, ...patch };
  state.entries = state.entries.map((e) => ({ ...e, cycle: cycleOf(e.date, state.settings.cycleStart) }));
  if (!state.prefs.demo) enqueue({ op: 'settings', id: 'settings', settings: patch });
  persist(); emit('settings');
  sync();
}

// same normalisation as the sheet's Merchants tab
const merchantKey = (m) => String(m || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
export function savePlan(plan) {
  const before = state.plan, allowanceBefore = state.settings.allowance;
  record('Changed the payday plan', () => {
    savePlan(before);
    if (state.settings.allowance !== allowanceBefore) saveSettings({ allowance: allowanceBefore });
  });
  state.plan = plan;
  if (!state.prefs.demo) {
    state.outbox = state.outbox.filter((o) => o.op !== 'plan');
    enqueue({ op: 'plan', id: '', plan });
  }
  persist(); emit('plan');
  // the allowance has one definition: the plan's move into the allowance account
  const allowance = plan.filter((p) => p.kind === 'Move' && p.to === state.settings.allowanceAccount).reduce((a, p) => a + (+p.amount || 0), 0);
  if (allowance > 0 && allowance !== state.settings.allowance) { muted++; saveSettings({ allowance }); muted--; }
  sync();
}

/* ───── Dismissed prompts ─────
   "Already done" for a plan item this cycle (it was paid or moved before you started tracking).
   It only hides the prompt and stops the item being counted as still to come; no entry is logged
   and no balance changes. Next cycle the prompt comes back. */

function commitDismissed(map) {
  state.dismissed = map;
  if (!state.prefs.demo) write(K.dismissed, map);
  emit('plan');
}

export function dismissPlan(id, cycle) {
  const before = state.dismissed;
  const name = state.plan.find((p) => p.id === id)?.name || 'prompt';
  record(`Dismissed ${name}`, () => commitDismissed(before));
  // older cycles' dismissals have expired, so they're dropped as new ones are written
  const next = Object.fromEntries(Object.entries(before).filter(([, c]) => c >= cycle));
  next[id] = cycle;
  commitDismissed(next);
}

export function restorePlan(id) {
  if (!(id in state.dismissed)) return;
  const before = state.dismissed;
  const name = state.plan.find((p) => p.id === id)?.name || 'prompt';
  record(`Brought back ${name}`, () => commitDismissed(before));
  const next = { ...before };
  delete next[id];
  commitDismissed(next);
}

/* ───── Accounts ───── */

function commitAccounts(list, { queue = true } = {}) {
  state.accounts = list;
  setAccountList(list);
  if (queue && !state.prefs.demo) {
    state.outbox = state.outbox.filter((o) => o.op !== 'accounts');
    enqueue({ op: 'accounts', id: '', accounts: list });
  }
  persist(); emit('accounts');
  sync();
}

export const nameTaken = (name, except = '') => state.accounts.some((a) => a.name.toLowerCase() === name.trim().toLowerCase() && a.name !== except);

export function addAccount(a) {
  const before = state.accounts;
  record(`Added ${a.name.trim()}`, () => commitAccounts(before));
  commitAccounts([...state.accounts, { name: a.name.trim(), note: a.note || '', color: a.color || 'graphite', wallet: a.wallet || '', archived: false }]);
}

/** Change an account. A new name is carried through every entry, the plan and settings. */
export function updateAccount(oldName, patch) {
  const newName = (patch.name ?? oldName).trim();
  const prev = state.accounts.find((a) => a.name === oldName);
  if (prev) record(newName !== oldName ? `Renamed ${oldName} to ${newName}` : `Edited ${oldName}`, () => updateAccount(newName, { ...prev }));
  muted++;
  if (newName !== oldName) {
    const sw = (v) => (v === oldName ? newName : v);
    state.entries = state.entries.map((e) => (e.account === oldName || e.toAccount === oldName ? { ...e, account: sw(e.account), toAccount: sw(e.toAccount) } : e));
    state.plan = state.plan.map((p) => ({ ...p, from: sw(p.from), to: sw(p.to) }));
    state.settings = { ...state.settings, allowanceAccount: sw(state.settings.allowanceAccount), emergencyAccount: sw(state.settings.emergencyAccount) };
    state.outbox.forEach((o) => { if (o.entry) { o.entry.account = sw(o.entry.account); o.entry.toAccount = sw(o.entry.toAccount); } });
    if (!state.prefs.demo) enqueue({ op: 'rename', id: '', from: oldName, to: newName });
  }
  commitAccounts(state.accounts.map((a) => (a.name === oldName ? { ...a, ...patch, name: newName } : a)));
  muted--;
}

/** Retire an account. Any money left in it is moved to `moveTo` first so the total stays right. */
export function removeAccount(name, moveTo) {
  const bal = balances(state.entries, state.settings).get(name)?.balance || 0;
  const before = state.accounts, planBefore = state.plan;
  let closing = null;
  muted++;
  // payday rules that pointed at this account would now move money nowhere — drop them
  const plan = state.plan.filter((p) => p.from !== name && p.to !== name);
  if (plan.length !== state.plan.length) savePlan(plan);
  if (Math.abs(bal) >= 0.01 && moveTo) {
    closing = addEntry(bal > 0
      ? { type: 'Transfer', amount: bal, account: name, toAccount: moveTo, note: `Closing ${name}` }
      : { type: 'Transfer', amount: -bal, account: moveTo, toAccount: name, note: `Closing ${name}` });
  }
  commitAccounts(state.accounts.map((a) => (a.name === name ? { ...a, archived: true } : a)));
  muted--;
  record(`Removed ${name}`, () => { if (closing) deleteEntry(closing.id); if (state.plan !== planBefore) savePlan(planBefore); commitAccounts(before); });
}

/* ───── Reset ───── */

/** Erase every entry and learned merchant. The sheet keeps a backup copy of the Ledger first. */
export function resetAll() {
  state.entries = [];
  state.merchants = {};
  state.outbox = state.prefs.demo || !isConnected() ? [] : [{ op: 'reset', id: '' }];
  history.length = 0;
  persist(); emit('entries'); emit('history');
  sync();
}

export function moveAccount(name, delta) {
  const list = [...state.accounts], i = list.findIndex((a) => a.name === name), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  commitAccounts(list);
}

export function suggestCategory(merchant) {
  const k = merchantKey(merchant);
  return k ? state.merchants[k] || '' : '';
}

/* ───── Demo ───── */

export function loadDemo() {
  state.prefs.demo = true;
  state.dismissed = {};
  state.entries = sortEntries(demoEntries(state.settings));
  state.merchants = {};
  state.plan = DEMO_PLAN.map((p) => ({ ...p }));
  state.accounts = DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
  setAccountList(state.accounts);
}

export function setDemo(on) {
  // undo never crosses between demo and real data: a demo entry must not land in the real sheet
  history.length = 0;
  emit('history');
  setPrefs({ demo: on });
  state.dismissed = on ? {} : read(K.dismissed, {});
  if (on) loadDemo();
  else {
    const c = read(K.cache, null);
    state.entries = c?.entries || [];
    state.merchants = c?.merchants || {};
    state.settings = { ...DEFAULT_SETTINGS, ...(c?.settings || {}) };
    state.plan = c?.plan?.length ? c.plan : DEFAULT_PLAN.map((p) => ({ ...p }));
    state.accounts = c?.accounts?.length ? c.accounts : DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
    setAccountList(state.accounts);
  }
  emit('entries');
}

// after all declarations: demo can be forced with ?demo=1
if (state.prefs.demo || globalThis.SPENDINGS_DEMO || new URLSearchParams(location.search).has('demo')) loadDemo();
