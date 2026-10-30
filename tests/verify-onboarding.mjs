// First-time setup tutorial + "Sign in with Google" in the real app, with Google faked.
// Checks: the tutorial opens only on a fresh phone; the answers reach the new sheet; the Bootstrap
// key becomes the sheet's app key; a failed step resumes without making a second sheet; a connected
// phone (Abdullah's) never sees it. Also: docs/backend/Code.gs is an exact copy of apps-script/Code.gs.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-onboarding.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { makeEnv } from './fake-sheet.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.env.BASE || 'http://localhost:8765').replace(/\/$/, '');

// ── the two copies of the script must match (the app uploads the docs/ one to new sheets)
assert.equal(fs.readFileSync(new URL('../docs/backend/Code.gs', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), 'docs/backend/Code.gs differs from apps-script/Code.gs: copy it over');

// ── script level: a Bootstrap key is used, and the first request builds the tabs
{
  const { ctx, ss } = makeEnv({ extra: "var SPENDINGS_BOOTSTRAP = { token: 'abcdef0123456789abcdef0123456789' };" });
  assert.equal(ss.getSheetByName('Ledger'), null);
  const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'abcdef0123456789abcdef0123456789', action: 'ping' }) } }).text);
  assert.equal(r.ok, true, 'bootstrap key works');
  assert.ok(ss.getSheetByName('Ledger') && ss.getSheetByName('Overview'), 'tabs built on first request');
  const bad = makeEnv({ extra: "var SPENDINGS_BOOTSTRAP = { token: 'short' };" });
  assert.notEqual(bad.ctx.getToken_(), 'short', 'a malformed bootstrap key is ignored');
  const plain = makeEnv(); // Abdullah's sheet: no bootstrap, key already set
  plain.ctx.setup();
  const k = plain.ctx.getToken_();
  assert.equal(plain.ctx.getToken_(), k);
  assert.equal(JSON.parse(plain.ctx.doPost({ postData: { contents: JSON.stringify({ token: k, source: 'applepay', amount: 'AED 5', merchant: 'Test', card: 'ADCB', category: 'Groceries' }) } }).text).ok, true, 'Apple Pay still works');
}

// ── fake Google
const calls = { sheets: 0, scripts: 0 };
let files = null, env = null, allowed = false, failScriptOnce = true;
const NEW_URL = 'https://script.google.com/macros/s/NEWSHEET/exec';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await c.addInitScript(() => { try { localStorage.setItem('sp.gcid', 'test-client.apps.googleusercontent.com'); } catch {} });
await c.route('https://accounts.google.com/**', (route) => {
  const u = new URL(route.request().url());
  assert.equal(u.searchParams.get('response_type'), 'token');
  const back = `${u.searchParams.get('redirect_uri')}#access_token=TOK&token_type=Bearer&expires_in=3599&state=${u.searchParams.get('state')}&scope=${encodeURIComponent(u.searchParams.get('scope'))}`;
  return route.fulfill({ status: 302, headers: { location: back } });
});
await c.route('https://sheets.googleapis.com/**', (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  assert.equal(route.request().headers().authorization, 'Bearer TOK');
  calls.sheets++;
  return json(route, { spreadsheetId: 'S1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/S1/edit' });
});
await c.route('https://script.googleapis.com/**', (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (u.pathname === '/v1/projects') {
    if (failScriptOnce) { failScriptOnce = false; return json(route, { error: { code: 403, message: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry.' } }, 403); }
    calls.scripts++;
    assert.equal(JSON.parse(req.postData()).parentId, 'S1');
    return json(route, { scriptId: 'P1' });
  }
  if (u.pathname.endsWith('/content')) { files = JSON.parse(req.postData()).files; return json(route, {}); }
  if (u.pathname.endsWith('/versions')) return json(route, { versionNumber: 1 });
  if (u.pathname.endsWith('/deployments')) return json(route, { deploymentId: 'D1', entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: NEW_URL } }] });
  return json(route, { error: { message: 'unexpected' } }, 404);
});
await c.route('https://script.google.com/**', (route) => {
  // until the owner allows access, Google answers with a sign-in page, not JSON
  if (!allowed) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Authorization needed</html>' });
  if (!env) {
    const code = files.find((f) => f.name === 'Code').source, boot = files.find((f) => f.name === 'Bootstrap').source;
    env = makeEnv({ source: code, extra: boot });
  }
  const out = env.ctx.doPost({ postData: { contents: route.request().postData() } });
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text });
});

const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${BASE}/`);
await p.waitForSelector('.onb .onb-hero h1:text("Spendings")');

// accounts
await p.click('[data-onb="next"]');
await p.click('[data-add="ADIB"]');
await p.click('[data-add="ADCB"]');
await p.click('[data-onb="add-blank"]');
await p.fill('input[name="acc-name"][data-i="2"]', 'My Wallet');
await p.click('[data-onb="next"]');
// roles
await p.click('[data-pick="main"][data-name="ADIB"]');
assert.ok(await p.isDisabled('[data-onb="next"]'), 'needs both picks');
await p.click('[data-pick="allowanceAcc"][data-name="ADCB"]');
await p.click('[data-onb="next"]');
// money
await p.fill('input[name="salary"]', '6,000');
await p.selectOption('select[name="payday"]', '25');
await p.fill('input[name="allowance"]', '2500');
await p.click('[data-onb="next"]');
// balances
await p.fill('input[name="bal"][data-name="ADIB"]', '5000');
await p.fill('input[name="bal"][data-name="ADCB"]', '1200.50');
await p.click('[data-onb="next"]');
// a reload in the middle keeps the answers
await p.reload();
await p.waitForSelector('.onb .onb-title:text("Make your sheet")');
assert.match(await p.textContent('.onb-summary'), /ADIB, ADCB, My Wallet/);

// sign in → the Apps Script API is off the first time → turn it on → try again
await p.click('[data-onb="google"]');
await p.waitForSelector('.onb a[href="https://script.google.com/home/usersettings"]');
assert.equal(calls.sheets, 1);
await p.click('[data-onb="retry"]');
await p.waitForSelector('.onb a[data-onb="allow"]');
assert.equal(calls.sheets, 1, 'try again must not make a second sheet');
assert.equal(calls.scripts, 1);
assert.equal(await p.getAttribute('a[data-onb="allow"]', 'href'), NEW_URL);
const manifest = JSON.parse(files.find((f) => f.name === 'appsscript').source);
assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
assert.equal(files.find((f) => f.name === 'Code').source, fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'));
assert.ok(!(await p.evaluate(() => location.hash)).includes('access_token'), 'token removed from the address bar');

// not allowed yet → a gentle note; allowed → saves and finishes
await p.click('[data-onb="check"]');
await p.waitForSelector('.toast:has-text("Not allowed yet")');
allowed = true;
await p.click('[data-onb="check"]');
await p.waitForSelector('.onb h1:text("You’re all set")', { timeout: 15000 });

const key = /token: '([A-Za-z0-9]+)'/.exec(files.find((f) => f.name === 'Bootstrap').source)[1];
const server = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ token: key, ...body }) } }).text);
const all = server({ action: 'list' });
assert.deepEqual(all.accounts.map((a) => a.name), ['ADIB', 'ADCB', 'My Wallet']);
assert.equal(all.accounts[1].wallet, 'adcb');
assert.equal(all.accounts[1].color, 'red');
assert.equal(all.settings.allowance, 2500);
assert.equal(all.settings.allowanceAccount, 'ADCB');
assert.equal(all.settings.emergencyAccount, 'ADIB');
assert.equal(all.settings.cycleStart, 25);
assert.deepEqual(all.plan.map((x) => [x.kind, x.amount, x.from, x.to, x.day]), [['Income', 6000, '', 'ADIB', 25], ['Move', 2500, 'ADIB', 'ADCB', 25]]);
assert.deepEqual(all.entries.map((e) => [e.type, e.account, e.amount]).sort(), [['Adjustment', 'ADCB', 1200.5], ['Adjustment', 'ADIB', 5000]]);
const conn = await p.evaluate(() => JSON.parse(localStorage.getItem('sp.conn')));
assert.deepEqual(conn, { url: NEW_URL, token: key });

await p.click('[data-onb="finish"]');
await p.waitForSelector('.onb', { state: 'detached' });
await p.reload();
await p.waitForTimeout(600);
assert.equal(await p.$('.onb'), null, 'no tutorial once connected');
await p.goto(`${BASE}/#settings`);
await p.reload();
await p.waitForSelector('.status-row .row-title:text("Connected")');
assert.equal(server({ action: 'list' }).entries.length, 2, 'no duplicate starting balances');

// ── a phone that's already connected (Abdullah's) never sees it; a #settings link skips it too
const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await c2.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem('sp.conn', JSON.stringify({ url: 'https://script.google.com/macros/s/OLD/exec', token: 'k' })); } });
await c2.route('https://script.google.com/**', (r) => json(r, { ok: true, entries: [], settings: {}, merchants: {}, plan: [], accounts: [{ name: 'ADIB' }] }));
const p2 = await c2.newPage();
await p2.goto(`${BASE}/`);
await p2.waitForTimeout(800);
assert.equal(await p2.$('.onb'), null, 'connected phone: no tutorial');
await p2.goto(`${BASE}/#settings`);
await p2.reload();
await p2.click('[data-act="onboard"]');
await p2.waitForSelector('.onb .tip-card:has-text("new, empty")');
await p2.click('[data-onb="close"]');
await p2.waitForSelector('.onb', { state: 'detached' });
assert.equal(JSON.parse(await p2.evaluate(() => localStorage.getItem('sp.conn'))).url, 'https://script.google.com/macros/s/OLD/exec', 'cancel keeps the old connection');

const c3 = await b.newContext({ viewport: { width: 390, height: 844 } });
const p3 = await c3.newPage();
await p3.goto(`${BASE}/#settings`);
await p3.waitForTimeout(500);
assert.equal(await p3.$('.onb'), null, '#settings link skips the tutorial');
await p3.goto(`${BASE}/`);
await p3.waitForSelector('.onb');
await p3.click('[data-onb="have"]');
await p3.waitForSelector('.onb', { state: 'detached' });
assert.equal(await p3.evaluate(() => location.hash), '#settings');
await p3.reload();
await p3.goto(`${BASE}/`);
await p3.waitForTimeout(500);
assert.equal(await p3.$('.onb'), null, 'skipped once, stays skipped');

assert.deepEqual(errors, []);
await b.close();
console.log('onboarding ok');
