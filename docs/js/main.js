import {
  ACCOUNTS, PEOPLE_ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, categoryMeta, pickerCategories, allCategories, seriesColor, accountMeta, money, fmt, dayKey, dayLabel, timeLabel, toCSV,
} from './model.js';
import {
  state, subscribe, sync, isConnected, isDemo, setConnection, ping, updateEntry, deleteEntry, saveSettings, setDemo, setPrefs, resetAll, extrasOnPhoneOnly, batch,
} from './store.js';
import { learn, suggestFor, sameMerchant } from './categorize.js';
import { openEntry } from './entry.js';
import { openSheet, toast, haptic, esc, spring, reduceMotion, rollNumber } from './ui.js';
import { icon } from './icons.js';
import { bindDonut, bindPace, bindBars } from './charts.js';
import { initLock, lockSupported, enableLock, disableLock } from './lock.js';
import { ACCENTS, DEFAULT_APPEARANCE, normalizeAppearance, applyAppearance } from './theme.js';
import { accountsSettingsBlock, accountsClick } from './accounts.js';
import { peopleSettingsBlock, peopleClick, askLinked } from './people-ui.js';
import { splitPartner } from './people.js';
import { goalsSettingsBlock, goalsClick } from './goals-ui.js';
import { budgetsSettingsBlock, budgetsClick } from './budgets-settings.js';
import { categoriesSettingsBlock, categoriesClick } from './categories.js';
import { entryRow, syncBadge, largeTitle, undoButton, doUndo, demoBanner } from './views.js';
import {
  renderActivity, refreshActivity, activityFilter, activitySelect, openFilters, openBulkCategory, openBulkDelete,
  startSelect, endSelect, toggleSelected, selectAll, clearFilter, syncSelectingClass,
} from './activity.js';
import { renderInsights, shiftInsights, insightsShown, subsClick, showCurrentInsights, resetInsights } from './insights.js';
import { openReport } from './report.js';
import { bnplClick, bnplSettingsBlock } from './bnpl-ui.js';
import { weeklyClick } from './weekly-ui.js';
import { openSetup, shouldAutoOpen } from './setup.js';
import { renderHome, snapshotHome, afterHomeRender, bindHomeGestures, homeClick, planSettingsBlock, stepFocus } from './home.js';

const view = document.getElementById('view');
const TABS = ['home', 'activity', 'insights', 'settings'];
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';

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
      ${isConnected() && extrasOnPhoneOnly() ? `<div class="row status-row">
        <span class="row-icon" style="--tint:var(--warn)">${icon('warn', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Some settings are only on this phone</span>
          <span class="row-sub">Paste the new script into Apps Script and deploy a new version. They’ll be saved to your sheet straight after.</span></span>
      </div>` : ''}
      ${isConnected() ? '<details class="conn-details"><summary class="row link-row"><span class="row-main"><span class="row-title">Connection details</span></span>' + icon('chevD', { size: 16, cls: 'chev' }) + '</summary>' : ''}
      <label class="row input-row"><span>Web app URL</span><input name="url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="row input-row"><span>App key</span><input name="token" type="text" placeholder="From Spendings → Show my app key" value="${esc(c.token)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="row btn-row">
        <button type="button" class="btn-tinted" data-act="connect">${icon('link', { size: 18 })}Connect</button>
        <button type="button" class="btn-tinted" data-act="sync" ${isConnected() ? '' : 'disabled'}>${icon('sync', { size: 18 })}Sync now</button>
      </div>
      ${isConnected() ? '</details>' : ''}
      ${state.sheetUrl ? `<a class="row link-row" href="${esc(state.sheetUrl)}" target="_blank" rel="noopener">${icon('sheet', { size: 20 })}<span>Open the sheet</span>${icon('chevR', { size: 16, cls: 'chev' })}</a>` : ''}
      <button type="button" class="row link-row" data-act="setup-guide">
        <span class="row-icon" style="--tint:var(--tint-text)">${icon('sparkle', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Set up step by step</span><span class="row-sub">${isConnected() ? 'The welcome guide again' : 'Your cards, your money and your sheet'}</span></span>
        ${icon('chevR', { size: 16, cls: 'chev' })}
      </button>
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

    <h3 class="group-title" id="people">People</h3>
    <section class="group">${peopleSettingsBlock()}</section>
    <p class="group-foot">Friends you split bills with or lend to. What they owe isn’t counted as your money; Home shows it under “Where your money is”.${extrasOnPhoneOnly() && PEOPLE_ACCOUNTS.length ? ' <span class="people-script-hint">Updating your sheet’s script also makes Apple Pay card matching ignore people.</span>' : ''}</p>

    ${goalsSettingsBlock()}
    <h3 class="group-title" id="categories">Categories</h3>
    <section class="group">${categoriesSettingsBlock()}</section>
    <p class="group-foot">Add your own, rename any, or hide ones you don’t use. Old entries always keep their category.</p>

    <h3 class="group-title" id="plan">Payday plan</h3>
    <section class="group plan-settings">${planSettingsBlock()}</section>
    <p class="group-foot">Salary and Nafis wait for your “It landed” tap, so your total never runs ahead of the bank.</p>

    <h3 class="group-title" id="bnpl">Buy now, pay later</h3>
    <section class="group">${bnplSettingsBlock()}</section>
    <p class="group-foot">What you still owe Tabby, Tamara and the like. It’s not spending until an instalment is paid.</p>
    <h3 class="group-title" id="budgets">Category limits</h3>
    <section class="group">${budgetsSettingsBlock()}</section>
    <p class="group-foot">A spending limit for a category in each pay cycle. Insights shows how full each one is, and Home says so when one nears its limit.</p>

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
      <button type="button" class="row link-row" data-act="report"><span class="row-icon" style="--tint:var(--tint-text)">${icon('note', { size: 20 })}</span><span class="row-main"><span class="row-title">Monthly report</span><span class="row-sub">Any cycle as a PDF or CSV</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>
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
  // the best guess for each waiting payment, from what you've filed before (categorize.js)
  const guesses = () => {
    const index = learn(state.entries, state.merchants);
    return new Map(items().map((e) => [e.id, e.type === 'Spend' ? suggestFor(e.merchant, index) : null]));
  };
  // other waiting payments from the same shop as e
  const twins = (e, list) => list.filter((x) => x.id !== e.id && x.type === e.type && sameMerchant(x.merchant, e.merchant));
  // only a high-confidence guess is ever filed without you tapping it
  const confident = (g) => !!g && g.confidence === 'high';

  const body = () => {
    const list = items();
    if (!list.length) return `<div class="empty">${icon('check', { size: 30 })}<p>All sorted.</p></div>`;
    const guess = guesses();
    const sure = list.filter((e) => confident(guess.get(e.id)));
    const all = sure.length >= 2
      ? `<button type="button" class="rc-accept-all" data-act="accept-all">${icon('sparkle', { size: 18 })}File ${sure.length} with their suggestions</button>` : '';
    return all + list.map((e) => {
      const g = guess.get(e.id);
      const n = twins(e, list).length + 1;
      const group = g && g.confidence === 'high' && n > 1; // "file all" only when sure
      const why = !g ? '' : g.confidence === 'low' ? 'Guess from the shop name' : `${g.confidence === 'medium' ? 'Maybe like' : 'Like'} ${esc(g.like)}${g.times > 1 ? ` · ${g.times} times` : ''}`;
      const meta = g && categoryMeta(g.category);
      const sug = g ? `<button type="button" class="rc-suggest" data-cat="${esc(g.category)}"${group ? ' data-all="1"' : ''} style="--cat:${seriesColor(meta.slot)}">
          <span class="rs-icon">${icon(meta.icon, { size: 18 })}</span>
          <span class="rs-text"><b>${group ? `File all ${n} as ${esc(meta.short)}` : `File as ${esc(g.category)}`}</b><span>${why}</span></span>
        </button>` : n > 1 ? `<p class="rc-hint">${n} payments from this shop. Pick a category and you can file them all.</p>` : '';
      return `<article class="review-card" data-id="${esc(e.id)}">
      <div class="rc-head"><div><b>${esc(e.merchant || 'Unknown merchant')}</b><span>${esc(accountMeta(e.account).name)} · ${dayLabel(dayKey(e.date))}, ${timeLabel(e.date)}</span></div>
      <span class="num rc-amt">${e.currency === 'USD' ? '$' : 'AED '}${fmt(e.amount, { fixed: true })}</span></div>
      ${sug}
      <div class="rc-cats">${pickerCategories(e.type, e.category).map((c) => `<button type="button" class="rc-cat${g && g.category === c.id ? ' sug' : ''}" data-cat="${esc(c.id)}" style="--cat:${e.type === 'Income' ? 'var(--good)' : seriesColor(c.slot)}">${icon(c.icon, { size: 16 })}${esc(c.short)}</button>`).join('')}</div>
    </article>`;
    }).join('');
  };

  openSheet({
    label: 'Needs review',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">Needs review</h2><button class="text-btn strong" data-act="done" type="button">Done</button></header>
      <p class="sheet-lede">Tap a category to file each payment. The app learns from what you file, even when the bank spells the shop differently.</p>
      <div class="sheet-scroll review-list">${body()}</div>`,
    onMount(sheet, close) {
      const redraw = () => { const l = sheet.querySelector('.review-list'); if (l) l.innerHTML = body(); };
      // file several at once, undone together in one step
      const fileMany = (pairs, label) => {
        batch(label, () => pairs.forEach(([id, category]) => updateEntry(id, { category })));
        toast(`${esc(label)}. Undo puts ${pairs.length > 1 ? `these ${pairs.length}` : 'it'} back.`, { icon: icon('check', { size: 18 }), tone: 'good', action: 'Undo', onAction: () => { doUndo(); redraw(); } });
      };
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        if (ev.target.closest('[data-act="accept-all"]')) {
          haptic();
          const guess = guesses();
          const pairs = items().filter((e) => confident(guess.get(e.id))).map((e) => [e.id, guess.get(e.id).category]);
          fileMany(pairs, `Filed ${pairs.length} payments`);
          return redraw();
        }
        const b = ev.target.closest('.rc-cat, .rc-suggest');
        if (!b) return;
        const card = b.closest('.review-card');
        const e = state.entries.find((x) => x.id === card.dataset.id);
        if (!e) return redraw();
        const cat = b.dataset.cat;
        const others = twins(e, items());
        haptic();
        // "File all N" on the suggestion: this one and its twins together
        if (b.dataset.all && others.length) {
          fileMany([e, ...others].map((x) => [x.id, cat]), `Filed ${others.length + 1} from ${e.merchant} as ${categoryMeta(cat)?.short || cat}`);
          return redraw();
        }
        updateEntry(e.id, { category: cat });
        b.classList.add('on');
        // picked by hand and the same shop has more waiting: offer to file those too
        if (others.length) {
          // this toast's button files the others (its own undo step); the header Undo still undoes the one you just picked
          toast(`Filed as ${esc(categoryMeta(cat, e.type)?.short || cat)}`, {
            icon: icon('check', { size: 18 }), tone: 'good', action: `File ${others.length} more`,
            onAction: () => { fileMany(others.map((x) => [x.id, cat]), `Filed ${others.length} more from ${e.merchant}`); redraw(); },
          });
        }
        const h = card.offsetHeight;
        if (reduceMotion()) return redraw();
        card.animate([{ opacity: 1, height: `${h}px`, transform: 'none' }, { opacity: 0, height: '0px', marginBlock: '0', paddingBlock: '0', transform: 'translateX(40px)' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).onfinish = redraw;
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
      <div class="tip-card">${icon('check', { size: 18 })}<p><b>Testing it?</b> Tap <b>▶</b> on the Shortcut. The notification says <b>Connected ✓</b> and nothing is logged, because there was no real payment.</p></div>
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
    refreshActivity(view);
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
  syncSelectingClass(tab === 'activity');
  bindDonut(view);
  bindPace(view);
  bindBars(view);
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
  if (tab === 'activity') endSelect(); // leaving Activity drops a half-made selection
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
  if (view.contains(t) && (homeClick(t) || accountsClick(t) || peopleClick(t) || categoriesClick(t) || budgetsClick(t) || bnplClick(t) || weeklyClick(t) || goalsClick(t))) return;
  const goBtn = t.closest('[data-go]');
  if (goBtn) {
    haptic();
    if (goBtn.dataset.anchor === 'subs') showCurrentInsights();
    if (goBtn.dataset.resetInsights) resetInsights();
    go(goBtn.dataset.go);
    if (goBtn.dataset.anchor) setTimeout(() => document.getElementById(goBtn.dataset.anchor)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }), 260);
    return;
  }
  const tabBtn = t.closest('.tabbar [data-tab]');
  if (tabBtn) { haptic(); return go(tabBtn.dataset.tab); }
  if (t.closest('.fab')) { haptic(); return openEntry(); }
  if (tab === 'activity' && view.contains(t) && activityClick(t)) return;
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
  if (kind) { activityFilter.kind = kind.dataset.kind; haptic(); return refreshActivityChips(kind); }
  if (subsClick(t)) { haptic(); return; }
  const cyc = t.closest('[data-cyc]');
  if (cyc) { shiftInsights(+cyc.dataset.cyc); haptic(); return render(); }
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
  if (act === 'setup-guide') { haptic(); openGuide(); }
  if (act === 'demo') { setDemo(true); toast('Showing demo data', { icon: icon('sparkle', { size: 18 }) }); }
  if (act === 'exit-demo') { setDemo(false); render(); }
  if (act === 'export') exportCSV();
  if (act === 'report') openReport(tab === 'insights' ? insightsShown() : undefined);
  if (act === 'undo') doUndo();
  if (act === 'reset') openReset();
  if (act === 'connect') connect(t.closest('[data-act]'));
});

/* Activity: Select mode, the Filter sheet and filter pills. Returns true when it handled the tap. */
function activityClick(t) {
  const redraw = () => refreshActivity(view);
  if (activitySelect.on) {
    const row = t.closest('.entry[data-id]');
    if (row) { haptic(); toggleSelected(row.dataset.id); redraw(); return true; }
  }
  const clear = t.closest('[data-clear]');
  if (clear) { haptic(); clearFilter(clear.dataset.clear); redraw(); return true; }
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'filters') { haptic(); openFilters(redraw); return true; }
  if (act === 'select') { haptic(); closeSwipe(); startSelect(); redraw(); return true; }
  if (act === 'select-done') { haptic(); endSelect(); redraw(); return true; }
  if (act === 'select-all') { haptic(); selectAll(); redraw(); return true; }
  if (act === 'bulk-cat') { haptic(); openBulkCategory(redraw); return true; }
  if (act === 'bulk-del') { haptic(); openBulkDelete(redraw); return true; }
  return false;
}
function refreshActivityChips(on) {
  view.querySelectorAll('.filter-chips [data-kind]').forEach((b) => { b.classList.toggle('on', b === on); b.setAttribute('aria-selected', b === on); });
  refreshActivity(view);
}

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

function openGuide() {
  openSetup({ onShortcut: openShortcutGuide, onFinish: () => render() });
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
  if (ev.target.matches('.search input')) { activityFilter.q = ev.target.value; refreshActivity(view); }
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
  // half of a split: ask whether the other half goes too (one undo step), before anything moves
  const other = splitPartner(removed, state.entries);
  if (other) {
    const reset = () => { setX(wrap.querySelector('.entry'), 0, true); wrap.classList.remove('open'); if (openSwipe === wrap) openSwipe = null; };
    askLinked(removed, 'delete', (how) => {
      reset();
      batch(`Deleted ${money(removed.amount, removed.currency)}${how === 'both' ? ' and its other half' : ''}`, () => { deleteEntry(removed.id); if (how === 'both') deleteEntry(other.id); });
      toast(`Deleted ${money(removed.amount, removed.currency)}${how === 'both' ? ' and its other half' : ''}`, { action: 'Undo', onAction: () => doUndo(), icon: icon('trash', { size: 18 }) });
    }, reset);
    return;
  }
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
  if (!wrap || e.target.closest('.swipe-del') || (tab === 'activity' && activitySelect.on)) return;
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
if (shouldAutoOpen()) openGuide();

try {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
} catch { /* not allowed in this frame */ }
