// Category budgets: the maths (spent vs limit per category) and the small bits of HTML Insights and Home show.
// Pure on purpose (no store import) so tests/verify-budgets.mjs can run it in Node. The Settings sheet that
// edits limits is in budgets-settings.js. Limits live in the Extras store: { v: 1, limits: { <categoryId>: AED } }.
import { SPEND_CATEGORIES, seriesColor, fmt } from './model.js';
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

/** Name, icon and colour for a category id. An id we don't know (say, a category since removed) still shows. */
export function metaOf(id, categories = SPEND_CATEGORIES) {
  const c = categories.find((x) => x.id === id);
  return c || { id, short: id, icon: 'dots', slot: 0 };
}

/** One row per budgeted category for a cycle. `byCategory` is summarize(...).byCategory (the same spending
    Insights shows: transfers aren't spending, refunds aren't netted off). Known categories come first in
    their usual order, then unknown ids. */
export function budgetRows(byCategory, limits, categories = SPEND_CATEGORIES) {
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

/** The one row Home talks about: the fullest budget at 80% or more, or null. `more` counts the other flagged ones. */
export function worstBudget(rows) {
  const flagged = rows.filter((r) => r.status !== 'ok').sort((a, b) => b.ratio - a.ratio);
  return flagged.length ? { row: flagged[0], more: flagged.length - 1 } : null;
}

/** Sum of the limits and of what's spent against them, for the card's intro line. */
export function budgetTotals(rows) {
  return rows.reduce((t, r) => ({ limit: t.limit + r.limit, spent: t.spent + r.spent }), { limit: 0, spent: 0 });
}

const tintOf = (r) => (r.status === 'over' ? 'var(--neg)' : r.status === 'near' ? 'var(--warn)' : seriesColor(r.meta.slot));
const leftText = (r) => (r.left >= 0 ? `AED ${fmt(r.left, { whole: true })} left` : `AED ${fmt(-r.left, { whole: true })} over`);

/** Insights card. With no budgets it is a small prompt that opens Settings. */
export function budgetsCard(rows, { isCurrent = true } = {}) {
  if (!rows.length) {
    return `<section class="panel budgets-card empty-budgets">
      <h3 class="panel-title">Budgets</h3>
      <button type="button" class="budget-prompt" data-go="settings" data-anchor="budgets">
        <span class="row-icon" style="--tint:var(--tint-text)">${icon('plus', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">Set a budget</span><span class="row-sub">Give a category a limit for each cycle and watch it fill up</span></span>
        ${icon('chevR', { size: 16, cls: 'chev' })}</button>
    </section>`;
  }
  const t = budgetTotals(rows);
  return `<section class="panel budgets-card">
    <h3 class="panel-title">Budgets</h3>
    <p class="panel-sub">${isCurrent ? 'This cycle so far' : 'That cycle'}: AED ${fmt(t.spent, { whole: true })} of AED ${fmt(t.limit, { whole: true })} across ${rows.length} ${rows.length === 1 ? 'budget' : 'budgets'}.</p>
    <div class="bg-list">${rows.map((r) => `<div class="bg-row ${r.status}" style="--tint:${tintOf(r)}">
        <span class="lg-icon">${icon(r.meta.icon, { size: 16 })}</span>
        <span class="bg-name"><b>${esc(r.meta.short || r.id)}</b><small>AED ${fmt(r.spent, { whole: true })} of ${fmt(r.limit, { whole: true })}</small></span>
        <span class="bg-pct num">${pctText(r)}</span>
        <span class="bg-track" role="progressbar" aria-label="${esc(r.meta.short || r.id)} budget" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.floor(r.ratio * 100))}"><i style="--w:${Math.min(100, r.ratio * 100)}%"></i></span>
        <span class="bg-left num">${leftText(r)}</span>
      </div>`).join('')}</div>
  </section>`;
}

/** Home: at most one quiet line, for the fullest budget at 80% or more. Empty string when all is well. */
export function budgetNudge(rows) {
  const w = worstBudget(rows);
  if (!w) return '';
  const { row: r, more } = w;
  const name = esc(r.meta.short || r.id);
  const text = r.status === 'over' ? `${name} is over its budget by AED ${fmt(-r.left, { whole: true })}` : `${name} is at ${pctText(r)} of its budget`;
  return `<button type="button" class="budget-nudge ${r.status}" data-go="insights">
    <span class="bn-icon">${icon(r.status === 'over' ? 'warn' : r.meta.icon, { size: 18 })}</span>
    <span class="bn-text">${text}${more ? `<small>and ${more} more ${more === 1 ? 'budget' : 'budgets'} close</small>` : ''}</span>
    ${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
}

/** Settings rows: every spending category with its limit (or "Not set"). Tapping one opens the sheet. */
export function budgetsSettingsRows(limits, byCategory, categories = SPEND_CATEGORIES) {
  const unknown = Object.keys(limits).filter((id) => !categories.some((c) => c.id === id)).map((id) => metaOf(id, categories));
  return [...categories, ...unknown].map((c) => {
    const lim = limits[c.id];
    return `<button type="button" class="row link-row" data-budget-edit="${esc(c.id)}">
      <span class="row-icon" style="--tint:${seriesColor(c.slot)}">${icon(c.icon, { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(c.id)}</span><span class="row-sub">${lim ? `AED ${fmt((byCategory && byCategory.get(c.id)) || 0, { whole: true })} spent this cycle` : 'No limit'}</span></span>
      <b class="num${lim ? '' : ' muted'}">${lim ? fmt(lim, { whole: true }) : 'Not set'}</b>${icon('chevR', { size: 16, cls: 'chev' })}</button>`;
  }).join('');
}
