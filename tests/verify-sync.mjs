// Sync behaviour in the real web app against Code.gs on the fake sheet: quiet retries, delayed spinner,
// the 45s timeout and skipping the re-read right after a recent one.
// Usage: (cd docs && python3 -m http.server 8765 &) ; node tests/verify-sync.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEnv } from './fake-sheet.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { ctx } = makeEnv();
ctx.setup();
const token = ctx.getToken_();
const URL_ = 'https://script.google.com/macros/s/TEST/exec';

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
let online = true, delay = 0;
const calls = [];
await c.route('https://script.google.com/**', async (route) => {
  if (!online) return route.abort('internetdisconnected');
  const body = route.request().postData();
  calls.push(JSON.parse(body).action);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const out = ctx.doPost({ postData: { contents: body } });
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text }).catch(() => {});
});
const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const store = (fn, arg) => p.evaluate(async ([src, a]) => { const s = await import('/js/store.js'); return new Function('s', 'a', `return (${src})(s, a)`)(s, a); }, [fn.toString(), arg]);
const status = () => store((s) => s.state.sync.status);
const server = () => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, action: 'list' }) } }).text).entries;
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await p.waitForTimeout(100); } throw new Error(`still waiting after ${ms}ms`); }
let failed = 0;
async function check(name, fn) { try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); } }

await p.goto('http://localhost:8765/#settings');
await p.fill('input[name="url"]', URL_);
await p.fill('input[name="token"]', token);
await p.click('[data-act="connect"]');
await p.waitForSelector('.status-row .row-title:text("Connected")');
await p.click('.tabbar [data-tab="home"]');
await p.waitForTimeout(500);

await check('a quick save never shows the Syncing spinner', async () => {
  let seen = false;
  const watch = setInterval(async () => { if (await p.locator('.sync-badge.spin').count().catch(() => 0)) seen = true; }, 50);
  await store((s) => s.addEntry({ type: 'Spend', amount: 5, account: 'ADCB', category: 'Groceries', merchant: 'Quick' }));
  await p.waitForTimeout(1500);
  clearInterval(watch);
  assert.equal(seen, false);
  assert.equal(await status(), 'ok');
});

await check('a save right after a read skips the full list and is marked synced', async () => {
  await store((s) => s.sync());
  calls.length = 0;
  await store((s) => s.addEntry({ type: 'Spend', amount: 6, account: 'ADCB', category: 'Groceries', merchant: 'Skip' }));
  await until(async () => (await status()) === 'ok' && calls.length, 3000);
  assert.deepEqual(calls, ['add']);
  assert.ok(server().some((e) => e.merchant === 'Skip'));
  assert.equal(await store((s) => s.state.outbox.length), 0);
});

await check('with nothing to send, a sync still reads the sheet', async () => {
  calls.length = 0;
  await store((s) => s.sync());
  assert.deepEqual(calls, ['list']);
});

await check('a sync over 3 seconds shows the spinner, and it clears after', async () => {
  delay = 4000;
  const done = store((s) => s.sync());
  await p.waitForTimeout(1500);
  assert.equal(await p.locator('.sync-badge.spin').count(), 0, 'no spinner yet at 1.5s');
  await p.waitForSelector('.sync-badge.spin', { timeout: 3000 });
  await done;
  delay = 0;
  assert.equal(await p.locator('.sync-badge.spin').count(), 0);
  assert.equal(await status(), 'ok');
});

await check('offline: the change waits quietly (no red error) and retries on its own', async () => {
  online = false;
  await store((s) => s.addEntry({ type: 'Spend', amount: 7, account: 'ADCB', category: 'Groceries', merchant: 'Offline' }));
  await p.waitForTimeout(800);
  assert.equal(await status(), 'pending');
  assert.equal(await p.locator('.sync-badge.err').count(), 0, 'no red error badge');
  assert.match(await p.textContent('.sync-badge'), /1 waiting/);
  online = true;
  // no tap, no visibility change: the 15s timer sends it
  const t0 = Date.now();
  await until(async () => (await store((s) => s.state.outbox.length)) === 0, 20000);
  assert.ok(Date.now() - t0 < 17000);
  assert.ok(server().some((e) => e.merchant === 'Offline'));
  assert.equal(await status(), 'ok');
});

await check('coming back to the app retries straight away', async () => {
  online = false;
  await store((s) => s.addEntry({ type: 'Spend', amount: 8, account: 'ADCB', category: 'Groceries', merchant: 'Visible' }));
  await p.waitForTimeout(500);
  assert.equal(await status(), 'pending');
  online = true;
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await until(async () => (await store((s) => s.state.outbox.length)) === 0, 3000);
});

await check('a wrong app key is still a real error', async () => {
  const good = await store((s) => s.state.conn.token);
  await store((s) => { s.state.conn = { ...s.state.conn, token: 'wrong' }; return s.sync(); });
  assert.equal(await status(), 'error');
  await store((s, t) => { s.state.conn = { ...s.state.conn, token: t }; return s.sync(); }, good);
  assert.equal(await status(), 'ok');
});

await check('a 25 second reply is waited for, not a failure (old limit was 20s)', async () => {
  delay = 25000;
  await store((s) => s.sync());
  delay = 0;
  assert.equal(await status(), 'ok');
});

assert.deepEqual(errors, []);
await b.close();
console.log(failed ? `\n${failed} failed` : '\nsync: all checks passed');
process.exit(failed ? 1 : 0);
