// Activity tab: every entry, grouped by day, with search, filter chips, a Filter sheet
// (account, category, period, amount), the filtered total, and Select mode for bulk edits.
import { dayKey, dayLabel, fmt, toAED, ACCOUNTS, SPEND_CATEGORIES, INCOME_CATEGORIES, allCategories, seriesColor, money } from './model.js';
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
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
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
const undoThis = (tok) => () => { if (topUndoId() === tok) doUndo(); else toast('Something changed since, so this Undo is off.'); };
const UNDO_MS = 8000; // bulk toasts stay long enough to reach Undo; the Undo button in the title still works after

export function renderActivity() {
  const n = extraCount(activityFilter);
  return `
    ${largeTitle('Activity', plural(state.entries.length, 'entry', 'entries'), syncBadge())}
    ${demoBanner()}
    <div class="search-row">
      <div class="search">${icon('search', { size: 18 })}<input type="search" placeholder="Search" value="${esc(activityFilter.q)}" aria-label="Search entries" enterkeyhint="search"></div>
      <button type="button" class="filter-btn${n ? ' on' : ''}" data-act="filters" aria-label="Filters${n ? `, ${n} on` : ''}">${icon('filter', { size: 20 })}${n ? `<span class="filter-count">${n}</span>` : ''}</button>
    </div>
    <div class="filter-chips" role="tablist" aria-label="Filter">
      ${[['all', 'All'], ['Spend', 'Spending'], ['Income', 'Income'], ['Transfer', 'Transfers'], ['review', 'Needs review']]
        .map(([k, l]) => `<button type="button" role="tab" class="fchip${activityFilter.kind === k ? ' on' : ''}" aria-selected="${activityFilter.kind === k}" data-kind="${k}">${l}</button>`).join('')}
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
  return `<div class="active-filters">${list.map(([k, l]) => `<button type="button" class="af-pill" data-clear="${k}" aria-label="Remove filter ${esc(l)}">${esc(l)}${icon('x', { size: 14 })}</button>`).join('')}
    ${list.length > 1 ? '<button type="button" class="text-btn af-clear" data-clear="all">Clear all</button>' : ''}</div>`;
}

function summaryBar(all) {
  if (activitySelect.on) {
    const n = selectedEntries().length;
    const shown = drawn(all);
    const allOn = shown.length > 0 && shown.every((e) => activitySelect.ids.has(e.id));
    const capped = all.length > shown.length;
    const msg = n ? (capped ? `Selected ${n} of ${all.length} shown` : `${n} selected`) : 'Tap entries to select';
    return `<div class="act-bar selecting" role="status"><span class="act-sum"><b>${msg}</b></span>
      <button type="button" class="text-btn" data-act="select-all">${allOn ? 'Deselect all' : `Select all ${shown.length}`}</button>
      <button type="button" class="text-btn strong" data-act="select-done">Done</button></div>`;
  }
  const t = totals(all, state.settings);
  const bits = isFiltered(activityFilter)
    ? [plural(t.count, 'entry', 'entries'),
      t.spent ? `${t.refunds ? 'Spent (before refunds)' : 'Spent'} <b class="num">AED ${fmt(t.spent, { fixed: true })}</b>` : '',
      t.refunds ? `Refunds <b class="num in">AED ${fmt(t.refunds, { fixed: true })}</b>` : '',
      t.income - t.refunds > 0.005 ? `In <b class="num in">AED ${fmt(t.income - t.refunds, { fixed: true })}</b>` : ''].filter(Boolean).join(' · ')
    : '';
  return `<div class="act-bar"><span class="act-sum">${bits}</span>${state.entries.length ? '<button type="button" class="text-btn" data-act="select">Select</button>' : ''}</div>`;
}

/* Long lists draw in pieces. The first screenful goes in straight away, the rest is added as you scroll towards it
   (an IntersectionObserver on a marker at the end of the list). 400 rows at once made every tab switch to Activity
   and every letter typed in search rebuild and restyle thousands of elements, most of them far off screen.
   `more` holds what is still to draw for the list currently on screen; it is reset on every redraw. */
const FIRST_ROWS = 40, CHUNK_ROWS = 60;
let more = null, moreObserver = null;

const dayHTML = ([k, items], sel) => {
  const spent = items.filter((e) => e.type === 'Spend').reduce((a, e) => a + toAED(e, state.settings), 0);
  return `<div class="group-head day"><h3 class="group-title">${dayLabel(k)}</h3>${spent ? `<span class="day-total num">AED ${fmt(spent, { fixed: true })}</span>` : ''}</div>
      <section class="group">${items.map((e) => entryRow(e, sel ? { selected: sel.has(e.id) } : undefined)).join('')}</section>`;
};
/** Day groups from `from` until about `rows` rows are covered: [html, next index]. */
function daysHTML(groups, from, rows) {
  const sel = activitySelect.on ? activitySelect.ids : null;
  let html = '', n = 0, i = from;
  while (i < groups.length && n < rows) { html += dayHTML(groups[i], sel); n += groups[i][1].length; i++; }
  return [html, i];
}

export function activityList(all = matches()) {
  more = null;
  const list = all.slice(0, SHOW_MAX);
  if (!list.length) {
    const why = activityFilter.q.trim() ? `Nothing matches “${esc(activityFilter.q)}”.` : isFiltered(activityFilter) ? 'Nothing matches these filters.' : 'Nothing here yet.';
    return `<div class="empty">${icon('search', { size: 28 })}<p>${why}</p></div>`;
  }
  const days = new Map();
  for (const e of list) { const k = dayKey(e.date); if (!days.has(k)) days.set(k, []); days.get(k).push(e); }
  const groups = [...days];
  const foot = all.length > SHOW_MAX ? `<p class="group-foot">Showing the newest ${SHOW_MAX} of ${all.length}. The total above covers all of them.</p>` : '';
  const [html, next] = daysHTML(groups, 0, typeof IntersectionObserver === 'function' ? FIRST_ROWS : Infinity);
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
  return `<div class="bulk-bar glass" role="toolbar" aria-label="Selected entries">
    <button type="button" class="bulk-btn" data-act="bulk-cat" ${n ? '' : 'disabled'}>${icon('tray', { size: 20 })}Category</button>
    <button type="button" class="bulk-btn danger" data-act="bulk-del" ${n ? '' : 'disabled'}>${icon('trash', { size: 20 })}Delete</button>
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
    btn.setAttribute('aria-label', `Filters${n ? `, ${n} on` : ''}`);
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
  const countLine = () => { const n = matches().length; return `Showing ${plural(n, 'entry', 'entries')}`; };
  openSheet({
    label: 'Filters',
    html: `<header class="sheet-head"><button class="text-btn" data-act="clear" type="button">Clear</button><h2 class="sheet-title">Filters</h2><button class="text-btn strong" data-act="done" type="button">Done</button></header>
      <p class="sheet-lede" aria-live="polite">${countLine()}</p>
      <div class="sheet-scroll form filter-form">
        <section class="group">
          <label class="row input-row"><span>Account</span><select name="account">${opt('', 'Any', f.account)}${accounts.map((a) => opt(a, a, f.account)).join('')}</select></label>
          <label class="row input-row"><span>Category</span><select name="category">${opt('', 'Any', f.category)}${opt(NO_CATEGORY, 'Uncategorised', f.category)}
            <optgroup label="Spending">${allCategories('Spend').map((c) => opt(c.id, c.label || c.id, f.category)).join('')}</optgroup>
            <optgroup label="Income">${incomeOnly.map((c) => opt(c.id, c.label || c.id, f.category)).join('')}</optgroup></select></label>
        </section>
        <h3 class="group-title">When</h3>
        <div class="filter-chips period-chips">${PERIODS.map(([k, l]) => `<button type="button" class="fchip${f.period === k ? ' on' : ''}" data-period="${k}" aria-pressed="${f.period === k}">${l}</button>`).join('')}</div>
        <section class="group custom-dates"${f.period === 'custom' ? '' : ' hidden'}>
          <label class="row input-row"><span>From</span><input name="from" type="date" value="${esc(f.from)}"></label>
          <label class="row input-row"><span>To</span><input name="to" type="date" value="${esc(f.to)}"></label>
        </section>
        <h3 class="group-title">Amount (AED)</h3>
        <section class="group">
          <label class="row input-row"><span>At least</span><input name="min" type="text" inputmode="decimal" placeholder="Any" value="${esc(f.min)}" autocomplete="off"></label>
          <label class="row input-row"><span>At most</span><input name="max" type="text" inputmode="decimal" placeholder="Any" value="${esc(f.max)}" autocomplete="off"></label>
        </section>
        <p class="group-foot">USD entries are compared by their AED value.</p>
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
    label: 'Change category', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Change category</h2><span class="icon-btn-spacer"></span></header>
      <div class="bulk-cat">
        ${spend.length ? `<h3 class="group-title">${plural(spend.length, 'payment')}</h3>${row(SPEND_CATEGORIES, 'Spend')}` : ''}
        ${income.length ? `<h3 class="group-title">${plural(income.length, 'income entry', 'income entries')}</h3>${row(INCOME_CATEGORIES, 'Income')}` : ''}
        ${!spend.length && !income.length ? '<p class="sheet-lede">Transfers and bank matches don’t have a category.</p>' : skipped ? `<p class="group-foot">${plural(skipped, 'transfer or bank match', 'transfers and bank matches')} will stay as they are.</p>` : ''}
      </div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act="cancel"]')) return close();
        const b = ev.target.closest('.rc-cat');
        if (!b) return;
        haptic();
        const { type, cat } = b.dataset;
        const targets = (type === 'Income' ? income : spend).filter((e) => e.category !== cat);
        const n = batch(`Moved ${plural(targets.length, 'entry', 'entries')} to ${cat}`, () => targets.forEach((e) => updateEntry(e.id, { category: cat })));
        close();
        endSelect();
        onDone();
        if (n) toast(`Moved ${plural(n, 'entry', 'entries')} to ${esc(cat)}`, { action: 'Undo', onAction: undoThis(topUndoId()), icon: icon('check', { size: 18 }), duration: UNDO_MS });
        else toast(`Already in ${esc(cat)}`, { icon: icon('check', { size: 18 }) });
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
  const t = totals(list, state.settings);
  const SHOWN_MAX = 5;
  const lines = list.slice(0, SHOWN_MAX).map((e) => `<li><span>${esc(e.merchant || e.note || e.category || e.type)}</span><b class="num">${money(toAED(e, state.settings), 'AED', { fixed: true })}</b></li>`).join('');
  const more = list.length > SHOWN_MAX ? `<li class="more">+${list.length - SHOWN_MAX} more</li>` : '';
  const what = [t.spent ? `${money(t.spent, 'AED', { fixed: true })} of spending` : '', t.income ? `${money(t.income, 'AED', { fixed: true })} of income` : ''].filter(Boolean).join(' and ');
  openSheet({
    label: 'Delete entries', tall: false,
    html: `<header class="sheet-head"><button class="text-btn" data-act="cancel" type="button">Cancel</button><h2 class="sheet-title">Delete ${plural(list.length, 'entry', 'entries')}</h2><span class="icon-btn-spacer"></span></header>
      <div class="reset-body">
        <div class="reset-icon">${icon('trash', { size: 28 })}</div>
        <p class="reset-lede">This removes <b>${plural(list.length, 'entry', 'entries')}</b>${what ? ` (${what})` : ''} from the app and the sheet. Your balances update to match.</p>
        <ul class="del-list">${lines}${more}</ul>
        ${halves.length ? `<p class="group-foot center split-warn">Includes the other half of ${halves.length === 1 ? 'a split payment' : `${halves.length} split payments`}, so nothing is left half there.</p>` : ''}
        <p class="group-foot center">You can undo it straight after.</p>
        <button type="button" class="dup-btn danger-btn solid" data-act="confirm">${icon('trash', { size: 18 })}Delete ${plural(list.length, 'entry', 'entries')}</button>
      </div>`,
    onMount(sheet, close) {
      sheet.querySelector('[data-act="cancel"]').onclick = () => close();
      sheet.querySelector('[data-act="confirm"]').onclick = () => {
        haptic();
        const n = batch(`Deleted ${plural(list.length, 'entry', 'entries')}`, () => list.forEach((e) => deleteEntry(e.id)));
        close();
        endSelect();
        onDone();
        toast(`Deleted ${plural(n, 'entry', 'entries')}`, { action: 'Undo', onAction: undoThis(topUndoId()), icon: icon('trash', { size: 18 }), duration: UNDO_MS });
      };
    },
  });
}
