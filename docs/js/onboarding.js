// First-time setup: a short tutorial (accounts, which card is the allowance, pay and payday, starting
// balances) that ends with "Sign in with Google". That makes a new Spendings sheet and its script in
// the person's own Google account (see google.js) and connects this phone to it.
// It only opens by itself on a phone that has never been connected and has no data. Anyone else
// (Abdullah included) only sees it from Settings → Set up a new sheet with Google.
import { state, isConnected, isDemo, setConnection, setDemo, setPrefs, sync } from './store.js';
import { CARD_COLORS } from './theme.js';
import { esc, haptic, toast } from './ui.js';
import { icon } from './icons.js';
import { googleReady, signIn, takeToken, token, createBackend, scriptEditorUrl } from './google.js';

const K = 'sp.onboard'; // the tutorial's answers and progress, kept on this phone until it finishes
const read = () => { try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch { return null; } };
const write = (v) => { try { if (v) localStorage.setItem(K, JSON.stringify(v)); else localStorage.removeItem(K); } catch { /* blocked */ } };

// Banks and wallets people in the UAE use most, as one-tap suggestions. Colours are only a starting point.
const SUGGESTED = [
  ['ADIB', 'teal'], ['ADCB', 'red'], ['FAB', 'blue'], ['Emirates NBD', 'indigo'], ['Mashreq', 'orange'],
  ['DIB', 'green'], ['Wio', 'purple'], ['Liv', 'pink'], ['BOTIM', 'purple'], ['Cash', 'green'],
];
const STEPS = ['welcome', 'accounts', 'roles', 'money', 'balances', 'create'];
const blank = () => ({ step: 'welcome', accounts: [], main: '', allowanceAcc: '', allowance: '', salary: '', payday: 27, balances: {}, job: null, phase: '' });

let d = null; // the answers so far
let host = null; // the full-screen layer
let checking = null; // timer that keeps asking the new sheet whether access was allowed

/** Should the tutorial open by itself? Only on a fresh phone. */
export function shouldOnboard() {
  if (/(^#|&)(access_token|error)=/.test(location.hash)) return true; // just back from Google's sign-in
  if (read()?.phase) return true; // in the middle of making the sheet
  if (/^#(activity|insights|settings)\b/.test(location.hash)) return false; // a link straight to a tab goes there
  return !isConnected() && !isDemo() && !state.entries.length && !state.prefs.onboardSkipped;
}

/** Open the tutorial. Call at startup (after the first render) or from Settings. */
export function openOnboarding({ fresh = false } = {}) {
  d = (!fresh && read()) || blank();
  const back = takeToken(); // null unless Google just sent the person back here
  if (back?.error) { d.phase = 'error'; d.error = back.error; d.errorCode = ''; }
  else if (back?.ok) d.phase = 'making';
  if (!host) {
    host = document.createElement('div');
    host.className = 'onb';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Set up Spendings');
    document.body.append(host);
    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.addEventListener('change', onInput);
    document.documentElement.classList.add('onb-open');
  }
  else if (d.phase === 'saving') d.phase = 'allow'; // the app was closed mid-save: check again, then save again
  draw();
  if (d.phase === 'making') make();
  else if (d.phase === 'allow') startChecking();
}

function close() {
  clearInterval(checking); checking = null;
  document.removeEventListener('visibilitychange', checkNow);
  host?.remove(); host = null;
  document.documentElement.classList.remove('onb-open');
  window.dispatchEvent(new Event('onboarding-closed'));
}

const save = () => write(d);
const active = () => d.accounts.filter((a) => a.name.trim());
const num = (v) => { const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };

/* ───── Screens ───── */

function draw() {
  const i = STEPS.indexOf(d.step);
  const body = d.phase ? progressScreen() : SCREENS[d.step]();
  host.innerHTML = `<div class="onb-inner">
    ${!d.phase && i > 0 ? `<header class="onb-head"><button type="button" class="icon-btn" data-onb="back" aria-label="Back">${icon('chevL', { size: 22 })}</button>
      <div class="onb-dots" aria-label="Step ${i} of ${STEPS.length - 1}">${STEPS.slice(1).map((_, j) => `<span class="${j < i ? 'on' : ''}"></span>`).join('')}</div><span class="icon-btn-spacer"></span></header>` : ''}
    ${body}</div>`;
  host.scrollTop = 0;
  host.querySelector('.onb-inner')?.focus?.();
}

const SCREENS = {
  welcome: () => `<div class="onb-hero">
      <img src="icons/icon-180.png" alt="" width="84" height="84">
      <h1>Spendings</h1>
      <p>Know what’s safe to spend, see where your money went, and log Apple Pay payments by themselves.</p>
      <p class="muted">Two minutes to set up. Everything is saved in a Google Sheet in your own Google account.</p>
    </div>
    ${isConnected() ? `<div class="tip-card">${icon('warn', { size: 18 })}<p>This phone is connected to a sheet already. Finishing makes a <b>new, empty</b> sheet and switches this phone to it. Your current sheet isn’t changed.</p></div>` : ''}
    <div class="onb-actions">
      <button type="button" class="btn-primary" data-onb="next">Set up</button>
      <button type="button" class="btn-plain" data-onb="have">I already have a sheet</button>
      ${isConnected() ? '<button type="button" class="text-btn" data-onb="close">Cancel</button>' : '<button type="button" class="text-btn" data-onb="demo">Look around with demo data</button>'}
    </div>`,

  accounts: () => {
    const taken = new Set(d.accounts.map((a) => a.name.trim().toLowerCase()));
    return `<h1 class="onb-title">Your cards and accounts</h1>
    <p class="onb-lede">Add each bank account, card or wallet you spend from. Cash counts too.</p>
    <div class="chips onb-suggest">${SUGGESTED.filter(([n]) => !taken.has(n.toLowerCase())).map(([n, c]) => `<button type="button" class="chip" data-add="${esc(n)}" data-color="${c}">${icon('plus', { size: 14 })}${esc(n)}</button>`).join('')}</div>
    <section class="group form onb-accounts">
      ${d.accounts.map((a, j) => `<div class="row onb-acc">
        <span class="onb-swatch" style="background:${CARD_COLORS.find((c) => c.id === a.color)?.hex || '#6b7078'}" data-color-of="${j}" role="button" tabindex="0" aria-label="Change colour"></span>
        <div class="onb-acc-fields">
          <input name="acc-name" data-i="${j}" value="${esc(a.name)}" maxlength="24" placeholder="Name, e.g. ADIB" autocomplete="off" autocapitalize="words">
          <input name="acc-wallet" data-i="${j}" value="${esc(a.wallet)}" maxlength="40" placeholder="Apple Wallet card name contains… (optional)" autocomplete="off" autocapitalize="off">
        </div>
        <button type="button" class="icon-btn" data-remove="${j}" aria-label="Remove ${esc(a.name || 'account')}">${icon('x', { size: 18 })}</button>
      </div>`).join('')}
      <button type="button" class="row link-row" data-onb="add-blank">${icon('plus', { size: 20 })}<span>Add another</span></button>
    </section>
    <p class="group-foot">The Wallet name lets Apple Pay payments find the right account. Leave it empty if you’re not sure.</p>
    ${nextButton(active().length > 0, 'Add at least one account')}`;
  },

  roles: () => {
    const list = active();
    const pick = (field, label) => `<div class="chips onb-pick" role="radiogroup" aria-label="${label}">${list.map((a) => `<button type="button" class="chip ${d[field] === a.name ? 'on' : ''}" role="radio" aria-checked="${d[field] === a.name}" data-pick="${field}" data-name="${esc(a.name)}">${esc(a.name)}</button>`).join('')}</div>`;
    return `<h1 class="onb-title">Where your money goes</h1>
    <h3 class="group-title">Where does your pay land?</h3>
    ${pick('main', 'Main account')}
    <p class="group-foot">Your main account. Bills and savings come from here.</p>
    <h3 class="group-title">Which card is your spending money on?</h3>
    ${pick('allowanceAcc', 'Allowance card')}
    <p class="group-foot">Each payday you move an allowance to this card and spend from it. It can be the same as your main account.</p>
    ${nextButton(d.main && d.allowanceAcc, 'Pick both')}`;
  },

  money: () => `<h1 class="onb-title">Pay and allowance</h1>
    <section class="group form">
      <label class="row input-row"><span>Monthly pay (AED)</span><input name="salary" type="text" inputmode="decimal" placeholder="0" value="${esc(d.salary)}"></label>
      <label class="row input-row"><span>Payday</span><select name="payday">${Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === +d.payday ? 'selected' : ''}>${ordinal(n)} of the month</option>`).join('')}</select></label>
      <label class="row input-row"><span>Allowance per month (AED)</span><input name="allowance" type="text" inputmode="decimal" placeholder="0" value="${esc(d.allowance)}"></label>
    </section>
    <p class="group-foot">Your money month runs from payday to the day before the next one${+d.payday > 28 ? '. Months don’t all have a 29th–31st, so it starts on the 28th' : ''}. “Safe to spend” is your allowance minus what you’ve spent on ${esc(d.allowanceAcc || 'your allowance card')} this month. Leave pay empty if you don’t get a salary.</p>
    ${nextButton(num(d.allowance) > 0, 'Enter an allowance')}`,

  balances: () => `<h1 class="onb-title">What’s in each account now?</h1>
    <p class="onb-lede">Check your banking apps. You can skip this and match each account later from Home.</p>
    <section class="group form">${active().map((a) => `<label class="row input-row"><span>${esc(a.name)}</span><input name="bal" data-name="${esc(a.name)}" type="text" inputmode="decimal" placeholder="AED 0" value="${esc(d.balances[a.name] ?? '')}"></label>`).join('')}</section>
    ${nextButton(true)}`,

  create: () => {
    const sameCard = d.main === d.allowanceAcc;
    return `<h1 class="onb-title">Make your sheet</h1>
    <section class="group onb-summary">
      ${sumRow('card', 'Accounts', active().map((a) => a.name).join(', '))}
      ${sumRow('sheet', 'Pay', num(d.salary) ? `AED ${fmtN(num(d.salary))} into ${d.main} on the ${ordinal(+d.payday)}` : `Payday on the ${ordinal(+d.payday)}`)}
      ${sumRow('sparkle', 'Allowance', `AED ${fmtN(num(d.allowance))} a month${sameCard ? ` on ${d.allowanceAcc}` : `, ${d.main} → ${d.allowanceAcc}`}`)}
    </section>
    <p class="onb-lede">Signing in makes a sheet called <b>Spendings</b> in your Google Drive, with the script that lets the app and Apple Pay save to it. The app can only see files it made, nothing else in your Drive.</p>
    ${googleReady() ? `<div class="onb-actions"><button type="button" class="btn-google" data-onb="google">${GOOGLE_G}Sign in with Google</button></div>
      <p class="group-foot center">Google will say the app isn’t verified yet. Tap <b>Advanced</b> → <b>Go to Spendings</b>, then tick every box.</p>`
    : `<div class="tip-card">${icon('warn', { size: 18 })}<p>Google sign-in isn’t switched on for this copy of the app yet. You can still set up your sheet by hand: follow SETUP.md, then paste its link and key in Settings.</p></div>
      <div class="onb-actions"><button type="button" class="btn-plain" data-onb="have">Set up by hand</button></div>`}`;
  },
};

const sumRow = (ic, title, sub) => `<div class="row"><span class="row-icon" style="--tint:var(--tint-text)">${icon(ic, { size: 20 })}</span><span class="row-main"><span class="row-title">${title}</span><span class="row-sub wrap">${esc(sub)}</span></span></div>`;
const nextButton = (ok, why = '') => `<div class="onb-actions"><button type="button" class="btn-primary" data-onb="next" ${ok ? '' : 'disabled'}>Continue</button>${!ok && why ? `<p class="group-foot center">${why}</p>` : ''}</div>`;
const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const fmtN = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

/* ───── Making the sheet ───── */

const STAGES = [
  ['sheet', 'Making your sheet'], ['script', 'Adding its script'], ['code', 'Putting the code in'],
  ['publish', 'Publishing it'], ['allow', 'Allowing access'], ['saving', 'Saving your setup'],
];

function progressScreen() {
  if (d.phase === 'done') {
    return `<div class="onb-hero">
      <span class="onb-check">${icon('check', { size: 40 })}</span>
      <h1>You’re all set</h1>
      <p>Your sheet is ready and this phone is connected to it.</p>
    </div>
    <section class="group">
      <button type="button" class="row link-row" data-onb="shortcut"><span class="row-icon" style="--tint:var(--tint-text)">${icon('bell', { size: 20 })}</span><span class="row-main"><span class="row-title">Log Apple Pay payments</span><span class="row-sub">Set up the Shortcut · 5 min</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>
      ${d.job?.sheetUrl ? `<a class="row link-row" href="${esc(d.job.sheetUrl)}" target="_blank" rel="noopener"><span class="row-icon" style="--tint:var(--good)">${icon('sheet', { size: 20 })}</span><span class="row-main"><span class="row-title">Open your sheet</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</a>` : ''}
    </section>
    <div class="onb-actions"><button type="button" class="btn-primary" data-onb="finish">Start using Spendings</button></div>`;
  }
  const at = d.phase === 'allow' ? 'allow' : d.phase === 'saving' ? 'saving' : d.stage || 'sheet';
  const atI = STAGES.findIndex(([k]) => k === at);
  return `<h1 class="onb-title">Setting up</h1>
    <ol class="onb-stages">${STAGES.map(([k, label], j) => `<li class="${j < atI ? 'done' : j === atI ? (d.phase === 'error' ? 'bad' : 'now') : ''}">
      <span class="dot">${j < atI ? icon('check', { size: 14 }) : ''}</span>${label}</li>`).join('')}</ol>
    ${d.phase === 'allow' ? `<div class="tip-card">${icon('faceid', { size: 18 })}<p><b>One tap left.</b> Google needs you to allow your new script to use your sheet. Tap below, choose your account, then <b>Advanced</b> → <b>Go to Spendings</b> → <b>Allow</b>. Then come back here.</p></div>
      <div class="onb-actions">
        <a class="btn-primary" href="${esc(d.job.url)}" target="_blank" rel="noopener" data-onb="allow">Allow access</a>
        <button type="button" class="btn-plain" data-onb="check">I’ve allowed it</button>
        <a class="text-btn" href="${esc(scriptEditorUrl(d.job.scriptId))}" target="_blank" rel="noopener">Not working? Open the script, choose <b>setup</b> and press Run</a>
      </div>` : ''}
    ${d.phase === 'error' ? `<div class="tip-card warn">${icon('warn', { size: 18 })}<p>${esc(d.error)}</p></div>
      <div class="onb-actions">
        ${d.errorCode === 'scriptapi' ? '<a class="btn-plain" href="https://script.google.com/home/usersettings" target="_blank" rel="noopener">Open Apps Script settings</a><p class="group-foot center">Switch on <b>Google Apps Script API</b>, come back, then tap Try again.</p>' : ''}
        <button type="button" class="btn-primary" data-onb="retry">Try again</button>
        <button type="button" class="text-btn" data-onb="restart">Start over</button>
      </div>` : ''}`;
}

async function make() {
  if (!token()) { d.phase = ''; d.step = 'create'; save(); draw(); return toast('Sign in with Google to carry on.'); }
  d.phase = 'making'; d.error = ''; save(); draw();
  try {
    d.job = await createBackend(d.job || {}, {
      onStep: (s) => { d.stage = s; save(); draw(); },
      save: (job) => { d.job = job; save(); },
    });
    d.phase = 'allow'; save(); draw();
    startChecking();
  } catch (e) { fail(e); }
}

function fail(e) {
  d.phase = 'error'; d.error = e.message; d.errorCode = e.code || ''; save(); draw();
}

/** Talk to the new sheet's script directly. text/plain keeps it a simple request (no CORS preflight). */
async function post(body, timeout = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(d.job.url, { method: 'POST', body: JSON.stringify({ token: d.job.key, ...body }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal, redirect: 'follow' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'The sheet said no.');
    return data;
  } finally { clearTimeout(t); }
}

function startChecking() {
  clearInterval(checking);
  checking = setInterval(checkNow, 5000);
  document.addEventListener('visibilitychange', checkNow);
  checkNow();
}

let busy = false;
/** Has the person allowed access yet? Until they have, Google answers with a sign-in page, not JSON. */
async function checkNow(manual) {
  if (busy || document.hidden || d?.phase !== 'allow') return;
  busy = true;
  try {
    await post({ action: 'ping' }, 30000); // the first answer builds the sheet's tabs, so it can be slow
    clearInterval(checking); checking = null;
    document.removeEventListener('visibilitychange', checkNow);
    await finishSetup();
  } catch {
    if (manual === true) toast('Not allowed yet. Tap Allow access and finish the steps on Google’s page.', { icon: icon('warn', { size: 18 }), tone: 'warn' });
  } finally { busy = false; }
}

/** Save the tutorial's answers into the new sheet, then connect this phone to it. Safe to repeat. */
async function finishSetup() {
  d.phase = 'saving'; save(); draw();
  try {
    const list = active();
    const payday = Math.min(31, Math.max(1, +d.payday || 1));
    await post({ action: 'accounts', accounts: list.map((a) => ({ name: a.name.trim(), color: a.color, wallet: a.wallet.trim().toLowerCase(), note: a.name === d.main ? 'Main · pay lands here' : a.name === d.allowanceAcc ? 'Spending money' : '' })) });
    await post({ action: 'settings', settings: { allowanceAccount: d.allowanceAcc, emergencyAccount: d.main, cycleStart: Math.min(28, payday), allowance: num(d.allowance) } });
    const plan = [];
    if (num(d.salary) > 0) plan.push({ id: 'salary', name: 'Salary', kind: 'Income', amount: num(d.salary), day: payday, to: d.main, category: 'Salary' });
    if (d.main !== d.allowanceAcc) plan.push({ id: 'allowance', name: 'Allowance', kind: 'Move', amount: num(d.allowance), day: payday, from: d.main, to: d.allowanceAcc });
    await post({ action: 'plan', plan });
    // starting balances as "match with bank" corrections; fixed ids so a retry can't add them twice
    const entries = list.filter((a) => num(d.balances[a.name])).map((a, j) => ({ id: `setup-${d.job.key.slice(0, 6)}-${j}`, type: 'Adjustment', amount: num(d.balances[a.name]), account: a.name, note: 'Starting balance', source: 'App' }));
    if (entries.length) await post({ action: 'add', entries });
    setConnection(d.job.url, d.job.key);
    if (isDemo()) setDemo(false);
    setPrefs({ onboardSkipped: false });
    await sync();
    d.phase = 'done'; save(); draw();
    haptic();
  } catch (e) { fail(Object.assign(new Error(`Couldn’t save your setup to the sheet: ${e.message}`), { code: 'save' })); }
}

/* ───── Taps and typing ───── */

function onClick(ev) {
  const t = ev.target;
  const add = t.closest('[data-add]');
  if (add) { d.accounts.push({ name: add.dataset.add, color: add.dataset.color, wallet: add.dataset.add === 'Cash' ? '' : add.dataset.add.toLowerCase() }); haptic(); save(); return draw(); }
  const rm = t.closest('[data-remove]');
  if (rm) { d.accounts.splice(+rm.dataset.remove, 1); save(); return draw(); }
  const sw = t.closest('[data-color-of]');
  if (sw) { // tap the swatch to step through the colours
    const a = d.accounts[+sw.dataset.colorOf], i = CARD_COLORS.findIndex((c) => c.id === a.color);
    a.color = CARD_COLORS[(i + 1) % CARD_COLORS.length].id; haptic(); save(); return draw();
  }
  const pick = t.closest('[data-pick]');
  if (pick) { d[pick.dataset.pick] = pick.dataset.name; haptic(); save(); return draw(); }
  const act = t.closest('[data-onb]')?.dataset.onb;
  if (!act) return;
  if (act === 'next') return go(1);
  if (act === 'back') return go(-1);
  if (act === 'add-blank') { d.accounts.push({ name: '', color: 'graphite', wallet: '' }); save(); draw(); host.querySelectorAll('input[name="acc-name"]').forEach((el, i, all) => { if (i === all.length - 1) el.focus(); }); return; }
  if (act === 'have') { setPrefs({ onboardSkipped: true }); write(null); close(); location.hash = '#settings'; return; }
  if (act === 'demo') { setPrefs({ onboardSkipped: true }); write(null); setDemo(true); return close(); }
  if (act === 'close') { write(null); return close(); }
  if (act === 'google') { save(); return signIn(); }
  if (act === 'retry') {
    if (d.errorCode === 'save') return finishSetup();
    if (d.errorCode === 'signin' || !token()) { d.phase = ''; d.step = 'create'; save(); return draw(); }
    return make();
  }
  if (act === 'restart') { d = { ...blank(), accounts: d.accounts, main: d.main, allowanceAcc: d.allowanceAcc, allowance: d.allowance, salary: d.salary, payday: d.payday, balances: d.balances, step: 'create' }; save(); return draw(); }
  if (act === 'check') return checkNow(true);
  if (act === 'finish' || act === 'shortcut') {
    write(null); close();
    if (act === 'shortcut') window.dispatchEvent(new Event('open-shortcut-guide'));
  }
}

function go(delta) {
  // a renamed or removed account must not stay picked
  const names = active().map((a) => a.name);
  if (!names.includes(d.main)) d.main = names.length === 1 ? names[0] : '';
  if (!names.includes(d.allowanceAcc)) d.allowanceAcc = names.length === 1 ? names[0] : '';
  if (delta > 0 && d.step === 'accounts') {
    const seen = new Set();
    for (const a of active()) {
      const k = a.name.trim().toLowerCase();
      if (seen.has(k)) return toast(`You have two accounts called ${esc(a.name.trim())}. Give one a different name.`, { tone: 'warn' });
      seen.add(k);
    }
    d.accounts = active().map((a) => ({ ...a, name: a.name.trim() }));
  }
  const i = Math.min(STEPS.length - 1, Math.max(0, STEPS.indexOf(d.step) + delta));
  d.step = STEPS[i]; save(); draw();
}

function onInput(ev) {
  const el = ev.target, n = el.name;
  if (n === 'acc-name' || n === 'acc-wallet') d.accounts[+el.dataset.i][n === 'acc-name' ? 'name' : 'wallet'] = el.value;
  else if (n === 'bal') d.balances[el.dataset.name] = el.value;
  else if (n === 'salary' || n === 'allowance' || n === 'payday') d[n] = el.value;
  else return;
  save();
  // only the Continue button depends on what's typed: refresh it without redrawing the field being typed in
  const btn = host.querySelector('[data-onb="next"]');
  if (btn && ev.type === 'input') {
    const ok = d.step === 'accounts' ? active().length > 0 : d.step === 'money' ? num(d.allowance) > 0 : true;
    btn.disabled = !ok;
    btn.nextElementSibling?.remove();
  }
  if (ev.type === 'change' && n === 'payday') draw();
}
