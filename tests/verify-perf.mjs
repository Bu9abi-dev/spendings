// Performance guard: the app on a big ledger (3,000 entries over 3 years) with the CPU slowed 4x,
// as on an older iPhone. Times Home, tab switches, the add sheet and typing in Activity search.
// Budgets are deliberately generous (several times what a slow CI box needs) so this catches a regression
// back to per-render full scans, not noise. Set PERF_REPORT=1 to print the numbers without asserting.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-perf.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const REPORT = !!process.env.PERF_REPORT;
const THROTTLE = 4;
const N = +(process.env.PERF_ENTRIES || 3000);

// milliseconds, at 4x CPU throttle, 3,000 entries
// (before the perf pass on this machine: activity ~560, searchKey ~400; after: ~130 and ~120. The rest were already fine; their
// budgets only catch a blow-up.)
const BUDGET = { homeRender: 400, home: 600, activity: 450, insights: 900, settings: 500, addSheet: 600, searchKey: 300 };

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: process.env.PERF_RM ? 'reduce' : 'no-preference' });
const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const cdp = await c.newCDPSession(p);

/** Build a large, varied ledger inside the page (same shapes the sheet returns) and re-render. */
async function inject(n) {
  await p.evaluate(async (n) => {
    const store = await import('/js/store.js');
    const model = await import('/js/model.js');
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const shops = [['Carrefour', 'Groceries'], ['Spinneys', 'Groceries'], ['Talabat', 'Food & Drinks'], ['Starbucks', 'Food & Drinks'], ['Careem', 'Transport & Fuel'], ['ADNOC', 'Transport & Fuel'],
      ['Amazon.ae', 'Shopping'], ['Noon', 'Shopping'], ['VOX Cinemas', 'Entertainment'], ['Aster Pharmacy', 'Health'], ['Netflix', 'Bills & Subscriptions'], ['Spotify', 'Bills & Subscriptions'], ['du', 'Bills & Subscriptions'], ['Tabby · Noon', 'Shopping']];
    const accts = model.ACCOUNTS.map((a) => a.id);
    const start = Date.now() - 3 * 365 * 864e5, span = 3 * 365 * 864e5;
    const out = [];
    for (let i = 0; i < n; i++) {
      const date = new Date(start + (i / n) * span + rnd() * 3e6).toISOString();
      const r = rnd();
      const e = { id: `p-${i}`, date, cycle: model.cycleOf(date, store.state.settings.cycleStart), currency: 'AED', toAccount: '', category: '', merchant: '', note: i % 9 === 0 ? 'a note' : '', status: 'OK', source: 'App', account: pick(accts) };
      if (r < 0.78) { const [m, cat] = pick(shops); Object.assign(e, { type: 'Spend', merchant: m, category: rnd() < 0.05 ? '' : cat, amount: Math.round((5 + rnd() * 300) * 100) / 100 }); }
      else if (r < 0.86) Object.assign(e, { type: 'Income', category: 'Salary', amount: 2000 + Math.round(rnd() * 4000) });
      else if (r < 0.97) Object.assign(e, { type: 'Transfer', toAccount: pick(accts), amount: 100 + Math.round(rnd() * 900) });
      else Object.assign(e, { type: 'Adjustment', amount: Math.round((rnd() - 0.5) * 50), note: 'Matched with bank' });
      e.amountAED = e.amount;
      out.push(e);
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    store.state.entries = out;
    store.restoreEntry(out[0]); // same entry again: swaps the array and re-renders
  }, n);
  await p.waitForTimeout(300);
}

// median of a few runs, so one GC pause doesn't decide the result
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Tap a tab from Home and time until two frames have painted. */
async function timeTab(tab, from = 'home') {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await p.evaluate((from) => document.querySelector(`[data-tab="${from}"]`).click(), from);
    await p.waitForTimeout(700);
    runs.push(await p.evaluate(async (tab) => {
      const t0 = performance.now();
      document.querySelector(`[data-tab="${tab}"]`).click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    }, tab));
  }
  return med(runs);
}

await p.goto(`${BASE}/?demo=1#home`);
await p.waitForSelector('.lens');
await p.waitForTimeout(500);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await inject(N);

const res = {};
// pure render cost of Home (synchronous emit -> render), no transition involved
const hr = [];
for (let i = 0; i < 3; i++) {
  hr.push(await p.evaluate(async () => { const s = await import('/js/store.js'); const e = s.state.entries[5]; const t = performance.now(); s.restoreEntry(e); return performance.now() - t; }));
  await p.waitForTimeout(100);
}
res.homeRender = med(hr);
res.home = await timeTab('home', 'settings');
res.activity = await timeTab('activity');
res.insights = await timeTab('insights');
res.settings = await timeTab('settings');
await p.evaluate(() => document.querySelector('[data-tab="home"]').click());

// the add sheet
await p.evaluate(() => document.querySelector('[data-tab="home"]').click());
await p.waitForTimeout(700);
const addRuns = [];
for (let i = 0; i < 3; i++) {
  addRuns.push(await p.evaluate(async () => {
    const t0 = performance.now();
    document.querySelector('.fab').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  }));
  await p.evaluate(() => document.querySelector('.sheet [data-act="cancel"]')?.click());
  await p.waitForSelector('.sheet', { state: 'detached' }); // closing takes longer on a slow CPU; an open sheet makes the page inert
  await p.waitForTimeout(200);
}
res.addSheet = med(addRuns);

// typing in Activity search: time per key until the list has redrawn
await p.evaluate(() => document.querySelector('[data-tab="activity"]').click());
await p.waitForTimeout(800);
await p.focus('.search input');
const text = 'carrefour';
const keys = [];
for (const ch of text) {
  const t0 = Date.now();
  await p.keyboard.type(ch);
  await frames();
  keys.push(Date.now() - t0);
}
res.searchKey = med(keys);
const shown = await p.evaluate(() => document.querySelectorAll('#view .entry').length);

if (process.env.PERF_PROFILE) {
  // per-function cost on the big ledger (scratch aid: PERF_PROFILE=1 PERF_REPORT=1)
  const prof = await p.evaluate(async () => {
    const st = await import('/js/store.js'), M = await import('/js/model.js'), R = await import('/js/recurring.js'), C = await import('/js/categorize.js');
    const B = await import('/js/bnpl.js'), T = await import('/js/trends.js'), BU = await import('/js/budgets.js'), BL = await import('/js/budgets-settings.js');
    const { entries: en, settings: s, plan } = st.state;
    const out = {}, time = (k, fn, n = 5) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); out[k] = +((performance.now() - t) / n).toFixed(1); };
    const cyc = M.cycleOf(new Date(), s.cycleStart);
    time('balances', () => M.balances(en, s));
    time('summarize', () => M.summarize(en, cyc, s, plan));
    time('summarize x6', () => { for (let i = 0; i < 6; i++) M.summarize(en, M.shiftCycle(cyc, -i), s, plan); });
    time('homeNumbers', () => M.homeNumbers(en, plan, s, new Date(), st.state.dismissed));
    time('peopleBalances', () => M.peopleBalances(en, s));
    time('detectRecurring (cold)', () => R.detectRecurring([...en], s, {}), 2);
    time('learn', () => C.learn(en, st.state.merchants));
    time('dailySpend', () => T.dailySpend(en, cyc, s));
    time('topMerchants', () => T.topMerchants(en, cyc, s, 5));
    time('categoryTrends', () => T.categoryTrends(en, cyc, s, 6));
    time('startBals filter+balances', () => M.balances(en.filter((e) => e.date < new Date().toISOString()), s));
    time('new Set(ids)', () => new Set(en.map((e) => e.id)));
    const ex = st.state.extras;
    out.plans = (ex.bnpl?.plans || []).length;
    return out;
  });
  console.log('profile (ms/call @4x)', JSON.stringify(prof, null, 1));
}
if (process.env.PERF_PROFILE) {
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  for (const [from, to] of [['home', 'activity'], ['home', 'insights'], ['activity', 'home']]) {
    await p.evaluate((t) => document.querySelector(`[data-tab="${t}"]`).click(), from);
    await p.waitForTimeout(800);
    const a = await metrics();
    await p.evaluate(async (t) => { document.querySelector(`[data-tab="${t}"]`).click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, to);
    await p.waitForTimeout(500);
    const z = await metrics();
    const d = (k) => Math.round((z[k] - a[k]) * 1000);
    console.log(`${from}->${to}: script ${d('ScriptDuration')} layout ${d('LayoutDuration')} style ${d('RecalcStyleDuration')} task ${d('TaskDuration')} ms (cpu-throttled)`);
  }
}
// structure: a long list draws in pieces, and scrolling brings the rest (capped at 400 with the footer)
await p.fill('.search input', '');
await p.waitForTimeout(300);
const first = await p.evaluate(() => document.querySelectorAll('#view .entry').length);
let last = first;
for (let i = 0; i < 30; i++) {
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(150);
  const n = await p.evaluate(() => document.querySelectorAll('#view .entry').length);
  if (n === last && n > first) break;
  last = n;
}
const foot = await p.evaluate(() => !!document.querySelector('.activity-list .group-foot'));
// a redraw (an entry changing, Select mode) keeps the rows drawn and your place in the list
await p.evaluate(() => window.scrollTo(0, 0));
await p.fill('.search input', 'a'); // a different search starts the list over, then clearing it starts again at 40 rows
await p.waitForTimeout(400);
await p.fill('.search input', '');
await p.waitForTimeout(300);
for (let i = 0; i < 80 && (await p.evaluate(() => document.querySelectorAll('#view .entry').length)) < 220; i++) {
  await p.evaluate(() => window.scrollBy(0, 300)); // small steps, so the list stops part-way (rows grow with the reader's text size)
  await p.waitForTimeout(150);
}
const mark = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('#view .entry')];
  const r = rows[Math.min(180, rows.length - 1)];
  r.scrollIntoView({ block: 'center' });
  return { id: r.dataset.id, n: rows.length };
});
await p.waitForTimeout(200);
const where = (id) => p.evaluate((id) => { const r = document.querySelector(`#view .entry[data-id="${id}"]`); return r ? Math.round(r.getBoundingClientRect().top) : null; }, id);
const top0 = await where(mark.id);
await p.evaluate(async () => { const s = await import('/js/store.js'); s.restoreEntry(s.state.entries[300]); });
await p.waitForTimeout(300);
const afterEmit = { top: await where(mark.id), n: await p.evaluate(() => document.querySelectorAll('#view .entry').length) };
await p.evaluate(() => document.querySelector('[data-act="select"]').click());
await p.waitForTimeout(300);
const afterSelect = { top: await where(mark.id), n: await p.evaluate(() => document.querySelectorAll('#view .entry').length) };
await p.evaluate(() => document.querySelector('[data-act="select-done"]').click());
await p.waitForTimeout(200);
console.log(`place: row ${mark.n} drawn before; top ${top0} -> ${afterEmit.top} (entry changed, ${afterEmit.n} rows) -> ${afterSelect.top} (select mode, ${afterSelect.n} rows)`);

console.log(`activity rows: first paint ${first}, after scrolling ${last}, footer ${foot}`);

console.log(`entries ${N}, CPU x${THROTTLE}, rows shown for "${text}": ${shown}`);
for (const k of Object.keys(BUDGET)) console.log(`${k.padEnd(11)} ${String(Math.round(res[k])).padStart(5)} ms   (budget ${BUDGET[k]})`);
await b.close();
assert.deepEqual(errors, [], 'no page errors');
assert.ok(mark.n >= 200 && mark.n < 400 && afterEmit.n >= mark.n && afterSelect.n >= mark.n, `a redraw keeps the rows already drawn (${mark.n} -> ${afterEmit.n}, ${afterSelect.n})`);
assert.ok(top0 != null && Math.abs(afterEmit.top - top0) <= 2 && Math.abs(afterSelect.top - top0) <= 2, `the row stays where it was (${top0} -> ${afterEmit.top}, ${afterSelect.top})`);
assert.ok(first <= 120, `Activity draws a screenful first, not all 400 (${first})`);
assert.ok(last === 400 && foot, `scrolling draws the rest, up to the 400 cap with its footer (${last})`);
if (!REPORT) for (const k of Object.keys(BUDGET)) assert.ok(res[k] <= BUDGET[k], `${k} ${Math.round(res[k])} ms is over the ${BUDGET[k]} ms budget`);
console.log(REPORT ? 'report only' : 'perf budgets ok');
