// Activity tab: every entry, grouped by day, with search, filter chips, a Filter sheet
// (account, category, period, amount), the filtered total, and Select mode for bulk edits.
import { dayKey, dayLabel, fmt, toAED, ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, allCategories, categoryMeta, seriesColor, money, amtAED } from './model.js';
import { t } from './i18n.js';
import { state, batch, updateEntry, deleteEntry, topUndoId } from './store.js';
import { splitPartner } from './people.js';
import { esc, openSheet, toast, haptic } from './ui.js';
import { icon } from './icons.js';
import { entryRow, largeTitle, syncBadge, demoBanner, doUndo } from './views.js';
import { EMPTY_FILTER, PERIODS, NO_CATEGORY, matchEntries, totals, isFiltered, extraCount, activeLabels } from './filters.js';

export const activityFilter = { ...EMPTY_FILTER };
// Select mode: which entries are ticked. Lives here so it survives redraws (a sync landing, an undo).
export const activitySelect = { on: false, ids: new Set() };

const SHOW_MAX = 400; // rows drawn at once; totals and "Select all" still cover every match
const entriesN = (n) => t('act.entries', { n }); // "1 entry", "3 entries" (Arabic has its own six forms)
const catName = (id, type) => categoryMeta(id, type)?.label || id;
const matches = () => matchEntries(state.entries, activityFilter, state.settings);
/** The rows actually drawn: the newest SHOW_MAX matches. Only these can be selected. */
const drawn = (all = matches()) => all.slice(0, SHOW_MAX);
/** Drops ticked ids that aren't drawn right now (filtered out, past the cap, or gone after a sync/undo). */
export function pruneSelection(all = matches()) {
  const seen = new Set(drawn(all).map((e) => e.id));
  for (const id of [...activitySelect.ids]) if (!seen.has(id)) activitySelect.ids.delete(id);
}
/** Ticked entries the user can see. Always re-checked against the current filter and search. */
const selectedEntries = () => { pruneSelection(); return state.entries.filter((e) => activitySelect.ids.has(e.id)); };
/** Toast Undo that only undoes the step it was made for; if something else happened since, say so instead. */
const undoThis = (tok) => () => { if (topUndoId() === tok) doUndo(); else toast(t('act.undoOff')); };
const UNDO_MS = 8000; // bulk toasts stay long enough to reach Undo; the Undo button in the title still works after

export function renderActivity() {
  const n = extraCount(activityFilter);
  return `
    ${largeTitle(t('act.title'), entriesN(state.entries.length), syncBadge())}
    ${demoBanner()}
    <div class="search-row">
      <div class="search">${icon('search', { size: 18 })}<input type="search" placeholder="${t('act.search')}" value="${esc(activityFilter.q)}" aria-label="${t('act.searchEntries')}" enterkeyhint="search"></div>
      <button type="button" class="filter-btn${n ? ' on' : ''}" data-act="filters" aria-label="${n ? t('act.filtersOn', { n }) : t('act.filters')}">${icon('filter', { size: 20 })}${n ? `<span class="filter-count">${n}</span>` : ''}</button>
    </div>
    <div class="filter-chips" role="radiogroup" aria-label="${t('act.show')}">
      ${[['all', t('act.all')], ['Spend', t('act.spending')], ['Income', t('act.income')], ['Transfer', t('act.transfers')], ['review', t('rev.needs')]]
        .map(([k, l]) => `<button type="button" role="radio" class="fchip${activityFilter.kind === k ? ' on' : ''}" aria-checked="${activityFilter.kind === k}" data-kind="${k}">${l}</button>`).join('')}
    </div>
    <div class="activity-body">${activityBody()}</div>`;
}

/** Everything under the chips: filter pills, the total bar, the list and (in Select mode) the action bar. */
export function activityBody() {
  const all = matches();
  if (activitySelect.on) pruneSelection(all);
  return `${pills()}${summaryBar(all)}<div class="activity-list">${activityList(all)}</div>${bulkBar()}`;
}

function pills() {
  const list = activeLabels(activityFilter);
  if (!list.length) return '';
  return `<div class="active-filters">${list.map(([k, l]) => `<button type="button" class="af-pill" data-clear="${k}" aria-label="${t('act.removeFilter', { what: esc(l) })}">${esc(l)}${icon('x', { size: 14 })}</button>`).join('')}
    ${list.length > 1 ? '<button type="button" class="text-btn af-clear" data-clear="all">' + t('act.clearAll') + '</button>' : ''}</div>`;
}

function summaryBar(all) {
  if (activitySelect.on) {
    const n = selectedEntries().length;
    const shown = drawn(all);
    const allOn = shown.length > 0 && shown.every((e) => activitySelect.ids.has(e.id));
    const capped = all.length > shown.length;
    const msg = n ? (capped ? t('act.selOf', { n, total: all.length }) : t('act.selN', { n })) : t('act.tapToSelect');
    return `<div class="act-bar selecting" role="status"><span class="act-sum"><b>${msg}</b></span>
      <button type="button" class="text-btn" data-act="select-all">${allOn ? t('act.deselectAll') : t('act.selectAllN', { n: shown.length })}</button>
      <button type="button" class="text-btn strong" data-act="select-done">${t('common.done')}</button></div>`;
  }
  const tot = totals(all, state.settings);
  const bits = isFiltered(activityFilter)
    ? [entriesN(tot.count),
      tot.spent ? `${tot.refunds ? t('act.spentBefore') : t('act.spent')} <b class="num">${amtAED(fmt(tot.spent, { fixed: true }))}</b>` : '',
      tot.refunds ? `${t('act.refunds')} <b class="num in">${amtAED(fmt(tot.refunds, { fixed: true }))}</b>` : '',
      tot.income - tot.refunds > 0.005 ? `${t('act.in')} <b class="num in">${amtAED(fmt(tot.income - tot.refunds, { fixed: true }))}</b>` : ''].filter(Boolean).join(' · ')
    : '';
  return `<div class="act-bar"><span class="act-sum">${bits}</span>${state.entries.length ? '<button type="button" class="text-btn" data-act="select">' + t('act.select') + '</button>' : ''}</div>`;
}

/* Long lists draw in pieces. The first screenful goes in straight away, the rest is added as you scroll towards it
   (an IntersectionObserver on a marker at the end of the list). 400 rows at once made every tab switch to Activity
   and every letter typed in search rebuild and restyle thousands of elements, most of them far off screen.
   `more` holds what is still to draw for the list currently on screen; it is reset on every redraw. */
const FIRST_ROWS = 40, CHUNK_ROWS = 60;
let more = null, moreObserver = null;
// How many rows have been drawn for the current search/filter. A redraw (selection, a sync, an edit, a delete) draws at least
// that many again, so the list keeps its length and you keep your place. Reset when the filter or search changes, or the tab is entered afresh.
let drawnRows = 0, drawnFor = '';
export function resetActivityRows() { drawnRows = 0; drawnFor = ''; }

const dayHTML = ([k, items], sel) => {
  const spent = items.filter((e) => e.type === 'Spend').reduce((a, e) => a + toAED(e, state.settings), 0);
  return `<div class="group-head day"><h3 class="group-title">${dayLabel(k)}</h3>${spent ? `<span class="day-total num">${amtAED(fmt(spent, { fixed: true }))}</span>` : ''}</div>
      <section class="group">${items.map((e) => entryRow(e, sel ? { selected: sel.has(e.id) } : undefined)).join('')}</section>`;
};
/** Day groups from `from` until about `rows` rows are covered: [html, next index]. */
function daysHTML(groups, from, rows) {
  const sel = activitySelect.on ? activitySelect.ids : null;
  let html = '', n = 0, i = from;
  while (i < groups.length && n < rows) { html += dayHTML(groups[i], sel); n += groups[i][1].length; i++; }
  drawnRows = Math.max(drawnRows, (from ? drawnRows : 0) + n); // rows on screen so far
  return [html, i];
}

export function activityList(all = matches()) {
  more = null;
  const list = all.slice(0, SHOW_MAX);
  if (!list.length) {
    const why = activityFilter.q.trim() ? t('act.noMatchQ', { q: esc(activityFilter.q) }) : isFiltered(activityFilter) ? t('act.noMatchF') : t('act.nothingYet');
    return `<div class="empty">${icon('search', { size: 28 })}<p>${why}</p></div>`;
  }
  const days = new Map();
  for (const e of list) { const k = dayKey(e.date); if (!days.has(k)) days.set(k, []); days.get(k).push(e); }
  const groups = [...days];
  const foot = all.length > SHOW_MAX ? `<p class="group-foot">${t('act.newest', { n: SHOW_MAX, total: all.length })}</p>` : '';
  const key = JSON.stringify(activityFilter);
  if (key !== drawnFor) { drawnFor = key; drawnRows = 0; }
  const want = Math.max(FIRST_ROWS, drawnRows);
  drawnRows = 0;
  const [html, next] = daysHTML(groups, 0, typeof IntersectionObserver === 'function' ? want : Infinity);
  if (next >= groups.length) return html + foot;
  more = { groups, next, foot };
  return `${html}<div class="act-more" aria-hidden="true"></div>`;
}

/** Call after the list is in the page: starts adding the rest of a long list as it is scrolled towards. */
export function hydrateActivity(view) {
  moreObserver?.disconnect();
  moreObserver = null;
  const marker = view.querySelector('.act-more');
  if (!marker || !more) return;
  const mine = more;
  const add = () => {
    if (more !== mine || !marker.isConnected) return;
    const [html, next] = daysHTML(mine.groups, mine.next, CHUNK_ROWS);
    mine.next = next;
    marker.insertAdjacentHTML('beforebegin', html);
    if (next >= mine.groups.length) { marker.insertAdjacentHTML('beforebegin', mine.foot); marker.remove(); moreObserver?.disconnect(); more = null; return; }
    moreObserver.unobserve(marker); moreObserver.observe(marker); // asks again: the marker may still be near the screen
  };
  moreObserver = new IntersectionObserver((hits) => { if (hits.some((h) => h.isIntersecting)) add(); }, { rootMargin: '1600px 0px' });
  moreObserver.observe(marker);
}

function bulkBar() {
  if (!activitySelect.on) return '';
  const n = selectedEntries().length;
  return `<div class="bulk-bar glass" role="toolbar" aria-label="${t('act.selectedEntries')}">
    <button type="button" class="bulk-btn" data-act="bulk-cat" ${n ? '' : 'disabled'}>${icon('tray', { size: 20 })}${t('act.category')}</button>
    <button type="button" class="bulk-btn danger" data-act="bulk-del" ${n ? '' : 'disabled'}>${icon('trash', { size: 20 })}${t('common.delete')}</button>
  </div>`;
}

/* ───── Actions, called from main.js's click handler ───── */

/** Redraws only the part under the chips, so the search field keeps focus and the page keeps its scroll. */
export function refreshActivity(view) {
  const body = view.querySelector('.activity-body');
  if (body) { body.innerHTML = activityBody(); hydrateActivity(view); }
  const btn = view.querySelector('.filter-btn');
  if (btn) {
    const n = extraCount(activityFilter);
    btn.classList.toggle('on', !!n);
    btn.setAttribute('aria-label', `${n ? t('act.filtersOn', { n }) : t('act.filters')}`);
    btn.innerHTML = `${icon('filter', { size: 20 })}${n ? `<span class="filter-count">${n}</span>` : ''}`;
  }
  syncSelectingClass();
}

/** While selecting, the tab bar makes way for the action bar (like Photos on iPhone). */
export function syncSelectingClass(onActivity = true) {
  document.documentElement.classList.toggle('selecting', onActivity && activitySelect.on);
}

export function startSelect() { activitySelect.on = true; activitySelect.ids.clear(); }
export function endSelect() { activitySelect.on = false; activitySelect.ids.clear(); syncSelectingClass(false); }

export function toggleSelected(id) {
  if (activitySelect.ids.has(id)) activitySelect.ids.delete(id); else activitySelect.ids.add(id);
}

export function selectAll() {
  const shown = drawn();
  const allOn = shown.length > 0 && shown.every((e) => activitySelect.ids.has(e.id));
  if (allOn) activitySelect.ids.clear(); else shown.forEach((e) => activitySelect.ids.add(e.id));
}

export function clearFilter(key) {
  if (key === 'all') { Object.assign(activityFilter, { ...EMPTY_FILTER, q: activityFilter.q, kind: activityFilter.kind }); return; }
  if (key === 'account') activityFilter.account = '';
  if (key === 'category') activityFilter.category = '';
  if (key === 'period') Object.assign(activityFilter, { period: 'all', from: '', to: '' });
  if (key === 'amount') Object.assign(activityFilter, { min: '', max: '' });
}

/** The Filter sheet. Every change applies at once; the list behind updates as you go. */
export function openFilters(onChange) {
  const f = activityFilter;
  // accounts in use, plus any old (archived) ones that still have entries
  const accounts = [...new Set([...ACCOUNTS.map((a) => a.id), ...state.entries.flatMap((e) => [e.account, e.toAccount]).filter(Boolean)])];
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  // every category, hidden ones too, so old entries can still be found
  const incomeOnly = allCategories('Income').filter((c) => !allCategories('Spend').some((s) => s.id === c.id));
  const countLine = () => { const n = matches().length; return t('act.showing', { what: entriesN(n) }); };
  openSheet({
    label: t('act.filters'),
    html: `<header class="sheet-head"><button class="text-btn" data-act="clear" type="button">${t('act.clear')}</button><h2 class="sheet-title">${t('act.filters')}</h2><button class="text-btn strong" data-act="done" type="button">${t('common.done')}</button></header>
      <p class="sheet-lede" aria-live="polite">${countLine()}</p>
      <div class="sheet-scroll form filter-form">
        <section class="group">
          <label class="row input-row"><span>${t('act.account')}</span><select name="account">${opt('', t('act.any'), f.account)}${accounts.map((a) => opt(a, a, f.account)).join('')}</select></label>
          <label class="row input-row"><span>${t('act.category')}</span><select name="category">${opt('', t('act.any'), f.category)}${opt(NO_CATEGORY, t('act.uncat'), f.category)}
            <optgroup label="${t('act.spending')}">${allCategories('Spend').map((c) => opt(c.id, c.label || c.id, f.category)).join('')}</optgroup>
            <optgroup label="${t('act.income')}">${incomeOnly.map((c) => opt(c.id, c.label || c.id, f.category)).join('')}</optgroup></select></label>
        </section>
        <h3 class="group-title">${t('act.when')}</h3>
        <div class="filter-chips period-chips">${PERIODS.map(([k, l]) => `<button type="button" class="fchip${f.period === k ? ' on' : ''}" data-period="${k}" aria-pressed="${f.period === k}">${t(`period.${k}`)}</button>`).join('')}</div>
        <section class="group custom-dates"${f.period === 'custom' ? '' : ' hidden'}>
          <label class="row input-row"><span>${t('act.from')}</span><input name="from" type="date" value="${esc(f.from)}"></label>
          <label class="row input-row"><span>${t('act.to')}</span><input name="to" type="date" value="${esc(f.to)}"></label>
        </section>
        <h3 class="group-title">${t('act.amountAed')}</h3>
        <section class="group">
          <label class="row input-row"><span>${t('act.atLeast')}</span><input name="min" type="text" inputmode="decimal" placeholder="${t('act.any')}" value="${esc(f.min)}" autocomplete="off"></label>
          <label class="row input-row"><span>${t('act.atMost')}</span><input name="max" type="text" inputmode="decimal" placeholder="${t('act.any')}" value="${esc(f.max)}" autocomplete="off"></label>
        </section>
        <p class="group-foot">${t('act.usdNote')}</p>
      </div>`,
    onMount(sheet, close) {
      const changed = () => { sheet.querySelector('.sheet-lede').textContent = countLine(); onChange(); };
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="done"]')) return close();
        if (ev.target.closest('[data-act="clear"]')) {
          clearFilter('all');
          sheet.querySelectorAll('select').forEach((s) => { s.value = ''; });
          sheet.querySelectorAll('input').forEach((i) => { i.value = ''; });
          setPeriod('all');
          haptic();
          return changed();
        }
        const p = ev.target.closest('[data-period]');
        if (p) { setPeriod(p.dataset.period); haptic(); changed(); }
      });
      const setPeriod = (k) => {
        f.period = k;
        sheet.querySelectorAll('[data-period]').forEach((b) => { b.classList.toggle('on', b.dataset.period === k); b.setAttribute('aria-pressed', b.dataset.period === k); });
        sheet.querySelector('.custom-dates').hidden = k !== 'custom';
      };
      sheet.addEventListener('input', (ev) => {
        const el = ev.target;
        if (!el.name || !(el.name in f)) return;
        // amounts: keep digits and one dot, so "1,200" or "AED 50" still work
        f[el.name] = el.name === 'min' || el.name === 'max' ? el.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : el.value;
        changed();
      });
    },
  });
}

/** Pick a category for every ticked entry. Spending and income have different lists, so each type gets its own row. */
export function openBulkCategory(onDone) {
  const list = selectedEntries();
  const spend = list.filter((e) => e.type === 'Spend'), income = list.filter((e) => e.type === 'Income');
  const skipped = list.length - spend.length - income.length; // transfers and bank matches have no category
  const row = (cats, type) => `<div class="rc-cats">${cats.map((c) => `<button type="button" class="rc-cat" data-type="${type}" data-cat="${esc(c.id)}" style="--cat:${type === 'Income' ? 'var(--good)' : seriesColor(c.slot)}">${icon(c.icon, { size: 16 })}${esc(c.short)}</button>`).join('')}</div>`;
  openSheet({
    label: t('act.changeCat'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${t('act.changeCat')}</h2><span class="icon-btn-spacer"></span></header>
      <div class="bulk-cat">
        ${spend.length ? `<h3 class="group-title">${t('act.payments', { n: spend.length })}</h3>${row(SPEND_CATEGORIES, 'Spend')}` : ''}
        ${income.length ? `<h3 class="group-title">${t('act.incomeEntries', { n: income.length })}</h3>${row(INCOME_CATEGORIES, 'Income')}` : ''}
        ${!spend.length && !income.length ? '<p class="sheet-lede">' + t('act.noCat') + '</p>' : skipped ? `<p class="group-foot">${t('act.skipStay', { n: skipped })}</p>` : ''}
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="cancel"]')) return close();
        const b = ev.target.closest('.rc-cat');
        if (!b) return;
        haptic();
        const { type, cat } = b.dataset;
        const targets = (type === 'Income' ? income : spend).filter((e) => e.category !== cat);
        const n = batch(t('act.movedTo', { what: entriesN(targets.length), cat: catName(cat, type) }), () => targets.forEach((e) => updateEntry(e.id, { category: cat })));
        close();
        endSelect();
        onDone();
        if (n) toast(t('act.movedTo', { what: entriesN(n), cat: esc(catName(cat, type)) }), { action: t('common.undo'), onAction: undoThis(topUndoId()), icon: icon('check', { size: 18 }), duration: UNDO_MS });
        else toast(t('act.already', { cat: esc(catName(cat, type)) }), { icon: icon('check', { size: 18 }) });
      });
    },
  });
}

/** Ask once, then delete every ticked entry as one undoable step. */
export function openBulkDelete(onDone) {
  const ticked = selectedEntries();
  if (!ticked.length) return;
  // a split payment goes as a whole: the other half of a ticked half goes too (same undo step)
  const ids = new Set(ticked.map((e) => e.id));
  const halves = [];
  for (const e of ticked) {
    const o = splitPartner(e, state.entries);
    if (o && !ids.has(o.id)) { ids.add(o.id); halves.push(o); }
  }
  const list = [...ticked, ...halves];
  const tot = totals(list, state.settings);
  const SHOWN_MAX = 5;
  const lines = list.slice(0, SHOWN_MAX).map((e) => `<li><span>${esc(e.merchant || e.note || e.category || e.type)}</span><b class="num">${money(toAED(e, state.settings), 'AED', { fixed: true })}</b></li>`).join('');
  const more = list.length > SHOWN_MAX ? `<li class="more">${t('act.more', { n: list.length - SHOWN_MAX })}</li>` : '';
  const what = [tot.spent ? t('act.ofSpending', { amt: money(tot.spent, 'AED', { fixed: true }) }) : '', tot.income ? t('act.ofIncome', { amt: money(tot.income, 'AED', { fixed: true }) }) : ''].filter(Boolean).join(` ${t('act.and')} `);
  openSheet({
    label: t('act.deleteEntries'), tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">${t('common.cancel')}</button><h2 class="sheet-title">${t('act.deleteN', { what: entriesN(list.length) })}</h2><span class="icon-btn-spacer"></span></header>
      <div class="reset-body">
        <div class="reset-icon">${icon('trash', { size: 28 })}</div>
        <p class="reset-lede">${t('act.removes', { what: entriesN(list.length), detail: what ? ` (${what})` : '' })}</p>
        <ul class="del-list">${lines}${more}</ul>
        ${halves.length ? `<p class="group-foot center split-warn">${t('act.halves', { n: halves.length })}</p>` : ''}
        <p class="group-foot center">${t('act.canUndo')}</p>
        <button type="button" class="dup-btn danger-btn solid" data-act="confirm">${icon('trash', { size: 18 })}${t('act.deleteN', { what: entriesN(list.length) })}</button>
      </div>`,
    onMount(sheet, close) {
      sheet.querySelector('[data-act="cancel"]').onclick = () => close();
      sheet.querySelector('[data-act="confirm"]').onclick = () => {
        haptic();
        const n = batch(t('act.deletedN', { what: entriesN(list.length) }), () => list.forEach((e) => deleteEntry(e.id)));
        close();
        endSelect();
        onDone();
        toast(t('act.deletedN', { what: entriesN(n) }), { action: t('common.undo'), onAction: undoThis(topUndoId()), icon: icon('trash', { size: 18 }), duration: UNDO_MS });
      };
    },
  });
}
