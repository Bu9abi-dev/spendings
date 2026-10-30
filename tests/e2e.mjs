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
async function until(pred, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await new Promise((r) => setTimeout(r, 100)); } return pred(); }
const serverAccounts = () => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).accounts;
// the page has closed every sheet and switched itself back on
const sheetsClosed = () => p.waitForFunction(() => !document.querySelector('.sheet') && !document.getElementById('app').inert);
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto((process.env.BASE || 'http://localhost:8765') + '/#settings');
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
assert.ok(await until(() => serverEntries().length >= 1, 10000), 'the saved spend reached the sheet');
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
assert.ok(await until(() => serverEntries().find((e) => e.merchant === 'Starbucks')?.status === 'OK', 10000), 'the filing reached the sheet');
entries = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
assert.equal(entries.find((e) => e.merchant === 'Starbucks').category, 'Food & Drinks');
assert.equal(entries.find((e) => e.merchant === 'Starbucks').status, 'OK');
await p.click('[data-act="done"]');
await sheetsClosed();

// offline: entry is queued, then flushed when back online
online = false;
await p.click('.fab');
await p.dispatchEvent('.key[data-key="7"]', 'pointerdown');
await p.click('.cat[data-cat="Transport & Fuel"]');
await p.click('.save-btn');
await sheetsClosed();
await p.evaluate(async () => { const st = await import('/js/store.js'); for (const t0 = Date.now(); st.state.entries.length < 3 && Date.now() - t0 < 10000;) await new Promise((r) => setTimeout(r, 50)); });
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries.length, 2);
online = true;
await p.click('[data-act="sync"]');
assert.ok(await until(() => serverEntries().length === 3, 10000), 'the offline entry was flushed');
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
await p.waitForFunction(() => /1,200\.00/.test(document.querySelector('.lv')?.getAttribute('aria-label') || ''));
assert.ok(await until(() => serverEntries().some((e) => e.type === 'Adjustment' && e.account === 'ADIB'), 10000));
assert.match(await p.getAttribute('.lv', 'aria-label'), /1,200\.00/);
entries = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
assert.ok(entries.some((e) => e.type === 'Adjustment' && e.account === 'ADIB'));

// payday plan: Nafis "It landed" logs income into ADIB and lifts the balance
await p.click('.key-acc[data-focus="all"]');
await p.waitForSelector('.lens[data-focus="all"]');
const landed = await p.$('[data-plan-act="land"]');
if (landed) {
  await landed.click();
  assert.ok(await until(() => serverEntries().some((e) => e.type === 'Income' && e.account === 'ADIB' && /^Plan:/.test(e.source)), 10000), 'It landed reached the sheet');
  entries = serverEntries();
  assert.ok(entries.some((e) => e.type === 'Income' && e.account === 'ADIB' && /^Plan:/.test(e.source)));
}
// accounts: add "Wio", rename it, then remove it moving its money back to ADIB
await p.click('.tabbar [data-tab="settings"]');
await p.click('[data-acct-new]');
await p.fill('#af-name', 'Wio');
await p.fill('#af-wallet', 'wio');
await p.click('.sheet [data-colour="sky"]');
await p.click('.sheet [data-act="save"]');
assert.ok(await until(() => serverAccounts().some((a) => a.name === 'Wio'), 10000), 'the new account reached the sheet');
let accs = serverAccounts();
assert.ok(accs.some((a) => a.name === 'Wio' && a.color === 'sky' && a.wallet === 'wio'));
await p.click('.tabbar [data-tab="home"]');
await p.click('.key-acc[data-focus="Wio"]');
await p.waitForFunction(() => /Wio/.test(document.querySelector('.lens-label')?.textContent || ''));
assert.match(await p.textContent('.lens-label'), /Wio/);
await p.click('.tabbar [data-tab="settings"]');
await p.click('[data-acct-edit="Wio"]');
await p.fill('#af-name', 'Wio Savings');
await p.click('.sheet [data-act="save"]');
assert.ok(await until(() => serverAccounts().some((a) => a.name === 'Wio Savings'), 10000), 'the rename reached the sheet');
accs = serverAccounts();
assert.ok(accs.some((a) => a.name === 'Wio Savings') && !accs.some((a) => a.name === 'Wio'));
await p.click('[data-acct-edit="Wio Savings"]');
await p.click('.sheet [data-act="remove"]');
await p.click('.sheet [data-act="confirm-remove"]');
assert.ok(await until(() => serverAccounts().find((a) => a.name === 'Wio Savings')?.archived === true, 10000), 'the removal reached the sheet');
await sheetsClosed();
accs = serverAccounts();
assert.equal(accs.find((a) => a.name === 'Wio Savings').archived, true);
assert.ok(!(await p.$('[data-acct-edit="Wio Savings"]')));

// undo: the last change (removing Wio Savings) comes back
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.undo-btn');
await p.click('.undo-btn');
assert.ok(await until(() => serverAccounts().find((a) => a.name === 'Wio Savings')?.archived === false, 10000), 'the undo reached the sheet');
accs = serverAccounts();
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
await p.waitForFunction(() => document.querySelector('input[name="merchant"]').value === 'Bakery');
await p.keyboard.press('Enter');
await p.waitForFunction(() => document.activeElement.name === 'note');
assert.equal(await p.evaluate(() => document.activeElement.name), 'note');
await p.keyboard.press('Enter');
await until(() => serverEntries().some((e) => e.merchant === 'Bakery'), 10000);
entries = serverEntries();
assert.ok(entries.some((e) => e.merchant === 'Bakery' && e.amount === 12.5));

// reset: hold to erase
await p.click('.tabbar [data-tab="settings"]');
await p.click('[data-act="reset"]');
await p.waitForSelector('[data-hold]');
const hb = await p.locator('[data-hold]').boundingBox();
await p.mouse.move(hb.x + 20, hb.y + 20); await p.mouse.down();
await p.waitForSelector('.sheet', { state: 'detached', timeout: 20000 }); // the hold finishes (1.6s of animation) and the sheet closes
await p.mouse.up();
await until(() => serverEntries().length === 0, 15000);
entries = serverEntries();
assert.equal(entries.length, 0);

assert.deepEqual(errors, []);
// dismiss payday prompts (demo data: Nafis is due, the allowance has moved)
{
  const dc = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const d = await dc.newPage();
  // pin the clock to 5 Oct 2026 (Dubai), so Nafis (day 1) is due and the cycle ends on 26 Oct whatever today is
  await d.clock.install({ time: new Date('2026-10-05T10:00:00+04:00') });
  d.on('pageerror', (e) => errors.push(e.message));
  await d.goto((process.env.BASE || 'http://localhost:8765') + '/?demo=1#home');
  await d.waitForSelector('.payday');
  // no animation running and the layout unchanged for 4 frames (a click on an element that is about to be redrawn is lost)
  const calm = (pg) => pg.evaluate(async () => {
    let last = '', same = 0;
    for (const t0 = Date.now(); same < 4 && Date.now() - t0 < 5000;) {
      await new Promise((r) => requestAnimationFrame(r));
      const k = `${document.getAnimations().length}|${document.body.scrollHeight}|${document.querySelector('[data-plan-row="nafis"]')?.outerHTML.length}`;
      same = k === last && !document.getAnimations().length ? same + 1 : 0; last = k;
    }
  });
  const metaText = () => d.textContent('.lens-meta');
  assert.match(await metaText(), /Nafis \+4,500 due/);
  await d.click('.lens-meta [data-plan-dismiss="nafis"]');
  await d.waitForFunction(() => !/Nafis/.test(document.querySelector('.lens-meta')?.textContent || ''));
  assert.doesNotMatch(await metaText(), /Nafis/, 'Nafis prompt is gone from the Home line');
  assert.match(await d.textContent('[data-plan-row="nafis"]'), /done, back on 27 Oct/);
  assert.equal(await d.locator('[data-plan-row="nafis"] .pd-btn').count(), 0, 'no "It landed" button once dismissed');
  assert.match(await d.textContent('.pd-count'), /4\/4/);
  assert.match(await d.textContent('#toast'), /hidden until 27 Oct/);
  await d.click('#toast .toast-action');
  await d.waitForFunction(() => /Nafis \+4,500 due/.test(document.querySelector('.lens-meta')?.textContent || ''));
  assert.match(await metaText(), /Nafis \+4,500 due/, 'Undo brings the prompt back');
  await d.click('[data-plan-row="nafis"] [data-plan-dismiss]');
  await d.waitForSelector('[data-plan-row="nafis"] [data-plan-restore]', { state: 'attached' });
  await calm(d);
  await d.click('[data-plan-row="nafis"] [data-plan-restore]');
  await d.waitForSelector('[data-plan-row="nafis"] .pd-btn', { state: 'attached' });
  assert.equal(await d.locator('[data-plan-row="nafis"] .pd-btn').count(), 1, '"Bring back" restores the It landed button');
  // a near miss just left of the ✕ still hits the ✕, never "tap when it lands"
  const xb = await d.locator('.lens-meta [data-plan-dismiss="nafis"]').boundingBox();
  const hit = await d.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-plan-dismiss], [data-plan-act]')?.dataset.planDismiss ? 'x' : 'other', [xb.x + xb.width / 2 - 8, xb.y + xb.height / 2]);
  assert.equal(hit, 'x', 'a tap 8px left of the ✕ centre still lands on the ✕');
  // the toast's Undo only brings back its own dismissal, even after Bring back
  await d.click('[data-plan-row="nafis"] [data-plan-dismiss]');
  await d.waitForSelector('[data-plan-row="nafis"] [data-plan-restore]', { state: 'attached' });
  await calm(d);
  await d.click('[data-plan-row="nafis"] [data-plan-restore]');
  await d.waitForSelector('[data-plan-row="nafis"] .pd-btn', { state: 'attached' });
  await d.click('#toast .toast-action').catch(() => {});
  await d.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await d.locator('[data-plan-row="nafis"] .pd-btn').count(), 1, 'toast Undo after Bring back does not dismiss again');
  // a quick double tap on ✕ leaves it dismissed
  await d.dblclick('[data-plan-row="nafis"] [data-plan-dismiss]');
  await d.waitForSelector('[data-plan-row="nafis"] [data-plan-restore]', { state: 'attached' });
  await d.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await d.locator('[data-plan-row="nafis"] [data-plan-restore]').count(), 1, 'double tap on ✕ stays dismissed');
  await calm(d);
  await d.click('[data-plan-row="nafis"] [data-plan-restore]');
  await d.waitForSelector('[data-plan-row="nafis"] .pd-btn', { state: 'attached' });
  // a responsibility on the ADIB view
  await d.click('.seg[data-seg="ADIB"]');
  await d.waitForSelector('.resp-line');
  const respBefore = await d.locator('.resp-x').count();
  assert.ok(respBefore > 0, 'responsibilities still to pay have a dismiss button');
  await d.click('.resp-line .resp-x >> nth=0');
  await d.waitForFunction((n) => document.querySelectorAll('.resp-x').length === n - 1, respBefore);
  assert.match(await d.textContent('.resp'), /Done · back 27 Oct/);
  assert.equal(await d.locator('.resp-x').count(), respBefore - 1);
  await d.screenshot({ path: '/tmp/e2e-dismiss-adib.png', fullPage: true });
  await dc.close();
}
assert.deepEqual(errors, []);

await b.close();
console.log('e2e: all checks passed');
