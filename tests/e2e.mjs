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

// home reflects allowance: 3000 - 25 - 9.5 - 7
assert.match(await p.textContent('.cap-value'), /2,959|2,958/);
assert.deepEqual(errors, []);
await b.close();
console.log('e2e: all checks passed');
