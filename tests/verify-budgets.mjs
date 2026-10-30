// Category budgets: the maths (docs/js/budgets.js), then Settings, Insights and Home in demo mode.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-budgets.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS, cycleOf, cycleBounds, summarize, setCategoryList } from '../docs/js/model.js';
import { limitsOf, statusOf, budgetRows, worstBudget, pctText, budgetNudge, budgetNotice, budgetsCard, budgetsSettingsRows, leftText, addableCategories } from '../docs/js/budgets.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const near = (a, b) => Math.abs(a - b) < 0.005;

// ── maths
const S = { ...DEFAULT_SETTINGS, usdRate: 3.6725 };
const cyc = '2026-11';
const { start } = cycleBounds(cyc, S.cycleStart);
let id = 0;
const E = (type, amount, day, extra = {}) => {
  const date = new Date(start.getTime() + day * 864e5 + 10 * 3600e3).toISOString();
  return { id: `b${++id}`, type, amount, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Food & Drinks', merchant: '', note: '', status: 'OK', date, cycle: cycleOf(date, S.cycleStart), ...extra };
};
const entries = [
  E('Spend', 300, 1), E('Spend', 100, 2, { currency: 'USD', amount: 10 }), // 300 + 36.725
  E('Spend', 450, 3, { category: 'Groceries' }),
  E('Transfer', 5000, 0, { account: 'ADIB', toAccount: 'ADCB', category: 'Food & Drinks' }),
  E('Income', 50, 4, { category: 'Refund' }),
  E('Spend', 999, 0, { cycle: '2026-10' }),
];
const sum = summarize(entries, cyc, S, []);

ok(statusOf(79.99, 100) === 'ok' && statusOf(80, 100) === 'near' && statusOf(99.99, 100) === 'near' && statusOf(100, 100) === 'over', 'status flips at 80% and at 100%');
ok(statusOf(5, 0) === 'ok', 'a zero limit never divides by zero');
const limits = limitsOf({ v: 1, limits: { 'Food & Drinks': 400, Groceries: '450', Travel: 0, Health: -5, Other: 'abc', 'Old Category': 100 } });
ok(JSON.stringify(Object.keys(limits).sort()) === JSON.stringify(['Food & Drinks', 'Groceries', 'Old Category']), 'bad or empty limits are dropped');
ok(Object.keys(limitsOf(null)).length === 0 && Object.keys(limitsOf({ v: 1 })).length === 0 && Object.keys(limitsOf('x')).length === 0, 'no saved budgets gives an empty map');
const rows = budgetRows(sum.byCategory, limits);
ok(rows.map((r) => r.id).join('|') === 'Food & Drinks|Groceries|Old Category', 'rows follow the usual category order, unknown ids last');
const food = rows[0];
ok(Math.abs(food.spent - 336.725) < 0.01 && Math.abs(food.left - 63.275) < 0.01 && food.status === 'near' && pctText(food) === '84%', 'spent counts USD in AED, ignores transfers, refunds and other cycles');
ok(rows[1].status === 'over' && near(rows[1].left, 0) === true && pctText(rows[1]) === '100%', 'exactly at the limit counts as over');
ok(rows[2].spent === 0 && rows[2].meta.short === 'Old Category' && rows[2].status === 'ok', 'an unknown category id is tolerated');
const w = worstBudget(rows);
ok(w.row.id === 'Groceries' && w.more === 1, 'Home picks the fullest budget and counts the rest');
ok(worstBudget([rows[2]]) === null && budgetNudge([rows[2]]) === '', 'nothing flagged means no Home line');
ok(!/<script/.test(budgetNudge(budgetRows(new Map([['<script>', 500]]), { '<script>': 100 }))), 'names are escaped');
ok(/Set a category limit/.test(budgetsCard([])) && /Category budgets/.test(budgetsCard([])) && !/bg-row/.test(budgetsCard([])), 'no budgets shows a prompt, not bars');
ok(pctText({ ratio: 0.999 }) === '99%', 'percent is rounded down');

// ── names, hidden and custom categories, wording
setCategoryList({ custom: [{ id: 'Coffee', type: 'Spend', icon: 'fork' }], hidden: ['Travel', 'Groceries'], names: { 'Food & Drinks': 'Eating <out>' } });
{
  const lim = { Travel: 100, 'Food & Drinks': 100, Coffee: 50 };
  const by = new Map([['Travel', 60], ['Food & Drinks', 130], ['Coffee', 10]]);
  const rr = budgetRows(by, lim);
  const trav = rr.find((r) => r.id === 'Travel'), eat = rr.find((r) => r.id === 'Food & Drinks'), cof = rr.find((r) => r.id === 'Coffee');
  ok(trav.meta.icon !== 'dots' && trav.meta.slot > 0 && trav.meta.label === 'Travel', 'a limit on a hidden category keeps its icon, colour and name');
  ok(eat.meta.label === 'Eating <out>' && cof.meta.icon === 'fork', 'renamed and custom categories keep their label and icon');
  const html = budgetsCard(rr) + budgetNudge(rr) + budgetsSettingsRows(lim, by);
  ok(html.includes('Eating &lt;out&gt;') && !html.includes('Eating <out>'), 'the renamed label is shown, escaped, in Insights, Home and Settings');
  ok(budgetsSettingsRows({}, by).match(/data-budget-edit/g) === null && /data-budget-add/.test(budgetsSettingsRows({}, by)), 'with no limits Settings shows only the Add a limit row');
  ok((budgetsSettingsRows(lim, by).match(/data-budget-edit/g) || []).length === 3, 'Settings lists only categories that have a limit');
  ok(!addableCategories(lim).some((c) => c.id === 'Travel' || c.id === 'Groceries' || c.id in lim), 'the chooser offers shown categories without a limit, never hidden ones');
  ok(addableCategories(lim).some((c) => c.id === 'Health') , 'the chooser offers a shown category that has none');
}
setCategoryList(null);
ok(leftText({ left: -0.4 }) === 'AED 0.40 over' && leftText({ left: -12.4 }) === 'AED 12 over' && leftText({ left: 0 }) === 'At the limit' && leftText({ left: 0.4 }) === 'AED 0.40 left', 'a red row never says "AED 0 over"');
{
  const mk = (...pairs) => budgetRows(new Map(pairs), Object.fromEntries(pairs.map(([k]) => [k, 100])));
  const n1 = budgetNotice(mk(['Groceries', 120], ['Health', 90], ['Travel', 85]));
  ok(n1.priority === 'over' && /^Groceries is over its limit by AED 20, and 2 more are close or over$/.test(n1.text), 'the notice says "and 2 more" and is over-priority when one is over');
  const n2 = budgetNotice(mk(['Health', 90]));
  ok(n2.priority === 'near' && n2.text === 'Health is at 90% of its limit', 'a near notice says the percent');
  ok(budgetNotice(mk(['Groceries', 120]), { isCurrent: false }) === null && budgetNudge(mk(['Groceries', 120]), { isCurrent: false }) === '', 'no notice for a past cycle');
  ok(budgetNotice(mk(['Groceries', 10])) === null, 'no notice while everything is under 80%');
}

// ── the real app
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const URL = process.env.APP_URL || ((process.env.BASE || 'http://localhost:8765').replace(/\/$/, '') + '/');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${URL}?demo=1#insights`);
await p.waitForSelector('.panel');
ok(await p.isVisible('.budgets-card.empty-budgets'), 'Insights shows a prompt while no budget is set');
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.lens');
ok(!(await p.$('.budget-nudge')), 'Home is quiet while no budget is set');

// pick a category the demo has spent in this cycle
const food2 = await p.evaluate(async () => {
  const [st, m] = await Promise.all([import('/js/store.js'), import('/js/model.js')]);
  const cyc = m.cycleOf(new Date(), st.state.settings.cycleStart);
  const by = m.summarize(st.state.entries, cyc, st.state.settings).byCategory;
  const top = [...by].filter(([k]) => k !== 'Uncategorised').sort((a, c) => c[1] - a[1])[0];
  return { id: top[0], spent: top[1] };
});
ok(food2.spent > 0, `the demo has spending to budget against (${food2.id})`);

// set a limit through Settings
await p.click('.tabbar [data-tab="settings"]');
await p.waitForSelector('[data-budget-add]');
ok(await p.$$eval('[data-budget-edit]', (x) => x.length) === 0 && await p.isVisible('[data-budget-add]'), 'Settings starts with just an Add a limit row');
ok(/Category limits/.test(await p.textContent('#budgets')), 'the Settings block is called Category limits');
await p.click('[data-budget-add]');
await p.waitForSelector('[data-pick]');
ok(await p.$$eval('[data-pick]', (x) => x.length) === (await p.evaluate(async () => (await import('/js/model.js')).SPEND_CATEGORIES.length)), 'the chooser lists the shown categories');
await p.click(`[data-pick="${food2.id}"]`);
await p.waitForSelector('#bf-amount');
ok(/Refunds aren/.test(await p.textContent('.sheet .group-foot')), 'the sheet footer explains refunds');
await p.fill('#bf-amount', String(Math.ceil(food2.spent / 0.9))); // about 90% used
await p.click('[data-act="save"]');
await p.waitForSelector('#bf-amount', { state: 'detached' });
const saved = await p.evaluate(async (cid) => (await import('/js/store.js')).getExtra('budgets', null)?.limits?.[cid], food2.id);
ok(saved === Math.ceil(food2.spent / 0.9), 'saving writes { v: 1, limits } to the budgets extra');
ok(await p.$$eval('[data-budget-edit]', (x) => x.length) === 1, 'Settings now lists the one limit');
ok((await p.textContent(`[data-budget-edit="${food2.id}"] b`)).replace(/,/g, '') === String(saved), 'the Settings row shows the new limit');

// Insights
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.bg-row');
ok(await p.$$eval('.bg-row', (x) => x.length) === 1, 'Insights shows one bar for the one budget');
ok(await p.$eval('.bg-row', (el) => el.classList.contains('near')), 'about 90% reads as near');
ok(/^\d+%$/.test(await p.textContent('.bg-pct')) && /left/.test(await p.textContent('.bg-left')), 'the bar shows a percent and what is left');

// Home shows one notice at a time; the demo's subscriptions would outrank a "near" budget, so set them aside
await p.evaluate(async () => {
  const [st, r] = await Promise.all([import('/js/store.js'), import('/js/recurring.js')]);
  st.saveExtra('recurring', { v: 1, ignored: [...new Set(st.state.entries.map((e) => r.recurringKey(e.merchant)).filter(Boolean))] });
});
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.budget-nudge');
ok(/is at \d+% of its limit/.test(await p.textContent('.budget-nudge')), 'Home says the category is at N% of its limit');
ok(await p.$$eval('.budget-nudge', (x) => x.length) === 1, 'Home shows just the one line');

// over the limit, then undo and clear
await p.evaluate(async (cid) => { (await import('/js/budgets-settings.js')).setLimit(cid, 1); }, food2.id);
await p.waitForSelector('.budget-nudge.over');
await p.evaluate(async () => (await import('/js/store.js')).saveExtra('recurring', null)); // subscriptions back
await p.waitForTimeout(300);
ok(await p.$$eval('.budget-nudge, .sub-line', (x) => x.length) === 1 && await p.$('.budget-nudge.over'), 'over a limit outranks a subscription: still one line on Home');
await p.evaluate(async () => (await import('/js/store.js')).undo()); // subscriptions set aside again
ok(/over its limit by AED/.test(await p.textContent('.budget-nudge')), 'over the limit says by how much');
await p.evaluate(async () => { (await import('/js/store.js')).undo(); });
await p.waitForSelector('.budget-nudge:not(.over)');
ok(true, 'undo puts the previous limit back');

// Home's notice opens Insights on the current cycle, even after browsing back
await p.evaluate(async (cid) => { (await import('/js/budgets-settings.js')).setLimit(cid, 1); }, food2.id);
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.bg-row');
await p.evaluate(async () => { (await import('/js/insights.js')).shiftInsights(-1); });
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.budget-nudge');
await p.click('.budget-nudge');
await p.waitForSelector('.bg-row');
ok(await p.evaluate(async () => { const [i, st, m] = await Promise.all([import('/js/insights.js'), import('/js/store.js'), import('/js/model.js')]); return i.insightsShown() === m.cycleOf(new Date(), st.state.settings.cycleStart); }), 'tapping the Home notice opens Insights on the current cycle');
ok(/This cycle so far/.test(await p.textContent('.budgets-card .panel-sub')), 'the Insights card says it is this cycle');

// a limit on a hidden category and on a renamed one keep their look and name
await p.evaluate(async (cid) => {
  const [st, bs] = await Promise.all([import('/js/store.js'), import('/js/budgets-settings.js')]);
  bs.setLimit('Travel', 500);
  st.saveExtra('categories', { v: 1, custom: [], hidden: ['Travel', cid], names: { [cid]: 'Eating "out"' } }, 'Categories');
}, food2.id);
await p.click('.tabbar [data-tab="settings"]');
await p.waitForSelector('[data-budget-edit]');
const hid = await p.$eval('[data-budget-edit="Travel"]', (el) => ({ t: el.textContent, icon: !!el.querySelector('svg') }));
ok(/Travel/.test(hid.t) && hid.icon, 'Settings still shows a limit on a hidden category, with its icon');
ok(/Eating "out"/.test(await p.textContent(`[data-budget-edit="${food2.id}"]`)), 'Settings shows the renamed label');
await p.click(`[data-budget-edit="${food2.id}"]`);
await p.waitForSelector('#bf-amount');
ok(/Eating "out" limit/.test(await p.textContent('.sheet-title')), 'the sheet title uses the label');
await p.click('.sheet [data-act="cancel"]');
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.bg-row');
ok((await p.$$eval('.bg-name b', (x) => x.map((e) => e.textContent))).includes('Eating "out"'), 'Insights shows the renamed label');
ok(await p.evaluate(async (cid) => {
  const [st, m, rp] = await Promise.all([import('/js/store.js'), import('/js/model.js'), import('/js/report.js')]);
  const cyc = m.cycleOf(new Date(), st.state.settings.cycleStart);
  const r = rp.cycleReport(st.state.entries, cyc, st.state.settings, st.state.plan, st.getExtra('budgets', null));
  return r.budgets.some((b) => b.id === cid && b.name === 'Eating "out"') && r.budgets.some((b) => b.id === 'Travel');
}, food2.id), 'a saved limit appears in the monthly report, under the category\'s label');
await p.evaluate(async () => { (await import('/js/store.js')).saveExtra('categories', null); (await import('/js/budgets-settings.js')).setLimit('Travel', null); });

// deleting a custom category also clears its limit, in one undo step
await p.evaluate(async () => {
  const st = await import('/js/store.js');
  st.saveExtra('categories', { v: 1, custom: [{ id: 'Gym', type: 'Spend', icon: 'dots' }], hidden: [], names: {} }, 'Categories');
  (await import('/js/budgets-settings.js')).setLimit('Gym', 80);
});
await p.click('.tabbar [data-tab="settings"]');
await p.waitForSelector('[data-budget-edit="Gym"]');
await p.click('[data-cat-edit="Gym"]');
await p.click('.sheet [data-act="delete"]');
await p.waitForSelector('[data-budget-edit="Gym"]', { state: 'detached' });
ok(await p.evaluate(async () => !('Gym' in ((await import('/js/store.js')).getExtra('budgets', null)?.limits || {}))), 'deleting a custom category clears its limit');
await p.evaluate(async () => { (await import('/js/store.js')).undo(); });
ok(await p.evaluate(async () => { const st = await import('/js/store.js'); return st.getExtra('budgets', null)?.limits?.Gym === 80 && st.getExtra('categories', null)?.custom?.some((c) => c.id === 'Gym'); }), 'one undo brings back both the category and its limit');
await p.evaluate(async () => { const st = await import('/js/store.js'); st.saveExtra('categories', null); (await import('/js/budgets-settings.js')).setLimit('Gym', null); });
await p.evaluate(async (cid) => { (await import('/js/budgets-settings.js')).setLimit(cid, null); }, food2.id);
await p.waitForFunction(() => !document.querySelector('.budget-nudge'));
ok((await p.evaluate(async () => (await import('/js/store.js')).getExtra('budgets', 'none'))) === 'none', 'clearing the last limit removes the extra');
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.panel');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');
ok(!errors.length, 'no page errors');
await b.close();
console.log(`all ${n} budget checks passed`);
