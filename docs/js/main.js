import {
  ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, categoryMeta, seriesColor, accountMeta, cycleOf, shiftCycle,
  cycleName, cycleRange, daysLeft, cycleLength, cycleBounds, summarize, money, fmt, fmtCompact, dayKey, dayLabel, timeLabel, toAED, toCSV,
} from './model.js';
import {
  state, subscribe, sync, isConnected, isDemo, setConnection, ping, updateEntry, deleteEntry, restoreEntry, saveSettings, setDemo, setPrefs, undo, canUndo, lastAction, resetAll,
} from './store.js';
import { openEntry } from './entry.js';
import { openSheet, toast, haptic, esc, spring, reduceMotion, rollNumber } from './ui.js';
import { icon } from './icons.js';
import { donut, bindDonut, paceLine, bindPace, inOutBars } from './charts.js';
import { initLock, lockSupported, enableLock, disableLock } from './lock.js';
import { ACCENTS, CARD_COLORS, DEFAULT_APPEARANCE, normalizeAppearance, applyAppearance } from './theme.js';
import { accountsSettingsBlock, accountsClick, openAccount } from './accounts.js';
import { renderHome, snapshotHome, afterHomeRender, bindHomeGestures, homeClick, planSettingsBlock, stepFocus } from './home.js';

const view = document.getElementById('view');
const TABS = ['home', 'activity', 'insights', 'settings'];
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
let insightsCycle = null;
let activityFilter = { q: '', kind: 'all' };
const currentCycle = () => cycleOf(new Date(), state.settings.cycleStart);

/* ───────────────────────── Shared bits ───────────────────────── */

function entryRow(e) {
  if (e.type === 'Adjustment') {
    const v = +e.amount || 0;
    return `<div class="swipe" data-id="${esc(e.id)}"><button class="swipe-del" type="button" tabindex="-1" aria-hidden="true">${icon('trash', { size: 20 })}<span>Delete</span></button><button class="row entry adj" type="button" data-id="${esc(e.id)}">
    <span class="row-icon" style="--tint:${accountMeta(e.account).color}">${icon('sync', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">Checked with bank</span><span class="row-sub">${esc(e.account)} · ${timeLabel(e.date)}</span></span>
    <span class="row-amt num tr">${v === 0 ? '✓ matched' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), { fixed: true })}`}</span>
  </button></div>`;
  }
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
  return `<div class="swipe" data-id="${esc(e.id)}"><button class="swipe-del" type="button" tabindex="-1" aria-hidden="true">${icon('trash', { size: 20 })}<span>Delete</span></button><button class="row entry${e.status === 'Review' ? ' review' : ''}" type="button" data-id="${esc(e.id)}">
    <span class="row-icon" style="--tint:${tint}">${icon(ic, { size: 20 })}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${bits.join(' · ')}${e.note ? ` · <span class="row-note">${esc(e.note)}</span>` : ''}</span></span>
    <span class="row-amt num ${isIn ? 'in' : isTr ? 'tr' : ''}">${amt}${e.currency === 'USD' ? `<small>≈ AED ${fmt(toAED(e, state.settings), { fixed: true })}</small>` : ''}</span>
  </button></div>`;
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
  return `<header class="large-title"><div><h1>${title}</h1>${sub ? `<p class="lt-sub">${sub}</p>` : ''}</div><div class="lt-right"><span class="undo-slot">${undoButton()}</span>${right}</div></header>`;
}
function undoButton() {
  return canUndo() ? `<button type="button" class="undo-btn" data-act="undo" aria-label="Undo: ${esc(lastAction())}" title="Undo: ${esc(lastAction())} (⌘Z)">${icon('undo', { size: 18 })}</button>` : '';
}
function doUndo() {
  if (!canUndo()) return;
  haptic();
  const label = undo();
  toast(`Undone · ${esc(label)}`, { icon: icon('undo', { size: 18 }) });
}

function demoBanner() {
  return isDemo() ? `<div class="banner demo-banner">${icon('sparkle', { size: 18 })}<span><b>Demo data.</b> Made-up numbers so you can look around.</span><button type="button" class="text-btn" data-act="exit-demo">Exit</button></div>` : '';
}

/* ───────────────────────── Home ───────────────────────── */

/* Frequent purchases from the last 60 days, one tap to log again. */
function quickAdd() {
  const since = Date.now() - 60 * 864e5;
  const groups = new Map();
  for (const e of state.entries) {
    if (e.type !== 'Spend' || !e.merchant || !e.category || new Date(e.date) < since) continue;
    const k = `${e.merchant.toLowerCase()}|${e.category}|${e.account}`;
    const g = groups.get(k);
    if (g) g.n++; else groups.set(k, { n: 1, e });
  }
  const top = [...groups.values()].filter((g) => g.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6);
  if (!top.length) return '';
  return `<h3 class="group-title">Quick add</h3>
    <div class="quick" role="list">
      ${top.map(({ e }) => {
        const m = categoryMeta(e.category);
        return `<button type="button" class="quick-chip" role="listitem" data-quick="${esc(e.id)}" style="--tint:${m ? seriesColor(m.slot) : 'var(--label-2)'}">
          <span class="qc-icon">${icon(m ? m.icon : 'dots', { size: 18 })}</span>
          <span class="qc-text"><b>${esc(e.merchant)}</b><span>${e.currency === 'USD' ? '$' : 'AED '}${fmt(e.amount)} · ${esc(e.account)}</span></span>
        </button>`;
      }).join('')}
    </div>`;
}

/* ───────────────────────── Activity ───────────────────────── */

function renderActivity() {
  return `
    ${largeTitle('Activity', `${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'}`, syncBadge())}
    ${demoBanner()}
    <div class="search">${icon('search', { size: 18 })}<input type="search" placeholder="Search" value="${esc(activityFilter.q)}" aria-label="Search entries" enterkeyhint="search"></div>
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
  const sum = summarize(state.entries, cyc, s, state.plan);

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
    // a refund into the allowance account gives that money back on the day it lands
    const refund = e.type === 'Income' && e.category === 'Refund';
    if ((e.type !== 'Spend' && !refund) || e.account !== s.allowanceAccount) continue;
    const i = Math.min(len - 1, Math.max(0, Math.floor((new Date(e.date) - start) / 864e5)));
    perDay[i] += refund ? -toAED(e, s) : toAED(e, s);
  }
  let run = 0;
  const cumulative = perDay.map((v, i) => (i > today ? null : (run += v)));
  const pace = perDay.map((_, i) => (sum.allowancePot * (i + 1)) / len);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const labels = perDay.map((_, i) => { const [y, m, d] = dayKey(new Date(start.getTime() + i * 864e5 + 6 * 3600e3)).split('-').map(Number); return `${d} ${MON[m - 1]}`; });
  const paceDelta = cumulative[today] - pace[today];

  // six cycles
  const six = Array.from({ length: 6 }, (_, i) => shiftCycle(cyc, i - 5)).map((c) => {
    const x = summarize(state.entries, c, s, state.plan);
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
      <p class="panel-sub">${esc(s.allowanceAccount)} spending, day by day, against an even spread of AED ${fmt(sum.allowancePot, { whole: true })}.
        ${isCurrent && cumulative[today] != null ? `<b class="${paceDelta > 0 ? 'pace-bad' : 'pace-good'}">${paceDelta > 0 ? `AED ${fmt(paceDelta, { whole: true })} over pace` : `On track · AED ${fmt(-paceDelta, { whole: true })} under pace`}</b>` : ''}</p>
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
      ${isConnected() ? '<details class="conn-details"><summary class="row link-row"><span class="row-main"><span class="row-title">Connection details</span></span>' + icon('chevD', { size: 16, cls: 'chev' }) + '</summary>' : ''}
      <label class="row input-row"><span>Web app URL</span><input name="url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="row input-row"><span>App key</span><input name="token" type="text" placeholder="From Spendings → Show my app key" value="${esc(c.token)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="row btn-row">
        <button type="button" class="btn-tinted" data-act="connect">${icon('link', { size: 18 })}Connect</button>
        <button type="button" class="btn-tinted" data-act="sync" ${isConnected() ? '' : 'disabled'}>${icon('sync', { size: 18 })}Sync now</button>
      </div>
      ${isConnected() ? '</details>' : ''}
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

    <h3 class="group-title">Appearance</h3>
    <section class="group appearance">
      ${appearanceBlock()}
    </section>

    <h3 class="group-title" id="accounts">Accounts</h3>
    <section class="group">${accountsSettingsBlock()}</section>
    <p class="group-foot">Rename, recolour or remove an account. A new name follows through every past entry and your sheet.</p>

    <h3 class="group-title" id="plan">Payday plan</h3>
    <section class="group plan-settings">${planSettingsBlock()}</section>
    <p class="group-foot">Salary and Nafis wait for your “It landed” tap, so your total never runs ahead of the bank.</p>

    <h3 class="group-title">Budget</h3>
    <section class="group form">
      <button type="button" class="row link-row" data-go="settings" data-anchor="plan"><span class="row-main"><span class="row-title">Allowance per cycle</span><span class="row-sub">Set by the allowance move in your payday plan</span></span><b class="num">${fmt(s.allowance, { whole: true })}</b>${icon('chevR', { size: 16, cls: 'chev' })}</button>
      <label class="row input-row"><span>Allowance card</span><select name="allowanceAccount">${ACCOUNTS.map((a) => `<option ${a.id === s.allowanceAccount ? 'selected' : ''}>${a.id}</option>`).join('')}</select></label>
      <label class="row input-row"><span>Main account (pay lands)</span><select name="emergencyAccount">${ACCOUNTS.map((a) => `<option ${a.id === s.emergencyAccount ? 'selected' : ''}>${a.id}</option>`).join('')}</select></label>
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
      <button type="button" class="row link-row" data-act="reset"><span class="row-icon" style="--tint:var(--neg)">${icon('trash', { size: 20 })}</span><span class="row-main"><span class="row-title danger-text">Reset sheet</span><span class="row-sub">Erase every entry and start fresh</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>
      <button type="button" class="row link-row" data-act="export"><span class="row-icon" style="--tint:var(--tint-text)">${icon('download', { size: 20 })}</span><span class="row-main"><span class="row-title">Export CSV</span><span class="row-sub">Every entry, for backup</span></span></button>
      <label class="row toggle-row"><span class="row-icon" style="--tint:var(--series-7)">${icon('sparkle', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Demo data</span><span class="row-sub">Look around with made-up numbers</span></span>
        <input type="checkbox" switch class="switch" name="demo" ${isDemo() ? 'checked' : ''}></label>
    </section>
    <p class="group-foot center">Spendings · your data lives in your own Google Sheet.</p>`;
}


function appearanceBlock() {
  const a = normalizeAppearance(state.prefs.appearance);
  const acc = ACCENTS.find((x) => x.id === a.accent);
  const changed = a.theme !== DEFAULT_APPEARANCE.theme || a.accent !== DEFAULT_APPEARANCE.accent;
  return `
    <div class="ap-label">Theme</div>
    <div class="theme-seg" role="radiogroup" aria-label="Theme">
      ${[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${a.theme === k}" data-theme-mode="${k}">${l}</button>`).join('')}
    </div>
    <div class="ap-label">Accent <b>${acc.name}</b></div>
    <div class="swatches" role="radiogroup" aria-label="Accent colour">
      ${ACCENTS.map((x) => `<button type="button" role="radio" class="swatch accent-swatch" aria-checked="${x.id === a.accent}" aria-label="${x.name}" data-accent="${x.id}" style="--sw:${x.l[0]}; --sw-top:${x.l[3]}">${icon('check', { size: 16 })}</button>`).join('')}
    </div>
    <p class="group-foot" style="padding:0">Used for buttons, the tab bar and the allowance liquid.</p>
    ${changed ? '<button type="button" class="text-btn reset-btn" data-act="reset-look">Reset colours</button>' : ''}`;
}

function setAppearance(patch) {
  const a = normalizeAppearance(state.prefs.appearance);
  const next = { ...a, ...patch, cards: { ...a.cards, ...(patch.cards || {}) } };
  setPrefs({ appearance: next });
  applyAppearance(next);
  haptic();
  render();
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

const RENDER = {
  home: () => renderHome({ largeTitle, syncBadge, demoBanner, quickAdd, entryRow }),
  activity: renderActivity, insights: renderInsights, settings: renderSettings,
};

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
  const snap = tab === 'home' && view.dataset.tab === 'home' ? snapshotHome() : null;
  view.innerHTML = RENDER[tab]();
  if (tab === 'home') afterHomeRender(snap);
  animateFresh();
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
      const unit = v.dataset.unit;
      rollNumber(v, target, (n) => (unit === 'pct' ? `${Math.round(n)}%` : `AED ${fmt(n, { whole: true })}`));
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
  const t = document.getElementById('toast');
  if (!t.hidden) { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }
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

/* Large title hands over to the compact glass bar continuously as you scroll (iOS behaviour). */
function observeTitle() {
  const nav = document.getElementById('navbar');
  const h1 = view.querySelector('.large-title h1');
  nav.querySelector('.nav-title').textContent = h1?.textContent || '';
  scrollChrome();
}
let chromeTick = false;
function scrollChrome() {
  const nav = document.getElementById('navbar'), h1 = view.querySelector('.large-title h1');
  const p = Math.min(1, Math.max(0, (window.scrollY - 24) / 36));
  nav.style.opacity = p;
  nav.style.transform = `translateY(${(p - 1) * 4}px)`;
  nav.classList.toggle('show', p > 0.5);
  if (h1) { h1.style.opacity = 1 - p; h1.style.transform = `translateY(${-p * 8}px) scale(${1 - p * 0.05})`; }
}
window.addEventListener('scroll', () => {
  if (chromeTick) return;
  chromeTick = true;
  requestAnimationFrame(() => { chromeTick = false; scrollChrome(); });
}, { passive: true });

/* ───────────────────────── Events ───────────────────────── */

document.addEventListener('click', async (ev) => {
  const t = ev.target;
  if (view.contains(t) && (homeClick(t) || accountsClick(t))) return;
  const goBtn = t.closest('[data-go]');
  if (goBtn) {
    haptic(); go(goBtn.dataset.go);
    if (goBtn.dataset.anchor) setTimeout(() => document.getElementById(goBtn.dataset.anchor)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }), 260);
    return;
  }
  const tabBtn = t.closest('.tabbar [data-tab]');
  if (tabBtn) { haptic(); return go(tabBtn.dataset.tab); }
  if (t.closest('.fab')) { haptic(); return openEntry(); }
  const quick = t.closest('[data-quick]');
  if (quick) {
    const e = state.entries.find((x) => x.id === quick.dataset.quick);
    haptic();
    if (e) openEntry(null, { type: 'Spend', amount: e.amount, currency: e.currency, account: e.account, category: e.category, merchant: e.merchant });
    return;
  }
  const del = t.closest('.swipe-del');
  if (del) { swipeDelete(del.closest('.swipe')); return; }
  if (openSwipe && !t.closest('.swipe.open')) { closeSwipe(); return; }
  const row = t.closest('.entry[data-id]');
  if (row && view.contains(row) && openSwipe) { closeSwipe(); return; }
  if (row && view.contains(row)) {
    const e = state.entries.find((x) => x.id === row.dataset.id);
    if (e?.type === 'Adjustment') toast('Swipe left to remove a bank match', { icon: icon('sync', { size: 18 }) });
    else if (e) openEntry(e);
    return;
  }
  const kind = t.closest('[data-kind]');
  if (kind) { activityFilter.kind = kind.dataset.kind; haptic(); return render(); }
  const cyc = t.closest('[data-cyc]');
  if (cyc) { insightsCycle = shiftCycle(insightsCycle || currentCycle(), +cyc.dataset.cyc); if (insightsCycle === currentCycle()) insightsCycle = null; haptic(); return render(); }
  const mode = t.closest('[data-theme-mode]');
  if (mode) return setAppearance({ theme: mode.dataset.themeMode });
  const accent = t.closest('[data-accent]');
  if (accent) return setAppearance({ accent: accent.dataset.accent });
  const act = t.closest('[data-act]')?.dataset.act;
  if (!act || !view.contains(t)) return;
  if (act === 'reset-look') return setAppearance({ ...DEFAULT_APPEARANCE });
  if (act === 'sync') { haptic(); await sync(); if (state.sync.status === 'error') toast(state.sync.error, { icon: icon('warn', { size: 18 }), tone: 'warn' }); }
  if (act === 'review') openReview();
  if (act === 'shortcut') openShortcutGuide();
  if (act === 'demo') { setDemo(true); toast('Showing demo data', { icon: icon('sparkle', { size: 18 }) }); }
  if (act === 'exit-demo') { setDemo(false); render(); }
  if (act === 'export') exportCSV();
  if (act === 'undo') doUndo();
  if (act === 'reset') openReset();
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

/* Press and hold to confirm: a slip of the finger can't erase anything. */
function openReset() {
  const n = state.entries.length;
  openSheet({
    label: 'Reset sheet', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Reset sheet</h2><span class="icon-btn-spacer"></span></header>
      <div class="reset-body">
        <div class="reset-icon">${icon('trash', { size: 28 })}</div>
        <p class="reset-lede">This erases <b>${n} ${n === 1 ? 'entry' : 'entries'}</b>, the merchants the app learned, and the month tabs.</p>
        <ul class="reset-keep">
          <li>${icon('check', { size: 16 })}Your accounts, payday plan and settings stay.</li>
          <li>${icon('check', { size: 16 })}${isConnected() && !isDemo() ? 'The sheet saves a hidden backup tab first, so nothing is truly lost.' : 'Export a CSV first if you want a copy.'}</li>
        </ul>
        <button type="button" class="hold-btn" data-hold><span class="hold-fill" aria-hidden="true"></span><span class="hold-label">Hold to erase everything</span></button>
      </div>`,
    onMount(sheet, close) {
      sheet.querySelector('[data-act="cancel"]').onclick = () => close();
      const btn = sheet.querySelector('[data-hold]'), fill = sheet.querySelector('.hold-fill'), label = sheet.querySelector('.hold-label');
      let anim = null;
      const start = (ev) => {
        ev.preventDefault();
        haptic();
        anim = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 1600, easing: 'linear', fill: 'forwards' });
        label.textContent = 'Keep holding…';
        anim.onfinish = () => {
          haptic();
          resetAll();
          close();
          toast('Sheet reset · starting fresh', { icon: icon('check', { size: 18 }), tone: 'good' });
        };
      };
      const stop = () => {
        if (!anim || anim.playState === 'finished') return;
        const p = anim.currentTime / 1600;
        anim.cancel();
        fill.animate([{ transform: `scaleX(${p})` }, { transform: 'scaleX(0)' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        label.textContent = 'Hold to erase everything';
      };
      btn.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, stop));
      btn.addEventListener('keydown', (ev) => { if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) start(ev); });
      btn.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') stop(); });
    },
  });
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

// entries that appear (Apple Pay sync, a save, an undo) slide into their list instead of popping in
let knownIds = new Set(state.entries.map((e) => e.id));
let freshIds = new Set();
subscribe((reason) => {
  if (reason === 'prefs') return;
  if (reason === 'history') { const slot = view.querySelector('.undo-slot'); if (slot) slot.innerHTML = undoButton(); return; }
  const ids = new Set(state.entries.map((e) => e.id));
  freshIds = new Set([...ids].filter((id) => !knownIds.has(id)));
  knownIds = ids;
  render(reason);
  freshIds = new Set();
});
function animateFresh() {
  if (!freshIds.size || reduceMotion()) return;
  view.querySelectorAll('.swipe[data-id]').forEach((w) => {
    if (!freshIds.has(w.dataset.id)) return;
    const h = w.offsetHeight, sp = spring(0.9, 0.42);
    w.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: sp.duration, easing: sp.easing });
    w.querySelector('.entry')?.animate([{ transform: 'translateY(-12px) scale(0.98)' }, { transform: 'none' }], { duration: sp.duration, easing: sp.easing });
  });
}
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('resize', () => moveDroplet());

/* ───── Swipe left on an entry to delete (iOS list behaviour) ───── */
let openSwipe = null, swipeDrag = null, swallowClick = false;
const REVEAL = 88;
function setX(row, x, animate) {
  row.style.transition = animate && !reduceMotion() ? 'transform 0.38s cubic-bezier(0.23, 1, 0.32, 1)' : 'none';
  row.style.transform = x ? `translateX(${x}px)` : '';
}
function closeSwipe() { if (!openSwipe) return; setX(openSwipe.querySelector('.entry'), 0, true); openSwipe.classList.remove('open'); openSwipe = null; }
function swipeDelete(wrap) {
  if (!wrap) return;
  const removed = state.entries.find((x) => x.id === wrap.dataset.id);
  if (!removed) return;
  haptic();
  const finish = () => {
    openSwipe = null;
    deleteEntry(removed.id);
    toast(`Deleted ${money(removed.amount, removed.currency)}`, { action: 'Undo', onAction: () => doUndo(), icon: icon('trash', { size: 18 }) });
  };
  if (reduceMotion()) return finish();
  const row = wrap.querySelector('.entry');
  setX(row, -wrap.offsetWidth, true);
  wrap.animate([{ height: `${wrap.offsetHeight}px` }, { height: '0px' }], { duration: 260, delay: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' }).onfinish = finish;
}
view.addEventListener('pointerdown', (e) => {
  const wrap = e.target.closest('.swipe');
  if (!wrap || e.target.closest('.swipe-del')) return;
  if (openSwipe && openSwipe !== wrap) closeSwipe();
  swipeDrag = { wrap, row: wrap.querySelector('.entry'), x0: e.clientX, y0: e.clientY, base: wrap === openSwipe ? -REVEAL : 0, on: false, id: e.pointerId, last: [e.timeStamp, e.clientX], v: 0 };
});
view.addEventListener('pointermove', (e) => {
  const d = swipeDrag;
  if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  if (!d.on) {
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { swipeDrag = null; return; }
    if (Math.abs(dx) < 8) return;
    d.on = true;
    d.row.setPointerCapture?.(e.pointerId);
  }
  let x = Math.min(0, d.base + dx);
  const w = d.wrap.offsetWidth;
  if (x < -w * 0.75) x = -w * 0.75 + (x + w * 0.75) * 0.3; // resist past the full-swipe point
  setX(d.row, x, false);
  d.wrap.classList.toggle('armed', x < -w * 0.55);
  d.v = (e.clientX - d.last[1]) / Math.max(1, e.timeStamp - d.last[0]) * 1000;
  d.last = [e.timeStamp, e.clientX];
});
const endSwipe = (e) => {
  const d = swipeDrag;
  swipeDrag = null;
  if (!d || !d.on) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 60);
  const x = new DOMMatrix(getComputedStyle(d.row).transform).m41;
  const w = d.wrap.offsetWidth;
  d.wrap.classList.remove('armed');
  if (x < -w * 0.55 || (d.v < -1400 && x < -REVEAL)) return swipeDelete(d.wrap);
  if (x < -REVEAL / 2 || d.v < -500) { setX(d.row, -REVEAL, true); d.wrap.classList.add('open'); openSwipe = d.wrap; haptic(); }
  else { setX(d.row, 0, true); d.wrap.classList.remove('open'); if (openSwipe === d.wrap) openSwipe = null; }
};
view.addEventListener('pointerup', endSwipe);
view.addEventListener('pointercancel', endSwipe);
view.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);

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

applyAppearance(state.prefs.appearance);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(state.prefs.appearance));
/* Keyboard: N new entry · 1–4 tabs · ←/→ accounts on Home · / search · ⌘Z undo */
document.addEventListener('keydown', (ev) => {
  const typing = ev.target.matches?.('input, textarea, select, [contenteditable]');
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey && !typing) { ev.preventDefault(); doUndo(); return; }
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey || document.documentElement.classList.contains('sheet-open') || document.documentElement.classList.contains('locked')) return;
  if (ev.key === 'n' || ev.key === 'N' || ev.key === '+') { ev.preventDefault(); openEntry(); }
  else if (/^[1-4]$/.test(ev.key)) go(TABS[+ev.key - 1]);
  else if (ev.key === '/') { ev.preventDefault(); go('activity'); setTimeout(() => view.querySelector('.search input')?.focus(), 60); }
  else if (tab === 'home' && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) { ev.preventDefault(); stepFocus(ev.key === 'ArrowRight' ? 1 : -1); }
});

bindHomeGestures(view);
render();
initLock();
handleDeepLink();
sync();

try {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
} catch { /* not allowed in this frame */ }
