import {
  ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, categoryMeta, seriesColor, accountMeta, cycleOf, shiftCycle,
  cycleName, cycleRange, daysLeft, cycleLength, cycleBounds, summarize, money, fmt, dayKey, dayLabel, timeLabel, toAED, toCSV,
} from './model.js';
import {
  state, subscribe, sync, isConnected, isDemo, setConnection, ping, updateEntry, saveSettings, setDemo,
} from './store.js';
import { openEntry } from './entry.js';
import { openSheet, toast, haptic, esc, spring, reduceMotion, rollNumber } from './ui.js';
import { icon } from './icons.js';
import { donut, bindDonut, paceLine, bindPace, inOutBars } from './charts.js';
import { initLock, lockSupported, enableLock, disableLock } from './lock.js';

const view = document.getElementById('view');
const TABS = ['home', 'activity', 'insights', 'settings'];
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
let insightsCycle = null;
let activityFilter = { q: '', kind: 'all' };
const currentCycle = () => cycleOf(new Date(), state.settings.cycleStart);

/* ───────────────────────── Shared bits ───────────────────────── */

function entryRow(e) {
  const isIn = e.type === 'Income', isTr = e.type === 'Transfer';
  const meta = isTr ? null : categoryMeta(e.category, e.type);
  const tint = isTr ? 'var(--label-2)' : isIn ? 'var(--good)' : meta ? seriesColor(meta.slot) : 'var(--warn)';
  const ic = isTr ? 'transfer' : meta ? meta.icon : e.status === 'Review' ? 'tray' : 'dots';
  const title = e.merchant || (isTr ? `${e.account} → ${e.toAccount}` : e.category || 'Uncategorised');
  const bits = [];
  if (isTr) bits.push('Transfer'); else bits.push(e.category || '<span class="needs">Needs category</span>');
  if (!isTr) bits.push(esc(accountMeta(e.account).name));
  else if (e.merchant) bits.push(`${esc(e.account)} → ${esc(e.toAccount)}`);
  bits.push(timeLabel(e.date));
  const amt = `${isIn ? '+' : ''}${e.currency === 'USD' ? '$' : ''}${fmt(e.amount, { fixed: true })}`;
  return `<button class="row entry${e.status === 'Review' ? ' review' : ''}" type="button" data-id="${esc(e.id)}">
    <span class="row-icon" style="--tint:${tint}">${icon(ic, { size: 20 })}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${bits.join(' · ')}${e.note ? ` · <span class="row-note">${esc(e.note)}</span>` : ''}</span></span>
    <span class="row-amt num ${isIn ? 'in' : isTr ? 'tr' : ''}">${amt}${e.currency === 'USD' ? `<small>≈ AED ${fmt(toAED(e, state.settings), { fixed: true })}</small>` : ''}</span>
  </button>`;
}

function syncBadge() {
  if (isDemo()) return `<button class="sync-badge demo" type="button" data-go="settings">Demo</button>`;
  if (!isConnected()) return `<button class="sync-badge off" type="button" data-go="settings">${icon('link', { size: 15 })}Connect</button>`;
  const s = state.sync.status;
  const pending = state.outbox.length;
  if (s === 'syncing') return `<span class="sync-badge spin" role="status">${icon('sync', { size: 15 })}Syncing</span>`;
  if (s === 'error') return `<button class="sync-badge err" type="button" data-act="sync" title="${esc(state.sync.error)}">${icon('warn', { size: 15 })}${pending ? `${pending} waiting` : 'Retry'}</button>`;
  if (pending) return `<button class="sync-badge pend" type="button" data-act="sync">${icon('sync', { size: 15 })}${pending} waiting</button>`;
  return `<button class="sync-badge ok" type="button" data-act="sync" aria-label="Synced. Tap to sync again">${icon('check', { size: 15 })}Synced</button>`;
}

function largeTitle(title, sub = '', right = '') {
  return `<header class="large-title"><div><h1>${title}</h1>${sub ? `<p class="lt-sub">${sub}</p>` : ''}</div><div class="lt-right">${right}</div></header>`;
}

function demoBanner() {
  return isDemo() ? `<div class="banner demo-banner">${icon('sparkle', { size: 18 })}<span><b>Demo data.</b> Made-up numbers so you can look around.</span><button type="button" class="text-btn" data-act="exit-demo">Exit</button></div>` : '';
}

/* ───────────────────────── Home ───────────────────────── */

function renderHome() {
  const s = state.settings, cyc = currentCycle();
  const sum = summarize(state.entries, cyc, s);
  const left = sum.allowanceLeft, dl = daysLeft(cyc, s.cycleStart);
  const level = s.allowance > 0 ? Math.max(0, Math.min(1, left / s.allowance)) : 0;
  const tone = left < 0 ? 'over' : level < 0.2 ? 'low' : '';
  const perDay = dl > 0 && left > 0 ? left / dl : 0;
  const reviewItems = state.entries.filter((e) => e.status === 'Review');
  const emergency = sum.byAccount.get(s.emergencyAccount)?.spent || 0;
  const recent = state.entries.slice(0, 6);
  const onboarding = !isConnected() && !isDemo();

  return `
    ${largeTitle(cycleName(cyc), `${cycleRange(cyc, s.cycleStart)} · ${dl} ${dl === 1 ? 'day' : 'days'} left`, syncBadge())}
    ${demoBanner()}
    ${onboarding ? `<section class="onboard">
        <h2>Connect your Google Sheet</h2>
        <p>Your entries are saved on this phone for now. Connect your sheet so every entry, including Apple Pay ones, lands in one place.</p>
        <div class="onboard-actions"><button class="btn-primary" type="button" data-go="settings">Set up</button><button class="btn-plain" type="button" data-act="demo">Try demo data</button></div>
      </section>` : ''}
    <section class="capsule ${tone}" style="--level:${level}" aria-label="Allowance">
      <div class="liquid" aria-hidden="true">
        <svg class="wave w1" viewBox="0 0 400 20" preserveAspectRatio="none"><path d="M0 10 Q 50 0 100 10 T 200 10 T 300 10 T 400 10 V20 H0z"/></svg>
        <svg class="wave w2" viewBox="0 0 400 20" preserveAspectRatio="none"><path d="M0 10 Q 50 18 100 10 T 200 10 T 300 10 T 400 10 V20 H0z"/></svg>
        <div class="liquid-body"></div>
      </div>
      <div class="cap-rim" aria-hidden="true"></div>
      <div class="cap-content">
        <span class="cap-label">${left < 0 ? 'Over your allowance' : 'Allowance left'}</span>
        <span class="cap-value num" data-value="${Math.abs(left)}">AED ${fmt(Math.abs(left), { whole: true })}</span>
        <span class="cap-meta">${left < 0
          ? `You’ve spent ${money(sum.allowanceUsed, 'AED', { whole: true })} of ${money(s.allowance, 'AED', { whole: true })} on ${esc(s.allowanceAccount)}`
          : `of ${fmt(s.allowance, { whole: true })} on ${esc(s.allowanceAccount)}${perDay ? ` · about <b>AED ${fmt(perDay, { whole: true })}</b> a day` : ''}`}</span>
      </div>
    </section>

    <section class="flow" aria-label="This cycle">
      <div><span class="flow-label">${icon('in', { size: 15 })}Money in</span><span class="flow-val num in">${fmt(sum.income, { whole: true })}</span></div>
      <div><span class="flow-label">${icon('out', { size: 15 })}Money out</span><span class="flow-val num">${fmt(sum.spent, { whole: true })}</span></div>
      <div><span class="flow-label">Net</span><span class="flow-val num ${sum.net >= 0 ? 'in' : 'neg'}">${sum.net >= 0 ? '+' : '−'}${fmt(Math.abs(sum.net), { whole: true })}</span></div>
    </section>

    ${reviewItems.length ? `<button class="review-row" type="button" data-act="review">
        <span class="row-icon" style="--tint:var(--warn)">${icon('tray', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${reviewItems.length} ${reviewItems.length === 1 ? 'payment needs' : 'payments need'} a category</span><span class="row-sub">Sort them in a couple of taps</span></span>
        ${icon('chevR', { size: 18, cls: 'chev' })}
      </button>` : ''}

    <h3 class="group-title">Accounts this cycle</h3>
    <section class="group">
      ${ACCOUNTS.map((a) => {
        const v = sum.byAccount.get(a.id) || { spent: 0, received: 0, count: 0 };
        const warn = a.id === s.emergencyAccount && emergency > 0;
        return `<div class="row acc-row">
          <span class="acc-tile" style="--tint:${a.color}">${icon(a.id === 'Cash' ? 'cash' : 'card', { size: 20 })}</span>
          <span class="row-main"><span class="row-title">${a.name}</span><span class="row-sub ${warn ? 'warn-text' : ''}">${warn ? `${icon('warn', { size: 13 })} Emergency card used` : a.role}</span></span>
          <span class="acc-figs num"><span>${fmt(v.spent, { whole: true })}</span>${v.received ? `<small class="in">+${fmt(v.received, { whole: true })}</small>` : '<small>spent</small>'}</span>
        </div>`;
      }).join('')}
    </section>

    <div class="group-head"><h3 class="group-title">Recent</h3>${state.entries.length ? '<button class="text-btn" type="button" data-go="activity">See all</button>' : ''}</div>
    <section class="group">
      ${recent.length ? recent.map(entryRow).join('') : `<div class="empty">${icon('card', { size: 28 })}<p>No entries yet.</p><p class="muted">Pay with Apple Pay or tap <b>+</b> to add one.</p></div>`}
    </section>`;
}

/* ───────────────────────── Activity ───────────────────────── */

function renderActivity() {
  return `
    ${largeTitle('Activity', `${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'}`, syncBadge())}
    ${demoBanner()}
    <div class="search">${icon('search', { size: 18 })}<input type="search" placeholder="Search merchant, note or category" value="${esc(activityFilter.q)}" aria-label="Search entries" enterkeyhint="search"></div>
    <div class="filter-chips" role="tablist" aria-label="Filter">
      ${[['all', 'All'], ['Spend', 'Spending'], ['Income', 'Income'], ['Transfer', 'Transfers'], ['review', 'Needs review']]
        .map(([k, l]) => `<button type="button" role="tab" class="fchip${activityFilter.kind === k ? ' on' : ''}" aria-selected="${activityFilter.kind === k}" data-kind="${k}">${l}</button>`).join('')}
    </div>
    <div class="activity-list">${activityList()}</div>`;
}

function activityList() {
  const q = activityFilter.q.trim().toLowerCase();
  const list = state.entries.filter((e) => {
    if (activityFilter.kind === 'review' && e.status !== 'Review') return false;
    if (['Spend', 'Income', 'Transfer'].includes(activityFilter.kind) && e.type !== activityFilter.kind) return false;
    if (q && ![e.merchant, e.note, e.category, e.account, e.toAccount, String(e.amount)].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).slice(0, 400);
  if (!list.length) return `<div class="empty">${icon('search', { size: 28 })}<p>${q ? `Nothing matches “${esc(activityFilter.q)}”.` : 'Nothing here yet.'}</p></div>`;
  const days = new Map();
  for (const e of list) { const k = dayKey(e.date); if (!days.has(k)) days.set(k, []); days.get(k).push(e); }
  return [...days].map(([k, items]) => {
    const spent = items.filter((e) => e.type === 'Spend').reduce((a, e) => a + toAED(e, state.settings), 0);
    return `<div class="group-head day"><h3 class="group-title">${dayLabel(k)}</h3>${spent ? `<span class="day-total num">AED ${fmt(spent, { fixed: true })}</span>` : ''}</div>
      <section class="group">${items.map(entryRow).join('')}</section>`;
  }).join('');
}

/* ───────────────────────── Insights ───────────────────────── */

function renderInsights() {
  const s = state.settings;
  const cyc = insightsCycle || currentCycle();
  const isCurrent = cyc === currentCycle();
  const sum = summarize(state.entries, cyc, s);

  const main = SPEND_CATEGORIES.filter((c) => c.slot);
  const otherTotal = ['Family & Gifts', 'Other', 'Uncategorised'].reduce((a, k) => a + (sum.byCategory.get(k) || 0), 0)
    + [...sum.byCategory].filter(([k]) => !SPEND_CATEGORIES.some((c) => c.id === k) && k !== 'Uncategorised').reduce((a, [, v]) => a + v, 0);
  const slices = [...main.map((c) => ({ label: c.short, value: sum.byCategory.get(c.id) || 0, color: seriesColor(c.slot) })), { label: 'Other', value: otherTotal, color: 'var(--series-other)' }];

  const legendRows = [...SPEND_CATEGORIES, { id: 'Uncategorised', short: 'Needs category', icon: 'tray', slot: 0 }]
    .map((c) => ({ c, v: sum.byCategory.get(c.id) || 0 }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v);

  // allowance pace
  const len = cycleLength(cyc, s.cycleStart);
  const { start } = cycleBounds(cyc, s.cycleStart);
  const today = isCurrent ? Math.min(len - 1, Math.floor((Date.now() - start) / 864e5)) : len - 1;
  const perDay = new Array(len).fill(0);
  for (const e of sum.entries) {
    if (e.type !== 'Spend' || e.account !== s.allowanceAccount) continue;
    const i = Math.min(len - 1, Math.max(0, Math.floor((new Date(e.date) - start) / 864e5)));
    perDay[i] += toAED(e, s);
  }
  let run = 0;
  const cumulative = perDay.map((v, i) => (i > today ? null : (run += v)));
  const pace = perDay.map((_, i) => (s.allowance * (i + 1)) / len);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const labels = perDay.map((_, i) => { const [y, m, d] = dayKey(new Date(start.getTime() + i * 864e5 + 6 * 3600e3)).split('-').map(Number); return `${d} ${MON[m - 1]}`; });
  const paceDelta = cumulative[today] - pace[today];

  // six cycles
  const six = Array.from({ length: 6 }, (_, i) => shiftCycle(cyc, i - 5)).map((c) => {
    const x = summarize(state.entries, c, s);
    return { label: cycleName(c, false).split(' ')[0], income: x.income, spent: x.spent, current: c === cyc };
  });

  const accMax = Math.max(1, ...ACCOUNTS.map((a) => sum.byAccount.get(a.id)?.spent || 0));

  return `
    ${largeTitle('Insights', '', '')}
    ${demoBanner()}
    <div class="cycle-switch glass">
      <button type="button" class="icon-btn" data-cyc="-1" aria-label="Previous cycle">${icon('chevL', { size: 20 })}</button>
      <div class="cs-label"><b>${cycleName(cyc, false)}</b><span>${cycleRange(cyc, s.cycleStart)}</span></div>
      <button type="button" class="icon-btn" data-cyc="1" aria-label="Next cycle" ${isCurrent ? 'disabled' : ''}>${icon('chevR', { size: 20 })}</button>
    </div>

    <section class="panel">
      <h3 class="panel-title">Where it went</h3>
      ${donut(slices, { total: sum.spent, centerLabel: 'Spent' })}
      <div class="legend">
        ${legendRows.length ? legendRows.map(({ c, v }) => `<div class="lg-row">
          <span class="lg-icon" style="--tint:${c.id === 'Uncategorised' ? 'var(--warn)' : seriesColor(c.slot)}">${icon(c.icon, { size: 16 })}</span>
          <span class="lg-name">${c.id === 'Uncategorised' ? 'Needs category' : c.id}</span>
          <span class="lg-bar"><i style="--w:${(v / Math.max(1, sum.spent)) * 100}%; --tint:${c.id === 'Uncategorised' ? 'var(--warn)' : seriesColor(c.slot)}"></i></span>
          <span class="lg-val num">${fmt(v, { whole: true })}</span>
          <span class="lg-pct num">${Math.round((v / Math.max(1, sum.spent)) * 100)}%</span>
        </div>`).join('') : '<p class="muted center">No spending in this cycle.</p>'}
      </div>
    </section>

    <section class="panel">
      <h3 class="panel-title">Allowance pace</h3>
      <p class="panel-sub">${esc(s.allowanceAccount)} spending, day by day, against an even spread of AED ${fmt(s.allowance, { whole: true })}.
        ${isCurrent && cumulative[today] != null ? `<b class="${paceDelta > 0 ? 'neg' : 'in'}">${paceDelta > 0 ? `AED ${fmt(paceDelta, { whole: true })} ahead of pace` : `AED ${fmt(-paceDelta, { whole: true })} under pace`}</b>` : ''}</p>
      <div class="series-legend"><span><i class="sw spend"></i>Spent so far</span><span><i class="sw pace"></i>Even pace</span></div>
      ${paceLine({ days: len, cumulative, pace, todayIndex: today, labels })}
    </section>

    <section class="panel">
      <h3 class="panel-title">By account</h3>
      <div class="hbars">
        ${ACCOUNTS.map((a) => { const v = sum.byAccount.get(a.id)?.spent || 0; return `<div class="hb-row">
          <span class="hb-name">${a.name}</span>
          <span class="hb-track"><i style="--w:${(v / accMax) * 100}%; --tint:${a.color}"></i></span>
          <span class="hb-val num">${fmt(v, { whole: true })}</span></div>`; }).join('')}
      </div>
    </section>

    <section class="panel">
      <h3 class="panel-title">Money in</h3>
      ${sum.byIncome.size ? `<div class="hbars">${[...sum.byIncome].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hb-row">
          <span class="hb-name">${esc(k)}</span>
          <span class="hb-track"><i style="--w:${(v / Math.max(1, sum.income)) * 100}%; --tint:var(--good)"></i></span>
          <span class="hb-val num">${fmt(v, { whole: true })}</span></div>`).join('')}</div>` : '<p class="muted">No income logged in this cycle.</p>'}
    </section>

    <section class="panel">
      <h3 class="panel-title">Last six cycles</h3>
      <div class="series-legend"><span><i class="sw in"></i>Money in</span><span><i class="sw out"></i>Money out</span></div>
      ${inOutBars(six)}
    </section>`;
}

/* ───────────────────────── Settings ───────────────────────── */

function renderSettings() {
  const s = state.settings, c = state.conn;
  const syncedAgo = state.sync.at ? relTime(state.sync.at) : 'never';
  return `
    ${largeTitle('Settings')}
    <h3 class="group-title">Google Sheet</h3>
    <section class="group form">
      <div class="row status-row">
        <span class="row-icon" style="--tint:${isConnected() ? 'var(--good)' : 'var(--label-3)'}">${icon('sheet', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${isConnected() ? 'Connected' : 'Not connected'}</span>
          <span class="row-sub">${isConnected() ? (state.sync.status === 'error' ? `<span class="warn-text">${esc(state.sync.error)}</span>` : `Last synced ${syncedAgo}${state.outbox.length ? ` · ${state.outbox.length} waiting` : ''}`) : 'Paste the Web app URL and app key from your sheet'}</span></span>
      </div>
      <label class="row input-row"><span>Web app URL</span><input name="url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="row input-row"><span>App key</span><input name="token" type="text" placeholder="From Spendings → Show my app key" value="${esc(c.token)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="row btn-row">
        <button type="button" class="btn-tinted" data-act="connect">${icon('link', { size: 18 })}Connect</button>
        <button type="button" class="btn-tinted" data-act="sync" ${isConnected() ? '' : 'disabled'}>${icon('sync', { size: 18 })}Sync now</button>
      </div>
      ${state.sheetUrl ? `<a class="row link-row" href="${esc(state.sheetUrl)}" target="_blank" rel="noopener">${icon('sheet', { size: 20 })}<span>Open the sheet</span>${icon('chevR', { size: 16, cls: 'chev' })}</a>` : ''}
    </section>
    <p class="group-foot">The app key is like a password for your sheet. It stays on this phone and in your Shortcut, never in the app’s code.</p>

    <h3 class="group-title">Apple Pay</h3>
    <section class="group">
      <button type="button" class="row link-row" data-act="shortcut">
        <span class="row-icon" style="--tint:var(--tint-text)">${icon('bell', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Log Apple Pay payments</span><span class="row-sub">Set up the Shortcut · 5 min</span></span>
        ${icon('chevR', { size: 16, cls: 'chev' })}
      </button>
    </section>

    <h3 class="group-title">Budget</h3>
    <section class="group form">
      <label class="row input-row"><span>Allowance per cycle</span><span class="suffix-input"><em>AED</em><input name="allowance" type="number" inputmode="decimal" min="0" step="50" value="${s.allowance}"></span></label>
      <label class="row input-row"><span>Allowance card</span><select name="allowanceAccount">${ACCOUNTS.map((a) => `<option ${a.id === s.allowanceAccount ? 'selected' : ''}>${a.id}</option>`).join('')}</select></label>
      <label class="row input-row"><span>Emergency card</span><select name="emergencyAccount">${ACCOUNTS.map((a) => `<option ${a.id === s.emergencyAccount ? 'selected' : ''}>${a.id}</option>`).join('')}</select></label>
      <label class="row input-row"><span>Cycle starts on the</span><select name="cycleStart">${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === s.cycleStart ? 'selected' : ''}>${ordinal(d)}</option>`).join('')}</select></label>
      <label class="row input-row"><span>USD → AED</span><input name="usdRate" type="number" inputmode="decimal" step="0.0001" min="0" value="${s.usdRate}"></label>
    </section>

    <h3 class="group-title">Privacy</h3>
    <section class="group">
      <label class="row toggle-row"><span class="row-icon" style="--tint:var(--good)">${icon('faceid', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Lock with Face ID</span><span class="row-sub">Asks when you open the app</span></span>
        <input type="checkbox" switch class="switch" name="lock" ${state.prefs.lock ? 'checked' : ''}></label>
    </section>

    <h3 class="group-title">Data</h3>
    <section class="group">
      <button type="button" class="row link-row" data-act="export"><span class="row-icon" style="--tint:var(--tint-text)">${icon('download', { size: 20 })}</span><span class="row-main"><span class="row-title">Export CSV</span><span class="row-sub">Every entry, for backup</span></span></button>
      <label class="row toggle-row"><span class="row-icon" style="--tint:var(--series-7)">${icon('sparkle', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Demo data</span><span class="row-sub">Look around with made-up numbers</span></span>
        <input type="checkbox" switch class="switch" name="demo" ${isDemo() ? 'checked' : ''}></label>
    </section>
    <p class="group-foot center">Spendings · your data lives in your own Google Sheet.</p>`;
}

const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
function relTime(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ───────────────────────── Review sheet ───────────────────────── */

function openReview() {
  const items = () => state.entries.filter((e) => e.status === 'Review');
  const body = () => {
    const list = items();
    if (!list.length) return `<div class="empty">${icon('check', { size: 30 })}<p>All sorted.</p></div>`;
    return list.map((e) => `<article class="review-card" data-id="${esc(e.id)}">
      <div class="rc-head"><div><b>${esc(e.merchant || 'Unknown merchant')}</b><span>${esc(accountMeta(e.account).name)} · ${dayLabel(dayKey(e.date))}, ${timeLabel(e.date)}</span></div>
      <span class="num rc-amt">${e.currency === 'USD' ? '$' : 'AED '}${fmt(e.amount, { fixed: true })}</span></div>
      <div class="rc-cats">${(e.type === 'Income' ? INCOME_CATEGORIES : SPEND_CATEGORIES).map((c) => `<button type="button" class="rc-cat" data-cat="${esc(c.id)}" style="--cat:${e.type === 'Income' ? 'var(--good)' : seriesColor(c.slot)}">${icon(c.icon, { size: 16 })}${c.short}</button>`).join('')}</div>
    </article>`).join('');
  };
  openSheet({
    label: 'Needs review',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">Needs review</h2><button class="text-btn strong" data-act="done" type="button">Done</button></header>
      <p class="sheet-lede">Tap a category to file each payment. Next time the same merchant is filed automatically.</p>
      <div class="sheet-scroll review-list">${body()}</div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        const b = ev.target.closest('.rc-cat');
        if (!b) return;
        const card = b.closest('.review-card');
        haptic();
        updateEntry(card.dataset.id, { category: b.dataset.cat });
        b.classList.add('on');
        const h = card.offsetHeight;
        const done = () => { sheet.querySelector('.review-list').innerHTML = body(); };
        if (reduceMotion()) return done();
        card.animate([{ opacity: 1, height: `${h}px`, transform: 'none' }, { opacity: 0, height: '0px', marginBlock: '0', paddingBlock: '0', transform: 'translateX(40px)' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).onfinish = done;
      });
    },
  });
}

/* ───────────────────────── Shortcut guide ───────────────────────── */

function openShortcutGuide() {
  const url = state.conn.url || 'your Web app URL (see Settings)';
  const key = state.conn.token || 'your app key';
  const cats = [...SPEND_CATEGORIES.map((c) => c.id), 'Decide later'];
  const copy = (label, value) => `<div class="copy-row"><div><span>${label}</span><code>${esc(value)}</code></div><button type="button" class="icon-btn" data-copy="${esc(value)}" aria-label="Copy ${label}">${icon('copy', { size: 18 })}</button></div>`;
  openSheet({
    label: 'Apple Pay Shortcut',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">Apple Pay Shortcut</h2><button class="text-btn strong" data-act="done" type="button">Done</button></header>
    <div class="sheet-scroll guide">
      <p class="sheet-lede">After every Apple Pay payment, your iPhone asks for a category and saves the payment straight to your sheet. You don’t need to open the app.</p>
      ${copy('Web app URL', url)}
      ${copy('App key', key)}
      <ol class="steps">
        <li><b>Open Shortcuts → Automation → New Automation</b> (the <b>+</b> button) and choose <b>Transaction</b>.</li>
        <li>Under <b>Cards</b>, pick <b>ADIB</b>, <b>ADCB</b> and <b>BOTIM</b>. Leave all categories on. Choose <b>Run Immediately</b> and turn <b>off</b> “Notify When Run”. Tap <b>Next</b> → <b>Create New Shortcut</b>.</li>
        <li>Add <b>Choose from List</b>. For the list, tap it and type these items, one per line:<div class="cat-list">${cats.map((c) => `<code>${esc(c)}</code>`).join('')}</div>Set the prompt to <b>What was it for?</b>.</li>
        <li>Add <b>Get Contents of URL</b>. Set the URL to your <b>Web app URL</b>. Tap <b>Show More</b>: Method <b>POST</b>, Request Body <b>JSON</b>, then add these fields (all <b>Text</b>):
          <table class="fields"><tr><td>token</td><td>your app key</td></tr><tr><td>source</td><td><code>applepay</code></td></tr><tr><td>amount</td><td>Shortcut Input → <b>Amount</b></td></tr><tr><td>merchant</td><td>Shortcut Input → <b>Merchant</b></td></tr><tr><td>card</td><td>Shortcut Input → <b>Card</b> (or <b>Name</b>)</td></tr><tr><td>category</td><td><b>Chosen Item</b></td></tr></table></li>
        <li>Add <b>Get Dictionary Value</b>: get <b>Value</b> for key <code>message</code> in <b>Contents of URL</b>.</li>
        <li>Add <b>Show Notification</b> with <b>Dictionary Value</b> as the text. Done ✓</li>
      </ol>
      <div class="tip-card">${icon('sparkle', { size: 18 })}<p><b>Want it zero-tap?</b> Skip step 3 and send <code>Decide later</code> as the category. Merchants you’ve filed before are categorised automatically. The rest wait in <b>Needs review</b>.</p></div>
      <div class="tip-card">${icon('warn', { size: 18 })}<p>If you pay with no signal, the Shortcut can’t reach the sheet and shows an error. Add that payment with <b>+</b> later.</p></div>
    </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        const b = ev.target.closest('[data-copy]');
        if (!b) return;
        try { await navigator.clipboard.writeText(b.dataset.copy); haptic(); toast('Copied', { icon: icon('check', { size: 18 }), tone: 'good' }); } catch { toast('Couldn’t copy. Press and hold the text instead.'); }
      });
    },
  });
}

/* ───────────────────────── Router & render ───────────────────────── */

const RENDER = { home: renderHome, activity: renderActivity, insights: renderInsights, settings: renderSettings };

function render(reason) {
  // keep typing undisturbed in settings and search
  if (reason && tab === 'settings' && view.contains(document.activeElement) && document.activeElement.matches('input, select')) {
    const b = view.querySelector('.large-title .lt-right'); if (b) b.innerHTML = '';
    return;
  }
  if (reason && tab === 'activity' && document.activeElement?.matches('.search input')) {
    view.querySelector('.activity-list').innerHTML = activityList();
    return;
  }
  const prevCap = view.querySelector('.capsule');
  const prevLevel = prevCap ? +getComputedStyle(prevCap).getPropertyValue('--level') : null;
  const prevVal = prevCap?.querySelector('.cap-value')?.dataset.value;
  view.innerHTML = RENDER[tab]();
  view.dataset.tab = tab;
  bindDonut(view);
  bindPace(view);
  observeTitle();
  // the signature move: liquid springs to the new level, numerals roll
  const cap = view.querySelector('.capsule');
  if (cap && prevLevel != null) {
    const level = +cap.style.getPropertyValue('--level');
    const liquid = cap.querySelector('.liquid');
    if (Math.abs(level - prevLevel) > 0.0005 && !reduceMotion()) {
      const sp = spring(0.7, 0.9);
      liquid.animate([{ transform: `translateY(${(1 - prevLevel) * 100}%)` }, { transform: `translateY(${(1 - level) * 100}%)` }], { duration: sp.duration, easing: sp.easing });
    }
    const v = cap.querySelector('.cap-value');
    const target = +v.dataset.value;
    if (prevVal != null) {
      v.dataset.value = prevVal;
      rollNumber(v, target, (n) => `AED ${fmt(n, { whole: true })}`);
    }
  }
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  moveDroplet();
}

function go(next) {
  if (!TABS.includes(next)) return;
  if (next === tab) { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
  tab = next;
  history.replaceState(null, '', `#${tab}`);
  const swap = () => { render(); window.scrollTo(0, 0); };
  if (document.startViewTransition && !reduceMotion()) document.startViewTransition(swap);
  else swap();
}

/* Glass droplet that slides between tabs on a spring. */
let dropAnim = null;
function moveDroplet() {
  const bar = document.querySelector('.tabbar'), drop = bar.querySelector('.droplet'), btn = bar.querySelector(`[data-tab="${tab}"]`);
  if (!btn) return;
  const x = btn.offsetLeft, w = btn.offsetWidth;
  const from = drop.style.transform, fromW = drop.style.width;
  drop.style.width = `${w}px`;
  drop.style.transform = `translateX(${x}px)`;
  if (from && from !== drop.style.transform && !reduceMotion()) {
    dropAnim?.cancel();
    const sp = spring(0.75, 0.42);
    dropAnim = drop.animate([{ transform: from, width: fromW }, { transform: `translateX(${x}px) scaleY(1.08)`, width: `${w}px`, offset: 0.35 }, { transform: `translateX(${x}px)`, width: `${w}px` }], { duration: sp.duration, easing: sp.easing });
  }
}

/* Compact glass nav bar appears once the large title scrolls away (iOS behaviour). */
let titleObs;
function observeTitle() {
  const nav = document.getElementById('navbar');
  const h1 = view.querySelector('.large-title h1');
  nav.querySelector('.nav-title').textContent = h1?.textContent || '';
  titleObs?.disconnect();
  if (!h1) return;
  titleObs = new IntersectionObserver(([en]) => nav.classList.toggle('show', !en.isIntersecting), { rootMargin: '-44px 0px 0px 0px' });
  titleObs.observe(h1);
}

/* ───────────────────────── Events ───────────────────────── */

document.addEventListener('click', async (ev) => {
  const t = ev.target;
  const goBtn = t.closest('[data-go]');
  if (goBtn) { haptic(); return go(goBtn.dataset.go); }
  const tabBtn = t.closest('.tabbar [data-tab]');
  if (tabBtn) { haptic(); return go(tabBtn.dataset.tab); }
  if (t.closest('.fab')) { haptic(); return openEntry(); }
  const row = t.closest('.entry[data-id]');
  if (row && view.contains(row)) { const e = state.entries.find((x) => x.id === row.dataset.id); if (e) openEntry(e); return; }
  const kind = t.closest('[data-kind]');
  if (kind) { activityFilter.kind = kind.dataset.kind; haptic(); return render(); }
  const cyc = t.closest('[data-cyc]');
  if (cyc) { insightsCycle = shiftCycle(insightsCycle || currentCycle(), +cyc.dataset.cyc); if (insightsCycle === currentCycle()) insightsCycle = null; haptic(); return render(); }
  const act = t.closest('[data-act]')?.dataset.act;
  if (!act || !view.contains(t)) return;
  if (act === 'sync') { haptic(); await sync(); if (state.sync.status === 'error') toast(state.sync.error, { icon: icon('warn', { size: 18 }), tone: 'warn' }); }
  if (act === 'review') openReview();
  if (act === 'shortcut') openShortcutGuide();
  if (act === 'demo') { setDemo(true); toast('Showing demo data', { icon: icon('sparkle', { size: 18 }) }); }
  if (act === 'exit-demo') { setDemo(false); render(); }
  if (act === 'export') exportCSV();
  if (act === 'connect') connect(t.closest('[data-act]'));
});

async function connect(btn) {
  const url = view.querySelector('input[name="url"]').value.trim();
  const token = view.querySelector('input[name="token"]').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('That doesn’t look like a Web app URL. It starts with https://script.google.com/', { icon: icon('warn', { size: 18 }), tone: 'warn' }); return; }
  if (!token) { toast('Paste your app key too', { icon: icon('warn', { size: 18 }), tone: 'warn' }); return; }
  btn.disabled = true; btn.classList.add('busy');
  try {
    const r = await ping(url, token);
    setConnection(url, token);
    if (isDemo()) setDemo(false);
    toast(r.message || 'Connected', { icon: icon('check', { size: 18 }), tone: 'good' });
    await sync();
    render();
  } catch (e) {
    toast(e.message, { icon: icon('warn', { size: 18 }), tone: 'warn' });
  } finally { btn.disabled = false; btn.classList.remove('busy'); }
}

function exportCSV() {
  const blob = new Blob([toCSV(state.entries)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spendings-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

view.addEventListener('input', (ev) => {
  if (ev.target.matches('.search input')) { activityFilter.q = ev.target.value; view.querySelector('.activity-list').innerHTML = activityList(); }
});

view.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (tab !== 'settings') return;
  if (['allowance', 'usdRate'].includes(el.name)) { const v = parseFloat(el.value); if (v > 0) saveSettings({ [el.name]: v }); }
  if (['allowanceAccount', 'emergencyAccount'].includes(el.name)) saveSettings({ [el.name]: el.value });
  if (el.name === 'cycleStart') saveSettings({ cycleStart: +el.value });
  if (el.name === 'demo') { setDemo(el.checked); haptic(); render(); }
  if (el.name === 'lock') {
    haptic();
    if (el.checked) {
      if (!(await lockSupported())) { el.checked = false; toast('Face ID isn’t available in this browser. Open the app from your Home Screen.', { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
      try { await enableLock(); toast('Face ID lock is on', { icon: icon('faceid', { size: 18 }), tone: 'good' }); } catch { el.checked = false; toast('Face ID wasn’t set up', { tone: 'warn', icon: icon('warn', { size: 18 }) }); }
    } else disableLock();
  }
});

subscribe((reason) => { if (reason !== 'prefs') render(reason); });
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('resize', () => moveDroplet());

/* Deep link: #add?amount=42&merchant=Carrefour&card=ADCB opens a pre-filled entry. */
function handleDeepLink() {
  const m = /^#add\??(.*)$/.exec(location.hash);
  if (!m) return;
  const p = new URLSearchParams(m[1]);
  const card = (p.get('card') || '').toLowerCase();
  const account = ACCOUNTS.find((a) => card.includes(a.id.toLowerCase()))?.id;
  const num = parseFloat((p.get('amount') || '').replace(/[^\d.]/g, ''));
  tab = 'home';
  history.replaceState(null, '', '#home');
  render();
  openEntry(null, { amount: num || 0, merchant: p.get('merchant') || '', ...(account ? { account } : {}), currency: /\$|usd/i.test(p.get('amount') || '') ? 'USD' : 'AED' });
}

render();
initLock();
handleDeepLink();
sync();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
