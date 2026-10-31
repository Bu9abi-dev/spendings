// Three quick wins: (1) tap a place in Insights → Activity filtered to that shop, (2) "On pace for AED X" line,
// (3) bulk "file all" suggestions are not learned from until you touch them by hand.
// Usage: BASE=http://localhost:8765 NODE_PATH=$(npm root -g) node tests/verify-quick-wins.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { learn, suggestFor, markAutoFiled, isAutoFiled } from '../docs/js/categorize.js';
import { matchEntries, EMPTY_FILTER, isFiltered, activeLabels } from '../docs/js/filters.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const E = (id, merchant, category, extra = {}) => ({ id, type: 'Spend', merchant, category, date: '2026-10-01T10:00:00Z', status: 'OK', ...extra });

console.log('── 1. Self-reinforcing categories (pure)');
const hist = [E('a1', 'Carrefour', 'Groceries'), E('a2', 'Carrefour', 'Groceries'), E('a3', 'CARREFOUR MCC 5411', 'Shopping'), E('a4', 'CARREFOUR MCC 5411', 'Shopping')];
ok(learn(hist).get('carrefour').total === 4, 'baseline: all four entries teach');
markAutoFiled([['a3', 'Shopping'], ['a4', 'Shopping']]);
ok(isAutoFiled(hist[2]) && !isAutoFiled(hist[0]), 'auto-filed entries are recognised');
let idx = learn(hist);
ok(idx.get('carrefour').total === 2 && suggestFor('Carrefour', idx).category === 'Groceries', 'auto-filed entries no longer teach (a wrong bulk guess cannot confirm itself)');
const hand = hist.map((e) => (e.id === 'a3' ? { ...e, category: 'Groceries' } : e)); // changed by hand → new array, new category
idx = learn(hand);
ok(!isAutoFiled(hand[2]) && idx.get('carrefour').total === 3, 'an entry whose category you changed by hand is learnable again');
const pure = [E('b1', 'Lulu', 'Groceries')];
markAutoFiled([['b1', 'Groceries']]);
ok(!learn(pure).has('lulu'), 'a later learn() call sees the new mark (cache is invalidated)');

console.log('── 2. Shop filter (pure)');
const sets = { cycleStart: 27, usdRate: 3.6725 };
const list = [E('c1', 'Carrefour', 'Groceries', { date: '2026-10-29T10:00:00Z' }), E('c2', 'CARREFOUR MCC 5411 ABU DHABI AE', 'Groceries', { date: '2026-10-29T11:00:00Z' }), E('c3', 'Noon', 'Shopping', { date: '2026-10-29T12:00:00Z' })].map((e) => ({ amount: 10, currency: 'AED', account: 'ADCB', ...e }));
const f = { ...EMPTY_FILTER, shop: 'carrefour', shopName: 'Carrefour' };
ok(matchEntries(list, f, sets).map((e) => e.id).join() === 'c1,c2' && isFiltered(f), 'the shop key groups bank-style names with the plain one');
ok(activeLabels(f)[0][0] === 'shop' && activeLabels(f)[0][1] === 'Carrefour', 'the filter shows as a removable chip');

console.log('── 3. In the app (390px)');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.env.BASE || 'http://localhost:8765').replace(/\/?$/, '/');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(BASE + '?notour=1#insights');
await p.evaluate(async () => {
  const st = await import('/js/store.js');
  const m = await import('/js/model.js');
  // the owner's setup (his banks and 27th payday): the projection checks below depend on where in the cycle today is
  st.state.settings = { ...m.SAMPLE_SETTINGS };
  st.state.accounts = m.SAMPLE_ACCOUNTS.map((a) => ({ ...a }));
  m.setAccountList(st.state.accounts);
  st.addEntry({ type: 'Spend', amount: 120, account: 'ADCB', category: 'Groceries', merchant: 'Carrefour' });
  st.addEntry({ type: 'Spend', amount: 55, account: 'ADCB', category: 'Groceries', merchant: 'CARREFOUR MCC 5411 ABU DHABI AE' });
  st.addEntry({ type: 'Spend', amount: 40, account: 'ADCB', category: 'Shopping', merchant: 'Noon' });
});
await p.click('.tabbar [data-tab="home"]'); await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.tm-tap');
ok(await p.locator('.tm-tap').count() === 2, 'Top places: the two Carrefour spellings are one row, plus Noon');
const pace = await p.locator('#on-pace').textContent().catch(() => '');
ok(/On pace for AED [\d,]+ this cycle \(an estimate\)/.test(pace), `Day by day shows the projection: "${pace.trim()}"`);
await p.locator('.tm-tap', { hasText: 'Carrefour' }).click();
await p.waitForSelector('.af-pill');
const pills = await p.locator('.af-pill').allTextContents();
ok(pills.some((x) => /carrefour/i.test(x)) && pills.some((x) => /This cycle/.test(x)), 'Activity opens with a Carrefour chip and This cycle');
ok(await p.locator('.activity-list .entry').count() === 2, 'only the two Carrefour entries are listed');
await p.locator('.af-pill', { hasText: 'Carrefour' }).click();
ok(await p.locator('.activity-list .entry').count() === 3, 'removing the chip brings back every entry in the cycle');
ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');

console.log('── 4. Arabic');
await p.click('.tabbar [data-tab="settings"]');
await p.click('[data-lang="ar"]');
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.tm-tap');
ok(/وتيرة/.test(await p.locator('#on-pace').textContent()), 'the pace line is in Arabic');
ok(/النشاط/.test(await p.locator('.tm-tap').first().getAttribute('aria-label')), 'the place row label is in Arabic');
await p.locator('.tm-tap').first().click();
await p.waitForSelector('.af-pill');
ok(await p.evaluate(() => document.documentElement.dir === 'rtl') && await p.locator('.af-pill').count() >= 2, 'Activity filtered in Arabic, right to left');

assert.deepEqual(errors, []);
await b.close();
console.log(`verify-quick-wins: all ${n} checks passed`);
