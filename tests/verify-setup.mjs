// The first-run setup guide and "Sign in with Google" sheet provisioning.
// Real Google can't be reached from a test, so Google is faked: the Drive and Sheets REST APIs
// (fakeGoogle below), Google's sign-in script (FAKE_GIS), and the web app you deploy by hand (Code.gs on
// the fake sheet).
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-setup.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { makeEnv } from './fake-sheet.mjs';
import { provision, makeKey, SCOPES, explain, isWebAppUrl, SHEET_MIME } from '../docs/js/provision.js';

const BASE = process.env.BASE || 'http://localhost:8765';
let failed = 0;
async function check(name, fn) { try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}: ${e.stack || e.message}`); } }

/* ───── (0) the browser's copy of the script is the script ───── */
const CODE = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
await check('docs/setup/Code.gs.txt is byte-identical to apps-script/Code.gs (cp apps-script/Code.gs docs/setup/Code.gs.txt)', () => {
  assert.ok(fs.readFileSync(new URL('../docs/setup/Code.gs.txt', import.meta.url)).equals(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url))));
});

/* ───── A fake Google: Drive v3 and Sheets v4, enough for provision.js ───── */
const EXEC = 'https://script.google.com/macros/s/NEWDEPLOY/exec';
function fakeGoogle() {
  const g = { calls: [], sheets: 0, key: '', drive: [], offlineAt: '', lostReplyAt: '', status401At: '', serviceDisabledAt: '' };
  g.handle = (method, url, body) => {
    const u = new URL(url);
    const tag = `${method} ${u.host.split('.')[0]}${u.pathname.replace(/\/v\d+/, '')}`;
    g.calls.push(tag);
    const err = (status, message, extra = {}) => ({ status, body: { error: { code: status, message, status: 'PERMISSION_DENIED', ...extra } } });
    if (g.offlineAt && tag.includes(g.offlineAt)) { g.offlineAt = ''; return 'offline'; }
    if (g.status401At && tag.includes(g.status401At)) { g.status401At = ''; return err(401, 'Request had invalid authentication credentials.'); }
    if (g.serviceDisabledAt && tag.includes(g.serviceDisabledAt)) return err(403, 'Google Drive API has not been used in project 123 before or it is disabled.', { details: [{ reason: 'SERVICE_DISABLED' }] });
    const out = (() => {
      // Drive: make a spreadsheet file, or list the files this app made
      if (u.host === 'www.googleapis.com' && u.pathname === '/drive/v3/files') {
        if (method === 'POST') {
          g.sheets++;
          g.createBody = body;
          const f = { id: `SS${g.sheets}`, webViewLink: `https://docs.google.com/spreadsheets/d/SS${g.sheets}/edit`, mimeType: body.mimeType, appProperties: body.appProperties, tabs: [{ sheetId: 0, title: 'Sheet1' }] };
          g.drive.push(f);
          return { status: 200, body: { id: f.id, webViewLink: f.webViewLink } };
        }
        if (method === 'GET') {
          g.listQ = u.searchParams.get('q');
          const m = /appProperties has \{ key='setupId' and value='([^']+)' \} and trashed=false/.exec(g.listQ || '');
          return { status: 200, body: { files: g.drive.filter((f) => m && f.appProperties?.setupId === m[1]).map((f) => ({ id: f.id, webViewLink: f.webViewLink })) } };
        }
      }
      if (u.host === 'sheets.googleapis.com') {
        const id = decodeURIComponent(u.pathname.split('/')[3] || '').replace(/:batchUpdate$/, '');
        const f = g.drive.find((x) => x.id === id);
        if (!f) return { status: 404, body: { error: { code: 404, message: 'Requested entity was not found.' } } };
        if (method === 'GET') return { status: 200, body: { sheets: f.tabs.map((t) => ({ properties: t })) } };
        if (method === 'POST' && u.pathname.endsWith(':batchUpdate')) {
          for (const r of body.requests) {
            if (r.updateSheetProperties) f.tabs.find((t) => t.sheetId === r.updateSheetProperties.properties.sheetId).title = r.updateSheetProperties.properties.title;
            if (r.updateCells) {
              const rows = r.updateCells.rows.map((x) => x.values[0].userEnteredValue.stringValue);
              g.mark = rows[0]; g.key = rows[1];
            }
            if (r.updateSpreadsheetProperties) g.sheetProps = r.updateSpreadsheetProperties.properties;
          }
          g.tab = f.tabs[0].title;
          return { status: 200, body: { spreadsheetId: id, replies: [] } };
        }
      }
      return { status: 404, body: { error: { code: 404, message: 'Not found' } } };
    })();
    // Google did the work, but the answer never arrived
    if (g.lostReplyAt && tag.includes(g.lostReplyAt)) { g.lostReplyAt = ''; return 'offline'; }
    return out;
  };
  g.fetch = async (url, init = {}) => {
    g.auth = init.headers?.Authorization;
    const r = g.handle(init.method || 'GET', url, init.body ? JSON.parse(init.body) : null);
    if (r === 'offline') throw new TypeError('Failed to fetch');
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  return g;
}
const MADE = ['POST www/drive/files', 'GET sheets/spreadsheets/SS1', 'POST sheets/spreadsheets/SS1:batchUpdate'];

/* ───── (a) provision.js against the fake ───── */
await check('provision: makes the sheet and writes the key, nothing else, with the token and a 24-character key', async () => {
  const g = fakeGoogle();
  const saves = [];
  let savedAtCreate = null;
  const f0 = g.fetch;
  g.fetch = (url, init) => { if (url.startsWith('https://www.googleapis.com/drive/v3/files') && init.method === 'POST') savedAtCreate = saves.at(-1); return f0(url, init); };
  const p = await provision({ token: 'ya29.t', fetch: g.fetch, save: (x) => saves.push(x) });
  assert.deepEqual(g.calls, MADE, 'only Drive and Sheets: no Apps Script API');
  assert.equal(g.auth, 'Bearer ya29.t');
  assert.match(p.key, /^[A-Za-z0-9]{24}$/);
  // made through Drive as a Google Sheet, labelled with a setup id that was saved before asking
  assert.equal(g.createBody.mimeType, SHEET_MIME);
  assert.equal(SHEET_MIME, 'application/vnd.google-apps.spreadsheet');
  assert.equal(g.createBody.name, 'Spendings');
  assert.equal(g.createBody.appProperties.spendings, '1');
  assert.match(p.setupId, /^[A-Za-z0-9]{24}$/);
  assert.notEqual(p.setupId, p.key, 'the setup id is not the key');
  assert.equal(g.createBody.appProperties.setupId, p.setupId);
  assert.equal(savedAtCreate.setupId, p.setupId, 'setup id saved on the phone before the sheet is made');
  assert.equal(savedAtCreate.sheetAsked, true);
  assert.ok(!Object.values(g.createBody.appProperties).includes(p.key), 'the key is not in Drive\'s labels');
  assert.equal(g.key, p.key, 'the key goes into the new sheet');
  assert.equal(g.tab, 'Setup');
  assert.deepEqual(g.sheetProps, { timeZone: 'Asia/Dubai', locale: 'en_GB' });
  assert.match(g.mark, /^Spendings app key/, 'marked the way Code.gs looks for it');
  assert.equal(p.spreadsheetId, 'SS1');
  assert.equal(p.spreadsheetUrl, 'https://docs.google.com/spreadsheets/d/SS1/edit');
  assert.equal(p.keyWritten, true);
  assert.ok(saves.length >= 4 && saves.at(-1).keyWritten, 'progress saved after every step');
  // done: running again makes nothing
  g.calls.length = 0;
  await provision({ token: 't', fetch: g.fetch, progress: p });
  assert.deepEqual(g.calls, []);
});

await check('sign-in asks only for drive.file (non-sensitive, so the app can be published without verification)', () => {
  assert.deepEqual(SCOPES, ['https://www.googleapis.com/auth/drive.file']);
});

await check('a dropped connection mid-way resumes at the step that failed', async () => {
  const g = fakeGoogle();
  g.offlineAt = 'batchUpdate';
  let saved = {};
  await assert.rejects(provision({ token: 't', fetch: g.fetch, save: (x) => { saved = x; } }), (e) => e.code === 'offline');
  assert.ok(saved.spreadsheetId && !saved.keyWritten);
  g.calls.length = 0;
  await provision({ token: 't', fetch: g.fetch, progress: saved, save: (x) => { saved = x; } });
  assert.deepEqual(g.calls, ['GET sheets/spreadsheets/SS1', 'POST sheets/spreadsheets/SS1:batchUpdate']);
  assert.equal(g.listQ, undefined, 'no need to look for the sheet: its id was saved');
  assert.equal(g.sheets, 1);
  assert.ok(saved.keyWritten);
});

await check('the reply to "make the sheet" is lost: Try again finds that sheet instead of making a second', async () => {
  const g = fakeGoogle();
  g.lostReplyAt = 'POST www/drive/files';
  let saved = {};
  await assert.rejects(provision({ token: 't', fetch: g.fetch, save: (x) => { saved = x; } }), (e) => e.code === 'offline');
  assert.equal(g.sheets, 1, 'Google did make it');
  assert.ok(saved.setupId && saved.sheetAsked && !saved.spreadsheetId, 'the phone never heard which sheet');
  g.calls.length = 0;
  const p = await provision({ token: 't', fetch: g.fetch, progress: saved, save: (x) => { saved = x; } });
  assert.equal(g.calls[0], 'GET www/drive/files', 'looked for it first');
  assert.equal(g.listQ, `appProperties has { key='setupId' and value='${saved.setupId}' } and trashed=false`);
  assert.ok(!g.calls.includes('POST www/drive/files'), 'no second sheet');
  assert.equal(g.sheets, 1);
  assert.equal(p.spreadsheetId, 'SS1');
  assert.equal(g.key, p.key, 'the found sheet gets the key');
  // looked, found nothing (it really failed): makes one, with the same setup id
  const g2 = fakeGoogle();
  g2.offlineAt = 'POST www/drive/files';
  let s2 = {};
  await assert.rejects(provision({ token: 't', fetch: g2.fetch, save: (x) => { s2 = x; } }));
  assert.equal(g2.sheets, 0);
  await provision({ token: 't', fetch: g2.fetch, progress: s2, save: (x) => { s2 = x; } });
  assert.deepEqual(g2.calls.slice(1, 3), ['GET www/drive/files', 'POST www/drive/files']);
  assert.equal(g2.sheets, 1);
  assert.equal(g2.createBody.appProperties.setupId, s2.setupId);
  // the key-writing reply lost: written again (same key), nothing new made
  const g3 = fakeGoogle();
  g3.lostReplyAt = 'batchUpdate';
  let s3 = {};
  await assert.rejects(provision({ token: 't', fetch: g3.fetch, save: (x) => { s3 = x; } }));
  assert.ok(s3.spreadsheetId && !s3.keyWritten);
  const p3 = await provision({ token: 't', fetch: g3.fetch, progress: s3 });
  assert.equal(g3.sheets, 1); assert.equal(g3.key, p3.key); assert.equal(g3.tab, 'Setup');
});

await check('expired sign-in (401) and an API switched off in Google Cloud are told apart', async () => {
  const g = fakeGoogle();
  g.status401At = 'spreadsheets';
  await assert.rejects(provision({ token: 't', fetch: g.fetch }), (e) => e.code === 'auth');
  const g2 = fakeGoogle();
  g2.serviceDisabledAt = 'drive';
  await assert.rejects(provision({ token: 't', fetch: g2.fetch }), (e) => e.code === 'api-disabled');
  assert.equal(explain(500, {}).code, 'busy');
  assert.equal(explain(403, { error: { message: 'The caller does not have permission' } }).code, 'denied');
  assert.ok(isWebAppUrl('https://script.google.com/macros/s/ABC/exec'));
  assert.ok(isWebAppUrl('  https://script.googleusercontent.com/macros/echo?x=1 '));
  assert.ok(!isWebAppUrl('https://docs.google.com/spreadsheets/d/SS1/edit'));
  assert.ok(!isWebAppUrl(''));
});

await check('makeKey: 24 letters and digits, skips biased bytes', () => {
  let n = 0;
  const rand = (a) => { a.fill(0); a.forEach((_, i) => { a[i] = n++ % 2 ? 255 : 0; }); return a; }; // every other byte must be thrown away
  assert.equal(makeKey(rand), 'A'.repeat(24));
  const keys = new Set(Array.from({ length: 50 }, () => makeKey()));
  assert.equal(keys.size, 50);
  for (const k of keys) assert.match(k, /^[A-Za-z0-9]{24}$/);
});

/* ───── (c) the guide in the browser ───── */
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const errors = [];
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
// a sheet's web app at URL, run by Code.gs on a fake sheet
const routeSheet = (c, env, url = 'https://script.google.com/macros/s/TEST/exec') => c.route(`${url}*`, (route) => json(route, env.ctx.doPost({ postData: { contents: route.request().postData() } }).text));
async function fresh() {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  // Tests start with no client ID (by-hand setup) whatever config.js holds; sign-in tests route their own
  // test ID on top (Playwright tries the newest route first).
  await c.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = '';" }));
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return { c, p };
}
// The app has drawn its first screen and had two frames to open (or not open) the guide.
const booted = (p) => p.waitForFunction(() => document.querySelector('#view')?.children.length > 0 && document.readyState === 'complete')
  .then(() => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))))));
const sheetList = (env, token) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text);

await check('a fresh phone opens the guide at Home; Try with demo data closes it and shows demo data', async () => {
  const { c, p } = await fresh();
  await p.goto(`${BASE}/`);
  await p.waitForSelector('.setup-sheet .su-h:text("Welcome to Spendings")');
  assert.match(await p.textContent('.su-body'), /need a Google account.*about 5 minutes/, 'says up front what it needs');
  const boxes = await p.$$eval('.setup-sheet button, .setup-sheet a', (els) => els.filter((e) => e.offsetParent).map((e) => [e.textContent.trim(), e.getBoundingClientRect().height]));
  for (const [t, h] of boxes) assert.ok(h >= 44, `"${t}" is ${h}px tall`);
  await p.click('[data-su="demo"]');
  await p.waitForSelector('.setup-sheet', { state: 'detached' });
  assert.equal(await p.evaluate(async () => (await import('/js/store.js')).isDemo()), true);
  await p.reload();
  await booted(p);
  assert.equal(await p.locator('.setup-sheet').count(), 0, 'demo mode: no guide');
  await c.close();
});

await check('links straight to Settings, ?notour and "Not now" don\'t open it again', async () => {
  const { c, p } = await fresh();
  await p.goto(`${BASE}/#settings`);
  await p.waitForSelector('input[name="url"]');
  await booted(p);
  assert.equal(await p.locator('.setup-sheet').count(), 0);
  await p.goto(`${BASE}/?notour=1#home`);
  await booted(p);
  assert.equal(await p.locator('.setup-sheet').count(), 0);
  await p.goto(`${BASE}/#home`);
  await p.waitForSelector('.setup-sheet');
  await p.click('[data-su="close"]');
  await p.waitForSelector('.setup-sheet', { state: 'detached' });
  await p.reload();
  await booted(p);
  assert.equal(await p.locator('.setup-sheet').count(), 0, 'put off: stays closed');
  // Home's "Set up" and Settings → Set up step by step open it again
  await p.click('.onboard [data-act="setup-guide"]');
  await p.waitForSelector('.setup-sheet');
  await c.close();
});

await check('no client ID: accounts and money, then "Paste URL and key" sends the answers to the sheet', async () => {
  const env = makeEnv({ newUser: true }); env.ctx.setup();
  const token = env.ctx.getToken_();
  const { c, p } = await fresh();
  await routeSheet(c, env);
  await p.goto(`${BASE}/`);
  await p.click('[data-su="next"]');
  await p.waitForSelector('.su-acct');
  // a new user starts with plain names, no bank assumed and no Wallet words filled in
  assert.deepEqual(await p.$$eval('.su-name', (els) => els.map((e) => e.value)), ['Account 1', 'Account 2', 'Cash']);
  assert.deepEqual(await p.$$eval('[data-su-field="wallet"]', (els) => els.map((e) => e.value)), ['', '', '']);
  assert.doesNotMatch(await p.textContent('.su-body'), /ADIB|ADCB|BOTIM/);
  // Account 1 becomes Wio, Account 2 becomes ADCB; a new Revolut card; Cash is removed; Wio gets pay, ADCB the allowance
  await p.fill('.su-acct[data-i="0"] .su-name', 'Wio');
  await p.fill('.su-acct[data-i="0"] [data-su-field="wallet"]', 'wio');
  await p.fill('.su-acct[data-i="1"] .su-name', 'ADCB');
  await p.click('[data-su-add]');
  await p.fill('.su-acct[data-i="3"] .su-name', 'Revolut <b>');
  await p.click('[data-su-colours="3"]');
  await p.click('[data-su-colour="3:pink"]');
  await p.click('[data-su-del="2"]');
  await p.click('[data-su-role="pay"][data-name="Wio"]');
  await p.click('[data-su-role="allowanceAccount"][data-name="ADCB"]');
  assert.equal(await p.locator('.su-roles b').count(), 0, 'names are escaped');
  await p.click('[data-su="next"]');
  await p.fill('input[name="su-allowance"]', '2500');
  await p.selectOption('select[name="su-cycle"]', '25');
  await p.fill('input[name="su-salary"]', '8000');
  await p.selectOption('select[name="su-salday"]', '25');
  await p.click('[data-su="next"]');
  await p.waitForSelector('.su-h:text("Create your sheet")');
  assert.match(await p.textContent('.su-body'), /isn’t switched on/);
  assert.equal(await p.locator('.su-manual[open]').count(), 1, 'the by-hand path is open');
  assert.equal(await p.locator('[data-su="signin"]').count(), 0);
  await p.fill('input[name="su-url"]', 'https://script.google.com/macros/s/TEST/exec');
  await p.fill('input[name="su-token"]', token);
  await p.click('[data-su="connect"]');
  await p.waitForSelector('.su-h:text("Log Apple Pay by itself")', { timeout: 10000 });
  const s = sheetList(env, token);
  assert.deepEqual(s.accounts.map((a) => a.name), ['Wio', 'ADCB', 'Revolut <b>']);
  assert.equal(s.accounts.find((a) => a.name === 'Wio').wallet, 'wio');
  assert.equal(s.accounts.find((a) => a.name === 'Revolut <b>').color, 'pink');
  assert.equal(s.accounts.find((a) => a.name === 'Wio').note, 'Main · pay lands here');
  assert.equal(s.settings.allowanceAccount, 'ADCB');
  assert.equal(s.settings.emergencyAccount, 'Wio');
  assert.equal(s.settings.cycleStart, 25);
  assert.equal(s.settings.allowance, 2500);
  assert.deepEqual(s.plan.map((x) => [x.id, x.kind, x.amount, x.day, x.from, x.to]), [['salary', 'Income', 8000, 25, '', 'Wio'], ['allowance', 'Move', 2500, 25, 'Wio', 'ADCB']]);
  await p.click('[data-su="next"]');
  await p.waitForSelector('.su-h:text("You’re all set")');
  assert.match(await p.textContent('.su-body'), /3 accounts, pay lands in Wio/);
  await p.click('[data-su="finish"]');
  await p.waitForSelector('.setup-sheet', { state: 'detached' });
  await p.goto(`${BASE}/#home`);
  await p.reload();
  await booted(p);
  assert.equal(await p.locator('.setup-sheet').count(), 0, 'connected: never shown again');
  assert.equal(await p.locator('.onboard').count(), 0);
  await c.close();
});

await check('"I already have a sheet": an existing sheet keeps its accounts and plan', async () => {
  const env = makeEnv(); env.ctx.setup();
  const token = env.ctx.getToken_();
  env.ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'add', entry: { id: 'old1', type: 'Spend', amount: 9, account: 'ADCB', category: 'Other' } }) } });
  const { c, p } = await fresh();
  await routeSheet(c, env);
  await p.goto(`${BASE}/`);
  await p.click('[data-su="next"]');
  await p.fill('.su-acct[data-i="0"] .su-name', 'Changed'); // touched answers…
  await p.click('[data-su="back"]');
  await p.click('[data-su="have"]');
  await p.fill('input[name="su-url"]', 'https://script.google.com/macros/s/TEST/exec');
  await p.fill('input[name="su-token"]', token);
  await p.click('[data-su="connect"]');
  await p.waitForSelector('.su-h:text("Log Apple Pay by itself")', { timeout: 10000 });
  const s = sheetList(env, token);
  assert.deepEqual(s.accounts.map((a) => a.name), ['ADIB', 'ADCB', 'BOTIM', 'Cash'], '…but the sheet already had data, so it wins');
  assert.equal(s.plan.length, 4);
  assert.equal(await p.evaluate(async () => (await import('/js/store.js')).state.entries.length), 1);
  await c.close();
});

// Google's sign-in script, faked: hands back a token with every scope asked for
const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { window.__gisCfg = cfg; return { requestAccessToken() { window.__gisAsked = (window.__gisAsked || 0) + 1; setTimeout(() => cfg.callback({ access_token: 'ya29.fake', expires_in: 3599, scope: cfg.scope }), 30); } }; },
  hasGrantedAllScopes(r, ...s) { return s.every((x) => r.scope.split(' ').includes(x)); },
} } };`;

await check('Sign in with Google (all Google calls faked): sheet made → paste the script by hand → paste the URL → sheet ready with the answers', async () => {
  const g = fakeGoogle();
  let env = null;
  const { c, p } = await fresh();
  await c.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';" }));
  await c.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
  await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const api = async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const out = g.handle(r.method(), r.url(), r.postData() ? JSON.parse(r.postData()) : null);
    if (out === 'offline') return route.abort('internetdisconnected');
    // the new sheet: just the Setup tab with the key, like Google would make it
    if (g.key && !env) {
      env = makeEnv({ newUser: true });
      const t = env.ss.insertSheet('Setup');
      t.getRange(1, 1).setValue(g.mark); t.getRange(2, 1).setValue(g.key);
      env.ss.deleteSheet(env.ss.getSheetByName('Sheet1'));
    }
    return route.fulfill({ status: out.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out.body) });
  };
  await c.route('https://sheets.googleapis.com/**', api);
  await c.route('https://www.googleapis.com/drive/**', api);
  let scriptCalls = 0;
  await c.route('https://script.googleapis.com/**', (route) => { scriptCalls++; return route.abort(); });
  const pings = [];
  // the web app you deploy by hand from the sheet's Apps Script, running the script you pasted
  await c.route(`${EXEC}*`, (route) => {
    const body = route.request().postData();
    pings.push(JSON.parse(body || '{}').action);
    return json(route, env.ctx.doPost({ postData: { contents: body } }).text);
  });
  await p.goto(`${BASE}/`);
  await p.click('[data-su="next"]');
  await p.fill('.su-acct[data-i="0"] .su-name', 'FAB');
  await p.fill('.su-acct[data-i="0"] [data-su-field="wallet"]', 'fab');
  await p.click('[data-su="next"]');
  await p.fill('input[name="su-allowance"]', '1800');
  await p.click('[data-su="next"]');
  // no Apps Script API step any more: straight to the sheet
  await p.waitForSelector('[data-su="signin"]');
  assert.equal(await p.locator('.su-h:text("Turn on the Apps Script API")').count(), 0);
  assert.deepEqual(await p.$$eval('.su-tasks li span', (els) => els.map((e) => e.textContent)), ['1. Sign in', '2. Make your sheet', '3. Add the script'], 'plain three-step progress');
  assert.match(await p.textContent('.su-body'), /isn’t kept/);
  assert.match(await p.textContent('.su-body'), /only see the files it makes/);
  assert.equal(await p.locator('.su-manual[open]').count(), 0, 'by-hand path tucked away');
  await p.click('[data-su="signin"]');
  await p.waitForSelector('.su-paste', { timeout: 10000 });
  assert.deepEqual(await p.evaluate(() => window.__gisCfg.scope.split(' ')), SCOPES);
  assert.deepEqual(g.calls, MADE);
  assert.equal(scriptCalls, 0, 'never calls the Apps Script API');
  assert.equal(await p.locator('.su-tasks li.done').count(), 2);
  assert.equal(await p.locator('.su-tasks li.now span:text("3. Add the script")').count(), 1);
  assert.equal(await p.getAttribute('a.su-opensheet', 'href'), 'https://docs.google.com/spreadsheets/d/SS1/edit');
  assert.equal(await p.getAttribute('a.su-opensheet', 'target'), '_blank');
  const text = await p.textContent('.su-paste');
  for (const words of ['Extensions → Apps Script', 'New deployment', 'Web app', 'Execute as: Me', 'Who has access: Anyone', 'Authorize access', 'Go to … (unsafe)', '/exec']) assert.ok(text.includes(words), `says "${words}"`);
  assert.match(await p.textContent('.su-body'), /Safari and the Home Screen app keep separate storage/);
  // Copy the script puts all of Code.gs on the clipboard
  await p.click('[data-su="copycode"]');
  await p.waitForSelector('#toast:has-text("Script copied")');
  assert.equal(await p.evaluate(() => navigator.clipboard.readText()), CODE);
  // reload mid-way: it comes back at the paste step, not at the start
  await p.reload();
  await p.waitForSelector('.su-paste');
  // a wrong address: plain words, nothing connected
  await p.fill('input[name="su-paste-url"]', 'https://docs.google.com/spreadsheets/d/SS1/edit');
  await p.click('[data-su="connectpasted"]');
  await p.waitForSelector('#toast:has-text("doesn’t look like a Web app URL")');
  assert.ok(!env.props.TOKEN, 'nothing reached the script yet');
  await p.fill('input[name="su-paste-url"]', EXEC);
  await p.click('[data-su="connectpasted"]');
  await p.waitForSelector('.su-h:text("Log Apple Pay by itself")', { timeout: 15000 });
  assert.equal(env.props.TOKEN, g.key, 'the script adopted the app\'s key from the Setup tab');
  assert.ok(env.ss.getSheetByName('Ledger') && !env.ss.getSheetByName('Setup'));
  assert.ok(pings.includes('ping') && pings.includes('install'));
  const s = sheetList(env, g.key);
  assert.deepEqual(s.accounts.map((a) => a.name), ['FAB', 'Account 2', 'Cash'], 'a new user: plain starting names, the one they renamed');
  assert.equal(s.accounts[0].wallet, 'fab');
  assert.equal(s.settings.emergencyAccount, 'FAB', 'pay followed the rename');
  assert.equal(s.settings.allowance, 1800);
  assert.ok(s.plan.some((x) => x.id === 'allowance' && x.from === 'FAB' && x.to === 'Account 2' && x.amount === 1800));
  const conn = await p.evaluate(async () => (await import('/js/store.js')).state.conn);
  assert.deepEqual(conn, { url: EXEC, token: g.key });
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('sp.setup')).progress), null, 'progress cleared once connected');
  await p.screenshot({ path: '/tmp/verify-setup-shortcut.png' });
  await c.close();
});

await check('the pasted address answers with Google\'s sign-in page (not deployed for Anyone): plain words, try again works', async () => {
  const g = fakeGoogle();
  let env = null, open = false;
  const { c, p } = await fresh();
  await c.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';" }));
  await c.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
  const api = async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const out = g.handle(r.method(), r.url(), r.postData() ? JSON.parse(r.postData()) : null);
    if (g.key && !env) {
      env = makeEnv();
      const t = env.ss.insertSheet('Setup');
      t.getRange(1, 1).setValue(g.mark); t.getRange(2, 1).setValue(g.key);
    }
    return route.fulfill({ status: out.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out.body) });
  };
  await c.route('https://sheets.googleapis.com/**', api);
  await c.route('https://www.googleapis.com/drive/**', api);
  await c.route(`${EXEC}*`, (route) => {
    if (!open) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Sign in</html>' });
    return json(route, env.ctx.doPost({ postData: { contents: route.request().postData() } }).text);
  });
  await p.goto(`${BASE}/`);
  await p.click('[data-su="have"]');
  await p.evaluate(() => { document.querySelector('.su-manual').open = false; });
  await p.click('[data-su="signin"]');
  await p.waitForSelector('.su-paste', { timeout: 10000 });
  await p.fill('input[name="su-paste-url"]', EXEC);
  await p.click('[data-su="connectpasted"]');
  await p.waitForSelector('.su-error');
  assert.match(await p.textContent('.su-error'), /Anyone/);
  assert.equal(await p.locator('.su-error [data-su="retry"]').count(), 0, 'no Try again that would make another sheet');
  assert.equal(await p.inputValue('input[name="su-paste-url"]'), EXEC, 'the address is kept');
  open = true;
  await p.click('[data-su="connectpasted"]');
  await p.waitForSelector('.su-h:text("Log Apple Pay by itself")', { timeout: 15000 });
  assert.equal(env.props.TOKEN, g.key);
  assert.equal(g.sheets, 1);
  await c.close();
});

await check('a pasted sheet with its own accounts (no entries) keeps them; the guide says so', async () => {
  const env = makeEnv(); env.ctx.setup();
  const token = env.ctx.getToken_();
  env.ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'accounts', accounts: [{ name: 'Mine', color: 'blue' }, { name: 'Cash', color: 'green' }] }) } });
  env.ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'settings', settings: { cycleStart: 3 } }) } });
  const { c, p } = await fresh();
  await routeSheet(c, env);
  await p.goto(`${BASE}/`);
  await p.click('[data-su="next"]');
  await p.fill('.su-acct[data-i="0"] .su-name', 'Changed');
  await p.click('[data-su="next"]');
  await p.fill('input[name="su-allowance"]', '999');
  await p.click('[data-su="next"]');
  await p.waitForSelector('.su-h:text("Create your sheet")');
  await p.fill('input[name="su-url"]', 'https://script.google.com/macros/s/TEST/exec');
  await p.fill('input[name="su-token"]', token);
  await p.click('[data-su="connect"]');
  await p.waitForSelector('.su-h:text("Log Apple Pay by itself")', { timeout: 10000 });
  const s = sheetList(env, token);
  assert.deepEqual(s.accounts.map((a) => a.name), ['Mine', 'Cash'], 'not overwritten');
  assert.equal(s.settings.cycleStart, 3);
  assert.notEqual(s.settings.allowance, 999);
  assert.ok(env.ss.getSheetByName('Ledger').getLastRow() <= 1, 'still no entries');
  assert.match(await p.textContent('#toast'), /kept them/);
  await c.close();
});

// Google's sign-in window can't open (iPhone Home Screen app, or a blocked pop-up)
const FAKE_GIS_FAIL = (type) => `window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { return { requestAccessToken() { window.__gisAsked = (window.__gisAsked || 0) + 1; setTimeout(() => cfg.error_callback({ type: '${type}' }), 30); } }; },
  hasGrantedAllScopes() { return true; },
} } };`;
for (const [label, type, homeScreen] of [['blocked pop-up in Safari', 'popup_failed_to_open', false], ['Home Screen app', 'popup_closed', true]]) {
  await check(`sign-in window fails (${label}): "Open this page in Safari to sign in", the by-hand path open, no endless "tap again"`, async () => {
    const { c, p } = await fresh();
    if (homeScreen) await c.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
    await c.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';" }));
    await c.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS_FAIL(type) }));
    await p.goto(`${BASE}/`);
    await p.click('[data-su="have"]'); // straight to the sheet step
    await p.waitForSelector('.su-h:text("Create your sheet")');
    // "have" opens the by-hand form; fold it to see the failure open it again
    await p.evaluate(() => { document.querySelector('.su-manual').open = false; });
    await p.click('[data-su="signin"]');
    await p.waitForSelector('.su-error');
    assert.match(await p.textContent('.su-error'), /Open this page in Safari to sign in/);
    assert.match(await p.textContent('.su-error'), /by hand/);
    assert.equal(await p.locator('.su-error a[data-su-safari]').count(), 1);
    assert.equal(await p.getAttribute('.su-error a[data-su-safari]', 'target'), '_blank');
    assert.equal(await p.locator('.su-manual[open]').count(), 1, 'the by-hand path is open, right there');
    if (homeScreen) assert.equal(await p.locator('.su-error [data-su="signin"]').count(), 0, 'no "try again" in the Home Screen app');
    else {
      // one more try in Safari is fine; after that, no more
      await p.click('.su-error [data-su="signin"]');
      await p.waitForFunction(() => window.__gisAsked === 2);
      await p.waitForSelector('.su-error');
      assert.equal(await p.locator('.su-error [data-su="signin"]').count(), 0, 'no endless "tap again"');
    }
    assert.equal(await p.locator('.su-google').count(), 0);
    await c.close();
  });
}

await check('dark mode: the guide uses the dark colours', async () => {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', colorScheme: 'dark' });
  const p = await c.newPage();
  await p.goto(`${BASE}/`);
  await p.waitForSelector('.setup-sheet');
  const bg = await p.$eval('.su-list', (el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(28, 28, 30)');
  await p.screenshot({ path: '/tmp/verify-setup-dark.png' });
  await c.close();
});

assert.deepEqual(errors, []);
await b.close();
if (failed) { console.log(`verify-setup: ${failed} failed`); process.exit(1); }
console.log('verify-setup: all checks passed');
