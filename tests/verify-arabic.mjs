// Arabic / English: the strings files, plural forms, and the app in Arabic (right to left) at 390×844 on /?demo=1&notour=1.
//  1. Keys: en.js and ar.js have the same keys, every key the code uses exists, no key is unused, {placeholders} match.
//  2. Plurals: Arabic picks its six forms from Intl.PluralRules('ar'); English stays one/other.
//  3. Settings → Language → العربية re-renders every tab (and the main sheets) with no English words left in visible
//     text or aria-labels, except user data (names from the demo's own entries, accounts, plans…), brand names and
//     things marked lang="en" (the names of buttons in Apple's Shortcuts app and Google's screens) or <code>.
//  4. <html lang="ar" dir="rtl">; Western digits; Arabic month names; no sideways scroll at 390px.
//  5. Amounts read left to right: a "−" or "+" stays before its number, digits run left to right.
//  6. axe-core (tests/axe-loader.mjs) on Home, Insights and Settings in Arabic: no serious or critical issues.
//  7. Switching back to English gives exactly the text each tab had before.
// Usage: (cd docs && python3 -m http.server 8765 &) ; NODE_PATH=$(npm root -g) node tests/verify-arabic.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { loadAxe } from './axe-loader.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.env.BASE || 'http://localhost:8765').replace(/\/?$/, '/');
let fails = 0, n = 0;
const ok = (c, m, x = '') => { n++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); if (!c) fails++; };

/* ───── 1. Keys ───── */
const en = (await import('../docs/js/strings/en.js')).default;
const ar = (await import('../docs/js/strings/ar.js')).default;
const enKeys = Object.keys(en), arKeys = Object.keys(ar);
ok(enKeys.length > 500 && enKeys.every((k) => k in ar) && arKeys.every((k) => k in en), `en.js and ar.js have the same ${enKeys.length} keys`,
  [...enKeys.filter((k) => !(k in ar)), ...arKeys.filter((k) => !(k in en))].slice(0, 8).join(', '));

const forms = (v) => (typeof v === 'object' ? Object.values(v) : [v]);
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const badHoles = enKeys.filter((k) => k in ar && (() => {
  const want = new Set(forms(en[k]).flatMap((s) => holes(s).split(',')).filter(Boolean));
  // an Arabic form may leave out {n} ("one" = "دفعة واحدة"), but must not invent a placeholder English doesn't fill
  return forms(ar[k]).some((s) => holes(s).split(',').filter(Boolean).some((h) => !want.has(h)));
})());
ok(!badHoles.length, 'every Arabic {placeholder} is one the English text fills too', badHoles.slice(0, 8).join(', '));
ok(Object.values(ar).every((v) => forms(v).every((s) => typeof s === 'string' && s.trim())), 'no empty Arabic text');
// glossary (council 30 Oct): المصروف is only the allowance; spending is الصرف / صُرف / صرفت; an entry is معاملة
const flat = (v) => forms(v).join(' ');
const wrongAllowance = arKeys.filter((k) => /المصروف/.test(flat(ar[k])) && !/allowance/i.test(flat(en[k])));
ok(!wrongAllowance.length, 'المصروف is used only where English says allowance', wrongAllowance.join(', '));
const oldWords = arKeys.filter((k) => k !== 'su.inProgress' && /* قيد التنفيذ = in progress */ /أنفق|أُنفق|يُنفق|المصروفات|(^|[\s>])قيود?(\s|$|<)|قيدان|قيدًا/.test(flat(ar[k])));
ok(!oldWords.length, 'no أنفق / المصروفات / قيد left (spending is الصرف, an entry is معاملة)', oldWords.join(', '));
const arPlurals = arKeys.filter((k) => typeof ar[k] === 'object');
ok(arPlurals.length >= 20 && arPlurals.every((k) => ['zero', 'one', 'two', 'few', 'many', 'other'].every((f) => typeof ar[k][f] === 'string')),
  `all ${arPlurals.length} Arabic plurals have the six forms`);

// keys the code uses: t('key'), any 'quoted.key' that is a key, and dynamic t(`prefix.${…}`) families
const SRC = fs.readdirSync(new URL('../docs/js/', import.meta.url)).filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(new URL(`../docs/js/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).join('\n');
const prefixes = new Set(enKeys.map((k) => k.split('.')[0]));
const used = new Set();
for (const m of SRC.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
for (const m of SRC.matchAll(/'([A-Za-z0-9]+\.[A-Za-z0-9.]+)'/g)) if (prefixes.has(m[1].split('.')[0])) used.add(m[1]);
const dynamic = [...SRC.matchAll(/\bt\(`([A-Za-z0-9]+\.(?:[A-Za-z0-9]+\.)?)\$\{/g)].map((m) => m[1]);
const missing = [...used].filter((k) => !(k in en));
ok(!missing.length, `every key the code asks for exists (${used.size} used, dynamic families: ${[...new Set(dynamic)].join(' ')})`, missing.join(', '));
const unused = enKeys.filter((k) => !used.has(k) && !dynamic.some((d) => k.startsWith(d)));
ok(!unused.length, 'no unused keys in the strings files', unused.slice(0, 10).join(', '));

/* ───── 2. Plurals and helpers in Node ───── */
const i18n = await import('../docs/js/i18n.js');
ok(i18n.lang() === 'en' && i18n.dir() === 'ltr', 'Node (no saved choice) is English, left to right');
ok(i18n.t('act.entries', { n: 1 }) === '1 entry' && i18n.t('act.entries', { n: 3 }) === '3 entries', 'English plural: 1 entry, 3 entries');
i18n.setLang('ar');
const pr = new Intl.PluralRules('ar');
const want = { 0: 'zero', 1: 'one', 2: 'two', 3: 'few', 10: 'few', 11: 'many', 99: 'many', 100: 'other', 102: 'other' };
ok(Object.entries(want).every(([k, f]) => pr.select(+k) === f), 'Intl.PluralRules(ar): 0 zero · 1 one · 2 two · 3–10 few · 11–99 many · 100 other');
const strip = (s) => s.replace(/[⁦-⁩]/g, '');
const ent = (k) => strip(i18n.t('act.entries', { n: k }));
ok(ent(1) === 'معاملة واحدة' && ent(2) === 'معاملتان' && ent(3) === '3 معاملات' && ent(11) === '11 معاملةً' && ent(100) === '100 معاملة' && ent(0) === '0 معاملة',
  'Arabic plural forms: معاملة واحدة · معاملتان · 3 معاملات · 11 معاملةً · 100 معاملة', [0, 1, 2, 3, 11, 100].map(ent).join(' | '));
ok(i18n.dir() === 'rtl' && i18n.locale().startsWith('ar-AE') && i18n.locale().includes('nu-latn'), 'Arabic: rtl, ar-AE dates with Western digits');
const model = await import('../docs/js/model.js');
ok(strip(model.money(-12.5)) === '-12.50\u00A0د.إ' && model.money(1234) === '\u20661,234\u2069\u00A0د.إ', 'money() in Arabic: the number first (minus inside its left-to-right isolate), a no-break space, then د.إ', JSON.stringify(model.money(-12.5)));
ok(model.cycleName('2026-11') === new Intl.DateTimeFormat('ar-AE-u-nu-latn', { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 15)), 'cycle names are Arabic month names', model.cycleName('2026-11'));
ok(model.categoryMeta('Groceries').label === 'بقالة' && model.categoryMeta('Groceries').id === 'Groceries', 'a built-in category shows its Arabic name; its id (what the sheet stores) stays English');
model.setCategoryList({ v: 1, names: { Groceries: 'Supermarket' } });
ok(model.categoryMeta('Groceries').label === 'Supermarket', 'a category you renamed keeps your name in Arabic too');
model.setCategoryList(null);
ok(!/[٠-٩]/.test(model.dayLabel('2026-10-12', new Date('2026-11-20T08:00:00Z'))), 'day labels use Western digits', model.dayLabel('2026-10-12', new Date('2026-11-20T08:00:00Z')));
i18n.setLang('en');
ok(model.money(-12.5) === 'AED -12.50' && model.cycleName('2026-11') === 'November' && model.categoryMeta('Groceries').label === 'Groceries', 'back in English: money, months and categories are as before');
ok(model.toCSV([{ id: 'x', type: 'Spend' }]).startsWith('id,date,cycle,type,amount,currency,amountAED'), 'CSV headers stay English');

/* ───── 3–7. The app ───── */
const AXE = loadAxe();
if (!AXE) console.log('NOTE  axe-core is not available here: the axe scans are skipped');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce', locale: 'en-GB' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${BASE}?demo=1&notour=1#home`);
await p.waitForSelector('.lens');
// Waits for the page to be still (no running animation, scroll and sheet count unchanged for 4 frames)
// instead of sleeping; the argument is ignored.
const settle = () => p.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  await frame();
  let last = '', same = 0;
  for (const t0 = Date.now(); same < 4 && Date.now() - t0 < 5000;) {
    await frame();
    const k = `${scrollY}|${document.getAnimations().length}|${document.querySelectorAll('.sheet').length}`;
    same = k === last && !document.getAnimations().length ? same + 1 : 0; last = k;
  }
});
const TABS = ['home', 'activity', 'insights', 'settings'];
const tabText = async (tab) => { await p.click(`.tabbar [data-tab="${tab}"]`); await settle(); return p.evaluate(() => document.getElementById('view').innerText.replace(/[⁦-⁩]/g, '')); };

const english = {};
for (const tab of TABS) english[tab] = await tabText(tab);
ok(await p.evaluate(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr'), 'English by default: <html lang="en" dir="ltr">');
ok(/Language/.test(english.settings) && await p.$$eval('[data-lang]', (b) => b.map((x) => x.textContent).join('|')) === 'English|العربية|Match iPhone', 'Settings → Language: English · العربية · Match iPhone');

// switch
await p.click('[data-lang="ar"]');
await settle(500);
ok(await p.evaluate(() => document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl'), 'Arabic: <html lang="ar" dir="rtl">');
ok(await p.evaluate(() => [...document.querySelectorAll('.tabbar [data-tab] span')].map((s) => s.textContent).join('|')) === 'الرئيسية|النشاط|التحليلات|الإعدادات', 'tab bar in Arabic');

// words allowed to stay Latin: the demo's own data (entries, accounts, plan, extras) and brand names
// "Show my app key" is the sheet's own menu item (the Apps Script stays English), so the app names it as it is
const BRANDS = 'Show my app key Spendings Apple Pay Google Sheet Sheets Drive Face ID CSV PDF AED USD iPhone Safari Wallet Tabby Tamara Postpay Shortcuts Shortcut Apps Script API Web app URL SETUP.md English JSON POST ADIB ADCB BOTIM Cloud';
const dataWords = await p.evaluate(async () => {
  const { state } = await import('./js/store.js');
  const bits = [];
  for (const e of state.entries) bits.push(e.merchant, e.note, e.account, e.toAccount, e.category);
  for (const a of state.accounts || []) bits.push(a.name, a.note);
  for (const x of state.plan || []) bits.push(x.name);
  bits.push(JSON.stringify(state.extras || {}));
  return bits.filter(Boolean).join(' ');
});
const allow = new Set(`${BRANDS} ${dataWords}`.match(/[A-Za-z][A-Za-z'’.]*/g).map((w) => w.toLowerCase().replace(/[.'’]+$/, '')));
/** Latin words in visible text and aria-labels that are not allowed. */
const leftovers = (root = '#view') => p.evaluate(({ root }) => {
  const out = [];
  const skip = (el) => !el || el.closest('[lang="en"], code, script, style, template, [hidden], [aria-hidden="true"]');
  const rootEl = document.querySelector(root);
  if (!rootEl) return ['(no root)'];
  const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  for (let nd = w.nextNode(); nd; nd = w.nextNode()) {
    const el = nd.parentElement;
    if (skip(el) || !el.checkVisibility?.({ visibilityProperty: true })) continue;
    if (/[A-Za-z]{2,}/.test(nd.textContent)) out.push(nd.textContent.trim());
  }
  for (const el of rootEl.querySelectorAll('[aria-label], [placeholder]')) {
    if (skip(el)) continue;
    for (const a of ['aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v && /[A-Za-z]{2,}/.test(v)) out.push(v); }
  }
  return out;
}, { root }).then((texts) => {
  const bad = new Set();
  for (const s of texts) for (const word of s.replace(/https?:\/\/\S+/g, '').match(/[A-Za-z][A-Za-z'’.]*/g) || []) {
    const wd = word.toLowerCase().replace(/[.'’]+$/, '');
    if (wd.length > 1 && !allow.has(wd)) bad.add(word);
  }
  return [...bad];
});

const arabic = {};
for (const tab of TABS) {
  arabic[tab] = await tabText(tab);
  const bad = await leftovers();
  ok(!bad.length, `${tab} in Arabic: no English words left (except data and brand names)`, bad.slice(0, 15).join(' '));
  ok(!/[٠-٩]/.test(arabic[tab]), `${tab}: Western digits only`);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(wide <= 0, `${tab}: no sideways scroll at 390px in Arabic`, `${wide}px`);
}
ok(arabic.settings.includes('السيارة والهاتف') && !arabic.settings.includes('Car & phone'), 'plan items the app ships (default and demo) show in Arabic until renamed');
ok(arabic.home.includes(await p.evaluate(async () => (await import('./js/model.js')).cycleName((await import('./js/model.js')).cycleOf(new Date(), 27)))), 'Home title is the Arabic month name');
ok(/[؀-ۿ]/.test(arabic.home) && /أين أموالك|المتاح للصرف/.test(arabic.home), 'Home reads in Arabic (المتاح للصرف, أين أموالك)');

// amounts left to right: a sign stays in front of its number, digits run left to right
await p.click('.tabbar [data-tab="activity"]'); await settle();
const ltr = await p.evaluate(() => {
  const res = { signs: 0, signBad: [], digits: 0, digitBad: [] };
  const rect = (node, i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect(); };
  for (const el of document.querySelectorAll('#view .num, #view .row-amt')) {
    if (!el.checkVisibility?.()) continue;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let nd = w.nextNode(); nd; nd = w.nextNode()) {
      const s = nd.textContent;
      const m = /([+−-])(\$?)(\d)/.exec(s);
      if (m) { res.signs++; const a = rect(nd, m.index), b = rect(nd, m.index + m[1].length + m[2].length); if (!(a.right <= b.left + 1)) res.signBad.push(s); }
      const d = /\d[\d,]*\d/.exec(s);
      if (d) { res.digits++; const a = rect(nd, d.index), b = rect(nd, d.index + d[0].length - 1); if (!(a.left < b.left)) res.digitBad.push(s); }
    }
  }
  return res;
});
ok(ltr.signs > 0 && !ltr.signBad.length, `a + or − stays in front of its amount (${ltr.signs} checked)`, ltr.signBad.slice(0, 3).join(' | '));
ok(ltr.digits > 10 && !ltr.digitBad.length, `amounts' digits run left to right (${ltr.digits} checked)`, ltr.digitBad.slice(0, 3).join(' | '));
ok(await p.evaluate(() => { const a = document.querySelector('#view .row-amt[aria-label]'); return /د\.إ/.test(a?.getAttribute('aria-label') || ''); }), 'spoken amounts say د.إ in Arabic');
const dayTotals = await p.$$eval('#view .day-total', (els) => els.map((e) => e.textContent.replace(/[\u2066-\u2069]/g, '')));
ok(dayTotals.length > 2 && dayTotals.every((x) => /^[\d,.]+\u00A0د\.إ$/.test(x)), 'amounts in Arabic put the currency after the number («120 د.إ», no-break space)', dayTotals.slice(0, 2).join(' | '));
ok(await p.evaluate(() => [...document.querySelectorAll('#view .row-sub')].slice(0, 5).every((e) => getComputedStyle(e).unicodeBidi === 'plaintext')
  && document.querySelector('#view .row-sub bdi') != null), 'row second lines isolate names (<bdi>) and take their direction from the first word');

// sheets in Arabic
const sheetCheck = async (label, open) => {
  await open(); await p.waitForSelector('.sheet'); await settle(450);
  if (label === 'Monthly report') {
    const foot = await p.textContent('.sheet .rp-note');
    ok(!/\.[^\s\d]/.test(foot.replace(/د\.إ/g, '')), 'the report footnote joins its sentences with a space', foot.slice(0, 120));
  }
  const bad = await leftovers('.sheet:last-of-type');
  ok(!bad.length, `${label} sheet in Arabic: no English words left`, bad.slice(0, 15).join(' '));
  await p.keyboard.press('Escape'); await p.waitForSelector('.sheet', { state: 'detached' }).catch(() => {}); await settle(300);
};
await sheetCheck('New entry', () => p.click('.fab'));
await p.click('.tabbar [data-tab="activity"]'); await settle();
await sheetCheck('Filters', () => p.click('[data-act="filters"]'));
await p.click('.tabbar [data-tab="settings"]'); await settle();
await sheetCheck('Apple Pay Shortcut', () => p.click('[data-act="shortcut"]'));
await sheetCheck('Monthly report', () => p.click('[data-act="report"]'));
await sheetCheck('Buy now, pay later', async () => {
  await p.click('[data-bnpl="open"]'); await p.waitForSelector('.sheet .bn-main span'); await settle(450);
  const cut = await p.$$eval('.sheet .bn-main span', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  ok(!cut.length, 'buy now, pay later: a matched payment line wraps instead of being cut', cut.slice(0, 2).join(' | '));
});
await sheetCheck('Setup guide', () => p.click('[data-act="setup-guide"]'));
await p.click('.tabbar [data-tab="home"]'); await settle();
if (await p.$('[data-act="review"]')) await sheetCheck('Needs review', () => p.click('[data-act="review"]'));

// swipe mirrors: in Arabic a row is swiped to the right to show Delete
await p.click('.tabbar [data-tab="activity"]'); await settle();
const row = await p.$('#view .swipe .entry');
const box = await row.boundingBox();
await p.mouse.move(box.x + 60, box.y + box.height / 2); await p.mouse.down();
for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + 60 + i * 14, box.y + box.height / 2);
await p.mouse.up(); await settle(500);
ok(await p.evaluate(() => { const o = document.querySelector('.swipe.open .entry'); return !!o && new DOMMatrix(getComputedStyle(o).transform).m41 > 40; }), 'swiping a row to the right opens Delete in Arabic');
await p.click('#view .large-title h1'); await settle(); // a tap elsewhere closes the open row

// axe in Arabic
if (AXE) {
  for (const tab of ['home', 'insights', 'settings']) {
    await p.click(`.tabbar [data-tab="${tab}"]`); await settle(500);
    await p.evaluate(AXE);
    const bad = await p.evaluate(async () => {
      const r = await axe.run(document, { resultTypes: ['violations'] });
      return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((nd) => `${v.id} ${nd.target.join(' ')}`));
    });
    ok(!bad.length, `axe ${tab} in Arabic: no serious or critical issues`, bad.slice(0, 3).join(' | '));
  }
}

// back to English
await p.click('.tabbar [data-tab="settings"]'); await settle();
await p.click('[data-lang="en"]'); await settle(500);
ok(await p.evaluate(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr'), 'back to English: <html lang="en" dir="ltr">');
for (const tab of TABS) {
  const again = await tabText(tab);
  ok(again === english[tab], `${tab}: switching back to English restores the same text`, again === english[tab] ? '' : firstDiff(english[tab], again));
}
ok(await p.evaluate(() => [...document.querySelectorAll('.tabbar [data-tab] span')].map((s) => s.textContent).join('|')) === 'Home|Activity|Insights|Settings', 'tab bar back in English');

// the choice is kept on this phone
await p.click('[data-lang="ar"]'); await settle(300);
await p.reload(); await p.waitForSelector('.lens, .large-title');
ok(await p.evaluate(() => document.documentElement.dir === 'rtl' && localStorage.getItem('sp.lang') === 'ar'), 'Arabic is remembered after a reload');
await p.evaluate(() => localStorage.setItem('sp.lang', 'auto'));
const ctxAr = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-AE' });
const pa = await ctxAr.newPage();
await pa.addInitScript(() => { try { localStorage.setItem('sp.lang', 'auto'); } catch { /* */ } });
await pa.goto(`${BASE}?demo=1&notour=1#home`); await pa.waitForSelector('.lens');
ok(await pa.evaluate(() => document.documentElement.dir === 'rtl'), '"Match iPhone" follows an Arabic iPhone');
await ctxAr.close();

ok(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${fails} failed of ${n} checks`);
process.exit(fails ? 1 : 0);

function firstDiff(a, b) {
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: "${a.slice(Math.max(0, i - 30), i + 40)}" vs "${b.slice(Math.max(0, i - 30), i + 40)}"`;
}
