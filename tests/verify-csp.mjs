// The app under its real security headers (docs/vercel.json): every tab, the report, settings and the setup
// guide's Sign in with Google (Google faked) run with no Content-Security-Policy violation and no page error.
// Usage: node tests/verify-csp.mjs   (starts its own server with Vercel's headers on a free port)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serve, headersFor } from './csp-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
let failed = 0;
async function check(name, fn) { try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}: ${e.stack || e.message}`); } }

const server = await serve(0);
const BASE = `http://localhost:${server.address().port}`;
const b = await chromium.launch();

await check('headers: CSP, no framing, nosniff on every page', async () => {
  const h = headersFor('/index.html');
  const csp = h['Content-Security-Policy'];
  assert.ok(csp, 'has a CSP');
  for (const part of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'"]) assert.ok(csp.includes(part), part);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp) && !/script-src[^;]*'unsafe-eval'/.test(csp), 'no inline or eval scripts');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  const r = await fetch(`${BASE}/`);
  assert.equal(r.headers.get('content-security-policy'), csp, 'the test server sends it');
});

async function page() {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await c.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  return { c, p, errors };
}
const violations = (p) => p.evaluate(() => window.__csp);

await check('demo data: every tab, an entry, the report and settings, with no CSP violation', async () => {
  const { c, p, errors } = await page();
  await p.goto(`${BASE}/?demo=1`);
  await p.waitForSelector('#view > *');
  for (const tab of ['activity', 'insights', 'settings', 'home']) {
    await p.click(`[data-tab="${tab}"]`);
    await p.waitForTimeout(400);
  }
  await p.click('[data-tab="insights"]');
  await p.click('[data-act="report"]');
  await p.waitForSelector('.sheet');
  await p.waitForTimeout(500);
  assert.deepEqual(await violations(p), []);
  assert.deepEqual(errors, []);
  await c.close();
});

await check('setup guide: Sign in with Google loads Google\'s script and makes the sheet, with no CSP violation', async () => {
  const { c, p, errors } = await page();
  await c.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';" }));
  await c.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: `window.google = { accounts: { oauth2: {
    initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'ya29.fake', expires_in: 3599, scope: cfg.scope }), 30); } }; },
    hasGrantedAllScopes() { return true; } } } };` }));
  const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  await c.route('https://www.googleapis.com/drive/**', (route) => ok(route, { id: 'SS1', webViewLink: 'https://docs.google.com/spreadsheets/d/SS1/edit' }));
  await c.route('https://sheets.googleapis.com/**', (route) => ok(route, route.request().method() === 'GET' ? { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] } : { replies: [] }));
  await p.goto(`${BASE}/`);
  await p.click('[data-su="have"]');
  await p.evaluate(() => { document.querySelector('.su-manual').open = false; });
  await p.click('[data-su="signin"]');
  await p.waitForSelector('.su-paste', { timeout: 10000 });
  await p.click('[data-su="copycode"]'); // fetches setup/Code.gs.txt from the app itself
  await p.waitForTimeout(300);
  assert.deepEqual(await violations(p), []);
  assert.deepEqual(errors, []);
  await c.close();
});

await check('the CSP blocks a script from anywhere else (so injected code can\'t load)', async () => {
  const { c, p } = await page();
  await p.goto(`${BASE}/?demo=1`);
  await p.waitForSelector('#view > *');
  await p.evaluate(() => { const s = document.createElement('script'); s.src = 'https://evil.example/x.js'; document.head.append(s); const i = document.createElement('div'); i.innerHTML = '<img src="x" onerror="window.__pwned=1">'; document.body.append(i); });
  await p.waitForTimeout(300);
  const v = await violations(p);
  assert.ok(v.some((x) => /script-src/.test(x) && /evil\.example/.test(x)), 'outside script blocked');
  assert.ok(v.some((x) => /script-src/.test(x) && /inline/.test(x)), 'inline handler blocked');
  assert.equal(await p.evaluate(() => window.__pwned), undefined);
  await c.close();
});

await b.close();
server.close();
console.log(failed ? `verify-csp: ${failed} failed` : 'verify-csp: all checks passed');
process.exit(failed ? 1 : 0);
