// Smarter auto-categories (docs/js/categorize.js) and the Needs review sheet that uses them.
// Part 1 is pure (no browser). Part 2 runs the real app against Code.gs on the fake sheet:
// bank-style Apple Pay names get a suggestion, "File all N" files them together, one Undo puts them back.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-categorize.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanMerchant, learn, suggestFor, sameMerchant } from '../docs/js/categorize.js';
import { makeEnv } from './fake-sheet.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const E = (merchant, category, date = '2026-10-01T10:00:00Z', extra = {}) => ({ type: 'Spend', merchant, category, date, status: 'OK', ...extra });

console.log('── 1. Cleaning and matching (pure)');
ok(cleanMerchant('CARREFOUR MCC 5411 ABU DHABI AE') === 'carrefour', 'bank noise is stripped: "CARREFOUR MCC 5411 ABU DHABI AE" → carrefour');
ok(cleanMerchant('SQ *SALT CAFE 0423') === 'salt cafe', 'processor prefix and store number are stripped');
ok(cleanMerchant('Amazon.ae') === 'amazon', 'domain endings are stripped');
ok(cleanMerchant('LULU HYPERMARKET LLC KHALIFA CITY') === 'lulu hypermarket', 'legal suffix and area are stripped');
ok(cleanMerchant('') === '' && cleanMerchant('1234 5678') === '', 'empty or numbers-only names give nothing');
ok(sameMerchant('Carrefour', 'CARREFOUR 0021 DUBAI') && !sameMerchant('Carrefour', 'Careem'), 'same shop is found; different shops are not');
ok(sameMerchant('Carefour', 'Carrefour') && !sameMerchant('Car', 'Cat'), 'a one-letter typo on a 5+ letter name is the same shop; short names need to match exactly');
ok(!sameMerchant('Noon', 'Noon Food') && !sameMerchant('Careem', 'Careem Food') && !sameMerchant('Uber', 'Uber Eats') && !sameMerchant('Amazon', 'Amazon Prime Video'), 'Noon/Noon Food, Careem/Careem Food, Uber/Uber Eats, Amazon/Amazon Prime Video are different shops');
ok(cleanMerchant('7 Eleven') === '7 eleven' && cleanMerchant('800 Pizza') === '800 pizza' && cleanMerchant('7-ELEVEN 0423 DUBAI') === '7 eleven', 'leading shop numbers survive ("7 Eleven"); store ids do not');
ok(cleanMerchant('Yas Mall') === 'yas' && cleanMerchant('CARREFOUR YAS MALL') === 'carrefour', 'a location-only name is not emptied; trailing location words go');
ok(suggestFor('Uber Eats', learn([E('Uber', 'Transport & Fuel'), E('Uber', 'Transport & Fuel'), E('Uber', 'Transport & Fuel')])).confidence !== 'high', 'Uber history never gives a high guess for Uber Eats');
ok(suggestFor('Noon Food', learn([E('Noon', 'Shopping'), E('Noon', 'Shopping'), E('Noon', 'Shopping')])).confidence === 'medium', 'Noon Food from Noon history is only medium (never auto-filed)');

const history = [
  E('Carrefour', 'Groceries', '2026-09-01T10:00:00Z'), E('Carrefour', 'Groceries', '2026-09-08T10:00:00Z'),
  E('Carrefour', 'Groceries', '2026-09-15T10:00:00Z'), E('Carrefour', 'Shopping', '2026-09-20T10:00:00Z'),
  E('Noon', 'Shopping', '2026-09-02T10:00:00Z'), E('Noon', 'Family & Gifts', '2026-09-30T10:00:00Z'),
  E('Lulu', 'Food & Drinks', '2026-09-03T10:00:00Z', { status: 'Review' }),   // still waiting: not learned from
  { type: 'Income', merchant: 'Carrefour', category: 'Refund', date: '2026-09-21T10:00:00Z', status: 'OK' }, // refunds don't teach spend categories
];
const idx = learn(history, { 'my gym': 'Health', carrefour: 'Travel' });
let s = suggestFor('CARREFOUR MCC 5411 ABU DHABI AE', idx);
ok(s.category === 'Groceries' && s.confidence === 'high' && s.like === 'Carrefour' && s.times === 4, 'bank-style name → Groceries, high, "like Carrefour · 4 times" (most-used category wins)');
s = suggestFor('Carefour', idx);
ok(s.category === 'Groceries' && s.confidence === 'medium', 'one-letter typo still matches, at medium confidence');
s = suggestFor('NOON.COM DUBAI', idx);
ok(s.category === 'Family & Gifts', 'a tie goes to the category used most recently');
ok(suggestFor('MY GYM 0042', idx).category === 'Health', "the sheet's remembered merchants are used when the ledger has none");
ok(idx.get('carrefour').counts.get('Travel') === undefined, 'the ledger beats the remembered list for the same shop');
s = suggestFor('LULU HYPERMARKET', idx);
ok(s.confidence === 'low' && s.category === 'Groceries', 'entries still in Needs review are not learned from; a built-in hint gives a low guess');
ok(suggestFor('ADNOC 512 AUH', new Map()).category === 'Transport & Fuel', 'built-in hint: ADNOC → Transport & Fuel');
ok(suggestFor('ZZQX TRADING', idx) === null, 'an unknown shop gets no suggestion');

console.log('── 2. Needs review in the app');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { ctx } = makeEnv();
ctx.setup();
const token = ctx.getToken_();
const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).text);
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await c.route('https://script.google.com/**', async (route) => {
  const out = ctx.doPost({ postData: { contents: route.request().postData() } });
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text });
});
const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto((process.env.BASE || 'http://localhost:8765/') + '#settings');
await p.fill('input[name="url"]', 'https://script.google.com/macros/s/TEST/exec');
await p.fill('input[name="token"]', token);
await p.click('[data-act="connect"]');
await p.waitForSelector('.status-row .row-title:text("Connected")');
const app = (fn, arg) => p.evaluate(async ([src, a]) => { const st = await import('/js/store.js'); return new Function('st', 'a', `return (${src})(st, a)`)(st, a); }, [fn.toString(), arg]);
const settle = () => p.waitForFunction(async () => { const st = await import('/js/store.js'); return st.state.outbox.length === 0; }, null, { timeout: 8000 });

// past entries typed in the app, then three bank-style Apple Pay payments
await app((st) => { st.addEntry({ type: 'Spend', amount: 120, account: 'ADCB', category: 'Groceries', merchant: 'Carrefour' }); st.addEntry({ type: 'Spend', amount: 90, account: 'ADCB', category: 'Groceries', merchant: 'Carrefour' }); });
await settle();
for (const amount of ['AED 55.00', 'AED 61.20']) post({ source: 'applepay', amount, merchant: 'CARREFOUR MCC 5411 ABU DHABI AE', card: 'ADCB', category: 'Decide later' });
post({ source: 'applepay', amount: 'AED 33.00', merchant: 'CARREFOUR MARKET 0021', card: 'ADCB', category: 'Decide later' });
post({ source: 'applepay', amount: 'AED 12.00', merchant: 'ADNOC 512 AUH', card: 'ADCB', category: 'Decide later' });
await p.click('.tabbar [data-tab="home"]');
await p.click('[data-act="sync"]');
await p.waitForSelector('.review-row');
await p.click('.review-row');
await p.waitForSelector('.review-card');
ok(await p.locator('.review-card').count() === 4, 'four payments wait in Needs review');
const sugTexts = await p.locator('.rc-suggest').allTextContents();
ok(sugTexts.filter((t) => /File all 2 as Groceries/.test(t) && /Like Carrefour · 2 times/.test(t)).length === 2, 'each Carrefour card offers "File all 2 as Groceries · Like Carrefour · 2 times"');
ok(sugTexts.some((t) => /File as Transport & Fuel/.test(t) && /Guess from the shop name/.test(t)), 'ADNOC gets a low "guess from the shop name" suggestion');
ok(sugTexts.some((t) => /File as Groceries/.test(t) && /Maybe like Carrefour/.test(t)) && sugTexts.filter((t) => /File all/.test(t)).length === 2, 'a medium guess (Carrefour Market) is a plain "File as", never "File all"');
ok(/File 2 with their suggestions/.test(await p.textContent('.rc-accept-all')), 'the top button files only the confident guesses (2), not the ADNOC guess');
await p.screenshot({ path: '/tmp/categorize-review.png' });

await p.click('.review-card .rc-suggest[data-all] >> nth=0');
await settle();
let srv = post({ action: 'list' }).entries.filter((e) => /CARREFOUR MCC/.test(e.merchant));
ok(srv.length === 2 && srv.every((e) => e.category === 'Groceries' && e.status === 'OK'), '"File all 2" files both in the sheet');
ok(await p.locator('.review-card').count() === 2, 'the medium and low cards are left');
ok(await app((st) => st.lastAction()) === 'Filed 2 from CARREFOUR MCC 5411 ABU DHABI AE as Groceries', 'the two filings are one undo step');
await p.click('.toast-action');
await settle();
srv = post({ action: 'list' }).entries.filter((e) => /CARREFOUR MCC/.test(e.merchant));
ok(srv.every((e) => !e.category && e.status === 'Review'), 'one Undo puts both back in Needs review, in the sheet too');
ok(await p.locator('.review-card').count() === 4, 'the sheet redraws with all four cards after Undo');
ok(await app((st) => st.canUndo() && st.lastAction().startsWith('Added')), 'undo history is otherwise untouched');
// accept-all files only the high-confidence ones
await p.click('.rc-accept-all');
await settle();
srv = post({ action: 'list' }).entries;
ok(srv.filter((e) => /CARREFOUR MCC/.test(e.merchant)).every((e) => e.category === 'Groceries'), 'accept-all filed the two high-confidence Carrefour payments');
ok(srv.filter((e) => /CARREFOUR MARKET|ADNOC/.test(e.merchant)).every((e) => !e.category && e.status === 'Review'), 'accept-all left the medium (Carrefour Market) and low (ADNOC) payments alone');
ok(/Undo puts these 2 back/.test(await p.textContent('#toast')), 'the toast says what Undo will undo');
await p.click('[data-act="done"]');

// the add sheet uses the same matching
await p.waitForTimeout(400);
await p.click('.fab');
await p.waitForSelector('.sheet .keypad');
await p.fill('input[name="merchant"]', 'carrefour market');
await p.locator('input[name="merchant"]').blur();
ok(await p.locator('.cat.on').count() === 0 && await p.locator('.cat.sug[data-cat="Groceries"]').count() === 1, 'add sheet: "carrefour market" is only medium, so Groceries is ringed, not picked');
await p.fill('input[name="merchant"]', 'carrefour');
await p.locator('input[name="merchant"]').blur();
ok(await p.locator('.cat.on[data-cat="Groceries"]').count() === 1, 'add sheet: "carrefour" (high) picks Groceries by itself');
ok(/remembered for carrefour|like Carrefour/.test(await p.textContent('.suggest')), 'add sheet: says where the pick came from');
await p.fill('input[name="merchant"]', 'Lulu');
await p.locator('input[name="merchant"]').blur();
ok(await p.locator('.cat.on').count() === 0 && await p.locator('.cat.sug[data-cat="Groceries"]').count() === 1, 'add sheet: a weak guess is ringed, not chosen, and replaces the earlier auto-pick');
ok(/maybe Groceries/.test(await p.textContent('.suggest')), 'add sheet: says "maybe Groceries?"');
await p.click('.cat[data-cat="Food & Drinks"]');
await p.fill('input[name="merchant"]', 'Carrefour');
await p.locator('input[name="merchant"]').blur();
ok(await p.locator('.cat.on[data-cat="Food & Drinks"]').count() === 1, 'add sheet: a category you picked yourself is never replaced');

assert.deepEqual(errors, []);
await b.close();
console.log(`verify-categorize: all ${n} checks passed`);
