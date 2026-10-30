// The Extras store (budgets, goals and other new features' data) in the real app.
// Checks: values reach the sheet's Extras tab; an older sheet script keeps them on the phone
// without blocking other changes; once the script is updated they are sent up.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-extras.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEnv } from './fake-sheet.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { ctx } = makeEnv();
ctx.setup();
const token = ctx.getToken_();
const URL_ = 'https://script.google.com/macros/s/TEST/exec';
const server = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).text);

let featuresOnly = false; // a script that lists its features (without extras) and answers anything else with a different error
let extrasCalls = 0;
let oldScript = true; // pretend the sheet still runs the script from before the Extras tab
// hold(match) keeps the next matching request waiting until release() is called, so a test can
// change things while that request is still on its way to the sheet
let holding = null;
const hold = (match) => new Promise((arrived) => { holding = { match, arrived }; });
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await c.route('https://script.google.com/**', async (route) => {
  const body = JSON.parse(route.request().postData());
  if (holding?.match(body)) { const h = holding; holding = null; await new Promise((release) => h.arrived(release)); }
  let out;
  if (body.action === 'extras') extrasCalls++;
  if (featuresOnly && body.action === 'extras') out = JSON.stringify({ ok: false, error: 'Nope' });
  else if (oldScript && body.action === 'extras') out = JSON.stringify({ ok: false, error: 'Unknown action: extras' });
  else {
    out = ctx.doPost({ postData: { contents: route.request().postData() } }).text;
    if (featuresOnly && (body.action === 'list' || body.action === 'ping')) { const d = JSON.parse(out); delete d.extras; d.features = ['install']; out = JSON.stringify(d); }
    if (oldScript && body.action === 'list') { const d = JSON.parse(out); delete d.extras; out = JSON.stringify(d); }
  }
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
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
// waits until every queued change has gone. (Not waitForFunction with an async predicate: it treats
// the returned Promise as truthy and returns at once, which made this file flaky.)
const settle = () => p.evaluate(async () => {
  const st = await import('/js/store.js');
  for (const t0 = Date.now(); st.state.outbox.length;) {
    if (Date.now() - t0 > 8000) throw new Error(`outbox still has ${st.state.outbox.length} change(s)`);
    await new Promise((r) => setTimeout(r, 50));
  }
});

// Moves the page's clock forward 31s (Date.now only) instead of sleeping through the store's 30s
// "the list was just read" window: no real waiting, and nothing to go wrong when the machine is slow.
const skipPastFreshWindow = () => p.evaluate(() => {
  if (!window.__realNow) { window.__realNow = Date.now.bind(Date); window.__skew = 0; Date.now = () => window.__realNow() + window.__skew; }
  window.__skew += 31000;
});

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };

// 1. old script: kept on the phone, queue not blocked
server({ action: 'extras', key: 'budgets', value: { Groceries: 100 } }); // an older value already in the sheet
await app((st) => st.saveExtra('budgets', { Groceries: 600 }));
await app((st) => st.saveExtra('goals', [{ id: 'g0', name: 'Laptop' }]));
await app((st) => st.addEntry({ type: 'Spend', amount: 12, account: 'ADCB', category: 'Groceries', merchant: 'Lulu' }));
await settle();
ok(server({ action: 'list' }).entries.some((e) => e.merchant === 'Lulu'), 'old script: an entry saved after an extra still reaches the sheet');
ok(await app((st) => st.extrasOnPhoneOnly() && st.getExtra('budgets').Groceries === 600), 'old script: the budget stays on the phone');
await app((st) => st.sync());
ok(await app((st) => st.getExtra('budgets')?.Groceries === 600), 'old script: a full sync does not wipe the phone-only budget');

// 2. script updated: the first thing saved goes through, and the other phone-only keys still follow
oldScript = false;
await app((st) => st.saveExtra('theme', { v: 1 }));
await settle();
await skipPastFreshWindow(); // past the "list was just read" window (30s), so the next sync reads the sheet
await app((st) => st.sync());
await settle();
ok(server({ action: 'list' }).extras.budgets?.Groceries === 600, 'updated script: the phone-only budget reaches the Extras tab and beats the older sheet value');
ok(server({ action: 'list' }).extras.goals?.[0]?.name === 'Laptop', 'updated script: every other phone-only key is sent up too');
ok(await app((st) => st.getExtra('budgets')?.Groceries === 600), 'the phone keeps its newer value');
ok(await app((st) => !st.extrasOnPhoneOnly()), 'updated script: no longer phone-only');

// 3. normal saves, undo, and a change made in the sheet showing up
await app((st) => st.saveExtra('budgets', { Groceries: 700 }));
await settle();
ok(server({ action: 'list' }).extras.budgets.Groceries === 700, 'a new value replaces the old one in the sheet');
await app((st) => st.undo());
await settle();
ok(server({ action: 'list' }).extras.budgets.Groceries === 600, 'undo puts the old value back in the sheet');
server({ action: 'extras', key: 'goals', value: [{ id: 'g', name: 'Car' }] });
await skipPastFreshWindow(); // past the "list was just read" window (30s), so the next sync reads the sheet
await app((st) => st.sync());
ok(await app((st) => st.getExtra('goals')?.[0]?.name === 'Car'), 'a value saved in the sheet shows up in the app');

// undo of a brand-new key clears it everywhere, no leftover value
await app((st) => st.saveExtra('fresh', { a: 1 }));
await settle();
await app((st) => st.undo());
await settle();
ok(!('fresh' in server({ action: 'list' }).extras) && await app((st) => st.getExtra('fresh', 'none') === 'none'), 'undoing a new key clears it in the sheet and the app');

// a change made while an earlier one is still on its way doesn't knock a different change off the queue
let release = hold((b) => b.action === 'extras' && b.key === 'race');
await app((st) => st.saveExtra('race', { v: 1 }));
release = await release; // the first 'race' is now in flight
await app((st) => st.saveExtra('queued', { v: 1 }));
await app((st) => st.saveExtra('race', { v: 2 })); // replaces the queued copy of 'race', which is the one in flight
release();
await settle();
ok(server({ action: 'list' }).extras.queued?.v === 1 && server({ action: 'list' }).extras.race?.v === 2, 'a key saved while another is sending still reaches the sheet');
release = hold((b) => b.action === 'add' && b.entry?.merchant === 'Spinneys');
const added = await app((st) => st.addEntry({ type: 'Spend', amount: 5, account: 'ADCB', category: 'Groceries', merchant: 'Spinneys' }).id);
release = await release;
await app((st, id) => st.updateEntry(id, { amount: 9 }), added); // edits an entry whose add is in flight
release();
await settle();
ok(server({ action: 'list' }).entries.find((e) => e.id === added)?.amount === 9, 'an edit made while its entry is still being added reaches the sheet');

// 3b. a script that lists its features: no `extras` there means old, without matching any error text
featuresOnly = true; extrasCalls = 0;
await skipPastFreshWindow(); // past the "list was just read" window (30s), so the next sync reads the sheet
await app((st) => st.sync());
// sync() joins a sync that is already running (and reads again after it), so wait for the read to land
ok(await app(async (st) => { for (const t0 = Date.now(); Date.now() - t0 < 10000;) { if (JSON.stringify(st.state.scriptFeatures) === '["install"]') return true; await new Promise((r) => setTimeout(r, 50)); } return false; }), 'the features the script sends are remembered');
await app((st) => st.saveExtra('viaFeatures', { v: 1 }));
await app((st) => st.addEntry({ type: 'Spend', amount: 3, account: 'ADCB', category: 'Groceries', merchant: 'FeatureShop' }));
await settle();
ok(extrasCalls === 0, 'a script without the extras feature is not even sent an extra');
ok(await app((st) => st.extrasOnPhoneOnly() && st.getExtra('viaFeatures')?.v === 1), 'its extras stay on the phone');
ok(server({ action: 'list' }).entries.some((e) => e.merchant === 'FeatureShop'), 'and the queue behind them still goes through');
ok(await app((st) => st.scriptLacks('extras') && !st.scriptLacks('install') && !st.scriptLacks('x', null)), 'scriptLacks: only a script that listed its features can lack one');
const skipped = await app(async (st) => { st.state.scriptFeatures = []; return st.installSheet('https://script.google.com/macros/s/NONE/exec', 'x'); });
ok(skipped.old === true, 'a script that lists features without install is not asked to install (counts as set up by hand)');
await app((st) => { st.state.scriptFeatures = ['install']; });
// the updated script sends extras again: the phone-only value goes up
featuresOnly = false; oldScript = false;
await skipPastFreshWindow(); // past the "list was just read" window (30s), so the next sync reads the sheet
await app((st) => st.sync());
await settle();
ok(server({ action: 'list' }).extras.viaFeatures?.v === 1 && await app((st) => !st.extrasOnPhoneOnly()), 'once the script lists extras the phone-only value is sent up');

// 4. survives a reload (cached)
await p.reload();
ok(await app((st) => st.getExtra('budgets')?.Groceries === 600), 'extras survive a reload');

assert.deepEqual(errors, []);
await b.close();
console.log(`\nextras: all ${n} checks passed`);
