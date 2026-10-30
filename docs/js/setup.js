// First-run setup guide: welcome → your cards → your money → (turn on the Apps Script API) →
// make (or connect) your sheet → Apple Pay Shortcut → done. Answers stay in this phone's storage (sp.setup) until a sheet is
// connected, then go up through the normal store functions (applySetup). "Sign in with Google"
// makes the sheet for you (provision.js); without a client ID the guide offers the by-hand path.
import { colorHex, fmt } from './model.js';
import { state, isConnected, isDemo, setDemo, setConnection, ping, installSheet, applySetup, sync } from './store.js';
import { CARD_COLORS } from './theme.js';
import { openSheet, toast, haptic, esc, reduceMotion } from './ui.js';
import { icon } from './icons.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import { provision, SCOPES, SetupError, USER_SETTINGS_URL, allowUrl, editorUrl } from './provision.js';

const KEY = 'sp.setup';
const MANUAL_GUIDE = 'https://github.com/Bu9abi-dev/spendings/blob/main/SETUP.md#1-the-google-sheet-5-min';
const ROLE_NOTES = ['Main · pay lands here', 'Personal allowance'];

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const store = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
let saved = load();
const persist = () => store(saved);

/** Open by itself on a fresh phone: not connected, not in demo, never finished or put off, and opened at
    Home. A link straight to Settings (#settings) or ?notour means you know where you're going. */
export function shouldAutoOpen() {
  const q = new URLSearchParams(location.search);
  if (q.has('notour') || q.has('demo') || globalThis.SPENDINGS_DEMO) return false;
  if (isConnected() || isDemo() || saved.done || saved.dismissed) return false;
  return ['', '#', '#home'].includes(location.hash);
}

/* ───── Answers ───── */

function freshAnswers() {
  const s = state.settings;
  const accounts = state.accounts.filter((a) => !a.archived).map((a) => ({ name: a.name, note: a.note || '', color: a.color, wallet: a.wallet || '' }));
  const salary = state.plan.find((p) => p.id === 'salary' && p.kind === 'Income');
  const names = accounts.map((a) => a.name);
  return {
    accounts,
    pay: names.includes(s.emergencyAccount) ? s.emergencyAccount : names[0] || '',
    allowanceAccount: names.includes(s.allowanceAccount) ? s.allowanceAccount : names[0] || '',
    allowance: s.allowance || 0,
    cycleStart: s.cycleStart || 27,
    salary: salary?.amount || '',
    salaryDay: salary?.day || s.cycleStart || 27,
    touched: false,
  };
}
const answers = () => (saved.answers ||= freshAnswers());

// the starting accounts' notes say what each one is for; they follow the roles you picked. Your own notes stay.
function noteFor(x, a) {
  const role = x.name === a.pay ? ROLE_NOTES[0] : x.name === a.allowanceAccount ? ROLE_NOTES[1] : '';
  if (x.note && !ROLE_NOTES.includes(x.note) && x.note !== 'Extra card') return x.note;
  return role || (ROLE_NOTES.includes(x.note) ? '' : x.note || '');
}

/** What the answers mean for the store: accounts, settings and a payday plan. */
export function setupPlan(a, basePlan = []) {
  const accounts = a.accounts.filter((x) => x.name.trim()).map((x) => ({
    name: x.name.trim(), color: x.color || 'graphite', wallet: x.wallet.trim(), archived: false,
    note: noteFor(x, a),
  }));
  const names = new Set(accounts.map((x) => x.name));
  const pay = names.has(a.pay) ? a.pay : accounts[0].name;
  const allow = names.has(a.allowanceAccount) ? a.allowanceAccount : pay;
  const allowance = Math.max(0, +a.allowance || 0);
  const cycleStart = Math.min(28, Math.max(1, +a.cycleStart || 1));
  // other plan items you already had stay, unless they point at an account you removed
  const keep = basePlan.filter((p) => p.id !== 'salary' && p.id !== 'allowance' && (!p.from || names.has(p.from)) && (!p.to || names.has(p.to)));
  const plan = [];
  if (+a.salary > 0) plan.push({ id: 'salary', name: 'Salary', kind: 'Income', amount: +a.salary, day: Math.min(28, Math.max(1, +a.salaryDay || cycleStart)), from: '', to: pay, category: 'Salary' });
  if (allowance > 0 && allow !== pay) plan.push({ id: 'allowance', name: 'Allowance', kind: 'Move', amount: allowance, day: cycleStart, from: pay, to: allow, category: '' });
  return { accounts, settings: { allowanceAccount: allow, emergencyAccount: pay, cycleStart, allowance }, plan: [...plan, ...keep] };
}

/* ───── Google sign-in (Google Identity Services, token model) ───── */

let gis = null, tokenClient = null, pending = null, accessToken = null, popupMisses = 0;
// a Home Screen app: Google's sign-in window often can't open there, so the guide sends you to Safari
const standalone = () => globalThis.navigator?.standalone === true || !!globalThis.matchMedia?.('(display-mode: standalone)').matches;
const appLink = () => `${location.origin}${location.pathname}`;
function popupError() {
  popupMisses++;
  return new SetupError('popup', standalone()
    ? 'Google’s sign-in window can’t open inside the Home Screen app. Open this page in Safari to sign in, or set your sheet up by hand below.'
    : 'Google’s sign-in window didn’t open. Open this page in Safari to sign in (or allow pop-ups for this site), or set your sheet up by hand below.');
}
function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return (gis ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gis = null; s.remove(); reject(new SetupError('offline', 'Couldn’t load Google sign-in. Check your connection and try again.')); };
    document.head.append(s);
  }));
}
function prepareSignIn() {
  if (!GOOGLE_CLIENT_ID) return Promise.resolve();
  return loadGis().then(() => {
    tokenClient ||= google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES.join(' '),
      callback: (r) => pending?.done(r),
      error_callback: (e) => pending?.fail(e),
    });
  });
}
const tokenValid = () => accessToken && accessToken.until > Date.now() + 60e3;
/** Must run straight from a tap: Safari only lets a tap open Google's sign-in window. */
function signIn() {
  if (tokenValid()) return Promise.resolve(accessToken.token);
  const ask = () => new Promise((resolve, reject) => {
    pending = {
      done(r) {
        if (r.error) return reject(new SetupError('cancelled', 'Sign-in didn’t finish. Tap Sign in with Google to try again.', r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES)) return reject(new SetupError('scopes', 'Spendings needs all three permissions to make your sheet. Sign in again and leave every box ticked.'));
        accessToken = { token: r.access_token, until: Date.now() + (+r.expires_in || 3600) * 1000 };
        resolve(r.access_token);
      },
      fail(e) {
        if (e?.type === 'popup_failed_to_open') return reject(popupError());
        // closed straight away in a Home Screen app, or closed twice: the window isn't working here
        if (e?.type === 'popup_closed') {
          if (standalone() || popupMisses > 0) return reject(popupError());
          popupMisses++;
          return reject(new SetupError('cancelled', 'Sign-in was closed before it finished. Tap Sign in with Google to try again.'));
        }
        reject(new SetupError('google', 'Google sign-in didn’t work. Try again in a moment.', e?.type || ''));
      },
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
  // normally ready already (it loads when this step opens), so the window opens within the tap
  return tokenClient ? ask() : prepareSignIn().then(ask);
}

/* ───── The guide ───── */

// three plain steps on the sheet page
const TASKS = [
  ['signin', 'Sign in'],
  ['sheet', 'Make your sheet'],
  ['allow', 'Allow it'],
];

export function openSetup({ start = '', onShortcut = () => {}, onFinish = () => {} } = {}) {
  saved = load();
  const connectedAtStart = isConnected();
  // with Sign in with Google, turning on the Apps Script API gets its own step first (every new account needs it)
  const steps = connectedAtStart ? ['welcome', 'sheet', 'shortcut', 'done']
    : ['welcome', 'accounts', 'money', ...(GOOGLE_CLIENT_ID ? ['api'] : []), 'sheet', 'shortcut', 'done'];
  let step = steps.includes(start) ? start : steps.includes(saved.step) && !saved.done ? saved.step : 'welcome';
  // the sheet step's own state
  let phase = saved.progress?.url && !isConnected() ? 'allow' : 'idle';
  let error = null, pollTimer = null, polling = false, manualOpen = !GOOGLE_CLIENT_ID;
  let sheetEl = null, closeFn = null;

  const go = (next, dir = 1) => {
    step = next;
    saved.step = next;
    persist();
    draw(dir);
    if (next === 'sheet') { prepareSignIn().catch(() => {}); if (phase === 'allow') startPolling(); }
    else stopPolling();
  };
  const idx = () => steps.indexOf(step);
  const next = () => go(steps[idx() + 1] || 'done', 1);
  const back = () => go(steps[Math.max(0, idx() - 1)], -1);

  /* ── step bodies ── */
  const welcome = () => `
    <div class="su-hero">${icon('wallet', { size: 34 })}</div>
    <h2 class="su-h">Welcome to Spendings</h2>
    <p class="su-p">A calm place for your money, set up in a few minutes.</p>
    <ul class="su-list">
      <li>${icon('bell', { size: 20 })}<span><b>Logs itself.</b> Apple Pay payments arrive with a tap, or none at all.</span></li>
      <li>${icon('chart', { size: 20 })}<span><b>Knows what’s safe to spend</b> until your next payday.</span></li>
      <li>${icon('sheet', { size: 20 })}<span><b>Yours.</b> Everything lives in your own Google Sheet.</span></li>
    </ul>
    <p class="su-small center su-needs">You’ll need a Google account. Setup takes about 5 minutes.</p>`;

  const swatches = (a, i) => `<div class="swatches su-swatches" role="radiogroup" aria-label="Colour for ${esc(a.name || 'this account')}" ${saved.openColour === i ? '' : 'hidden'}>
      ${CARD_COLORS.map((c) => `<button type="button" role="radio" class="swatch" aria-checked="${c.id === a.color}" aria-label="${esc(c.name)}" data-su-colour="${i}:${c.id}" style="--sw:${c.hex}">${icon('check', { size: 14 })}</button>`).join('')}
    </div>`;
  const roleChips = () => {
    const a = answers(), list = a.accounts.filter((x) => x.name.trim());
    const chips = (field) => list.map((x) => `<button type="button" class="chip${a[field] === x.name ? ' on' : ''}" data-su-role="${field}" data-name="${esc(x.name)}" aria-pressed="${a[field] === x.name}" style="--chip:${colorHex(x.color)}"><i class="acc-dot"></i>${esc(x.name)}</button>`).join('');
    return `<h3 class="su-q">Your pay lands in</h3><div class="chips accounts">${chips('pay')}</div>
      <h3 class="su-q">Your allowance card</h3><div class="chips accounts">${chips('allowanceAccount')}</div>
      <p class="group-foot su-foot-note">The allowance card is the one you spend your own money from. They can be the same account.</p>`;
  };
  const accountsStep = () => {
    const a = answers();
    return `<h2 class="su-h">Your cards and accounts</h2>
    <p class="su-p">Name each one like your bank does. The Wallet name is part of the card’s name in Apple Wallet, so Apple Pay payments land on the right card.</p>
    <section class="group su-accts">
      ${a.accounts.map((x, i) => `<div class="su-acct" data-i="${i}">
        <div class="su-acct-top">
          <button type="button" class="su-dot" data-su-colours="${i}" style="--c:${colorHex(x.color)}" aria-label="Colour for ${esc(x.name || 'this account')}" aria-expanded="${saved.openColour === i}"></button>
          <input class="su-name" data-su-field="name" data-i="${i}" type="text" maxlength="24" autocomplete="off" autocapitalize="words" value="${esc(x.name)}" placeholder="Name, e.g. ADCB" aria-label="Account name">
          <button type="button" class="icon-btn su-del" data-su-del="${i}" aria-label="Remove ${esc(x.name || 'this account')}" ${a.accounts.length <= 1 ? 'disabled' : ''}>${icon('x', { size: 18 })}</button>
        </div>
        <label class="su-wallet"><span>Wallet name has</span><input data-su-field="wallet" data-i="${i}" type="text" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(x.wallet)}" placeholder="${x.name.toLowerCase() === 'cash' ? 'not a card' : 'e.g. adcb'}"></label>
        ${swatches(x, i)}
      </div>`).join('')}
    </section>
    <button type="button" class="dup-btn su-add" data-su-add="1">${icon('plus', { size: 18 })}Add an account</button>
    <div class="su-roles">${roleChips()}</div>`;
  };

  const days = (sel) => Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === +sel ? 'selected' : ''}>${ordinal(d)}</option>`).join('');
  const moneyStep = () => {
    const a = answers();
    return `<h2 class="su-h">Your money</h2>
    <p class="su-p">Rough numbers are fine. You can change all of this later in Settings.</p>
    <section class="group form">
      <label class="row input-row"><span>Allowance per cycle</span><span class="suffix-input"><em>AED</em><input name="su-allowance" type="number" inputmode="decimal" min="0" step="any" value="${esc(a.allowance || '')}" placeholder="0"></span></label>
      <label class="row input-row"><span>Cycle starts on the</span><select name="su-cycle">${days(a.cycleStart)}</select></label>
    </section>
    <p class="group-foot">Your allowance is what you plan to spend on yourself each pay cycle, from ${esc(a.allowanceAccount || 'your allowance card')}. Safe to spend counts down from it.</p>
    <h3 class="su-q">Salary <span>optional</span></h3>
    <section class="group form">
      <label class="row input-row"><span>Salary</span><span class="suffix-input"><em>AED</em><input name="su-salary" type="number" inputmode="decimal" min="0" step="any" value="${esc(a.salary || '')}" placeholder="0"></span></label>
      <label class="row input-row"><span>Lands on the</span><select name="su-salday">${days(a.salaryDay)}</select></label>
    </section>
    <p class="group-foot">On payday the app asks you to tap “It landed”, so your total never runs ahead of the bank.</p>`;
  };

  const apiStep = () => `<div class="su-hero">${icon('gear', { size: 34 })}</div>
    <h2 class="su-h">Turn on the Apps Script API</h2>
    <p class="su-p">Google needs one switch on in your account before Spendings can make your sheet. You only do this once.</p>
    <ol class="su-steps">
      <li>Tap <b>Open Apps Script settings</b>. It opens in a new tab; sign in with your Google account if asked.</li>
      <li>Tap <b>Google Apps Script API</b> and turn it <b>On</b>.</li>
      <li>Come back to this app (close the tab, or switch back to Spendings). You’ll be on this same step: tap <b>It’s on</b>.</li>
    </ol>
    <a class="btn-tinted su-wide su-api" href="${USER_SETTINGS_URL}" target="_blank" rel="noopener">${icon('gear', { size: 18 })}Open Apps Script settings</a>
    <p class="group-foot su-foot-note">Already on? Tap It’s on. If it’s still off later, the app says so and links here again.</p>`;

  const p = () => saved.progress || {};
  const taskState = (id) => {
    const pr = p();
    const i = TASKS.findIndex((t) => t[0] === id);
    const doneN = isConnected() ? 3 : phase === 'allow' || phase === 'installing' || pr.url ? 2 : phase === 'working' || tokenValid() ? 1 : 0;
    const nowN = phase === 'signing' ? 0 : phase === 'working' ? 1 : phase === 'allow' || phase === 'installing' ? 2 : -1;
    return i === nowN ? 'now' : i < doneN ? 'done' : '';
  };
  const tasks = () => `<ol class="su-tasks" aria-label="Progress">${TASKS.map(([id, label], i) => {
    const st = taskState(id);
    return `<li class="${st}">${st === 'done' ? icon('check', { size: 16 }) : st === 'now' ? '<span class="su-spin" aria-hidden="true"></span>' : '<i aria-hidden="true"></i>'}<span>${i + 1}. ${label}</span>${st === 'now' ? '<em class="sr">in progress</em>' : st === 'done' ? '<em class="sr">done</em>' : ''}</li>`;
  }).join('')}</ol>`;

  const errorCard = () => {
    if (!error) return '';
    const e = error;
    const acts = [];
    if (e.code === 'script-api-off') acts.push(`<a class="btn-plain" href="${USER_SETTINGS_URL}" target="_blank" rel="noopener">Open Apps Script settings</a>`);
    if (e.code === 'popup') {
      // never an endless "tap again": Safari, or the by-hand path just below
      acts.push(`<a class="btn-primary" href="${esc(appLink())}" target="_blank" rel="noopener" data-su-safari="1">Open in Safari</a>`);
      acts.push(`<button type="button" class="btn-plain" data-copy="${esc(appLink())}">${icon('copy', { size: 16 })}Copy this page’s address</button>`);
      if (!standalone() && popupMisses < 2) acts.push(`<button type="button" class="btn-plain" data-su="signin">Try again</button>`);
    } else if (['auth', 'cancelled', 'scopes'].includes(e.code)) acts.push(`<button type="button" class="btn-primary" data-su="signin">Sign in with Google</button>`);
    else if (e.code !== 'api-disabled' && e.code !== 'manual') acts.push(`<button type="button" class="btn-primary" data-su="retry">Try again</button>`);
    return `<div class="tip-card su-error" role="alert">${icon('warn', { size: 18 })}<div><p>${esc(e.message)}</p>${acts.length ? `<div class="su-actions">${acts.join('')}</div>` : ''}</div></div>`;
  };

  const manual = () => `<details class="su-manual" ${manualOpen ? 'open' : ''}>
      <summary>${GOOGLE_CLIENT_ID ? 'Set it up by hand instead' : 'Set up your sheet by hand'}${icon('chevD', { size: 16, cls: 'chev' })}</summary>
      <p class="su-p">Make a Google Sheet, paste in the script, run <b>setup</b> and publish it as a web app. About 5 minutes. <a href="${MANUAL_GUIDE}" target="_blank" rel="noopener">Open the step-by-step guide</a>. Then paste what it gives you here:</p>
      <section class="group form">
        <label class="row input-row"><span>Web app URL</span><input name="su-url" type="url" inputmode="url" placeholder="https://script.google.com/…/exec" value="${esc(saved.manualUrl || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label class="row input-row"><span>App key</span><input name="su-token" type="text" placeholder="From your sheet" value="" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      </section>
      <button type="button" class="btn-tinted su-connect" data-su="connect">${icon('link', { size: 18 })}Connect</button>
    </details>`;

  const sheetStep = () => {
    if (isConnected()) {
      return `<div class="su-hero good">${icon('check', { size: 34 })}</div>
      <h2 class="su-h">Your sheet is connected</h2>
      <p class="su-p">${state.sheetUrl ? `<a href="${esc(state.sheetUrl)}" target="_blank" rel="noopener">Open your sheet</a>. ` : ''}Everything you log is saved there.</p>`;
    }
    const pr = p();
    const busy = phase === 'working' || phase === 'signing' || phase === 'installing';
    const head = `<h2 class="su-h">Create your sheet</h2>`;
    if (!GOOGLE_CLIENT_ID) {
      return `${head}<p class="su-p">Spendings keeps everything in a Google Sheet in your own account.</p>
        <div class="tip-card">${icon('sparkle', { size: 18 })}<p><b>Sign in with Google isn’t switched on for this app yet.</b> When it is, the app makes the sheet for you. For now, set it up by hand. It takes about 5 minutes.</p></div>
        ${manual()}`;
    }
    if (phase === 'allow' || phase === 'installing') {
      return `${head}${tasks()}
        <div class="su-allow">
          <p class="su-p"><b>One last thing.</b> Google asks you to allow Spendings to use this sheet. Tap <b>Allow Spendings</b>; it opens in a new tab. Then:</p>
          <ol class="su-steps">
            <li>Tap <b>Review permissions</b> and choose your Google account.</li>
            <li>Google says “Google hasn’t verified this app”. Tap <b>Advanced</b>, then <b>Go to Spendings (unsafe)</b>.</li>
            <li>Tap <b>Allow</b>.</li>
            <li>Come back to this app (close the tab, or switch back to Spendings). You’ll land on this same step and it carries on by itself.</li>
          </ol>
          <p class="su-small">Google says “unsafe” only because the script is yours and Google hasn’t reviewed it. It can only use the sheet it lives in.</p>
          <a class="btn-primary su-wide" href="${esc(allowUrl(pr))}" target="_blank" rel="noopener" data-su-allow="1">Allow Spendings</a>
          <p class="su-small center" aria-live="polite">${phase === 'installing' ? 'Allowed ✓ Setting up the tabs…' : 'Waiting for you to allow it. Come back here afterwards; the app carries on by itself.'}</p>
          <button type="button" class="text-btn su-check" data-su="check">Check again</button>
          <p class="su-small">Google didn’t ask? <a href="${esc(editorUrl(pr))}" target="_blank" rel="noopener">Open the script</a>, choose <b>setup</b> at the top, tap <b>Run</b> and allow it there.</p>
        </div>
        ${errorCard()}
        <p class="su-small su-storage">On iPhone, Safari and the Home Screen app keep separate storage. Finish here, where you started; at the end you get your Web app URL and app key with copy buttons to paste into the other one.</p>
        <p class="su-small"><button type="button" class="text-btn su-small" data-su="startover">Start again with a new sheet</button></p>`;
    }
    return `${head}<p class="su-p">Sign in and Spendings makes a sheet called <b>Spendings</b> in your Google Drive, with its script, ready to use. Your sign-in is only used for this and isn’t kept.</p>
      ${tasks()}
      ${errorCard()}
      ${error ? '' : `<button type="button" class="btn-primary su-wide su-google" data-su="signin" ${busy ? 'disabled' : ''}>${busy ? '<span class="su-spin" aria-hidden="true"></span>Working…' : `${googleG()}Sign in with Google`}</button>`}
      ${error ? '' : '<p class="su-small">Google may say it hasn’t verified this app: tap <b>Continue</b>. Best done in Safari, not the Home Screen app.</p>'}
      ${pr.spreadsheetId && !busy ? '<p class="su-small"><button type="button" class="text-btn su-small" data-su="startover">Start again with a new sheet</button></p>' : ''}
      ${manual()}`;
  };

  const shortcutStep = () => `<div class="su-hero">${icon('bell', { size: 34 })}</div>
    <h2 class="su-h">Log Apple Pay by itself</h2>
    <p class="su-p">A Shortcut automation saves each Apple Pay payment to your sheet as you pay. It takes about 5 minutes in the Shortcuts app.</p>
    ${isConnected() ? `<div class="su-copy">${copyRow('Web app URL', state.conn.url)}${copyRow('App key', state.conn.token)}</div>` : ''}
    <button type="button" class="btn-tinted su-wide" data-su="shortcut">${icon('bell', { size: 18 })}Show me how</button>
    <p class="group-foot su-foot-note">You can do this later from Settings → Log Apple Pay payments.</p>`;

  const doneStep = () => {
    const a = answers();
    const n = a.accounts.filter((x) => x.name.trim()).length;
    return `<div class="su-hero good">${icon('check', { size: 34 })}</div>
    <h2 class="su-h">You’re all set</h2>
    <p class="su-p">${isConnected() ? 'Your sheet is connected and everything you log is saved there.' : 'Your answers are kept on this phone. Connect a sheet any time from Settings → Set up step by step, and they go with it.'}</p>
    ${!connectedAtStart ? `<ul class="su-list small">
      <li>${icon('card', { size: 20 })}<span>${n} ${n === 1 ? 'account' : 'accounts'}${a.pay ? `, pay lands in ${esc(a.pay)}` : ''}</span></li>
      <li>${icon('wallet', { size: 20 })}<span>${+a.allowance > 0 ? `Allowance AED ${fmt(+a.allowance, { whole: true })} from ${esc(a.allowanceAccount)}` : 'No allowance set yet'}</span></li>
      <li>${icon('calendar', { size: 20 })}<span>Cycle starts on the ${ordinal(+a.cycleStart || 1)}</span></li>
    </ul>` : ''}
    ${isConnected() ? `<div class="su-copy">${copyRow('Web app URL', state.conn.url)}${copyRow('App key', state.conn.token)}</div>
      <p class="group-foot su-foot-note">Keep these for your Shortcut. If you set this up in Safari, paste them into the Home Screen app’s Settings too.</p>` : ''}`;
  };

  const BODY = { welcome, accounts: accountsStep, money: moneyStep, api: apiStep, sheet: sheetStep, shortcut: shortcutStep, done: doneStep };
  const footer = () => {
    if (step === 'welcome') {
      return `<button type="button" class="btn-primary su-wide" data-su="next">Get started</button>
        ${isConnected() ? '' : `<button type="button" class="btn-plain su-wide" data-su="demo">${icon('sparkle', { size: 18 })}Try with demo data</button>
        <button type="button" class="text-btn su-have" data-su="have">I already have a sheet</button>`}`;
    }
    if (step === 'sheet') {
      return isConnected() ? '<button type="button" class="btn-primary su-wide" data-su="next">Continue</button>'
        : '<button type="button" class="text-btn su-have" data-su="next">Skip for now</button>';
    }
    if (step === 'done') return '<button type="button" class="btn-primary su-wide" data-su="finish">Start using Spendings</button>';
    if (step === 'api') return '<button type="button" class="btn-primary su-wide" data-su="next">It’s on</button><button type="button" class="text-btn su-have" data-su="have">Set up my sheet by hand instead</button>';
    if (step === 'shortcut') return '<button type="button" class="btn-primary su-wide" data-su="next">Continue</button><button type="button" class="text-btn su-have" data-su="next">Later</button>';
    return '<button type="button" class="btn-primary su-wide" data-su="next">Continue</button>';
  };
  const dots = () => `<span class="su-dots" aria-label="Step ${idx() + 1} of ${steps.length}">${steps.map((s, i) => `<i class="${i === idx() ? 'on' : i < idx() ? 'past' : ''}"></i>`).join('')}</span>`;
  const head = () => `<header class="sheet-head su-head">
      ${step === 'welcome' || step === 'done' ? '<button type="button" class="text-btn" data-su="close">Not now</button>' : `<button type="button" class="text-btn su-back" data-su="back">${icon('chevL', { size: 18 })}Back</button>`}
      ${dots()}<span class="su-head-spacer"></span></header>`;

  function draw(dir = 0) {
    if (!sheetEl) return;
    sheetEl.querySelector('.su-headwrap').innerHTML = head();
    const body = sheetEl.querySelector('.su-body');
    body.innerHTML = BODY[step]();
    body.dataset.step = step;
    sheetEl.querySelector('.su-footer').innerHTML = footer();
    sheetEl.querySelector('.sheet-scroll').scrollTop = 0;
    if (dir && !reduceMotion()) body.animate([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }
  const redrawBody = () => { if (!sheetEl) return; sheetEl.querySelector('.su-body').innerHTML = BODY[step](); sheetEl.querySelector('.su-footer').innerHTML = footer(); };

  /* ── validation before leaving a step ── */
  function canLeave() {
    if (step === 'accounts') {
      const a = answers();
      const names = a.accounts.map((x) => x.name.trim()).filter(Boolean);
      if (!names.length) return warn('Add at least one account');
      if (a.accounts.some((x) => !x.name.trim())) return warn('Give every account a name, or remove the empty one');
      if (names.some((n) => n.toLowerCase() === 'all')) return warn('“All” is taken by the total. Pick another name.');
      const lower = names.map((n) => n.toLowerCase());
      if (new Set(lower).size !== lower.length) return warn('Two accounts have the same name');
      if (!names.includes(a.pay)) a.pay = names[0];
      if (!names.includes(a.allowanceAccount)) a.allowanceAccount = a.pay;
    }
    if (step === 'money') {
      const a = answers();
      if (!(+a.allowance >= 0)) return warn('The allowance should be a number');
    }
    return true;
  }
  const warn = (t) => { toast(esc(t), { tone: 'warn', icon: icon('warn', { size: 18 }) }); return false; };

  /* ── making the sheet ── */
  async function runProvision(token) {
    phase = 'working'; error = null; redrawBody();
    try {
      const res = await fetch('setup/Code.gs.txt', { cache: 'no-cache' });
      if (!res.ok) throw new SetupError('offline', 'Couldn’t load the script for your sheet. Check your connection and tap Try again.');
      const code = await res.text();
      const done = await provision({
        token, code, progress: p(),
        save: (pr) => { saved.progress = pr; persist(); },
      });
      saved.progress = done; persist();
      phase = 'allow';
      redrawBody();
      startPolling();
    } catch (e) {
      phase = 'idle';
      error = e instanceof SetupError ? e : new SetupError('google', `Something went wrong: ${e.message}`);
      if (error.code === 'auth') accessToken = null;
      if (error.code === 'api-disabled') manualOpen = true;
      redrawBody();
    }
  }
  async function signInAndRun() {
    error = null;
    let token;
    try {
      const t = signIn(); // first thing in the tap, so Google's window may open
      phase = 'signing'; redrawBody();
      token = await t;
    } catch (e) {
      phase = 'idle';
      error = e instanceof SetupError ? e : new SetupError('google', 'Google sign-in didn’t work. Try again in a moment.');
      if (error.code === 'popup') manualOpen = true; // the by-hand path, right under the message
      redrawBody();
      return;
    }
    await runProvision(token);
  }

  function startPolling() {
    stopPolling();
    if (!sheetEl || step !== 'sheet' || isConnected()) return;
    const tick = async () => {
      if (!sheetEl || step !== 'sheet' || phase !== 'allow') return;
      if (!document.hidden) await checkAllowed();
      if (phase === 'allow') pollTimer = setTimeout(tick, 4000);
    };
    pollTimer = setTimeout(tick, 2500);
  }
  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
  async function checkAllowed() {
    if (polling) return;
    const pr = p();
    if (!pr.url || !pr.key) return;
    polling = true;
    try {
      await ping(pr.url, pr.key);
    } catch { polling = false; return; } // not allowed yet: Google answers with a sign-in page, not the script
    polling = false;
    if (phase !== 'allow') return;
    phase = 'installing'; error = null; redrawBody();
    try {
      const inst = await installSheet(pr.url, pr.key);
      await finishConnect(pr.url, pr.key, { fresh: inst?.fresh === true });
    } catch (e) {
      phase = 'allow';
      error = new SetupError('busy', `Your sheet answered but couldn’t finish setting up: ${e.message}`);
      redrawBody();
    }
  }
  const onVisible = () => { if (!document.hidden && phase === 'allow' && step === 'sheet') checkAllowed(); };

  /** Connected: save the connection, send your answers to a new sheet, and move on.
      `fresh` comes from the sheet itself (`install`): only a sheet nobody has used yet takes your answers.
      Any other sheet (entries, or its own accounts, settings or plan) keeps exactly what it has. */
  async function finishConnect(url, token, { fresh = false } = {}) {
    setConnection(url, token);
    if (isDemo()) setDemo(false);
    await sync();
    const a = answers();
    let kept = false;
    if (!connectedAtStart && a.touched) {
      if (fresh) { applySetup(setupPlan(a)); await sync(); } else kept = true;
    }
    saved.progress = null; saved.answers = null; saved.done = true;
    persist();
    phase = 'idle';
    toast(state.sync.status === 'error' ? esc(state.sync.error) : kept ? 'Connected. Your sheet already had its own accounts and settings, so it kept them.' : 'Connected to your sheet', { icon: icon(state.sync.status === 'error' ? 'warn' : 'check', { size: 18 }), tone: state.sync.status === 'error' ? 'warn' : 'good' });
    if (step === 'sheet') go('shortcut');
  }

  async function connectManual(btn) {
    const url = sheetEl.querySelector('input[name="su-url"]').value.trim();
    const token = sheetEl.querySelector('input[name="su-token"]').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return warn('That doesn’t look like a Web app URL. It starts with https://script.google.com/');
    if (!token) return warn('Paste your app key too');
    saved.manualUrl = url; persist();
    btn.disabled = true; btn.classList.add('busy');
    try {
      await ping(url, token);
      // a by-hand sheet already ran setup; install leaves it as it is and says whether it's still unused
      const inst = await installSheet(url, token).catch(() => null);
      await finishConnect(url, token, { fresh: inst?.fresh === true });
    } catch (e) {
      warn(e.message);
    } finally { btn.disabled = false; btn.classList.remove('busy'); }
  }

  function close() { closeFn?.(); }

  openSheet({
    label: 'Set up Spendings',
    html: `<div class="su-headwrap"></div><div class="sheet-scroll su-scroll"><div class="su-body"></div></div><div class="su-footer"></div>`,
    onClose() {
      sheetEl = null;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisible);
      if (!saved.done) { saved.dismissed = true; persist(); }
      onFinish();
    },
    onMount(sheet, closeSheet) {
      sheetEl = sheet;
      sheet.classList.add('setup-sheet');
      closeFn = closeSheet;
      document.addEventListener('visibilitychange', onVisible);
      draw();
      if (step === 'sheet') { prepareSignIn().catch(() => {}); if (phase === 'allow') startPolling(); }

      sheet.addEventListener('input', (ev) => {
        const el = ev.target, a = answers();
        a.touched = true;
        const f = el.dataset.suField;
        if (f) {
          const acc = a.accounts[+el.dataset.i];
          if (!acc) return;
          if (f === 'name') {
            const old = acc.name;
            acc.name = el.value;
            if (a.pay === old) a.pay = el.value;
            if (a.allowanceAccount === old) a.allowanceAccount = el.value;
            sheet.querySelector('.su-roles').innerHTML = roleChips();
          } else acc.wallet = el.value;
        }
        if (el.name === 'su-allowance') a.allowance = el.value === '' ? 0 : +el.value;
        if (el.name === 'su-salary') a.salary = el.value === '' ? '' : +el.value;
        persist();
      });
      sheet.addEventListener('change', (ev) => {
        const el = ev.target, a = answers();
        if (el.name === 'su-cycle') { a.cycleStart = +el.value; a.touched = true; persist(); }
        if (el.name === 'su-salday') { a.salaryDay = +el.value; a.touched = true; persist(); }
      });
      sheet.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.target.matches('input[name="su-token"]')) { ev.preventDefault(); sheet.querySelector('[data-su="connect"]')?.click(); }
      });
      sheet.addEventListener('click', async (ev) => {
        const t = ev.target;
        const a = answers();
        const col = t.closest('[data-su-colours]');
        if (col) {
          const i = +col.dataset.suColours;
          saved.openColour = saved.openColour === i ? null : i;
          sheet.querySelectorAll('.su-acct').forEach((el) => {
            const on = +el.dataset.i === saved.openColour;
            el.querySelector('.su-swatches').hidden = !on;
            el.querySelector('[data-su-colours]').setAttribute('aria-expanded', String(on));
          });
          haptic(); return;
        }
        const sw = t.closest('[data-su-colour]');
        if (sw) {
          const [i, c] = sw.dataset.suColour.split(':');
          const acc = a.accounts[+i];
          if (!acc) return;
          acc.color = c; a.touched = true; persist();
          const box = sheet.querySelector(`.su-acct[data-i="${+i}"]`);
          box.querySelectorAll('[data-su-colour]').forEach((b) => b.setAttribute('aria-checked', String(b === sw)));
          box.querySelector('.su-dot').style.setProperty('--c', colorHex(c));
          sheet.querySelector('.su-roles').innerHTML = roleChips();
          haptic(); return;
        }
        const del = t.closest('[data-su-del]');
        if (del) {
          if (a.accounts.length <= 1) return;
          a.accounts.splice(+del.dataset.suDel, 1);
          a.touched = true; saved.openColour = null; persist();
          haptic(); redrawBody(); return;
        }
        if (t.closest('[data-su-add]')) {
          const used = new Set(a.accounts.map((x) => x.color));
          a.accounts.push({ name: '', note: '', wallet: '', color: CARD_COLORS.find((c) => !used.has(c.id))?.id || 'blue' });
          a.touched = true; persist();
          haptic(); redrawBody();
          const inputs = sheet.querySelectorAll('.su-name');
          inputs[inputs.length - 1]?.focus();
          return;
        }
        const role = t.closest('[data-su-role]');
        if (role) {
          a[role.dataset.suRole] = role.dataset.name; a.touched = true; persist();
          sheet.querySelector('.su-roles').innerHTML = roleChips();
          haptic(); return;
        }
        const cp = t.closest('[data-copy]');
        if (cp) {
          try { await navigator.clipboard.writeText(cp.dataset.copy); haptic(); toast('Copied', { icon: icon('check', { size: 18 }), tone: 'good' }); } catch { toast('Couldn’t copy. Press and hold the text instead.'); }
          return;
        }
        if (t.closest('[data-su-allow]')) { setTimeout(startPolling, 0); return; } // the link opens Google in a new tab
        if (t.closest('.su-api, [data-su-safari]')) return; // plain links to a new tab
        const act = t.closest('[data-su]')?.dataset.su;
        if (!act) return;
        if (act === 'signin') { haptic(); return signInAndRun(); }
        if (act === 'retry') {
          haptic();
          if (tokenValid()) return runProvision(accessToken.token);
          return signInAndRun();
        }
        if (act === 'check') { haptic(); return checkAllowed(); }
        if (act === 'startover') {
          if (!confirm('Start again with a new sheet? The sheet made so far stays in your Google Drive; you can delete it there.')) return;
          saved.progress = null; persist(); phase = 'idle'; error = null; stopPolling(); redrawBody(); return;
        }
        if (act === 'connect') return connectManual(t.closest('[data-su]'));
        if (act === 'shortcut') { haptic(); return onShortcut(); }
        if (act === 'demo') {
          haptic();
          setDemo(true);
          saved.step = 'welcome'; persist();
          close();
          toast('Showing demo data', { icon: icon('sparkle', { size: 18 }) });
          return;
        }
        if (act === 'have') { haptic(); manualOpen = true; return go('sheet', 1); }
        if (act === 'close') { haptic(); return close(); }
        if (act === 'back') { haptic(); return back(); }
        if (act === 'next') { if (!canLeave()) return; haptic(); return next(); }
        if (act === 'finish') {
          haptic();
          saved.done = true; saved.step = ''; persist();
          close();
        }
      });
    },
  });
}

const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const copyRow = (label, value) => `<div class="copy-row"><div><span>${label}</span><code>${esc(value)}</code></div><button type="button" class="icon-btn" data-copy="${esc(value)}" aria-label="Copy ${label}">${icon('copy', { size: 18 })}</button></div>`;
// Google's "G", as Google's sign-in button guidelines ask
const googleG = () => '<svg class="su-g" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-10l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>';

