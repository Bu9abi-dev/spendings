// What counts as spending: the one shared definition (docs/js/model.js isPersonalSpend / cycleSpend) and every
// number built on it (Spent, categories, daily average, allowance used / left / % spent, pace, run-out date,
// Safe to spend), plus the sheet's mirror (apps-script/Code.gs) and the bills taken off Safe to spend (bills.js).
// Usage: node tests/verify-spending.mjs   (exits 1 on any failure)
import {
  setAccountList, SAMPLE_ACCOUNTS, SAMPLE_PLAN, SAMPLE_SETTINGS, cycleOf, cycleBounds, toAED, balances,
  isPersonalSpend, isExcluded, isRefund, cycleSpend, summarize, homeNumbers, allowancePace,
} from '../docs/js/model.js';
import { cardBills } from '../docs/js/bills.js';
import { dailySpend, categoryTrends } from '../docs/js/trends.js';
import { budgetRows } from '../docs/js/budgets.js';
import { weekTotals } from '../docs/js/weekly.js';
import { totals } from '../docs/js/filters.js';
import { makeEnv } from './fake-sheet.mjs';

let fails = 0, passes = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (cond) passes++; else fails++; };
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

setAccountList(SAMPLE_ACCOUNTS);
const S = { ...SAMPLE_SETTINGS }; // AED 3,000 on ADCB, main ADIB, cycles 27th → 26th
const CYC = '2026-11';            // 27 Oct → 26 Nov (31 days)
const { start } = cycleBounds(CYC, S.cycleStart);
let n = 0;
const E = (type, amount, account, iso, extra = {}) => {
  const e = { id: `s${++n}`, type, amount, currency: 'AED', account, toAccount: '', category: type === 'Spend' ? 'Groceries' : type === 'Income' ? 'Other' : '', merchant: '', note: '', source: 'App', status: 'OK', date: new Date(iso).toISOString(), ...extra };
  e.cycle = extra.cycle || cycleOf(e.date, S.cycleStart);
  e.amountAED = toAED({ ...e, amountAED: null }, S);
  return e;
};
const NOW = new Date('2026-11-12T17:00:00+04:00'); // day 17 of the cycle
const base = [
  E('Adjustment', 9000, 'ADIB', '2026-10-20T10:00:00+04:00'),
  E('Adjustment', 400, 'ADCB', '2026-10-20T10:00:00+04:00'),
  E('Income', 6000, 'ADIB', '2026-10-27T08:00:00+04:00', { category: 'Salary', source: 'Plan:salary' }),
  E('Transfer', 3000, 'ADIB', '2026-10-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
  E('Spend', 300, 'ADCB', '2026-10-28T12:00:00+04:00', { merchant: 'Carrefour' }),
  E('Spend', 200, 'ADCB', '2026-11-02T12:00:00+04:00', { category: 'Food & Drinks', merchant: 'Salt' }),
];
const home = (list, extra) => homeNumbers(list, SAMPLE_PLAN, S, NOW, {}, extra);
const m0 = home(base);
ok(m0.sum.spent === 500 && m0.sum.allowanceUsed === 500 && m0.sum.allowancePot === 3000 && m0.safe === 2500, 'baseline: 500 spent on ADCB, 2,500 left of 3,000');

console.log('\n── own-account transfers are never spending');
{
  const list = [...base,
    E('Transfer', 400, 'ADIB', '2026-11-03T10:00:00+04:00', { toAccount: 'BOTIM' }),
    E('Transfer', 250, 'ADCB', '2026-11-04T10:00:00+04:00', { toAccount: 'Cash' }),
    E('Transfer', 100, 'BOTIM', '2026-11-05T10:00:00+04:00', { toAccount: 'ADIB' })];
  const m = home(list);
  ok(m.sum.spent === 500 && m.sum.allowanceUsed === 500 && m.pace.spent === 500, 'ADIB → BOTIM, ADCB → Cash and BOTIM → ADIB: Spent, allowance used and pace unchanged');
  ok(list.filter((e) => e.type === 'Transfer').every((e) => !isPersonalSpend(e)), 'isPersonalSpend says no to every transfer');
}

console.log('\n── "Checked with bank" only corrects balances');
{
  const list = [...base, E('Adjustment', -180, 'ADCB', '2026-11-06T10:00:00+04:00'), E('Adjustment', 75, 'ADIB', '2026-11-06T10:00:00+04:00')];
  const m = home(list);
  ok(m.sum.spent === 500 && m.sum.allowanceUsed === 500 && m.pace.perDay === m0.pace.perDay, 'a −180 check on ADCB is not spending and doesn\'t change the pace');
  ok(near(m.allowBal, m0.allowBal - 180) && near(m.bals.get('ADIB').balance, m0.bals.get('ADIB').balance + 75), '…but it does correct the balances');
}

console.log('\n── refunds take spending off (they are not income)');
{
  const list = [...base, E('Income', 120, 'ADCB', '2026-11-07T10:00:00+04:00', { category: 'Refund', merchant: 'CARREFOUR' })];
  const m = home(list), sp = cycleSpend(list, CYC, S);
  ok(m.sum.spent === 380 && sp.gross === 500 && sp.refunds === 120, 'Spent = 500 − 120 refund = 380');
  ok(sp.byCategory.get('Groceries') === 180 && sp.byCategory.get('Food & Drinks') === 200, 'the refund comes off the category it was bought in (Groceries 300 → 180)');
  ok(m.sum.allowanceUsed === 380 && m.safe === 2620, 'allowance used 380, Safe to spend 2,620');
  ok(m.sum.income === 6000 && !m.sum.byIncome.has('Refund'), 'money in is the salary only: a refund isn\'t income');
  // sister pays back her Amazon order: the refund can't be matched to a shop, so it comes off every category in proportion
  const sis = [...base, E('Income', 100, 'ADCB', '2026-11-07T10:00:00+04:00', { category: 'Refund', merchant: 'Sara' })];
  const s2 = cycleSpend(sis, CYC, S);
  ok(s2.net === 400 && near([...s2.byCategory.values()].reduce((a, v) => a + v, 0), 400), 'an unmatched refund still comes off Spent, and the categories still add up to it');
  ok(near(dailySpend(sis, CYC, S).reduce((a, v) => a + v, 0), 400), 'the daily bars add up to Spent too');
}

console.log('\n── "Exclude from my spending": pass-through money');
{
  const mom = [
    E('Spend', 1800, 'ADCB', '2026-11-03T10:00:00+04:00', { category: 'Travel', merchant: 'Tamara · Emirates', exclude: true, note: "mom's flight" }),
    E('Income', 950, 'ADIB', '2026-11-04T10:00:00+04:00', { category: 'Other', merchant: 'eToro', exclude: true }),
    E('Transfer', 950, 'ADIB', '2026-11-04T11:00:00+04:00', { toAccount: 'Cash', exclude: true }),
    E('Spend', 400, 'Cash', '2026-11-05T10:00:00+04:00', { category: 'Groceries', merchant: 'Lulu', exclude: true }),
  ];
  const list = [...base, ...mom];
  const m = home(list), sp = cycleSpend(list, CYC, S);
  ok(m.sum.spent === 500 && sp.excluded === 2200 && m.sum.allowanceUsed === 500 && m.safe === 2500, 'mom\'s flight and the groceries mom paid back: not spent, not allowance used, Safe stays 2,500');
  ok(m.sum.income === 6000, 'the eToro money passed on to mom isn\'t income either');
  ok(near(m.allowBal, m0.allowBal - 1800) && near(m.bals.get('Cash').balance, m0.bals.get('Cash').balance + 950 - 400), 'excluded entries still move the balances exactly as before');
  ok(!budgetRows(sp.byCategory, { Travel: 500 })[0].spent, 'category limits ignore them');
  ok(totals(list.filter((e) => e.cycle === CYC), S).spent === 500, 'the Activity totals ignore them');
  ok(categoryTrends(list, CYC, S, 6).every((r) => r.id !== 'Travel'), 'and so do the Insights trends');
  const pE = allowancePace(m.sum, CYC, S, NOW);
  ok(pE.perDay === m0.pace.perDay && pE.state === 'on', 'and the pace');
}

console.log('\n── Investing is never spending');
{
  const list = [...base, E('Spend', 2500, 'ADIB', '2026-11-08T10:00:00+04:00', { category: 'Investing', merchant: 'IBKR' })];
  const m = home(list);
  ok(isExcluded(list.at(-1)) && !isPersonalSpend(list.at(-1)), 'an IBKR deposit filed under Investing is excluded by default');
  ok(m.sum.spent === 500 && !m.sum.byCategory.has('Investing'), 'Spent stays 500; Investing has no slice in the donut');
  ok(near(m.bals.get('ADIB').balance, m0.bals.get('ADIB').balance - 2500), 'the money still leaves ADIB');
}

console.log('\n── entries dated before the cycle start never leak in');
{
  const list = [...base,
    E('Spend', 700, 'ADCB', '2026-10-25T20:00:00+04:00', { cycle: CYC }), // 25 Oct, with a stale Cycle column saying this cycle
    E('Spend', 90, 'ADCB', '2026-10-26T23:59:00+04:00')];                // the last minute of the last cycle
  const m = home(list);
  ok(m.sum.spent === 500 && m.sum.allowanceUsed === 500, 'spending on 25 and 26 Oct counts in the cycle before, whatever the Cycle column says');
  ok(summarize(list, '2026-10', S, SAMPLE_PLAN).spent === 790, '…and shows there');
}

console.log('\n── top-ups: refill the card unless marked "Add to my allowance"');
{
  const tu = E('Transfer', 771, 'ADIB', '2026-11-05T10:00:00+04:00', { toAccount: 'ADCB' });
  const m = home([...base, tu]);
  ok(m.sum.allowancePot === 3000 && m.sum.allowanceUsed === 500 && m.safe === 2500 && near(m.allowBal, m0.allowBal + 771), 'an unmarked 771 top-up refills ADCB, but the budget stays 3,000 and nothing is counted as spent');
  const marked = home([...base, { ...tu, addToAllowance: true }]);
  ok(marked.sum.allowancePot === 3771 && marked.sum.topUps === 771 && marked.safe === 3271, 'marked "Add to my allowance": the budget is 3,000 + 771');
  // the screenshot case: 2,737 of real spending on a 3,000 allowance, 17 days in
  const real = [...base.slice(0, 4), E('Spend', 2737, 'ADCB', '2026-11-01T10:00:00+04:00'), tu];
  const r = home(real);
  ok(r.sum.allowancePot === 3000 && Math.round((r.sum.allowanceUsed / r.sum.allowancePot) * 100) === 91, '"91% spent · 2,737 of 3,000" (not 73% of 3,771)');
  ok(r.pace.days === 17 && near(r.pace.perDay, 2737 / 17) && r.pace.state === 'over' && r.pace.runsOut.outDay === '2026-11-14', 'pace 2,737 ÷ 17 days = 161 a day: the 263 left runs out on 14 Nov');
  // a marked pre-payday top-up carries into the new cycle (the project rule); an unmarked one stays as buffer
  const eve = [E('Transfer', 3000, 'ADIB', '2026-09-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }), E('Spend', 3000, 'ADCB', '2026-10-10T12:00:00+04:00'),
    E('Transfer', 500, 'ADIB', '2026-10-25T12:00:00+04:00', { toAccount: 'ADCB', addToAllowance: true }), base[3]];
  ok(home(eve).sum.carryIn === 500 && home(eve).sum.allowancePot === 3500, 'a marked top-up on 25 Oct carries in: payday shows 3,000 + 500');
  ok(home(eve.map((e) => ({ ...e, addToAllowance: false }))).sum.allowancePot === 3000, 'unmarked, payday shows the plain 3,000');
}

console.log('\n── pace: allowance used ÷ days so far; on track when the run-out is after the cycle');
{
  const slow = home([...base.slice(0, 4), E('Spend', 900, 'ADCB', '2026-11-01T10:00:00+04:00')]);
  ok(slow.pace.state === 'on' && !slow.pace.runsOut && near(slow.pace.perDay, 900 / 17), '900 in 17 days (53 a day): 2,100 left lasts past 26 Nov, on track');
  const first = homeNumbers([...base.slice(0, 4), E('Spend', 40, 'ADCB', '2026-10-27T09:00:00+04:00')], SAMPLE_PLAN, S, new Date('2026-10-27T10:00:00+04:00'));
  ok(first.pace.days === 1 && first.pace.perDay === 40, 'on the first day the pace divides by 1, never 0');
}

console.log('\n── Safe to spend = what\'s left − bills still due on the card, never negative');
{
  const subs = [28, 58, 88].map((d, i) => E('Spend', 56, 'ADCB', new Date(NOW.getTime() - d * 864e5).toISOString(), { id: `nf${i}`, category: 'Bills & Subscriptions', merchant: 'Netflix' }));
  const list = [...base, ...subs];
  const bills = cardBills({ entries: list, settings: S, now: NOW, plans: [
    { id: 'p', provider: 'Tabby', merchant: 'Noon', total: 400, count: 2, cadence: '1m', first: '2026-11-20', account: 'ADCB', paid: [null, null], skip: [] },
    { id: 'q', provider: 'Tamara', merchant: 'Emirates', total: 900, count: 3, cadence: '1m', first: '2026-11-15', account: 'ADIB', paid: [null, null, null], skip: [] }] });
  ok(bills.total === 256 && bills.items.length === 2, 'bills due on ADCB before 27 Nov: Netflix 56 + the Tabby instalment 200 (the ADIB plan is not on the card)');
  const m = homeNumbers(list, SAMPLE_PLAN, S, NOW, {}, { bills: bills.total });
  ok(near(m.allowLeft - m.safe, 256) && m.bills === 256, 'Safe to spend = allowance left − 256 of bills');
  const over = homeNumbers([...base.slice(0, 4), E('Spend', 3100, 'ADCB', '2026-11-01T10:00:00+04:00')], SAMPLE_PLAN, S, NOW, {}, { bills: 200 });
  ok(over.safe === 0 && over.allowLeft === -100 && over.pace.state === 'spent', 'over the allowance: Safe to spend is 0, never negative');
}

console.log('\n── weeks and refunds in the same rules');
{
  const list = [...base, E('Income', 50, 'ADCB', '2026-11-03T10:00:00+04:00', { category: 'Refund', merchant: 'Salt' }), E('Spend', 999, 'ADCB', '2026-11-04T10:00:00+04:00', { exclude: true })];
  const w = weekTotals(list, S, '2026-11-02', 1).get('2026-11-02');
  ok(w.spent === 150 && w.refunds === 50, 'a week: 200 spent − 50 refund = 150; the excluded 999 is left out');
  ok(isRefund(list.at(-2)) && !isRefund({ ...list.at(-2), exclude: true }), 'a refund marked "Exclude" isn\'t a refund either');
}

console.log('\n── the sheet (Code.gs) follows the same rules, and old rows still read');
{
  const env = makeEnv();
  env.ctx.setup();
  const tk = env.ctx.getToken_();
  const post = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ token: tk, ...body }) } }).text);
  const cyc = env.ctx.cycleOf_(new Date(), 27);
  const add = (id, e) => post({ action: 'add', entry: { id, date: new Date().toISOString(), ...e } });
  add('m', { type: 'Transfer', amount: 3000, account: 'ADIB', toAccount: 'ADCB', source: 'Plan:allowance' });
  add('s', { type: 'Spend', amount: 500, account: 'ADCB', category: 'Shopping', merchant: 'Noon' });
  add('r', { type: 'Income', amount: 100, account: 'ADCB', category: 'Refund', merchant: 'Noon' });
  add('x', { type: 'Spend', amount: 900, account: 'ADCB', category: 'Travel', exclude: true });
  add('i', { type: 'Spend', amount: 2500, account: 'ADCB', category: 'Investing' });
  add('t', { type: 'Transfer', amount: 771, account: 'ADIB', toAccount: 'ADCB' });
  const sum = env.ctx.cycleSummary_(cyc);
  ok(sum.spent === 400 && sum.allowanceUsed === 400 && sum.allowanceLeft === 2600, 'sheet: Spent 400 (500 − 100 refund), allowance left 2,600: excluded, Investing and the top-up ignored');
  // an older Ledger: 16 columns, no ticks. The newer headers are added; its rows read as "not excluded"
  const old = makeEnv();
  old.ctx.setup();
  const led = old.ss.getSheetByName('Ledger');
  for (const c of [17, 18]) led.getRange(1, c).setValue('');
  led.appendRow(['o1', new Date(), cyc, 'Spend', 42, 'AED', 42, 'ADCB', '', 'Groceries', 'Lulu', '', 'Apple Pay', 'OK', new Date(), new Date()]);
  old.ctx.PropertiesService.getScriptProperties().deleteProperty('LEDGER_COLS');
  const otk = old.ctx.getToken_();
  const list = JSON.parse(old.ctx.doPost({ postData: { contents: JSON.stringify({ token: otk, action: 'list' }) } }).text);
  const o1 = list.entries.find((e) => e.id === 'o1');
  ok(o1 && o1.exclude === false && o1.addToAllowance === false && led.getRange(1, 17).getValue() === 'Not my spending' && led.getRange(1, 18).getValue() === 'Add to allowance', 'an old row reads as not excluded, and the two new headers are added');
  // the Apple Pay Shortcut, unchanged
  const ap = JSON.parse(old.ctx.doPost({ postData: { contents: JSON.stringify({ token: otk, source: 'applepay', amount: 'AED 25.00', merchant: 'Starbucks', card: 'ADCB', category: 'Decide later' }) } }).text);
  ok(ap.ok && ap.entry.type === 'Spend' && ap.entry.exclude === false && /left of your allowance/.test(ap.message), 'the Apple Pay Shortcut still logs a payment and replies with the allowance left');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
