// Weekly summary and allowance pace alert: the maths (docs/js/weekly.js), then Home, the "Your week" sheet and
// Insights in demo mode with the clock pinned to a Monday.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-weekly.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS, cycleOf, cycleBounds, summarize } from '../docs/js/model.js';
import {
  lastFullWeek, mondayOf, weekdayOf, weekTotals, usualWeek, median, compareToUsual, topCategories, weeklySummary, paceAlert, summaryDue, summaryLine,
} from '../docs/js/weekly.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const S = { ...DEFAULT_SETTINGS, usdRate: 3.6725 };

// ── week boundaries (Dubai days, Monday to Sunday)
const at = (iso) => new Date(iso);
ok(weekdayOf('2026-11-02') === 0 && weekdayOf('2026-11-01') === 6 && mondayOf('2026-11-01') === '2026-10-26' && mondayOf('2026-11-02') === '2026-11-02', 'Monday is day 0 and Sunday belongs to the week before it');
{
  const w = lastFullWeek(at('2026-11-02T10:00:00+04:00'));
  ok(w.from === '2026-10-26' && w.to === '2026-11-01' && w.next === '2026-11-02', 'on a Monday, last week is the one that ended yesterday');
  ok(lastFullWeek(at('2026-11-08T23:59:00+04:00')).from === '2026-10-26', 'Sunday 23:59 is still inside the week, so last full week is the one before');
  ok(lastFullWeek(at('2026-11-09T00:01:00+04:00')).from === '2026-11-02', 'Monday 00:01 starts the next week');
  // Dubai is UTC+4: 20:30 UTC on Sunday is already Monday 00:30 in Dubai
  ok(lastFullWeek(at('2026-11-08T20:30:00Z')).from === '2026-11-02', 'a UTC evening that is already Monday in Dubai counts as Monday');
  ok(lastFullWeek(at('2026-11-08T19:30:00Z')).from === '2026-10-26', 'and 19:30 UTC is still Sunday in Dubai');
}

// ── totals: Spend only, gross, boundaries
let id = 0;
const E = (type, amount, iso, extra = {}) => ({ id: `w${++id}`, type, amount, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Groceries', merchant: 'Carrefour', note: '', status: 'OK', date: new Date(iso).toISOString(), cycle: cycleOf(new Date(iso), S.cycleStart), ...extra });
const NOW = at('2026-11-02T10:00:00+04:00'); // a Monday; last week = 26 Oct – 1 Nov
const week = (monday, total, extra = {}) => E('Spend', total, `${monday}T12:00:00+04:00`, extra);
const entries = [
  E('Spend', 100, '2026-10-26T00:00:30+04:00'),                                   // Monday 00:00:30, in
  E('Spend', 40, '2026-11-01T23:59:00+04:00', { category: 'Food & Drinks', merchant: 'Salt' }), // Sunday 23:59, in
  E('Spend', 999, '2026-11-02T00:01:00+04:00'),                                   // Monday 00:01, next week: out
  E('Spend', 888, '2026-10-25T23:59:00+04:00'),                                   // the Sunday before: a different week
  E('Spend', 10, '2026-10-28T09:00:00+04:00', { currency: 'USD', amountAED: 36.73, category: 'Food & Drinks', merchant: 'Apple' }), // USD uses its AED value
  E('Transfer', 5000, '2026-10-29T10:00:00+04:00', { account: 'ADIB', toAccount: 'ADCB' }),
  E('Income', 50, '2026-10-30T10:00:00+04:00', { category: 'Refund' }),
  E('Spend', 250, '2026-10-30T20:00:00+04:00', { category: 'Shopping', merchant: 'Amazon' }),
  E('Adjustment', 77, '2026-10-30T10:00:00+04:00'),
];
{
  const t = weekTotals(entries, S, '2026-10-26', 2);
  const w = t.get('2026-10-26');
  ok(Math.abs(w.spent - (100 + 40 + 36.73 + 250)) < 0.001 && w.count === 4, 'spent is Spend only: no transfer, refund, adjustment, or entry from the neighbouring days');
  ok(w.biggest.amount === 250 && w.biggest.merchant === 'Amazon' && w.biggest.day === '2026-10-30', 'the biggest single payment is found');
  ok(t.get('2026-10-19').spent === 888 && t.size === 2, 'the Sunday before belongs to the earlier week, and next week is left out');
}
{
  // same gross rule as Insights: a week inside one cycle must match summarize()
  const inside = [E('Spend', 120, '2026-11-03T10:00:00+04:00'), E('Spend', 30, '2026-11-08T22:00:00+04:00', { category: 'Health' }), E('Income', 200, '2026-11-04T10:00:00+04:00', { category: 'Refund' }), E('Transfer', 900, '2026-11-05T10:00:00+04:00', { account: 'ADIB', toAccount: 'ADCB' })];
  const sum = summarize(inside, '2026-11', S, []);
  const w = weekTotals(inside, S, '2026-11-02', 1).get('2026-11-02');
  ok(Math.abs(w.spent - sum.spent) < 0.001 && w.byCategory.get('Groceries') === sum.byCategory.get('Groceries') && w.byCategory.get('Health') === sum.byCategory.get('Health'), 'week totals agree with Insights (summarize): refunds not netted, transfers out');
}

// ── usual week = median of the previous six weeks with data
{
  const all = [];
  const start = Date.parse('2026-10-26T12:00:00+04:00');
  for (let k = 0; k <= 6; k++) all.push(E('Spend', k === 0 ? 1500 : 100 * k, new Date(start - 7 * k * 864e5).toISOString()));
  const t = weekTotals(all, S, '2026-10-26');
  ok(usualWeek(t, '2026-10-26') === 350 && median([100, 200, 300, 400, 500, 600]) === 350, 'usual is the median of the six weeks before (100…600 gives 350)');
  const vs = compareToUsual(1500, 350);
  ok(vs.tone === 'more' && Math.round(vs.pct * 100) === 329, 'compared with usual: percent over');
  ok(compareToUsual(340, 350).tone === 'same' && compareToUsual(100, 350).tone === 'less' && compareToUsual(5, null) === null && compareToUsual(5, 0) === null, 'about the same within 5%, less, and null without a usual');
  // weeks with no spending are skipped, so older ones fill in (only weeks with data count)
  const gap = all.filter((e) => e.amount !== 200 && e.amount !== 400);
  ok(usualWeek(weekTotals(gap, S, '2026-10-26'), '2026-10-26') === 400, 'weeks without spending are skipped (100, 300, 500, 600 gives 400)');
  // not enough history
  const few = all.filter((e) => e.amount === 1500 || e.amount === 100 || e.amount === 200);
  ok(usualWeek(weekTotals(few, S, '2026-10-26'), '2026-10-26') === null, 'two earlier weeks with data is not enough: usual is null');
  const three = all.filter((e) => [1500, 100, 200, 300].includes(e.amount));
  ok(usualWeek(weekTotals(three, S, '2026-10-26'), '2026-10-26') === 200, 'three earlier weeks is enough');
  // an even count: mean of the middle two
  ok(median([10, 20, 30, 40]) === 25 && median([]) === null, 'median of an even count and of nothing');
  const sum = weeklySummary({ entries: all, settings: S, plan: [], now: NOW });
  ok(sum.hasData && sum.spent === 1500 && sum.vs.usual === 350 && sum.top.length === 1 && sum.week.from === '2026-10-26', 'weeklySummary puts it together');
  ok(!weeklySummary({ entries: [], settings: S, now: NOW }).hasData, 'no spending last week means no summary');
  ok(summaryLine(1240, compareToUsual(1240, 1100), (v) => `AED ${v}`) === 'Last week you spent AED 1240, 13% more than usual' && summaryLine(5, null, (v) => `AED ${v}`) === 'Last week you spent AED 5', 'the Home sentence');
}

// ── top three categories, names through categoryMeta
{
  const by = new Map([['Groceries', 300], ['Food & Drinks', 500], ['Health', 50], ['Shopping', 120], ['Uncategorised', 80]]);
  const top = topCategories(by);
  ok(top.map((c) => c.id).join('|') === 'Food & Drinks|Groceries|Shopping', 'top three by amount');
  ok(topCategories(new Map([['Uncategorised', 5]]))[0].label === 'Needs category' && topCategories(new Map([['Mystery', 5]]))[0].label === 'Mystery', 'a missing category shows its id, uncategorised says Needs category');
}

// ── coming up reuses the other modules
{
  const budgetsEntries = [E('Spend', 450, '2026-11-01T10:00:00+04:00', { category: 'Shopping' })];
  const plans = [{ id: 'p1', provider: 'Tabby', merchant: '<b>Noon</b>', item: '', category: 'Shopping', total: 400, count: 2, cadence: '1m', first: '2026-11-04', account: 'ADCB', paid: [null, null], skip: [] }];
  const c = weeklySummary({ entries: budgetsEntries, settings: S, plan: [], now: NOW, plans, limits: { Shopping: 500, Health: 100 } }).coming;
  ok(c.bnpl.length === 1 && c.bnpl[0].amount === 200 && c.bnpl[0].due === '2026-11-04', 'a pay-later payment due this week is listed');
  ok(c.budgets.length === 1 && c.budgets[0].id === 'Shopping' && c.budgets[0].status === 'near', 'a budget at 80%+ is listed, one at 0% is not');
  ok(weeklySummary({ entries: [], settings: S, now: NOW }).coming.empty, 'nothing coming up reads as empty');
  // a monthly subscription whose next charge lands on Wednesday 4 Nov
  const subs = [E('Spend', 56, '2026-10-04T10:00:00+04:00', { merchant: 'Netflix', category: 'Bills & Subscriptions' }), E('Spend', 56, '2026-09-04T10:00:00+04:00', { merchant: 'Netflix', category: 'Bills & Subscriptions' })];
  const cs = weeklySummary({ entries: subs, settings: S, now: NOW }).coming;
  ok(cs.subs.length === 1 && cs.subs[0].name === 'Netflix' && cs.subs[0].day === '2026-11-04', 'a subscription due this week is listed');
}

// ── pace date maths (cycle 27 Oct → 26 Nov, 31 days)
{
  const { start, end } = cycleBounds('2026-11', 27);
  const dayAt = (d) => new Date(start.getTime() + d * 864e5);
  const a = paceAlert({ pot: 3000, used: 2000, start, end, now: dayAt(10) });
  ok(a && a.outDay === '2026-11-11' && a.text === 'At this pace your allowance runs out around 11 Nov' && a.early === 15, '2000 of 3000 used in 10 days runs out on day 15, 11 Nov');
  ok(paceAlert({ pot: 3000, used: 900, start, end, now: dayAt(10) }) === null, 'on pace to last the cycle: no alert');
  ok(paceAlert({ pot: 3000, used: 1000, start, end, now: dayAt(10) }) === null, 'runs out on the last day (26 Nov): not before it, so no alert');
  ok(paceAlert({ pot: 3000, used: 1050, start, end, now: dayAt(10) }) !== null, 'a little faster than that is an alert');
  ok(paceAlert({ pot: 3000, used: 2500, start, end, now: dayAt(2.9) }) === null && paceAlert({ pot: 3000, used: 2500, start, end, now: dayAt(3) }) !== null, 'only from three days into the cycle');
  ok(paceAlert({ pot: 3000, used: 3000, start, end, now: dayAt(10) }) === null && paceAlert({ pot: 3000, used: 0, start, end, now: dayAt(10) }) === null && paceAlert({ pot: 0, used: 5, start, end, now: dayAt(10) }) === null, 'nothing to say when all used, nothing used, or no allowance');
  const t = paceAlert({ pot: 1000, used: 990, start, end, now: dayAt(3.2) });
  ok(t && t.text === 'At this pace your allowance runs out around today', 'running out the same day says "today"');
}

// ── when the Home line is due
{
  const w = lastFullWeek(NOW);
  ok(summaryDue(NOW, '', w) && summaryDue(at('2026-11-03T20:00:00+04:00'), '', lastFullWeek(at('2026-11-03T20:00:00+04:00'))), 'due on a Monday and a Tuesday');
  ok(!summaryDue(at('2026-11-04T10:00:00+04:00'), '') && !summaryDue(at('2026-11-08T10:00:00+04:00'), ''), 'not on a Wednesday or a Sunday');
  ok(!summaryDue(NOW, '2026-10-26', w) && summaryDue(NOW, '2026-10-19', w), 'not once this week has been seen; an older seen key does not count');
}

// ── the real app
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const URL = process.env.APP_URL || ((process.env.BASE || 'http://localhost:8765').replace(/\/$/, '') + '/');
const b = await chromium.launch();
const errors = [];
const open = async (iso, hash = 'home') => {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.install({ time: new Date(iso) });
  await p.goto(`${URL}?demo=1#${hash}`);
  await p.waitForSelector(hash === 'home' ? '.lens' : '.panel');
  return p;
};
// the demo's other notices (subscriptions, pay-later, owed) would outrank the week line: set them aside like verify-budgets does
const setAside = (p) => p.evaluate(async () => {
  const [st, r] = await Promise.all([import('/js/store.js'), import('/js/recurring.js')]);
  st.saveExtra('recurring', { v: 1, ignored: [...new Set(st.state.entries.map((e) => r.recurringKey(e.merchant)).filter(Boolean))] }, 'x', { undoable: false });
  st.saveExtra('bnpl', null, 'x', { undoable: false });
});
// (the pace alert is set aside by giving the allowance setting room: the pot is that setting plus top-ups)
const allowance = (p, v) => p.evaluate(async (v) => { const st = await import('/js/store.js'); st.state.settings = { ...st.state.settings, allowance: v }; }, v);

const p = await open('2026-11-02T10:00:00+04:00');
await setAside(p);
await allowance(p, 1e6);
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
ok(await p.$('[data-weekly="open"]') !== null, 'Monday: the week line is on Home when nothing else outranks it');
ok(await p.$$eval('.sub-line, .budget-nudge', (x) => x.length) === 1, 'Home still shows just one line');
const line = await p.textContent('[data-weekly="open"]');
ok(/^\s*Last week you spent AED [\d,]+/.test(line), `the line reads "${line.trim()}"`);
ok((await p.$eval('[data-weekly="open"]', (el) => el.getBoundingClientRect().height)) >= 44, 'the line is at least 44px tall');

// the Insights card is on the current cycle
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.wk-card');
ok(await p.$$eval('.wk-card .tm-row', (x) => x.length) === 3, 'Insights shows the Last week card with three top categories');
ok(/Last week/.test(await p.textContent('.wk-card .panel-title')) && /You spent AED/.test(await p.textContent('.wk-card .panel-sub')), 'the card says what was spent');
await p.evaluate(async () => { (await import('/js/insights.js')).shiftInsights(-1); });
await p.click('.tabbar [data-tab="settings"]');
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.panel');
ok(!(await p.$('.wk-card')), 'a past cycle has no Last week card');
await p.evaluate(async () => { (await import('/js/insights.js')).resetInsights(); });
await p.click('.tabbar [data-tab="settings"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('[data-weekly="open"]');

// open the sheet, dismiss
const undoBefore = await p.evaluate(async () => (await import('/js/store.js')).lastAction());
await p.click('[data-weekly="open"]');
await p.waitForSelector('.wk-sheet');
const sheetText = await p.textContent('.wk-sheet');
ok(/26 Oct – 1 Nov/.test(sheetText) && /Top categories/.test(sheetText) && /Coming up this week/.test(sheetText), 'the sheet shows the week, top categories and coming up');
ok(await p.$$eval('.wk-sheet .group:nth-of-type(1) .row', (x) => x.length) > 0, 'the sheet lists categories');
const seenNow = await p.evaluate(async () => (await import('/js/store.js')).getExtra('weekly', null));
ok(seenNow && seenNow.v === 1 && seenNow.seen === '2026-10-26', 'opening it saves { v: 1, seen: <week key> }');
ok(await p.evaluate(async () => (await import('/js/store.js')).lastAction()) === undoBefore, 'opening it adds no Undo step');
await p.click('.sheet [data-wk-act="done"]');
await p.waitForSelector('.wk-sheet', { state: 'detached' });
ok(!(await p.$('[data-weekly="open"]')), 'once opened, the Home line is gone');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');

// pace alert outranks the week line, and Home still shows one line
await p.evaluate(async () => {
  const st = await import('/js/store.js');
  st.saveExtra('weekly', null, 'x', { undoable: false });
});
await allowance(p, 1000); // the demo has spent about 755 of it in 6 days: gone well before the 26th
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.wk-line');
ok(await p.$$eval('.sub-line, .budget-nudge', (x) => x.length) === 1 && /^At this pace your allowance runs out around \d+ \w{3}$/.test((await p.textContent('.wk-line')).trim()), 'allowance running out outranks the week line, still one line');
ok(!(await p.$('[data-weekly="open"]')), 'and the week line waits');
await p.click('.wk-line');
await p.waitForSelector('#pace');
ok(await p.isVisible('#pace'), 'tapping the pace line opens Insights at the Allowance pace card');
await allowance(p, 3000);
await p.close();

// Wednesday: no week line
{
  const w = await open('2026-11-04T10:00:00+04:00');
  await setAside(w);
  await allowance(w, 1e6);
  await w.click('.tabbar [data-tab="insights"]');
  await w.click('.tabbar [data-tab="home"]');
  await w.waitForSelector('.lens');
  ok(!(await w.$('[data-weekly="open"]')), 'Wednesday: no week line on Home');
  await w.click('.tabbar [data-tab="insights"]');
  await w.waitForSelector('.wk-card');
  ok(true, 'the Insights card is there on any day');
  await w.click('[data-weekly="open"]');
  await w.waitForSelector('.wk-sheet');
  ok(/Coming up this week/.test(await w.textContent('.wk-sheet')), 'the card opens the same sheet');
  ok(!(await w.evaluate(async () => (await import('/js/store.js')).getExtra('weekly', null))), 'opening it outside Monday and Tuesday saves nothing');
  await w.close();
}
ok(!errors.length, 'no page errors');
await b.close();
console.log(`all ${n} weekly checks passed`);
