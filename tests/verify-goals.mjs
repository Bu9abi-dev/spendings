// Savings goals and net worth (docs/js/goals.js + goals-ui.js).
// Part 1: pure maths in Node. Part 2: the app in demo mode at iPhone size (add a goal and an
// investment, see the cards, undo).
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-goals.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  readGoals, readInvestments, investmentsTotal, totalMoney, bnplOwed, netWorth, goalProgress, cyclesUntil, dateLabel,
} from '../docs/js/goals.js';

const require = createRequire(import.meta.url);
const BASE = process.env.BASE || 'http://localhost:8765';
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; console.log('PASS ', msg); };

/* ── 1. Maths ── */
const now = new Date('2026-10-30T12:00:00+04:00'); // cycle 2026-11 (27 Oct → 26 Nov)
const bals = new Map([['Wio', { balance: 1500 }], ['ADIB', { balance: 500 }], ['Neg', { balance: -300 }]]);
const goal = (o) => ({ id: 'g', name: 'Trip', target: 5000, date: '', accounts: [], manual: 0, ...o });

eq(readGoals(null), [], 'null extra is no goals');
eq(readGoals([{ name: 'x', target: 5 }]), [], 'array shape (old test data) is no goals');
eq(readGoals({ v: 2, goals: [{ name: 'x', target: 5 }] }), [], 'other version is no goals');
eq(readGoals('junk'), [], 'string is no goals');
eq(readGoals({ v: 1, goals: [null, 7, { name: '', target: 5 }, { name: 'a', target: 0 }, { name: 'a', target: 'x' }, { name: ' Ok ', target: '250', accounts: ['Wio', 3], date: 'nope' }] }).map((g) => [g.name, g.target, g.accounts, g.date]),
  [['Ok', 250, ['Wio'], '']], 'junk goals dropped, good one cleaned');
eq(readInvestments([1]), [], 'array investments is empty');
eq(readInvestments({ v: 1, items: [{ name: 'Fund', value: '1200.5', asOf: '2026-10-01' }, { name: 'Bad', value: 'x' }, 4] }).length, 1, 'junk investments dropped');
ok(investmentsTotal(readInvestments({ v: 1, items: [{ name: 'a', value: 100.1 }, { name: 'b', value: 200.2 }] })) === 300.3, 'investments total rounds cleanly');

let p = goalProgress(goal({ accounts: ['Wio', 'ADIB'] }), bals, now);
ok(p.saved === 2000 && p.pct === 0.4 && p.toGo === 3000 && !p.done, 'progress is the sum of the chosen accounts');
p = goalProgress(goal({ accounts: ['Wio'], target: 1000 }), bals, now);
ok(p.pct === 1 && p.done && p.toGo === 0 && p.saved === 1500, 'over target caps at 100% and nothing to go');
p = goalProgress(goal({ accounts: ['Neg'] }), bals, now);
ok(p.pct === 0 && p.toGo === 5300 && p.saved === -300, 'negative balance shows 0% and the real gap');
p = goalProgress(goal({ accounts: ['Gone'] }), bals, now);
ok(p.saved === 0 && p.pct === 0, 'a missing account counts as zero');
p = goalProgress(goal({ manual: 1250 }), bals, now);
ok(p.saved === 1250 && p.pct === 0.25 && !p.byAccounts, 'manual set-aside amount');
p = goalProgress(goal({ manual: 99, accounts: ['ADIB'] }), bals, now);
ok(p.saved === 500, 'accounts win over the manual amount');

eq(cyclesUntil('2026-11-10', now), 1, 'date later in this cycle is 1 cycle');
eq(cyclesUntil('2026-11-26', now), 1, 'last day of this cycle is 1 cycle');
eq(cyclesUntil('2026-11-27', now), 2, 'next payday starts a second cycle');
eq(cyclesUntil('2027-01-15', now), 3, 'mid January is 3 cycles (Nov, Dec, Jan)');
eq(cyclesUntil('2026-10-29', now), 0, 'a past date is 0');
eq(cyclesUntil('2026-10-30', now), 1, 'today still counts');
eq(cyclesUntil('', now), 0, 'no date is 0');
p = goalProgress(goal({ accounts: ['Wio', 'ADIB'], date: '2027-01-15' }), bals, now);
ok(p.perCycle === 1000 && p.cycles === 3, 'AED 3000 to go over 3 cycles is 1000 each');
p = goalProgress(goal({ manual: 4000, date: '2027-01-15' }), bals, now);
ok(p.perCycle === 334, 'per-cycle rounds up so the goal is met (1000/3 -> 334)');
p = goalProgress(goal({ manual: 100, date: '2026-10-01' }), bals, now);
ok(p.pastDue && p.perCycle === 0, 'past date: flagged, no per-cycle figure');
p = goalProgress(goal({ accounts: ['Wio'], target: 1000, date: '2026-10-01' }), bals, now);
ok(p.done && !p.pastDue && p.perCycle === 0, 'a reached goal is never late');
p = goalProgress(goal({ manual: 0 }), bals, now);
ok(p.perCycle === 0 && p.toGo === 5000, 'no date: no per-cycle figure');
eq(goalProgress(goal({ manual: 100, date: '2026-11-20' }), bals, new Date('2026-11-27T01:00:00+04:00')).cycles, 0, 'after the date, in the next cycle, is passed');

eq(bnplOwed(null), 0, 'no bnpl extra is 0 owed');
eq(bnplOwed([1, 2]), 0, 'array bnpl is 0 owed');
eq(bnplOwed({ v: 1, plans: [{ instalments: [{ amount: 100, paid: true }, { amount: 100 }, { amount: '50.5' }] }, { remaining: 20 }, null, 'x'] }), 170.5, 'bnpl owed sums unpaid instalments');
eq(bnplOwed({ v: 1, plans: 'x' }), 0, 'bnpl junk plans is 0');
eq(totalMoney(bals), 1700, 'total money sums every account');
eq(netWorth({ money: 1700, investments: 300, owed: 170.5 }), 1829.5, 'net worth = money + investments - owed');
eq(netWorth({ money: -50, investments: 0, owed: 0 }), -50, 'net worth can be negative');
eq(dateLabel('2026-12-05'), '5 Dec 2026', 'date label');
eq(dateLabel('junk'), '', 'bad date label is empty');

/* ── 2. The app ── */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', deviceScaleFactor: 2 });
const pg = await c.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(`${BASE}/?demo=1#insights`);
await pg.waitForSelector('#networth-card');
const nwText = async () => +(await pg.getAttribute('.nw-total', 'data-nw'));
const money0 = await nwText();
ok(await pg.locator('#goals-card').isVisible(), 'Goals card shows with no goals yet');
ok((await pg.locator('#goals-card [data-goal-new]').textContent()).includes('Set a goal'), 'empty Goals card offers to set a goal');

// add a hand-set goal from the card
await pg.click('#goals-card [data-goal-new]');
await pg.waitForSelector('#gf-name');
await pg.fill('#gf-name', 'Holiday <b>');
await pg.fill('#gf-target', '9,000');
await pg.fill('#gf-date', '2027-03-15');
ok(await pg.locator('#gf-manual-wrap').isVisible(), 'set-aside field shows while no account is picked');
await pg.fill('#gf-manual', '1000');
await pg.click('.sheet [data-act="save"]');
await pg.waitForSelector('.gl-row');
const row = pg.locator('.gl-row').first();
const rt = await row.innerText();
ok(rt.includes('Holiday <b>') && !(await row.locator('b b').count()), 'goal name is escaped, not injected');
ok(rt.includes('AED 8,000 to go'), 'shows AED 8,000 to go');
ok(/Save AED [\d,]+ per cycle to make 15 Mar 2027/.test(rt), 'shows per-cycle saving for the date');
ok(rt.includes('11%'), 'shows 11% (1000 of 9000)');

// edit it to follow an account
await pg.click('.tabbar [data-tab="settings"]');
await pg.waitForSelector('[data-goal-edit]');
await pg.click('[data-goal-edit]');
await pg.waitForSelector('#gf-name');
await pg.click('#gf-accts [data-pick="ADIB"]');
ok(!(await pg.locator('#gf-manual-wrap').isVisible()), 'set-aside field hides once an account is picked');
await pg.click('.sheet [data-act="save"]');
await pg.waitForSelector('.sheet', { state: 'detached' });
await pg.click('.tabbar [data-tab="insights"]');
await pg.waitForSelector('.gl-row');
const rt2 = await pg.locator('.gl-row').first().innerText();
ok(rt2.includes('of AED 9,000') && !rt2.includes('set aside'), 'goal now follows the account balance');

// investment from Settings
await pg.click('.tabbar [data-tab="settings"]');
await pg.waitForSelector('[data-invest-new]');
await pg.click('[data-invest-new]');
await pg.waitForSelector('#if-name');
await pg.fill('#if-name', 'Brokerage');
await pg.fill('#if-value', '12000');
await pg.fill('#if-date', '2026-10-20');
await pg.click('.sheet [data-act="save"]');
await pg.waitForSelector('[data-invest-edit]');
await pg.click('.tabbar [data-tab="insights"]');
await pg.waitForSelector('#networth-card .nw-row:nth-child(2)');
ok((await nwText()) === money0 + 12000, 'net worth rose by the investment value');
const nwr = await pg.locator('#networth-card').innerText();
ok(nwr.includes('Brokerage') && nwr.includes('as of 20 Oct 2026'), 'investment listed with its date');

// BNPL extra is subtracted when present, ignored when junk
await pg.evaluate(async () => { const s = await import('/js/store.js'); s.saveExtra('bnpl', { v: 1, plans: [{ instalments: [{ amount: 300 }, { amount: 200, paid: true }] }] }, 'Test bnpl'); });
await pg.waitForFunction((v) => +document.querySelector('.nw-total').dataset.nw === v, money0 + 12000 - 300);
ok(true, 'unpaid BNPL instalments reduce net worth');
await pg.evaluate(async () => { const s = await import('/js/store.js'); s.saveExtra('bnpl', [1, 2], 'Test bnpl junk'); });
await pg.waitForFunction((v) => +document.querySelector('.nw-total').dataset.nw === v, money0 + 12000);
ok(true, 'junk BNPL extra is ignored');

// delete the investment, then undo it from the toast
await pg.click('.tabbar [data-tab="settings"]');
await pg.waitForSelector('[data-invest-edit]');
await pg.click('[data-invest-edit]');
await pg.waitForSelector('#if-name');
await pg.click('.sheet [data-act="remove"]');
await pg.waitForSelector('.sheet', { state: 'detached' });
ok((await pg.locator('[data-invest-edit]').count()) === 0, 'investment deleted');
await pg.click('.toast-action');
await pg.waitForSelector('[data-invest-edit]');
ok(true, 'undo from the toast brings the investment back');

// undo walks the goal back out
const goalsLeft = async () => pg.evaluate(async () => { const s = await import('/js/store.js'); const g = s.getExtra('goals', null); return Array.isArray(g?.goals) ? g.goals.length : 0; });
ok((await goalsLeft()) === 1, 'one goal saved');
await pg.evaluate(async () => { const s = await import('/js/store.js'); while (s.canUndo() && (s.getExtra('goals', null)?.goals || []).length) s.undo(); });
ok((await goalsLeft()) === 0, 'undo takes the goal away again');
await pg.click('.tabbar [data-tab="insights"]');
await pg.waitForSelector('#goals-card');
ok((await pg.locator('.gl-row').count()) === 0, 'Goals card is empty again');

// an array under `goals` (what verify-extras writes) must not break the screen
await pg.evaluate(async () => { const s = await import('/js/store.js'); s.saveExtra('goals', [{ category: 'x', limit: 5 }], 'junk'); });
await pg.waitForSelector('#goals-card');
ok((await pg.locator('.gl-row').count()) === 0, 'array-shaped goals extra renders as empty');

ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll at phone width');
ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await b.close();
console.log(`\n${n} checks passed`);
