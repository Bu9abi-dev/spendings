// Accessibility checks for iPhone VoiceOver + Safari, in Chromium at 390×844 on /?demo=1&notour=1.
//  1. axe-core on every tab and the main sheets, light and dark: no serious or critical violations.
//  2. Names: every button/link/radio has an accessible name (icon-only buttons need an aria-label).
//  3. Sheets are role="dialog" + aria-modal + a label, move focus in, switch the page behind off, hand focus back.
//  4. Toasts are announced from an always-present polite live region and their Undo can be reached.
//  5. Charts have text alternatives; choosers use radio / pressed semantics; spoken amounts read "AED 1,240".
//  6. Contrast tokens (text, warn, neg) hold 4.5:1 in both themes.
//  7. Reduce Motion / Reduce Transparency cover the animations; Dynamic Type (rem) works; 200% zoom does not scroll sideways.
// axe-core is NOT part of the app: it is found on NODE_PATH (npm i -g axe-core), in $AXE_CORE, or fetched once with
// `npm pack axe-core` into the temp folder. Without it the axe part is skipped (set A11Y_REQUIRE_AXE=1 to fail instead).
// Usage: (cd docs && python3 -m http.server 8765 &) ; NODE_PATH=$(npm root -g) node tests/verify-a11y.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { loadAxe } from './axe-loader.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.env.BASE || 'http://localhost:8765').replace(/\/?$/, '/');
let fails = 0, n = 0;
const ok = (c, m, x = '') => { n++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); if (!c) fails++; };

/* ───── axe-core, loaded from outside the repo (tests/axe-loader.mjs) ───── */
const AXE = loadAxe();
if (!AXE) {
  console.log('NOTE  axe-core is not available here: the axe scans are skipped (the other checks still run)');
  if (process.env.A11Y_REQUIRE_AXE) { console.log('FAIL  A11Y_REQUIRE_AXE is set'); process.exit(1); }
}

/* Things axe reports that cannot be fixed in this app. Keep it empty if you can; every entry needs a reason.
   Format: 'rule-id' (whole rule) or 'rule-id|css selector fragment'. */
const ALLOW = [
  // (none)
];
const allowed = (rule, target) => ALLOW.some((a) => { const [r, sel] = a.split('|'); return r === rule && (!sel || target.includes(sel)); });

const browser = await chromium.launch();
const phone = devices['iPhone 13'];
const newCtx = (o = {}) => browser.newContext({ ...phone, reducedMotion: 'reduce', ...o });
// Waits for the page to be still (no running animation or transition, scroll position unchanged for 4
// frames) instead of sleeping a fixed time. The second argument is kept for the call sites and ignored.
const settle = (p) => p.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  await frame();
  let last = '', same = 0;
  for (const t0 = Date.now(); same < 4 && Date.now() - t0 < 5000;) {
    await frame();
    const k = `${scrollY}|${document.getAnimations().length}|${document.querySelectorAll('.sheet').length}`;
    same = k === last && !document.getAnimations().length ? same + 1 : 0; last = k;
  }
});

/** Runs axe on the open sheet (or the whole page) and returns serious/critical violations that are not allow-listed. */
async function axeScan(p, scope) {
  if (!AXE) return [];
  await p.evaluate(AXE);
  const found = await p.evaluate(async (scope) => {
    const r = await axe.run(scope ? document.querySelector(scope) : document, { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .flatMap((v) => v.nodes.map((nd) => ({ rule: v.id, impact: v.impact, target: nd.target.join(' '), msg: (nd.any[0] || nd.all[0] || nd.none[0] || {}).message || '' })));
  }, scope);
  return found.filter((f) => !allowed(f.rule, f.target));
}
const report = (label, bad) => ok(!bad.length, `axe ${label}: no serious or critical issues`, bad.slice(0, 3).map((b) => `${b.rule} ${b.target} (${b.msg.slice(0, 70)})`).join(' | '));

/** Buttons, links and choosers that a screen reader user would land on but would hear nothing for. */
const unnamed = (p, root = 'body') => p.evaluate((root) => {
  const nameOf = (el) => {
    const lab = el.getAttribute('aria-label')?.trim(); if (lab) return lab;
    const by = el.getAttribute('aria-labelledby'); if (by) { const t = by.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    const walk = (nd) => [...nd.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 && c.getAttribute('aria-hidden') !== 'true' ? (c.getAttribute('aria-label') || walk(c)) : '')).join('');
    return (walk(el) || el.title || '').trim();
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], [inert], [aria-hidden="true"]'); };
  return [...document.querySelector(root).querySelectorAll('button, a[href], [role="button"], [role="radio"], [role="tab"], [role="checkbox"], [role="switch"], summary')]
    .filter(vis).filter((el) => !nameOf(el)).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
}, root);

/* ═════════ 1. Tabs: axe + names, light and dark ═════════ */
for (const scheme of ['light', 'dark']) {
  const ctx = await newCtx({ colorScheme: scheme });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '?demo=1&notour=1#home');
  await p.waitForSelector('.lens');
  for (const tab of ['home', 'activity', 'insights', 'settings']) {
    await p.click(`.tabbar [data-tab="${tab}"]`); await settle(p);
    report(`${tab} (${scheme})`, await axeScan(p));
    const u = await unnamed(p);
    ok(!u.length, `${tab} (${scheme}): every button, link and chooser has a name`, u.slice(0, 4).join(', '));
  }

  /* ═════════ 2. Sheets: axe + dialog semantics ═════════ */
  const sheets = [
    { n: 'add entry', tab: 'home', sel: '.fab', label: 'New entry', returns: true },
    { n: 'filters', tab: 'activity', sel: '[data-act="filters"]', label: 'Filters', returns: true },
    { n: 'monthly report', tab: 'settings', sel: '[data-act="report"]', label: 'Monthly report', returns: true },
    { n: 'setup guide', tab: 'settings', sel: '[data-act="setup-guide"]', label: 'Set up Spendings' },
    { n: 'shortcut guide', tab: 'settings', sel: '[data-act="shortcut"]', label: 'Apple Pay Shortcut' },
    { n: 'budget limit', tab: 'settings', sel: '[data-budget-add]', label: 'Add a limit' },
    { n: 'new goal', tab: 'insights', sel: '#goals-card [data-goal-new]', label: 'New goal' },
    { n: 'needs review', tab: 'home', sel: '[data-act="review"]', label: 'Needs review' },
    { n: 'account edit', tab: 'settings', sel: '[data-acct-edit]', label: /^Edit / },
    { n: 'edit entry', tab: 'activity', sel: '.row.entry', label: 'Edit entry' },
    { n: 'people', tab: 'home', mod: ['people-ui', 'openPeople()'], label: 'People' },
    { n: 'new person', tab: 'home', mod: ['people-ui', "openPersonEdit('')"], label: 'New person' },
    { n: 'week summary', tab: 'home', mod: ['weekly-ui', 'openWeek()'], label: 'Your week' },
    { n: 'pay later', tab: 'home', mod: ['bnpl-ui', 'openBnpl()'], label: 'Buy now, pay later' },
    { n: 'pay later plan', tab: 'home', mod: ['bnpl-ui', 'openPlanEditor()'], label: 'Buy now, pay later plan' },
  ];
  const closeAll = async () => { for (let i = 0; i < 4 && await p.$('.sheet'); i++) { await p.keyboard.press('Escape'); await settle(p, 200); } };
  for (const s of sheets) {
    await closeAll();
    await p.click(`.tabbar [data-tab="${s.tab}"]`); await settle(p, 200);
    if (s.mod) await p.evaluate(async ([m, call]) => { const mod = await import(`/js/${m}.js`); new Function('mod', `return mod.${call}`)(mod); }, s.mod);
    else {
      const loc = p.locator(s.sel).first();
      if (!(await loc.count())) { ok(false, `${s.n}: can be opened (${s.sel} not found)`); continue; }
      await loc.focus().catch(() => {});
      await loc.click();
    }
    await p.waitForSelector('.sheet', { timeout: 3000 }).catch(() => {});
    await settle(p, 450);
    const d = await p.evaluate(() => {
      const sh = [...document.querySelectorAll('.sheet')].pop();
      if (!sh) return null;
      return { role: sh.getAttribute('role'), modal: sh.getAttribute('aria-modal'), label: sh.getAttribute('aria-label') || '',
        focusIn: sh.contains(document.activeElement), appInert: document.getElementById('app').inert, tabsInert: document.querySelector('.tabbar').inert, fabInert: document.querySelector('.fab').inert };
    });
    if (!d) { ok(false, `${s.n}: the sheet opened`); continue; }
    const labelOk = s.label instanceof RegExp ? s.label.test(d.label) : d.label === s.label;
    if (scheme === 'light') {
      ok(d.role === 'dialog' && d.modal === 'true' && labelOk, `${s.n}: role=dialog, aria-modal, labelled "${d.label}"`);
      ok(d.focusIn, `${s.n}: focus moves into the sheet`);
      ok(d.appInert && d.tabsInert && d.fabInert, `${s.n}: the page behind is switched off (inert) while it is open`);
    }
    report(`${s.n} sheet (${scheme})`, await axeScan(p, '.sheet:last-of-type'));
    const u = await unnamed(p, '.sheet:last-of-type');
    ok(!u.length, `${s.n} (${scheme}): every button and chooser has a name`, u.slice(0, 4).join(', '));
    if (scheme === 'light') {
      await p.keyboard.press('Escape'); await settle(p, 250);
      const back = await p.evaluate(() => ({ open: !!document.querySelector('.sheet'), inert: document.getElementById('app').inert, onBody: document.activeElement === document.body }));
      ok(!back.open && !back.inert, `${s.n}: Escape closes it and switches the page back on`);
      if (s.returns) ok(!back.onBody, `${s.n}: focus goes back to the page, not nowhere`);
    }
  }
  ok(!errors.length, `no page errors (${scheme})`, errors[0] || '');
  await ctx.close();
}

/* ═════════ 3. Toast: announced, Undo reachable ═════════ */
{
  const ctx = await newCtx();
  const p = await ctx.newPage();
  await p.goto(BASE + '?demo=1&notour=1#home'); await p.waitForSelector('.lens');
  const live = await p.evaluate(() => { const a = document.getElementById('announce'); return a && { role: a.getAttribute('role'), live: a.getAttribute('aria-live'), hidden: a.hidden || getComputedStyle(a).display === 'none' }; });
  ok(live && live.live === 'polite' && live.role === 'status' && !live.hidden, 'a polite live region is always in the page');
  await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.toast('Deleted 2 entries', { action: 'Undo', onAction() {} }); });
  await settle(p, 400);
  const t = await p.evaluate(() => {
    const a = document.getElementById('announce').textContent, btn = document.querySelector('#toast .toast-action');
    const r = btn.getBoundingClientRect();
    return { said: a, name: btn.textContent, inert: !!btn.closest('[inert]'), tab: btn.tabIndex, size: Math.round(r.height), shown: document.getElementById('toast').classList.contains('show') };
  });
  ok(/Deleted 2 entries/.test(t.said) && /Undo/.test(t.said), 'the toast text is announced, with a hint that Undo follows', `"${t.said}"`);
  ok(t.shown && !t.inert && t.tab >= 0 && t.name === 'Undo', 'the toast Undo is a real, focusable button');
  // a sheet open behind the toast must not shut the Undo out
  await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.openSheet({ html: '<button type="button">x</button>', label: 'Test sheet' }); ui.toast('Saved', { action: 'Undo', onAction() {} }); });
  await settle(p, 400);
  ok(await p.evaluate(() => !document.querySelector('#toast .toast-action').closest('[inert]')), 'the toast Undo stays reachable above an open sheet');
  // focusing the toast keeps it up past its normal time (a headless page isn't focused unless we say so)
  await (await ctx.newCDPSession(p)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await p.evaluate(() => document.querySelector('#toast .toast-action').focus());
  await p.waitForTimeout(7600);
  ok(await p.evaluate(() => document.getElementById('toast').classList.contains('show')), 'a toast with focus on it does not disappear');
  await ctx.close();
}

/* ═════════ 4. Charts, choosers, spoken amounts ═════════ */
{
  const ctx = await newCtx();
  const p = await ctx.newPage();
  await p.goto(BASE + '?demo=1&notour=1#home'); await p.waitForSelector('.lens');
  await p.click('.tabbar [data-tab="insights"]'); await settle(p, 500);
  const c = await p.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    return {
      donutLabel: q('.donut svg').map((s) => s.getAttribute('aria-label') || ''),
      slices: q('.slice').map((s) => s.getAttribute('aria-label') || ''),
      pace: q('.pace-svg').map((s) => s.getAttribute('aria-label') || ''),
      bars: q('.sb-bar:not([disabled])').map((b) => b.getAttribute('aria-label') || ''),
      inout: q('.io-bars').map((b) => b.getAttribute('aria-label') || ''),
      segs: q('.chart-seg [role="radio"]').map((b) => [b.getAttribute('aria-checked'), b.closest('[role="radiogroup"]') ? 'g' : '']),
      progress: q('[role="progressbar"]').map((b) => [b.getAttribute('aria-valuenow'), b.getAttribute('aria-valuetext') || '', b.getAttribute('aria-label') || '']),
    };
  });
  ok(c.donutLabel.length > 0 && c.donutLabel.every((l) => l.length > 10), 'donut: the chart has a label', c.donutLabel[0]);
  ok(c.slices.length > 0 && c.slices.every((l) => /AED [\d,]+.*%/.test(l)), 'donut: every slice reads "name: AED amount, percent"', c.slices[0]);
  ok(c.pace.length > 0 && c.pace.every((l) => /AED [\d,]+/.test(l)), 'pace chart: summarised in words with amounts', c.pace[0]);
  ok(c.bars.length > 0 && c.bars.every((l) => /AED [\d,]+/.test(l)), 'day and week bars: each bar names its day and amount', c.bars[0]);
  ok(c.inout.length > 0 && c.inout.every((l) => /in AED [\d,]+, out AED [\d,]+/.test(l)), 'money in and out: each pair reads as words', c.inout[0]);
  ok(c.segs.length === 2 && c.segs.every(([chk, g]) => (chk === 'true' || chk === 'false') && g === 'g'), 'Day / Week is a radio group with aria-checked');
  ok(c.progress.every(([now, txt, lab]) => now !== null && lab), 'progress bars carry a value and a name');
  const all = await p.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).filter((l) => /AED \d{4,}/.test(l)));
  ok(!all.length, 'spoken amounts have thousands separators ("AED 1,240", never "AED 1240")', all[0] || '');

  await p.click('.tabbar [data-tab="home"]'); await settle(p);
  const h = await p.evaluate(() => ({
    keys: document.querySelector('.keys')?.getAttribute('role'),
    pressed: [...document.querySelectorAll('.key-acc[data-focus]')].map((b) => b.getAttribute('aria-pressed')),
    lens: document.querySelector('.lv')?.getAttribute('aria-label') || '',
    badTab: document.querySelectorAll('[role="tab"]').length,
  }));
  ok(h.keys === 'group' && h.pressed.length > 1 && h.pressed.every((v) => v === 'true' || v === 'false') && h.pressed.filter((v) => v === 'true').length === 1, 'account keys are toggle buttons (aria-pressed), one on');
  ok(/^AED [\d,−-]+\.\d\d$/.test(h.lens), 'the big balance reads "AED 12,345.67"', h.lens);
  ok(h.badTab === 0, 'no role="tab" without tab panels');

  await p.click('.tabbar [data-tab="activity"]'); await settle(p);
  const a = await p.evaluate(() => ({
    group: document.querySelector('.filter-chips')?.getAttribute('role'),
    chips: [...document.querySelectorAll('.filter-chips [role="radio"]')].map((b) => b.getAttribute('aria-checked')),
    amts: [...document.querySelectorAll('.row-amt')].slice(0, 30).map((e) => e.getAttribute('aria-label') || ''),
  }));
  ok(a.group === 'radiogroup' && a.chips.length >= 4 && a.chips.filter((v) => v === 'true').length === 1, 'Activity filter chips are a radio group');
  ok(a.amts.length > 5 && a.amts.every((l) => /(spent|received|moved) (AED [\d,]+\.\d\d|[\d,]+\.\d\d US dollars)|matched|adjusted by/.test(l)), 'entry amounts are spoken with a verb and currency ("spent AED 37.50")', a.amts[0]);
  await p.click('.filter-chips [data-kind="Income"]'); await settle(p, 200);
  ok(await p.evaluate(() => document.querySelector('.filter-chips [data-kind="Income"]').getAttribute('aria-checked') === 'true' && document.querySelector('.filter-chips [data-kind="all"]').getAttribute('aria-checked') === 'false'), 'choosing a chip moves aria-checked');

  await p.click('.tabbar [data-tab="settings"]'); await settle(p);
  const s = await p.evaluate(() => [...document.querySelectorAll('.theme-seg')].map((g) => ({ role: g.getAttribute('role'), n: g.querySelectorAll('[role="radio"][aria-checked]').length })));
  ok(s.length === 1 && s[0].role === 'radiogroup' && s[0].n === 3, 'the Theme control is a radio group');
  await ctx.close();
}

/* ═════════ 5. Contrast tokens, both themes ═════════ */
{
  const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((u, v) => v - u); return (x + 0.05) / (y + 0.05); };
  for (const scheme of ['light', 'dark']) {
    const ctx = await newCtx({ colorScheme: scheme });
    const p = await ctx.newPage();
    await p.goto(BASE + '?demo=1&notour=1#home'); await p.waitForSelector('.lens');
    const colours = await p.evaluate(() => {
      // a fresh element each time: a colour change on a reused one can still be mid-transition when it is read
      const get = (v) => { const probe = document.createElement('i'); probe.style.cssText = `color:var(${v});transition:none`; document.body.append(probe); const m = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number); probe.remove(); return m.slice(0, 3); };
      return Object.fromEntries(['--label', '--label-2', '--placeholder', '--warn', '--neg', '--good', '--tint-text', '--bg', '--bg-2', '--bg-3', '--on-neg'].map((v) => [v, get(v)]));
    });
    const grounds = { bg: colours['--bg'], 'bg-2': colours['--bg-2'], 'bg-3': colours['--bg-3'] };
    for (const [tok, min] of [['--label', 4.5], ['--label-2', 4.5], ['--placeholder', 4.5], ['--warn', 4.5], ['--neg', 4.5], ['--good', 4.5], ['--tint-text', 4.5]]) {
      for (const [gn, g] of Object.entries(grounds)) {
        if (gn === 'bg-3' && scheme === 'light' && tok !== '--label' && tok !== '--label-2') continue;
        const r = ratio(colours[tok], g);
        ok(r >= min, `${scheme}: ${tok} on ${gn} is ${r.toFixed(2)}:1 (need ${min})`);
      }
    }
    ok(ratio(colours['--on-neg'], colours['--neg']) >= 4.5, `${scheme}: text on a solid red button is ${ratio(colours['--on-neg'], colours['--neg']).toFixed(2)}:1`);
    await ctx.close();
  }
}

/* ═════════ 6. Reduce Motion / Reduce Transparency ═════════ */
{
  const ctx = await newCtx({ reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(BASE + '?demo=1&notour=1#home'); await p.waitForSelector('.lens');
  const slow = [];
  for (const tab of ['home', 'activity', 'insights', 'settings']) {
    await p.click(`.tabbar [data-tab="${tab}"]`); await settle(p, 300);
    slow.push(...await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e), secs = (v) => Math.max(...v.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 0.001 : 1) || 0));
      return (s.animationName !== 'none' && secs(s.animationDuration) > 0.05) || secs(s.transitionDuration) > 0.05;
    }).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`)));
  }
  ok(!slow.length, 'Reduce Motion: no CSS animation or transition runs longer than a blink on any tab', [...new Set(slow)].slice(0, 4).join(', '));
  // sheets and their children too
  await p.click('.fab'); await settle(p, 400);
  const sheetSlow = await p.evaluate(() => [...document.querySelectorAll('.sheet, .sheet *')].filter((e) => { const s = getComputedStyle(e); return parseFloat(s.transitionDuration) > 0.05 || (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.05); }).length);
  ok(sheetSlow === 0, 'Reduce Motion: the add sheet has no long transitions');
  const src = fs.readFileSync(new URL('../docs/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // every rule that blurs what is behind it must be switched off under Reduce Transparency
  const reduce = src.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{([^}]*\{[^}]*\})/)?.[1] || '';
  const reduceSel = reduce.split('{')[0].split(',').map((x) => x.trim());
  const blurSel = [...src.matchAll(/(^|\})\s*([^{}@]+)\{[^{}]*backdrop-filter:\s*blur/gm)].map((m) => m[2].trim()).flatMap((x) => x.split(',').map((y) => y.trim()));
  const uncovered = blurSel.filter((sel) => !reduceSel.some((r) => sel === r || sel.startsWith(r + ' ') || sel.startsWith(r + '.') || sel.startsWith(r + ':') || sel.startsWith(r + '[')));
  ok(reduceSel.length >= 3 && !uncovered.length, 'Reduce Transparency: every blurred surface is switched to a solid colour', uncovered.join(', '));
  // JS-driven motion also asks first
  const js = ['accounts', 'bnpl-ui', 'entry', 'home', 'main', 'setup', 'ui'].map((f) => fs.readFileSync(new URL(`../docs/js/${f}.js`, import.meta.url), 'utf8')).join('\n');
  ok(!/behavior:\s*'smooth'/.test(js.replace(/reduceMotion\(\) \? 'auto' : 'smooth'/g, '')), 'Reduce Motion: no smooth-scrolling that ignores the setting');
  await ctx.close();
}

/* ═════════ 7. Dynamic Type and zoom ═════════ */
{
  const css = fs.readFileSync(new URL('../docs/app.css', import.meta.url), 'utf8');
  ok(/html\s*\{[^}]*font:\s*-apple-system-body/.test(css), 'Dynamic Type: the root takes the system body text size on iOS');
  ok(/body\s*\{[^}]*font:\s*1rem/.test(css), 'Dynamic Type: the page text is rem-based');
  const px = (css.match(/font-size:\s*(1[0-9]|20)(\.\d+)?px/g) || []).length, rem = (css.match(/font-size:\s*[\d.]+rem/g) || []).length;
  ok(rem > 150 && px < 30, `Dynamic Type: running text is rem-based (${rem} rem sizes, ${px} fixed px kept for inputs, keypad and tab bar)`);

  const ctx = await newCtx();
  const p = await ctx.newPage();
  await p.goto(BASE + '?demo=1&notour=1#home'); await p.waitForSelector('.lens');
  const grows = [];
  for (const [name, w, h, rootPx] of [['text size 150%', 390, 844, 25.5], ['text size 200%', 390, 844, 34], ['200% browser zoom', 195, 422, 0], ['400% reflow', 320, 568, 0]]) {
    await p.setViewportSize({ width: w, height: h });
    const style = rootPx ? await p.addStyleTag({ content: `html{font-size:${rootPx}px !important}` }) : null;
    for (const tab of ['home', 'activity', 'insights', 'settings']) {
      await p.evaluate((t) => document.querySelector(`.tabbar [data-tab="${t}"]`).click(), tab); await settle(p, 300);
      const over = await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      ok(over <= 0, `${name}: ${tab} does not scroll sideways`, over > 0 ? `+${over}px` : '');
      if (rootPx === 34 && tab === 'activity') grows.push(await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.row-title')).fontSize)));
    }
    if (style) await style.evaluate((el) => el.remove());
  }
  ok(grows[0] > 24, 'Dynamic Type: list text grows with the root size', `row title ${grows[0]}px at 2x`);
  await ctx.close();
}

await browser.close();
console.log(`\n${n - fails} passed, ${fails} failed`);
if (fails) { console.log(`${fails} failed checks`); process.exit(1); }
console.log('a11y: all checks passed');
