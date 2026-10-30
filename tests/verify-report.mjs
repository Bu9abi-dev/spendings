// The monthly report (docs/js/report.js).
// Checks the numbers on hand-made entries (transfers aren't spending, refunds come back, shops group
// whatever their capitals, total money at the cycle's end), the per-cycle CSV, and the report sheet
// in the app at iPhone size: opens from Insights and Settings, steps cycles, prints, exports.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-report.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.env.BASE || 'http://localhost:8765').replace(/\/?$/, '/');

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
    E('Spend', 200, 'ADCB', '2026-09-28T12:00:00+04:00', { category: 'Groceries', merchant: 'CARREFOUR MCC 5411 ABU DHABI' }),
    E('Spend', 50.5, 'ADCB', '2026-10-02T12:00:00+04:00', { category: 'Groceries', merchant: 'Carrefour' }),
    E('Spend', 10.4, 'ADCB', '2026-10-02T13:00:00+04:00', { category: 'Mystery Custom', merchant: 'Carrefour 0042 AE' }),
    E('Spend', 80, 'ADCB', '2026-10-03T12:00:00+04:00', { category: 'Food & Drinks', merchant: 'Shake Shack' }),
    E('Income', 30, 'ADCB', '2026-10-04T12:00:00+04:00', { category: 'Refund', merchant: 'Shake Shack' }),
    E('Spend', 40, 'BOTIM', '2026-10-05T12:00:00+04:00', { category: '', merchant: 'Mystery', status: 'Review' }),
    E('Adjustment', -10, 'Cash', '2026-10-06T12:00:00+04:00'),
    E('Spend', 999, 'ADIB', '2026-10-27T00:30:00+04:00', { category: 'Shopping', merchant: 'Next cycle' }), // next cycle
  ];
  const rep = cycleReport(entries, '2026-10', S, [], { v: 1, limits: { Groceries: 300, Shopping: 100, Bad: 'x', Zero: 0 } }, new Date('2026-11-05T10:00:00+04:00'));
  const csv = cycleCSV(entries, '2026-10');
  const inCycle = entries.filter((e) => e.cycle === '2026-10').length;
  // old (pre-limits) shapes must not show a budgets section
  const legacy = cycleReport(entries, '2026-10', S, [], { Groceries: 300 }, new Date('2026-11-05T10:00:00+04:00'));
  const many = [];
  for (let k = 0; k < 14; k++) many.push(E('Spend', 10.6 + k, 'ADCB', '2026-10-10T12:00:00+04:00', { category: 'Groceries', merchant: `Shop ${String.fromCharCode(65 + k)}` }));
  const big = cycleReport([...entries, ...many], '2026-10', S, [], null, new Date('2026-11-05T10:00:00+04:00'));
  return { ...rep, legacyBudgets: legacy.budgets.length, big: { shops: big.merchants, cats: big.categories, whole: big.whole }, inCycle, start: 0, end: 0, asOf: 0, biggest: rep.biggest.map((e) => e.id), csvLines: csv.split('\n').length, csvHead: csv.split('\n')[0], csvHasNext: csv.includes('Next cycle') };
});
const SPENT = 380.9;
const sumShown = (rows) => rows.reduce((a, x) => a + x.shown, 0);
ok(near(r.income, 6030), 'money in matches Insights: salary plus the refund, last cycle excluded');
ok(near(r.spent, SPENT) && near(r.refunds, 30), 'Spent is gross (380.90), not netted for the 30 refund; refunds shown separately; the 3,000 transfer is not spending');
ok(r.whole.income === 6030 && r.whole.spent === 381 && r.whole.refunds === 30 && r.whole.kept === 6030 - 381, 'tiles in whole dirhams: Money in − Spent = Kept exactly as displayed');
ok(near(r.moved, 3000) && r.moves === 1, 'the allowance move is listed apart as a move between accounts');
ok(r.merchants[0].name === 'Carrefour' && r.merchants[0].count === 3 && near(r.merchants[0].value, 260.9), '"CARREFOUR MCC 5411 ABU DHABI", "Carrefour" and "Carrefour 0042 AE" are one shop');
ok(sumShown(r.categories) === r.whole.spent && r.categories.reduce((a, x) => a + x.pct, 0) === 100, 'category rows add up to the Spent tile and the percentages to 100');
ok(sumShown(r.merchants) === r.whole.spent, 'top shops add up to the Spent tile');
ok(sumShown(r.big.cats) === r.big.whole.spent && sumShown(r.big.shops) === r.big.whole.spent && r.big.shops.at(-1).rest && r.big.shops.at(-1).name === 'Everything else' && r.big.shops.length === 9, 'with many shops: top 8 plus an Everything else row, still adding up to Spent');
ok(r.categories[0].id === 'Groceries' && near(r.categories[0].prev, 100), 'categories biggest first, with last cycle alongside');
ok(r.categories.find((x) => x.id === 'Mystery Custom').name === 'Mystery Custom' && r.categories.some((x) => x.id === 'Uncategorised' && x.name === 'Needs category') && r.review === 1, 'unknown categories keep their name; uncategorised spending and the review count show');
ok(near(r.allowance.used, 300.5 + 10.4) && near(r.allowance.left, 3000 - 310.9), 'allowance: ADCB spend minus the refund, against 3,000');
// end-of-cycle total: 5000 − 100 + 6000 − 380.9 + 30 − 10 (bank match); the next-cycle 999 not yet
ok(near(r.totalMoney, 5000 - 100 + 6000 - SPENT + 30 - 10) && !r.isCurrent, 'total money is as of the end of the cycle (later entries ignored)');
ok(r.budgets.length === 2 && r.budgets.find((x) => x.id === 'Shopping').limit === 100 && near(r.budgets.find((x) => x.id === 'Groceries').spent, 250.5 + 0), 'budgets read from { v: 1, limits }; junk and zero limits ignored');
ok(r.legacyBudgets === 0, 'no limits (or the old shape) means no budgets section');
ok(r.count === 8, 'entry count leaves out bank matches');
ok(r.csvLines === r.inCycle + 1 && r.inCycle === 9 && r.csvHead.startsWith('id,date,cycle') && !r.csvHasNext, 'CSV rows equal the cycle\'s entries (9, incl. the bank match) under the usual header');

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

// the three buttons are named for what they do
const labels = await p.$$eval('.report-actions button', (bs) => bs.map((x) => x.textContent.trim()));
ok(labels.join('|') === 'Save as PDF|Share report|Export CSV', `buttons read ${labels.join(', ')}`);
const actW = await p.evaluate(() => { const a = document.querySelector('.report-actions'); return a.scrollWidth - a.clientWidth; });
ok(actW <= 1, 'the three buttons fit the iPhone width');
// tiles on screen add up (Money in − Spent = Kept, as displayed) and refunds sit apart
const tiles = await p.$$eval('.rp-tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('span').textContent, +t.querySelector('b').textContent.replace(/[^\d-]/g, '')])));
ok(tiles['Money in'] - tiles['Spent'] === (tiles['Kept'] ?? -tiles['Overspent']) && 'Refunds (money back)' in tiles, 'the tiles on screen: Money in − Spent = Kept, with Refunds on their own');
const pageSum = await p.evaluate(() => {
  const secs = [...document.querySelectorAll('.sheet .rp-sec')];
  const rows = (title) => (secs.find((x) => x.querySelector('h2').textContent === title)?.querySelectorAll('tr') || []);
  const total = (title, col) => [...rows(title)].reduce((a, tr) => a + (+tr.querySelector(col).textContent.replace(/[^\d]/g, '').slice(0, 9) || 0), 0);
  return { cats: [...rows('Where it went')].map((tr) => tr.querySelector('.rp-num').firstChild.textContent.replace(/[^\d]/g, '')).reduce((a, x) => a + +x, 0),
    pct: [...rows('Where it went')].reduce((a, tr) => a + parseInt(tr.querySelector('.rp-pct').textContent), 0), rows: rows('Where it went').length };
});
ok(!pageSum.rows || pageSum.pct === 100, 'category percentages on screen add up to 100');

// CSV downloads where sharing files isn't offered
await p.evaluate(() => { navigator.canShare = () => false; });
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="csv"]')]);
ok(/^spendings-\d{4}-\d{2}-[a-z]+\.csv$/.test(dl.suggestedFilename()), `CSV saves as ${dl.suggestedFilename()}`);
const csvText = await (async () => { const fs = await import('node:fs'); return fs.readFileSync(await dl.path(), 'utf8'); })();
const demoCount = await p.evaluate(async () => { const { state } = await import('/js/store.js'); const { cycleOf } = await import('/js/model.js'); const c = cycleOf(new Date(), state.settings.cycleStart); return state.entries.filter((e) => e.cycle === c).length; });
ok(csvText.trim().split('\n').length === demoCount + 1, `the CSV has one row per entry in the cycle (${demoCount})`);
const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="share-report"]')]);
ok(dl2.suggestedFilename().endsWith('.html'), 'Share report falls back to saving the report page');

// no window.print, or a Home Screen app: open the report page with an honest hint instead of nothing
await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }; window.__printed = null; window.print = undefined; });
await p.click('[data-act="pdf"]');
const fb = await p.evaluate(() => ({ opened: window.__opened.length, toast: document.getElementById('toast').textContent }));
ok(fb.opened === 1 && /Share → Print → pinch out/.test(fb.toast), 'without window.print, Save as PDF opens the report page and says how to save a PDF');

await p.click('.sheet [data-act="done"]');
await p.goto(BASE + '?demo=1&r=2#settings');
await p.click('.group [data-act="report"]');
await p.waitForSelector('.sheet .rp-page');
ok(await p.isDisabled('[data-rcyc="1"]'), 'from Settings it opens on the current cycle');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await b.close();
console.log(`${n} report checks passed`);
