// Verification in Chromium iPhone emulation (390×844 and 375×667, touch, mobile viewport).
// What Chromium can NOT tell us (safe-area insets, real keyboard, haptics, Face ID, standalone
// launch) is covered by the static review in council/verification-2026-10-07.md.
// Usage: (cd docs && python3 -m http.server 8765 &) ; NODE_PATH=$(npm root -g) node tests/verify-iphone.mjs [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { makeEnv } from './fake-sheet.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const OUT = process.argv[2] || '/tmp/verify-iphone';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:8765/';
let fails = 0, findings = 0;
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); if (!c) fails++; };
const finding = (m) => { console.log(`FINDING ${m}`); findings++; };

const browser = await chromium.launch();
const PHONES = [
  { name: 'iPhone 13/14 (390×844)', ...devices['iPhone 13'] },
  { name: 'iPhone SE (375×667)', ...devices['iPhone SE'] },
];

async function layoutAudit(p, label) {
  return p.evaluate((label) => {
    const vw = innerWidth, out = { label, hscroll: document.scrollingElement.scrollWidth - vw, overflow: [], smallInputs: [] };
    const scrollerOf = (el) => { for (let x = el.parentElement; x; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll|hidden)/.test(s.overflowX) && x !== document.body && x !== document.documentElement) return x; } return null; };
    for (const el of document.querySelectorAll('#view *, .tabbar, .fab, .sheet *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if ((r.right > vw + 0.5 || r.left < -0.5) && !scrollerOf(el)) out.overflow.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)}–${Math.round(r.right)}]`);
    }
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) out.smallInputs.push(`${el.tagName.toLowerCase()}[name=${el.name || el.className}] ${fs}px`);
    }
    return out;
  }, label);
}

for (const ph of PHONES) {
  console.log(`\n══ ${ph.name} ══`);
  const ctx = await browser.newContext({ viewport: ph.viewport, deviceScaleFactor: ph.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: ph.userAgent, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE + '?demo=1#home');
  await p.waitForSelector('.lens');
  const slug = ph.viewport.width;

  for (const tab of ['home', 'activity', 'insights', 'settings']) {
    await p.tap(`.tabbar [data-tab="${tab}"]`);
    await p.waitForTimeout(250);
    const a = await layoutAudit(p, tab);
    ok(a.hscroll <= 0, `${tab}: no horizontal page scroll`, a.hscroll > 0 ? `(+${a.hscroll}px)` : '');
    ok(!a.overflow.length, `${tab}: nothing sticks out of the screen`, a.overflow.slice(0, 4).join(', '));
    ok(!a.smallInputs.length, `${tab}: every input/select ≥ 16px (no focus zoom)`, a.smallInputs.join(', '));
    // can the last thing on the page scroll clear of the floating tab bar?
    const clear = await p.evaluate(() => {
      scrollTo(0, document.scrollingElement.scrollHeight);
      const kids = [...document.querySelectorAll('#view > *')].filter((e) => e.getBoundingClientRect().height);
      const last = kids[kids.length - 1];
      const tb = document.querySelector('.tabbar').getBoundingClientRect();
      return { lastBottom: Math.round(last.getBoundingClientRect().bottom), tabTop: Math.round(tb.top), cls: last.className };
    });
    ok(clear.lastBottom <= clear.tabTop + 1, `${tab}: last block (${clear.cls}) scrolls clear of the tab bar`, `${clear.lastBottom} vs ${clear.tabTop}`);
    await p.screenshot({ path: `${OUT}/${slug}-${tab}.png`, fullPage: false });
    await p.evaluate(() => scrollTo(0, 0));
  }

  // account keys row: reachable by touch?
  await p.tap('.tabbar [data-tab="home"]');
  await p.waitForTimeout(200);
  const keys = await p.evaluate(() => { const k = document.querySelector('.keys'); return { sw: k.scrollWidth, cw: k.clientWidth, ta: getComputedStyle(k).touchAction }; });
  console.log(`      .keys scrollWidth ${keys.sw} / clientWidth ${keys.cw}, touch-action ${keys.ta}`);
  {
    // add two more accounts (demo state only) and re-check
    await p.evaluate(async () => { const s = await import('/js/store.js'); s.addAccount({ name: 'Wio', note: 'Savings', color: 'blue' }); s.addAccount({ name: 'Mashreq', note: 'Card', color: 'gold' }); });
    await p.waitForTimeout(300);
    const k2 = await p.evaluate(() => { const k = document.querySelector('.keys'); const last = [...k.querySelectorAll('.key-acc')].pop().getBoundingClientRect(); return { sw: k.scrollWidth, cw: k.clientWidth, lastRight: Math.round(last.right), vw: innerWidth }; });
    console.log(`      with 6 accounts: .keys scrollWidth ${k2.sw} / clientWidth ${k2.cw}; last key right edge ${k2.lastRight} (viewport ${k2.vw})`);
    if (k2.sw > k2.cw + 1) {
      // try a horizontal touch pan on the keys row
      const cdp = await ctx.newCDPSession(p);
      const box = await p.locator('.keys').boundingBox();
      await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(box.x + box.width - 40), y: Math.round(box.y + box.height / 2), xDistance: -200, yDistance: 0, gestureSourceType: 'touch', speed: 800 });
      await p.waitForTimeout(300);
      const sl = await p.evaluate(() => document.querySelector('.keys').scrollLeft);
      if (sl === 0) finding(`MINOR keys-unreachable (${ph.name}): with 6 accounts the account keys overflow (${k2.sw}px in ${k2.cw}px) but .keys has touch-action: pan-y, so a finger can't scroll it (scrollLeft stayed 0); the scrub gesture also only hits visible keys`);
    }
    await p.evaluate(async () => { const s = await import('/js/store.js'); s.undo(); s.undo(); });
  }

  // filter chips (Activity) swallow vertical page scroll?
  await p.tap('.tabbar [data-tab="activity"]');
  await p.waitForTimeout(250);
  {
    const cdp = await ctx.newCDPSession(p);
    const drag = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 15; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 20 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(400);
    };
    const box = await p.locator('.filter-chips').boundingBox();
    const y0 = await p.evaluate(() => scrollY);
    await drag(Math.round(box.x + 60), Math.round(box.y + box.height / 2));
    const y1 = await p.evaluate(() => scrollY);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(200);
    const rowBox = await p.locator('.group-head.day').first().boundingBox();
    await drag(Math.round(rowBox.x + 30), Math.round(rowBox.y + rowBox.height / 2));
    const y2 = await p.evaluate(() => scrollY);
    console.log(`      vertical drag from filter chips scrolled ${y1 - y0}px; from a day header ${y2}px`);
    if (y1 - y0 === 0 && y2 > 0) finding(`MINOR chips-scroll (${ph.name}): a vertical swipe that starts on the Activity filter chips does not scroll the page (app.css:443 .filter-chips { touch-action: pan-x }) — use pan-x pan-y like .quick`);
  }

  // swipe-to-delete with a real touch drag, then Undo from the toast
  {
    await p.evaluate(() => scrollTo(0, 0));
    const count0 = await p.evaluate(async () => (await import('/js/store.js')).state.entries.length);
    const row = p.locator('.swipe .entry').first();
    const id = await p.locator('.swipe').first().getAttribute('data-id');
    const b = await row.boundingBox();
    const cdp = await ctx.newCDPSession(p);
    const y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width - 20, y }] });
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width - 20 - i * 25, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(500);
    const count1 = await p.evaluate(async () => (await import('/js/store.js')).state.entries.length);
    ok(count1 === count0 - 1, `touch swipe-left deletes the row (${count0} → ${count1})`);
    const hasUndo = await p.locator('.toast .toast-action').isVisible().catch(() => false);
    ok(hasUndo, 'toast offers Undo');
    if (hasUndo) await p.tap('.toast .toast-action');
    await p.waitForTimeout(300);
    const back = await p.evaluate(async (id) => (await import('/js/store.js')).state.entries.some((e) => e.id === id), id);
    ok(back, 'toast Undo restores the swiped entry');
  }

  // add sheet fits; keypad + save visible
  {
    await p.tap('.fab');
    await p.waitForSelector('.sheet .keypad');
    await p.waitForTimeout(300);
    const s = await p.evaluate(() => { const sh = document.querySelector('.sheet').getBoundingClientRect(); const sv = document.querySelector('.sheet .save-btn').getBoundingClientRect(); return { top: Math.round(sh.top), bottom: Math.round(sh.bottom), saveBottom: Math.round(sv.bottom), vh: innerHeight }; });
    ok(s.top >= 0 && s.saveBottom <= s.vh, `add sheet fits (top ${s.top}, save button bottom ${s.saveBottom} ≤ ${s.vh})`);
    const a = await layoutAudit(p, 'sheet');
    ok(!a.smallInputs.length, 'add sheet inputs ≥ 16px', a.smallInputs.join(', '));
    ok(!a.overflow.length, 'add sheet: nothing off-screen', a.overflow.slice(0, 4).join(', '));
    await p.screenshot({ path: `${OUT}/${slug}-add-sheet.png` });
    // keyboard logic: replace visualViewport with a fake that we can shrink like the iOS keyboard does
    await p.evaluate(() => document.querySelector('.sheet [data-act="cancel"]').click());
    await p.waitForTimeout(400);
    const kb = await p.evaluate(async () => {
      const fake = new EventTarget(); fake.height = innerHeight; fake.offsetTop = 0;
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
      const { openEntry } = await import('/js/entry.js');
      openEntry();
      await new Promise((r) => setTimeout(r, 300));
      const sheet = [...document.querySelectorAll('.sheet')].pop();
      fake.height = innerHeight - 336; fake.offsetTop = 0; fake.dispatchEvent(new Event('resize'));
      sheet.querySelector('input[name="merchant"]').focus();
      await new Promise((r) => setTimeout(r, 400));
      const r = sheet.getBoundingClientRect(), f = sheet.querySelector('input[name="merchant"]').getBoundingClientRect();
      const res = { kbVar: sheet.style.getPropertyValue('--kb'), kbOpen: sheet.classList.contains('kb-open'), typing: sheet.classList.contains('typing'), sheetBottom: Math.round(r.bottom), visibleBottom: innerHeight - 336, fieldTop: Math.round(f.top), fieldBottom: Math.round(f.bottom), sheetTop: Math.round(r.top) };
      // iOS also scrolls the layout viewport: offsetTop > 0
      fake.offsetTop = 120; fake.dispatchEvent(new Event('scroll'));
      res.kbVarScrolled = sheet.style.getPropertyValue('--kb');
      return res;
    });
    console.log(`      fake keyboard 336px: --kb=${kb.kbVar}, kb-open=${kb.kbOpen}, typing=${kb.typing}, sheet ${kb.sheetTop}–${kb.sheetBottom} (visible area ends ${kb.visibleBottom}), merchant field ${kb.fieldTop}–${kb.fieldBottom}; after offsetTop 120 --kb=${kb.kbVarScrolled}`);
    ok(kb.kbVar === '336px' && kb.kbOpen && kb.sheetBottom === kb.visibleBottom && kb.fieldBottom <= kb.visibleBottom && kb.fieldTop >= kb.sheetTop, 'visualViewport logic lifts the sheet above a 336px keyboard and keeps the focused field visible');
    await p.goto(BASE + '?demo=1&reload=1#home'); await p.waitForSelector('.lens');
  }

  // numbers on screen vs the maths (demo data)
  {
    const r = await p.evaluate(async () => {
      const M = await import('/js/model.js'); const { state } = await import('/js/store.js');
      const s = state.settings, cyc = M.cycleOf(new Date(), s.cycleStart);
      const bals = M.balances(state.entries, s);
      const total = [...bals.values()].reduce((a, b) => a + b.balance, 0);
      const sum = M.summarize(state.entries, cyc, s);
      const allowBal = bals.get(s.allowanceAccount).balance;
      const safe = Math.min(sum.allowanceLeft, Math.max(allowBal, 0));
      const rows = [...document.querySelectorAll('.where-row:not(.total)')].map((x) => ({ label: x.querySelector('b').textContent, v: +x.querySelector('.num').textContent.replace(/[,−]/g, (c) => (c === '−' ? '-' : '')) }));
      const shownTotal = +document.querySelector('.where-row.total .num').textContent.replace(/,/g, '');
      const meta = document.querySelector('.lens-meta').textContent;
      const hero = +document.querySelector('.lens .lv').dataset.v;
      return { total, safe, rows, shownTotal, meta, hero, allowBal, used: sum.allowanceUsed };
    });
    console.log(`      demo: total ${r.total.toFixed(2)}, safe ${r.safe.toFixed(2)}, ADCB ${r.allowBal}, used ${r.used.toFixed(2)}; hero ${r.hero}; rows ${r.rows.map((x) => `${x.label}=${x.v}`).join(' | ')}; shown total ${r.shownTotal}`);
    console.log(`      lens meta: "${r.meta.trim()}"`);
    const rs = r.rows.reduce((a, x) => a + x.v, 0);
    ok(Math.abs(rs - r.shownTotal) <= 1, `Where rows on screen add to the shown total (${rs} vs ${r.shownTotal})`);
    ok(r.rows.some((x) => x.label === 'Safe to spend' && Math.abs(x.v - Math.round(r.safe)) <= 0), 'Safe to spend row = min(allowance left, ADCB balance)');
  }

  // ghost "Allowance not moved yet"
  {
    await p.evaluate(async () => { const s = await import('/js/store.js'); s.addEntry({ type: 'Transfer', amount: 1000, account: 'ADCB', toAccount: 'BOTIM' }); });
    await p.waitForTimeout(300);
    const g = await p.evaluate(() => { const b = document.querySelector('.lens-meta [data-plan-act="move"]'); return b ? { text: b.textContent, id: b.dataset.planId } : null; });
    if (g) {
      const n0 = await p.evaluate(async () => (await import('/js/store.js')).state.entries.length);
      await p.tap('.lens-meta [data-plan-act="move"]');
      await p.waitForTimeout(300);
      const n1 = await p.evaluate(async () => (await import('/js/store.js')).state.entries.length);
      finding(`BUG ghost-unmoved confirmed in UI (${ph.name}): after ADCB→BOTIM 1000 the hero shows "${g.text}" with data-plan-id="${g.id}"; tapping it adds ${n1 - n0} entries`);
    }
    await p.screenshot({ path: `${OUT}/${slug}-ghost-unmoved.png` });
  }

  ok(!errors.length, `no page errors (${ph.name})`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// cycle start change → sync brings stale cycles back (real app + Code.gs on the fake sheet)
{
  console.log('\n══ cycle start change through the real sync ══');
  const { ctx: gs } = makeEnv(); gs.setup();
  const token = gs.getToken_();
  const post = (body) => JSON.parse(gs.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).text);
  const now = new Date();
  // an ADCB spend 30 minutes ago and a matched ADCB balance
  post({ action: 'add', entry: { id: 'm1', type: 'Adjustment', amount: 3000, account: 'ADCB', date: new Date(now - 40 * 864e5).toISOString() } });
  post({ action: 'add', entry: { id: 'k1', type: 'Spend', amount: 100, account: 'ADCB', category: 'Groceries', date: new Date(now - 30 * 60e3).toISOString() } });
  const c = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined, reducedMotion: 'reduce' });
  await c.route('https://script.google.com/**', async (route) => {
    const out = gs.doPost({ postData: { contents: route.request().postData() } });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text });
  });
  const p = await c.newPage();
  await p.goto(BASE + '#settings');
  await p.fill('input[name="url"]', 'https://script.google.com/macros/s/TEST/exec');
  await p.fill('input[name="token"]', token);
  await p.click('[data-act="connect"]');
  await p.waitForSelector('.status-row .row-title:text("Connected")');
  const today = new Date(now.getTime() + 4 * 3600e3).getUTCDate();
  // choose a start day that moves yesterday's spend into a different cycle than today's (or vice versa)
  const newStart = Math.min(28, Math.max(2, today));
  await p.selectOption('select[name="cycleStart"]', String(newStart));
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async (newStart) => {
    const s = await import('/js/store.js'); const M = await import('/js/model.js');
    const local = s.state.entries.find((e) => e.id === 'k1').cycle;
    await s.sync();
    const synced = s.state.entries.find((e) => e.id === 'k1');
    return { local, synced: synced.cycle, expected: M.cycleOf(synced.date, newStart), start: s.state.settings.cycleStart };
  }, newStart);
  console.log(`      start → ${newStart}: client re-tag ${r.local}; after sync ${r.synced}; correct ${r.expected}; settings.cycleStart=${r.start}`);
  if (r.synced !== r.expected) finding(`BUG cyclestart-stale confirmed end-to-end: after changing the cycle start to ${newStart} and syncing, the spend is tagged ${r.synced} instead of ${r.expected}`);
  else console.log('      (today\'s date did not separate the cycles; see verify-maths.mjs §6 for the deterministic repro)');
  await c.close();
}

await browser.close();
console.log(`\n${fails} failed checks, ${findings} findings · screenshots in ${OUT}`);
process.exitCode = fails ? 1 : 0;
