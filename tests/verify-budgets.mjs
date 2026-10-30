// Category budgets: the maths (docs/js/budgets.js), then Settings, Insights and Home in demo mode.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-budgets.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS, cycleOf, cycleBounds, summarize } from '../docs/js/model.js';
import { limitsOf, statusOf, budgetRows, worstBudget, pctText, budgetNudge, budgetsCard } from '../docs/js/budgets.js';

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
ok(/Set a budget/.test(budgetsCard([])) && !/bg-row/.test(budgetsCard([])), 'no budgets shows a prompt, not bars');
ok(pctText({ ratio: 0.999 }) === '99%', 'percent is rounded down');

// ── the real app
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const URL = process.env.APP_URL || 'http://localhost:8765/';
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
await p.waitForSelector('[data-budget-edit]');
ok(await p.$$eval('[data-budget-edit]', (x) => x.length) >= 10, 'Settings lists every spending category');
await p.click(`[data-budget-edit="${food2.id}"]`);
await p.waitForSelector('#bf-amount');
await p.fill('#bf-amount', String(Math.ceil(food2.spent / 0.9))); // about 90% used
await p.click('[data-act="save"]');
await p.waitForSelector('#bf-amount', { state: 'detached' });
const saved = await p.evaluate(async (cid) => (await import('/js/store.js')).getExtra('budgets', null)?.limits?.[cid], food2.id);
ok(saved === Math.ceil(food2.spent / 0.9), 'saving writes { v: 1, limits } to the budgets extra');
ok((await p.textContent(`[data-budget-edit="${food2.id}"] b`)).replace(/,/g, '') === String(saved), 'the Settings row shows the new limit');

// Insights
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.bg-row');
ok(await p.$$eval('.bg-row', (x) => x.length) === 1, 'Insights shows one bar for the one budget');
ok(await p.$eval('.bg-row', (el) => el.classList.contains('near')), 'about 90% reads as near');
ok(/^\d+%$/.test(await p.textContent('.bg-pct')) && /left/.test(await p.textContent('.bg-left')), 'the bar shows a percent and what is left');

// Home
await p.click('.tabbar [data-tab="home"]');
await p.waitForSelector('.budget-nudge');
ok(/is at \d+% of its budget/.test(await p.textContent('.budget-nudge')), 'Home says the category is at N% of its budget');
ok(await p.$$eval('.budget-nudge', (x) => x.length) === 1, 'Home shows just the one line');

// over the limit, then undo and clear
await p.evaluate(async (cid) => { (await import('/js/budgets-settings.js')).setLimit(cid, 1); }, food2.id);
await p.waitForSelector('.budget-nudge.over');
ok(/over its budget by AED/.test(await p.textContent('.budget-nudge')), 'over the limit says by how much');
await p.evaluate(async () => { (await import('/js/store.js')).undo(); });
await p.waitForSelector('.budget-nudge:not(.over)');
ok(true, 'undo puts the previous limit back');
await p.evaluate(async (cid) => { (await import('/js/budgets-settings.js')).setLimit(cid, null); }, food2.id);
await p.waitForFunction(() => !document.querySelector('.budget-nudge'));
ok((await p.evaluate(async () => (await import('/js/store.js')).getExtra('budgets', 'none'))) === 'none', 'clearing the last limit removes the extra');
await p.click('.tabbar [data-tab="insights"]');
await p.waitForSelector('.panel');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');
ok(!errors.length, 'no page errors');
await b.close();
console.log(`all ${n} budget checks passed`);
