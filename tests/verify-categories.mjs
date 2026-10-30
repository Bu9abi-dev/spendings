// Your own categories (Settings → Categories): the list maths in model.js, then the real app in demo mode.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-categories.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setCategoryList, SPEND_CATEGORIES, INCOME_CATEGORIES, allCategories, categoryMeta, pickerCategories, DEFAULT_SPEND_CATEGORIES } from '../docs/js/model.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const ids = (list) => list.map((c) => c.id);

// ── the lists
setCategoryList(null);
ok(ids(SPEND_CATEGORIES).join() === ids(DEFAULT_SPEND_CATEGORIES).join(), 'no settings: the built-in spending list');
setCategoryList({ v: 1, custom: [{ id: 'Coffee', type: 'Spend', icon: 'fork' }, { id: 'Tutoring', type: 'Income', icon: 'briefcase' }, { id: 'Bad', icon: 'not-an-icon' }], hidden: ['Travel'], names: { 'Food & Drinks': 'Eating out' } });
ok(SPEND_CATEGORIES.some((c) => c.id === 'Coffee' && c.custom && c.slot === 0), 'a custom spending category is offered, in the grey "other" colour');
ok(INCOME_CATEGORIES.some((c) => c.id === 'Tutoring') && !SPEND_CATEGORIES.some((c) => c.id === 'Tutoring'), 'a custom money-in category goes to the money-in list only');
ok(categoryMeta('Bad').icon === 'dots', 'an unknown icon falls back to dots');
ok(!SPEND_CATEGORIES.some((c) => c.id === 'Travel'), 'a hidden category leaves the picker');
ok(categoryMeta('Travel')?.hidden === true, '…but old entries still find it');
ok(allCategories('Spend').some((c) => c.id === 'Travel'), '…and Settings still lists it');
ok(pickerCategories('Spend', 'Travel').some((c) => c.id === 'Travel'), 'editing an old Travel entry keeps Travel in its picker');
ok(!pickerCategories('Spend', 'Groceries').some((c) => c.id === 'Travel'), 'other entries don\'t see the hidden one');
const food = categoryMeta('Food & Drinks');
ok(food.id === 'Food & Drinks' && food.label === 'Eating out' && food.short === 'Eating out', 'a rename changes the label, never the id the sheet stores');
setCategoryList({ custom: [{ id: 'Groceries', type: 'Spend', icon: 'gift' }] });
ok(allCategories('Spend').filter((c) => c.id === 'Groceries').length === 1 && categoryMeta('Groceries').icon === 'basket', 'a custom category can\'t duplicate a built-in one');
setCategoryList({ custom: 'junk', hidden: 5, names: null });
ok(SPEND_CATEGORIES.length === DEFAULT_SPEND_CATEGORIES.length, 'a damaged setting is ignored, not fatal');
setCategoryList(null);

// ── the real app
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${BASE}/?demo=1#settings`);
await p.waitForSelector('[data-cat-new]');
await p.click('[data-cat-new]');
await p.fill('#cf-name', 'Coffee');
await p.click('[data-icon="fork"]');
await p.click('.sheet [data-act="save"]');
await p.waitForSelector('[data-cat-edit="Coffee"]');
ok(true, 'Settings: a new category appears in the list');
ok(await p.evaluate(async () => (await import('/js/model.js')).SPEND_CATEGORIES.some((c) => c.id === 'Coffee')), 'the shared list picks it up straight away');

// duplicate names are refused
await p.click('[data-cat-new]');
await p.fill('#cf-name', 'groceries');
await p.click('.sheet [data-act="save"]');
await p.waitForTimeout(300);
ok(await p.evaluate(async () => (await import('/js/model.js')).allCategories('Spend').filter((c) => c.id.toLowerCase() === 'groceries').length === 1), 'a name already taken is refused');
await p.click('.sheet [data-act="cancel"]');
await p.waitForTimeout(400);

// rename a built-in and hide another
await p.click('[data-cat-edit="Food & Drinks"]');
await p.fill('#cf-name', 'Eating out');
await p.click('.sheet [data-act="save"]');
await p.waitForTimeout(400);
await p.click('[data-cat-edit="Travel"]');
await p.click('#cf-shown');
await p.click('.sheet [data-act="save"]');
await p.waitForTimeout(400);
const st = await p.evaluate(async () => { const m = await import('/js/model.js'); return { food: m.categoryMeta('Food & Drinks').label, travel: m.SPEND_CATEGORIES.some((c) => c.id === 'Travel') }; });
ok(st.food === 'Eating out' && !st.travel, 'rename and hide take effect');

// the add sheet offers Coffee and the new label, not Travel
await p.evaluate(async () => (await import('/js/entry.js')).openEntry());
await p.waitForSelector('.cat-grid [data-cat]');
const grid = await p.$$eval('.cat-grid [data-cat]', (x) => x.map((b) => [b.dataset.cat, b.textContent.trim()]));
ok(grid.some(([id]) => id === 'Coffee'), 'the add sheet offers the new category');
ok(grid.some(([id, t]) => id === 'Food & Drinks' && t === 'Eating out'), 'the add sheet shows the new label');
ok(!grid.some(([id]) => id === 'Travel'), 'the add sheet leaves out the hidden one');

// undo puts Travel back
await p.evaluate(async () => (await import('/js/store.js')).undo());
ok(await p.evaluate(async () => (await import('/js/model.js')).SPEND_CATEGORIES.some((c) => c.id === 'Travel')), 'undo brings the hidden category back');

// a label can't inject markup
await p.evaluate(async () => (await import('/js/store.js')).saveExtra('categories', { v: 1, custom: [{ id: '<img src=x onerror=window.__x=1>', type: 'Spend', icon: 'dots' }] }));
await p.evaluate(async () => { const st = await import('/js/store.js'); const e = st.state.entries.find((x) => x.type === 'Spend'); st.updateEntry(e.id, { category: '<img src=x onerror=window.__x=1>' }); });
await p.waitForTimeout(300); // Settings redraws with the name
await p.evaluate(async () => (await import('/js/entry.js')).openEntry());
await p.waitForTimeout(300);
await p.locator('.sheet [data-act="cancel"]').last().click();
await p.waitForTimeout(500);
await p.evaluate(() => document.querySelector('[data-tab="insights"]').click());
await p.waitForTimeout(500);
ok(!(await p.evaluate(() => window.__x)), 'a category name is shown as text, never as markup');
ok(!errors.length, 'no page errors' + (errors.length ? `: ${errors.join(' | ')}` : ''));
await b.close();
console.log(`\nall ${n} category checks passed`);
