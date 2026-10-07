// Runs apps-script/Code.gs against an in-memory fake of SpreadsheetApp.
// Usage: node tests/apps-script.test.mjs
import assert from 'node:assert/strict';
import { makeEnv } from './fake-sheet.mjs';

const { ctx, ss } = makeEnv();
ctx.setup();
const token = ctx.getToken_();
const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).text);

// tabs
assert.deepEqual(ss.getSheets().map((s) => s.name).slice(0, 4), ['Overview', 'Ledger', 'Settings', 'Merchants']);

// auth
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'nope', action: 'ping' }) } }).text).ok, false);
assert.equal(post({ action: 'ping' }).ok, true);

// cycles: start day 27
assert.equal(ctx.cycleOf_(new Date('2026-09-27T08:00:00+04:00'), 27), '2026-10');
assert.equal(ctx.cycleOf_(new Date('2026-10-26T23:00:00+04:00'), 27), '2026-10');
assert.equal(ctx.cycleOf_(new Date('2026-12-28T10:00:00+04:00'), 27), '2027-01');
assert.equal(ctx.cycleOf_(new Date('2026-10-05T10:00:00+04:00'), 1), '2026-10');
assert.equal(ctx.cycleRangeLabel_('2026-10', 27), '27 Sep 2026 – 26 Oct 2026');
assert.equal(ctx.cycleRangeLabel_('2027-01', 27), '27 Dec 2026 – 26 Jan 2027');

// money parsing
assert.deepEqual({ ...ctx.parseMoney_('AED 1,234.50') }, { amount: 1234.5, currency: 'AED' });
assert.deepEqual({ ...ctx.parseMoney_('$12.00') }, { amount: 12, currency: 'USD' });
assert.deepEqual({ ...ctx.parseMoney_('12.00 USD') }, { amount: 12, currency: 'USD' });
assert.deepEqual({ ...ctx.parseMoney_('د.إ.‏ 42') }, { amount: 42, currency: 'AED' });
assert.equal(ctx.parseMoney_('€9.99').currency, 'EUR');

// formula injection
assert.equal(ctx.clean_('=HYPERLINK("x")'), '\'=HYPERLINK("x")');

// manual add (idempotent by id)
let r = post({ action: 'add', entry: { id: 'u1', type: 'Spend', amount: 50, account: 'ADCB', category: 'Groceries', merchant: 'Carrefour', date: '2026-10-03T12:00:00+04:00' } });
assert.equal(r.added, 1);
r = post({ action: 'add', entry: { id: 'u1', type: 'Spend', amount: 50, account: 'ADCB', category: 'Groceries' } });
assert.equal(r.added, 0); assert.equal(r.duplicates, 1);
assert.ok(ss.getSheetByName('Oct 2026'), 'cycle tab created');

// USD conversion
r = post({ action: 'add', entry: { id: 'u2', type: 'Spend', amount: 10, currency: 'USD', account: 'ADIB', category: 'Shopping', date: '2026-10-04T12:00:00+04:00' } });
assert.equal(r.entries[0].amountAED, 36.73);

// Apple Pay: remembered merchant, card mapping, allowance message
r = post({ source: 'applepay', amount: 'AED 42.00', merchant: 'CARREFOUR', card: 'ADCB TouchPoints Platinum', category: 'Decide later' });
assert.equal(r.entry.category, 'Groceries');
assert.equal(r.entry.account, 'ADCB');
assert.equal(r.entry.status, 'OK');
assert.match(r.message, /AED 42 · CARREFOUR · ADCB/);
assert.match(r.message, /left of your allowance/);
// duplicate trigger in the same minute
const again = post({ source: 'applepay', amount: 'AED 42.00', merchant: 'CARREFOUR', card: 'ADCB TouchPoints Platinum' });
assert.equal(again.duplicate, true);

// unknown merchant without category → Review; ADIB warning
r = post({ source: 'applepay', amount: 'AED 15', merchant: 'Noon', card: 'ADIB Cashback Visa', category: 'Decide later' });
assert.equal(r.entry.status, 'Review');
assert.doesNotMatch(r.message, /left in ADIB/); // balance not matched yet, so no balance line
assert.match(r.message, /Needs review/);

// update clears review, remembers merchant
const id = r.entry.id;
r = post({ action: 'update', id, fields: { category: 'Shopping' } });
assert.equal(r.entry.status, 'OK');
assert.equal(ctx.rememberedCategory_('noon'), 'Shopping');

// transfer has no category and is OK
r = post({ action: 'add', entry: { id: 't1', type: 'Transfer', amount: 500, account: 'ADIB', toAccount: 'BOTIM' } });
assert.equal(r.entries[0].status, 'OK');

// list + delete
let list = post({ action: 'list' });
assert.equal(list.entries.length, 5);
assert.equal(list.settings.allowance, 3000);
post({ action: 'delete', id: 't1' });
list = post({ action: 'list' });
assert.equal(list.entries.length, 4);

// settings
r = post({ action: 'settings', settings: { allowance: 3500, cycleStart: 40 } });
assert.equal(r.settings.allowance, 3500);
assert.equal(r.settings.cycleStart, 28);

// plan tab exists with defaults
let plan = post({ action: 'list' }).plan;
assert.deepEqual(plan.map((p) => p.id), ['salary', 'nafis', 'allowance', 'fuel']);
assert.equal(plan.find((p) => p.id === 'nafis').amount, 4500);
r = post({ action: 'plan', plan: [...plan, { name: 'Phone bill', kind: 'Responsibility', amount: 125, from: 'ADIB', category: 'Bills & Subscriptions' }] });
assert.equal(r.plan.length, 5);
assert.equal(r.plan[4].name, 'Phone bill');

// adjustments keep their sign and count toward the balance
r = post({ action: 'add', entry: { id: 'adj1', type: 'Adjustment', amount: 1000, account: 'ADIB', note: 'Match bank' } });
assert.equal(r.entries[0].status, 'OK');
r = post({ action: 'add', entry: { id: 'adj2', type: 'Adjustment', amount: -250.5, account: 'ADIB' } });
assert.equal(r.entries[0].amount, -250.5);
// ADIB so far: -36.73 (USD spend) -15 (Noon) +1000 -250.5
assert.equal(ctx.balanceOf_('ADIB'), Math.round((1000 - 250.5 - 36.73 - 15) * 100) / 100);
r = post({ source: 'applepay', amount: 'AED 20', merchant: 'ADNOC', card: 'ADIB Visa', category: 'Transport & Fuel' });
assert.match(r.message, /left in ADIB/);

console.log('apps-script: all tests passed');
