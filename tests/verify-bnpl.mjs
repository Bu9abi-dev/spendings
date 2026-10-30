// Buy now, pay later: the schedule maths and "sync" in docs/js/bnpl.js, then the real app in demo mode
// (Home line, plans sheet, Mark paid + one-step undo, "is this already paid?", the auto-link toast and Unlink,
// stale toast Undo, the editor merging with the plan as it is now, plan-only undo, a new plan leaving balances alone).
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-bnpl.mjs
// Another port: BASE=http://localhost:8843 node tests/verify-bnpl.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS, balances, summarize, cycleOf, dayKey } from '../docs/js/model.js';
import {
  instalmentAmounts, dueDates, planState, bnplSummary, autoLink, linkCandidates, likelyPayment, paymentEntry, withPaid, withUnlinked,
  normalizePlan, addDays, dueBetween, byFit, bnplNotice, dueBeforePayday,
} from '../docs/js/bnpl.js';
import { learn, cleanMerchant } from '../docs/js/categorize.js';

const BASE = process.env.BASE || 'http://localhost:8765';
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const sum = (a) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;
const S = { ...DEFAULT_SETTINGS };

// ── payment amounts: equal shares, the last one takes the rounding
ok(JSON.stringify(instalmentAmounts(1000, 3)) === '[333.33,333.33,333.34]', '1,000 in 3: the last payment absorbs the rounding');
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
const today = '2026-10-15'; // payment 1 due 1 Oct (late), 2 due today, 3 and 4 still to come
let st = planState(plan, [], today);
ok(st.owed === 899 && st.paidCount === 0 && st.next.i === 0, 'a new plan owes its whole total');
ok(st.list[0].overdue && !st.list[1].overdue && !st.list[2].overdue, 'past its due day and unpaid is overdue; due today is not');
const e1 = { id: 'm-1', type: 'Spend', amount: 224.75, currency: 'AED', account: 'ADCB', category: 'Shopping', merchant: 'Tabby · Noon', date: '2026-10-02T08:00:00Z' };
st = planState(withPaid(plan, 0, 'm-1', '2026-10-02'), [e1], today);
ok(st.paidCount === 1 && st.owed === 674.25 && st.overdue.length === 0 && st.next.i === 1, 'paying payment 1 clears the overdue and lowers what’s still to pay');
ok(planState(withPaid(plan, 0, 'm-1', '2026-10-02'), [], today).paidCount === 0, 'a link to an entry that no longer exists (deleted, undone) counts as unpaid');
ok(planState(withPaid(plan, 0, '', today), [], today).paidCount === 1, '“paid before tracking” counts as paid with no entry');
ok(planState(withUnlinked(withPaid(plan, 0, 'm-1', 'x'), 0), [e1], today).paidCount === 0, 'unlinking makes it unpaid again');

// ── the payment entry: a normal Spend from the plan's account and category, marked as a plan payment
const pe = paymentEntry(plan, 3, '2026-11-12T08:00:00Z');
ok(pe.type === 'Spend' && pe.amount === 224.75 && pe.account === 'ADCB' && pe.category === 'Shopping' && pe.merchant === 'Tabby · Noon', 'Mark paid logs a Spend: Tabby · Noon, Shopping, from ADCB');
ok(/Payment 4 of 4/.test(pe.note) && pe.source === 'BNPL', 'the note says which payment it was, and it is marked source BNPL');
// ...and that mark keeps it out of what the app learns about merchants
const learned = learn([{ ...pe, id: 'x1', status: 'OK' }, { ...pe, id: 'x2', status: 'OK' }, { ...pe, id: 'x3', status: 'OK' }]);
ok(!learned.has(cleanMerchant(pe.merchant)), 'a plan’s payments don’t teach the categoriser “Tabby · Noon → Shopping”');
ok(learn([{ ...pe, id: 'x4', status: 'OK', source: 'App' }]).has(cleanMerchant(pe.merchant)), '(the same entry typed by you would be learned)');

// ── "sync": link payments already in the ledger
const dubai = (key, h = 10) => new Date(`${key}T${String(h).padStart(2, '0')}:00:00+04:00`).toISOString();
const sp = (id, merchant, amount, key, extra = {}) => ({ id, type: 'Spend', amount, currency: 'AED', account: 'ADCB', category: 'Shopping', merchant, date: dubai(key), cycle: cycleOf(dubai(key)), ...extra });
// due days: 1 Oct, 15 Oct, 29 Oct, 12 Nov
const ledger = [
  sp('a', 'TABBY*NOON FZ LLC', 224.75, '2026-10-01'),   // payment 1, on the day
  sp('b', 'tabby', 224.25, '2026-10-18'),              // payment 2: 50 fils off, 3 days late
  sp('c', 'Tabby', 224.75, '2026-11-05'),              // payment 3, a week late (and 7 days before payment 4)
  sp('d', 'Carrefour', 224.75, '2026-10-29'),          // right amount and day, wrong name
  sp('e', 'TABBY', 226.00, '2026-10-29'),              // right name and day, AED 1.25 off
  { ...sp('f', 'TABBY', 224.75, '2026-10-29'), type: 'Transfer' }, // not a purchase
];
let r = autoLink([plan], ledger, S);
st = planState(r.plans[0], ledger, '2026-11-06');
ok(r.linked === 3 && st.list[0].entry === 'a' && st.list[1].entry === 'b', 'links a provider payment within AED 1 of its payment, on time or a few days late');
ok(st.list[2].entry === 'c' && !st.list[3].paid, 'a payment a week late pays the overdue payment 3, not payment 4 it happens to be near');
ok(r.links.length === 3 && r.links.every((l) => l.planId === 'p1'), 'it reports each new link (for the “Linked …” toast)');
ok(!['d', 'e', 'f'].some((id) => st.list.some((x) => x.entry === id)), 'wrong name, more than AED 1 off, or a transfer: not linked');
ok(r.plans[0].paid[0].auto === true, 'a found link is marked as found by the app');
ok(autoLink(r.plans, ledger, S).linked === 0, 'running it again finds nothing new (nothing to save)');
const before = JSON.stringify([plan]);
autoLink([plan], ledger, S);
ok(JSON.stringify([plan]) === before, 'it’s pure: the plans passed in are left untouched');
// overdue payment 1, then a payment 12 days late, 2 days before payment 2 is due: it goes to payment 1
r = autoLink([plan], [sp('late', 'TABBY', 224.75, '2026-10-13')], S);
ok(r.plans[0].paid[0]?.entry === 'late' && !r.plans[0].paid[1], 'prefers the earliest unpaid payment: a late payment isn’t linked to the next one instead of the overdue one');

// two look-alike plans: a payment that fits both equally is left for you to pick
const twin = { ...plan, id: 'p2', merchant: 'Amazon' };
r = autoLink([plan, twin], [sp('a', 'TABBY', 224.75, '2026-10-01')], S);
ok(r.linked === 0 && r.plans.every((p) => !p.paid.some(Boolean)), 'two plans tie for one payment: not linked automatically (left to link by hand)');
r = autoLink([plan, twin], [sp('a', 'TABBY*NOON', 224.75, '2026-10-01')], S);
const used = r.plans.flatMap((p) => p.paid.filter(Boolean).map((x) => x.entry));
ok(r.linked === 1 && used.length === 1 && r.plans[0].paid[0].entry === 'a', 'the shop’s name settles it: linked to the Noon plan, and to one payment only');
r = autoLink([twin, plan], [sp('a', 'TABBY', 224.75, '2026-10-01'), sp('a2', 'TABBY', 224.75, '2026-10-03')], S);
ok(r.linked === 0, 'the order the plans are saved in makes no difference to a tie');
// already linked by hand: not linked again elsewhere
r = autoLink([withPaid(plan, 2, 'a', '2026-10-01'), twin], [sp('a', 'TABBY', 224.75, '2026-10-01')], S);
ok(r.linked === 0, 'a payment already linked (by hand or Mark paid) is never linked a second time');
// the earliest fitting payment wins, the other stays free
r = autoLink([plan], [sp('x', 'TABBY', 224.75, '2026-10-04'), sp('y', 'TABBY', 224.75, '2026-10-02')], S);
ok(r.plans[0].paid[0].entry === 'y' && r.linked === 1, 'of two fits, one is linked (the earlier); the other stays free');
ok(JSON.stringify(autoLink([plan], [sp('y', 'TABBY', 224.75, '2026-10-02'), sp('x', 'TABBY', 224.75, '2026-10-04')], S).plans) === JSON.stringify(r.plans), 'the ledger’s order makes no difference');
// unlinked by hand: never auto-linked to that plan again
r = autoLink([withUnlinked(withPaid(plan, 0, 'a', 'x'), 0)], [sp('a', 'TABBY', 224.75, '2026-10-01')], S);
ok(r.linked === 0, 'a payment you said wasn’t this one is not linked back');

// the comparator is a proper ordering: 0 only for the same thing, opposite signs when swapped, same result in any order
const cand = (id, i, dDay, dAmt, due, shop = 0) => ({ plan: { id }, i, dDay, dAmt, due, shop });
const cs = [cand('b', 1, 2, 0, '2026-10-15'), cand('a', 0, 2, 0, '2026-10-15'), cand('a', 1, 1, 0.5, '2026-10-29'), cand('c', 0, 3, 0, '2026-10-01', 1), cand('a', 0, 2, 0, '2026-10-01')];
ok(cs.every((x) => byFit(x, x) === 0) && cs.every((x) => cs.every((y) => x === y || Math.sign(byFit(x, y)) === -Math.sign(byFit(y, x)) && byFit(x, y) !== 0)), 'byFit returns 0 only for itself and flips sign when swapped');
const order1 = [...cs].sort(byFit).map((x) => `${x.plan.id}${x.i}${x.due}`).join(), order2 = [...cs].reverse().sort(byFit).map((x) => `${x.plan.id}${x.i}${x.due}`).join();
ok(order1 === order2 && order1.startsWith('c0'), 'sorting gives the same order from any start: shop match, then closest day, closest amount, due day, id');

const cands = linkCandidates(plan, 0, [plan], ledger, S);
ok(cands.length && cands.every((e) => e.type === 'Spend') && cands[0].id === 'a', '“Link a payment” lists nearby spends, closest amount first');

// ── Mark paid must not double count: an existing payment that's probably this one is offered first
ok(likelyPayment(plan, 0, [plan], [sp('n', 'NOON.COM', 224.75, '2026-10-02')], S)?.id === 'n', 'Mark paid finds a payment naming the shop (not linked by itself, no provider name)');
ok(likelyPayment(plan, 0, [plan], [sp('n', 'ADCB CARD', 224.75, '2026-10-02')], S)?.id === 'n', 'or one for the exact amount on the right days');
ok(likelyPayment(plan, 0, [plan], [sp('n', 'ADCB CARD', 224.20, '2026-10-02')], S) === null, 'but not a nameless one that’s only near the amount');
ok(likelyPayment(plan, 0, [plan], [sp('n', 'TABBY', 224.75, '2026-11-20')], S) === null, 'nor one far outside that payment’s days');
ok(likelyPayment(withPaid(plan, 1, 'n', 'x'), 0, [withPaid(plan, 1, 'n', 'x')], [sp('n', 'TABBY', 224.75, '2026-10-02')], S) === null, 'nor one already linked');
ok(likelyPayment(withUnlinked(withPaid(plan, 0, 'n', 'x'), 0), 0, [], [sp('n', 'TABBY', 224.75, '2026-10-02')], S) === null, 'nor one you said wasn’t this plan’s');

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
ok(bnplSummary(r.plans, book, '2026-11-01').owed === sum([899, 899]) - sum([224.75, 224.75]), 'what’s still to pay is the unpaid payments only, kept apart from balances');
// Mark paid = one new Spend, so the account goes down by exactly the payment, once
const paid = [...book, { ...paymentEntry(plan, 2, dubai('2026-10-29')), id: 'm-p', cycle: cycleOf(dubai('2026-10-29')) }];
const linked = withPaid(r.plans[0], 2, 'm-p', '2026-10-29');
ok(Math.round((balances(book, S).get('ADCB').balance - balances(paid, S).get('ADCB').balance) * 100) / 100 === 224.75, 'Mark paid takes exactly one payment out of the plan’s account');
ok(!autoLink([linked, r.plans[1]], paid, S).links.some((l) => l.entry === 'm-p'), 'the Mark paid entry itself is not picked up again by sync');
ok(planState(linked, paid, '2026-11-01').owed === 224.75, 'and what’s still to pay drops by the same amount');
const s = bnplSummary([linked], paid, '2026-10-30');
ok(s.next.i === 3 && s.overdue.length === 0, 'the next payment moves on');
ok(dueBetween([plan], [], '2026-10-27', '2026-11-27').map((x) => x.i).join() === '2,3', 'payments due in a cycle are listed for Insights');
ok(addDays('2026-12-31', 1) === '2027-01-01' && dayKey(new Date(dubai('2026-10-01', 23))) === '2026-10-01', 'day maths stays on Dubai calendar days');

// ── the Home notice: only when something is overdue or due within 7 days
const p2 = withPaid(withPaid(plan, 0, '', 'x'), 1, '', 'x'); // 1 and 2 paid; 3 due 29 Oct, 4 due 12 Nov
ok(bnplNotice([p2], [], '2026-10-15', '2026-10-27') === null, 'nothing due within 7 days and nothing overdue: no Home line');
let no = bnplNotice([p2], [], '2026-10-23', '2026-10-27');
ok(no?.priority === 'due' && no.text === 'Buy now, pay later: AED 449.50 still to pay · next AED 224.75 on 29 Oct', 'due in 6 days: “Buy now, pay later: AED X still to pay · next AED Y on <date>”');
no = bnplNotice([p2], [], '2026-10-23', '2026-11-01');
ok(no.beforePayday === 224.75 && /AED 224\.75 due before payday/.test(no.sub), 'and how much is due before payday (unpaid, due before the next cycle starts)');
no = bnplNotice([plan], [], '2026-10-15', '2026-10-27');
ok(no?.priority === 'overdue' && /AED 224\.75 overdue since 1 Oct/.test(no.text) && no.beforePayday === 449.5, 'overdue always shows, first, with the overdue amount; due before payday counts overdue ones too');
ok(dueBeforePayday([plan], [], '2026-10-01', '2026-09-20') === 0, 'nothing due before payday: zero');
ok(bnplNotice([], [], '2026-10-15') === null && bnplNotice([withPaid(withPaid(p2, 2, '', 'x'), 3, '', 'x')], [], '2026-10-15') === null, 'no plans, or all paid off: nothing on Home');

// ── the real app, demo mode
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${BASE}/?demo=1#home`);
await p.waitForSelector('.lens');
// the allowance pace alert (weekly.js) is a Home line too; give the allowance room so it doesn't outrank what this test checks
await p.evaluate(async () => { const st = await import('/js/store.js'); st.state.settings = { ...st.state.settings, allowance: 1e6 }; });
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
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
const planOf = (id) => app((st, m, bn, a) => st.getExtra('bnpl').plans.find((x) => x.id === a), id);
const dueOf = (pl, i) => dueDates(pl.first, pl.count, pl.cadence)[i];
const at = (key) => new Date(`${key}T10:00:00+04:00`).toISOString();
const toastText = () => p.textContent('#toast');
const sheet = (sel) => `.sheet:last-of-type ${sel}`;
const m0 = (v) => `AED ${v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;

let a = await snap();
ok(a.plans.length === 2 && a.plans.every((pl) => pl.paid.some((x) => x?.auto)), 'demo: the plans’ Apple Pay payments were linked by themselves');
ok(!(await p.isVisible('#toast')) || !/Linked/.test(await toastText()), 'demo’s own made-up payments are linked quietly (no toast on every start)');
ok(await app((st) => !st.canUndo()), 'linking found payments takes no place in the Undo history');
ok(!(await p.$('.bnpl-row')), 'the demo’s plans have nothing due within 7 days: no Home line');
// Home shows one notice at a time: set the demo's subscriptions aside (as verify-budgets does), add a plan due in 3 days
await app(async (st) => {
  const r = await import('/js/recurring.js');
  st.saveExtra('recurring', { v: 1, ignored: [...new Set(st.state.entries.map((e) => r.recurringKey(e.merchant)).filter(Boolean))] }, 'x', { undoable: false });
  const soon = { id: 'soon', provider: 'Cashew', merchant: 'Ikea', item: '', category: 'Shopping', total: 400, count: 2, cadence: '2w', first: new Date(Date.now() + 3 * 864e5 + 4 * 3600e3).toISOString().slice(0, 10), account: 'ADCB', paid: [null, null], skip: [] };
  st.saveExtra('bnpl', { v: 1, plans: [...st.getExtra('bnpl').plans, soon] }, 'x', { undoable: false });
});
await p.waitForSelector('.bnpl-row');
const owedNow = (await snap()).owed;
const homeText = (await p.textContent('.bnpl-row')).replace(/\s+/g, ' ').trim();
ok(homeText.startsWith(`Buy now, pay later: ${m0(owedNow)} still to pay · next AED 200 on `), 'Home: “Buy now, pay later: AED X still to pay · next AED Y on <date>” when a payment is due within 7 days');
ok(!/BNPL|instalment/i.test(homeText), 'no “BNPL” or “instalment” jargon on Home');
ok((await p.$$('.lens ~ .sub-line, .lens ~ .budget-nudge')).length === 1, 'it is Home’s one notice line, not an extra one');
const homeSafe = await p.textContent('.lens');
await p.click('.key-acc[data-focus="ADCB"]');
await p.waitForSelector('.key-acc[data-focus="ADCB"].on');
ok(await p.isVisible('.bnpl-row'), 'the line shows on every Home view, not only All accounts');
await p.click('.key-acc[data-focus="all"]');
await p.waitForSelector('.key-acc[data-focus="all"].on');
ok((await p.textContent('.lens')) === homeSafe, 'and it changes no number on the balance card');
await p.click('.bnpl-row');
await p.waitForSelector('.bn-plan');
const bp = await app((st, m, bn) => { const cs = st.state.settings.cycleStart; return bn.dueBeforePayday(st.getExtra('bnpl').plans, st.state.entries, m.dayKey(m.cycleBounds(m.cycleOf(new Date(), cs), cs).end)); });
ok(!bp || (await p.textContent('.bn-total')).includes(`${m0(bp)} due before payday`), 'the sheet says how much is due before payday (information only)');
await p.click('[data-bn-act="done"]');
// back to the demo's own plans and subscriptions
await app((st) => {
  st.saveExtra('bnpl', { v: 1, plans: st.getExtra('bnpl').plans.filter((x) => x.id !== 'soon') }, 'x', { undoable: false });
  st.saveExtra('recurring', null, 'x', { undoable: false });
});
await p.waitForFunction(() => !document.querySelector('.bnpl-row') && !document.querySelector('.sheet'));
await p.evaluate(async () => (await import('/js/bnpl-ui.js')).openBnpl());
await p.waitForSelector('.bn-plan');
const tabbyCard = () => p.textContent('.bn-plan[data-plan="d-tabby"]');
ok(/3 of 4 paid/.test(await tabbyCard()), 'the sheet shows each plan’s progress (3 of 4 paid)');
ok(/Found: TABBY\*NOON · AED 224\.75 · \d+ \w+/.test(await tabbyCard()), 'a paid row shows the payment it was matched to (merchant, amount, date)');
ok(/Not this payment/.test(await tabbyCard()) && !/Unlink|instalment/i.test(await tabbyCard()), 'wording: “Not this payment”, and “payment” throughout');
const small = await p.$$eval('.bn-plan [data-bn-act]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim() || e.getAttribute('aria-label'), w: r.width, h: r.height }; }).filter((x) => x.w < 44 || x.h < 44));
ok(!small.length, `Mark paid, Edit and the link buttons are at least 44 × 44${small.length ? ': ' + JSON.stringify(small) : ''}`);

// Mark paid with nothing in the ledger for it: logs one Spend, one undo step
await p.click('.bn-plan[data-plan="d-tabby"] [data-bn-act="pay"]');
await p.waitForFunction(() => document.querySelector('.bn-plan[data-plan="d-tabby"]')?.textContent.includes('4 of 4 paid'));
let c = await snap();
const added = await app((st) => st.state.entries.find((e) => e.source === 'BNPL'));
ok(c.n === a.n + 1 && added.merchant === 'Tabby · Noon' && added.category === 'Shopping' && added.account === 'ADCB', 'Mark paid logs one Spend entry “Tabby · Noon” in Shopping from ADCB');
ok(Math.abs(a.adcb - c.adcb - 224.75) < 0.001 && Math.abs(a.owed - c.owed - 224.75) < 0.001, 'ADCB goes down and what’s still to pay goes down by the same 224.75');
ok(await app((st) => st.lastAction().startsWith('Paid Tabby · Noon 4 of 4')), 'it is one undo step');
ok(await app((st) => !Object.keys(st.state.merchants).some((k) => k.includes('tabby'))), 'the payment isn’t remembered as a merchant → category pair');
// a stale toast: something else happens, then the old toast's Undo is tapped
const other = await app((st) => st.addEntry({ type: 'Spend', amount: 12, account: 'Cash', category: 'Food', merchant: 'Kiosk' }).id);
await p.click('#toast .toast-action');
c = await snap();
ok(c.n === a.n + 2 && await app((st, m, bn, id) => st.state.entries.some((e) => e.id === id), other), 'a stale “Undo” toast doesn’t undo the newer change (or its own)');
ok(/Something changed since/.test(await toastText()), 'it says the Undo is off instead');
await app((st) => st.undo());
await app((st) => st.undo());
c = await snap();
ok(c.n === a.n && Math.abs(c.adcb - a.adcb) < 0.001 && Math.abs(c.owed - a.owed) < 0.001, 'one Undo removes the payment and makes it unpaid again');
await p.waitForFunction(() => document.querySelector('.bn-plan[data-plan="d-tabby"]')?.textContent.includes('3 of 4 paid'));
ok(true, 'the open sheet follows the undo');

// a payment arrives that the app links by itself: a toast says so, with Unlink
const tabby = await planOf('d-tabby');
const found = await app((st, m, bn, d) => st.addEntry({ type: 'Spend', amount: 224.75, account: 'ADCB', category: 'Shopping', merchant: 'TABBY*NOON', source: 'Apple Pay', date: d }).id, at(dueOf(tabby, 3)));
await p.waitForFunction(() => /Linked TABBY\*NOON AED 224\.75 to Noon · 4 of 4/.test(document.getElementById('toast').textContent));
ok((await planOf('d-tabby')).paid[3]?.entry === found, 'a new matching payment is linked, and the toast says “Linked TABBY*NOON AED 224.75 to Noon · 4 of 4”');
await p.click('#toast .toast-action');
await p.waitForFunction(() => document.querySelector('.bn-plan[data-plan="d-tabby"]')?.textContent.includes('3 of 4 paid'));
let tb = await planOf('d-tabby');
ok(!tb.paid[3] && tb.skip.includes(found) && (await snap()).n === a.n + 1, 'its Unlink unlinks it (never linked back to that plan); the payment stays in Activity');

// Mark paid when a payment that's probably this one is already logged: asked first, nothing counted twice
const noon = await app((st, m, bn, d) => st.addEntry({ type: 'Spend', amount: 224.75, account: 'ADCB', category: 'Shopping', merchant: 'NOON.COM', date: d }).id, at(dueOf(tabby, 3)));
const nBefore = (await snap()).n;
await p.click('.bn-plan[data-plan="d-tabby"] [data-bn-act="pay"]');
await p.waitForSelector(sheet('[data-act="link"]'));
ok(/Link this payment \(NOON\.COM · AED 224\.75 · \d+ \w+\)/.test(await p.textContent(sheet('[data-act="link"]'))) && /Log a new payment/.test(await p.textContent(sheet('.bn-ask'))), 'Mark paid offers “Link this payment (AED x · date · merchant)” or “Log a new payment”');
await p.click(sheet('[data-act="link"]'));
await p.waitForFunction(() => document.querySelector('.bn-plan[data-plan="d-tabby"]')?.textContent.includes('4 of 4 paid'));
c = await snap();
ok(c.n === nBefore && (await planOf('d-tabby')).paid[3]?.entry === noon, 'linking it logs nothing new: the payment counts once');
await app((st) => st.undo());
ok(!(await planOf('d-tabby')).paid[3], 'and one Undo takes the link back');

// a new plan through the editor: still to pay goes up, no balance moves
a = await snap();
await p.click('[data-bn-act="new"]');
await p.waitForSelector('#bn-total');
ok(/Already paid so far/.test(await p.textContent(sheet('.bn-form'))) && /Counted as paid, not added to spending/i.test(await p.textContent(sheet('.bn-form'))), 'the editor says “Already paid so far”: counted as paid, not added to spending');
ok(await app(async (st, m) => {
  const opts = [...document.querySelectorAll('#bn-category option')];
  const want = m.pickerCategories('Spend', 'Shopping');
  return opts.length === want.length && opts.every((o, k) => o.value === want[k].id && o.textContent === want[k].label);
}), 'the category picker is pickerCategories, with each category’s label');
await p.fill('#bn-provider', 'Postpay');
await p.fill('#bn-merchant', 'Sharaf DG');
await p.fill('#bn-total', '1000');
await p.selectOption('#bn-count', '3');
const past = addDays(dayKey(new Date()), -20);
await p.fill('#bn-first', past);
ok(/2 × AED 333\.33, then AED 333\.34/.test(await p.textContent('.bn-preview')), 'the editor previews the schedule, rounding on the last payment');
await p.click(sheet('[data-act="save"]'));
await p.waitForFunction(() => document.querySelectorAll('.bn-plan').length === 3);
c = await snap();
ok(Math.abs(c.total - a.total) < 0.001 && Math.abs(c.adcb - a.adcb) < 0.001 && c.n === a.n, 'adding a plan changes no balance and logs nothing');
ok(Math.abs(c.owed - a.owed - 1000) < 0.001, 'what’s still to pay goes up by the plan’s total');
ok(await p.isVisible('.bn-plan.overdue'), 'a payment past its due day shows as overdue');

// link an existing payment by hand
const lid = await app((st) => st.addEntry({ type: 'Spend', amount: 333.33, account: 'ADCB', category: 'Shopping', merchant: 'Sharaf DG online' }).id);
await p.click('.bn-plan:has-text("Postpay") [data-bn-act="link"]');
await p.waitForSelector(`.bn-cands [data-entry="${lid}"]`);
await p.click(`.bn-cands [data-entry="${lid}"]`);
await p.waitForFunction(async (id) => { const st = await import('/js/store.js'); return st.getExtra('bnpl').plans.some((x) => x.paid[0]?.entry === id); }, lid);
let pp = (await snap()).plans.find((x) => x.provider === 'Postpay');
ok(pp.paid[0]?.entry === lid, '“Link a payment” links the chosen entry instead of logging another');

// the editor merges with the plan as it is when you tap Save, not as it was when it opened
await p.click('.bn-plan:has-text("Postpay") [data-bn-act="edit"]');
await p.waitForSelector('#bn-item');
ok(await p.isDisabled('#bn-total') && await p.isDisabled('#bn-count'), 'with a payment paid, total and number of payments are locked');
await app((st, m, bn, a2) => {
  // the app links payment 2 while the editor is open (as the auto-link does)
  const list = st.getExtra('bnpl').plans.map((x) => (x.id === a2 ? bn.withPaid(x, 1, '', m.dayKey(new Date())) : x));
  st.saveExtra('bnpl', { v: 1, plans: list }, 'x', { undoable: false });
}, pp.id);
await p.fill('#bn-item', 'TV');
await p.click(sheet('[data-act="save"]'));
await p.waitForFunction((id) => import('/js/store.js').then((st) => st.getExtra('bnpl').plans.find((x) => x.id === id)?.item === 'TV'), pp.id);
pp = await planOf(pp.id);
ok(pp.item === 'TV' && pp.paid[0]?.entry === lid && pp.paid[1]?.entry === '', 'Save keeps links made while the editor was open (paid read fresh at save time)');
ok(pp.total === 1000 && pp.count === 3, 'and the total and count are unchanged');
// a link the app makes after the edit, then Undo of the edit: only the edit is undone
await app((st, m, bn, a2) => {
  const list = st.getExtra('bnpl').plans.map((x) => (x.id === a2 ? bn.withPaid(x, 2, '', m.dayKey(new Date())) : x));
  st.saveExtra('bnpl', { v: 1, plans: list }, 'x', { undoable: false });
}, pp.id);
await app((st) => st.undo());
pp = await planOf(pp.id);
ok(pp.item === '' && pp.paid[0]?.entry === lid && pp.paid[1] && pp.paid[2], 'undoing the edit puts back only the plan’s fields; links made since stay');
// a plan with paid payments can't have its paid amounts changed even by a stale editor
await app((st, m, bn) => {
  const list = st.getExtra('bnpl').plans.map((x) => (x.id === 'd-tamara' ? { ...x, paid: x.paid.map(() => null), skip: x.paid.filter(Boolean).map((r) => r.entry) } : x));
  st.saveExtra('bnpl', { v: 1, plans: list }, 'x', { undoable: false });
});
await p.click('.bn-plan[data-plan="d-tamara"] [data-bn-act="edit"]');
await p.waitForSelector('#bn-total:not([disabled])');
await p.fill('#bn-total', '900');
await app((st, m, bn) => {
  const list = st.getExtra('bnpl').plans.map((x) => (x.id === 'd-tamara' ? bn.withPaid(x, 0, '', m.dayKey(new Date())) : x));
  st.saveExtra('bnpl', { v: 1, plans: list }, 'x', { undoable: false });
});
await p.click(sheet('[data-act="save"]'));
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 1);
const tam = await planOf('d-tamara');
ok(tam.total === 600 && tam.paid[0]?.entry === '', 'paid while the editor was open: Save keeps the total, so a paid amount never changes');

// Delete asks first and says the payments stay
await p.click('.bn-plan:has-text("Postpay") [data-bn-act="edit"]');
await p.click(sheet('[data-act="delete"]'));
ok(await p.isVisible(sheet('.bn-del')) && /stay in Activity/.test(await p.textContent(sheet('.bn-del'))) && (await snap()).plans.length === 3, 'Delete plan asks to confirm, and says the payments stay in Activity');
await p.click(sheet('[data-act="confirm-delete"]'));
await p.waitForFunction(() => document.querySelectorAll('.bn-plan').length === 2);
ok(await app((st, m, bn, id) => st.state.entries.some((e) => e.id === id), lid), 'deleted; its linked payment is still in Activity');
await p.click('#toast .toast-action');
await p.waitForFunction(() => document.querySelectorAll('.bn-plan').length === 3);
ok((await snap()).plans.find((x) => x.provider === 'Postpay').paid[0]?.entry === lid, 'its Undo brings the plan back with its links');
await p.click('[data-bn-act="done"]');

// Home: overdue in a warning tone
await app((st) => {
  const list = [...st.getExtra('bnpl').plans, { id: 'late', provider: 'Cashew', merchant: 'Ikea', item: '', category: 'Shopping', total: 400, count: 2, cadence: '2w', first: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10), account: 'ADCB', paid: [null, null], skip: [] }];
  st.saveExtra('bnpl', { v: 1, plans: list }, 'x', { undoable: false });
});
await p.waitForSelector('.bnpl-row.overdue');
ok(/Buy now, pay later: AED 200 overdue since/.test(await p.textContent('.bnpl-row')), 'Home warns when a payment is overdue');
ok((await p.$$('.lens ~ .sub-line, .lens ~ .budget-nudge')).length === 1, 'overdue outranks every other Home notice (subscriptions are back on)');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');

// Settings and Insights
await p.click('.tabbar [data-tab="settings"]');
await p.waitForSelector('#bnpl + .group [data-bnpl="open"]');
ok(/4 plans · AED [\d.,]+ still to pay/.test(await p.textContent('#bnpl + .group')), 'Settings has a Buy now, pay later row');
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.bnpl-panel');
ok(/still to pay/.test(await p.textContent('.bnpl-panel')) && (await p.$$('.bn-due-row')).length > 0, 'Insights shows what’s still to pay and this cycle’s payments');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'Insights: no sideways scroll');
ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await b.close();
console.log(`all ${n} BNPL checks passed`);
