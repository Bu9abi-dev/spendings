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

// people (money owed): a person is never matched as your card, and lending from the allowance card uses allowance
{
  const allow = post({ action: 'list' }).settings.allowanceAccount;
  post({ action: 'accounts', accounts: [...post({ action: 'list' }).accounts, { name: 'Visa', note: 'Person', color: 'graphite', wallet: '' }] });
  let x = post({ source: 'applepay', amount: 'AED 12', merchant: 'Cafe', card: 'Visa Gold', category: 'Food & Drinks' });
  assert.equal(x.entry.account, 'Visa'); // not flagged yet: the old name match still applies
  assert.equal(post({ action: 'extras', key: 'people', value: { v: 1, names: ['Visa'] } }).ok, true);
  x = post({ source: 'applepay', amount: 'AED 13', merchant: 'Cafe', card: 'Visa Gold', category: 'Food & Drinks' });
  assert.notEqual(x.entry.account, 'Visa');
  assert.equal(x.entry.status, 'Review'); // unknown card, for you to sort
  x = post({ source: 'applepay', amount: 'AED 14', merchant: 'Visa', card: 'ADIB Visa', category: 'Food & Drinks' });
  assert.equal(x.entry.type, 'Spend'); // paying a shop called like a person is still spending
  const cyc = ctx.cycleOf_(new Date(), 27);
  const left0 = ctx.cycleSummary_(cyc).allowanceLeft;
  post({ action: 'add', entry: { id: 'lend1', type: 'Transfer', amount: 50, account: allow, toAccount: 'Visa' } });
  assert.equal(Math.round((left0 - ctx.cycleSummary_(cyc).allowanceLeft) * 100) / 100, 50);
  post({ action: 'add', entry: { id: 'back1', type: 'Transfer', amount: 50, account: 'Visa', toAccount: allow } });
  assert.equal(Math.round(ctx.cycleSummary_(cyc).allowanceLeft * 100) / 100, Math.round(left0 * 100) / 100);
  post({ action: 'extras', key: 'people', value: null });
}

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

  // a payment split in the app (money owed): Apple Pay logs 100, the app cuts it to your 60 plus a
  // `-split` Transfer of 40 to a person; the bank alert for the full 100 is the same payment
  p2({ action: 'accounts', accounts: [...p2({ action: 'list' }).accounts, { name: 'Ahmed', note: 'Person', color: 'graphite', wallet: '' }] });
  p2({ action: 'extras', key: 'people', value: { v: 1, names: ['Ahmed'] } });
  r = p2({ source: 'applepay', amount: 'AED 100.00', merchant: 'Zuma', card: 'ADCB Debit', category: 'Food & Drinks' });
  const sid = r.entry.id;
  assert.equal(p2({ action: 'update', id: sid, fields: { amount: 60 } }).ok, true);
  p2({ action: 'add', entry: { id: `${sid}-split`, type: 'Transfer', amount: 40, account: 'ADCB', toAccount: 'Ahmed', note: 'Split: Zuma', source: 'Split', date: r.entry.date } });
  const n1 = ledger().length;
  r = p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: adcb('100.00', 'ZUMA') });
  assert.equal(r.duplicate, true, 'the alert for the whole bill matches the split payment');
  assert.match(r.message, /^Already logged · AED 100 · Zuma · split with Ahmed/);
  assert.equal(ledger().length, n1, 'nothing logged twice');
  const zuma = ledger().find((e) => e.id === sid);
  assert.equal(zuma.amount, 60, 'your share stays your share');
  assert.equal(zuma.type, 'Spend');
  assert.equal(zuma.source, 'Apple Pay + Bank alert', 'paired once');
  // one-to-one: a second alert for 100 (another real payment) is logged
  r = p2({ source: 'bank', app: 'ADCB', title: 'ADCBAlert', body: adcb('100.00', 'ZUMA') });
  assert.equal(r.duplicate, false);
  assert.equal(ledger().length, n1 + 1);
  // an alert for just your share or just theirs doesn't match the split pair
  r = p2({ source: 'applepay', amount: 'AED 100.00', merchant: 'Zuma', card: 'ADCB Debit', category: 'Food & Drinks' });
  assert.equal(r.duplicate, true, 'the new bank alert pairs with its own Apple Pay');
  r = p2({ source: 'applepay', amount: 'AED 40.00', merchant: 'Zuma', card: 'ADCB Debit', category: 'Food & Drinks' });
  assert.equal(r.duplicate, false);

  // a USD split: each half keeps the price the app gave it, so the halves add up to the whole in AED
  r = p2({ action: 'add', entry: { id: 'usd1', type: 'Spend', amount: 10.01, currency: 'USD', account: 'ADCB', category: 'Shopping', source: 'App', amountAED: 36.77 } });
  assert.equal(r.entries[0].amountAED, 36.77, 'an app-priced USD entry keeps its price');
  p2({ action: 'update', id: 'usd1', fields: { amount: 5.01, amountAED: 18.41 } });
  p2({ action: 'add', entry: { id: 'usd1-split', type: 'Transfer', amount: 5, currency: 'USD', account: 'ADCB', toAccount: 'Ahmed', source: 'Split', amountAED: 18.36 } });
  const usd = ledger().filter((e) => e.id === 'usd1' || e.id === 'usd1-split');
  assert.equal(Math.round(usd.reduce((t, e) => t + e.amountAED, 0) * 100) / 100, 36.77);
  // an add without a price (the Shortcut, older app versions) is still priced by the sheet
  r = p2({ action: 'add', entry: { id: 'usd2', type: 'Spend', amount: 10, currency: 'USD', account: 'ADCB', category: 'Shopping' } });
  assert.equal(r.entries[0].amountAED, 36.73);
}

// Extras: one JSON value per key, updated in place, returned by list, kept through a reset
{
  const env = makeEnv();
  env.ctx.setup();
  const tk = env.ctx.getToken_();
  const p3 = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ token: tk, ...body }) } }).text);
  assert.deepEqual(p3({ action: 'list' }).extras, {});
  assert.ok(p3({ action: 'extras', key: 'budgets', value: { 'Food & Drinks': 800 } }).ok);
  assert.ok(p3({ action: 'extras', key: 'goals', value: [{ id: 'g1', name: 'Car', target: 20000 }] }).ok);
  assert.ok(p3({ action: 'extras', key: 'budgets', value: { 'Food & Drinks': 900 } }).ok);
  const ex = p3({ action: 'list' }).extras;
  assert.deepEqual(ex.budgets, { 'Food & Drinks': 900 });
  assert.equal(ex.goals[0].name, 'Car');
  assert.equal(env.ss.getSheetByName('Extras').getLastRow(), 3, 'an update rewrites its row, never adds a second one');
  assert.equal(p3({ action: 'extras', key: 'bad key!', value: 1 }).ok, false);
  p3({ action: 'add', entry: { id: 'x1', type: 'Spend', amount: 5, account: 'ADCB', category: 'Other' } });
  p3({ action: 'reset' });
  assert.deepEqual(p3({ action: 'list' }).extras.budgets, { 'Food & Drinks': 900 }, 'reset keeps extras');
  assert.deepEqual(p3({ action: 'list' }).features, ['extras', 'install']);
  // a manual ▶ test of the Shortcut: says it's connected and logs nothing
  const before = p3({ action: 'list' }).entries.length;
  r = p3({ source: 'applepay', amount: '', merchant: '', card: '', category: 'Decide later' });
  assert.ok(r.ok && r.test && /Connected/.test(r.message));
  assert.equal(p3({ action: 'list' }).entries.length, before, 'a test run logs nothing');
  // Arabic digits from an iPhone set to Arabic
  r = p3({ source: 'applepay', amount: 'د.إ.‏ ٤٢٫٥٠', merchant: 'Lulu', card: 'ADCB', category: 'Groceries' });
  assert.equal(r.entry.amount, 42.5);
  // an amount that couldn't be read, even with no merchant, is still kept for review
  r = p3({ source: 'applepay', amount: 'AED ?', merchant: '', card: 'ADCB', category: 'Decide later' });
  assert.ok(!r.test && r.entry.status === 'Review');
  // a real payment whose amount couldn't be read is still kept for review
  r = p3({ source: 'applepay', amount: 'AED ?', merchant: 'Lulu', card: 'ADCB', category: 'Decide later' });
  assert.equal(r.entry.status, 'Review');
  // the Apple Pay Shortcut's request is unchanged and still works
  assert.equal(p3({ source: 'applepay', amount: 'AED 12.00', merchant: 'Cafe', card: 'ADCB', category: 'Decide later' }).ok, true);
}

// Setup guide: a sheet made from outside has only a "Setup" tab holding the app's key. The script adopts
// that key the first time it needs one, removes the tab, and `install` builds every tab without popups.
{
  const env = makeEnv();
  const KEY = 'AbCdEfGhIjKlMnOpQrStUvWx';
  const setupTab = env.ss.insertSheet('Setup');
  setupTab.getRange(1, 1).setValue('Spendings app key (the script keeps it safe and removes this tab)');
  setupTab.getRange(2, 1).setValue(KEY);
  env.ss.deleteSheet(env.ss.getSheetByName('Sheet1'));
  const raw = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  assert.equal(raw({ token: 'wrong', action: 'ping' }).ok, false, 'a wrong key is still refused');
  assert.equal(env.props.TOKEN, KEY, 'the installer key is adopted on first use');
  assert.ok(!env.ss.getSheetByName('Setup'), 'the Setup tab no longer shows the key');
  assert.equal(env.ss.getSheets().length, 1, 'the last tab is emptied and renamed, not deleted');
  assert.equal(env.ss.getSheets()[0].getLastRow(), 0);
  const r = raw({ token: KEY, action: 'ping' });
  assert.equal(r.ok, true);
  assert.ok(!env.ss.getSheetByName('Ledger'), 'ping alone builds nothing');
  const inst = raw({ token: KEY, action: 'install' });
  assert.equal(inst.ok, true);
  assert.deepEqual([...inst.features], ['extras', 'install']);
  for (const tab of ['Overview', 'Ledger', 'Accounts', 'Settings', 'Merchants', 'Plan']) assert.ok(env.ss.getSheetByName(tab), `install made ${tab}`);
  assert.ok(!env.ss.getSheetByName('Sheet1'), 'the empty leftover tab is removed');
  assert.equal(raw({ token: KEY, action: 'install' }).ok, true, 'install is safe to run again');
  assert.equal(env.ss.getSheets().filter((t) => t.name === 'Ledger').length, 1);
  // the guide's answers arrive through the usual actions
  assert.equal(raw({ token: KEY, action: 'accounts', accounts: [{ name: 'FAB', color: 'blue', wallet: 'fab' }, { name: 'Cash', color: 'green' }] }).ok, true);
  assert.equal(raw({ token: KEY, action: 'settings', settings: { allowanceAccount: 'FAB', emergencyAccount: 'FAB', cycleStart: 25, allowance: 2000 } }).ok, true);
  const l = raw({ token: KEY, action: 'list' });
  assert.deepEqual(l.accounts.map((a) => a.name), ['FAB', 'Cash']);
  assert.equal(l.settings.cycleStart, 25);
  // the Shortcut payloads work on a sheet made this way
  const ap = raw({ token: KEY, source: 'applepay', amount: 'AED 12.00', merchant: 'Cafe', card: 'FAB Platinum', category: 'Food & Drinks' });
  assert.equal(ap.ok, true); assert.equal(ap.entry.account, 'FAB');
  const bk = raw({ token: KEY, source: 'bank', app: 'FAB', title: 'FAB', body: 'Purchase of AED 30.00 at LULU with card XX1234' });
  assert.equal(bk.ok, true);
  // the browser page the guide opens to ask for permission
  assert.match(env.ctx.doGet({ parameter: { setup: '1' } }).html, /Spendings can use your sheet/);
  assert.equal(JSON.parse(env.ctx.doGet({ parameter: {} }).text).ok, true, 'a plain GET still answers JSON');
}

// A sheet set up by hand never looks at a Setup tab: its key was made by setup() and stays.
{
  const env = makeEnv();
  env.ctx.setup();
  const key = env.ctx.getToken_();
  const t = env.ss.insertSheet('Setup');
  t.getRange(1, 1).setValue('Spendings app key (the script keeps it safe and removes this tab)');
  t.getRange(2, 1).setValue('ZZZZZZZZZZZZZZZZZZZZZZZZ');
  assert.equal(env.ctx.getToken_(), key);
  assert.ok(env.ss.getSheetByName('Setup'), 'left alone');
  // a Setup tab without the marker, or with a bad key, is ignored on a fresh sheet too
  const env2 = makeEnv();
  const t2 = env2.ss.insertSheet('Setup');
  t2.getRange(1, 1).setValue('My notes'); t2.getRange(2, 1).setValue('ZZZZZZZZZZZZZZZZZZZZZZZZ');
  assert.notEqual(env2.ctx.getToken_(), 'ZZZZZZZZZZZZZZZZZZZZZZZZ');
  const env3 = makeEnv();
  const t3 = env3.ss.insertSheet('Setup');
  t3.getRange(1, 1).setValue('Spendings app key'); t3.getRange(2, 1).setValue('short');
  assert.notEqual(env3.ctx.getToken_(), 'short');
  // an old payload on a sheet missing its Ledger builds the tabs first instead of failing
  const env4 = makeEnv();
  const k4 = env4.ctx.getToken_();
  const r4 = JSON.parse(env4.ctx.doPost({ postData: { contents: JSON.stringify({ token: k4, source: 'applepay', amount: 'AED 5', merchant: 'Kiosk', card: 'ADCB', category: 'Other' }) } }).text);
  assert.equal(r4.ok, true);
  assert.ok(env4.ss.getSheetByName('Ledger'));
}

console.log('apps-script: all tests passed');
