// App state: a local cache of the Sheet, an offline outbox, and the Apps Script client.
import { DEFAULT_SETTINGS, cycleOf, toAED, uid } from './model.js';
import { demoEntries } from './demo.js';

const K = { conn: 'sp.conn', cache: 'sp.cache', outbox: 'sp.outbox', prefs: 'sp.prefs' };

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

const listeners = new Set();
export const state = {
  conn: read(K.conn, { url: '', token: '' }),
  entries: [],
  settings: { ...DEFAULT_SETTINGS },
  merchants: {},
  outbox: read(K.outbox, []),
  prefs: read(K.prefs, { lock: false, demo: false, credId: '' }),
  sync: { status: 'idle', error: '', at: 0 },
  sheetUrl: '',
};

const cache = read(K.cache, null);
if (cache) Object.assign(state, { entries: cache.entries || [], settings: { ...DEFAULT_SETTINGS, ...cache.settings }, merchants: cache.merchants || {}, sheetUrl: cache.sheetUrl || '' });

export const isConnected = () => !!(state.conn.url && state.conn.token);
export const isDemo = () => !!state.prefs.demo;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { for (const fn of listeners) fn(reason); }

function persist() {
  if (state.prefs.demo) return;
  write(K.cache, { entries: state.entries, settings: state.settings, merchants: state.merchants, sheetUrl: state.sheetUrl });
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
      state.sheetUrl = data.sheetUrl || '';
      const pending = new Map(state.outbox.map((o) => [o.id, o]));
      const server = (data.entries || []).filter((e) => !(pending.get(e.id)?.op === 'delete'));
      const ids = new Set(server.map((e) => e.id));
      // keep optimistic local entries the sheet hasn't seen yet
      const local = state.entries.filter((e) => pending.has(e.id) && pending.get(e.id).op !== 'delete' && !ids.has(e.id));
      state.entries = sortEntries([...server.map((e) => overlay(e, pending.get(e.id))), ...local]);
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

function finalize(e) {
  const out = { ...e };
  out.cycle = cycleOf(out.date, state.settings.cycleStart);
  out.amountAED = toAED({ ...out, amountAED: null }, state.settings);
  if (out.type === 'Transfer') out.category = '';
  else out.toAccount = '';
  out.status = (out.type !== 'Transfer' && !out.category) || !(out.amount > 0) ? 'Review' : 'OK';
  return out;
}

export function addEntry(fields) {
  const e = finalize({ id: uid(), source: 'App', currency: 'AED', note: '', merchant: '', ...fields });
  state.entries = sortEntries([e, ...state.entries]);
  if (e.merchant && e.category && e.type === 'Spend') state.merchants[merchantKey(e.merchant)] = e.category;
  if (!state.prefs.demo) enqueue({ op: 'add', id: e.id, entry: e });
  persist(); emit('entries');
  sync();
  return e;
}

export function updateEntry(id, fields) {
  const i = state.entries.findIndex((x) => x.id === id);
  if (i < 0) return;
  const e = finalize({ ...state.entries[i], ...fields });
  state.entries[i] = e;
  sortEntries(state.entries);
  const sent = { ...fields, cycle: undefined };
  delete sent.cycle; delete sent.status; delete sent.amountAED;
  if (!state.prefs.demo) enqueue({ op: 'update', id, fields: sent });
  persist(); emit('entries');
  sync();
  return e;
}

export function deleteEntry(id) {
  const removed = state.entries.find((x) => x.id === id);
  state.entries = state.entries.filter((x) => x.id !== id);
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
  state.settings = { ...state.settings, ...patch };
  state.entries = state.entries.map((e) => ({ ...e, cycle: cycleOf(e.date, state.settings.cycleStart) }));
  if (!state.prefs.demo) enqueue({ op: 'settings', id: 'settings', settings: patch });
  persist(); emit('settings');
  sync();
}

// same normalisation as the sheet's Merchants tab
const merchantKey = (m) => String(m || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
export function suggestCategory(merchant) {
  const k = merchantKey(merchant);
  return k ? state.merchants[k] || '' : '';
}

/* ───── Demo ───── */

export function loadDemo() {
  state.prefs.demo = true;
  state.entries = sortEntries(demoEntries(state.settings));
  state.merchants = {};
}

export function setDemo(on) {
  setPrefs({ demo: on });
  if (on) loadDemo();
  else {
    const c = read(K.cache, null);
    state.entries = c?.entries || [];
    state.merchants = c?.merchants || {};
    state.settings = { ...DEFAULT_SETTINGS, ...(c?.settings || {}) };
  }
  emit('entries');
}

// after all declarations: demo can be forced with ?demo=1
if (state.prefs.demo || new URLSearchParams(location.search).has('demo')) loadDemo();
