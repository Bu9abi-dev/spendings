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
await p.waitForTimeout(150);
await p.keyboard.press('Enter');
await p.waitForTimeout(150);
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
// dismiss payday prompts (demo data: Nafis is due, the allowance has moved)
{
  const dc = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const d = await dc.newPage();
  d.on('pageerror', (e) => errors.push(e.message));
  await d.goto('http://localhost:8765/?demo=1#home');
  await d.waitForSelector('.payday');
  const metaText = () => d.textContent('.lens-meta');
  assert.match(await metaText(), /Nafis \+4,500 due/);
  await d.click('.lens-meta [data-plan-dismiss="nafis"]');
  await d.waitForTimeout(300);
  assert.doesNotMatch(await metaText(), /Nafis/, 'Nafis prompt is gone from the Home line');
  assert.match(await d.textContent('[data-plan-row="nafis"]'), /done, back on 27 Oct/);
  assert.equal(await d.locator('[data-plan-row="nafis"] .pd-btn').count(), 0, 'no "It landed" button once dismissed');
  assert.match(await d.textContent('.pd-count'), /4\/4/);
  assert.match(await d.textContent('#toast'), /hidden until 27 Oct/);
  await d.click('#toast .toast-action');
  await d.waitForTimeout(300);
  assert.match(await metaText(), /Nafis \+4,500 due/, 'Undo brings the prompt back');
  await d.click('[data-plan-row="nafis"] [data-plan-dismiss]');
  await d.waitForTimeout(700);
  await d.click('[data-plan-row="nafis"] [data-plan-restore]');
  await d.waitForTimeout(300);
  assert.equal(await d.locator('[data-plan-row="nafis"] .pd-btn').count(), 1, '"Bring back" restores the It landed button');
  // a near miss just left of the ✕ still hits the ✕, never "tap when it lands"
  const xb = await d.locator('.lens-meta [data-plan-dismiss="nafis"]').boundingBox();
  const hit = await d.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-plan-dismiss], [data-plan-act]')?.dataset.planDismiss ? 'x' : 'other', [xb.x + xb.width / 2 - 8, xb.y + xb.height / 2]);
  assert.equal(hit, 'x', 'a tap 8px left of the ✕ centre still lands on the ✕');
  // the toast's Undo only brings back its own dismissal, even after Bring back
  await d.click('[data-plan-row="nafis"] [data-plan-dismiss]');
  await d.waitForTimeout(700);
  await d.click('[data-plan-row="nafis"] [data-plan-restore]');
  await d.waitForTimeout(200);
  await d.click('#toast .toast-action').catch(() => {});
  await d.waitForTimeout(300);
  assert.equal(await d.locator('[data-plan-row="nafis"] .pd-btn').count(), 1, 'toast Undo after Bring back does not dismiss again');
  // a quick double tap on ✕ leaves it dismissed
  await d.dblclick('[data-plan-row="nafis"] [data-plan-dismiss]');
  await d.waitForTimeout(300);
  assert.equal(await d.locator('[data-plan-row="nafis"] [data-plan-restore]').count(), 1, 'double tap on ✕ stays dismissed');
  await d.click('[data-plan-row="nafis"] [data-plan-restore]');
  await d.waitForTimeout(300);
  // a responsibility on the ADIB view
  await d.click('.seg[data-seg="ADIB"]');
  await d.waitForSelector('.resp-line');
  const respBefore = await d.locator('.resp-x').count();
  assert.ok(respBefore > 0, 'responsibilities still to pay have a dismiss button');
  await d.click('.resp-line .resp-x >> nth=0');
  await d.waitForTimeout(300);
  assert.match(await d.textContent('.resp'), /Done · back 27 Oct/);
  assert.equal(await d.locator('.resp-x').count(), respBefore - 1);
  await d.screenshot({ path: '/tmp/e2e-dismiss-adib.png', fullPage: true });
  await dc.close();
}
assert.deepEqual(errors, []);

await b.close();
console.log('e2e: all checks passed');
