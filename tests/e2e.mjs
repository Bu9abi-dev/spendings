// The real web app in Chromium, talking to Code.gs running on the fake sheet.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/e2e.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEnv } from './fake-sheet.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { ctx } = makeEnv();
ctx.setup();
const token = ctx.getToken_();
const URL_ = 'https://script.google.com/macros/s/TEST/exec';

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
let online = true;
await c.route('https://script.google.com/**', async (route) => {
  if (!online) return route.abort('internetdisconnected');
  const out = ctx.doPost({ postData: { contents: route.request().postData() } });
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text });
});
const p = await c.newPage();
const serverEntries = () => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
async function until(pred, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await p.waitForTimeout(100); } return pred(); }
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto('http://localhost:8765/#settings');
await p.fill('input[name="url"]', URL_);
await p.fill('input[name="token"]', token);
await p.click('[data-act="connect"]');
await p.waitForSelector('.status-row .row-title:text("Connected")');

// add a spend through the UI
await p.click('.fab');
await p.waitForSelector('.sheet .keypad');
for (const k of ['2', '5']) await p.dispatchEvent(`.key[data-key="${k}"]`, 'pointerdown');
await p.fill('input[name="merchant"]', 'Spinneys');
await p.click('.cat[data-cat="Groceries"]');
await p.click('.save-btn');
await p.waitForTimeout(800);
let list = ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } });
let entries = JSON.parse(list.text).entries;
assert.equal(entries.length, 1);
assert.equal(entries[0].merchant, 'Spinneys');
assert.equal(entries[0].amount, 25);
assert.equal(entries[0].category, 'Groceries');

// an Apple Pay payment arrives from the Shortcut, then shows up after a sync
ctx.doPost({ postData: { contents: JSON.stringify({ token, source: 'applepay', amount: 'AED 9.50', merchant: 'Starbucks', card: 'ADCB Platinum', category: 'Decide later' }) } });
await p.click('.tabbar [data-tab="home"]');
await p.click('[data-act="sync"]');
await p.waitForSelector('.review-row');

// file it from the review sheet
await p.click('.review-row');
await p.click('.review-card .rc-cat[data-cat="Food & Drinks"]');
await p.waitForTimeout(800);
entries = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
assert.equal(entries.find((e) => e.merchant === 'Starbucks').category, 'Food & Drinks');
assert.equal(entries.find((e) => e.merchant === 'Starbucks').status, 'OK');
await p.click('[data-act="done"]');
await p.waitForTimeout(400);

// offline: entry is queued, then flushed when back online
online = false;
await p.click('.fab');
await p.dispatchEvent('.key[data-key="7"]', 'pointerdown');
await p.click('.cat[data-cat="Transport & Fuel"]');
await p.click('.save-btn');
await p.waitForTimeout(800);
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries.length, 2);
online = true;
await p.click('[data-act="sync"]');
await p.waitForTimeout(1000);
entries = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
assert.equal(entries.length, 3);

// ADCB view reflects the allowance: 3000 - 25 - 9.5 - 7
await p.click('.key-acc[data-focus="ADCB"]');
await p.waitForSelector('.capsule');
assert.match(await p.textContent('.cap-value'), /2,959|2,958/);

// match ADIB with the bank: balance becomes exactly what was typed
await p.click('.key-acc[data-focus="ADIB"]');
await p.waitForSelector('[data-act="match"]');
await p.click('[data-act="match"]');
await p.waitForSelector('.match-amount');
for (const k of ['1', '2', '0', '0']) await p.dispatchEvent(`.key[data-key="${k}"]`, 'pointerdown');
await p.click('.sheet [data-act="save"]');
await p.waitForTimeout(900);
assert.match(await p.getAttribute('.lv', 'aria-label'), /1,200\.00/);
entries = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
assert.ok(entries.some((e) => e.type === 'Adjustment' && e.account === 'ADIB'));

// payday plan: Nafis "It landed" logs income into ADIB and lifts the balance
await p.click('.key-acc[data-focus="all"]');
await p.waitForTimeout(300);
const landed = await p.$('[data-plan-act="land"]');
if (landed) {
  await landed.click();
  await p.waitForTimeout(900);
  entries = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
  assert.ok(entries.some((e) => e.type === 'Income' && e.account === 'ADIB' && /^Plan:/.test(e.source)));
}
// accounts: add "Wio", rename it, then remove it moving its money back to ADIB
await p.click('.tabbar [data-tab="settings"]');
await p.click('[data-acct-new]');
await p.fill('#af-name', 'Wio');
await p.fill('#af-wallet', 'wio');
await p.click('.sheet [data-colour="sky"]');
await p.click('.sheet [data-act="save"]');
await p.waitForTimeout(900);
let accs = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).accounts;
assert.ok(accs.some((a) => a.name === 'Wio' && a.color === 'sky' && a.wallet === 'wio'));
await p.click('.tabbar [data-tab="home"]');
await p.click('.key-acc[data-focus="Wio"]');
await p.waitForTimeout(300);
assert.match(await p.textContent('.lens-label'), /Wio/);
await p.click('.tabbar [data-tab="settings"]');
await p.click('[data-acct-edit="Wio"]');
await p.fill('#af-name', 'Wio Savings');
await p.click('.sheet [data-act="save"]');
await p.waitForTimeout(900);
accs = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).accounts;
assert.ok(accs.some((a) => a.name === 'Wio Savings') && !accs.some((a) => a.name === 'Wio'));
await p.click('[data-acct-edit="Wio Savings"]');
await p.click('.sheet [data-act="remove"]');
await p.click('.sheet [data-act="confirm-remove"]');
await p.waitForTimeout(900);
accs = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).accounts;
assert.equal(accs.find((a) => a.name === 'Wio Savings').archived, true);
assert.ok(!(await p.$('[data-acct-edit="Wio Savings"]')));

// undo: the last change (removing Wio Savings) comes back
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.undo-btn');
await p.click('.undo-btn');
await p.waitForTimeout(900);
accs = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).accounts;
assert.equal(accs.find((a) => a.name === 'Wio Savings').archived, false);

// iPhone keyboard mode: type the amount, Return walks to the next fields, Return on note saves
await p.click('.fab');
await p.waitForSelector('.sheet .keypad');
await p.click('.sheet [data-act="keys"]');
await p.fill('.amount-input', '12,5x');
assert.equal(await p.inputValue('.amount-input'), '12.5');
await p.click('.cat[data-cat="Food & Drinks"]');
await p.focus('input[name="merchant"]');
await p.keyboard.type('Bakery');
await p.keyboard.press('Enter');
assert.equal(await p.evaluate(() => document.activeElement.name), 'note');
await p.keyboard.press('Enter');
await p.waitForTimeout(900);
await until(() => serverEntries().some((e) => e.merchant === 'Bakery'));
entries = serverEntries();
assert.ok(entries.some((e) => e.merchant === 'Bakery' && e.amount === 12.5));

// reset: hold to erase
await p.click('.tabbar [data-tab="settings"]');
await p.click('[data-act="reset"]');
await p.waitForSelector('[data-hold]');
const hb = await p.locator('[data-hold]').boundingBox();
await p.mouse.move(hb.x + 20, hb.y + 20); await p.mouse.down(); await p.waitForTimeout(1900); await p.mouse.up();
await p.waitForTimeout(1500);
entries = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
assert.equal(entries.length, 0);

assert.deepEqual(errors, []);
await b.close();
console.log('e2e: all checks passed');
