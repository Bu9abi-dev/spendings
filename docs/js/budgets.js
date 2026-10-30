// Category budgets (called "Category limits" in Settings and "Category budgets" in Insights): the maths
// (spent vs limit per category) and the small bits of HTML Insights and Home show.
// Pure on purpose (no store import) so tests/verify-budgets.mjs can run it in Node. The Settings sheet that
// edits limits is in budgets-settings.js. Limits live in the Extras store: { v: 1, limits: { <categoryId>: AED } }.
import { allCategories, SPEND_CATEGORIES, seriesColor, fmt } from './model.js';
import { esc } from './ui.js';
import { icon } from './icons.js';

export const BUDGETS_KEY = 'budgets';
export const NEAR = 0.8; // 80% of the limit: "close"
export const OVER = 1;   // 100%: "over"

/** The limits map out of the saved Extras value. Anything that isn't a positive number is dropped. */
export function limitsOf(saved) {
  const out = {};
  const raw = saved && typeof saved === 'object' && saved.limits && typeof saved.limits === 'object' ? saved.limits : {};
  for (const [id, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[id] = Math.round(n * 100) / 100;
  }
  return out;
}

/** ok below 80%, near from 80%, over from 100%. */
export function statusOf(spent, limit) {
  const p = limit > 0 ? spent / limit : 0;
  return p >= OVER ? 'over' : p >= NEAR ? 'near' : 'ok';
}

/** Every spending category, hidden ones too, so a limit on a hidden or renamed category keeps its icon, colour and name. */
const allSpend = () => allCategories('Spend');

/** Name, icon and colour for a category id. An id we don't know (say, a category since deleted) still shows. */
export function metaOf(id, categories = allSpend()) {
  const c = categories.find((x) => x.id === id);
  return c || { id, short: id, label: id, icon: 'dots', slot: 0 };
}
/** The name to show: the renamed label, else the id. (Escape it where it goes into HTML.) */
export const nameOf = (meta) => meta.label || meta.id;

/** One row per limited category for a cycle. `byCategory` is summarize(...).byCategory (the same spending
    Insights shows: transfers aren't spending, refunds aren't netted off). Known categories come first in
    their usual order, then unknown ids. */
export function budgetRows(byCategory, limits, categories = allSpend()) {
  const ids = Object.keys(limits);
  const order = (id) => { const i = categories.findIndex((c) => c.id === id); return i < 0 ? categories.length : i; };
  ids.sort((a, b) => order(a) - order(b));
  return ids.map((id) => {
    const limit = limits[id];
    const spent = byCategory.get(id) || 0;
    const ratio = spent / limit;
    return { id, meta: metaOf(id, categories), limit, spent, ratio, left: limit - spent, status: statusOf(spent, limit) };
  });
}

/** Whole-number percent for display. Rounded down, so "99%" never sits beside a red "over". */
export const pctText = (r) => `${Math.floor(r.ratio * 100)}%`;

/** The row Home talks about: the fullest limit at 80% or more, or null. `more` counts the other flagged ones. */
export function worstBudget(rows) {
  const flagged = rows.filter((r) => r.status !== 'ok').sort((a, b) => b.ratio - a.ratio);
  return flagged.length ? { row: flagged[0], more: flagged.length - 1 } : null;
}

/** Sum of the limits and of what's spent against them, for the card's intro line. */
export function budgetTotals(rows) {
  return rows.reduce((t, r) => ({ limit: t.limit + r.limit, spent: t.spent + r.spent }), { limit: 0, spent: 0 });
}

/** Dirhams for a "left" or "over" figure: whole numbers, except under 1 AED, which shows its cents so a red row never reads "0 over". */
const gap = (n) => (n > 0 && n < 1 ? n.toFixed(2) : fmt(n, { whole: true }));
const AT_LIMIT = 0.005;
const tintOf = (r) => (r.status === 'over' ? 'var(--neg)' : r.status === 'near' ? 'var(--warn)' : seriesColor(r.meta.slot));
export function leftText(r) {
  if (Math.abs(r.left) < AT_LIMIT) return 'At the limit';
  return r.left > 0 ? `AED ${gap(r.left)} left` : `AED ${gap(-r.left)} over`;
}

/** Insights card ("Category budgets"). With no limits it is a small prompt that opens Settings. */
export function budgetsCard(rows, { isCurrent = true } = {}) {
  if (!rows.length) {
    return `<section class="panel budgets-card empty-budgets">
      <h3 class="panel-title">Category budgets</h3>
      <button type="button" class="budget-prompt" data-go="settings" data-anchor="budgets">
        <span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Set a category limit</span><span class="row-sub">Give a category a limit for each cycle and watch it fill up</span></span>
        ${icon('chevR', { size: 16, cls: 'chev' })}</button>
    </section>`;
  }
  const t = budgetTotals(rows);
  return `<section class="panel budgets-card">
    <h3 class="panel-title">Category budgets</h3>
    <p class="panel-sub">${isCurrent ? 'This cycle so far' : 'That cycle'}: AED ${fmt(t.spent, { whole: true })} of AED ${fmt(t.limit, { whole: true })} across ${rows.length} ${rows.length === 1 ? 'category' : 'categories'}.</p>
    <div class="bg-list">${rows.map((r) => `<div class="bg-row ${r.status}" style="--tint:${tintOf(r)}">
        <span class="lg-icon">${icon(r.meta.icon, { size: 16 })}</span>
        <span class="bg-name"><b>${esc(nameOf(r.meta))}</b><small>AED ${fmt(r.spent, { whole: true })} of ${fmt(r.limit, { whole: true })}</small></span>
        <span class="bg-pct num">${pctText(r)}</span>
        <span class="bg-track" role="progressbar" aria-label="${esc(nameOf(r.meta))} limit" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.floor(r.ratio * 100))}" aria-valuetext="AED ${fmt(r.spent, { whole: true })} of ${fmt(r.limit, { whole: true })}"><i style="--w:${Math.min(100, r.ratio * 100)}%"></i></span>
        <span class="bg-left num">${leftText(r)}</span>
      </div>`).join('')}</div>
  </section>`;
}

/** The one thing Home might say about limits. Pure, so a later change can pick the most urgent notice across
    features. Returns { priority: 'over' | 'near', text, row, more } or null. `text` is plain (escape it when
    it goes into HTML). Only the current cycle gets a notice. */
export function budgetNotice(rows, { isCurrent = true } = {}) {
  if (!isCurrent) return null;
  const w = worstBudget(rows);
  if (!w) return null;
  const { row: r, more } = w;
  const name = nameOf(r.meta);
  const main = r.status === 'over'
    ? (Math.abs(r.left) < AT_LIMIT ? `${name} has reached its limit` : `${name} is over its limit by AED ${gap(-r.left)}`)
    : `${name} is at ${pctText(r)} of its limit`;
  return { priority: r.status, text: more ? `${main}, and ${more} more ${more === 1 ? 'is' : 'are'} close or over` : main, row: r, more };
}

/** Home: the notice as a quiet tappable line. Empty string when all is well or it isn't the current cycle.
    Tapping opens Insights on the current cycle. */
export function budgetNudge(rows, opts) {
  const n = budgetNotice(rows, opts);
  if (!n) return '';
  return `<button type="button" class="budget-nudge ${n.priority}" data-go="insights" data-reset-insights="1">
    <span class="bn-icon">${icon(n.priority === 'over' ? 'warn' : n.row.meta.icon, { size: 18 })}</span>
    <span class="bn-text">${esc(n.text)}</span>
    ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
}

/** Settings rows: only the categories that have a limit, then an "Add a limit" row. */
export function budgetsSettingsRows(limits, byCategory, categories = allSpend()) {
  const rows = budgetRows(byCategory || new Map(), limits, categories);
  const list = rows.map((r) => `<button type="button" class="row link-row" data-budget-edit="${esc(r.id)}">
      <span class="row-icon" style="--tint:${seriesColor(r.meta.slot)}">${icon(r.meta.icon, { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(nameOf(r.meta))}</span><span class="row-sub">AED ${fmt(r.spent, { whole: true })} spent this cycle</span></span>
      <b class="num">${fmt(r.limit, { whole: true })}</b>${icon('chevR', { size: 16, cls: 'chev' })}</button>`).join('');
  return `${list}<button type="button" class="row link-row" data-budget-add="1">
      <span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
      <span class="row-main"><span class="row-title">Add a limit</span><span class="row-sub">${rows.length ? 'Pick another category' : 'Pick a category to keep an eye on'}</span></span></button>`;
}

/** The categories you can still add a limit to: the ones shown in lists, minus those that already have one. */
export const addableCategories = (limits, shown = SPEND_CATEGORIES) => shown.filter((c) => !(c.id in limits));
