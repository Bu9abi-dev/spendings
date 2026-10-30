// The monthly report (docs/js/report.js).
// Checks the numbers on hand-made entries (transfers aren't spending, refunds come back, shops group
// whatever their capitals, total money at the cycle's end), the per-cycle CSV, and the report sheet
// in the app at iPhone size: opens from Insights and Settings, steps cycles, prints, exports.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-report.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = 'http://localhost:8765/';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const near = (a, b) => Math.abs(a - b) < 0.005;

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', deviceScaleFactor: 2 });
const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(BASE + '?demo=1#insights');
await p.waitForSelector('.cycle-switch');

/* ── 1. The numbers, on entries made here (cycle 2026-10 = 27 Sep → 26 Oct, Dubai time) ── */
const r = await p.evaluate(async () => {
  const { cycleReport, cycleCSV } = await import('/js/report.js');
  const { DEFAULT_SETTINGS, cycleOf } = await import('/js/model.js');
  const S = { ...DEFAULT_SETTINGS };
  let i = 0;
  const E = (type, amount, account, date, x = {}) => {
    const e = { id: `r${++i}`, type, amount, currency: 'AED', account, toAccount: '', category: '', merchant: '', note: '', source: 'App', status: 'OK', date: new Date(date).toISOString(), ...x };
    e.cycle = cycleOf(e.date, S.cycleStart);
    return e;
  };
  const entries = [
    E('Income', 5000, 'ADIB', '2026-09-20T10:00:00+04:00', { category: 'Salary' }), // last cycle
    E('Spend', 100, 'ADCB', '2026-09-22T10:00:00+04:00', { category: 'Groceries', merchant: 'Lulu' }), // last cycle
    E('Income', 6000, 'ADIB', '2026-09-27T09:00:00+04:00', { category: 'Salary' }),
    E('Transfer', 3000, 'ADIB', '2026-09-27T09:05:00+04:00', { toAccount: 'ADCB', source: 'Plan:allowance' }),
    E('Spend', 200, 'ADCB', '2026-09-28T12:00:00+04:00', { category: 'Groceries', merchant: 'CARREFOUR  City Centre' }),
    E('Spend', 50.5, 'ADCB', '2026-10-02T12:00:00+04:00', { category: 'Groceries', merchant: 'Carrefour City Centre' }),
    E('Spend', 80, 'ADCB', '2026-10-03T12:00:00+04:00', { category: 'Food & Drinks', merchant: 'Shake Shack' }),
    E('Income', 30, 'ADCB', '2026-10-04T12:00:00+04:00', { category: 'Refund', merchant: 'Shake Shack' }),
    E('Spend', 40, 'BOTIM', '2026-10-05T12:00:00+04:00', { category: '', merchant: 'Mystery', status: 'Review' }),
    E('Adjustment', -10, 'Cash', '2026-10-06T12:00:00+04:00'),
    E('Spend', 999, 'ADIB', '2026-10-27T00:30:00+04:00', { category: 'Shopping', merchant: 'Next cycle' }), // next cycle
  ];
  const rep = cycleReport(entries, '2026-10', S, [], { Groceries: 300, Shopping: { limit: 100 }, Bad: 'x' }, new Date('2026-11-05T10:00:00+04:00'));
  const csv = cycleCSV(entries, '2026-10');
  return { ...rep, start: 0, end: 0, asOf: 0, biggest: rep.biggest.map((e) => e.id), csvLines: csv.split('\n').length, csvHead: csv.split('\n')[0], csvHasNext: csv.includes('Next cycle') };
});
ok(near(r.income, 6000), 'money in counts salary only (refund kept apart, last cycle excluded)');
ok(near(r.spent, 370.5) && near(r.refunds, 30) && near(r.netSpent, 340.5), 'spent 370.50, minus 30 refund = 340.50; the 3,000 transfer is not spending');
ok(near(r.saved, 6000 - 340.5), 'kept = money in − spent after refunds');
ok(near(r.moved, 3000) && r.moves === 1, 'the allowance move is listed apart as a move between accounts');
ok(r.merchants[0].name.startsWith('CARREFOUR') && r.merchants[0].count === 2 && near(r.merchants[0].value, 250.5), 'shops group whatever their capitals or spacing');
ok(r.categories[0].id === 'Groceries' && near(r.categories[0].prev, 100), 'categories biggest first, with last cycle alongside');
ok(r.categories.some((x) => x.id === 'Uncategorised') && r.review === 1, 'uncategorised spending and the review count show');
ok(near(r.allowance.used, 300.5) && near(r.allowance.left, 3000 - 300.5), 'allowance: ADCB spend minus the refund, against 3,000');
// end-of-cycle total: 5000 − 100 + 6000 − 370.5 + 30 − 10 (bank match); the next-cycle 999 not yet
ok(near(r.totalMoney, 5000 - 100 + 6000 - 370.5 + 30 - 10) && !r.isCurrent, 'total money is as of the end of the cycle (later entries ignored)');
ok(r.budgets.length === 2 && r.budgets.find((x) => x.id === 'Shopping').limit === 100 && r.budgets.find((x) => x.id === 'Groceries').spent === 250.5, 'budgets read as numbers or { limit }; junk ignored');
ok(r.count === 7, 'entry count leaves out bank matches');
ok(r.csvLines === 9 && r.csvHead.startsWith('id,date,cycle') && !r.csvHasNext, 'CSV holds just that cycle (8 entries incl. the bank match) under the usual header');

/* ── 2. The sheet in the app (demo data) ── */
const reportBtn = '.report-link [data-act="report"]';
ok(await p.isVisible(reportBtn), 'Insights shows a report link');
await p.click('[data-cyc="-1"]');
const shownCycle = await p.textContent('.cycle-switch .cs-label b');
await p.click(reportBtn);
await p.waitForSelector('.sheet .rp-page');
ok((await p.textContent('.report-switch .cs-label b')) === shownCycle, 'the report opens on the cycle Insights was showing');
ok(await p.isEnabled('[data-rcyc="1"]'), 'a past cycle can step forward');
await p.click('[data-rcyc="1"]');
ok(await p.isDisabled('[data-rcyc="1"]'), 'cannot step past the current cycle');
ok(/still running/.test(await p.textContent('.rp-page')), 'the current cycle says its numbers are so far');
const overflow = await p.evaluate(() => { const s = document.querySelector('.report-scroll'); return s.scrollWidth - s.clientWidth; });
ok(overflow <= 1, 'the report fits the iPhone width (no sideways scroll)');
await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/report-sheet.png` : '/tmp/report-sheet.png' });

// Save as PDF prints only the report
await p.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { only: getComputedStyle(document.getElementById('app')).display === 'none', report: !!document.querySelector('#print-root .rp-page') }; }; });
await p.emulateMedia({ media: 'print' });
await p.click('[data-act="pdf"]');
const printed = await p.evaluate(() => window.__printed);
await p.emulateMedia({ media: 'screen' });
ok(printed?.report && printed.only, 'Save as PDF prints the report alone, not the app behind it');

// CSV downloads where sharing files isn't offered
await p.evaluate(() => { navigator.canShare = () => false; });
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="csv"]')]);
ok(/^spendings-\d{4}-\d{2}-[a-z]+\.csv$/.test(dl.suggestedFilename()), `CSV saves as ${dl.suggestedFilename()}`);
const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="share-report"]')]);
ok(dl2.suggestedFilename().endsWith('.html'), 'Share falls back to saving the report page');

await p.click('.sheet [data-act="done"]');
await p.goto(BASE + '?demo=1&r=2#settings');
await p.click('.group [data-act="report"]');
await p.waitForSelector('.sheet .rp-page');
ok(await p.isDisabled('[data-rcyc="1"]'), 'from Settings it opens on the current cycle');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await b.close();
console.log(`${n} report checks passed`);
