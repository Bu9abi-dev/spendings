// Buy now, pay later: the schedule maths and "sync" in docs/js/bnpl.js, then the real app in demo mode
// (Home line, plans sheet, Mark paid + one-step undo, a new plan leaving balances alone, Insights, Settings).
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-bnpl.mjs
// Another port: BASE=http://localhost:8843 node tests/verify-bnpl.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS, balances, summarize, cycleOf, dayKey } from '../docs/js/model.js';
import {
  instalmentAmounts, dueDates, planState, bnplSummary, autoLink, linkCandidates, paymentEntry, withPaid, withUnlinked,
  normalizePlan, addDays, dueBetween,
} from '../docs/js/bnpl.js';

const BASE = process.env.BASE || 'http://localhost:8765';
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const sum = (a) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;
const S = { ...DEFAULT_SETTINGS };

// ── instalment amounts: equal shares, the last one takes the rounding
ok(JSON.stringify(instalmentAmounts(1000, 3)) === '[333.33,333.33,333.34]', '1,000 in 3: the last instalment absorbs the rounding');
ok(instalmentAmounts(899, 4).every((x) => x === 224.75), '899 in 4 is four equal 224.75s');
for (const [t, c] of [[1000, 3], [899.99, 4], [0.05, 4], [1234.57, 6], [100, 1], [2500, 12]]) {
  ok(sum(instalmentAmounts(t, c)) === t && instalmentAmounts(t, c).length === c, `${t} in ${c} adds up to exactly ${t}`);
}

// ── due dates
ok(dueDates('2026-10-30', 4, '2w').join() === '2026-10-30,2026-11-13,2026-11-27,2026-12-11', 'every two weeks from the first due day');
ok(dueDates('2026-01-31', 3, '1m').join() === '2026-01-31,2026-02-28,2026-03-31', 'monthly keeps the day, or the month’s last day when shorter');
ok(dueDates('2026-11-15', 3, '1m').join() === '2026-11-15,2026-12-15,2027-01-15', 'monthly rolls over the year');
ok(dueDates('2027-12-20', 2, '2w')[1] === '2028-01-03', 'two-weekly rolls over the year');

// ── where a plan stands, overdue
const plan = normalizePlan({ id: 'p1', provider: 'Tabby', merchant: 'Noon', item: 'AirPods', category: 'Shopping', total: 899, count: 4, cadence: '2w', first: '2026-10-01', account: 'ADCB' });
const today = '2026-10-15'; // instalment 1 due 1 Oct (late), 2 due today, 3 and 4 still to come
let st = planState(plan, [], today);
ok(st.owed === 899 && st.paidCount === 0 && st.next.i === 0, 'a new plan owes its whole total');
ok(st.list[0].overdue && !st.list[1].overdue && !st.list[2].overdue, 'past its due day and unpaid is overdue; due today is not');
const e1 = { id: 'm-1', type: 'Spend', amount: 224.75, currency: 'AED', account: 'ADCB', category: 'Shopping', merchant: 'Tabby · Noon', date: '2026-10-02T08:00:00Z' };
st = planState(withPaid(plan, 0, 'm-1', '2026-10-02'), [e1], today);
ok(st.paidCount === 1 && st.owed === 674.25 && st.overdue.length === 0 && st.next.i === 1, 'paying instalment 1 clears the overdue and lowers what’s owed');
ok(planState(withPaid(plan, 0, 'm-1', '2026-10-02'), [], today).paidCount === 0, 'a link to an entry that no longer exists (deleted, undone) counts as unpaid');
ok(planState(withPaid(plan, 0, '', today), [], today).paidCount === 1, '“paid before tracking” counts as paid with no entry');
ok(planState(withUnlinked(withPaid(plan, 0, 'm-1', 'x'), 0), [e1], today).paidCount === 0, 'unlinking makes it unpaid again');

// ── the payment entry: a normal Spend from the plan's account and category
const pe = paymentEntry(plan, 3, '2026-11-12T08:00:00Z');
ok(pe.type === 'Spend' && pe.amount === 224.75 && pe.account === 'ADCB' && pe.category === 'Shopping' && pe.merchant === 'Tabby · Noon', 'Mark paid logs a Spend: Tabby · Noon, Shopping, from ADCB');
ok(/4 of 4/.test(pe.note), 'the note says which instalment it was');

// ── "sync": link payments already in the ledger
const dubai = (key, h = 10) => new Date(`${key}T${String(h).padStart(2, '0')}:00:00+04:00`).toISOString();
const sp = (id, merchant, amount, key, extra = {}) => ({ id, type: 'Spend', amount, currency: 'AED', account: 'ADCB', category: 'Shopping', merchant, date: dubai(key), cycle: cycleOf(dubai(key)), ...extra });
const ledger = [
  sp('a', 'TABBY*NOON FZ LLC', 224.75, '2026-10-01'),   // instalment 1, on the day
  sp('b', 'tabby', 224.25, '2026-10-18'),              // instalment 2: 50 fils off, 3 days late
  sp('c', 'Tabby', 224.75, '2026-11-05'),              // 7 days from instalment 3 (29 Oct) and 8 from 4: too far
  sp('d', 'Carrefour', 224.75, '2026-10-29'),          // right amount and day, wrong name
  sp('e', 'TABBY', 226.00, '2026-10-29'),              // right name and day, AED 1.25 off
  { ...sp('f', 'TABBY', 224.75, '2026-10-29'), type: 'Transfer' }, // not a purchase
];
let r = autoLink([plan], ledger, S);
st = planState(r.plans[0], ledger, '2026-11-01');
ok(r.linked === 2 && st.list[0].entry === 'a' && st.list[1].entry === 'b', 'links a provider payment within AED 1 and ±5 days of its instalment');
ok(!st.list[2].paid && !st.list[3].paid, 'too far from the due day, wrong name, too far off in amount, or a transfer: not linked');
ok(r.plans[0].paid[0].auto === true, 'a found link is marked as found by the app');
ok(autoLink(r.plans, ledger, S).linked === 0, 'running it again finds nothing new (nothing to save)');
const before = JSON.stringify([plan]);
autoLink([plan], ledger, S);
ok(JSON.stringify([plan]) === before, 'it’s pure: the plans passed in are left untouched');

// one payment can only ever pay one instalment, even with two look-alike plans
const twin = { ...plan, id: 'p2', merchant: 'Amazon' };
r = autoLink([plan, twin], [sp('a', 'TABBY', 224.75, '2026-10-01')], S);
const used = r.plans.flatMap((p) => p.paid.filter(Boolean).map((x) => x.entry));
ok(r.linked === 1 && used.length === 1, 'one ledger payment is linked to one instalment only, never two');
// already linked by hand: not linked again elsewhere
r = autoLink([withPaid(plan, 2, 'a', '2026-10-01'), twin], [sp('a', 'TABBY', 224.75, '2026-10-01')], S);
ok(r.linked === 0, 'a payment already linked (by hand or Mark paid) is never linked a second time');
// the closest day wins when two payments fit
r = autoLink([plan], [sp('x', 'TABBY', 224.75, '2026-10-04'), sp('y', 'TABBY', 224.75, '2026-10-02')], S);
ok(r.plans[0].paid[0].entry === 'y' && r.linked === 1, 'of two fits, the one closest to the due day is linked; the other stays free');
// unlinked by hand: never auto-linked to that plan again
r = autoLink([withUnlinked(withPaid(plan, 0, 'a', 'x'), 0)], [sp('a', 'TABBY', 224.75, '2026-10-01')], S);
ok(r.linked === 0, 'a payment you unlinked is not linked back');
const cands = linkCandidates(plan, 0, [plan], ledger, S);
ok(cands.length && cands.every((e) => e.type === 'Spend') && cands[0].id === 'a', '“Link existing payment” lists nearby spends, closest amount first');

// ── the money rule: a plan never changes a balance, and linking never double counts
const book = [
  { id: 'o', type: 'Adjustment', amount: 2000, currency: 'AED', account: 'ADCB', date: dubai('2026-09-20'), cycle: cycleOf(dubai('2026-09-20')) },
  ...ledger,
];
const bal = (es) => JSON.stringify([...balances(es, S)]);
const spent = (es) => summarize(es, '2026-11', S).spent;
const balBefore = bal(book), spentBefore = spent(book);
r = autoLink([plan, twin], book, S);
ok(bal(book) === balBefore && spent(book) === spentBefore, 'creating plans and linking payments leaves balances and spending exactly as they were');
ok(bnplSummary(r.plans, book, '2026-11-01').owed === sum([899, 899]) - sum([224.75, 224.75]), 'what’s owed is the unpaid instalments only, kept apart from balances');
// Mark paid = one new Spend, so the account goes down by exactly the instalment, once
const paid = [...book, { ...paymentEntry(plan, 2, dubai('2026-10-29')), id: 'm-p', cycle: cycleOf(dubai('2026-10-29')) }];
const linked = withPaid(r.plans[0], 2, 'm-p', '2026-10-29');
ok(Math.round((balances(book, S).get('ADCB').balance - balances(paid, S).get('ADCB').balance) * 100) / 100 === 224.75, 'Mark paid takes exactly one instalment out of the plan’s account');
ok(autoLink([linked, r.plans[1]], paid, S).linked === 0, 'the Mark paid entry itself is not picked up again by sync');
ok(planState(linked, paid, '2026-11-01').owed === 224.75, 'and what’s owed drops by the same amount');
const s = bnplSummary([linked], paid, '2026-10-30');
ok(s.next.i === 3 && s.overdue.length === 0, 'the next instalment moves on');
ok(dueBetween([plan], [], '2026-10-27', '2026-11-27').map((x) => x.i).join() === '2,3', 'instalments due in a cycle are listed for Insights');
ok(addDays('2026-12-31', 1) === '2027-01-01' && dayKey(new Date(dubai('2026-10-01', 23))) === '2026-10-01', 'day maths stays on Dubai calendar days');

// ── the real app, demo mode
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${BASE}/?demo=1#home`);
await p.waitForSelector('.bnpl-row');
const app = (fn, arg) => p.evaluate(async ([src, a]) => {
  const [st, m, bn] = await Promise.all([import('/js/store.js'), import('/js/model.js'), import('/js/bnpl.js')]);
  return new Function('st', 'm', 'bn', 'a', `return (${src})(st, m, bn, a)`)(st, m, bn, a);
}, [fn.toString(), arg]);
const snap = () => app((st, m, bn) => ({
  owed: bn.bnplSummary(st.getExtra('bnpl').plans, st.state.entries).owed,
  adcb: m.balances(st.state.entries, st.state.settings).get('ADCB').balance,
  total: [...m.balances(st.state.entries, st.state.settings).values()].reduce((a, x) => a + x.balance, 0),
  n: st.state.entries.length,
  plans: st.getExtra('bnpl').plans,
}));

let a = await snap();
ok(a.plans.length === 2 && a.plans.every((pl) => pl.paid.some((x) => x?.auto)), 'demo: the plans’ Apple Pay payments were linked by themselves');
ok((await p.textContent('.bnpl-row')).replace(/\s+/g, ' ').includes(`AED ${a.owed.toLocaleString('en-US', { minimumFractionDigits: 2 })} owed`), 'Home shows “BNPL: AED X owed”');
ok(/Next AED [\d.,]+ (on|today|tomorrow)/.test(await p.textContent('.bnpl-row')), 'and the next instalment with its day');
ok(await app((st) => !st.canUndo()), 'linking found payments takes no place in the Undo history');

await p.click('.bnpl-row');
await p.waitForSelector('.bn-plan');
ok(/3 of 4 paid/.test(await p.textContent('.bn-plan[data-plan="d-tabby"]')), 'the sheet shows each plan’s progress (3 of 4 paid)');
await p.click('.bn-plan[data-plan="d-tabby"] [data-bn-act="pay"]');
await p.waitForFunction(() => document.querySelector('.bn-plan[data-plan="d-tabby"]')?.textContent.includes('4 of 4 paid'));
let c = await snap();
const added = await app((st) => st.state.entries.find((e) => e.source === 'BNPL'));
ok(c.n === a.n + 1 && added.merchant === 'Tabby · Noon' && added.category === 'Shopping' && added.account === 'ADCB', 'Mark paid logs one Spend entry “Tabby · Noon” in Shopping from ADCB');
ok(Math.abs(a.adcb - c.adcb - 224.75) < 0.001 && Math.abs(a.owed - c.owed - 224.75) < 0.001, 'ADCB goes down and what’s owed goes down by the same 224.75');
ok(await app((st) => st.lastAction().startsWith('Paid Tabby · Noon 4 of 4')), 'it is one undo step');
await app((st) => st.undo());
c = await snap();
ok(c.n === a.n && Math.abs(c.adcb - a.adcb) < 0.001 && Math.abs(c.owed - a.owed) < 0.001, 'one Undo removes the payment and makes the instalment unpaid again');
await p.waitForFunction(() => document.querySelector('.bn-plan[data-plan="d-tabby"]')?.textContent.includes('3 of 4 paid'));
ok(true, 'the open sheet follows the undo');

// a new plan through the editor: owed goes up, no balance moves
await p.click('[data-bn-act="new"]');
await p.waitForSelector('#bn-total');
await p.fill('#bn-provider', 'Postpay');
await p.fill('#bn-merchant', 'Sharaf DG');
await p.fill('#bn-total', '1000');
await p.selectOption('#bn-count', '3');
const past = addDays(dayKey(new Date()), -20);
await p.fill('#bn-first', past);
ok(/2 × AED 333\.33, then AED 333\.34/.test(await p.textContent('.bn-preview')), 'the editor previews the schedule, rounding on the last instalment');
await p.click('.sheet:last-of-type [data-act="save"]');
await p.waitForFunction(() => document.querySelectorAll('.bn-plan').length === 3);
c = await snap();
ok(Math.abs(c.total - a.total) < 0.001 && Math.abs(c.adcb - a.adcb) < 0.001 && c.n === a.n, 'adding a plan changes no balance and logs nothing');
ok(Math.abs(c.owed - a.owed - 1000) < 0.001, 'what’s owed goes up by the plan’s total');
ok(await p.isVisible('.bn-plan.overdue'), 'an instalment past its due day shows as overdue');

// link an existing payment by hand
const lid = await app((st) => st.addEntry({ type: 'Spend', amount: 333.33, account: 'ADCB', category: 'Shopping', merchant: 'Sharaf DG online' }).id);
await p.click('.bn-plan:has-text("Postpay") [data-bn-act="link"]');
await p.waitForSelector(`.bn-cands [data-entry="${lid}"]`);
await p.click(`.bn-cands [data-entry="${lid}"]`);
await p.waitForFunction(async (id) => { const st = await import('/js/store.js'); return st.getExtra('bnpl').plans.some((x) => x.paid[0]?.entry === id); }, lid);
const postpay = await app((st) => st.getExtra('bnpl').plans.find((x) => x.provider === 'Postpay'));
ok(postpay.paid[0]?.entry === lid, '“Link existing payment” links the chosen entry instead of logging another');
await p.click('[data-bn-act="done"]');

// Home: overdue in a warning tone
await p.waitForSelector('.bnpl-row.overdue');
ok(/overdue since/.test(await p.textContent('.bnpl-row')), 'Home warns when an instalment is overdue');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');

// Settings and Insights
await p.click('.tabbar [data-tab="settings"]');
await p.waitForSelector('#bnpl + .group [data-bnpl="open"]');
ok(/3 plans/.test(await p.textContent('#bnpl + .group')), 'Settings has a Buy now, pay later row');
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.bnpl-panel');
ok(/still owed/.test(await p.textContent('.bnpl-panel')) && (await p.$$('.bn-due-row')).length > 0, 'Insights shows what’s owed and this cycle’s instalments');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'Insights: no sideways scroll');
ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await b.close();
console.log(`all ${n} BNPL checks passed`);
