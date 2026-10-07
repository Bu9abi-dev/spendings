// Runs apps-script/Code.gs against an in-memory fake of SpreadsheetApp.
// Usage: node tests/apps-script.test.mjs
import assert from 'node:assert/strict';
import { makeEnv } from './fake-sheet.mjs';

const { ctx, ss } = makeEnv();
ctx.setup();
const token = ctx.getToken_();
const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).text);

// tabs
for (const tab of ['Overview', 'Ledger', 'Accounts', 'Settings', 'Merchants', 'Plan']) assert.ok(ss.getSheetByName(tab), tab);
assert.equal(ss.getSheets()[0].name, 'Overview');

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

// accounts: defaults, add one, rename everywhere, archive
let accs = post({ action: 'list' }).accounts;
assert.deepEqual(accs.map((a) => a.name), ['ADIB', 'ADCB', 'BOTIM', 'Cash']);
r = post({ action: 'accounts', accounts: [...accs, { name: 'Wio', note: 'Savings', color: 'sky', wallet: 'wio' }] });
assert.equal(r.accounts.length, 5);
r = post({ source: 'applepay', amount: 'AED 30', merchant: 'Lulu', card: 'Wio Personal', category: 'Groceries' });
assert.equal(r.entry.account, 'Wio');
r = post({ action: 'add', entry: { id: 'tw', type: 'Transfer', amount: 100, account: 'ADIB', toAccount: 'Wio' } });
assert.equal(r.entries[0].toAccount, 'Wio');
r = post({ action: 'renameAccount', from: 'Wio', to: 'Wio Savings' });
assert.ok(r.ok);
assert.ok(r.accounts.some((a) => a.name === 'Wio Savings'));
list = post({ action: 'list' });
assert.ok(list.entries.some((e) => e.account === 'Wio Savings'));
assert.ok(list.entries.some((e) => e.toAccount === 'Wio Savings'));
assert.ok(!list.entries.some((e) => e.account === 'Wio' || e.toAccount === 'Wio'));
r = post({ action: 'renameAccount', from: 'ADCB', to: 'adib' });
assert.equal(r.ok, false); // name clash, case-insensitive
r = post({ action: 'renameAccount', from: 'ADCB', to: 'ADCB Allowance' });
assert.equal(post({ action: 'list' }).settings.allowanceAccount, 'ADCB Allowance');
r = post({ action: 'accounts', accounts: post({ action: 'list' }).accounts.map((a) => (a.name === 'Cash' ? { ...a, archived: true } : a)) });
assert.equal(r.accounts.find((a) => a.name === 'Cash').archived, true);

// reset: entries and merchants cleared, a hidden backup keeps the old ledger, accounts survive
const before = post({ action: 'list' }).entries.length;
assert.ok(before > 0);
r = post({ action: 'reset' });
assert.ok(r.ok && r.backup.startsWith('Backup '));
const backupTab = ss.getSheetByName(r.backup);
assert.equal(backupTab.getLastRow() - 1, before);
list = post({ action: 'list' });
assert.equal(list.entries.length, 0);
assert.deepEqual(list.merchants, {});
assert.ok(list.accounts.length >= 4);
assert.equal(ss.getSheets().filter((t) => /^[A-Z][a-z]{2} \d{4}$/.test(t.name)).length, 1);

// Allowance rules, editing a USD entry, and changing the cycle start day (fresh sheet)
{
  const env = makeEnv();
  env.ctx.setup();
  const tk = env.ctx.getToken_();
  const p2 = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ token: tk, ...body }) } }).text);
  const cyc = env.ctx.cycleOf_(new Date(), 27);
  const add = (id, e) => p2({ action: 'add', entry: { id, date: new Date().toISOString(), ...e } });
  add('a1', { type: 'Transfer', amount: 3000, account: 'ADIB', toAccount: 'ADCB', source: 'Plan:allowance' });
  add('a2', { type: 'Spend', amount: 500, account: 'ADCB', category: 'Shopping' });
  assert.equal(env.ctx.cycleSummary_(cyc).allowanceLeft, 2500);
  add('a3', { type: 'Income', amount: 89, account: 'ADCB', category: 'Refund' });
  assert.equal(env.ctx.cycleSummary_(cyc).allowanceLeft, 2589, 'a refund gives the allowance back');
  add('a4', { type: 'Transfer', amount: 1000, account: 'ADCB', toAccount: 'BOTIM' });
  assert.equal(env.ctx.cycleSummary_(cyc).allowanceLeft, 2589, 'moving money on is not spending');
  add('a5', { type: 'Transfer', amount: 200, account: 'ADIB', toAccount: 'ADCB', note: 'top-up' });
  assert.equal(env.ctx.cycleSummary_(cyc).allowanceLeft, 2789, 'a top-up adds to the allowance');
  // USD: changing only the note keeps the price; an undo can send the old price back
  add('u1', { type: 'Spend', amount: 20, currency: 'USD', account: 'BOTIM', category: 'Shopping' });
  const priced = p2({ action: 'list' }).entries.find((e) => e.id === 'u1').amountAED;
  p2({ action: 'settings', settings: { usdRate: 3.7 } });
  p2({ action: 'update', id: 'u1', fields: { note: 'gift' } });
  assert.equal(p2({ action: 'list' }).entries.find((e) => e.id === 'u1').amountAED, priced, 'note edit keeps the USD price');
  p2({ action: 'update', id: 'u1', fields: { amount: 30 } });
  assert.equal(p2({ action: 'list' }).entries.find((e) => e.id === 'u1').amountAED, 111);
  p2({ action: 'update', id: 'u1', fields: { amount: 20, amountAED: priced, status: 'OK' } });
  assert.equal(p2({ action: 'list' }).entries.find((e) => e.id === 'u1').amountAED, priced, 'undo restores the old price');
  // a new cycle start day re-tags the ledger
  p2({ action: 'add', entry: { id: 'c1', type: 'Spend', amount: 5, account: 'Cash', category: 'Other', date: '2026-10-26T10:00:00+04:00' } });
  p2({ action: 'settings', settings: { cycleStart: 25 } });
  assert.equal(p2({ action: 'list' }).entries.find((e) => e.id === 'c1').cycle, '2026-11');
}

// Bank-app notifications (real ADCB wording)
{
  const env = makeEnv();
  env.ctx.setup();
  const tk = env.ctx.getToken_();
  const p2 = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ token: tk, ...body }) } }).text);
  const ledger = () => p2({ action: 'list' }).entries;
  const adcb = (amt, at) => `Debit Card XX5247 linked to account XX810001 was used for AED${amt} on Oct  7 2026  3:06PM at ${at}, AE. Available Balance AED 2335.14`;
  const cyc = env.ctx.cycleOf_(new Date(), 27);

  let a = env.ctx.parseBankAlert_(adcb('1.00', 'BOTIM MONEY'));
  assert.deepEqual({ ...a.money }, { amount: 1, currency: 'AED' });
  assert.equal(a.merchant, 'BOTIM MONEY');
  assert.equal(env.ctx.parseBankAlert_('AED 6,000.00 has been credited to your account XX810001. Salary'), null);
  assert.equal(env.ctx.parseBankAlert_('You have transferred AED 500.00 to account XX1234 on 07/10/2026'), null);
  assert.equal(env.ctx.parseBankAlert_('Cash withdrawal of AED 200.00 at ATM DUBAI MALL with card XX5247'), null);
  assert.equal(env.ctx.parseBankAlert_('Your OTP for purchase of AED 99.00 at AMAZON is 123456'), null);

  // a top-up of your own BOTIM with the ADCB card is a move, not spending
  const before = env.ctx.cycleSummary_(cyc).allowanceLeft;
  let r = p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: adcb('1.00', 'BOTIM MONEY') });
  assert.equal(r.entry.type, 'Transfer');
  assert.equal(r.entry.account, 'ADCB');
  assert.equal(r.entry.toAccount, 'BOTIM');
  assert.equal(r.entry.status, 'OK');
  assert.match(r.message, /Moved AED 1 from ADCB to BOTIM/);
  assert.equal(env.ctx.cycleSummary_(cyc).allowanceLeft, before, 'a BOTIM top-up does not use the allowance');

  // non-payments log nothing
  const n0 = ledger().length;
  r = p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: 'AED 6,000.00 has been credited to your account XX810001.' });
  assert.equal(r.ignored, true);
  assert.equal(ledger().length, n0);

  // a purchase: remembered merchant fills the category
  p2({ action: 'add', entry: { id: 'm1', type: 'Spend', amount: 10, account: 'ADCB', category: 'Groceries', merchant: 'CARREFOUR', date: '2026-01-01T10:00:00+04:00' } });
  r = p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: adcb('42.50', 'CARREFOUR') });
  assert.equal(r.entry.type, 'Spend');
  assert.equal(r.entry.amount, 42.5);
  assert.equal(r.entry.merchant, 'CARREFOUR');
  assert.equal(r.entry.category, 'Groceries');
  assert.equal(r.entry.source, 'Bank alert');
  assert.match(r.message, /left of your allowance/);

  // a tap fires both automations: the second one is recognised as the same payment
  r = p2({ source: 'applepay', amount: 'AED 42.50', merchant: 'Carrefour Mall', card: 'ADCB Debit', category: 'Decide later' });
  assert.equal(r.duplicate, true);
  assert.match(r.message, /^Already logged/);
  const spends = () => ledger().filter((e) => e.type === 'Spend' && e.amount === 42.5).length;
  assert.equal(spends(), 1, 'counted once');
  // …but a genuine second payment of the same amount is kept
  p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: adcb('42.50', 'CARREFOUR') });
  assert.equal(spends(), 1, 'same alert again in the same minute is the same entry');
  r = p2({ source: 'applepay', amount: 'AED 42.50', merchant: 'Spinneys', card: 'ADCB Debit', category: 'Groceries' });
  assert.equal(r.duplicate, false);
  assert.equal(spends(), 2);

  // Apple Pay first with an unrecognised merchant, then the bank shows it was a BOTIM top-up
  r = p2({ source: 'applepay', amount: 'AED 75.00', merchant: 'Payit', card: 'ADCB Debit', category: 'Decide later' });
  assert.equal(r.entry.type, 'Spend');
  r = p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: adcb('75.00', 'BOTIM MONEY') });
  assert.equal(r.duplicate, true);
  const fixed = ledger().filter((e) => e.amount === 75);
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].type, 'Transfer');
  assert.equal(fixed[0].toAccount, 'BOTIM');
  assert.equal(env.ctx.cycleSummary_(cyc).allowanceLeft, before - 42.5 * 2, 'only the two real purchases use the allowance');
  // a merchant that merely contains an account's letters is still a purchase
  r = p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: adcb('12.00', 'CASHEW HOUSE') });
  assert.equal(r.entry.type, 'Spend');
}

console.log('apps-script: all tests passed');
