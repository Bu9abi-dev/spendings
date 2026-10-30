// Weekly summary and allowance pace alert: the maths (docs/js/weekly.js), then Home, the "Your week" sheet and
// Insights in demo mode with the clock pinned to a Monday.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-weekly.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS, cycleOf, cycleBounds, summarize, homeNumbers, allowancePace } from '../docs/js/model.js';
import {
  lastFullWeek, mondayOf, weekdayOf, weekTotals, usualWeek, median, compareToUsual, topCategories, weeklySummary, paceAlert, paceSeen, summaryDue, summaryLine,
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

// ── allowance pace: one definition (model.js allowancePace) for Home's line, the Insights card and the alert
// cycle 27 Oct → 26 Nov (31 days), pot 3000 (the default allowance), tolerance max(15, 3% of 3000) = 90
{
  const { start } = cycleBounds('2026-11', 27);
  const dayAt = (d) => new Date(start.getTime() + d * 864e5);
  const spend = (d, amount, extra = {}) => E('Spend', amount, dayAt(d + 0.5).toISOString(), extra);
  // the three readers, exactly as the screens read them: Home's line and the alert from homeNumbers' m.pace,
  // the Insights card from allowancePace over the same adjusted summary (m.sum)
  const read = (list, now) => {
    const m = homeNumbers(list, [], S, now);
    const insights = allowancePace(m.sum, m.cyc, S, now).state;
    return { home: m.pace.state, insights, alert: paceAlert(m.pace, now), m };
  };
  const steady = (perDay, days) => Array.from({ length: days }, (_, d) => spend(d, perDay));
  const scenarios = {
    'day-1 spike, day 2': { list: [spend(0, 1500)], now: dayAt(1.5) },
    'day-1 spike, then small spends, day 10': { list: [spend(0, 1500), spend(2, 50), spend(4, 50)], now: dayAt(9.5) },
    'steady 150 a day for 10 days': { list: steady(150, 10), now: dayAt(10) },
    'on track, 90 a day': { list: steady(90, 10), now: dayAt(10) },
    'just inside the band, 105 a day': { list: steady(105, 10), now: dayAt(10) },
    'under pace, 40 a day': { list: steady(40, 10), now: dayAt(10) },
    'two big days only': { list: [spend(0, 700), spend(5, 700)], now: dayAt(10) },
    'three big days': { list: [spend(0, 700), spend(3, 700), spend(5, 700)], now: dayAt(10) },
    'runs out a day before the end': { list: steady(101.5, 20), now: dayAt(20) },
    'runs out 6 days before the end': { list: steady(125, 10), now: dayAt(10) },
    'fast, but only day 6': { list: steady(200, 6), now: dayAt(5.5) },
    'fast, day 7': { list: steady(200, 6), now: dayAt(6.2) },
    'allowance already gone': { list: steady(400, 9), now: dayAt(10) },
    'refunds count, as on Home': { list: [...steady(150, 10), E('Income', 600, dayAt(9.6).toISOString(), { category: 'Refund' })], now: dayAt(10) },
  };
  for (const [name, { list, now }] of Object.entries(scenarios)) {
    const r = read(list, now);
    ok(r.home === r.insights && (!r.alert || r.home === 'over'), `${name}: Home and Insights both say "${r.home}"${r.alert ? ', and the alert only shows when that is over pace' : ', no alert'}`);
  }
  const at10 = read(steady(150, 10), dayAt(10));
  ok(at10.alert && at10.alert.outDay === '2026-11-16' && at10.alert.early === 10
    && at10.alert.text === 'At this pace (~AED 150 a day) your allowance runs out around 16 Nov, 10 days early', `steady overspend: "${at10.alert?.text}"`);
  ok(read([spend(0, 1500)], dayAt(1.5)).home === 'over' && !read([spend(0, 1500)], dayAt(1.5)).alert, 'a day-1 spike is over pace, but no alert before day 7');
  ok(!read([spend(0, 1500), spend(2, 50), spend(4, 50)], dayAt(9.5)).alert, 'nor later: one payment over a quarter of the pot does not set the daily rate');
  ok(read(steady(90, 10), dayAt(10)).home === 'on' && read(steady(105, 10), dayAt(10)).home === 'on' && read(steady(40, 10), dayAt(10)).home === 'under', 'within the tolerance is on track; well under is under pace');
  ok(!read([spend(0, 700), spend(5, 700)], dayAt(10)).alert && read([spend(0, 700), spend(3, 700), spend(5, 700)], dayAt(10)).alert, 'needs spending on three different days');
  const late = read(steady(101.5, 20), dayAt(20));
  ok(late.home === 'over' && !late.alert && read(steady(125, 10), dayAt(10)).alert?.early === 6, 'over pace but running out under 3 days early: no alert; 6 days early: alert');
  ok(!read(steady(200, 6), dayAt(5.5)).alert && read(steady(200, 6), dayAt(6.2)).alert, 'the alert starts on the 7th day of the cycle');
  ok(read(steady(400, 9), dayAt(10)).home === 'spent' && !read(steady(400, 9), dayAt(10)).alert, 'allowance already gone: Home says over the allowance, no "runs out" alert');
  const ref = read([...steady(150, 10), E('Income', 600, dayAt(9.6).toISOString(), { category: 'Refund' })], dayAt(10));
  ok(ref.m.pace.spent === 900 && ref.home === 'on' && !ref.alert, 'a refund into the allowance account counts the same everywhere (900 used: on track, no alert)');
  // the same rule from summarize directly: Home's pace object is allowancePace
  const sum = summarize(steady(150, 10), '2026-11', S, []);
  ok(allowancePace(sum, '2026-11', S, dayAt(10)).runsOut.outDay === '2026-11-16', 'allowancePace works on a plain summary too');
  // dismissal: seen for the cycle until the day moves 3 or more days earlier
  const a = { outDay: '2026-11-16' }, seenAt = { cycle: '2026-11', outDay: '2026-11-16' };
  ok(paceSeen(a, '2026-11', seenAt) && paceSeen({ outDay: '2026-11-14' }, '2026-11', seenAt) && paceSeen({ outDay: '2026-11-20' }, '2026-11', seenAt), 'seen: the same day, 2 days earlier, or later stays quiet');
  ok(!paceSeen({ outDay: '2026-11-13' }, '2026-11', seenAt) && !paceSeen(a, '2026-12', seenAt) && !paceSeen(a, '2026-11', null), '3 days earlier, another cycle, or never seen: shows again');
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
// what Home, Insights and the alert say about pace right now (from the app's own modules)
const paceNow = (p) => p.evaluate(async () => {
  const [st, m, w] = await Promise.all([import('/js/store.js'), import('/js/model.js'), import('/js/weekly.js')]);
  const h = m.homeNumbers(st.state.entries, st.state.plan, st.state.settings, new Date(), st.state.dismissed);
  return { cyc: h.cyc, state: h.pace.state, alert: w.paceAlert(h.pace) };
});
// the pace alert is set aside the way a person would: by marking it seen
const paceAside = (p) => p.evaluate(async () => {
  const [st, m, w] = await Promise.all([import('/js/store.js'), import('/js/model.js'), import('/js/weekly.js')]);
  const h = m.homeNumbers(st.state.entries, st.state.plan, st.state.settings, new Date(), st.state.dismissed);
  const a = w.paceAlert(h.pace);
  if (a) st.saveExtra('weekly', { ...st.getExtra('weekly', {}), v: 1, pace: { cycle: h.cyc, outDay: a.outDay } }, 'x', { undoable: false });
});
// (to see the alert itself the test lowers the allowance setting for a moment: the pot is that setting plus top-ups)
const allowance = (p, v) => p.evaluate(async (v) => { const st = await import('/js/store.js'); st.state.settings = { ...st.state.settings, allowance: v }; }, v);

const p = await open('2026-11-02T10:00:00+04:00');
await setAside(p);
await paceAside(p);
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
ok(await p.$('[data-weekly="open"]') !== null, 'Monday: the week line is on Home when nothing else outranks it');
ok(await p.$$eval('.sub-line, .budget-nudge', (x) => x.length) === 1, 'Home still shows just one line');
// someone owes you, nothing else to say: the owed line ranks above the week summary (viewing an account, so it is not in the "Where your money is" card)
await p.evaluate(async () => {
  const st = await import('/js/store.js');
  st.saveExtra('people', { v: 1, names: ['Ahmed'] }, 'x', { undoable: false });
  st.addEntry({ type: 'Transfer', amount: 50, account: 'ADCB', toAccount: 'Ahmed', date: new Date().toISOString(), cycle: undefined });
});
await p.click('[data-focus="ADCB"]');
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]'); // a fresh Home draw, now on the ADCB account
await p.waitForSelector('.owed-line');
ok(await p.$('[data-weekly="open"]') === null && await p.$$eval('.sub-line, .budget-nudge', (x) => x.length) === 1, 'Monday with money owed: the owed line wins over the week summary');
await p.click('[data-focus="all"]');
await p.evaluate(async () => { // put it back for the checks below
  const st = await import('/js/store.js');
  st.deleteEntry(st.state.entries.find((e) => e.toAccount === 'Ahmed').id);
  st.saveExtra('people', { v: 1, names: [] }, 'x', { undoable: false });
});
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('[data-weekly="open"]');
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
await allowance(p, 1500); // the demo has spent about 755 in 6 days: at that rate it is gone well before the 26th
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.wk-line.warn');
const fast = await paceNow(p);
ok(fast.state === 'over' && fast.alert, 'the demo at a 1,500 allowance is over pace with a "runs out" day');
ok(await p.$$eval('.sub-line, .budget-nudge', (x) => x.length) === 1 && /^At this pace \(~AED [\d,]+ a day\) your allowance runs out around \d+ \w{3}, \d+ days early$/.test((await p.textContent('.wk-line')).trim()), `allowance running out outranks the week line, still one line: "${(await p.textContent('.wk-line')).trim()}"`);
ok(!(await p.$('[data-weekly="open"]')), 'and the week line waits');
ok(/over pace|over the allowance/.test(await p.textContent('.lens-meta')) && await p.$('.lens-meta .pace-bad'), 'Home\'s own pace line agrees: over pace');
// it ranks below a pay-later payment due soon
await p.evaluate(async () => {
  const st = await import('/js/store.js');
  const soon = { id: 'soon', provider: 'Cashew', merchant: 'Ikea', item: '', category: 'Shopping', total: 400, count: 2, cadence: '2w', first: '2026-11-05', account: 'ADCB', paid: [null, null], skip: [] };
  st.saveExtra('bnpl', { v: 1, plans: [soon] }, 'x', { undoable: false });
});
await p.waitForSelector('.bnpl-row');
ok(await p.$$eval('.sub-line, .budget-nudge', (x) => x.length) === 1 && !(await p.$('.wk-line')), 'a pay-later payment due this week outranks the pace alert');
await p.evaluate(async () => { (await import('/js/store.js')).saveExtra('bnpl', null, 'x', { undoable: false }); });
await p.waitForSelector('.wk-line.warn');
// tapping it opens Insights at the pace card, which agrees, and marks it seen without an Undo step
const undoPace = await p.evaluate(async () => (await import('/js/store.js')).lastAction());
await p.click('.wk-line.warn');
await p.waitForSelector('#pace');
ok(await p.isVisible('#pace'), 'tapping the pace line opens Insights at the Allowance pace card');
ok(await p.$('#pace .pace-bad') && /over pace|over the allowance/.test(await p.textContent('#pace .panel-sub')), 'the Insights card agrees: over pace');
const seenPace = await p.evaluate(async () => (await import('/js/store.js')).getExtra('weekly', null));
ok(seenPace?.v === 1 && seenPace.pace?.cycle === fast.cyc && seenPace.pace.outDay === fast.alert.outDay, `tapping saves { pace: { cycle, outDay } } in the weekly extra (${JSON.stringify(seenPace)})`);
ok(await p.evaluate(async () => (await import('/js/store.js')).lastAction()) === undoPace, 'marking it seen adds no Undo step');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
ok(!(await p.$('.wk-line.warn')), 'once seen, the pace alert is gone from Home');
ok(await p.$('.lens-meta .pace-bad'), 'while Home\'s pace line still says over pace');
// it gets worse: spending today moves the day it runs out 3 or more days earlier, and the alert is back
await p.evaluate(async () => {
  const st = await import('/js/store.js');
  for (const amount of [150, 150, 150]) st.addEntry({ type: 'Spend', amount, account: st.state.settings.allowanceAccount, category: 'Shopping', merchant: 'Test', date: new Date().toISOString() });
});
const worse = await paceNow(p);
await p.click('.tabbar [data-tab="insights"]');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
const moved = worse.alert ? Math.round((Date.parse(fast.alert.outDay) - Date.parse(worse.alert.outDay)) / 864e5) : null;
ok(worse.alert && moved >= 3 && await p.$('.wk-line.warn'), `when the day moves ${moved} days earlier (${fast.alert.outDay} → ${worse.alert?.outDay}) the alert shows again`);
// set it right: back to the usual allowance, everything agrees on track and there is no alert
await allowance(p, 1e6);
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('#pace');
ok(/On track/.test(await p.textContent('#pace .panel-sub')), 'with room in the allowance Insights says On track');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
ok(/On track/.test(await p.textContent('.lens-meta')) && !(await p.$('.wk-line.warn')), 'and so does Home, with no alert');
await allowance(p, 3000);
await p.close();

// Wednesday: no week line
{
  const w = await open('2026-11-04T10:00:00+04:00');
  await setAside(w);
  await paceAside(w);
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
  ok(!(await w.evaluate(async () => (await import('/js/store.js')).getExtra('weekly', null)?.seen)), 'opening it outside Monday and Tuesday marks no week seen');
  await w.close();
}
ok(!errors.length, 'no page errors');
await b.close();
console.log(`all ${n} weekly checks passed`);
