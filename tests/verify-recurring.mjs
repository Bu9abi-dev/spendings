// Subscriptions: the detection maths (docs/js/recurring.js), then the real Insights and Home in demo mode.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-recurring.mjs   (BASE=http://localhost:PORT to change the address)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SAMPLE_SETTINGS } from '../docs/js/model.js';
import { merchantKey } from '../docs/js/categorize.js';
import { detectRecurring, recurringKey, monthlyTotal, subscriptionNotice } from '../docs/js/recurring.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('PASS ', msg); };
const near = (a, b) => Math.abs(a - b) < 0.005;

const S = { ...SAMPLE_SETTINGS, usdRate: 3.6725 };
const NOW = new Date('2026-10-30T09:00:00Z');
const day = 864e5;
let id = 0;
// a Spend `ago` days before NOW
const sp = (merchant, amount, ago, extra = {}) => ({ id: `r${++id}`, type: 'Spend', amount, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Bills & Subscriptions', merchant, date: new Date(NOW.getTime() - ago * day).toISOString(), ...extra });
const keyOf = (ago) => new Date(NOW.getTime() - ago * day).toISOString().slice(0, 10);
const find = (list, key) => list.find((s) => s.key === key);
const run = (entries, opts = {}) => detectRecurring(entries, S, { now: NOW, ...opts });

// ── names
ok(recurringKey('CARREFOUR MCC 4521 ABU DHABI') === recurringKey('Carrefour mcc #77 Dubai'), 'store numbers and trailing cities are ignored');
ok(recurringKey('PAYPAL *SPOTIFY') === 'spotify' && recurringKey('SQ *Spotify') === 'spotify', 'a "*" prefix is dropped');
ok(recurringKey('APPLE.COM/BILL') === recurringKey('Apple.com/Bill') && recurringKey('  Netflix  ') === 'netflix', 'case and spaces are ignored');
ok(recurringKey === merchantKey && recurringKey('Netflix #12') === merchantKey('Netflix #12'), 'the key is the shared categorize.js merchantKey');
ok(recurringKey('') === '' && recurringKey(null) === '', 'a blank name has no key');

// ── monthly, weekly, yearly
const netflix = [0, 1, 2, 3].map((k) => sp(k % 2 ? 'NETFLIX' : 'Netflix', 56, 10 + 30 * k));
let r = run(netflix);
ok(r.length === 1 && r[0].cadence === 'monthly' && r[0].count === 4 && near(r[0].amount, 56), 'four monthly Netflix charges are found');
ok(near(r[0].monthly, 56) && r[0].last === '2026-10-20' && r[0].next === '2026-11-20', 'monthly cost, last and next date');
ok(!r[0].isNew && !r[0].isLate, 'an old, current subscription is neither new nor late');
ok(run([sp('Gym', 249, 5), sp('Gym', 249, 35)]).length === 1, 'two monthly charges are enough');
ok(run([sp('Studio', 249, 5), sp('Studio', 249, 35)]).length === 1, 'two monthly charges from an unknown place are enough');
ok(run([sp('Gym', 249, 5)]).length === 0, 'one charge is not a subscription');
r = run([0, 1, 2, 3].map((k) => sp('Laundry', 40, 2 + 7 * k)));
ok(r.length === 1 && r[0].cadence === 'weekly' && near(r[0].monthly, 40 * 52 / 12), 'weekly charges are found, monthly cost is 52/12 of them');
ok(run([0, 1, 2].map((k) => sp('Laundry', 40, 2 + 7 * k))).length === 0, 'three weekly charges could be a coincidence: weekly needs four');
r = run([sp('Domain', 120, 20), sp('Domain', 120, 20 + 365)]);
ok(r.length === 1 && r[0].cadence === 'yearly' && near(r[0].monthly, 10), 'a yearly charge costs a twelfth a month');

// ── drift, price rise, one-offs
r = run([sp('Spotify', 21.99, 4), sp('Spotify', 22.5, 34), sp('Spotify', 21, 64)]);
ok(r.length === 1 && r[0].count === 3, 'amounts that drift a little are still one subscription');
r = run([sp('Fitness First', 279, 5), sp('Fitness First', 249, 35), sp('Fitness First', 249, 65)]);
ok(r.length === 1 && r[0].count === 3 && near(r[0].amount, 279) && near(r[0].was, 249), 'a price rise keeps the subscription, shows the new price and the old one');
r = run([sp('Noon', 400, 5), sp('Noon', 40, 35)]);
ok(r.length === 0, 'very different amounts a month apart are not a subscription');
r = run([sp('Careem', 30, 1), sp('Careem', 31, 3), sp('Careem', 29, 4), sp('Careem', 30, 9), sp('Careem', 28, 12), sp('Careem', 30, 20)]);
ok(r.length === 0, 'irregular visits to the same place are not flagged');
r = run([sp('Salt Shop', 120, 5), sp('Salt Shop', 90, 35)]);
ok(r.length === 0, 'two charges a month apart must match closely');
r = run([sp('Dentist', 300, 5), sp('Dentist', 300, 50)]);
ok(r.length === 0, 'a 45 day gap is not monthly');
r = run([sp('Netflix', 56, 5), sp('Netflix', 56, 36), sp('Netflix', 56, 150), sp('Netflix', 56, 181)]);
ok(r.length === 1 && r[0].count === 2, 'a skipped stretch cuts the run: only the current streak counts');

// ── false positives
const wk = (name, cat, n, amount = 20, step = 7) => [...Array(n).keys()].map((k) => sp(name, amount, 1 + step * k, { category: cat }));
ok(run(wk('Starbucks', 'Food & Drinks', 4)).length === 0, 'a weekly coffee (4 Starbucks visits 7 days apart) is not flagged');
ok(run(wk('Carrefour', 'Groceries', 6, 150)).length === 0, 'a weekly grocery shop is not flagged');
ok(run(wk('Fitness Hub', 'Health', 4, 90)).length === 1, 'a weekly gym with 4 charges is flagged');
ok(run(wk('Gym', 'Food & Drinks', 4, 90)).length === 1, 'a known subscription brand is trusted whatever its category');
ok(run([sp('Dr Smith', 300, 5, { category: 'Health' }), sp('Dr Smith', 300, 35, { category: 'Health' })]).length === 0, 'two monthly Health charges are not enough');
ok(run([sp('Adnoc', 150, 5, { category: 'Transport & Fuel' }), sp('Adnoc', 150, 35, { category: 'Transport & Fuel' })]).length === 0, 'two monthly fuel charges are not enough');
ok(run([5, 35, 65].map((a) => sp('Adnoc', 150, a, { category: 'Transport & Fuel' }))).length === 1, 'but three monthly ones are');

// ── isNew comes from the start of the run, not the first charge ever
r = run([sp('Gym Club', 100, 3), sp('Gym Club', 100, 33), sp('Gym Club', 100, 400), sp('Gym Club', 100, 430)]);
ok(r.length === 1 && r[0].count === 2 && r[0].isNew && r[0].first === keyOf(33), 'a restarted subscription is new: isNew uses the run start');
r = run([sp('Cloud', 10, 3), sp('Cloud', 10, 33), sp('Cloud', 10, 63), sp('Cloud', 10, 93)]);
ok(!r[0].isNew, 'a long-running one is not new');

// ── store-number variants merge
r = run([sp('Carrefour 123 Abu Dhabi', 50, 3), sp('CARREFOUR #0456', 50, 33), sp('carrefour', 50, 63)]);
ok(r.length === 1 && r[0].count === 3, 'spellings of one place merge');
r = run([sp('APPLE.COM/BILL', 9.99, 10), sp('Apple.com/Bill', 9.99, 40)]);
ok(r.length === 1, 'APPLE.COM/BILL charges group');

// ── only Spend; money in other currencies
r = run([sp('Salary', 6000, 5, { type: 'Income' }), sp('Salary', 6000, 35, { type: 'Income' }), sp('X', 3000, 5, { type: 'Transfer' }), sp('X', 3000, 35, { type: 'Transfer' })]);
ok(r.length === 0, 'income and transfers are never subscriptions');
r = run([sp('Apple iCloud+', 19.99, 5, { currency: 'USD' }), sp('Apple iCloud+', 19.99, 35, { currency: 'USD' })]);
ok(r.length === 1 && near(r[0].amount, Math.round(19.99 * S.usdRate * 100) / 100), 'USD charges are shown in AED');

// ── new, late, ignored, sorting, totals
r = run([sp('Disney+', 30, 3), sp('Disney+', 30, 33)]);
ok(r[0].isNew && !r[0].isLate, 'a first charge about a month ago is flagged as new');
r = run([sp('Shahid', 25, 52), sp('Shahid', 25, 82), sp('Netflix', 56, 10), sp('Netflix', 56, 40)]);
ok(find(r, 'shahid').isLate && !find(r, 'netflix').isLate && r.at(-1).key === 'shahid', 'over a week overdue = late, listed last');
ok(near(monthlyTotal(r), 56), 'late subscriptions are left out of the monthly total');
r = run([sp('Netflix', 56, 10), sp('Netflix', 56, 40), sp('Spotify', 22, 4), sp('Spotify', 22, 34)], { ignored: ['netflix'] });
ok(r.length === 1 && r[0].key === 'spotify', 'an ignored place is not listed');
r = run([sp('Beta', 10, 4), sp('Beta', 10, 34), sp('Alpha', 10, 12), sp('Alpha', 10, 42)]);
ok(r[0].key === 'alpha', 'soonest payment first');
ok(subscriptionNotice(run([sp('Disney+', 30, 3), sp('Disney+', 30, 33)]), NOW)?.priority === 'new', 'the notice mentions a subscription that just started charging');
ok(/due in 2 days/.test(subscriptionNotice(run([sp('Gym', 249, 29), sp('Gym', 249, 59), sp('Gym', 249, 89)]), NOW)?.text || ''), 'the notice mentions a payment due in 3 days or less');
ok(subscriptionNotice(run([sp('Gym', 249, 29), sp('Gym', 249, 59), sp('Gym', 249, 89)]), NOW)?.priority === 'due', 'its priority is due');
ok(subscriptionNotice(run([sp('Gym', 249, 10), sp('Gym', 249, 40), sp('Gym', 249, 70)]), NOW) === null, 'the notice stays quiet otherwise');

const same = [sp('Netflix', 56, 10), sp('Netflix', 56, 40)];
ok(run(same) === run(same), 'detection is remembered for the same entries array');
ok(run([...same]) !== run(same), 'and recomputed for a new one');

// ── the real app in demo mode
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${BASE}/?demo=1#home`);
await p.waitForSelector('.sub-line');
ok(/Disney\+ is a new subscription/.test(await p.textContent('.sub-line')), 'Home shows one line about the new subscription');
await p.click('.sub-line');
await p.waitForSelector('#subs');
const names = await p.$$eval('#subs .sub-row .tr-name b', (x) => x.map((s) => s.textContent));
ok(['Netflix', 'Spotify', 'Fitness First', 'Disney+', 'Shahid VIP'].every((m) => names.includes(m)), 'Insights lists the demo subscriptions');
ok(['Car instalment', 'du', 'Home'].every((m) => names.includes(m)) && names.length === 8, 'the demo’s own monthly bills show too, and no shop visit is mistaken for one');
ok(/About AED \d/.test(await p.textContent('#subs .panel-sub')), 'the monthly total is on top');
ok(await p.$$eval('#subs .sub-row.late', (x) => x.length) === 1, 'the stopped one is shown as maybe cancelled');
await p.click('#subs .sub-row:nth-child(1) summary');
ok(await p.isVisible('#subs .sub-row:nth-child(1) [data-sub-ignore]'), 'tapping a subscription shows its details');
const first = await p.textContent('#subs .sub-row:nth-child(1) .tr-name b');
await p.click('#subs .sub-row:nth-child(1) [data-sub-ignore]');
await p.waitForSelector('[data-sub-restore]');
ok(!(await p.$$eval('#subs .sub-row .tr-name b', (x) => x.map((s) => s.textContent))).includes(first), '"Not a subscription" hides it');
ok(await p.evaluate(async () => (await import('/js/store.js')).getExtra('recurring', null)?.ignored.length === 1), 'and saves it in the Extras store');
await p.click('[data-sub-restore]');
ok(await p.$$eval('#subs .sub-row', (x) => x.length) === 8, '"Show again" brings them back');
ok(/Monthly · (expected|was due) \d/.test(await p.textContent('#subs .sub-row .tr-name small')), 'rows say "Monthly · expected 5 Nov"');
await p.click('#subs .sub-row:nth-child(1) summary');
await p.click('.tabbar [data-tab=insights]').catch(() => {});
await p.click('[data-cyc="-1"]');
ok(await p.$$eval('#subs', (x) => x.length) === 0, 'the Subscriptions card is hidden on a past cycle');
await p.click('[data-cyc="1"]');
ok(await p.$$eval('#subs', (x) => x.length) === 1, 'and back on the current cycle');
await p.click('[data-cyc="-1"]');
await p.click('.tabbar [data-tab=home]');
await p.click('.sub-line');
await p.waitForSelector('#subs');
ok(true, 'the Home line brings you back to the current cycle with the card');
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll on an iPhone-width screen');
ok(!errors.length, 'no page errors');
await b.close();
console.log(`all ${n} recurring checks passed`);
