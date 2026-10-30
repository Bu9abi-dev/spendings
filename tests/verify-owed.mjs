// Money owed: people, splits and settling up. First the pure maths (docs/js/model.js + docs/js/people.js),
// then the real app in demo mode at iPhone width.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-owed.mjs   (BASE=http://localhost:<port> for another port)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ACCOUNTS, PEOPLE_ACCOUNTS, DEFAULT_ACCOUNTS, DEFAULT_SETTINGS, setAccountList, setPeopleList, isPerson, balances, moneyTotal,
  peopleBalances, homeNumbers, whereRows, summarize, cycleOf, cycleBounds, toAED,
} from '../docs/js/model.js';
import {
  splitShares, splitPartner, splitTransfer, partnerPatch, settleUpPreset, owedText, recentPeople, withPerson, renamedPerson, peopleNames,
  balanceWords, personOf, lentFrom, settleUpTitle, rescaledPartner, splitPrices,
} from '../docs/js/people.js';
import { paymentEntry, planState, autoLink, bnplSummary } from '../docs/js/bnpl.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const near = (a, b) => Math.abs(a - b) < 0.005;
const fils = (x) => Math.round(x * 100);

/* ───── 1. People are accounts, flagged ───── */
const PEOPLE = [{ name: 'Ahmed', note: 'Person', color: 'graphite', wallet: '' }, { name: 'Sara', note: 'Person', color: 'graphite', wallet: '' }];
setAccountList([...DEFAULT_ACCOUNTS, ...PEOPLE]);
ok(ACCOUNTS.some((a) => a.id === 'Ahmed'), 'before they are flagged, a person account is just an account');
setPeopleList(['Ahmed', 'Sara']);
ok(!ACCOUNTS.some((a) => a.id === 'Ahmed' || a.id === 'Sara') && ACCOUNTS.length === 4, 'flagged people leave ACCOUNTS (balance bar, pay pickers, Where your money is)');
ok(PEOPLE_ACCOUNTS.map((a) => a.id).join() === 'Ahmed,Sara' && isPerson('Ahmed') && !isPerson('ADCB') && !isPerson(''), 'PEOPLE_ACCOUNTS holds them; isPerson knows them');
setAccountList([...DEFAULT_ACCOUNTS, ...PEOPLE]);
ok(!ACCOUNTS.some((a) => a.id === 'Ahmed') && PEOPLE_ACCOUNTS.length === 2, 'the flag survives the account list being refreshed (a sync)');

/* ───── 2. Totals, owed, allowance ───── */
const S = { ...DEFAULT_SETTINGS };
const PLAN = [
  { id: 'allowance', name: 'Allowance', kind: 'Move', amount: 3000, day: 27, from: 'ADIB', to: 'ADCB', category: '' },
];
const now = new Date('2026-11-10T12:00:00+04:00');
let id = 0;
const E = (type, amount, account, date, extra = {}) => {
  const e = { id: `o${++id}`, type, amount, currency: 'AED', account, toAccount: '', category: type === 'Spend' ? 'Food & Drinks' : '', merchant: '', note: '', source: 'App', status: 'OK', date: new Date(date).toISOString(), ...extra };
  e.cycle = cycleOf(e.date, S.cycleStart);
  e.amountAED = toAED({ ...e, amountAED: null }, S);
  return e;
};
const base = [
  E('Adjustment', 5000, 'ADIB', '2026-10-20T10:00:00+04:00'),
  E('Adjustment', 0, 'ADCB', '2026-10-20T10:00:00+04:00'),
  E('Transfer', 3000, 'ADIB', '2026-10-27T09:00:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
  E('Spend', 200, 'ADCB', '2026-11-01T20:00:00+04:00', { merchant: 'Salt' }),
];
const dinner = E('Spend', 100, 'ADCB', '2026-11-02T20:00:00+04:00', { merchant: 'Zuma' });
const sh = splitShares(100, 'half');
const splitSpend = { ...dinner, amount: sh.mine, amountAED: sh.mine };
const splitTr = { ...splitTransfer(splitSpend, 'Ahmed', sh.theirs), amountAED: sh.theirs, cycle: dinner.cycle, status: 'OK' };
const friendPaid = E('Spend', 40, 'Sara', '2026-11-03T13:00:00+04:00', { merchant: 'Shake Shack' }); // Sara paid for me
const withSplit = [...base, splitSpend, splitTr, friendPaid];
const unsplit = [...base, dinner, friendPaid];

const bals = balances(withSplit, S);
ok(bals.get('Ahmed').balance === 50 && bals.get('Sara').balance === -40, 'balances() stays complete: Ahmed +50 (owes you), Sara −40 (you owe)');
const m = homeNumbers(withSplit, PLAN, S, now);
const all = [...bals.values()].reduce((a, b) => a + b.balance, 0);
ok(near(m.total, moneyTotal(bals)) && near(m.total + 50 - 40, all), 'All your money leaves people out: your money + what is owed = every balance added up');
setPeopleList([]);
const oldTotal = homeNumbers(withSplit, PLAN, S, now).total;
setPeopleList(['Ahmed', 'Sara']);
const pb = peopleBalances(withSplit, S);
ok(near(m.total + pb.owedToYou - pb.youOwe, oldTotal), 'cash + owed to you − you owe = the old total (when people counted as accounts)');
ok(pb.owedToYou === 50 && pb.youOwe === 40 && pb.people.length === 2, 'peopleBalances: owed to you 50, you owe 40');
const rows = whereRows(m);
ok(!rows.some((r) => /Ahmed|Sara/.test(r.label)), 'Where your money is has no rows for people');
ok(rows.reduce((a, r) => a + r.shown, 0) === Math.round(m.total), 'Where your money is still adds up to the total shown');
ok(near(m.hubB.free, homeNumbers(unsplit, PLAN, S, now).hubB.free), 'Emergency money is untouched by a split or a friend paying');

const mUn = homeNumbers(unsplit, PLAN, S, now);
ok(near(m.safe, mUn.safe) && near(m.safe, 3000 - 200 - 100), 'splitting from the allowance card doesn’t change Safe to spend (your half spent + their half lent = the whole)');
ok(near(summarize(withSplit, m.cyc, S, PLAN).spent, summarize(unsplit, m.cyc, S, PLAN).spent - 50), 'spending counts only your share');
const lend = E('Transfer', 200, 'ADCB', '2026-11-05T10:00:00+04:00', { toAccount: 'Ahmed' });
const mLend = homeNumbers([...withSplit, lend], PLAN, S, now);
ok(near(mLend.safe, m.safe - 200) && near(mLend.total, m.total - 200), 'lending 200 from the allowance card uses 200 of allowance (Safe to spend and your money drop)');
const back = E('Transfer', 250, 'Ahmed', '2026-11-08T10:00:00+04:00', { toAccount: 'ADCB' });
const mBack = homeNumbers([...withSplit, lend, back], PLAN, S, now);
ok(near(mBack.safe, m.safe + 50) && near(mBack.sum.topUps, 250), 'being paid back into the allowance card is a top-up (Safe to spend goes back up)');
ok(near(peopleBalances([...withSplit, lend, back], S).owedToYou, 0), 'once paid back, Ahmed owes nothing');
const backHub = E('Transfer', 250, 'Ahmed', '2026-11-08T10:00:00+04:00', { toAccount: 'ADIB' });
const mHub = homeNumbers([...withSplit, lend, backHub], PLAN, S, now);
ok(near(mHub.safe, mLend.safe) && near(mHub.hubB.free, mLend.hubB.free + 250), 'paid back into the main account: Emergency money goes up, the allowance stays used');
const lendHub = E('Transfer', 100, 'ADIB', '2026-11-05T10:00:00+04:00', { toAccount: 'Sara' });
ok(near(homeNumbers([...withSplit, lendHub], PLAN, S, now).safe, m.safe), 'lending from the main account doesn’t touch the allowance');
// carry-over: last cycle's allowance used by a loan is gone; next cycle starts fresh
const next = homeNumbers([...withSplit, lend], PLAN, S, new Date('2026-11-28T12:00:00+04:00'));
ok(next.sum.allowanceUsed === 0 && next.cyc === '2026-12', 'Safe to spend still resets at payday');
// a removed (archived) person stays flagged, so old loans keep meaning allowance used
setAccountList([...DEFAULT_ACCOUNTS, { ...PEOPLE[0], archived: true }, PEOPLE[1]]);
ok(!ACCOUNTS.some((a) => a.id === 'Ahmed') && !PEOPLE_ACCOUNTS.some((a) => a.id === 'Ahmed') && isPerson('Ahmed'), 'a removed person is in neither list but is still a person');
ok(peopleBalances(withSplit, S).people.some((p) => p.id === 'Ahmed' && p.archived), 'a removed person who is still owed is still listed');
ok(!peopleBalances([...withSplit, E('Transfer', 50, 'Ahmed', '2026-11-09T10:00:00+04:00', { toAccount: 'ADIB' })], S).people.some((p) => p.id === 'Ahmed'), 'a removed, settled person drops out of the list');
setAccountList([...DEFAULT_ACCOUNTS, ...PEOPLE]);

/* ───── 2b. A buy-now-pay-later plan and a split in the same cycle: Home and the report agree ─────
   (the report half runs in the browser, below: report.js needs the app) */
let bnplCase;
{
  const plan = { id: 'bn-1', provider: 'Tabby', merchant: 'Noon', item: 'AirPods', category: 'Shopping', total: 900, count: 4, cadence: '2w', first: '2026-10-30', account: 'ADCB', paid: [null, null, null, null] };
  const inst = { ...E('Spend', 0, 'ADCB', '2026-10-30T10:00:00+04:00'), ...paymentEntry(plan, 0, new Date('2026-10-30T10:00:00+04:00').toISOString()), id: 'bn-pay-1', status: 'OK' };
  inst.cycle = cycleOf(inst.date, S.cycleStart); inst.amountAED = inst.amount;
  const both = [...withSplit, inst];
  const linked = autoLink([plan], both, S).plans;
  ok(planState(linked[0], both).paidCount === 1 && bnplSummary(linked, both).owed === 675, 'the plan payment links to its instalment; 675 still to pay');
  ok(!linked.some((x) => x.paid.some((r) => r && (r.entry === splitSpend.id || r.entry === splitTr.id))), 'a split dinner is never taken for a plan payment');
  const mh = homeNumbers(both, PLAN, S, now);
  ok(near(mh.total, m.total - 225), 'All your money drops by the plan payment only (what Ahmed owes is apart)');
  ok(near(mh.safe, m.safe - 225) && near(mh.safe, 3000 - 200 - 100 - 225), 'Safe to spend drops by the payment only; the plan’s remaining 675 is never taken off it');
  bnplCase = { entries: both, cyc: mh.cyc, total: mh.total, safe: mh.safe, left: mh.sum.allowanceLeft, used: mh.sum.allowanceUsed, now: now.toISOString() };
}

/* ───── 3. Split shares ───── */
ok(JSON.stringify(splitShares(100, 'half')) === '{"mine":50,"theirs":50}', 'half of 100 = 50 / 50');
ok(JSON.stringify(splitShares(100, 'third')) === '{"mine":66.67,"theirs":33.33}', 'a third of 100: they pay 33.33, you 66.67 (the leftover fil is yours)');
ok(JSON.stringify(splitShares(10.01, 'half')) === '{"mine":5.01,"theirs":5}', 'half of 10.01: the odd fil is yours');
ok(JSON.stringify(splitShares(100, { theirs: 30 })) === '{"mine":70,"theirs":30}', 'custom: their share 30 of 100');
ok(splitShares(100, { theirs: 100 }) === null && splitShares(100, { theirs: 0 }) === null && splitShares(100, { theirs: -5 }) === null && splitShares(100, { theirs: 120 }) === null, 'custom share must be more than 0 and less than the whole');
ok(splitShares(0.01, 'half') === null && splitShares(0.02, 'half').theirs === 0.01, 'too small to split gives null; 0.02 splits 0.01 / 0.01');
ok(splitShares(100, 'quarter') === null, 'an unknown part gives null');
{
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const amt = Math.round(Math.random() * 500000) / 100 + 0.02;
    for (const part of ['half', 'third', { theirs: Math.round(Math.random() * amt * 100) / 100 }]) {
      const s = splitShares(amt, part);
      if (!s) continue;
      if (fils(s.mine) + fils(s.theirs) !== fils(amt) || s.mine < s.theirs - (part === 'half' || part === 'third' ? 0 : Infinity)) bad++;
      if (Math.round(s.mine * 100) !== s.mine * 100 && Math.abs(Math.round(s.mine * 100) - s.mine * 100) > 1e-6) bad++;
    }
  }
  ok(bad === 0, '2,000 random amounts: shares always add up exactly to the fil, whole fils only, yours never smaller for half/third');
}
{
  const usd = { id: 'ap-x', type: 'Spend', amount: 33.33, currency: 'USD', account: 'ADCB', merchant: 'Netflix', category: 'Bills & Subscriptions', date: '2026-11-02T10:00:00.000Z' };
  const s = splitShares(usd.amount, 'half');
  const tr = splitTransfer({ ...usd, amount: s.mine }, 'Ahmed', s.theirs);
  ok(tr.currency === 'USD' && tr.amount === 16.66 && s.mine === 16.67 && fils(s.mine) + fils(tr.amount) === fils(33.33), 'a USD payment splits in dollars: 16.67 + 16.66 = 33.33');
  const aed = toAED({ ...usd, amount: s.mine, amountAED: null }, S) + toAED({ ...tr, amountAED: null }, S);
  ok(Math.abs(aed - toAED({ ...usd, amountAED: null }, S)) <= 0.011, 'each half priced in AED at the same rate is within a fil of the whole');
  ok(tr.id === 'ap-x-split' && tr.type === 'Transfer' && tr.account === 'ADCB' && tr.toAccount === 'Ahmed' && tr.note === 'Split: Netflix' && tr.source === 'Split' && tr.date === usd.date, 'the Transfer: same card → person, id linked, note "Split: <merchant>"');
}

/* ───── 4. Linked halves, settling up, words ───── */
ok(splitPartner(splitSpend, withSplit) === splitTr && splitPartner(splitTr, withSplit) === splitSpend && splitPartner(base[3], withSplit) === null, 'each half finds the other by id; a plain entry has none');
ok(personOf(splitTr) === 'Ahmed' && personOf(friendPaid) === 'Sara' && personOf(base[3]) === '', 'personOf: who an entry is with');
{
  const edited = { ...splitSpend, account: 'BOTIM', date: '2026-11-04T10:00:00.000Z', merchant: 'Zuma DIFC', currency: 'AED' };
  const p = partnerPatch(edited, splitTr);
  ok(p.account === 'BOTIM' && p.date === edited.date && p.note === 'Split: Zuma DIFC' && !('amount' in p), '"Change both" copies card, date and name, never the amount');
  ok(partnerPatch({ ...splitTr, account: 'Cash' }, splitSpend).account === 'Cash', 'editing their half carries the card to your half');
}
{
  // Settle up pays back into the account the money was lent from
  ok(lentFrom(withSplit, 'Ahmed', 'ADIB') === 'ADCB', 'Ahmed’s share came off the allowance card: he pays back into it');
  ok(lentFrom([...withSplit, lendHub], 'Sara', 'ADIB') === 'ADIB' && lentFrom(withSplit, 'Sara', 'ADIB') === 'ADIB', 'a loan from the main account goes back there; nothing lent (a friend paid) → the main account');
  ok(lentFrom([...withSplit, E('Transfer', 20, 'BOTIM', '2026-11-06T10:00:00+04:00', { toAccount: 'Ahmed' })], 'Ahmed', 'ADIB') === 'BOTIM', 'the latest loan decides');
  ok(lentFrom([E('Transfer', 20, 'Gone', '2026-11-06T10:00:00+04:00', { toAccount: 'Ahmed' })], 'Ahmed', 'ADIB') === 'ADIB', 'an account that’s gone falls back to the main account');
  const pre = settleUpPreset('Ahmed', 50, lentFrom(withSplit, 'Ahmed', 'ADIB'));
  const back2 = E('Transfer', pre.amount, pre.account, '2026-11-08T10:00:00+04:00', { toAccount: pre.toAccount });
  ok(near(homeNumbers([...withSplit, back2], PLAN, S, now).safe, m.safe + 50), 'settling up as offered: Safe to spend recovers what his share used');
  ok(settleUpTitle('Ahmed', 50) === 'Ahmed pays you back' && settleUpTitle('Sara', -40) === 'You pay Sara', 'the Settle up sheet says who pays whom');
}
{
  // "Change both" with a new amount keeps the bill adding up
  const r1 = rescaledPartner({ amount: 60 }, { amount: 70 }, { amount: 40 });
  ok(r1.keepsTotal && r1.amount === 30 && r1.total === 100, 'your share 60 → 70 of a 100 bill: theirs becomes 30');
  const r2 = rescaledPartner({ amount: 40 }, { amount: 150 }, { amount: 60 });
  ok(!r2.keepsTotal && r2.amount === 225 && r2.total === 375, 'more than the whole bill: the other half grows in the same proportion');
  ok(rescaledPartner({ amount: 60 }, { amount: 60 }, { amount: 40 }) === null, 'no amount change, no rescale');
  const p2 = partnerPatch({ ...splitSpend, amount: 70 }, { ...splitTr, amount: 50 }, splitSpend);
  ok(p2.amount === 30 && fils(70) + fils(p2.amount) === fils(100), 'partnerPatch carries the rescaled amount');
  // USD: halves priced so they add up to the bill in AED exactly
  const pr = splitPrices(36.77, 5, 'USD', S);
  ok(pr.theirsAED === 18.36 && fils(pr.mineAED) + fils(pr.theirsAED) === fils(36.77), 'a USD split: theirs priced at the rate, yours the rest of the bill');
  ok(splitPrices(100, 50, 'AED', S) === null, 'an AED split needs no pricing');
}
ok(JSON.stringify(settleUpPreset('Ahmed', 50, 'ADIB')) === JSON.stringify({ type: 'Transfer', amount: 50, currency: 'AED', account: 'Ahmed', toAccount: 'ADIB', merchant: 'Settle up', note: '' }), 'settle up when they owe you: from them into the main account');
ok(settleUpPreset('Sara', -40, 'ADIB').account === 'ADIB' && settleUpPreset('Sara', -40, 'ADIB').toAccount === 'Sara' && settleUpPreset('Sara', -40, 'ADIB').amount === 40, 'settle up when you owe them: from the main account to them');
ok(settleUpPreset('Sara', 0.004, 'ADIB') === null, 'nothing to settle at zero');
ok(owedText({ owedToYou: 50, youOwe: 40 }) === 'Owed to you AED 50 · You owe AED 40' && owedText({ owedToYou: 12.5, youOwe: 0 }) === 'Owed to you AED 12.50' && owedText({ owedToYou: 0, youOwe: 0 }) === '', 'the Home line leaves out a zero side, and is empty when nothing is owed');
ok(balanceWords(50).tone === 'in' && balanceWords(-40).text === 'you owe 40.00' && balanceWords(0).text === 'settled', 'balance in words');
ok(recentPeople(withSplit).map((p) => p.id).join() === 'Sara,Ahmed', 'recent first: Sara (3 Nov) before Ahmed (2 Nov)');
ok(recentPeople([]).map((p) => p.id).join() === 'Ahmed,Sara', 'no history: A–Z');
ok(JSON.stringify(withPerson({ v: 1, names: ['Ahmed'] }, 'Sara')) === '{"v":1,"names":["Ahmed","Sara"]}' && JSON.stringify(renamedPerson({ v: 1, names: ['Ahmed', 'Sara'] }, 'Sara', 'Sarah')) === '{"v":1,"names":["Ahmed","Sarah"]}', 'the people extra: add and rename');
ok(peopleNames({ names: ['A', '', 3, 'A', ' '] }).join() === 'A' && peopleNames(null).length === 0, 'the people extra is cleaned when read');
setPeopleList([]);
setAccountList(DEFAULT_ACCOUNTS);

/* ───── 5. The real app (demo, 390 px) ───── */
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const URL = process.env.APP_URL || ((process.env.BASE || 'http://localhost:8765').replace(/\/$/, '') + '/');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const ev = (fn, arg) => p.evaluate(fn, arg);
const gone = (sel) => p.waitForSelector(sel, { state: 'detached' });
const home = () => ev(async () => {
  const [st, m] = await Promise.all([import('/js/store.js'), import('/js/model.js')]);
  const x = m.homeNumbers(st.state.entries, st.state.plan, st.state.settings, new Date(), st.state.dismissed);
  return { safe: x.safe, total: x.total, spent: x.sum.spent };
});

await p.goto(`${URL}?demo=1#home`);
await p.waitForSelector('.lens');
ok(!(await p.$('.owed-line')), 'Home has no owed line while nobody owes anything');

// add a person from Settings
await p.click('.tabbar [data-tab="settings"]');
await p.waitForSelector('[data-person-new]');
await p.click('[data-person-new]');
await p.waitForSelector('#pf-name');
await p.fill('#pf-name', 'Ahmed <b>');
await p.click('.sheet [data-act="save"]');
await gone('#pf-name');
let st = await ev(async () => { const [s, m] = await Promise.all([import('/js/store.js'), import('/js/model.js')]); return { people: s.getExtra('people', null), acc: s.state.accounts.find((a) => a.name === 'Ahmed <b>'), inAccounts: m.ACCOUNTS.some((a) => a.id === 'Ahmed <b>'), label: s.lastAction() }; });
ok(st.acc && st.acc.wallet === '' && JSON.stringify(st.people) === '{"v":1,"names":["Ahmed <b>"]}', 'adding a person makes an account (no Wallet name) and flags it in the people extra');
ok(!st.inAccounts && st.label === 'Added Ahmed <b>', 'they are not one of your accounts, and it is one undo step');
ok(await p.isVisible('[data-person-edit="Ahmed <b>"]') && (await p.innerHTML('#people + .group')).includes('Ahmed &lt;b&gt;'), 'Settings → People lists them, name escaped');
ok(!(await p.$('[data-acct-edit="Ahmed <b>"]')), 'they are not in Settings → Accounts');
// rename follows through
await p.click('[data-person-edit="Ahmed <b>"]');
await p.waitForSelector('#pf-name');
await p.fill('#pf-name', 'Ahmed');
await p.click('.sheet [data-act="save"]');
await gone('#pf-name');
st = await ev(async () => { const s = await import('/js/store.js'); return { people: s.getExtra('people', null), acc: s.state.accounts.some((a) => a.name === 'Ahmed') }; });
ok(st.acc && JSON.stringify(st.people.names) === '["Ahmed"]', 'a rename follows through to the people extra');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
ok(!(await p.$('.key-acc[data-focus="Ahmed"]')) && !(await p.$('.seg[data-seg="Ahmed"]')), 'people are not in the balance bar');

// split an Apple Pay payment on the allowance card
const spend = await ev(async () => {
  const s = await import('/js/store.js');
  const e = s.state.entries.find((x) => x.type === 'Spend' && x.account === s.state.settings.allowanceAccount && x.amount > 20 && x.merchant);
  s.updateEntry(e.id, { source: 'Apple Pay', amount: 87.35 });
  return s.state.entries.find((x) => x.id === e.id);
});
const before = await home();
await ev(async (id) => { const [s, en] = await Promise.all([import('/js/store.js'), import('/js/entry.js')]); en.openEntry(s.state.entries.find((x) => x.id === id)); }, spend.id);
await p.waitForSelector('[data-act="split"]:not([hidden])');
ok(await p.$eval('[data-act="split"]', (el) => { const r = el.getBoundingClientRect(), k = document.querySelector('.sheet .keypad').getBoundingClientRect(); return !!el.closest('.keypad-wrap') && r.bottom <= k.top + 1 && r.top >= 0 && r.bottom <= innerHeight && r.height >= 44; }), '"Split with someone" sits just above the keypad, in view without scrolling');
await p.click('[data-act="split"]');
await p.waitForSelector('.split-form');
ok(await p.$eval('.people-chips [data-split-person]', (el) => el.dataset.splitPerson) === 'Ahmed' && await p.$eval('[data-part="half"]', (el) => el.classList.contains('on')), 'the split sheet offers Ahmed first, Half picked');
ok(/You pay AED 43\.68 · Ahmed owes you AED 43\.67/.test(await p.textContent('.split-sum')), 'it shows both shares, the odd fil yours');
await p.click('[data-part="third"]');
ok(/You pay AED 58\.24 · Ahmed owes you AED 29\.11/.test(await p.textContent('.split-sum')), 'a third: 58.24 + 29.11');
await p.click('[data-part="custom"]');
await p.fill('#sp-custom', '100');
ok(await p.$eval('section.sheet:last-of-type [data-act="done"]', (el) => el.classList.contains('off')), 'a custom share above the whole can’t be saved');
await p.fill('#sp-custom', '30');
ok(/You pay AED 57\.35 · Ahmed owes you AED 30\.00/.test(await p.textContent('.split-sum')), 'custom: their share 30');
await p.click('[data-part="half"]');
await p.click('section.sheet:last-of-type [data-act="done"]');
await gone('.split-form');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
ok((await p.textContent('#toast .toast-text')).trim() === 'Split · your share AED 43.68', 'a short toast: "Split · your share AED 43.68"');
st = await ev(async (id) => {
  const s = await import('/js/store.js');
  return { spend: s.state.entries.find((x) => x.id === id), tr: s.state.entries.find((x) => x.id === `${id}-split`), label: s.lastAction() };
}, spend.id);
ok(st.spend.amount === 43.68 && st.tr.amount === 43.67 && fils(st.spend.amount) + fils(st.tr.amount) === fils(87.35), 'the Spend becomes your share and the shares add up to the charge');
ok(st.tr.type === 'Transfer' && st.tr.account === spend.account && st.tr.toAccount === 'Ahmed' && st.tr.note === `Split: ${spend.merchant}` && st.tr.date === st.spend.date, 'their share is a Transfer from the same card to Ahmed, noted "Split: <merchant>"');
ok(st.spend.source === 'Apple Pay' && st.spend.category === spend.category, 'the Spend keeps its source and category');
const after = await home();
ok(near(after.safe, before.safe) && near(after.total, before.total), 'Safe to spend and All your money are unchanged by the split (the card paid the whole bill either way)');
ok(near(after.spent, before.spent - 43.67), 'this cycle’s spending counts only your share');
await p.waitForSelector('.owed-line');
ok((await p.textContent('.owed-line')).trim() === 'Owed to you AED 43.67', 'Home says "Owed to you AED 43.67"');
const NOTICES = '#view .sub-line, #view .budget-nudge';
const notices = async () => p.$$eval(NOTICES, (l) => l.map((x) => (x.classList.contains('owed-line') ? 'owed' : 'other')));
const onAll = await notices();
ok(!!(await p.$('.where .owed-line')) && onAll.length <= 1 && !onAll.includes('owed'), 'the owed line sits in "Where your money is", under the total, not as a second notice; Home keeps at most one notice line');
// looking at one account, the card isn't there: the owed line is then the one notice, at the lowest rank
await p.click('.key-acc[data-focus="BOTIM"]');
await p.waitForSelector('.lens[data-focus="BOTIM"]');
const onAcc = await notices();
ok(onAcc.length === 1 && onAcc[0] === (onAll.length ? 'other' : 'owed'), `an account lens: one notice line, the owed line only when nothing more urgent (${onAcc.join()})`);
await p.click('.key-acc[data-focus="all"]');
await p.waitForSelector('.lens[data-focus="all"]');

// the entry now says it is split, and has no second Split button
await ev(async (id) => { const [s, en] = await Promise.all([import('/js/store.js'), import('/js/entry.js')]); en.openEntry(s.state.entries.find((x) => x.id === id)); }, spend.id);
await p.waitForSelector('.split-note:not([hidden])');
ok(/Split with Ahmed · their share AED 43\.67/.test(await p.textContent('.split-note')) && await p.$eval('[data-act="split"]', (el) => el.hidden), 'a split payment says who with, and can’t be split twice');
await p.click('.sheet [data-act="cancel"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);

// People sheet and Settle up
await p.click('.owed-line');
await p.waitForSelector('.person-card[data-person="Ahmed"]');
ok(/owes you 43\.67/.test(await p.textContent('.person-card[data-person="Ahmed"]')) && /Split: /.test(await p.textContent('.person-card[data-person="Ahmed"] .pc-list')), 'the People sheet shows Ahmed’s balance and the split');
await p.click('[data-settle="Ahmed"]');
await p.waitForSelector('.sheet[data-type="Transfer"]');
ok(await p.$eval('.sheet [data-role="account"] [data-acc="Ahmed"]', (el) => el.classList.contains('on')) && await p.$eval('.sheet [data-role="toAccount"] [data-acc="ADCB"]', (el) => el.classList.contains('on')), 'Settle up opens a Transfer from Ahmed back into the card his share was paid from (the allowance card)');
ok((await p.textContent('.sheet .sheet-title')).trim() === 'Ahmed pays you back', 'the Settle up sheet is titled "Ahmed pays you back"');
ok((await p.textContent('.sheet .amount')).replace(/\s/g, '') === '43.67', 'pre-filled with what he owes');
ok(/People/.test(await p.textContent('.sheet [data-role="toAccount"]')), 'Transfers show people in their own group');
await p.click('.sheet .save-btn');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
await p.waitForFunction(() => !document.querySelector('.owed-line'));
ok(true, 'settled: the Home line goes away');
const settled = await home();
ok(near(settled.total, before.total + 43.67), 'his money back: All your money goes up by what he owed');
ok(near(settled.safe, before.safe + 43.67), 'paid back into the allowance card: Safe to spend recovers his share');

// undo the settle-up, then undo the split: both halves come back as they were
await ev(async () => (await import('/js/store.js')).undo());
await p.waitForSelector('.owed-line');
await ev(async () => (await import('/js/store.js')).undo());
await p.waitForFunction(() => !document.querySelector('.owed-line'));
st = await ev(async (id) => { const s = await import('/js/store.js'); return { spend: s.state.entries.find((x) => x.id === id), tr: s.state.entries.find((x) => x.id === `${id}-split`) }; }, spend.id);
ok(st.spend.amount === 87.35 && !st.tr, 'one undo restores the whole payment and removes their share');

// a new person from the split sheet; a friend who paid; remove blocked while owed
await ev(async (id) => { const [s, en] = await Promise.all([import('/js/store.js'), import('/js/entry.js')]); en.openEntry(s.state.entries.find((x) => x.id === id)); }, spend.id);
await p.click('[data-act="split"]');
await p.waitForSelector('.split-form');
await p.click('[data-act="new-person"]');
await p.fill('#np-name', 'Sara');
await p.click('[data-act="add-new"]');
await p.waitForSelector('[data-split-person="Sara"].on');
ok(await ev(async () => { const [s, m] = await Promise.all([import('/js/store.js'), import('/js/model.js')]); return m.isPerson('Sara') && s.state.accounts.some((a) => a.name === 'Sara'); }), '"+ New" in the split sheet adds a person and picks them');
await p.click('section.sheet:last-of-type [data-act="done"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
await ev(async () => (await import('/js/entry.js')).openEntry(null, { type: 'Spend', amount: 25 }));
await p.waitForSelector('.sheet[data-type="Spend"]');
ok(/People · a friend paid/.test(await p.textContent('.sheet [data-role="account"]')), 'a Spend can be marked as paid by a friend');
await p.click('.sheet [data-role="account"] [data-acc="Ahmed"]');
ok(await p.$eval('[data-act="split"]', (el) => el.hidden), 'no Split on a payment a friend made');
await p.click('.sheet [data-cat]');
await p.click('.sheet .save-btn');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
await p.waitForSelector('.owed-line');
ok(/^Owed to you AED 43\.67 · You owe AED 25$/.test((await p.textContent('.owed-line')).trim()), 'Home: "Owed to you AED 43.67 · You owe AED 25"');
await ev(async () => (await import('/js/entry.js')).openEntry(null, { type: 'Income', amount: 5 }));
await p.waitForSelector('.sheet[data-type="Income"]');
ok(!(await p.$('.sheet [data-role="account"] .person-chip')), 'money in never offers people');
await p.click('.sheet [data-act="cancel"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
await p.click('.tabbar [data-tab="settings"]');
await p.waitForSelector('[data-person-edit="Sara"]');
await p.click('[data-person-edit="Sara"]');
await p.waitForSelector('#pf-name');
ok(!(await p.$('.sheet [data-act="remove"]')) && /Settle up first/.test(await p.textContent('.sheet .acct-danger')), 'removing someone who still owes is blocked: settle up first');
await p.click('.sheet [data-act="cancel"]');
await gone('#pf-name');
ok(await ev(async () => !!(await import('/js/people-ui.js')).removePerson('Sara').error), 'removePerson refuses at a non-zero balance');
ok(await ev(async () => !(await import('/js/people-ui.js')).addPerson('ADCB').name), 'a person can’t take an account’s name');

// deleting one half asks about the other
await ev(async (id) => { const [s, en] = await Promise.all([import('/js/store.js'), import('/js/entry.js')]); en.openEntry(s.state.entries.find((x) => x.id === id)); }, spend.id);
await p.waitForSelector('.sheet [data-act="delete"]');
await p.click('.sheet [data-act="delete"]');
await p.waitForSelector('.linked-btn[data-act="both"]');
ok(/split with <b>Sara<\/b>/.test(await p.innerHTML('.reset-lede')), 'deleting half of a split asks about the other half');
await p.click('.linked-btn[data-act="both"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
st = await ev(async (id) => { const s = await import('/js/store.js'); return [!!s.state.entries.find((x) => x.id === id), !!s.state.entries.find((x) => x.id === `${id}-split`)]; }, spend.id);
ok(!st[0] && !st[1], '"Delete both" removes both halves');
await ev(async () => (await import('/js/store.js')).undo());
st = await ev(async (id) => { const s = await import('/js/store.js'); return [!!s.state.entries.find((x) => x.id === id), !!s.state.entries.find((x) => x.id === `${id}-split`)]; }, spend.id);
ok(st[0] && st[1], 'one undo brings both halves back');
// editing the date of their half offers to move both
await ev(async (id) => { const [s, en] = await Promise.all([import('/js/store.js'), import('/js/entry.js')]); en.openEntry(s.state.entries.find((x) => x.id === `${id}-split`)); }, spend.id);
await p.waitForSelector('.split-note:not([hidden])');
await p.fill('.sheet input[name="date"]', '2026-11-01T09:30');
await p.click('.sheet .save-btn');
await p.click('.linked-btn[data-act="both"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
st = await ev(async (id) => { const s = await import('/js/store.js'); return [s.state.entries.find((x) => x.id === id).date, s.state.entries.find((x) => x.id === `${id}-split`).date]; }, spend.id);
ok(st[0] === st[1] && st[0] === new Date('2026-11-01T09:30:00+04:00').toISOString(), '"Change both" moves both halves to the new date');

// "Change both" with a new amount: the bill still adds up (your share 43.68 → 60 of 87.35, Sara's becomes 27.35)
await ev(async (id) => { const [s, en] = await Promise.all([import('/js/store.js'), import('/js/entry.js')]); en.openEntry(s.state.entries.find((x) => x.id === id)); }, spend.id);
await p.waitForSelector('.split-note:not([hidden])');
for (let i = 0; i < 6; i++) await p.click('.sheet [data-key="del"]');
for (const k of ['6', '0']) await p.click(`.sheet [data-key="${k}"]`);
await p.click('.sheet .save-btn');
await p.waitForSelector('.linked-btn[data-act="both"]');
ok(/keeps the bill at AED 87\.35: Sara’s share becomes AED 27\.35/.test(await p.textContent('.reset-body')), 'it says what "Change both" does: the bill stays AED 87.35, Sara’s share becomes 27.35');
await p.click('.linked-btn[data-act="both"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
st = await ev(async (id) => { const s = await import('/js/store.js'); return [s.state.entries.find((x) => x.id === id).amount, s.state.entries.find((x) => x.id === `${id}-split`).amount]; }, spend.id);
ok(st[0] === 60 && st[1] === 27.35, '"Change both" with a new amount: 60 + 27.35 = the 87.35 the card was charged');
await ev(async () => (await import('/js/store.js')).undo());
st = await ev(async (id) => { const s = await import('/js/store.js'); return [s.state.entries.find((x) => x.id === id).amount, s.state.entries.find((x) => x.id === `${id}-split`).amount]; }, spend.id);
ok(st[0] === 43.68 && st[1] === 43.67, 'one undo puts both amounts back');

// bulk delete in Activity takes the other half too, as one undo step
await p.click('.tabbar [data-tab="activity"]');
await p.waitForSelector('[data-act="select"]');
await ev(async (id) => { const a = await import('/js/activity.js'); a.startSelect(); a.toggleSelected(id); a.openBulkDelete(() => {}); }, spend.id);
await p.waitForSelector('.split-warn');
ok(/Delete 2 entries/.test(await p.textContent('.sheet [data-act="confirm"]')) && /other half of a split payment/.test(await p.textContent('.split-warn')), 'ticking one half: the delete sheet includes the other half and says so');
await p.click('.sheet [data-act="confirm"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
st = await ev(async (id) => { const s = await import('/js/store.js'); return [!!s.state.entries.find((x) => x.id === id), !!s.state.entries.find((x) => x.id === `${id}-split`), s.lastAction()]; }, spend.id);
ok(!st[0] && !st[1] && st[2] === 'Deleted 2 entries', 'bulk delete removed both halves in one step');
await ev(async () => (await import('/js/store.js')).undo());
st = await ev(async (id) => { const s = await import('/js/store.js'); return [!!s.state.entries.find((x) => x.id === id), !!s.state.entries.find((x) => x.id === `${id}-split`)]; }, spend.id);
ok(st[0] && st[1], 'one undo brings both back');
await ev(async () => (await import('/js/activity.js')).endSelect());

// a buy-now-pay-later plan is paid from your own accounts, never a person
await ev(async () => (await import('/js/bnpl-ui.js')).openPlanEditor(null));
await p.waitForSelector('#bn-account');
let opts = await p.$$eval('#bn-account option', (l) => l.map((o) => o.value));
ok(!opts.includes('Ahmed') && !opts.includes('Sara') && opts.includes('ADCB'), `the plan's "Paid from" lists only your accounts (${opts.join(', ')})`);
await p.click('.sheet [data-act="cancel"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
await ev(async () => (await import('/js/bnpl-ui.js')).openPlanEditor({ id: 'bn-x', provider: 'Tabby', merchant: 'Noon', item: '', category: 'Shopping', total: 400, count: 4, cadence: '2w', first: '2026-11-01', account: 'Ahmed', paid: [], skip: [] }));
await p.waitForSelector('#bn-account');
opts = await p.$$eval('#bn-account option', (l) => l.map((o) => o.value));
ok(!opts.includes('Ahmed') && await p.$eval('#bn-account', (el) => el.value) === 'ADCB', 'a plan saved with a person as its account offers the allowance card instead');
await p.click('.sheet [data-act="cancel"]');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);

// the monthly report: total leaves people out, one line says what is owed
ok(await ev(async () => {
  const [s, m, rp] = await Promise.all([import('/js/store.js'), import('/js/model.js'), import('/js/report.js')]);
  const cyc = m.cycleOf(new Date(), s.state.settings.cycleStart);
  const r = rp.cycleReport(s.state.entries, cyc, s.state.settings, s.state.plan, null);
  const h = rp.reportHTML(r, s.state.settings);
  return !r.accounts.some((a) => m.isPerson(a.id)) && r.youOwe === 25 && /You owe AED 25/.test(h);
}), 'the report total leaves people out and adds an "Owed to you / You owe" line');

await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.owed-line');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');
const tap = await p.$eval('.owed-line', (el) => el.getBoundingClientRect().height);
ok(tap >= 44, `the Home line is a comfortable tap target (${Math.round(tap)}px)`);

// the same cycle with a buy-now-pay-later payment and a split: the report agrees with Home (numbers from part 2b)
ok(await ev(async (c) => {
  const [m, rp] = await Promise.all([import('/js/model.js'), import('/js/report.js')]);
  const was = [...m.PEOPLE_ACCOUNTS.map((a) => a.id)];
  m.setPeopleList(['Ahmed', 'Sara']);
  const S = { ...m.DEFAULT_SETTINGS };
  const PLAN = [{ id: 'allowance', name: 'Allowance', kind: 'Move', amount: 3000, day: 27, from: 'ADIB', to: 'ADCB', category: '' }];
  const r = rp.cycleReport(c.entries, c.cyc, S, PLAN, null, new Date(c.now));
  const h = m.homeNumbers(c.entries, PLAN, S, new Date(c.now));
  m.setPeopleList(was);
  const near = (a, b) => Math.abs(a - b) < 0.005;
  return near(r.totalMoney, c.total) && near(h.total, c.total) && near(h.safe, c.safe) && near(r.allowance.left, c.left) && near(r.allowance.used, c.used)
    && near(r.allowance.used, 200 + 50 + 50 + 225) && near(r.spent, 200 + 50 + 40 + 225) && near(r.owedToYou, 50) && near(r.youOwe, 40);
}, bnplCase), 'a plan payment and a split in one cycle: Home total, Safe to spend and the report agree (allowance used 525, spent 515, owed apart)');
ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

/* ───── 6. Not demo: what goes to the sheet (USD split prices, the Settings hint) ───── */
const p2 = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true })).newPage();
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto(`${URL}?notour=1#home`); // ?notour: a fresh phone would open the setup guide
await p2.waitForSelector('.lens');
const usd = await p2.evaluate(async () => {
  const [s, pu] = await Promise.all([import('/js/store.js'), import('/js/people-ui.js')]);
  pu.addPerson('Ahmed');
  const e = s.addEntry({ type: 'Spend', amount: 10.01, currency: 'USD', account: 'ADCB', category: 'Shopping', merchant: 'Amazon', source: 'Apple Pay' });
  s.state.outbox.length = 0; // as if sent
  return e;
});
await p2.evaluate(async (id) => { const [s, en] = await Promise.all([import('/js/store.js'), import('/js/entry.js')]); en.openEntry(s.state.entries.find((x) => x.id === id)); }, usd.id);
await p2.waitForSelector('[data-act="split"]:not([hidden])');
await p2.click('[data-act="split"]');
await p2.waitForSelector('.split-form');
await p2.click('section.sheet:last-of-type [data-act="done"]');
await p2.waitForFunction(() => document.querySelectorAll('.sheet').length === 0);
st = await p2.evaluate(async (id) => {
  const s = await import('/js/store.js');
  const mine = s.state.entries.find((x) => x.id === id), theirs = s.state.entries.find((x) => x.id === `${id}-split`);
  const up = s.state.outbox.find((o) => o.op === 'update' && o.id === id), add = s.state.outbox.find((o) => o.op === 'add' && o.id === `${id}-split`);
  return { mine: mine.amountAED, theirs: theirs.amountAED, upAED: up?.fields.amountAED, addAED: add?.entry.amountAED };
}, usd.id);
ok(fils(st.mine) + fils(st.theirs) === fils(usd.amountAED) && st.theirs === 18.36, `a USD split: the halves (AED ${st.mine} + ${st.theirs}) add up to the bill’s AED ${usd.amountAED}`);
ok(st.upAED === st.mine && st.addAED === st.theirs, 'both prices go to the sheet: the edit of your half and the add of theirs carry amountAED');
st = await p2.evaluate(async (id) => {
  const s = await import('/js/store.js');
  s.state.outbox.length = 0;
  s.updateEntry(id, { category: 'Travel' });
  const plain = s.state.outbox.at(-1).fields;
  s.updateEntry(id, { amount: 6 });
  const repriced = s.state.outbox.at(-1).fields;
  return { plain: 'amountAED' in plain, repriced: 'amountAED' in repriced, aed: s.state.entries.find((x) => x.id === id).amountAED };
}, usd.id);
ok(!st.plain && !st.repriced && st.aed === 22.04, 'a normal edit or a new amount still sends no price (the sheet reprices it), and the app reprices at the rate');
await p2.evaluate(async () => { const s = await import('/js/store.js'); s.state.extrasUnsent = ['people']; });
await p2.click('.tabbar [data-tab="settings"]');
await p2.waitForSelector('[data-person-edit="Ahmed"]');
ok(/makes Apple Pay card matching ignore people/.test(await p2.textContent('#people ~ .group-foot')), 'while extras are phone-only and people exist, Settings says the script update makes card matching ignore people');
ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await b.close();
console.log(`all ${n} owed checks passed`);
