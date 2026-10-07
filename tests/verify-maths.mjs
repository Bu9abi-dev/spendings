// Verification: pure maths behind Home (balances, Safe to spend, pace, "Where your money is"),
// cycle boundaries, carry-over, the allowance pot and the cycle-start setting (incl. the sheet).
// Usage: node tests/verify-maths.mjs   (prints PASS/FAIL/FINDING lines; exits 1 only on harness errors)
import {
  ACCOUNTS, setAccountList, DEFAULT_ACCOUNTS, DEFAULT_PLAN, DEFAULT_SETTINGS, balances, summarize, cycleOf, cycleBounds,
  cycleLength, daysLeft, planStatus, hubBreakdown, toAED, dateInCycle, fmt, homeNumbers, whereRows,
} from '../docs/js/model.js';
import { makeEnv } from './fake-sheet.mjs';

let fails = 0, findings = 0;
const ok = (cond, msg, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const finding = (msg) => { console.log(`FINDING ${msg}`); findings++; };
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

/* The real Home numbers (docs/js/model.js homeNumbers / whereRows), with `now` injected. */
function homeModel(entries, plan, s, now) {
  const m = homeNumbers(entries, plan, s, now);
  const { start, end } = cycleBounds(m.cyc, s.cycleStart);
  const len = (end - start) / 864e5;
  const elapsed = Math.min(len, Math.max(0, (now - start) / 864e5));
  return { ...m, len, elapsed, unmovedPlanId: m.allowanceUnmoved ? m.allowMove.id : '' };
}
const rowSum = (rows) => rows.reduce((a, r) => a + r.v, 0);
const shownSum = (rows) => rows.reduce((a, r) => a + Math.round(r.v), 0); // what the eye adds up (fmt whole)

const S = { ...DEFAULT_SETTINGS };
let n = 0;
const E = (type, amount, account, date, extra = {}) => {
  const e = { id: `t${++n}`, type, amount, currency: 'AED', account, toAccount: '', category: type === 'Spend' ? 'Groceries' : type === 'Income' ? 'Other' : '', merchant: '', note: '', source: 'App', status: 'OK', date: new Date(date).toISOString(), ...extra };
  e.cycle = cycleOf(e.date, S.cycleStart);
  if (e.amountAED == null) e.amountAED = toAED({ ...e, amountAED: null }, S);
  return e;
};
const D = (s) => new Date(s); // ISO with +04:00 offsets below = Dubai wall time

console.log('\n── 1. Cycle boundaries (Asia/Dubai, start 27) ──');
ok(cycleOf(D('2026-10-26T23:59:59+04:00')) === '2026-10', '26 Oct 23:59:59 Dubai is in cycle 2026-10 (Sep 27→Oct 26)');
ok(cycleOf(D('2026-10-27T00:00:00+04:00')) === '2026-11', '27 Oct 00:00 Dubai starts cycle 2026-11');
ok(cycleOf(D('2026-10-26T20:30:00Z')) === '2026-11', 'UTC-day edge: 26 Oct 20:30Z (=27 Oct 00:30 Dubai) → 2026-11 even though the UTC date is the 26th');
ok(cycleOf(D('2026-10-26T19:59:00Z')) === '2026-10', 'UTC-day edge: 26 Oct 19:59Z (=23:59 Dubai) → 2026-10');
const b11 = cycleBounds('2026-11');
ok(b11.start.toISOString() === '2026-10-26T20:00:00.000Z' && b11.end.toISOString() === '2026-11-26T20:00:00.000Z', 'cycleBounds(2026-11) = [27 Oct 00:00 Dubai, 27 Nov 00:00 Dubai)', `${b11.start.toISOString()} → ${b11.end.toISOString()}`);
ok(cycleOf(D('2026-12-27T00:00:00+04:00')) === '2027-01' && cycleBounds('2027-01').start.toISOString() === '2026-12-26T20:00:00.000Z', 'year wrap: 27 Dec 2026 → cycle 2027-01');
ok(cycleLength('2026-10') === 30 && cycleLength('2026-11') === 31 && cycleLength('2027-03') === 28, 'cycle lengths: Sep27→Oct27 = 30, Oct27→Nov27 = 31, Feb27→Mar27 2027 = 28', `${cycleLength('2026-10')}/${cycleLength('2026-11')}/${cycleLength('2027-03')}`);
ok(daysLeft('2026-10', 27, D('2026-10-26T23:59:00+04:00')) === 1 && daysLeft('2026-11', 27, D('2026-10-27T00:00:00+04:00')) === 31, 'daysLeft: 1 at 26th 23:59, 31 at 27th 00:00');
ok(daysLeft('2026-10', 27, D('2026-10-26T00:00:01+04:00')) === 1 && daysLeft('2026-10', 27, D('2026-10-25T23:59:00+04:00')) === 2, 'daysLeft counts the current day: "1 day to payday" on the 26th');
// Node vs a non-Dubai device clock: cycleOf uses Intl with an explicit TZ, so the device zone is irrelevant.
ok(new Intl.DateTimeFormat().resolvedOptions().timeZone !== undefined, `(Node TZ here: ${Intl.DateTimeFormat().resolvedOptions().timeZone}; cycleOf pins Asia/Dubai explicitly)`);
// Day-29/30/31 start day is impossible: settings cap at 28 (main.js:291, Code.gs:336).
ok(cycleOf(D('2026-10-05T10:00:00+04:00'), 1) === '2026-10' && cycleBounds('2026-10', 1).start.toISOString() === '2026-09-30T20:00:00.000Z', 'start day 1 = calendar month');

console.log('\n── 2. Pace ──');
setAccountList(DEFAULT_ACCOUNTS);
{
  const base = [
    E('Adjustment', 1000, 'ADIB', '2026-09-20T10:00:00+04:00'),
    E('Adjustment', 0, 'ADCB', '2026-09-20T10:00:00+04:00'),
    E('Income', 6000, 'ADIB', '2026-09-27T08:00:00+04:00', { category: 'Salary', source: 'Plan:salary' }),
    E('Transfer', 3000, 'ADIB', '2026-09-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
    E('Spend', 400, 'ADCB', '2026-09-30T12:00:00+04:00'),
    E('Spend', 100, 'ADCB', '2026-10-02T12:00:00+04:00', { currency: 'USD', amountAED: null }),
    E('Spend', 999, 'BOTIM', '2026-10-02T12:00:00+04:00'),
  ];
  const now = D('2026-10-07T12:00:00+04:00');
  const m = homeModel(base, DEFAULT_PLAN, S, now);
  const elapsed = (now - D('2026-09-27T00:00:00+04:00')) / 864e5; // 10.5 days of 30
  const used = 400 + Math.round(100 * 3.6725 * 100) / 100; // 767.25
  ok(m.len === 30 && near(m.elapsed, elapsed), `elapsed ${m.elapsed.toFixed(4)} of ${m.len} days`);
  ok(near(m.pace.expected, 3000 * elapsed / 30), `expected = 3000 × ${elapsed}/30 = ${m.pace.expected.toFixed(2)}`);
  ok(near(m.pace.spent, used) && near(m.pace.delta, used - 1050), `ADCB spend ${m.pace.spent} (USD 100 → 367.25); delta ${m.pace.delta.toFixed(2)} (BOTIM 999 excluded)`);
  ok(near(m.safe, 3000 - used), `Safe to spend = 3000 − ${used} = ${m.safe}`);
  const mEnd = homeModel(base, DEFAULT_PLAN, S, D('2026-10-26T23:59:59+04:00'));
  ok(near(mEnd.pace.expected, 3000, 0.1), `26th 23:59:59 → expected ≈ full allowance (${mEnd.pace.expected.toFixed(2)})`);
  const mNext = homeModel(base, DEFAULT_PLAN, S, D('2026-10-27T00:00:00+04:00'));
  ok(mNext.cyc === '2026-11' && mNext.pace.expected === 0 && mNext.pace.spent === 0, '27th 00:00 → new cycle, expected 0, spent 0');
}

console.log('\n── 3. Balances & "Where your money is" add up ──');
{
  const accs = [...DEFAULT_ACCOUNTS.map((a) => ({ ...a })), { name: 'Wio', note: 'Savings', color: 'blue', wallet: '', archived: true }];
  setAccountList(accs);
  const L = [
    E('Adjustment', 1234.56, 'ADIB', '2026-09-20T10:00:00+04:00'),
    E('Adjustment', 500, 'ADCB', '2026-09-20T10:00:00+04:00'),
    E('Adjustment', 120.4, 'BOTIM', '2026-09-20T10:00:00+04:00'),
    E('Adjustment', 50, 'Cash', '2026-09-20T10:00:00+04:00'),
    E('Adjustment', 700, 'Wio', '2026-09-20T10:00:00+04:00'), // archived, still holds 700
    E('Income', 6000, 'ADIB', '2026-09-27T08:00:00+04:00', { category: 'Salary', source: 'Plan:salary' }),
    E('Transfer', 3000, 'ADIB', '2026-09-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
    E('Spend', 19.99, 'ADCB', '2026-09-29T12:00:00+04:00', { currency: 'USD', amountAED: null }),
    E('Spend', 210.33, 'ADCB', '2026-10-01T12:00:00+04:00'),
    E('Spend', 90.75, 'Cash', '2026-10-01T12:00:00+04:00'), // Cash goes negative: 50 − 90.75
    E('Spend', 40, 'BOTIM', '2026-10-03T12:00:00+04:00', { currency: 'USD', amountAED: null }),
    E('Adjustment', -12.37, 'ADIB', '2026-10-04T12:00:00+04:00'),
    E('Spend', 300, 'ADIB', '2026-10-05T12:00:00+04:00', { category: 'Transport & Fuel' }),
  ];
  const plan = [...DEFAULT_PLAN.map((p) => ({ ...p })), { id: 'f2', name: 'Fuel', kind: 'Responsibility', amount: 450, day: null, from: 'ADIB', to: '', category: 'Transport & Fuel' }];
  const m = homeModel(L, plan, S, D('2026-10-07T12:00:00+04:00'));
  const b = Object.fromEntries([...m.bals].map(([k, v]) => [k, v.balance]));
  const usd1999 = Math.round(19.99 * 3.6725 * 100) / 100, usd40 = Math.round(40 * 3.6725 * 100) / 100;
  ok(near(b.ADIB, 1234.56 + 6000 - 3000 - 12.37 - 300), `ADIB ${b.ADIB}`);
  ok(near(b.ADCB, 500 + 3000 - usd1999 - 210.33), `ADCB ${b.ADCB} (USD 19.99 → ${usd1999})`);
  ok(near(b.BOTIM, 120.4 - usd40) && near(b.Cash, -40.75) && near(b.Wio, 700), `BOTIM ${b.BOTIM}, Cash ${b.Cash} (negative), Wio(archived) ${b.Wio}`);
  ok(near(m.safe, 3000 - usd1999 - 210.33), `Safe to spend ${m.safe.toFixed(2)}`);
  const rows = whereRows(m);
  console.log('      rows:', rows.map((r) => `${r.label}=${r.v.toFixed(2)}`).join(' | '), `| total=${m.total.toFixed(2)}`);
  ok(near(rowSum(rows), m.total), `rows sum to "All your money", archived Wio included (${rowSum(rows).toFixed(2)} = ${m.total.toFixed(2)})`);
  console.log(`      eye-check: rounded rows add to ${shownSum(rows)}, header/total shows ${fmt(m.total, { whole: true })}`);
}

console.log('\n── 3b. Unknown Apple Pay card account (Code.gs mapCard_ → "Unknown card") ──');
{
  setAccountList(DEFAULT_ACCOUNTS);
  const L = [E('Adjustment', 100, 'ADIB', '2026-09-20T10:00:00+04:00'), E('Spend', 42, 'Mastercard 1234', '2026-10-01T10:00:00+04:00', { status: 'Review' })];
  const m = homeModel(L, DEFAULT_PLAN, S, D('2026-10-07T12:00:00+04:00'));
  const rows = whereRows(m);
  if (!near(rowSum(rows), m.total)) finding(`BUG where-unknown: an Apple Pay spend on an unmapped card creates a phantom account "Mastercard 1234" (−42); total ${m.total} but rows sum ${rowSum(rows)}`);
}

console.log('\n── 3c. Rounding: rows shown as whole numbers vs total ──');
{
  setAccountList(DEFAULT_ACCOUNTS);
  // three non-hub parts each ending in .4 → each row rounds down, total rounds up
  const L = [E('Adjustment', 0.4, 'ADIB', '2026-09-20T10:00:00+04:00'), E('Adjustment', 1000.4, 'ADCB', '2026-09-20T10:00:00+04:00'), E('Adjustment', 10.4, 'BOTIM', '2026-09-20T10:00:00+04:00'), E('Adjustment', 20.4, 'Cash', '2026-09-20T10:00:00+04:00')];
  const plan = DEFAULT_PLAN.filter((p) => p.kind !== 'Move');
  const m = homeModel(L, plan, S, D('2026-10-07T12:00:00+04:00'));
  const rows = whereRows(m);
  console.log('      rows:', rows.map((r) => `${r.label}=${r.v.toFixed(2)}`).join(' | '), `| total=${m.total.toFixed(2)}`);
  if (shownSum(rows) !== Math.round(m.total)) finding(`MINOR where-rounding: rows displayed ${rows.map((r) => Math.round(r.v)).join(' + ')} = ${shownSum(rows)} but total shows ${Math.round(m.total)} (each row rounded independently; a 0.4 ADIB row is hidden by the |v| ≥ 0.5 filter)`);
}

console.log('\n── 3d. allowance account == main account (selectable in Settings → Budget) ──');
{
  setAccountList(DEFAULT_ACCOUNTS);
  const S2 = { ...S, allowanceAccount: 'ADIB' };
  const L = [E('Adjustment', 5000, 'ADIB', '2026-09-20T10:00:00+04:00'), E('Spend', 200, 'ADIB', '2026-10-01T10:00:00+04:00')];
  const m = homeModel(L, [], S2, D('2026-10-07T12:00:00+04:00'));
  const rows = whereRows(m);
  if (!near(rowSum(rows), m.total)) finding(`BUG where-same-account: allowanceAccount = emergencyAccount = ADIB → rows sum ${rowSum(rows)} vs total ${m.total} (Safe ${m.safe} counted twice: once as its own row, again inside "Emergency money")`);
}

console.log('\n── 4. Cycle end: carry-over, reset, unmoved allowance, top-ups ──');
setAccountList(DEFAULT_ACCOUNTS);
{
  const base = [
    E('Adjustment', 2000, 'ADIB', '2026-08-20T10:00:00+04:00'),
    E('Adjustment', 0, 'ADCB', '2026-08-20T10:00:00+04:00'),
    E('Income', 6000, 'ADIB', '2026-08-27T08:00:00+04:00', { category: 'Salary', source: 'Plan:salary' }),
    E('Transfer', 3000, 'ADIB', '2026-08-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
    E('Spend', 2400, 'ADCB', '2026-09-10T12:00:00+04:00'), // 600 unspent in cycle 2026-09
  ];
  const last = homeModel(base, DEFAULT_PLAN, S, D('2026-09-26T23:59:00+04:00'));
  ok(last.cyc === '2026-09' && near(last.safe, 600), `26 Sep 23:59: Safe to spend ${last.safe} (600 unspent)`);
  const first = homeModel(base, DEFAULT_PLAN, S, D('2026-09-27T00:00:00+04:00'));
  console.log(`      27 Sep 00:00 (allowance not moved yet): safe=${first.safe}, allowLeft=${first.allowLeft}, ADCB=${first.allowBal}, unmoved=${first.allowanceUnmoved}`);
  ok(first.cyc === '2026-10' && first.safe === 600 && first.allowanceUnmoved && first.unmovedPlanId === 'allowance', 'before the move: Safe = min(3000 left, 600 in ADCB) = 600, "Allowance not moved yet" button points at plan item');
  const moved = [...base, E('Transfer', 3000, 'ADIB', '2026-09-27T09:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' })];
  const after = homeModel(moved, DEFAULT_PLAN, S, D('2026-09-27T10:00:00+04:00'));
  const rows = whereRows(after);
  console.log('      after move rows:', rows.map((r) => `${r.label}=${r.v}`).join(' | '));
  ok(after.safe === 3000 && rows.find((r) => r.label === 'ADCB carried over')?.v === 600 && !after.allowanceUnmoved, 'after the move: Safe resets to 3000; the 600 carry-over shows ONLY as "ADCB carried over" (Where card + ADCB lens meta), not in Safe');
  // spending the carry-over still eats the new allowance
  const spendCarry = [...moved, E('Spend', 600, 'ADCB', '2026-09-28T10:00:00+04:00')];
  const sc = homeModel(spendCarry, DEFAULT_PLAN, S, D('2026-09-28T12:00:00+04:00'));
  console.log(`      after spending 600 on ADCB: safe=${sc.safe}, carried=${(sc.allowBal - sc.safe)}`);
  ok(sc.safe === 2400, 'any ADCB spend counts against this cycle’s allowance; the carried-over buffer is left alone');
  // mid-cycle extra top-up
  const topped = [...moved, E('Transfer', 500, 'ADIB', '2026-10-05T10:00:00+04:00', { toAccount: 'ADCB', note: 'extra' })];
  const t = homeModel(topped, DEFAULT_PLAN, S, D('2026-10-05T12:00:00+04:00'));
  const tr = whereRows(t);
  console.log('      extra 500 top-up rows:', tr.map((r) => `${r.label}=${r.v}`).join(' | '), `| plan allowance done=${t.status.find((p) => p.id === 'allowance').done}`);
  ok(t.safe === 3500 && t.status.find((p) => p.id === 'allowance').done === 3000, 'mid-cycle top-up ADIB→ADCB 500 adds to this cycle: Safe 3500, the planned move stays 3000');
  ok(tr.find((r) => r.label === 'ADCB carried over')?.v === 600 && near(rowSum(tr), t.total), 'the top-up is not mislabelled as carried over (still 600), rows add up to the total');
  // top-up BEFORE payday move shrinks the move
  const early = [...base, E('Transfer', 500, 'ADIB', '2026-09-28T10:00:00+04:00', { toAccount: 'ADCB', note: 'extra' })];
  const em = homeModel(early, DEFAULT_PLAN, S, D('2026-09-28T12:00:00+04:00'));
  const ap = em.status.find((p) => p.id === 'allowance');
  console.log(`      top-up 500 before the plan move: plan done=${ap.done}, remaining=${ap.remaining} ("Move now" would move ${ap.remaining}), safe=${em.safe}`);
  ok(ap.remaining === 3000, 'a top-up does not shrink the planned allowance move ("Move now" still moves 3000)');
  const em2 = homeModel([...early, E('Transfer', 3000, 'ADIB', '2026-09-28T13:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' })], DEFAULT_PLAN, S, D('2026-09-28T14:00:00+04:00'));
  ok(em2.safe === 3500, `after the move: Safe = 3000 + 500 top-up = ${em2.safe}`);
  // a hand-typed full move on payday is the planned move, not a top-up
  const typed = homeModel([...base, E('Transfer', 3000, 'ADIB', '2026-09-27T09:00:00+04:00', { toAccount: 'ADCB' })], DEFAULT_PLAN, S, D('2026-09-27T10:00:00+04:00'));
  ok(typed.safe === 3000 && typed.status.find((p) => p.id === 'allowance').complete, 'a hand-typed 3000 ADIB→ADCB on payday counts as the allowance move (Safe 3000, not 6000)');
}

console.log('\n── 4b. Top-up before payday carries into the new cycle ──');
setAccountList(DEFAULT_ACCOUNTS);
{
  const base = [
    E('Adjustment', 2000, 'ADIB', '2026-08-20T10:00:00+04:00'),
    E('Adjustment', 0, 'ADCB', '2026-08-20T10:00:00+04:00'),
    E('Income', 6000, 'ADIB', '2026-08-27T08:00:00+04:00', { category: 'Salary', source: 'Plan:salary' }),
    E('Transfer', 3000, 'ADIB', '2026-08-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
    E('Spend', 2900, 'ADCB', '2026-09-10T12:00:00+04:00'), // 100 of the allowance left
    E('Transfer', 500, 'ADIB', '2026-09-26T18:00:00+04:00', { toAccount: 'ADCB', note: 'top-up' }), // the day before payday
  ];
  const eve = homeModel(base, DEFAULT_PLAN, S, D('2026-09-26T20:00:00+04:00'));
  ok(eve.safe === 600, `26 Sep after the top-up: Safe = 100 left + 500 top-up = ${eve.safe}`);
  const pay = [...base, E('Transfer', 3000, 'ADIB', '2026-09-27T09:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' })];
  const p1 = homeModel(pay, DEFAULT_PLAN, S, D('2026-09-27T10:00:00+04:00'));
  const r1 = whereRows(p1);
  console.log('      payday rows:', r1.map((r) => `${r.label}=${r.v}`).join(' | '));
  ok(p1.safe === 3500 && p1.sum.carryIn === 500, `payday: Safe = 3000 allowance + 500 top-up = ${p1.safe}`);
  ok(r1.find((r) => r.label === 'ADCB carried over')?.v === 100 && near(rowSum(r1), p1.total), 'only the 100 of unspent allowance stays as the buffer; rows add up');
  const half = homeModel([...base.slice(0, -1), E('Transfer', 500, 'ADIB', '2026-09-26T18:00:00+04:00', { toAccount: 'ADCB' }), E('Spend', 300, 'ADCB', '2026-09-26T19:00:00+04:00'), pay[pay.length - 1]], DEFAULT_PLAN, S, D('2026-09-27T10:00:00+04:00'));
  ok(half.safe === 3300, `spent 300 more after the top-up (100 allowance + 200 of it): payday Safe = 3000 + 300 = ${half.safe}`);
  const later = homeModel(pay, DEFAULT_PLAN, S, D('2026-10-27T10:00:00+04:00'));
  ok(later.sum.carryIn === 0, 'the top-up carries one payday only; the cycle after resets');
}

console.log('\n── 5. Allowance pot: BOTIM, ADCB→BOTIM loophole, refunds ──');
setAccountList(DEFAULT_ACCOUNTS);
{
  const base = [
    E('Adjustment', 5000, 'ADIB', '2026-09-20T10:00:00+04:00'), E('Adjustment', 0, 'ADCB', '2026-09-20T10:00:00+04:00'), E('Adjustment', 0, 'BOTIM', '2026-09-20T10:00:00+04:00'),
    E('Transfer', 3000, 'ADIB', '2026-09-27T12:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
  ];
  const now = D('2026-10-07T12:00:00+04:00');
  const m0 = homeModel([...base, E('Transfer', 400, 'ADIB', '2026-09-28T12:00:00+04:00', { toAccount: 'BOTIM' }), E('Spend', 350, 'BOTIM', '2026-10-01T12:00:00+04:00')], DEFAULT_PLAN, S, now);
  ok(m0.safe === 3000 && m0.pace.spent === 0, `BOTIM spend 350 (funded from ADIB): Safe stays ${m0.safe}, pace spend ${m0.pace.spent}`);
  // loophole, no carry-over in ADCB
  const lo = [...base, E('Transfer', 1000, 'ADCB', '2026-10-01T12:00:00+04:00', { toAccount: 'BOTIM' }), E('Spend', 1000, 'BOTIM', '2026-10-02T12:00:00+04:00')];
  const m1 = homeModel(lo, DEFAULT_PLAN, S, now);
  console.log(`      ADCB→BOTIM 1000 then spend 1000 on BOTIM (ADCB had no carry-over): safe=${m1.safe}, allowLeft=${m1.allowLeft}, ADCB=${m1.allowBal}, pace spent=${m1.pace.spent}, unmoved=${m1.allowanceUnmoved}, button plan id='${m1.unmovedPlanId}'`);
  ok(m1.safe === 3000 && m1.pace.spent === 0, 'moving ADCB→BOTIM is reallocating: Safe stays 3000, nothing counted as spent');
  ok(!m1.allowanceUnmoved, 'no "Allowance not moved yet" after moving money on from ADCB');
  const r1 = whereRows(m1);
  ok(near(rowSum(r1), m1.total) && r1.find((r) => r.label === 'Safe to spend')?.v === 2000, 'Where card: 2000 of Safe to spend sits in ADCB, the rest under BOTIM; rows add up');
  // loophole with carry-over
  const lc = [E('Adjustment', 1500, 'ADCB', '2026-09-20T10:00:00+04:00'), ...base.filter((e) => e.account !== 'ADCB' || e.type !== 'Adjustment'), E('Transfer', 1000, 'ADCB', '2026-10-01T12:00:00+04:00', { toAccount: 'BOTIM' }), E('Spend', 1000, 'BOTIM', '2026-10-02T12:00:00+04:00')];
  const m2 = homeModel(lc, DEFAULT_PLAN, S, now);
  console.log(`      same, but ADCB carried 1500 in: safe=${m2.safe}, ADCB=${m2.allowBal}`);
  ok(m2.safe === 3000, 'transfers out of ADCB never count as allowance spending (your rule)');
  // refund
  const rf = [...base, E('Spend', 500, 'ADCB', '2026-10-01T12:00:00+04:00'), E('Income', 89, 'ADCB', '2026-10-03T12:00:00+04:00', { category: 'Refund' })];
  const m3 = homeModel(rf, DEFAULT_PLAN, S, now);
  console.log(`      ADCB spend 500 then refund 89: safe=${m3.safe}, allowanceUsed=${m3.sum.allowanceUsed}, ADCB=${m3.allowBal}, carried=${(m3.allowBal - m3.safe).toFixed(2)}`);
  ok(m3.safe === 2589 && m3.sum.allowanceUsed === 411 && near(m3.allowBal - m3.safe, 0), 'refund 89 goes back exactly where it was: Safe 2589, nothing lands in carried over');
  const rfOld = [...base, E('Income', 89, 'ADCB', '2026-10-03T12:00:00+04:00', { category: 'Refund' })]; // for a spend in an earlier cycle
  const m3b = homeModel(rfOld, DEFAULT_PLAN, S, now);
  ok(m3b.safe === 3000 && near(m3b.allowBal - m3b.safe, 89), 'refund for an earlier cycle’s spend: Safe stays 3000, the 89 goes back to the buffer');
  // ADCB → ADIB returned money
  const back = [...base, E('Transfer', 500, 'ADCB', '2026-10-01T12:00:00+04:00', { toAccount: 'ADIB' })];
  const m4 = homeModel(back, DEFAULT_PLAN, S, now);
  console.log(`      ADCB→ADIB 500 (giving money back): safe=${m4.safe}, unmoved=${m4.allowanceUnmoved}, allowance plan done=${m4.status.find((p) => p.id === 'allowance').done}`);
  // overspend
  const ov = [...base, E('Adjustment', 800, 'ADCB', '2026-09-20T10:00:00+04:00'), E('Spend', 3300, 'ADCB', '2026-10-01T12:00:00+04:00')];
  const m5 = homeModel(ov, DEFAULT_PLAN, S, now);
  const r5 = whereRows(m5);
  console.log(`      overspent 3300 with 800 carry: safe=${m5.safe}, rows=${r5.map((r) => `${r.label}=${r.v}`).join(' | ')}`);
  ok(m5.safe === -300 && r5.find((r) => r.label === 'ADCB carried over')?.v === 500 && near(rowSum(r5), m5.total), 'overspent: Safe −300 (shown as over the allowance), the Where card shows what ADCB really holds');
}

console.log('\n── 6. Changing the cycle start day ──');
{
  setAccountList(DEFAULT_ACCOUNTS);
  // client: saveSettings re-tags every entry's cycle (store.js:229). The sheet does not (Code.gs saveSettings_).
  const { ctx } = makeEnv();
  ctx.setup();
  const token = ctx.getToken_();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).text);
  post({ action: 'add', entry: { id: 'c1', type: 'Spend', amount: 100, account: 'ADCB', category: 'Groceries', date: '2026-10-26T10:00:00+04:00' } });
  post({ action: 'add', entry: { id: 'c2', type: 'Spend', amount: 50, account: 'ADCB', category: 'Groceries', date: '2026-10-28T10:00:00+04:00' } });
  let L = post({ action: 'list' }).entries;
  ok(L.find((e) => e.id === 'c1').cycle === '2026-10', 'sheet tags 26 Oct as 2026-10 with start 27');
  post({ action: 'settings', settings: { cycleStart: 25 } });
  L = post({ action: 'list' }).entries;
  const c1 = L.find((e) => e.id === 'c1');
  ok(c1.cycle === cycleOf(c1.date, 25), `after cycleStart → 25 the sheet re-tags: c1.cycle=${c1.cycle}`);
  if (c1.cycle !== cycleOf(c1.date, 25)) finding('BUG cyclestart-stale: Code.gs saveSettings_ never re-tags the Ledger "Cycle" column; on the next sync store.js:99 replaces the client’s re-tagged entries with the sheet’s stale ones, so summarize()/Safe to spend/pace (which filter on e.cycle) use the OLD cycle while cycleBounds/daysLeft use the new start day');
  const sNew = { ...S, cycleStart: 25 };
  const now = D('2026-10-26T12:00:00+04:00');
  const mStale = homeModel(L, [], sNew, now);
  const mFresh = homeModel(L.map((e) => ({ ...e, cycle: cycleOf(e.date, 25) })), [], sNew, now);
  console.log(`      26 Oct with start 25: stale-tag safe=${mStale.safe}/used=${mStale.sum.allowanceUsed} vs correct used=${mFresh.sum.allowanceUsed}`);
  // also: plan dates for day 27 items with start 25
  const due = dateInCycle('2026-11', 27, 25);
  console.log(`      plan "salary on the 27th" with start 25 → due ${due.toISOString()} (inside cycle 2026-11 = 25 Oct→24 Nov: ${due >= cycleBounds('2026-11', 25).start && due < cycleBounds('2026-11', 25).end})`);
}

console.log(`\n${fails} failed checks, ${findings} findings`);
process.exitCode = fails ? 1 : 0;
