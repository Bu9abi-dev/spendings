// Spending charts in Insights: the numbers behind the day/week bars, top places and six-cycle category trends
// (docs/js/trends.js), then the real Insights tab in demo mode.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-charts.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS, cycleOf, cycleBounds, cycleLength, shiftCycle, toAED } from '../docs/js/model.js';
import { dailySpend, weeklySpend, topMerchants, categoryTrends, merchantKey } from '../docs/js/trends.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const near = (a, b) => Math.abs(a - b) < 0.005;

const S = { ...DEFAULT_SETTINGS, usdRate: 3.6725 };
const cyc = '2026-11'; // 27 Oct – 26 Nov with the default start day
const { start } = cycleBounds(cyc, S.cycleStart);
let id = 0;
const E = (type, amount, dayOfCycle, extra = {}) => {
  const date = new Date(start.getTime() + dayOfCycle * 864e5 + 10 * 3600e3).toISOString();
  return { id: `c${++id}`, type, amount, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Groceries', merchant: '', note: '', status: 'OK', date, cycle: cycleOf(date, S.cycleStart), ...extra };
};

// ── day and week bars
const entries = [
  E('Spend', 50, 0, { merchant: 'Carrefour' }),
  E('Spend', 25.5, 0, { merchant: 'CARREFOUR ' }),
  E('Spend', 10, 3, { merchant: 'carrefour', category: 'Food & Drinks' }),
  E('Spend', 20, 8, { merchant: 'Talabat', category: 'Food & Drinks', currency: 'USD' }),
  E('Transfer', 3000, 0, { account: 'ADIB', toAccount: 'ADCB' }),          // moving money: never spending
  E('Income', 30, 3, { category: 'Refund', merchant: 'Carrefour' }),       // refund stays income
  E('Adjustment', 500, 2, { note: 'Matched with bank' }),
  E('Spend', 999, 0, { cycle: shiftCycle(cyc, -1), date: new Date(start.getTime() - 2 * 864e5).toISOString(), merchant: 'Old' }),
];
const daily = dailySpend(entries, cyc, S);
ok(daily.length === cycleLength(cyc, S.cycleStart), 'one bar per day of the cycle');
ok(near(daily[0], 75.5), 'day 1 adds both Carrefour spends, not the 3,000 transfer');
ok(daily[2] === 0 && near(daily[3], 10), 'adjustments and refunds are not spending');
ok(near(daily[8], 20 * S.usdRate), 'a USD spend is shown in AED');
ok(near(daily.reduce((a, v) => a + v, 0), entries.filter((e) => e.cycle === cyc && e.type === 'Spend').reduce((a, e) => a + toAED(e, S), 0)), 'the bars add up to the cycle’s spending');
const weeks = weeklySpend(daily);
ok(weeks.length === Math.ceil(daily.length / 7) && weeks[0].from === 0 && weeks[0].to === 6, 'weeks are seven days from the cycle start');
ok(near(weeks[0].total, 85.5) && near(weeks[1].total, 20 * S.usdRate), 'week totals add their days');
ok(weeks.at(-1).to === daily.length - 1, 'the last week ends on the last day');

// Dubai day boundaries: 23:59 and 00:01 Dubai time land on the right bars (Dubai is UTC+4, no daylight saving)
const dubai = (y, m, d, h, min) => new Date(Date.UTC(y, m - 1, d, h - 4, min)).toISOString();
const edge = [
  ['2026-10-27T00:01', dubai(2026, 10, 27, 0, 1), 0], ['2026-10-27T23:59', dubai(2026, 10, 27, 23, 59), 0],
  ['2026-10-28T00:01', dubai(2026, 10, 28, 0, 1), 1], ['2026-11-26T23:59', dubai(2026, 11, 26, 23, 59), 30],
].map(([, date, want], i) => ({ ...E('Spend', 10 ** i, 0), date, cycle: cycleOf(date, S.cycleStart), want }));
const ed = dailySpend(edge, cyc, S);
ok(edge.every((e) => e.cycle === cyc), 'the first and last minutes of the cycle belong to it');
ok(ed[0] === 11 && ed[1] === 100 && ed[30] === 1000, 'late-night and just-after-midnight spends land on the right Dubai day');

// ── top places
const top = topMerchants(entries, cyc, S, 5);
ok(top[0].name === 'Carrefour' && top[0].count === 3 && near(top[0].total, 85.5), 'Carrefour spellings group together under the usual spelling');
ok(top.length === 2 && !top.some((m) => m.name === 'Old'), 'only this cycle’s spending, transfers and refunds left out');
ok(merchantKey('  Spinneys   Khalidiya ') === 'spinneys khalidiya', 'merchant names ignore case and extra spaces');
ok(topMerchants(entries, cyc, S, 1).length === 1, 'the list stops at the limit');

// ── category trends
const six = [];
for (let back = 0; back < 4; back++) {
  const c = shiftCycle(cyc, -back), b = cycleBounds(c, S.cycleStart).start;
  const date = new Date(b.getTime() + 5 * 864e5).toISOString();
  six.push({ ...E('Spend', 100 * (back + 1), 0), date, cycle: c });
}
six.push({ ...E('Spend', 40, 1), category: '' });
const tr = categoryTrends(six, cyc, S, 6);
const g = tr.find((t) => t.id === 'Groceries');
ok(g.values.length === 6 && g.values[5] === 100 && g.values[2] === 400 && g.values[0] === 0, 'six cycles oldest first, shown cycle last');
ok(near(g.usual, (300 + 200) / 2), '“usual” skips cycles before the first entry and the part-logged first cycle');
ok(tr.some((t) => t.id === 'Uncategorised' && t.usual === null), 'blank categories show as needing a category, with no fake “usual 0”');
ok(near(tr.reduce((a, t) => a + t.values[5], 0), 140), 'the solid bars add up to the cycle’s spending');
ok('2026-10' < '2026-11' && '2025-12' < '2026-01', 'cycle ids sort by date as text');
ok(categoryTrends([E('Spend', 5, 0)], cyc, S, 6)[0].usual === null, 'a first-ever cycle has no “usual”');

// ── the real Insights tab
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto((process.env.BASE || 'http://localhost:8765/') + '?demo=1#insights');
await p.waitForSelector('.spend-bars');
await p.click('[data-cyc="-1"]'); // a full past cycle
await p.waitForSelector('.spend-bars');
const len = await p.$$eval('.sb-bar.dy', (x) => x.length);
ok(len >= 28 && len <= 31, 'Insights shows a bar for each day');
const shown = await p.evaluate(async () => {
  const [st, m, t] = await Promise.all([import('/js/store.js'), import('/js/model.js'), import('/js/trends.js')]);
  const cyc = m.shiftCycle(m.cycleOf(new Date(), st.state.settings.cycleStart), -1);
  const bars = [...document.querySelectorAll('.sb-bar.dy')].reduce((a, x) => a + +x.dataset.value, 0);
  return { bars, spent: m.summarize(st.state.entries, cyc, st.state.settings).spent };
});
ok(near(shown.bars, shown.spent), 'the day bars add up to “Spent” in the donut');
const placesSum = await p.$$eval('.tm-row .hb-val', (x) => x.reduce((a, v) => a + Number(v.textContent.replace(/,/g, '')), 0));
ok(Math.abs(placesSum - shown.spent) <= 6, 'top places plus “Everything else” add up to “Spent” (within rounding)');
const wnotes = await p.$$eval('.sb-wlabels small', (x) => x.map((s) => s.textContent));
ok(wnotes.length <= 1 && wnotes.every((t) => /^\d days?$/.test(t)), 'a short last week says how many days it has');
// a finger lands between thin bars: the nearest bar is picked, and sliding scrubs along
await p.$eval('.spend-bars', (el) => el.scrollIntoView({ block: 'center' }));
const box = await p.$eval('.sb-plot.sb-days', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + r.height - 10, w: r.width }; });
await p.mouse.move(box.x + box.w * 0.1, box.y); await p.mouse.down();
const first = await p.textContent('.sb-readout');
await p.mouse.move(box.x + box.w * 0.6, box.y, { steps: 4 });
const later = await p.textContent('.sb-readout');
await p.mouse.up();
ok(/AED \d/.test(first) && /AED \d/.test(later) && first !== later, 'pressing picks a day and sliding scrubs to another');
await p.mouse.click(box.x + box.w * 0.6, box.y);
ok(/Average/.test(await p.textContent('.sb-readout')), 'tapping the picked day again clears it');
await p.focus('.sb-bar.dy:nth-of-type(3)'); await p.keyboard.press('Enter');
ok(/AED \d/.test(await p.textContent('.sb-readout')), 'a day can be picked with the keyboard too');
await p.click('[data-bars="week"]');
ok(await p.isVisible('.sb-bar.wk') && !(await p.isVisible('.sb-bar.dy')), 'the Week toggle swaps to week bars');
ok(await p.$$eval('.tm-row:not(.tm-rest)', (x) => x.length) === 5, 'top five places are listed');
ok(await p.$$eval('.tr-row .spark i', (x) => x.length) % 6 === 0, 'each category has six trend bars');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');
ok(!errors.length, 'no page errors');
await b.close();
console.log(`all ${n} chart checks passed`);
