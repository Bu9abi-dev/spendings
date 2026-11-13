// Home's allowance card, pace line and Safe to spend (v39): the real money on the allowance card ÷ the days to payday.
// The pure helper model.js allowancePace({ cardBalance, monthlyAllowance, today, nextPayday }), the payday it counts
// to (nextPaydayOf), the 7-day card pace for the run-out warning (recentCardSpend), and homeNumbers' m.card.
// Usage: node tests/verify-card-pace.mjs   (exits 1 on any failure)
import {
  setAccountList, SAMPLE_ACCOUNTS, SAMPLE_PLAN, SAMPLE_SETTINGS, cycleOf, toAED, homeNumbers, whereRows,
  allowancePace, nextPaydayOf, recentCardSpend, monthlyAllowanceOf, allowancePayDay,
} from '../docs/js/model.js';

let fails = 0, passes = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (cond) passes++; else fails++; };
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

setAccountList(SAMPLE_ACCOUNTS);
const S = { ...SAMPLE_SETTINGS }; // AED 3,000 on ADCB, cycles 27th → 26th
const pace = (cardBalance, today, nextPayday, extra = {}) => allowancePace({ cardBalance, monthlyAllowance: 3000, today, nextPayday, ...extra });

console.log('── the helper, with Abdullah\'s numbers');
{
  const p = pace(1672, '2026-11-13', '2026-11-27');
  ok(p.dailyTarget === 100, 'daily target = 3,000 ÷ 30 = 100, fixed');
  ok(p.daysLeft === 13, 'Nov 13 → payday Nov 27: Nov 14 … Nov 26 = 13 days (today and payday not counted)');
  ok(near(p.canSpendPerDay, 128.615), `can spend 1,672 ÷ 13 = ${p.canSpendPerDay.toFixed(2)} a day`);
  ok(near(p.percent, 1672 / 3000, 1e-9) && Math.round(p.percent * 100) === 56, 'percent = 1,672 ÷ 3,000 = 56%');
  ok(p.state === 'on', '128.6 ≥ 100: on track (green)');
}

console.log('\n── payday edges');
{
  const tomorrow = pace(150, '2026-11-26', '2026-11-27');
  ok(tomorrow.daysLeft === 1 && tomorrow.canSpendPerDay === 150, 'payday tomorrow: 0 days between, treated as 1; 150 a day');
  ok(nextPaydayOf('2026-11-27', 27) === '2026-12-27' && nextPaydayOf('2026-11-26', 27) === '2026-11-27' && nextPaydayOf('2026-11-13', 27) === '2026-11-27', 'on payday the next payday is next month\'s; the day before it is tomorrow');
  const today = pace(3000, '2026-11-27', nextPaydayOf('2026-11-27', 27));
  ok(today.daysLeft === 29 && near(today.canSpendPerDay, 3000 / 29), `payday today: daysLeft resets to the next cycle (Nov 28 … Dec 26 = 29), ${today.canSpendPerDay.toFixed(2)} a day`);
  ok(nextPaydayOf('2026-12-30', 27) === '2027-01-27', 'December rolls over to January');
  ok(nextPaydayOf('2026-11-10', 31) === '2026-11-30' && nextPaydayOf('2026-11-30', 31) === '2026-12-31', 'a pay day of 31 lands on the month\'s last day');
  ok(nextPaydayOf(new Date('2026-11-26T21:30:00+04:00'), 27) === '2026-11-27' && nextPaydayOf(new Date('2026-11-26T21:30:00Z'), 27) === '2026-12-27', 'dates are Dubai days (21:30 UTC on the 26th is already the 27th in Dubai)');
  ok(allowancePayDay(SAMPLE_PLAN, S) === 27 && allowancePayDay([], { ...S, cycleStart: 25 }) === 25 && allowancePayDay([], { ...S, cycleStart: 1 }) === 1, 'payday = the planned allowance move\'s day, else the cycle start');
  ok(monthlyAllowanceOf(SAMPLE_PLAN, S) === 3000 && monthlyAllowanceOf([], { ...S, allowance: 2500 }) === 2500, 'monthly allowance = the planned move (3,000), else the allowance setting');
}

console.log('\n── top-ups, tight, low, empty');
{
  const before = pace(1000, '2026-11-13', '2026-11-27');
  const after = pace(1500, '2026-11-13', '2026-11-27');
  ok(before.state === 'tight' && near(before.canSpendPerDay, 76.92), `1,000 with 13 days: ${before.canSpendPerDay.toFixed(2)} a day < 100, tight (amber)`);
  ok(after.state === 'on' && near(after.canSpendPerDay - before.canSpendPerDay, 500 / 13), 'a 500 top-up just raises the balance: +38.46 a day, on track again, no other maths');
  ok(near(after.percent, 0.5) && pace(3600, '2026-11-13', '2026-11-27').percent === 1.2, 'percent can go over 100% after a top-up (3,600 → 120%)');
  const low = pace(600, '2026-11-13', '2026-11-27');
  ok(low.state === 'low' && near(low.canSpendPerDay, 46.15), 'below half the target (46 < 50): low (red)');
  ok(pace(650, '2026-11-13', '2026-11-27').state === 'tight', '50 a day exactly is tight, not low');
  ok(pace(1300, '2026-11-13', '2026-11-27').state === 'on', '100.00 a day exactly is on track');
  const zero = pace(0, '2026-11-13', '2026-11-27'), neg = pace(-85.5, '2026-11-13', '2026-11-27');
  ok(zero.canSpendPerDay === 0 && zero.percent === 0 && zero.state === 'low' && !zero.runsOut, 'zero balance: 0 a day, 0%, low, no run-out warning');
  ok(neg.canSpendPerDay === 0 && neg.percent === 0 && neg.cardBalance === -85.5 && neg.state === 'low', 'negative balance: never a negative amount a day; the balance itself stays −85.50');
  ok(pace(500, '2026-11-13', '2026-11-27', { monthlyAllowance: 0 }).state === 'on', 'no allowance set: nothing to be tight against');
}

console.log('\n── run-out warning from the last 7 days of real card spending');
{
  const p = pace(1672, '2026-11-13', '2026-11-27', { recentPerDay: 200 });
  ok(p.runsOut && p.runsOut.outDay === '2026-11-21' && p.runsOut.early === 5 && p.runsOut.perDay === 200, `200 a day empties 1,672 in 8 days: around 21 Nov, 5 days before the 26th`);
  ok(!pace(1672, '2026-11-13', '2026-11-27', { recentPerDay: 120 }).runsOut, '120 a day lasts the 13 days: no warning');
  ok(!pace(1672, '2026-11-13', '2026-11-27', { recentPerDay: 0 }).runsOut, 'nothing spent lately: no warning');
}

let n = 0;
const E = (type, amount, account, iso, extra = {}) => {
  const e = { id: `c${++n}`, type, amount, currency: 'AED', account, toAccount: '', category: type === 'Spend' ? 'Groceries' : type === 'Income' ? 'Other' : '', merchant: '', note: '', source: 'App', status: 'OK', date: new Date(iso).toISOString(), ...extra };
  e.cycle = cycleOf(e.date, S.cycleStart);
  e.amountAED = toAED({ ...e, amountAED: null }, S);
  return e;
};
const NOW = new Date('2026-11-13T10:00:00+04:00');
const base = [
  E('Adjustment', 9000, 'ADIB', '2026-10-20T10:00:00+04:00'),
  E('Adjustment', 400, 'ADCB', '2026-10-20T10:00:00+04:00'),
  E('Income', 6000, 'ADIB', '2026-10-27T08:00:00+04:00', { category: 'Salary', source: 'Plan:salary' }),
  E('Transfer', 3000, 'ADIB', '2026-10-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
  E('Spend', 1500, 'ADCB', '2026-11-01T12:00:00+04:00', { merchant: 'Carrefour' }),
  E('Spend', 228, 'ADCB', '2026-11-10T12:00:00+04:00', { merchant: 'Salt', category: 'Food & Drinks' }),
]; // ADCB: 400 + 3,000 − 1,500 − 228 = 1,672
const home = (list, now = NOW) => homeNumbers(list, SAMPLE_PLAN, S, now);

console.log('\n── Home (homeNumbers m.card): only the allowance card\'s balance moves it');
{
  const m = home(base);
  ok(m.allowBal === 1672 && m.card.cardBalance === 1672 && m.card.daysLeft === 13 && m.card.nextPayday === '2026-11-27', 'ADCB 1,672 on 13 Nov, 13 days to payday');
  ok(near(m.safeToday, 1672 / 13) && m.card.state === 'on', `Safe to spend today = ${m.safeToday.toFixed(2)} (1,672 ÷ 13), on track`);
  const others = [
    ['ADIB spending', E('Spend', 700, 'ADIB', '2026-11-12T12:00:00+04:00')],
    ['a transfer ADIB → BOTIM', E('Transfer', 400, 'ADIB', '2026-11-12T12:00:00+04:00', { toAccount: 'BOTIM' })],
    ['an IBKR deposit from ADIB', E('Spend', 2500, 'ADIB', '2026-11-12T12:00:00+04:00', { category: 'Investing' })],
    ['a "Not my spending" payment from ADIB', E('Spend', 1450, 'ADIB', '2026-11-12T12:00:00+04:00', { exclude: true })],
    ['a bank check on ADIB', E('Adjustment', -180, 'ADIB', '2026-11-12T12:00:00+04:00', { note: 'Matched with bank' })],
  ];
  for (const [what, e] of others) {
    const x = home([...base, e]);
    ok(x.card.cardBalance === 1672 && x.safeToday === m.safeToday, `${what}: the card numbers don't move`);
  }
  const chk = home([...base, E('Adjustment', -72, 'ADCB', '2026-11-12T12:00:00+04:00', { note: 'Matched with bank' })]);
  ok(chk.card.cardBalance === 1600 && near(chk.safeToday, 1600 / 13), 'a "Checked with bank" on ADCB moves them only through the balance (1,600 ÷ 13)');
  const tu = home([...base, E('Transfer', 500, 'ADIB', '2026-11-12T12:00:00+04:00', { toAccount: 'ADCB' })]);
  ok(tu.card.cardBalance === 2172 && near(tu.safeToday, 2172 / 13) && tu.sum.allowancePot === 3000, 'a top-up raises the card balance and the per-day amount; Insights\' allowance budget stays 3,000');
  const mom = home([...base, E('Spend', 210, 'ADCB', '2026-11-12T12:00:00+04:00', { exclude: true })]);
  ok(mom.card.cardBalance === 1462 && mom.sum.spent === m.sum.spent, 'a "Not my spending" payment on ADCB: the money left the card (1,462), but it is not counted as spending');
  const out = home([...base, E('Transfer', 300, 'ADCB', '2026-11-12T12:00:00+04:00', { toAccount: 'BOTIM' })]);
  ok(out.card.cardBalance === 1372 && out.sum.allowanceUsed === m.sum.allowanceUsed, 'moving money off the card lowers what it holds; it is still not spending');
  const pd = home(base, new Date('2026-11-27T09:00:00+04:00'));
  ok(pd.card.daysLeft === 29 && pd.card.nextPayday === '2026-12-27', 'on payday the count resets to the next cycle');
  const rows = whereRows(m);
  ok(rows.find((r) => r.label === 'ADCB allowance card')?.v === 1672 && /about 129 a day for 13 days/.test(rows.find((r) => r.label === 'ADCB allowance card').sub), 'Where card: one ADCB row with the real 1,672 and "about 129 a day for 13 days"');
  ok(Math.abs(rows.reduce((a, r) => a + r.v, 0) - m.total) < 0.01, 'Where rows still add up to the total');
}

console.log('\n── the 7-day card pace');
{
  const list = [
    ...base,
    E('Spend', 140, 'ADCB', '2026-11-07T12:00:00+04:00'),             // 7 days incl. today: Nov 7 … Nov 13
    E('Spend', 999, 'ADCB', '2026-11-06T12:00:00+04:00'),             // 8 days ago: outside
    E('Spend', 210, 'ADCB', '2026-11-11T12:00:00+04:00', { exclude: true }),
    E('Spend', 500, 'ADCB', '2026-11-11T12:00:00+04:00', { category: 'Investing' }),
    E('Spend', 300, 'ADIB', '2026-11-11T12:00:00+04:00'),
    E('Income', 68, 'ADCB', '2026-11-12T12:00:00+04:00', { category: 'Refund' }),
    E('Transfer', 400, 'ADCB', '2026-11-12T12:00:00+04:00', { toAccount: 'BOTIM' }),
  ];
  ok(near(recentCardSpend(list, S, NOW), (228 + 140 - 68) / 7), 'personal ADCB spending in the last 7 days less refunds (300 ÷ 7); excluded, Investing, ADIB and transfers ignored');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
