import {
  ACCOUNTS, PEOPLE_ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, categoryMeta, pickerCategories, allCategories, seriesColor, accountMeta, money, fmt, dayKey, dayLabel, timeLabel, toCSV, entryIds, amtAED, amtOf, cycleOf, cycleBounds,
} from './model.js';
import { EMPTY_FILTER } from './filters.js';
import { t, locale, lang, setLang, langPref, onLangChange, isRTL, applyLang } from './i18n.js';
import {
  state, subscribe, sync, isConnected, isDemo, setConnection, ping, updateEntry, deleteEntry, saveSettings, setDemo, setPrefs, resetAll, extrasOnPhoneOnly, batch,
} from './store.js';
import { learn, suggestFor, sameMerchant, markAutoFiled } from './categorize.js';
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
  renderActivity, refreshActivity, hydrateActivity, resetActivityRows, activityFilter, activitySelect, openFilters, openBulkCategory, openBulkDelete,
  startSelect, endSelect, toggleSelected, selectAll, clearFilter, syncSelectingClass,
} from './activity.js';
import { renderInsights, shiftInsights, insightsShown, subsClick, placeTap, showCurrentInsights, resetInsights } from './insights.js';
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
  return `<h3 class="group-title">${t('home.quickAdd')}</h3>
    <div class="quick" role="group" aria-label="${t('home.quickAdd')}">
      ${top.map(({ e }) => {
        const m = categoryMeta(e.category);
        return `<button type="button" class="quick-chip" data-quick="${esc(e.id)}" style="--tint:${m ? seriesColor(m.slot) : 'var(--label-2)'}">
          <span class="qc-icon">${icon(m ? m.icon : 'dots', { size: 18 })}</span>
          <span class="qc-text"><b>${esc(e.merchant)}</b><span>${amtOf(e.amount, e.currency)} · ${esc(e.account)}</span></span>
        </button>`;
      }).join('')}
    </div>`;
}

/* ───────────────────────── Settings ───────────────────────── */

function renderSettings() {
  const s = state.settings, c = state.conn;
  const syncedAgo = state.sync.at ? relTime(state.sync.at) : t('set.never');
  return `
    ${largeTitle(t('set.title'))}
    <h3 class="group-title">${t('set.gsheet')}</h3>
    <section class="group form">
      <div class="row status-row">
        <span class="row-icon" style="--tint:${isConnected() ? 'var(--good)' : 'var(--label-3)'}">${icon('sheet', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${isConnected() ? t('set.connected') : t('set.notConnected')}</span>
          <span class="row-sub">${isConnected() ? (state.sync.status === 'error' ? `<span class="warn-text">${esc(state.sync.error)}</span>` : `${t('set.lastSynced', { ago: syncedAgo })}${state.outbox.length ? ` · ${t('sync.waiting', { n: state.outbox.length })}` : ''}`) : t('set.pasteUrl')}</span></span>
      </div>
      ${isConnected() && extrasOnPhoneOnly() ? `<div class="row status-row">
        <span class="row-icon" style="--tint:var(--warn)">${icon('warn', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${t('set.phoneOnly')}</span>
          <span class="row-sub">${t('set.phoneOnlySub')}</span></span>
      </div>` : ''}
      ${isConnected() ? '<details class="conn-details"><summary class="row link-row"><span class="row-main"><span class="row-title">' + t('set.connDetails') + '</span></span>' + icon('chevD', { size: 16, cls: 'chev' }) + '</summary>' : ''}
      <label class="row input-row"><span>${t('set.webUrl')}</span><input name="url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="row input-row"><span>${t('set.appKey')}</span><input name="token" type="text" placeholder="${t('set.keyPh')}" value="${esc(c.token)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="row btn-row">
        <button type="button" class="btn-tinted" data-act="connect">${icon('link', { size: 18 })}${t('set.connect')}</button>
        <button type="button" class="btn-tinted" data-act="sync" ${isConnected() ? '' : 'disabled'}>${icon('sync', { size: 18 })}${t('set.syncNow')}</button>
      </div>
      ${isConnected() ? '</details>' : ''}
      ${state.sheetUrl ? `<a class="row link-row" href="${esc(state.sheetUrl)}" target="_blank" rel="noopener">${icon('sheet', { size: 20 })}<span>${t('set.openSheet')}</span>${icon('chevR', { size: 16, cls: 'chev' })}</a>` : ''}
      <button type="button" class="row link-row" data-act="setup-guide">
        <span class="row-icon" style="--tint:var(--tint-text)">${icon('sparkle', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${t('set.stepByStep')}</span><span class="row-sub">${isConnected() ? t('set.welcomeAgain') : t('set.cardsMoney')}</span></span>
        ${icon('chevR', { size: 16, cls: 'chev' })}
      </button>
    </section>
    <p class="group-foot">${t('set.keyFoot')}</p>

    <h3 class="group-title">Apple Pay</h3>
    <section class="group">
      <button type="button" class="row link-row" data-act="shortcut">
        <span class="row-icon" style="--tint:var(--tint-text)">${icon('bell', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${t('set.logApplePay')}</span><span class="row-sub">${t('set.setupShortcut')}</span></span>
        ${icon('chevR', { size: 16, cls: 'chev' })}
      </button>
    </section>

    <h3 class="group-title">${t('set.appearance')}</h3>
    <section class="group appearance">
      ${appearanceBlock()}
    </section>

    <h3 class="group-title" id="language">${t('set.language')}</h3>
    <section class="group appearance">
      <div class="lang-seg" role="radiogroup" aria-label="${t('set.language')}">
        ${[['en', 'English', 'en'], ['ar', 'العربية', 'ar'], ['auto', t('set.langAuto'), '']].map(([k, l, lg]) => `<button type="button" role="radio" aria-checked="${langPref() === k}" data-lang="${k}"${lg ? ` lang="${lg}"` : ''}>${l}</button>`).join('')}
      </div>
      <p class="group-foot" style="padding:0">${t('set.langFoot')}</p>
    </section>

    <h3 class="group-title" id="accounts">${t('set.accounts')}</h3>
    <section class="group">${accountsSettingsBlock()}</section>
    <p class="group-foot">${t('set.accountsFoot')}</p>

    <h3 class="group-title" id="people">${t('set.people')}</h3>
    <section class="group">${peopleSettingsBlock()}</section>
    <p class="group-foot">${t('set.peopleFoot')}${extrasOnPhoneOnly() && PEOPLE_ACCOUNTS.length ? ' <span class="people-script-hint">' + t('set.peopleHint') + '</span>' : ''}</p>

    ${goalsSettingsBlock()}
    <h3 class="group-title" id="categories">${t('set.categories')}</h3>
    <section class="group">${categoriesSettingsBlock()}</section>
    <p class="group-foot">${t('set.catFoot')}</p>

    <h3 class="group-title" id="plan">${t('set.plan')}</h3>
    <section class="group plan-settings">${planSettingsBlock()}</section>
    <p class="group-foot">${t('set.planFoot')}</p>

    <h3 class="group-title" id="bnpl">${t('set.bnpl')}</h3>
    <section class="group">${bnplSettingsBlock()}</section>
    <p class="group-foot">${t('set.bnplFoot')}</p>
    <h3 class="group-title" id="budgets">${t('set.limits')}</h3>
    <section class="group">${budgetsSettingsBlock()}</section>
    <p class="group-foot">${t('set.limitsFoot')}</p>

    <h3 class="group-title">${t('set.budget')}</h3>
    <section class="group form">
      <button type="button" class="row link-row" data-go="settings" data-anchor="plan"><span class="row-main"><span class="row-title">${t('set.allowancePer')}</span><span class="row-sub">${t('set.allowanceSet')}</span></span><b class="num">${fmt(s.allowance, { whole: true })}</b>${icon('chevR', { size: 16, cls: 'chev' })}</button>
      <label class="row input-row"><span>${t('set.allowanceCard')}</span><select name="allowanceAccount">${ACCOUNTS.map((a) => `<option ${a.id === s.allowanceAccount ? 'selected' : ''}>${a.id}</option>`).join('')}</select></label>
      <label class="row input-row"><span>${t('set.mainAcc')}</span><select name="emergencyAccount">${ACCOUNTS.map((a) => `<option ${a.id === s.emergencyAccount ? 'selected' : ''}>${a.id}</option>`).join('')}</select></label>
      <label class="row input-row"><span>${t('set.cycleStarts')}</span><select name="cycleStart">${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === s.cycleStart ? 'selected' : ''}>${ordinal(d)}</option>`).join('')}</select></label>
      <label class="row input-row"><span>${t('set.usdAed')}</span><input name="usdRate" type="number" inputmode="decimal" step="0.0001" min="0" value="${s.usdRate}"></label>
    </section>

    <h3 class="group-title">${t('set.privacy')}</h3>
    <section class="group">
      <label class="row toggle-row"><span class="row-icon" style="--tint:var(--good)">${icon('faceid', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${t('set.faceId')}</span><span class="row-sub">${t('set.faceIdSub')}</span></span>
        <input type="checkbox" switch class="switch" name="lock" ${state.prefs.lock ? 'checked' : ''}></label>
    </section>

    <h3 class="group-title">${t('set.data')}</h3>
    <section class="group">
      <button type="button" class="row link-row" data-act="reset"><span class="row-icon" style="--tint:var(--neg)">${icon('trash', { size: 20 })}</span><span class="row-main"><span class="row-title danger-text">${t('set.reset')}</span><span class="row-sub">${t('set.resetSub')}</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>
      <button type="button" class="row link-row" data-act="export"><span class="row-icon" style="--tint:var(--tint-text)">${icon('download', { size: 20 })}</span><span class="row-main"><span class="row-title">${t('set.export')}</span><span class="row-sub">${t('set.exportSub')}</span></span></button>
      <button type="button" class="row link-row" data-act="report"><span class="row-icon" style="--tint:var(--tint-text)">${icon('note', { size: 20 })}</span><span class="row-main"><span class="row-title">${t('set.report')}</span><span class="row-sub">${t('set.reportSub')}</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>
      <label class="row toggle-row"><span class="row-icon" style="--tint:var(--series-7)">${icon('sparkle', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${t('set.demo')}</span><span class="row-sub">${t('set.demoSub')}</span></span>
        <input type="checkbox" switch class="switch" name="demo" ${isDemo() ? 'checked' : ''}></label>
    </section>
    <p class="group-foot center">${t('set.foot')}</p>`;
}


function appearanceBlock() {
  const a = normalizeAppearance(state.prefs.appearance);
  const acc = ACCENTS.find((x) => x.id === a.accent);
  const changed = a.theme !== DEFAULT_APPEARANCE.theme || a.accent !== DEFAULT_APPEARANCE.accent;
  return `
    <div class="ap-label">${t('set.theme')}</div>
    <div class="theme-seg" role="radiogroup" aria-label="${t('set.theme')}">
      ${[['system', t('set.auto')], ['light', t('set.light')], ['dark', t('set.dark')]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${a.theme === k}" data-theme-mode="${k}">${l}</button>`).join('')}
    </div>
    <div class="ap-label">${t('set.accent')} <b>${acc.name}</b></div>
    <div class="swatches" role="radiogroup" aria-label="${t('set.accentColour')}">
      ${ACCENTS.map((x) => `<button type="button" role="radio" class="swatch accent-swatch" aria-checked="${x.id === a.accent}" aria-label="${x.name}" data-accent="${x.id}" style="--sw:${x.l[0]}; --sw-top:${x.l[3]}">${icon('check', { size: 16 })}</button>`).join('')}
    </div>
    <p class="group-foot" style="padding:0">${t('set.accentFoot')}</p>
    ${changed ? '<button type="button" class="text-btn reset-btn" data-act="reset-look">' + t('set.resetLook') + '</button>' : ''}`;
}

function setAppearance(patch) {
  const a = normalizeAppearance(state.prefs.appearance);
  const next = { ...a, ...patch, cards: { ...a.cards, ...(patch.cards || {}) } };
  setPrefs({ appearance: next });
  applyAppearance(next);
  haptic();
  render();
}

const ordinal = (n) => lang() === 'ar' ? String(n) : n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
function relTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('time.now');
  if (m < 60) return t('time.min', { n: m });
  const h = Math.round(m / 60);
  return h < 24 ? t('time.hr', { n: h }) : new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
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
    if (!list.length) return `<div class="empty">${icon('check', { size: 30 })}<p>${t('rev.allSorted')}</p></div>`;
    const guess = guesses();
    const sure = list.filter((e) => confident(guess.get(e.id)));
    const all = sure.length >= 2
      ? `<button type="button" class="rc-accept-all" data-act="accept-all">${icon('sparkle', { size: 18 })}${t('rev.fileSug', { n: sure.length })}</button>` : '';
    return all + list.map((e) => {
      const g = guess.get(e.id);
      const n = twins(e, list).length + 1;
      const group = g && g.confidence === 'high' && n > 1; // "file all" only when sure
      const why = !g ? '' : g.confidence === 'low' ? t('rev.guess') : `${t(g.confidence === 'medium' ? 'rev.maybeLike' : 'rev.like', { what: esc(g.like) })}${g.times > 1 ? ` · ${t('rev.times', { n: g.times })}` : ''}`;
      const meta = g && categoryMeta(g.category);
      const sug = g ? `<button type="button" class="rc-suggest" data-cat="${esc(g.category)}"${group ? ' data-all="1"' : ''} style="--cat:${seriesColor(meta.slot)}">
          <span class="rs-icon">${icon(meta.icon, { size: 18 })}</span>
          <span class="rs-text"><b>${group ? t('rev.fileAll', { n, what: esc(meta.short) }) : t('rev.fileAs', { what: esc(meta.label) })}</b><span>${why}</span></span>
        </button>` : n > 1 ? `<p class="rc-hint">${t('rev.hint', { n })}</p>` : '';
      return `<article class="review-card" data-id="${esc(e.id)}">
      <div class="rc-head"><div><b>${esc(e.merchant || t('rev.unknownShop'))}</b><span>${esc(accountMeta(e.account).name)} · ${dayLabel(dayKey(e.date))}, ${timeLabel(e.date)}</span></div>
      <span class="num rc-amt">${amtOf(e.amount, e.currency, { fixed: true })}</span></div>
      ${sug}
      <div class="rc-cats">${pickerCategories(e.type, e.category).map((c) => `<button type="button" class="rc-cat${g && g.category === c.id ? ' sug' : ''}" data-cat="${esc(c.id)}" style="--cat:${e.type === 'Income' ? 'var(--good)' : seriesColor(c.slot)}">${icon(c.icon, { size: 16 })}${esc(c.short)}</button>`).join('')}</div>
    </article>`;
    }).join('');
  };

  openSheet({
    label: t('rev.needs'),
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">${t('rev.needs')}</h2><button class="text-btn strong" data-act="done" type="button">${t('common.done')}</button></header>
      <p class="sheet-lede">${t('rev.lede')}</p>
      <div class="sheet-scroll review-list">${body()}</div>`,
    onMount(sheet, close) {
      const redraw = () => { const l = sheet.querySelector('.review-list'); if (l) l.innerHTML = body(); };
      // file several at once, undone together in one step
      const fileMany = (pairs, label, auto = false) => {
        if (auto) markAutoFiled(pairs); // filed by a suggestion, not by you: not taught back to the guesser
        batch(label, () => pairs.forEach(([id, category]) => updateEntry(id, { category })));
        toast(t('rev.undoPuts', { what: esc(label), n: pairs.length }), { icon: icon('check', { size: 18 }), tone: 'good', action: t('common.undo'), onAction: () => { doUndo(); redraw(); } });
      };
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        if (ev.target.closest('[data-act="accept-all"]')) {
          haptic();
          const guess = guesses();
          const pairs = items().filter((e) => confident(guess.get(e.id))).map((e) => [e.id, guess.get(e.id).category]);
          fileMany(pairs, t('rev.filedN', { n: pairs.length }), true);
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
          fileMany([e, ...others].map((x) => [x.id, cat]), t('rev.filedFrom', { n: others.length + 1, shop: e.merchant, what: categoryMeta(cat)?.short || cat }), true);
          return redraw();
        }
        updateEntry(e.id, { category: cat });
        b.classList.add('on');
        // picked by hand and the same shop has more waiting: offer to file those too
        if (others.length) {
          // this toast's button files the others (its own undo step); the header Undo still undoes the one you just picked
          toast(t('rev.filedAs', { what: esc(categoryMeta(cat, e.type)?.short || cat) }), {
            icon: icon('check', { size: 18 }), tone: 'good', action: t('rev.fileMore', { n: others.length }),
            onAction: () => { fileMany(others.map((x) => [x.id, cat]), t('rev.filedMore', { n: others.length, shop: e.merchant })); redraw(); },
          });
        }
        const h = card.offsetHeight;
        if (reduceMotion()) return redraw();
        card.animate([{ opacity: 1, height: `${h}px`, transform: 'none' }, { opacity: 0, height: '0px', marginBlock: '0', paddingBlock: '0', transform: `translateX(${isRTL() ? -40 : 40}px)` }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).onfinish = redraw;
      });
    },
  });
}

/* ───────────────────────── Shortcut guide ───────────────────────── */

function openShortcutGuide() {
  const url = state.conn.url || t('guide.yourUrl');
  const key = state.conn.token || t('guide.yourKey');
  const cats = [...SPEND_CATEGORIES.map((c) => c.id), 'Decide later'];
  const copy = (label, value) => `<div class="copy-row"><div><span>${label}</span><code>${esc(value)}</code></div><button type="button" class="icon-btn" data-copy="${esc(value)}" aria-label="${t('guide.copy', { what: label })}">${icon('copy', { size: 18 })}</button></div>`;
  openSheet({
    label: t('guide.title'),
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">${t('guide.title')}</h2><button class="text-btn strong" data-act="done" type="button">${t('common.done')}</button></header>
    <div class="sheet-scroll guide">
      <p class="sheet-lede">${t('guide.lede')}</p>
      ${copy(t('set.webUrl'), url)}
      ${copy(t('set.appKey'), key)}
      <ol class="steps">
        <li>${t('guide.s1')}</li>
        <li>${t('guide.s2')}</li>
        <li>${t('guide.s3a')}<div class="cat-list">${cats.map((c) => `<code>${esc(c)}</code>`).join('')}</div>${t('guide.s3b')}</li>
        <li>${t('guide.s4')}
          <table class="fields"><tr><td lang="en">token</td><td>${t('guide.yourKey')}</td></tr><tr><td lang="en">source</td><td><code>applepay</code></td></tr><tr><td lang="en">amount</td><td lang="en">Shortcut Input → <b>Amount</b></td></tr><tr><td lang="en">merchant</td><td lang="en">Shortcut Input → <b>Merchant</b></td></tr><tr><td lang="en">card</td><td lang="en">Shortcut Input → <b>Card</b> (or <b>Name</b>)</td></tr><tr><td lang="en">category</td><td lang="en"><b>Chosen Item</b></td></tr></table></li>
        <li>${t('guide.s5')}</li>
        <li>${t('guide.s6')}</li>
      </ol>
      <div class="tip-card">${icon('sparkle', { size: 18 })}<p>${t('guide.tip1')}</p></div>
      <div class="tip-card">${icon('check', { size: 18 })}<p>${t('guide.tip2')}</p></div>
      <div class="tip-card">${icon('warn', { size: 18 })}<p>${t('guide.tip3')}</p></div>
    </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        const b = ev.target.closest('[data-copy]');
        if (!b) return;
        try { await navigator.clipboard.writeText(b.dataset.copy); haptic(); toast(t('guide.copied'), { icon: icon('check', { size: 18 }), tone: 'good' }); } catch { toast(t('guide.noCopy')); }
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
  if (tab === 'activity') hydrateActivity(view);
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
      rollNumber(v, target, (n) => (unit === 'pct' ? `${Math.round(n)}%` : `${amtAED(fmt(n, { whole: true }))}`));
    }
  }
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  moveDroplet();
}

let lastSwapMs = 0;
const SLOW_SWAP_MS = 80; // milliseconds a tab swap may take before the cross-fade is skipped
function go(next) {
  if (!TABS.includes(next)) return;
  const toastEl = document.getElementById('toast');
  if (!toastEl.hidden) { toastEl.classList.remove('show'); setTimeout(() => { toastEl.hidden = true; }, 250); }
  if (next === tab) { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
  if (next === 'activity') resetActivityRows();
  if (tab === 'activity') endSelect(); // leaving Activity drops a half-made selection
  tab = next;
  history.replaceState(null, '', `#${tab}`);
  // The cross-fade photographs the old and new screens, which costs about as much again as drawing them. On a slow
  // phone, or with a long list, that is the difference between a snappy tab and a stutter, so when the last swap
  // took longer than a frame budget the next one is a plain swap. Same look otherwise; Reduce Motion never fades.
  const swap = () => { const t0 = performance.now(); render(); window.scrollTo(0, 0); lastSwapMs = performance.now() - t0; };
  if (document.startViewTransition && !reduceMotion() && lastSwapMs < SLOW_SWAP_MS) document.startViewTransition(swap);
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
  const tg = ev.target;
  if (view.contains(tg) && (homeClick(tg) || accountsClick(tg) || peopleClick(tg) || categoriesClick(tg) || budgetsClick(tg) || bnplClick(tg) || weeklyClick(tg) || goalsClick(tg))) return;
  const goBtn = tg.closest('[data-go]');
  if (goBtn) {
    haptic();
    if (goBtn.dataset.anchor === 'subs') showCurrentInsights();
    if (goBtn.dataset.resetInsights) resetInsights();
    go(goBtn.dataset.go);
    if (goBtn.dataset.anchor) setTimeout(() => document.getElementById(goBtn.dataset.anchor)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }), 260);
    return;
  }
  const tabBtn = tg.closest('.tabbar [data-tab]');
  if (tabBtn) { haptic(); return go(tabBtn.dataset.tab); }
  if (tg.closest('.fab')) { haptic(); return openEntry(); }
  if (tab === 'activity' && view.contains(tg) && activityClick(tg)) return;
  const quick = tg.closest('[data-quick]');
  if (quick) {
    const e = state.entries.find((x) => x.id === quick.dataset.quick);
    haptic();
    if (e) openEntry(null, { type: 'Spend', amount: e.amount, currency: e.currency, account: e.account, category: e.category, merchant: e.merchant });
    return;
  }
  const del = tg.closest('.swipe-del');
  if (del) { swipeDelete(del.closest('.swipe')); return; }
  if (openSwipe && !tg.closest('.swipe.open')) { closeSwipe(); return; }
  const row = tg.closest('.entry[data-id]');
  if (row && view.contains(row) && openSwipe) { closeSwipe(); return; }
  if (row && view.contains(row)) {
    const e = state.entries.find((x) => x.id === row.dataset.id);
    if (e?.type === 'Adjustment') toast(t('misc.swipeAdj'), { icon: icon('sync', { size: 18 }) });
    else if (e) openEntry(e);
    return;
  }
  const kind = tg.closest('[data-kind]');
  if (kind) { activityFilter.kind = kind.dataset.kind; haptic(); return refreshActivityChips(kind); }
  const place = placeTap(tg);
  if (place) {
    haptic();
    const { start, end } = cycleBounds(place.cycle, state.settings.cycleStart);
    const cur = place.cycle === cycleOf(new Date(), state.settings.cycleStart);
    Object.assign(activityFilter, { ...EMPTY_FILTER, shop: place.shop, shopName: place.name },
      cur ? { period: 'this' } : { period: 'custom', from: dayKey(start), to: dayKey(new Date(end.getTime() - 1)) });
    return go('activity');
  }
  if (subsClick(tg)) { haptic(); return; }
  const cyc = tg.closest('[data-cyc]');
  if (cyc) { shiftInsights(+cyc.dataset.cyc); haptic(); return render(); }
  const lg = tg.closest('[data-lang]');
  if (lg) { haptic(); setLang(lg.dataset.lang); return render(); }
  const mode = tg.closest('[data-theme-mode]');
  if (mode) return setAppearance({ theme: mode.dataset.themeMode });
  const accent = tg.closest('[data-accent]');
  if (accent) return setAppearance({ accent: accent.dataset.accent });
  const act = tg.closest('[data-act]')?.dataset.act;
  if (!act || !view.contains(tg)) return;
  if (act === 'reset-look') return setAppearance({ ...DEFAULT_APPEARANCE });
  if (act === 'sync') { haptic(); await sync(); if (state.sync.status === 'error') toast(state.sync.error, { icon: icon('warn', { size: 18 }), tone: 'warn' }); }
  if (act === 'review') openReview();
  if (act === 'shortcut') openShortcutGuide();
  if (act === 'setup-guide') { haptic(); openGuide(); }
  if (act === 'demo') { setDemo(true); toast(t('misc.showingDemo'), { icon: icon('sparkle', { size: 18 }) }); }
  if (act === 'exit-demo') { setDemo(false); render(); }
  if (act === 'export') exportCSV();
  if (act === 'report') openReport(tab === 'insights' ? insightsShown() : undefined);
  if (act === 'undo') doUndo();
  if (act === 'reset') openReset();
  if (act === 'connect') connect(tg.closest('[data-act]'));
});

/* Activity: Select mode, the Filter sheet and filter pills. Returns true when it handled the tap. */
function activityClick(tg) {
  const redraw = () => refreshActivity(view);
  if (activitySelect.on) {
    const row = tg.closest('.entry[data-id]');
    if (row) { haptic(); toggleSelected(row.dataset.id); redraw(); return true; }
  }
  const clear = tg.closest('[data-clear]');
  if (clear) { haptic(); clearFilter(clear.dataset.clear); redraw(); return true; }
  const act = tg.closest('[data-act]')?.dataset.act;
  if (act === 'filters') { haptic(); openFilters(redraw); return true; }
  if (act === 'select') { haptic(); closeSwipe(); startSelect(); redraw(); return true; }
  if (act === 'select-done') { haptic(); endSelect(); redraw(); return true; }
  if (act === 'select-all') { haptic(); selectAll(); redraw(); return true; }
  if (act === 'bulk-cat') { haptic(); openBulkCategory(redraw); return true; }
  if (act === 'bulk-del') { haptic(); openBulkDelete(redraw); return true; }
  return false;
}
function refreshActivityChips(on) {
  view.querySelectorAll('.filter-chips [data-kind]').forEach((b) => { b.classList.toggle('on', b === on); b.setAttribute('aria-checked', b === on); });
  refreshActivity(view);
}

async function connect(btn) {
  const url = view.querySelector('input[name="url"]').value.trim();
  const token = view.querySelector('input[name="token"]').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast(t('misc.badUrl'), { icon: icon('warn', { size: 18 }), tone: 'warn' }); return; }
  if (!token) { toast(t('misc.pasteKey'), { icon: icon('warn', { size: 18 }), tone: 'warn' }); return; }
  btn.disabled = true; btn.classList.add('busy');
  try {
    const r = await ping(url, token);
    setConnection(url, token);
    if (isDemo()) setDemo(false);
    toast(r.message || t('set.connected'), { icon: icon('check', { size: 18 }), tone: 'good' });
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
    label: t('set.reset'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${t('set.reset')}</h2><span class="icon-btn-spacer"></span></header>
      <div class="reset-body">
        <div class="reset-icon">${icon('trash', { size: 28 })}</div>
        <p class="reset-lede">${t('reset.erases', { n })}</p>
        <ul class="reset-keep">
          <li>${icon('check', { size: 16 })}${t('reset.stay')}</li>
          <li>${icon('check', { size: 16 })}${isConnected() && !isDemo() ? t('reset.backup') : t('reset.exportFirst')}</li>
        </ul>
        <button type="button" class="hold-btn" data-hold><span class="hold-fill" aria-hidden="true"></span><span class="hold-label">${t('reset.hold')}</span></button>
      </div>`,
    onMount(sheet, close) {
      sheet.querySelector('[data-act="cancel"]').onclick = () => close();
      const btn = sheet.querySelector('[data-hold]'), fill = sheet.querySelector('.hold-fill'), label = sheet.querySelector('.hold-label');
      let anim = null;
      const start = (ev) => {
        ev.preventDefault();
        haptic();
        anim = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 1600, easing: 'linear', fill: 'forwards' });
        label.textContent = t('reset.keep');
        anim.onfinish = () => {
          haptic();
          resetAll();
          close();
          toast(t('reset.done'), { icon: icon('check', { size: 18 }), tone: 'good' });
        };
      };
      const stop = () => {
        if (!anim || anim.playState === 'finished') return;
        const p = anim.currentTime / 1600;
        anim.cancel();
        fill.animate([{ transform: `scaleX(${p})` }, { transform: 'scaleX(0)' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        label.textContent = t('reset.hold');
      };
      btn.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ty) => btn.addEventListener(ty, stop));
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
      if (!(await lockSupported())) { el.checked = false; toast(t('lockT.na'), { tone: 'warn', icon: icon('warn', { size: 18 }) }); return; }
      try { await enableLock(); toast(t('lockT.on'), { icon: icon('faceid', { size: 18 }), tone: 'good' }); } catch { el.checked = false; toast(t('lockT.notSet'), { tone: 'warn', icon: icon('warn', { size: 18 }) }); }
    } else disableLock();
  }
});

// entries that appear (Apple Pay sync, a save, an undo) slide into their list instead of popping in
let knownIds = entryIds(state.entries);
let freshIds = new Set();
subscribe((reason) => {
  if (reason === 'prefs') return;
  if (reason === 'history') { const slot = view.querySelector('.undo-slot'); if (slot) slot.innerHTML = undoButton(); return; }
  const ids = entryIds(state.entries);
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
// In Arabic (right to left) the row slides the other way, like iOS: swipe right to delete. The maths below
// is written for left-to-right; swipeSign flips what goes in (finger movement) and what comes out (transform).
const swipeSign = () => (isRTL() ? -1 : 1);
function setX(row, x, animate) {
  row.style.transition = animate && !reduceMotion() ? 'transform 0.38s cubic-bezier(0.23, 1, 0.32, 1)' : 'none';
  row.style.transform = x ? `translateX(${x * swipeSign()}px)` : '';
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
      batch(t(how === 'both' ? 'del.both' : 'del.one', { amt: money(removed.amount, removed.currency) }), () => { deleteEntry(removed.id); if (how === 'both') deleteEntry(other.id); });
      toast(t(how === 'both' ? 'del.both' : 'del.one', { amt: money(removed.amount, removed.currency) }), { action: t('common.undo'), onAction: () => doUndo(), icon: icon('trash', { size: 18 }) });
    }, reset);
    return;
  }
  const finish = () => {
    openSwipe = null;
    deleteEntry(removed.id);
    toast(t('del.one', { amt: money(removed.amount, removed.currency) }), { action: t('common.undo'), onAction: () => doUndo(), icon: icon('trash', { size: 18 }) });
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
  const dx = (e.clientX - d.x0) * swipeSign(), dy = e.clientY - d.y0;
  if (!d.on) {
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { swipeDrag = null; return; }
    if (Math.abs(dx) < 8) return;
    d.on = true;
    d.row.style.willChange = 'transform'; // own layer only for the row being dragged (a will-change rule in the stylesheet gave all 400 rows one)
    d.row.setPointerCapture?.(e.pointerId);
  }
  let x = Math.min(0, d.base + dx);
  const w = d.wrap.offsetWidth;
  if (x < -w * 0.75) x = -w * 0.75 + (x + w * 0.75) * 0.3; // resist past the full-swipe point
  setX(d.row, x, false);
  d.wrap.classList.toggle('armed', x < -w * 0.55);
  d.v = (e.clientX - d.last[1]) * swipeSign() / Math.max(1, e.timeStamp - d.last[0]) * 1000;
  d.last = [e.timeStamp, e.clientX];
});
const endSwipe = (e) => {
  const d = swipeDrag;
  swipeDrag = null;
  if (!d || !d.on) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 60);
  const x = new DOMMatrix(getComputedStyle(d.row).transform).m41 * swipeSign();
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
  else if (tab === 'home' && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) { ev.preventDefault(); stepFocus((ev.key === 'ArrowRight') !== isRTL() ? 1 : -1); }
});

/* The few words in index.html (tab names, the + button, the toast's label) follow the language too. */
function paintChrome() {
  document.querySelectorAll('.tabbar [data-tab] span').forEach((s) => { s.textContent = t(`tab.${s.parentElement.dataset.tab}`); });
  document.querySelector('.tabbar')?.setAttribute('aria-label', t('tab.sections'));
  document.querySelector('.fab')?.setAttribute('aria-label', t('tab.add'));
  document.getElementById('toast')?.setAttribute('aria-label', t('tab.message'));
}
// switching language redraws everything: the chrome, the open tab, and the droplet under the (mirrored) tab bar
onLangChange(() => { paintChrome(); render(); });
applyLang();
paintChrome();

bindHomeGestures(view);
render();
initLock();
handleDeepLink();
sync();
if (shouldAutoOpen()) openGuide();

try {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
} catch { /* not allowed in this frame */ }
