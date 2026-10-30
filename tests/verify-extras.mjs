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

let oldScript = true; // pretend the sheet still runs the script from before the Extras tab
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await c.route('https://script.google.com/**', async (route) => {
  const body = JSON.parse(route.request().postData());
  let out;
  if (oldScript && body.action === 'extras') out = JSON.stringify({ ok: false, error: 'Unknown action: extras' });
  else {
    out = ctx.doPost({ postData: { contents: route.request().postData() } }).text;
    if (oldScript && body.action === 'list') { const d = JSON.parse(out); delete d.extras; out = JSON.stringify(d); }
  }
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
});
const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto('http://localhost:8765/#settings');
await p.fill('input[name="url"]', URL_);
await p.fill('input[name="token"]', token);
await p.click('[data-act="connect"]');
await p.waitForSelector('.status-row .row-title:text("Connected")');
const app = (fn, arg) => p.evaluate(async ([src, a]) => { const st = await import('/js/store.js'); return new Function('st', 'a', `return (${src})(st, a)`)(st, a); }, [fn.toString(), arg]);
const settle = () => p.waitForFunction(async () => { const st = await import('/js/store.js'); return st.state.outbox.length === 0; }, null, { timeout: 8000 });

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
await p.waitForTimeout(31000); // past the "list was just read" window, so the next sync reads the sheet
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
await p.waitForTimeout(31000); // past the "list was just read" window
await app((st) => st.sync());
ok(await app((st) => st.getExtra('goals')?.[0]?.name === 'Car'), 'a value saved in the sheet shows up in the app');

// undo of a brand-new key clears it everywhere, no leftover value
await app((st) => st.saveExtra('fresh', { a: 1 }));
await settle();
await app((st) => st.undo());
await settle();
ok(!('fresh' in server({ action: 'list' }).extras) && await app((st) => st.getExtra('fresh', 'none') === 'none'), 'undoing a new key clears it in the sheet and the app');

// 4. survives a reload (cached)
await p.reload();
ok(await app((st) => st.getExtra('budgets')?.Groceries === 600), 'extras survive a reload');

assert.deepEqual(errors, []);
await b.close();
console.log(`\nextras: all ${n} checks passed`);
