// Activity filters and bulk edit.
// Part 1 (Node): filters.js matching and totals; store.js batch() undoes a bulk change in one exact step.
// Part 2 (browser, real app + Code.gs on the fake sheet): filter, select, recategorise, delete, undo,
// and check the sheet ends up right after each.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-activity.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEnv } from './fake-sheet.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };

globalThis.location = { search: '' };
const store = await import('../docs/js/store.js');
const model = await import('../docs/js/model.js');
const F = await import('../docs/js/filters.js');
const { state, batch, updateEntry, deleteEntry, undo, canUndo, subscribe } = store;

/* ───── Part 1: filters ───── */
const T = (iso) => new Date(iso).toISOString();
const settings = { ...model.SAMPLE_SETTINGS, cycleStart: 27, usdRate: 3.6725 };
const seed = [
  { id: 'a', date: T('2026-10-29T10:00:00+04:00'), type: 'Spend', amount: 120, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Groceries', merchant: 'Carrefour', note: '', status: 'OK' },
  { id: 'b', date: T('2026-10-28T00:30:00+04:00'), type: 'Spend', amount: 20, currency: 'USD', amountAED: 73.53, account: 'BOTIM', toAccount: '', category: 'Shopping', merchant: 'Steam', note: '', status: 'OK' },
  { id: 'c', date: T('2026-10-27T12:00:00+04:00'), type: 'Transfer', amount: 3000, currency: 'AED', account: 'ADIB', toAccount: 'ADCB', category: '', merchant: '', note: 'Allowance', status: 'OK' },
  { id: 'd', date: T('2026-10-26T23:30:00+04:00'), type: 'Spend', amount: 33, currency: 'AED', account: 'ADCB', toAccount: '', category: '', merchant: 'Salt', note: '', status: 'Review' },
  { id: 'e', date: T('2026-10-20T09:00:00+04:00'), type: 'Income', amount: 89, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Refund', merchant: 'Noon', note: '', status: 'OK' },
  { id: 'f', date: T('2026-09-15T09:00:00+04:00'), type: 'Adjustment', amount: -12, currency: 'AED', account: 'ADCB', toAccount: '', category: '', merchant: '', note: 'Matched with bank', status: 'OK' },
];
const now = new Date('2026-10-30T09:00:00+04:00'); // this cycle = 27 Oct → 26 Nov
const ids = (patch) => F.matchEntries(seed, { ...F.EMPTY_FILTER, ...patch }, settings, now).map((e) => e.id).join('');

ok(ids({}) === 'abcdef', 'no filter shows everything');
ok(ids({ account: 'ADCB' }) === 'acdef', 'account filter includes transfers INTO the account');
ok(ids({ account: 'ADIB' }) === 'c', 'account filter includes transfers OUT of the account');
ok(ids({ category: 'Groceries' }) === 'a', 'category filter');
ok(ids({ category: F.NO_CATEGORY }) === 'd', 'Uncategorised = spend/income with no category (not transfers or bank matches)');
ok(ids({ period: 'this' }) === 'abc', 'this cycle starts on the 27th, Abu Dhabi time (26 Oct 23:30 is last cycle)');
ok(ids({ period: 'last' }) === 'de', 'last cycle');
ok(ids({ period: 'custom', from: '2026-10-26', to: '2026-10-28' }) === 'bcd', 'custom dates are inclusive Abu Dhabi days');
ok(ids({ period: 'custom' }) === 'abcdef' && F.extraCount({ ...F.EMPTY_FILTER, period: 'custom' }) === 0, 'custom with no dates filters nothing and counts as off');
ok(ids({ min: '70', max: '100' }) === 'be', 'amount range compares USD by its AED value (USD 20 = AED 73.53)');
ok(ids({ min: '10', max: '15' }) === 'f', 'amount uses the size of a negative bank match');
ok(ids({ kind: 'Spend', account: 'ADCB', period: 'this' }) === 'a', 'chips and sheet filters combine');
ok(ids({ q: 'steam', account: 'BOTIM' }) === 'b', 'search combines with filters');
ok(!F.isFiltered(F.EMPTY_FILTER) && F.isFiltered({ ...F.EMPTY_FILTER, min: '5' }), 'isFiltered');

const t = F.totals(seed, settings);
ok(t.count === 6 && t.spent === 226.53 && t.income === 89, `totals: spending ${t.spent}, income ${t.income}; transfers and bank matches count in neither`);
ok(F.activeLabels({ ...F.EMPTY_FILTER, account: 'ADCB', category: F.NO_CATEGORY, period: 'custom', from: '2026-10-01', to: '', min: '50' }).map((x) => x[1]).join('|') === 'ADCB|Uncategorised|1 Oct – today|AED 50+', 'filter pill labels');

/* ───── Part 1b: batch() and one undo ───── */
state.entries = seed.map((e) => ({ ...e, cycle: model.cycleOf(e.date, 27), amountAED: e.amountAED ?? e.amount, source: 'App' }));
const snap = () => JSON.stringify([...state.entries].sort((a, b) => (a.id < b.id ? -1 : 1)));
let emits = 0;
subscribe((r) => { if (r === 'entries') emits++; });

let before = snap();
const outBefore = state.outbox.length;
const changed = batch('Moved 2 entries to Health', () => ['a', 'd'].forEach((id) => updateEntry(id, { category: 'Health' })));
ok(changed === 2 && state.entries.filter((e) => e.category === 'Health').length === 2, 'bulk recategorise changes both entries');
ok(state.entries.find((e) => e.id === 'd').status === 'OK', 'a Needs review entry given a category is filed');
ok(emits === 1, `the list redraws once for the whole batch (${emits})`);
ok(store.lastAction() === 'Moved 2 entries to Health', 'one undo step, labelled for the batch');
undo();
ok(snap() === before, 'one undo restores every entry exactly (status included)');
ok(!canUndo() || store.lastAction() !== 'Moved 2 entries to Health', 'the batch step is gone after undo');

before = snap();
batch('Deleted 3 entries', () => ['a', 'b', 'c'].forEach((id) => deleteEntry(id)));
ok(state.entries.length === 3, 'bulk delete removes all three');
const ops = state.outbox.slice(outBefore).map((o) => o.op);
ok(ops.filter((o) => o === 'delete').length === 3, 'each delete is queued for the sheet');
undo();
ok(snap() === before, 'one undo brings all three back exactly');
const ops2 = state.outbox.slice(outBefore).map((o) => o.op);
ok(ops2.filter((o) => o === 'add').length === 3, 'undo queues them back to the sheet');

// a batch that throws midway still records what it did, as one step
const before3 = snap();
try { batch('Half done', () => { updateEntry('a', { category: 'Health' }); updateEntry('b', { category: 'Health' }); throw new Error('boom'); }); } catch {}
ok(store.lastAction() === 'Half done' && state.entries.find((e) => e.id === 'b').category === 'Health', 'a batch that throws keeps its partial changes as one undo step');
undo();
ok(snap() === before3, 'undoing the partial batch restores everything');

// a batch that changes nothing leaves no undo step
const steps = store.lastAction();
ok(batch('Nothing', () => {}) === 0 && store.lastAction() === steps, 'an empty batch adds no undo step');

// money check: balances after bulk delete + undo are what they were
const bal0 = JSON.stringify([...model.balances(state.entries, settings)]);
batch('Deleted 2', () => ['a', 'e'].forEach((id) => deleteEntry(id)));
undo();
ok(JSON.stringify([...model.balances(state.entries, settings)]) === bal0, 'balances are back to the same numbers after bulk delete + undo');

/* ───── Part 2: the real app against the fake sheet ───── */
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { ctx } = makeEnv();
ctx.setup();
const token = ctx.getToken_();
const URL_ = 'https://script.google.com/macros/s/TEST/exec';
const server = () => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
let offline = false; // test switch: while true the phone can't reach the sheet, so nothing syncs
await c.route('https://script.google.com/**', async (route) => {
  if (offline) return route.abort();
  const out = ctx.doPost({ postData: { contents: route.request().postData() } });
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text });
});
const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto((process.env.BASE || 'http://localhost:8765') + '/#settings');
await p.fill('input[name="url"]', URL_);
await p.fill('input[name="token"]', token);
await p.click('[data-act="connect"]');
await p.waitForSelector('.status-row .row-title:text("Connected")');
const app = (fn, arg) => p.evaluate(async ([src, a]) => { const st = await import('/js/store.js'); return new Function('st', 'a', `return (${src})(st, a)`)(st, a); }, [fn.toString(), arg]);
// waits until every queued change has reached the sheet (polls from Node: an async waitForFunction never waits)
async function settle() {
  for (let i = 0; i < 300; i++) {
    if (await app((st) => st.state.outbox.length === 0)) { await new Promise((r) => setTimeout(r, 50)); if (await app((st) => st.state.outbox.length === 0)) return; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('changes never reached the sheet');
}

await app((st) => {
  st.addEntry({ type: 'Spend', amount: 12, account: 'ADCB', category: 'Other', merchant: 'Kiosk A' });
  st.addEntry({ type: 'Spend', amount: 18, account: 'ADCB', category: 'Other', merchant: 'Kiosk B' });
  st.addEntry({ type: 'Spend', amount: 250, account: 'ADIB', category: 'Shopping', merchant: 'Ikea' });
  st.addEntry({ type: 'Transfer', amount: 100, account: 'ADIB', toAccount: 'ADCB', note: 'Top-up' });
});
await settle();
ok(server().filter((e) => /Kiosk|Ikea/.test(e.merchant)).length === 3, 'browser: test entries reached the sheet');

await p.click('.tabbar [data-tab="activity"]');
await p.click('[data-act="filters"]');
await p.selectOption('.sheet select[name="account"]', 'ADCB');
await p.fill('.sheet input[name="max"]', '50');
await p.click('.sheet [data-act="done"]');
await p.waitForFunction(() => !document.querySelector('.sheet') && document.querySelectorAll('.activity-list .entry').length === 2);
ok(await p.locator('.activity-list .entry').count() === 2, 'browser: ADCB up to AED 50 shows the two kiosk payments');
ok((await p.textContent('.act-bar')).includes('AED 30.00'), 'browser: the filtered total shows AED 30.00');
ok(await p.locator('.af-pill').count() === 2 && (await p.textContent('.filter-count')) === '2', 'browser: two filter pills and a 2 on the Filter button');

await p.click('[data-act="select"]');
ok(await p.evaluate(() => document.documentElement.classList.contains('selecting')), 'browser: Select mode swaps the tab bar for the action bar');
await p.click('[data-act="select-all"]');
ok((await p.textContent('.act-bar')).includes('2 selected'), 'browser: Select all ticks every match');
await p.click('[data-act="bulk-cat"]');
await p.click('.sheet .rc-cat[data-cat="Food & Drinks"]');
await settle();
ok(server().filter((e) => /Kiosk/.test(e.merchant)).every((e) => e.category === 'Food & Drinks'), 'browser: bulk recategorise reached the sheet');
ok(!(await p.evaluate(() => document.documentElement.classList.contains('selecting'))), 'browser: Select mode ends after the change');

await p.click('[data-act="undo"]');
await settle();
ok(server().filter((e) => /Kiosk/.test(e.merchant)).every((e) => e.category === 'Other'), 'browser: one undo puts both categories back on the sheet');

await p.click('[data-act="select"]');
await p.click('[data-act="select-all"]');
await p.click('[data-act="bulk-del"]');
await p.click('.sheet [data-act="confirm"]');
await settle();
ok(!server().some((e) => /Kiosk/.test(e.merchant)) && server().some((e) => e.merchant === 'Ikea'), 'browser: bulk delete removed only the selected entries from the sheet');
ok((await p.textContent('.activity-list')).includes('Nothing matches these filters.'), 'browser: the list says nothing matches');
await p.click('[data-act="undo"]');
await settle();
ok(server().filter((e) => /Kiosk/.test(e.merchant)).length === 2, 'browser: one undo puts both deleted entries back on the sheet');

await p.click('.af-clear');
ok(await p.locator('.af-pill').count() === 0, 'browser: Clear all removes every filter');
await p.click('[data-act="select"]');
await p.click('[data-act="select-done"]');
ok(!(await p.evaluate(() => document.documentElement.classList.contains('selecting'))) && await p.locator('.pick').count() === 0, 'browser: Done leaves Select mode');

/* ───── Bulk delete + undo, and selection safety ───── */
const sheetKeys = () => server().filter((e) => /^Bulk/.test(e.merchant)).map((e) => `${e.merchant}|${e.amount}`).sort();
const balances = () => p.evaluate(async () => {
  const st = await import('/js/store.js'); const md = await import('/js/model.js');
  return JSON.stringify([...md.balances(st.state.entries, st.state.settings)]);
});
await app((st) => {
  [['Bulk One', 11], ['Bulk Two', 22], ['Bulk Three', 33], ['Bulk Four', 44]].forEach(([m, a]) => st.addEntry({ type: 'Spend', amount: a, account: 'ADCB', category: 'Other', merchant: m }));
});
await settle();
const wantKeys = ['Bulk Four|44', 'Bulk One|11', 'Bulk Three|33', 'Bulk Two|22'];
ok(sheetKeys().join() === wantKeys.join(), 'browser: four Bulk entries are on the sheet');
const balB0 = await balances();
await p.fill('.search input', 'Bulk ');
await p.waitForFunction(() => { const r = [...document.querySelectorAll('.activity-list .entry')]; return r.length > 0 && r.every((x) => /Bulk/.test(x.textContent)); });
const keepId = await app((st) => st.state.entries.find((e) => e.merchant === 'Bulk Four').id);
const selectAndDelete = async () => {
  await p.click('[data-act="select"]');
  await p.click('[data-act="select-all"]');
  await p.click(`.entry[data-id="${keepId}"]`); // untick the one to keep
  await p.click('[data-act="bulk-del"]');
  ok((await p.textContent('.sheet .del-list')).includes('Bulk'), 'browser: the delete sheet lists the entries it will remove');
  await p.click('.sheet [data-act="confirm"]');
};

// (1) delete 3, undo BEFORE any sync (phone offline the whole time)
offline = true;
await selectAndDelete();
ok(await app((st) => st.state.entries.filter((e) => /^Bulk/.test(e.merchant)).length) === 1, 'browser: 3 of 4 deleted on the phone');
ok((await p.textContent('#toast')).includes('Deleted 3 entries'), 'browser: the toast confirms the delete');
await p.click('#toast .toast-action');
offline = false;
await app((st) => st.sync());
await settle();
ok(sheetKeys().join() === wantKeys.join(), 'browser: undo before sync leaves each row on the sheet exactly once');
ok(await balances() === balB0, 'browser: balances equal the before state (undo before sync)');

// (2) delete 3, let it sync, then undo with the normal Undo button in the title
await selectAndDelete();
await settle();
ok(sheetKeys().join() === 'Bulk Four|44', 'browser: after sync the sheet has only the kept row');
await p.click('.large-title [data-act="undo"]');
await settle();
ok(sheetKeys().join() === wantKeys.join(), 'browser: undo after the delete synced puts each row back exactly once');
ok(await balances() === balB0, 'browser: balances equal the before state (undo after sync)');

// the toast lasts long enough, and its Undo only undoes its own step
await selectAndDelete();
await p.waitForTimeout(6200);
ok(await p.evaluate(() => document.getElementById('toast').classList.contains('show')), 'browser: the bulk Undo toast is still up after 6 seconds');
await app((st) => st.addEntry({ type: 'Spend', amount: 5, account: 'ADCB', category: 'Other', merchant: 'Later' }));
await p.click('#toast .toast-action');
await settle();
ok(sheetKeys().join() === 'Bulk Four|44' && server().some((e) => e.merchant === 'Later'), 'browser: toast Undo does nothing if another change happened since');
await p.click('.large-title [data-act="undo"]'); // undoes "Later"
await p.click('.large-title [data-act="undo"]'); // undoes the bulk delete
await settle();
ok(sheetKeys().join() === wantKeys.join() && !server().some((e) => e.merchant === 'Later'), 'browser: the title Undo still reaches the bulk step afterwards');

// a selection made before the search changed must not delete what is now hidden
await p.click('[data-act="select"]');
await p.click('[data-act="select-all"]');
ok((await p.textContent('.act-bar')).includes('4 selected'), 'browser: four Bulk entries selected');
await p.fill('.search input', 'Bulk One');
await p.waitForFunction(() => { const r = [...document.querySelectorAll('.activity-list .entry')]; return r.length === 1 && /Bulk One/.test(r[0].textContent); });
ok((await p.textContent('.act-bar')).includes('1 selected'), 'browser: narrowing the search drops hidden rows from the selection');
await p.click('[data-act="bulk-del"]');
await p.click('.sheet [data-act="confirm"]');
await settle();
ok(sheetKeys().join() === ['Bulk Four|44', 'Bulk Three|33', 'Bulk Two|22'].join(), 'browser: only the visible match was deleted');
await p.click('.large-title [data-act="undo"]');
await settle();
ok(sheetKeys().join() === wantKeys.join(), 'browser: undo restores it');
await p.fill('.search input', '');

ok(errors.length === 0, `browser: no page errors ${errors.join('; ')}`);

await b.close();
console.log(`all ${n} activity checks passed`);
