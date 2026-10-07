// Home: one true number (all your money) over a bar whose segments ARE the account balances.
// Tap or drag along the bar to focus an account: the number morphs, the details slide in
// from the side you moved towards. Below: the payday plan and where this cycle's money went.
import {
  ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, accountMeta, cycleName, cycleRange, daysLeft,
  balances, homeNumbers, whereRows, hubFlow, fmt, fmtCompact, money, dayKey, dayLabel, uid, cycleBounds, toAED,
} from './model.js';
import { state, addEntry, savePlan, isConnected, isDemo, undo, dismissPlan, restorePlan } from './store.js';
import { openSheet, haptic, toast, esc, spring, reduceMotion } from './ui.js';
import { icon } from './icons.js';

/* The UAE dirham sign (CBUAE, 2025): a D with two horizontal strokes through it. */
export const dirham = (cls = '') => `<svg class="dh ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5v15h3.2c4.6 0 7.8-3.1 7.8-7.5S14.8 4.5 10.2 4.5H7z"/><path d="M3.2 10.2h17.3M3.2 13.8h17.3"/></svg>`;

const order = () => ['all', ...ACCOUNTS.map((a) => a.id)];
let focus = (() => { try { return sessionStorage.getItem('sp.focus') || 'all'; } catch { return 'all'; } })();

let helpers = null;

const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => { const [y, m, dd] = dayKey(d).split('-').map(Number); return `${dd} ${MONTHS[m - 1]}`; };
function ago(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/* ───────────────────────── Numbers ───────────────────────── */

function model() {
  const s = state.settings;
  const m = homeNumbers(state.entries, state.plan, s, new Date(), state.dismissed);
  const matched = [...m.bals.values()].some((b) => b.matchedAt);
  // what each account had when this cycle began, and what has flowed in since
  const startIso = cycleBounds(m.cyc, s.cycleStart).start.toISOString();
  const startBals = balances(state.entries.filter((e) => e.date < startIso), s);
  const inflow = new Map();
  for (const e of state.entries) {
    if (e.cycle !== m.cyc || e.date < startIso) continue;
    const v = toAED(e, s);
    if (e.type === 'Income') inflow.set(e.account, (inflow.get(e.account) || 0) + v);
    if (e.type === 'Transfer' && e.toAccount) inflow.set(e.toAccount, (inflow.get(e.toAccount) || 0) + v);
    if (e.type === 'Adjustment' && v > 0) inflow.set(e.account, (inflow.get(e.account) || 0) + v);
  }
  return { ...m, matched, startBals, inflow };
}

const lensColor = (f) => (f === 'all' ? 'var(--label-2)' : accountMeta(f).color);
function valueFor(m, f) { return f === 'all' ? m.total : m.bals.get(f)?.balance || 0; }

function amountParts(v) {
  const neg = v < 0, a = Math.abs(Math.round(v * 100) / 100);
  const int = Math.floor(a), dec = Math.round((a - int) * 100);
  return { neg, int: `${neg ? '−' : ''}${fmt(int, { whole: true })}`, dec: `.${String(dec).padStart(2, '0')}` };
}

/* Odometer: each digit is a column 0–9 that springs to its digit. CSS transitions retarget from
   wherever they are, so switching again mid-roll stays continuous. */
const COL = Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join('');
const sigOf = (str) => str.replace(/\d/g, 'd');
function odoHTML(str, startDigits = '') {
  const digits = str.replace(/\D/g, '').length;
  const pad = startDigits.padStart(digits, '0').slice(-digits);
  let di = 0;
  return [...str].map((ch) => (/\d/.test(ch)
    ? `<span class="odo"><span class="odo-col" style="--d:${pad[di++] ?? 0}">${COL}</span></span>`
    : `<span class="odo-sep">${ch}</span>`)).join('');
}
function setOdo(el, str, instant = false) {
  if (el.dataset.sig !== sigOf(str)) {
    el.innerHTML = odoHTML(str, (el.dataset.str || '').replace(/\D/g, ''));
    el.dataset.sig = sigOf(str);
    el.offsetWidth; // commit the starting digits so the change below animates
  }
  const digits = str.replace(/\D/g, '');
  el.querySelectorAll('.odo-col').forEach((c, i) => {
    if (instant) c.style.transition = 'none';
    c.style.setProperty('--d', digits[i]);
    if (instant) { c.offsetWidth; c.style.transition = ''; }
  });
  el.dataset.str = str;
}
function setAmount(lv, v, instant = false) {
  const p = amountParts(v);
  setOdo(lv.querySelector('.lv-int'), p.int, instant);
  setOdo(lv.querySelector('.lv-dec'), p.dec, instant);
  lv.closest('.lens-amount')?.style.setProperty('--chars', p.int.length + 3);
  lv.setAttribute('aria-label', `AED ${p.int}${p.dec}`);
  lv.dataset.v = v;
}

function amountHTML(v) {
  const p = amountParts(v);
  return `${dirham()}<span class="lv num" data-v="${v}" role="text" aria-label="AED ${p.int}${p.dec}"><span class="lv-int" aria-hidden="true" data-sig="${sigOf(p.int)}" data-str="${p.int}">${odoHTML(p.int, p.int.replace(/\D/g, ''))}</span><span class="lv-dec" aria-hidden="true" data-sig="${sigOf(p.dec)}" data-str="${p.dec}">${odoHTML(p.dec, p.dec.replace(/\D/g, ''))}</span></span>`;
}

function label(m, f) {
  if (f === 'all') return 'All your money';
  const a = accountMeta(f);
  return `${a.name} <span class="lens-role">· ${f === m.hub ? 'pay lands here' : f === m.s.allowanceAccount ? 'allowance' : a.role.toLowerCase()}</span>`;
}

/* Pace: how this cycle's allowance spending compares with an even spread over the cycle. */
function paceLine(m) {
  const { delta, daysLeft: dl } = m.pace, tol = Math.max(15, m.sum.allowancePot * 0.03);
  const perDay = dl > 0 && m.safe > 0 ? ` · ${fmt(m.safe / dl, { whole: true })} a day for ${dl} ${dl === 1 ? 'day' : 'days'}` : '';
  if (m.allowLeft < 0) return `<span class="pace-bad">${fmt(-m.allowLeft, { whole: true })} over the allowance</span>`;
  if (delta > tol) return `<span class="pace-bad">${fmt(delta, { whole: true })} over pace</span>${perDay}`;
  if (delta < -tol) return `<span class="pace-good">On track · ${fmt(-delta, { whole: true })} under pace</span>${perDay}`;
  return `<span class="pace-good">On track</span>${perDay}`;
}

/* A small ✕ beside every payday prompt: "already done this cycle", so it stops asking until the next one. */
const dismissBtn = (p, cls = 'dismiss-x') => `<button type="button" class="${cls}" data-plan-dismiss="${esc(p.id)}" aria-label="Dismiss ${esc(p.name)} until next cycle">${icon('x', { size: 14 })}</button>`;

function meta(m, f) {
  const nextIncome = m.status.find((p) => p.kind === 'Income' && !p.complete);
  const expect = nextIncome ? ` · ${nextIncome.state === 'due'
    ? `<button type="button" class="soon soon-btn" data-plan-act="land" data-plan-id="${esc(nextIncome.id)}">${esc(nextIncome.name)} +${fmt(nextIncome.remaining, { whole: true })} due · tap when it lands</button>`
    : `<span class="soon">${esc(nextIncome.name)} +${fmt(nextIncome.remaining, { whole: true })} on ${shortDate(nextIncome.due)}</span>`}${dismissBtn(nextIncome)}` : '';
  if (!m.matched) return 'Match each account with your bank once, and these become your real numbers.';
  if (f === 'all') {
    const unmoved = m.allowanceUnmoved ? ` · <button type="button" class="soon soon-btn" data-plan-act="move" data-plan-id="${esc(m.allowMove.id)}">Allowance not moved yet</button>${dismissBtn(m.allowMove)}` : '';
    return `<b>${fmt(m.safe, { whole: true })}</b> safe to spend · ${paceLine(m)}${unmoved}${expect}`;
  }
  if (f === m.hub) return `<b>${fmt(m.hubB.free, { whole: true })}</b> is yours after responsibilities${expect}`;
  if (f === m.s.allowanceAccount) {
    const extra = m.allowBal - Math.min(Math.max(0, m.safe), Math.max(0, m.allowBal));
    return `<b>${fmt(m.safe, { whole: true })}</b> safe to spend${extra > 0.5 ? ` · <b>${fmt(extra, { whole: true })}</b> carried over from earlier cycles` : ''}`;
  }
  const acc = m.sum.byAccount.get(f) || { spent: 0, received: 0 };
  return `<b>${fmt(acc.spent, { whole: true })}</b> spent this cycle`;
}

/* ───────────────────────── Render ───────────────────────── */

export function renderHome(h) {
  helpers = h;
  if (focus !== 'all' && !ACCOUNTS.some((a) => a.id === focus)) focus = 'all';
  const m = model();
  const cyc = m.cyc, dl = daysLeft(cyc, m.s.cycleStart);
  const positive = ACCOUNTS.map((a) => Math.max(0, m.bals.get(a.id)?.balance || 0));
  const pTotal = positive.reduce((a, b) => a + b, 0);
  return `
    ${h.largeTitle(cycleName(cyc), `${cycleRange(cyc, m.s.cycleStart)} · ${dl} ${dl === 1 ? 'day' : 'days'} to payday`, h.syncBadge())}
    ${h.demoBanner()}
    ${!isConnected() && !isDemo() ? `<section class="onboard">
        <h2>Connect your Google Sheet</h2>
        <p>Your entries are kept on this phone for now. Connect your sheet so everything, Apple Pay included, lands in one place.</p>
        <div class="onboard-actions"><button class="btn-primary" type="button" data-go="settings">Set up</button><button class="btn-plain" type="button" data-act="demo">Try demo data</button></div>
      </section>` : ''}
    <section class="lens" data-focus="${focus}" style="--lens-c:${lensColor(focus)}" aria-label="Balances">
      <div class="lens-label">${label(m, focus)}</div>
      <div class="lens-amount" aria-live="polite" style="--chars:${amountParts(valueFor(m, focus)).int.length + 3}">${amountHTML(valueFor(m, focus))}</div>
      <p class="lens-meta">${meta(m, focus)}</p>
      <div class="strip${pTotal ? '' : ' empty'}" aria-hidden="true">
        ${ACCOUNTS.map((a, i) => `<span class="seg${focus === a.id ? ' on' : ''}" data-seg="${a.id}" style="--c:${a.color}; flex-grow:${pTotal ? positive[i] : 1}"></span>`).join('')}
      </div>
      <div class="keys" role="tablist" aria-label="Show account">
        <span class="keys-pill" aria-hidden="true"></span>
        ${order().map((id) => {
          const on = focus === id;
          const v = id === 'all' ? m.total : m.bals.get(id)?.balance || 0;
          return `<button type="button" role="tab" class="key-acc${on ? ' on' : ''}" aria-selected="${on}" data-focus="${id}" style="--c:${id === 'all' ? 'var(--label)' : accountMeta(id).color}">
            <span class="ka-name">${id === 'all' ? 'All' : id}</span><span class="ka-val num">${m.matched ? fmtCompact(v) : '—'}</span></button>`;
        }).join('')}
        <button type="button" class="key-acc key-add" data-acct-new="1" aria-label="Add an account">${icon('plus', { size: 18 })}</button>
      </div>
    </section>
    ${!m.matched && !isDemo() ? `<button type="button" class="match-all" data-act="match-all">${icon('sync', { size: 20 })}<span><b>Set your balances</b><span>Type what each bank app shows. Takes a minute, once.</span></span>${icon('chevR', { size: 18, cls: 'chev' })}</button>` : ''}
    <div class="lens-detail">${detail(m, focus)}</div>`;
}

function detail(m, f) {
  return f === 'all' ? detailAll(m) : detailAccount(m, f);
}

function detailAll(m) {
  const h = helpers;
  const review = state.entries.filter((e) => e.status === 'Review');
  return `
    ${paydayCard(m)}
    ${allowanceCard(m, true)}
    ${whereCard(m)}
    ${review.length ? `<button class="review-row" type="button" data-act="review">
        <span class="row-icon" style="--tint:var(--warn)">${icon('tray', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${review.length} ${review.length === 1 ? 'payment' : 'payments'} to sort</span><span class="row-sub">Pick a category for each</span></span>
        ${icon('chevR', { size: 18, cls: 'chev' })}</button>` : ''}
    ${h.quickAdd()}
    <div class="group-head"><h3 class="group-title">Recent</h3>${state.entries.length ? '<button class="text-btn" type="button" data-go="activity">See all</button>' : ''}</div>
    <section class="group">${state.entries.filter((e) => !(e.type === 'Adjustment' && !+e.amount)).slice(0, 6).map(h.entryRow).join('') || `<div class="empty">${icon('card', { size: 28 })}<p>No entries yet.</p><p class="muted">Pay with Apple Pay or tap <b>+</b>.</p></div>`}</section>`;
}

function detailAccount(m, f) {
  const h = helpers, b = m.bals.get(f) || { balance: 0, matchedAt: null };
  const recent = state.entries.filter((e) => e.account === f || e.toAccount === f).slice(0, 8);
  const acc = m.sum.byAccount.get(f) || { spent: 0, received: 0 };
  let body = '';
  if (f === m.hub) body = leftCard(m, f) + hubCard(m) + flowCard(m);
  else if (f === m.s.allowanceAccount) body = allowanceCard(m);
  else body = leftCard(m, f) + `<section class="figures"><div><span>In this cycle</span><b class="num in">+${fmt(m.inflow.get(f) || 0, { whole: true })}</b></div><div><span>Spent this cycle</span><b class="num">${fmt(acc.spent, { whole: true })}</b></div></section>`;
  return `
    ${body}
    <section class="group match-group">
      <button type="button" class="row link-row" data-act="match" data-acc="${f}">
        <span class="row-icon" style="--tint:${accountMeta(f).color}">${icon('sync', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Match with ${esc(f === 'Cash' ? 'my wallet' : `my ${f} app`)}</span>
          <span class="row-sub">${b.matchedAt ? `Last matched ${ago(b.matchedAt)}` : 'Never matched. Balance starts from zero'}</span></span>
        ${icon('chevR', { size: 16, cls: 'chev' })}</button>
    </section>
    <div class="group-head"><h3 class="group-title">${esc(f)} activity</h3></div>
    <section class="group">${recent.map(h.entryRow).join('') || `<div class="empty"><p>Nothing in ${esc(f)} yet.</p></div>`}</section>`;
}

function hubCard(m) {
  const { hubB, status, hub } = m;
  const parts = [
    { k: 'reserved', label: 'Responsibilities', v: Math.max(0, hubB.reserved), c: 'var(--warn)' },
    { k: 'move', label: 'Still to move', v: Math.max(0, hubB.toMove), c: 'var(--label-3)' },
    { k: 'free', label: 'Emergency', v: Math.max(0, hubB.free), c: accountMeta(hub).color },
  ];
  const tot = parts.reduce((a, p) => a + p.v, 0) || 1;
  const resp = status.filter((p) => p.kind === 'Responsibility' && p.from === hub);
  return `
    <section class="panel hub">
      <div class="layer-bar">${parts.map((p) => `<span style="flex-grow:${p.v}; --c:${p.c}"></span>`).join('')}</div>
      <div class="layer-keys">${parts.map((p) => `<div><i style="--c:${p.c}"></i><span>${p.label}</span><b class="num">${fmt(p.v, { whole: true })}</b></div>`).join('')}</div>
      ${hubB.free < 0 ? `<p class="hub-note warn-text">${icon('warn', { size: 14 })} ${esc(hub)} is short by ${fmt(-hubB.free, { whole: true })} for what’s still planned.</p>` : ''}
      ${resp.length ? `<div class="resp">${resp.map((p) => `<div class="resp-line"><button type="button" class="resp-row" data-plan-edit="${esc(p.id)}">
          <span>${esc(p.name)}</span>
          ${p.dismissed ? '<em class="resp-done">Paid this cycle</em>' : p.amount ? `<span class="resp-track"><i style="--w:${Math.min(100, (p.done / p.amount) * 100)}%"></i></span><b class="num">${p.remaining ? `${fmt(p.remaining, { whole: true })} left` : 'paid'}</b>` : '<em>Set amount</em>'}
        </button>${p.dismissed
          ? `<button type="button" class="text-btn resp-restore" data-plan-restore="${esc(p.id)}">Bring back</button>`
          : p.remaining > 0 ? dismissBtn(p, 'dismiss-x resp-x') : ''}</div>`).join('')}</div>` : ''}
      <button type="button" class="text-btn add-resp" data-plan-new="Responsibility" data-from="${esc(hub)}">${icon('plus', { size: 16 })} Add a responsibility</button>
    </section>`;
}

/* The liquid capsule, shared by every view: the level is always "what's left of what you had". */
function capsule({ label, value, meta, level, tone = '' }) {
  return `<section class="capsule ${tone}" style="--level:${Math.max(0, Math.min(1, level))}" aria-label="${esc(label)}">
      <div class="liquid" aria-hidden="true">
        <svg class="wave w1" viewBox="0 0 400 20" preserveAspectRatio="none"><path d="M0 10 Q 50 0 100 10 T 200 10 T 300 10 T 400 10 V20 H0z"/></svg>
        <svg class="wave w2" viewBox="0 0 400 20" preserveAspectRatio="none"><path d="M0 10 Q 50 18 100 10 T 200 10 T 300 10 T 400 10 V20 H0z"/></svg>
        <div class="liquid-body"></div>
      </div>
      <div class="cap-rim" aria-hidden="true"></div>
      <div class="cap-content">
        <span class="cap-label">${label}</span>
        <span class="cap-value num" data-value="${value.n}" data-unit="${value.unit || 'aed'}" style="--chars:${value.text.length}">${value.text}</span>
        <span class="cap-meta">${meta}</span>
      </div>
    </section>`;
}

/** Left this cycle for one account: what it holds now, out of what it started with plus what came in. */
function leftCard(m, f) {
  const had = Math.max(0, (m.startBals.get(f)?.balance || 0) + (m.inflow.get(f) || 0));
  const now = m.bals.get(f)?.balance || 0;
  const spent = Math.max(0, had - now);
  if (!had) return capsule({ label: 'Left this cycle', value: { n: now, text: `AED ${fmt(now, { whole: true })}` }, meta: 'Nothing came in yet this cycle', level: now > 0 ? 1 : 0 });
  const level = now / had;
  return capsule({
    label: now < 0 ? 'Overdrawn' : 'Left this cycle',
    value: { n: Math.abs(now), text: `AED ${fmt(Math.abs(now), { whole: true })}` },
    meta: `of ${fmt(had, { whole: true })} · ${Math.round(Math.min(1, spent / had) * 100)}% gone`,
    level, tone: now < 0 ? 'over' : level < 0.2 ? 'low' : '',
  });
}


/* Allowance liquid. On All it speaks in percent (left / spent), on the allowance account in AED.
   "Of" is this cycle's whole allowance: the allowance plus any top-ups carried in or added. */
function allowanceCard(m, percent = false) {
  const sum = m.sum, pot = sum.allowancePot, left = m.allowLeft;
  const level = pot > 0 ? Math.max(0, Math.min(1, left / pot)) : 0;
  const tone = left < 0 ? 'over' : level < 0.2 ? 'low' : '';
  const spentPct = pot > 0 ? Math.round((sum.allowanceUsed / pot) * 100) : 0;
  const extra = sum.carryIn + sum.topUps;
  const of = extra > 0.5 ? `${fmt(pot, { whole: true })} (${fmt(sum.allowance, { whole: true })} + ${fmt(extra, { whole: true })} top-up)` : fmt(pot, { whole: true });
  if (percent) {
    return capsule({
      label: left < 0 ? 'Allowance used up' : 'Allowance left',
      value: { n: Math.round(level * 100), text: `${Math.round(level * 100)}%`, unit: 'pct' },
      meta: `<b>${spentPct}% spent</b> · ${fmt(sum.allowanceUsed, { whole: true })} of ${of} on ${esc(m.allowAcc)}`,
      level, tone,
    });
  }
  return capsule({
    label: left < 0 ? 'Over the allowance' : 'Allowance left',
    value: { n: Math.abs(left), text: `AED ${fmt(Math.abs(left), { whole: true })}`, unit: 'aed' },
    meta: `${spentPct}% spent · ${fmt(sum.allowanceUsed, { whole: true })} of ${of} this cycle`,
    level, tone,
  });
}

/* Where your money is: every part of the total, so the numbers visibly add up. */
function whereCard(m) {
  if (!m.matched) return '';
  const rows = whereRows(m);
  return `<section class="where">
    <h3>Where your ${fmt(m.total, { whole: true })} is</h3>
    <div class="where-bar">${rows.filter((r) => r.v > 0).map((r) => `<span style="flex-grow:${r.v}; --c:${r.c}"></span>`).join('')}</div>
    ${rows.map((r) => `<div class="where-row"><i style="--c:${r.c}"></i><span class="wr-main"><b>${esc(r.label)}</b><span>${esc(r.sub)}</span></span><b class="num${r.v < 0 ? ' neg' : ''}">${r.v < 0 ? '−' : ''}${fmt(Math.abs(r.v), { whole: true })}</b></div>`).join('')}
    <div class="where-row total"><span class="wr-main"><b>All your money</b></span><b class="num">${fmt(m.total, { whole: true })}</b></div>
  </section>`;
}

function paydayCard(m) {
  const items = m.status.filter((p) => p.kind !== 'Responsibility');
  if (!items.length) return '';
  const done = items.filter((p) => p.complete).length;
  return `<section class="payday">
    <div class="pd-head"><h3>Payday plan</h3><span class="pd-count num">${done}/${items.length}</span><button type="button" class="text-btn" data-go="settings" data-anchor="plan">Edit</button></div>
    ${items.map((p) => {
      const what = p.kind === 'Income' ? `into ${esc(p.to)}` : `${esc(p.from)} → ${esc(p.to)}`;
      const right = p.dismissed
        ? `<button type="button" class="text-btn pd-restore" data-plan-restore="${esc(p.id)}">Bring back</button>`
        : p.complete
          ? `<span class="pd-done">${icon('check', { size: 16 })}</span>`
          : `${p.state === 'upcoming'
            ? `<span class="pd-when">${shortDate(p.due)}</span>`
            : `<button type="button" class="pd-btn" data-plan-act="${p.kind === 'Income' ? 'land' : 'move'}" data-plan-id="${esc(p.id)}">${p.kind === 'Income' ? 'It landed' : 'Move now'}</button>`}${dismissBtn(p, 'dismiss-x pd-x')}`;
      const sub = p.dismissed ? `${fmt(p.amount, { whole: true })} ${what} · already done this cycle` : `${fmt(p.complete ? p.done : p.remaining, { whole: true })} ${what}`;
      return `<div class="pd-row${p.complete ? ' complete' : ''}" data-plan-row="${esc(p.id)}">
        <span class="pd-dot" style="--c:${p.kind === 'Income' ? 'var(--good)' : accountMeta(p.to).color}"></span>
        <span class="pd-main"><b>${esc(p.name)}</b><span>${sub}</span></span>
        ${right}</div>`;
    }).join('')}
  </section>`;
}

/* Two-stage flow through the main account, drawn to scale. */
function flowCard(m) {
  const f = hubFlow(state.entries, m.cyc, m.hub, m.s);
  if (!f.inTotal && !f.outTotal) return '';
  const W = 340, H = 200, gap = 8, slot = 26;
  const src = [...f.sources].sort((a, b) => b[1] - a[1]);
  const outOrder = [...ACCOUNTS.map((a) => a.id), 'Spent', 'Kept'];
  const outs = [...f.outs].sort((a, b) => outOrder.indexOf(a[0]) - outOrder.indexOf(b[0]));
  const big = Math.max(f.inTotal, f.outTotal) || 1;
  const k = (H - gap * Math.max(src.length, outs.length)) / big;
  const lay = (list) => { let y = 0; return list.map(([name, v]) => { const h = Math.max(2, v * k); const slotH = Math.max(h, slot); const node = { name, v, y, h, slotH }; y += slotH + gap; return node; }); };
  const L = lay(src), R = lay(outs);
  const hH = Math.max(f.inTotal, f.outTotal) * k;
  const xL = 104, xC = 162, xR = 228, wN = 6, wC = 14;
  const colorOut = (n) => n === 'Spent' ? 'var(--label-3)' : n === 'Kept' ? accountMeta(m.hub).color : accountMeta(n).color;
  let ci = 0;
  const leftBands = L.map((n) => { const c0 = ci; ci += n.h; const y0 = n.y + (n.slotH - n.h) / 2; return `<path d="M${xL + wN} ${y0} C${xL + 40} ${y0} ${xC - 34} ${c0} ${xC} ${c0} L${xC} ${c0 + n.h} C${xC - 34} ${c0 + n.h} ${xL + 40} ${y0 + n.h} ${xL + wN} ${y0 + n.h} Z" class="band in"/>`; }).join('');
  ci = 0;
  const rightBands = R.map((n) => { const c0 = ci; ci += n.h; const y0 = n.y + (n.slotH - n.h) / 2; return `<path d="M${xC + wC} ${c0} C${xC + wC + 30} ${c0} ${xR - 34} ${y0} ${xR} ${y0} L${xR} ${y0 + n.h} C${xR - 34} ${y0 + n.h} ${xC + wC + 30} ${c0 + n.h} ${xC + wC} ${c0 + n.h} Z" class="band" style="--c:${colorOut(n.name)}"/>`; }).join('');
  const total = Math.max(L.reduce((a, n) => Math.max(a, n.y + n.slotH), 0), R.reduce((a, n) => Math.max(a, n.y + n.slotH), 0), hH);
  const labelL = L.map((n) => `<text x="${xL - 8}" y="${n.y + n.slotH / 2 - 2}" text-anchor="end" class="fl-name">${esc(n.name)}</text><text x="${xL - 8}" y="${n.y + n.slotH / 2 + 11}" text-anchor="end" class="fl-val">+${fmt(n.v, { whole: true })}</text><rect x="${xL}" y="${n.y + (n.slotH - n.h) / 2}" width="${wN}" height="${n.h}" rx="2" class="node in"/>`).join('');
  const labelR = R.map((n) => `<rect x="${xR}" y="${n.y + (n.slotH - n.h) / 2}" width="${wN}" height="${n.h}" rx="2" style="fill:${colorOut(n.name)}"/><text x="${xR + 14}" y="${n.y + n.slotH / 2 - 2}" class="fl-name">${n.name === 'Kept' ? `Kept in ${esc(m.hub)}` : esc(n.name === 'Spent' ? 'Spent from ' + m.hub : n.name)}</text><text x="${xR + 14}" y="${n.y + n.slotH / 2 + 11}" class="fl-val">${fmt(n.v, { whole: true })}</text>`).join('');
  return `<section class="flow-card">
    <h3>How ${esc(m.hub)} moved money this cycle</h3>
    <svg viewBox="-4 -4 ${W + 8} ${total + 8}" class="flow-svg" role="img" aria-label="${esc(m.hub)} received ${fmt(f.inTotal, { whole: true })} and sent out ${fmt(f.outTotal, { whole: true })} this cycle">
      ${leftBands}${rightBands}
      <rect x="${xC}" y="0" width="${wC}" height="${hH}" rx="3" style="fill:${accountMeta(m.hub).color}"/>
      ${labelL}${labelR}
    </svg>
  </section>`;
}

/* ───────────────────────── Motion ───────────────────────── */

function riseLiquid(root) {
  if (reduceMotion()) return;
  root.querySelectorAll('.capsule .liquid').forEach((l) => {
    const lv = +l.closest('.capsule').style.getPropertyValue('--level') || 0;
    const sp = spring(0.75, 0.9);
    l.animate([{ transform: 'translateY(100%)' }, { transform: `translateY(${(1 - lv) * 100}%)` }], { duration: sp.duration, easing: sp.easing });
  });
}

function swapContent(el, html, dir) {
  el.getAnimations().forEach((a) => a.cancel());
  if (reduceMotion()) { el.innerHTML = html; return; }
  el.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: `translateX(${-dir * 14}px)`, filter: 'blur(3px)' }], { duration: 110, easing: 'ease-in' }).onfinish = () => {
    el.innerHTML = html;
    riseLiquid(el);
    const sp = spring(0.9, 0.38);
    el.animate([{ opacity: 0, transform: `translateX(${dir * 22}px)`, filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: sp.duration, easing: sp.easing });
  };
}

function setFocus(next, { scrub = false } = {}) {
  if (!order().includes(next) || next === focus) return;
  const dir = Math.sign(order().indexOf(next) - order().indexOf(focus)) || 1;
  focus = next;
  try { sessionStorage.setItem('sp.focus', focus); } catch { /* private mode */ }
  haptic();
  const lens = document.querySelector('.lens');
  if (!lens) return;
  const m = model();
  lens.dataset.focus = focus;
  lens.style.setProperty('--lens-c', lensColor(focus));
  lens.querySelectorAll('.seg').forEach((s) => s.classList.toggle('on', s.dataset.seg === focus));
  lens.querySelectorAll('.key-acc').forEach((k) => { const on = k.dataset.focus === focus; k.classList.toggle('on', on); k.setAttribute('aria-selected', String(on)); });
  placePill(true);
  setAmount(lens.querySelector('.lv'), valueFor(m, focus));
  swapContent(lens.querySelector('.lens-label'), label(m, focus), dir);
  swapContent(lens.querySelector('.lens-meta'), meta(m, focus), dir);
  const det = document.querySelector('.lens-detail');
  if (scrub) { clearTimeout(setFocus.t); setFocus.t = setTimeout(() => swapContent(det, detail(model(), focus), dir), 140); }
  else swapContent(det, detail(m, focus), dir);
}

/* The pill under the focused key glides there on a spring, stretching a little on the way. */
let pillAnim = null;
let pillFollowing = false;
function followPill(clientX) {
  const keys = document.querySelector('.keys'), pill = keys?.querySelector('.keys-pill');
  if (!pill) return;
  pillAnim?.cancel();
  const r = keys.getBoundingClientRect(), w = pill.offsetWidth;
  const x = Math.max(0, Math.min(keys.scrollWidth - w, clientX - r.left + keys.scrollLeft - w / 2));
  pill.style.transform = `translateX(${x}px) scale(1.04)`;
}
function placePill(animate) {
  if (pillFollowing) return;
  const keys = document.querySelector('.keys');
  if (!keys) return;
  const pill = keys.querySelector('.keys-pill'), key = keys.querySelector(`.key-acc[data-focus="${focus}"]`);
  if (!pill || !key) return;
  if (key.offsetLeft < keys.scrollLeft || key.offsetLeft + key.offsetWidth > keys.scrollLeft + keys.clientWidth) {
    keys.scrollTo({ left: key.offsetLeft - (keys.clientWidth - key.offsetWidth) / 2, behavior: animate && !reduceMotion() ? 'smooth' : 'auto' });
  }
  const to = `translateX(${key.offsetLeft}px)`, w = `${key.offsetWidth}px`;
  const from = pill.style.transform, fromW = pill.style.width;
  pill.style.transform = to; pill.style.width = w;
  if (animate && from && from !== to && !reduceMotion()) {
    pillAnim?.cancel();
    const sp = spring(0.78, 0.42);
    pillAnim = pill.animate([{ transform: from, width: fromW }, { transform: to, width: w }], { duration: sp.duration, easing: sp.easing });
  }
}

/* Arrow keys / swipes step through All → each account. */
export function stepFocus(d) { const o = order(); setFocus(o[Math.max(0, Math.min(o.length - 1, o.indexOf(focus) + d))]); }

/* Before a full re-render: remember what is on screen so numbers and segments move from there. */
export function snapshotHome() {
  const lens = document.querySelector('.lens');
  if (!lens) return null;
  return {
    v: +lens.querySelector('.lv').dataset.v,
    grow: [...lens.querySelectorAll('.seg')].map((s) => s.style.flexGrow),
    done: new Set([...document.querySelectorAll('.pd-row.complete')].map((r) => r.dataset.planRow)),
  };
}

export function afterHomeRender(snap) {
  const lens = document.querySelector('.lens');
  if (!lens) return;
  placePill(false);
  const amt = lens.querySelector('.lv');
  const target = +amt.dataset.v;
  if (snap) {
    if (snap.v !== target && !reduceMotion()) { setAmount(amt, snap.v, true); setAmount(amt, target); }
    document.querySelectorAll('.pd-row.complete').forEach((r) => {
      if (snap.done.has(r.dataset.planRow) || reduceMotion()) return;
      const sp = spring(0.6, 0.45);
      r.querySelector('.pd-done')?.animate([{ transform: 'scale(0.3) rotate(-30deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: sp.duration, easing: sp.easing });
      r.animate([{ backgroundColor: 'color-mix(in srgb, var(--good) 14%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 900, easing: 'ease-out' });
    });
    const segs = [...lens.querySelectorAll('.seg')];
    if (!reduceMotion() && snap.grow.length === segs.length && segs.some((s, i) => s.style.flexGrow !== snap.grow[i])) {
      const next = segs.map((s) => s.style.flexGrow);
      segs.forEach((s, i) => { s.style.transition = 'none'; s.style.flexGrow = snap.grow[i]; });
      lens.offsetWidth; // commit the old widths, then spring to the new ones
      segs.forEach((s, i) => { s.style.transition = ''; s.style.flexGrow = next[i]; });
    }
  } else {
    // cold start: the bar fills in once, left to right, so you see what the total is made of
    if (!reduceMotion() && !afterHomeRender.played) {
      afterHomeRender.played = true;
      lens.querySelectorAll('.seg').forEach((sg, i) => {
        sg.animate([{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, delay: 120 + i * 70, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'backwards' });
      });
    }
  }
}

/* ───────────────────────── Gestures ───────────────────────── */

let scrub = null;
export function bindHomeGestures(view) {
  view.addEventListener('pointerdown', (e) => {
    const zone = e.target.closest('.strip, .keys, .lens-amount');
    if (!zone) return;
    scrub = { zone: zone.classList.contains('lens-amount') ? 'swipe' : 'scrub', x0: e.clientX, y0: e.clientY, on: false, id: e.pointerId, t0: e.timeStamp };
  });
  view.addEventListener('pointermove', (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const dx = e.clientX - scrub.x0, dy = e.clientY - scrub.y0;
    if (!scrub.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { scrub = null; return; }
      if (Math.abs(dx) < 8) return;
      scrub.on = true;
      e.target.setPointerCapture?.(e.pointerId);
    }
    if (scrub.zone === 'scrub') {
      // more keys than fit: dragging near an edge scrolls the row so every account can be reached
      const row = document.querySelector('.keys'), kr = row?.getBoundingClientRect();
      if (kr && row.scrollWidth > row.clientWidth) {
        if (e.clientX > kr.right - 32) row.scrollLeft += 14;
        else if (e.clientX < kr.left + 32) row.scrollLeft -= 14;
      }
      pillFollowing = true;
      followPill(e.clientX);
      const keys = [...document.querySelectorAll('.key-acc')];
      const hit = keys.find((k) => { const r = k.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
      if (hit) setFocus(hit.dataset.focus, { scrub: true });
    }
  });
  const end = (e) => {
    const s = scrub; scrub = null;
    if (!s || !s.on) return;
    swallow();
    if (pillFollowing) { pillFollowing = false; placePill(true); }
    if (s.zone === 'swipe') {
      const dx = e.clientX - s.x0, v = dx / Math.max(1, e.timeStamp - s.t0);
      if (Math.abs(dx) > 40 || Math.abs(v) > 0.5) setFocus(order()[Math.max(0, Math.min(order().length - 1, order().indexOf(focus) + (dx < 0 ? 1 : -1)))]);
    }
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
}
let swallowing = false;
function swallow() { swallowing = true; setTimeout(() => { swallowing = false; }, 60); }

/* Clicks that belong to Home. Returns true when handled. */
export function homeClick(t) {
  if (swallowing) return true;
  const key = t.closest('.key-acc');
  if (key && key.dataset.focus) { setFocus(key.dataset.focus); return true; }
  const seg = t.closest('.seg');
  if (seg) { setFocus(seg.dataset.seg); return true; }
  const pd = t.closest('[data-plan-dismiss]');
  if (pd) { dismissPrompt(pd.dataset.planDismiss); return true; }
  const pr = t.closest('[data-plan-restore]');
  if (pr) { haptic(); restorePlan(pr.dataset.planRestore); return true; }
  const pa = t.closest('[data-plan-act]');
  if (pa) { runPlan(pa.dataset.planId); return true; }
  const pe = t.closest('[data-plan-edit]');
  if (pe) { openPlanItem(state.plan.find((p) => p.id === pe.dataset.planEdit)); return true; }
  const pn = t.closest('[data-plan-new]');
  if (pn) { openPlanItem(null, { kind: pn.dataset.planNew, from: pn.dataset.from || '' }); return true; }
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'match') { openMatch(t.closest('[data-act]').dataset.acc); return true; }
  if (act === 'match-all') { openMatch(ACCOUNTS[0].id, { chain: true }); return true; }
  return false;
}

/* ───────────────────────── Payday actions ───────────────────────── */

function runPlan(id) {
  const m = model();
  const p = m.status.find((x) => x.id === id);
  if (!p) return;
  haptic();
  const e = p.kind === 'Income'
    ? addEntry({ type: 'Income', amount: p.remaining || p.amount, account: p.to, category: p.category || 'Other', merchant: p.name, source: `Plan:${p.id}` })
    : addEntry({ type: 'Transfer', amount: p.remaining || p.amount, account: p.from, toAccount: p.to, note: p.name, source: `Plan:${p.id}` });
  toast(p.kind === 'Income' ? `${esc(p.name)} landed · +${fmt(e.amount, { whole: true })}` : `Moved ${fmt(e.amount, { whole: true })} to ${esc(p.to)}`, {
    icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => undo(),
  });
}

/** Already paid or moved before tracking started: hide it until the next cycle. No entry, no balance change. */
function dismissPrompt(id) {
  const m = model();
  const p = m.status.find((x) => x.id === id);
  if (!p) return;
  haptic();
  dismissPlan(id, m.cyc);
  toast(`${esc(p.name)} hidden until next cycle`, { icon: icon('check', { size: 18 }), action: 'Undo', onAction: () => undo() });
}

/* ───────────────────────── Match with bank ───────────────────────── */

export function openMatch(acc, { chain = false } = {}) {
  const bal = balances(state.entries, state.settings).get(acc)?.balance || 0;
  let str = '';
  const idx = ACCOUNTS.findIndex((a) => a.id === acc);
  const nextAcc = chain ? ACCOUNTS[idx + 1]?.id : null;
  openSheet({
    label: `Match ${acc}`, tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${chain ? 'Skip' : 'Cancel'}</button><h2 class="sheet-title">${chain ? `${idx + 1} of ${ACCOUNTS.length} · ` : ''}${esc(acc)}</h2><span class="icon-btn-spacer"></span></header>
      <p class="sheet-lede center">What does ${acc === 'Cash' ? 'your wallet hold' : `your ${esc(acc)} app show`} right now?</p>
      <div class="match-amount">${dirham()}<output class="amount num zero">0</output></div>
      <p class="amount-sub match-diff"></p>
      <div class="keypad-wrap">
        <div class="keypad" role="group" aria-label="Amount keypad">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => `<button type="button" class="key" data-key="${k}" aria-label="${k === 'del' ? 'Delete digit' : k}">${k === 'del' ? icon('backspace', { size: 24 }) : k}</button>`).join('')}
        </div>
        <button class="save-btn" type="button" data-act="save" disabled>Type the balance</button>
      </div>`,
    onMount(sheet, close) {
      const out = sheet.querySelector('.amount'), diffEl = sheet.querySelector('.match-diff'), save = sheet.querySelector('[data-act="save"]');
      const paint = () => {
        const v = +str || 0;
        const [i, d] = (str || '0').split('.');
        out.innerHTML = `${fmt(+i || 0, { whole: true })}${d !== undefined ? `<span class="dec">.${d}</span>` : ''}`;
        out.classList.toggle('zero', !str);
        const diff = Math.round((v - bal) * 100) / 100;
        diffEl.textContent = !str ? (bal ? `The app thinks ${fmt(bal, { fixed: true })}` : '') : diff === 0 ? 'Spot on. Nothing to correct.' : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff), { fixed: true })} difference will be recorded`;
        save.disabled = !str;
        save.textContent = str ? (nextAcc ? `Save & next: ${nextAcc}` : 'Save balance') : 'Type the balance';
      };
      sheet.querySelector('.keypad').addEventListener('pointerdown', (ev) => {
        const k = ev.target.closest('.key')?.dataset.key;
        if (!k) return;
        ev.preventDefault(); haptic();
        if (k === 'del') str = str.slice(0, -1);
        else if (k === '.') { if (!str.includes('.')) str = (str || '0') + '.'; }
        else { const [i, d] = str.split('.'); if ((d ?? '').length >= 2 && d !== undefined) return; if (d === undefined && (i || '').length >= 8) return; str = str === '0' ? k : str + k; }
        paint();
      });
      sheet.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-act]')?.dataset.act;
        if (a === 'cancel') { close(); if (nextAcc) setTimeout(() => openMatch(nextAcc, { chain }), 320); }
        if (a === 'save' && str) {
          const diff = Math.round(((+str) - bal) * 100) / 100;
          addEntry({ type: 'Adjustment', amount: diff, account: acc, note: 'Matched with bank', source: 'App' });
          haptic();
          close();
          if (nextAcc) setTimeout(() => openMatch(nextAcc, { chain }), 320);
          else toast(diff === 0 ? `${esc(acc)} matches the bank` : `${esc(acc)} matched · ${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff), { whole: true })} corrected`, { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
      paint();
    },
  });
}

/* ───────────────────────── Payday plan editor ───────────────────────── */

export function planSettingsBlock() {
  const kinds = [['Income', 'Money that lands'], ['Move', 'Money you move'], ['Responsibility', 'What ADIB pays']];
  return kinds.map(([k, title]) => {
    const items = state.plan.filter((p) => p.kind === k);
    return `<div class="plan-kind"><div class="ap-label">${title}</div>
      ${items.map((p) => `<button type="button" class="plan-row" data-plan-edit="${esc(p.id)}">
        <span class="pd-dot" style="--c:${k === 'Income' ? 'var(--good)' : k === 'Move' ? accountMeta(p.to).color : 'var(--warn)'}"></span>
        <span class="pd-main"><b>${esc(p.name)}</b><span>${k === 'Income' ? `into ${esc(p.to)}` : k === 'Move' ? `${esc(p.from)} → ${esc(p.to)}` : `${esc(p.category)} from ${esc(p.from)}`}${p.day ? ` · on the ${ord(p.day)}` : ''}</span></span>
        <b class="num">${p.amount ? fmt(p.amount, { whole: true }) : '—'}</b>${icon('chevR', { size: 16, cls: 'chev' })}</button>`).join('')}
      <button type="button" class="text-btn plan-add" data-plan-new="${k}">${icon('plus', { size: 16 })} Add</button></div>`;
  }).join('');
}

export function openPlanItem(existing, preset = {}) {
  const p = existing ? { ...existing } : { id: 'p-' + uid().slice(2, 10), name: '', kind: 'Responsibility', amount: 0, day: null, from: state.settings.emergencyAccount, to: '', category: 'Transport & Fuel', ...preset };
  const accOpts = (sel) => ACCOUNTS.map((a) => `<option ${a.id === sel ? 'selected' : ''}>${a.id}</option>`).join('');
  const catOpts = (list, sel) => list.map((c) => `<option ${c.id === sel ? 'selected' : ''}>${esc(c.id)}</option>`).join('');
  openSheet({
    label: 'Plan item', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">${existing ? esc(p.name) : 'New plan item'}</h2><button class="text-btn strong" data-act="save" type="button">Save</button></header>
      <div class="sheet-scroll plan-form" data-kind="${p.kind}">
        <section class="group form">
          <label class="row input-row"><span>Name</span><input id="pf-name" name="name" type="text" value="${esc(p.name)}" placeholder="e.g. Fuel" maxlength="40"></label>
          <label class="row input-row"><span>Type</span><select id="pf-kind" name="kind">${['Income', 'Move', 'Responsibility'].map((k) => `<option ${k === p.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label class="row input-row"><span>Amount</span><span class="suffix-input"><em>AED</em><input id="pf-amount" name="amount" type="number" inputmode="decimal" min="0" step="any" value="${p.amount || ''}"></span></label>
          <label class="row input-row"><span>Day of month</span><select id="pf-day" name="day"><option value="">Any day</option>${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option ${d === p.day ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="row input-row f-from"><span>From</span><select id="pf-from" name="from">${accOpts(p.from || state.settings.emergencyAccount)}</select></label>
          <label class="row input-row f-to"><span>Into</span><select id="pf-to" name="to">${accOpts(p.to || state.settings.emergencyAccount)}</select></label>
          <label class="row input-row f-cat-spend"><span>Category</span><select id="pf-cat-s" name="catSpend">${catOpts(SPEND_CATEGORIES, p.category)}</select></label>
          <label class="row input-row f-cat-income"><span>Category</span><select id="pf-cat-i" name="catIncome">${catOpts(INCOME_CATEGORIES, p.category)}</select></label>
        </section>
        <p class="group-foot plan-hint"></p>
        ${existing ? '<button type="button" class="dup-btn danger-btn" data-act="delete">Remove from plan</button>' : ''}
      </div>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('.plan-form'), hint = sheet.querySelector('.plan-hint');
      const HINTS = {
        Income: 'Shows up on Home on its day with an “It landed” button, so your total is never ahead of the bank.',
        Move: 'A reminder to move money between accounts. One tap logs the transfer.',
        Responsibility: 'Money held back in the main account until you’ve spent it in this category this cycle.',
      };
      const sync = () => { form.dataset.kind = sheet.querySelector('#pf-kind').value; hint.textContent = HINTS[form.dataset.kind]; };
      sheet.querySelector('#pf-kind').addEventListener('change', sync);
      sync();
      sheet.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-act]')?.dataset.act;
        if (a === 'cancel') close();
        if (a === 'delete') { savePlan(state.plan.filter((x) => x.id !== p.id)); close(); toast(`Removed ${esc(p.name)} from the plan`); }
        if (a === 'save') {
          const kind = sheet.querySelector('#pf-kind').value;
          const item = {
            id: p.id, kind, name: sheet.querySelector('#pf-name').value.trim() || kind,
            amount: Math.max(0, parseFloat(sheet.querySelector('#pf-amount').value) || 0),
            day: sheet.querySelector('#pf-day').value ? +sheet.querySelector('#pf-day').value : null,
            from: kind === 'Income' ? '' : sheet.querySelector('#pf-from').value,
            to: kind === 'Responsibility' ? '' : sheet.querySelector('#pf-to').value,
            category: kind === 'Income' ? sheet.querySelector('#pf-cat-i').value : kind === 'Responsibility' ? sheet.querySelector('#pf-cat-s').value : '',
          };
          const list = existing ? state.plan.map((x) => (x.id === p.id ? item : x)) : [...state.plan, item];
          savePlan(list);
          haptic();
          close();
          toast(`Saved ${esc(item.name)}`, { icon: icon('check', { size: 18 }), tone: 'good' });
        }
      });
    },
  });
}
