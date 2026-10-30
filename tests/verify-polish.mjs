// Regression checks for the whole-app audit fixes (branch claude/polish):
//  1 a BNPL plan (and a person) follows an account rename, and undo reverses it
//  2 account names are escaped on Home and in Insights
//  3 a 21st account is refused with a message (app), and the sheet refuses rather than truncating (Code.gs)
//  4 BNPL instalments are never a "subscription"
//  5 Net worth rows add up to the total
//  6 Insights "By account" and the report use the same accounts and add up to Spent
//  7 a settings change queued while the sheet is being read is not overwritten by the sheet's copy
//  8 the report's allowance "left" for this cycle is Home's number
//  9 CSV keeps negative amounts as numbers, still guards text
// Usage: (cd docs && python3 -m http.server 8765 &) ; BASE=http://localhost:8765 node tests/verify-polish.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEnv } from './fake-sheet.mjs';
import {
  DEFAULT_SETTINGS, DEFAULT_PLAN, DEFAULT_ACCOUNTS, setAccountList, setPeopleList, cycleOf, toAED, toCSV, summarize, spentByAccount,
} from '../docs/js/model.js';
import { remapBnplAccounts } from '../docs/js/bnpl.js';
import { remapPeopleNames } from '../docs/js/people.js';
import { detectRecurring } from '../docs/js/recurring.js';

const require = createRequire(import.meta.url);
const BASE = process.env.BASE || 'http://localhost:8765';
let n = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { n++; console.log('PASS ', msg); } else { failed++; console.log('FAIL ', msg); } };
const S = { ...DEFAULT_SETTINGS };
let k = 0;
const E = (type, amount, account, date, extra = {}) => {
  const e = { id: `t${++k}`, type, amount, currency: 'AED', account, toAccount: '', category: type === 'Spend' ? 'Groceries' : type === 'Income' ? 'Other' : '', merchant: '', note: '', source: 'App', status: 'OK', date: new Date(date).toISOString(), ...extra };
  e.cycle = cycleOf(e.date, S.cycleStart);
  e.amountAED = toAED({ ...e, amountAED: null }, S);
  return e;
};

/* ── Pure parts (Node) ── */
setAccountList(DEFAULT_ACCOUNTS);

// 1: the remap helpers
const bx = { v: 1, plans: [{ id: 'a', account: 'ADCB' }, { id: 'b', account: 'ADIB' }] };
const bm = remapBnplAccounts(bx, 'ADCB', 'ADCB Card');
ok(bm && bm.plans[0].account === 'ADCB Card' && bm.plans[1].account === 'ADIB' && bx.plans[0].account === 'ADCB', '1 remapBnplAccounts renames only that account, without editing the old value');
ok(remapBnplAccounts(bx, 'Cash', 'X') === null && remapBnplAccounts(null, 'a', 'b') === null, '1 remapBnplAccounts: nothing to change is null');
ok(JSON.stringify(remapPeopleNames({ v: 1, names: ['Sara', 'Omar'] }, 'Sara', 'Sarah')) === '{"v":1,"names":["Sarah","Omar"]}' && remapPeopleNames({ v: 1, names: ['Omar'] }, 'Sara', 'X') === null, '1 remapPeopleNames follows a person\'s rename');

// 4: BNPL instalments are not subscriptions
{
  const now = new Date('2026-10-20T12:00:00+04:00');
  const monthly = (m, extra) => [0, 1, 2, 3].map((i) => E('Spend', 99, 'ADIB', `2026-${String(6 + i).padStart(2, '0')}-10T10:00:00+04:00`, { merchant: m, category: 'Shopping', ...extra }));
  const subs = detectRecurring([...monthly('Tabby · Noon', { source: 'BNPL' }), ...monthly('Netflix', {})], S, { now });
  ok(subs.some((s) => /netflix/i.test(s.name)), '4 a real monthly payment is still found as a subscription');
  ok(!subs.some((s) => /tabby/i.test(s.name)), '4 a plan\'s instalments (source BNPL) are not a subscription');
}

// 6: one account list that adds up to Spent
{
  setPeopleList(['Sara']);
  setAccountList([...DEFAULT_ACCOUNTS, { name: 'Old', note: '', color: 'graphite', wallet: '', archived: true }, { name: 'Sara', note: 'Person', color: 'graphite', wallet: '', archived: false }]);
  const ents = [E('Spend', 10.4, 'ADIB', '2026-10-05T10:00:00+04:00'), E('Spend', 20.4, 'ADCB', '2026-10-05T10:00:00+04:00'),
    E('Spend', 30.4, 'Old', '2026-10-05T10:00:00+04:00'), E('Spend', 40.4, 'Sara', '2026-10-05T10:00:00+04:00')];
  const sum = summarize(ents, '2026-10', S, []);
  const rows = spentByAccount(sum);
  ok(rows.filter((r) => !r.other).map((r) => r.id).join() === 'ADIB,ADCB,BOTIM,Cash', '6 By account lists your active accounts');
  ok(rows.find((r) => r.other)?.spent === 70.8, '6 a removed account and a friend who paid go in one "Everything else" row');
  ok(rows.reduce((a, r) => a + r.shown, 0) === Math.round(sum.spent), `6 the shown rows add up to Spent (${Math.round(sum.spent)})`);
  setPeopleList([]);
  setAccountList(DEFAULT_ACCOUNTS);
}

// 8: report allowance "left" = Home's (built here, checked in the app below, where report.js can load)
const allow8 = (() => {
  const ents = [E('Adjustment', 8000, 'ADIB', '2026-10-07T09:00:00+04:00'), E('Adjustment', 1200, 'ADCB', '2026-10-07T09:00:00+04:00')];
  const plan = DEFAULT_PLAN.filter((p) => p.kind !== 'Responsibility');
  const now = '2026-10-07T13:00:00+04:00';
  const cyc = cycleOf(new Date(now), S.cycleStart);
  return { ents, plan, now, cyc, dis: { salary: cyc, nafis: cyc, allowance: cyc }, S };
})();

// 9: CSV
{
  const csv = toCSV([{ id: 'x', type: 'Income', amount: -12.5, amountAED: -12.5, merchant: '-Refund', note: '=HYPERLINK("x")', category: '+bad', account: '@a' }]);
  const row = csv.split('\n')[1].split(',');
  ok(row[4] === '-12.5' && row[6] === '-12.5', '9 negative amounts stay numbers in the CSV');
  ok(csv.includes("'-Refund") && csv.includes("'+bad") && csv.includes("'@a") && csv.includes(`"'=HYPERLINK(""x"")"`), '9 text columns starting with = + - @ are still guarded');
  ok(toCSV([{ amount: '=1+1' }]).split('\n')[1].split(',')[4] === "'=1+1", '9 a formula in an amount column is still guarded');
}

// 3: the sheet refuses a 21st account instead of quietly dropping it
{
  const { ctx } = makeEnv();
  ctx.setup();
  const token = ctx.getToken_();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).text);
  const accs = post({ action: 'list' }).accounts;
  const twenty = [...accs, ...Array.from({ length: 20 - accs.length }, (_, i) => ({ name: `Acc${i}`, note: '', color: 'graphite', wallet: '' }))];
  ok(post({ action: 'accounts', accounts: twenty }).accounts.length === 20, '3 the sheet keeps 20 accounts');
  const r = post({ action: 'accounts', accounts: [...twenty, { name: 'Twentyone', note: '', color: 'graphite', wallet: '' }] });
  ok(r.ok === false && /up to 20/.test(r.error), '3 a 21st account is refused with a message');
  ok(post({ action: 'list' }).accounts.length === 20, '3 ...and the sheet\'s list is left as it was');
}

/* ── The app (demo) ── */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const pg = await c.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('dialog', (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });
const store = (fn, arg) => pg.evaluate(async ([src, a]) => { const s = await import('/js/store.js'); const m = await import('/js/model.js'); return new Function('s', 'm', 'a', `return (${src})(s, m, a)`)(s, m, a); }, [fn.toString(), arg]);
await pg.goto(`${BASE}/?demo=1&notour=1`);
await pg.waitForSelector('.lens');

// 8: the report's allowance left for this cycle (allowance move dismissed, 1,800 spent before tracking) is Home's
{
  const r = await pg.evaluate(async (x) => {
    const m = await import('/js/model.js'), rp = await import('/js/report.js');
    const now = new Date(x.now);
    const home = m.homeNumbers(x.ents, x.plan, x.S, now, x.dis);
    return { home: home.allowLeft, report: rp.cycleReport(x.ents, x.cyc, x.S, x.plan, null, now, [], x.dis).allowance.left, plain: m.summarize(x.ents, x.cyc, x.S, x.plan).allowanceLeft };
  }, allow8);
  ok(r.home === 1200 && r.report === r.home && r.plain !== r.home, `8 report allowance left is Home's Safe-to-spend basis (${r.report} vs Home ${r.home}; plain summary ${r.plain})`);
}

// 1: rename an account a plan pays from
{
  const before = await store((s) => s.state.extras.bnpl.plans.map((p) => p.account));
  const from = before[0];
  await store((s, m, a) => s.updateAccount(a, { name: `${a} New` }), from);
  const after = await store((s) => s.state.extras.bnpl.plans.map((p) => p.account));
  ok(after.every((x, i) => x === (before[i] === from ? `${from} New` : before[i])), `1 renaming ${from} carries its BNPL plans to "${from} New"`);
  await store((s) => s.undo());
  const back = await store((s) => s.state.extras.bnpl.plans.map((p) => p.account));
  ok(JSON.stringify(back) === JSON.stringify(before), '1 one undo renames back and the plans follow');
}

// 2: an account called <img onerror> on Home and Insights
{
  await store((s) => s.addAccount({ name: '<img src=x onerror=alert(1)>' }));
  await pg.evaluate(() => { location.hash = '#home'; });
  await pg.waitForSelector('.key-acc');
  await pg.locator('.key-acc', { hasText: '<img' }).first().click();
  await pg.waitForFunction(() => document.querySelector('.lens-label')?.textContent.includes('<img'));
  ok(await pg.locator('.lens img, .key-acc img').count() === 0, '2 Home shows the account name as text, not HTML');
  await pg.click('.tabbar [data-tab="insights"]');
  await pg.waitForSelector('.hb-row');
  ok(await pg.locator('.hb-row img').count() === 0 && (await pg.locator('.hb-name', { hasText: '<img' }).count()) === 1, '2 Insights By account shows the name as text');
}

// 6: Insights By account adds up to Spent
{
  const vals = await pg.$$eval('.hb-row', (rows) => rows.filter((r) => r.closest('.panel')?.querySelector('.panel-title')?.textContent === 'By account').map((r) => +r.querySelector('.hb-val').textContent.replace(/[^\d.-]/g, '')));
  const spent = Math.round(+(await pg.getAttribute('.donut', 'data-total')));
  ok(vals.length > 0 && vals.reduce((a, v) => a + v, 0) === spent, `6 Insights By account rows add up to Spent (${vals.reduce((a, v) => a + v, 0)} vs ${spent})`);
}

// 5: Net worth rows add up to the total
{
  await store((s) => s.saveExtra('investments', { v: 1, items: [{ name: 'Fund A', value: 100.4, asOf: '' }, { name: 'Fund B', value: 200.4, asOf: '' }, { name: 'Fund C', value: 300.4, asOf: '' }] }));
  await pg.waitForFunction(() => document.querySelectorAll('#networth-card .nw-row').length >= 4);
  const { rows, total } = await pg.evaluate(() => ({
    rows: [...document.querySelectorAll('#networth-card .nw-row b')].map((x) => (x.textContent.includes('−') ? -1 : 1) * +x.textContent.replace(/[^\d.]/g, '')),
    total: (() => { const t = document.querySelector('.nw-total').textContent; return (t.includes('−') ? -1 : 1) * +t.replace(/[^\d.]/g, ''); })(),
  }));
  ok(rows.reduce((a, v) => a + v, 0) === total, `5 Net worth rows add up to the total shown (${rows.join(' + ')} = ${total})`);
}

// 3: the 21st account is refused in the app with a message
{
  const r = await store((s) => { const out = []; while (s.state.accounts.length < s.MAX_ACCOUNTS) out.push(s.addAccount({ name: `Extra ${s.state.accounts.length}` })); return { last: s.addAccount({ name: 'One too many' }), n: s.state.accounts.length, max: s.MAX_ACCOUNTS }; });
  ok(r.n === 20 && r.max === 20 && /up to 20/.test(r.last?.error || ''), `3 addAccount refuses a 21st account: "${r.last?.error}"`);
  await pg.evaluate(() => { location.hash = '#settings'; });
  const { addPerson } = { addPerson: null };
  const p = await pg.evaluate(async () => (await import('/js/people-ui.js')).addPerson('Late friend'));
  ok(/up to 20/.test(p.error || ''), '3 adding a person uses the same limit');
}
await b.close();

/* 7: a settings save made while the sheet is being read survives the read */
{
  const { ctx } = makeEnv();
  ctx.setup();
  const token = ctx.getToken_();
  const b2 = await chromium.launch();
  const c2 = await b2.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  let holdList = null;
  await c2.route('https://script.google.com/**', async (route) => {
    const body = route.request().postData();
    const action = JSON.parse(body).action;
    if (action === 'list' && holdList) await holdList.promise;
    const out = ctx.doPost({ postData: { contents: body } });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text }).catch(() => {});
  });
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  const st = (fn, arg) => p2.evaluate(async ([src, a]) => { const s = await import('/js/store.js'); return new Function('s', 'a', `return (${src})(s, a)`)(s, a); }, [fn.toString(), arg]);
  await p2.goto(`${BASE}/?notour=1#settings`);
  await p2.fill('input[name="url"]', 'https://script.google.com/macros/s/TEST/exec');
  await p2.fill('input[name="token"]', token);
  await p2.click('[data-act="connect"]');
  await p2.waitForSelector('.status-row .row-title:text("Connected")');
  await p2.waitForFunction(async () => { const s = await import('/js/store.js'); return true; });
  const waitOk = async () => { for (let i = 0; i < 100; i++) { if (await st((s) => s.state.sync.status === 'ok' && !s.state.outbox.length)) return; await new Promise((r) => setTimeout(r, 100)); } };
  await waitOk();
  let release; holdList = { promise: new Promise((r) => { release = r; }) };
  const reading = st((s) => s.sync());   // reads the sheet; the reply is held
  await new Promise((r) => setTimeout(r, 300));
  await st((s) => s.saveSettings({ usdRate: 3.7 })); // saved while the read is on its way
  release(); holdList = null;
  await reading;
  ok(await st((s) => s.state.settings.usdRate) === 3.7, '7 a settings change saved during a read is not overwritten by the sheet\'s older copy');
  await waitOk();
  ok(await st((s) => s.state.settings.usdRate) === 3.7, '7 ...and it reaches the sheet');
  await b2.close();
}

ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
console.log(failed ? `FAIL  ${failed} failed, ${n} passed` : `${n} checks passed`);
process.exit(failed ? 1 : 0);
