// Weekly summary on screen: the Home line (and the allowance pace line), the "Your week" sheet and the Insights
// "Last week" card. The maths is in weekly.js.
//
// "Seen" is saved in the Extras key `weekly` as { v: 1, seen: '<Monday of the week summarised>', pace: { cycle, outDay } }
// with { undoable: false }: opening a summary or tapping the pace alert isn't something to undo, and an Undo step for it
// would sit on top of the real last change. It syncs like any extra. The week line shows Mondays and Tuesdays only, so it
// also clears itself; the pace alert stays quiet for that cycle until the day it runs out moves 3 or more days earlier.
import { categoryMeta, seriesColor, homeNumbers, fmt } from './model.js';
import { state, getExtra, saveExtra } from './store.js';
import { openSheet, haptic, esc } from './ui.js';
import { icon } from './icons.js';
import { readBnpl, shortDay } from './bnpl.js';
import { currentLimits } from './budgets-settings.js';
import { weeklySummary, paceAlert, paceSeen, summaryDue, summaryLine, categoryLabel } from './weekly.js';

export const WEEKLY_KEY = 'weekly';
const aed = (n) => `AED ${fmt(n, { whole: true })}`;
const stored = () => { const v = getExtra(WEEKLY_KEY, null); return v && typeof v === 'object' ? v : {}; };
const seen = () => String(stored().seen || '');
/** Save part of the `weekly` extra, keeping the rest (quietly: not an Undo step). */
const saveWeekly = (patch, label) => saveExtra(WEEKLY_KEY, { ...stored(), v: 1, ...patch }, label, { undoable: false });

/** Home's own numbers right now (the same call renderHome makes), so the alert and the sheet read the same summary as Home. */
const homeNow = (now = new Date()) => homeNumbers(state.entries, state.plan, state.settings, now, state.dismissed);

/** The summary as of now, from what's on the phone. */
export function currentSummary(now = new Date()) {
  return weeklySummary({
    entries: state.entries, settings: state.settings, plan: state.plan, now,
    ignored: getExtra('recurring', { v: 1, ignored: [] }).ignored || [],
    plans: readBnpl(getExtra('bnpl', null)).plans, limits: currentLimits(),
  });
}

const catIcon = (id) => categoryMeta(id)?.icon || (id === 'Uncategorised' ? 'tray' : 'dots');
const catTint = (id) => (id === 'Uncategorised' ? 'var(--warn)' : seriesColor(categoryMeta(id)?.slot || 0));

/* ───── Home ───── */

/** Home's candidates from this feature, for homeNotice() in home.js (which shows only the most urgent one):
    [{ rank: 'pace:out', html }, { rank: 'week:summary', html }], each only when it has something to say.
    `m` is Home's numbers (homeNumbers: its adjusted summary and m.pace), `isCurrent` false for a past cycle. */
export function weeklyHomeNotices(m, isCurrent, now = new Date()) {
  const found = [];
  const pace = isCurrent ? paceAlert(m.pace, now) : null;
  if (pace && !paceSeen(pace, m.cyc, stored().pace)) {
    found.push({ rank: 'pace:out', html: `<button type="button" class="sub-line wk-line warn" data-go="insights" data-reset-insights="1" data-anchor="pace" data-pace-seen="${esc(m.cyc)}|${esc(pace.outDay)}">${icon('warn', { size: 16 })}<span>${esc(pace.text)}</span>${icon('chevR', { size: 14, cls: 'chev' })}</button>` });
  }
  if (summaryDue(now, seen())) {
    const s = currentSummary(now);
    if (s.hasData) {
      found.push({ rank: 'week:summary', html: `<button type="button" class="sub-line wk-line" data-weekly="open">${icon('calendar', { size: 16 })}<span class="num">${esc(summaryLine(s.spent, s.vs, aed, s.refunds))}</span>${icon('chevR', { size: 14, cls: 'chev' })}</button>` });
    }
  }
  return found;
}

/* ───── Your week sheet ───── */

const range = (w) => `${shortDay(w.from)} – ${shortDay(w.to)}`;

function sheetBody(s, pace) {
  const vsText = !s.vs ? 'Not enough weeks yet to say what is usual.'
    : s.vs.tone === 'same' ? `About the usual week (AED ${fmt(s.vs.usual, { whole: true })}).`
    : `${aed(Math.abs(s.vs.delta))} ${s.vs.tone === 'more' ? 'more' : 'less'} than the usual week (AED ${fmt(s.vs.usual, { whole: true })}).`;
  const top = s.top.map((c) => `<div class="row"><span class="row-icon" style="--tint:${catTint(c.id)}">${icon(catIcon(c.id), { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(c.label)}</span></span><b class="num">${fmt(c.amount, { whole: true })}</b></div>`).join('');
  const big = s.biggest;
  const c = s.coming;
  const comingRows = [
    ...c.bnpl.map((x) => `<div class="row"><span class="row-icon" style="--tint:${x.overdue ? 'var(--warn)' : 'var(--tint-text)'}">${icon(x.overdue ? 'warn' : 'calendar', { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(x.name || 'Buy now, pay later')}</span><span class="row-sub">${x.overdue ? `Overdue since ${shortDay(x.due)}` : `Pay later · due ${shortDay(x.due)}`}</span></span><b class="num">${fmt(x.amount)}</b></div>`),
    ...c.subs.map((x) => `<div class="row"><span class="row-icon" style="--tint:var(--series-other)">${icon('calendar', { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(x.name)}</span><span class="row-sub">Subscription · ${shortDay(x.day)}</span></span><b class="num">${fmt(x.amount)}</b></div>`),
  ].join('');
  // budgets run for the whole cycle, not the week, so they get their own heading
  const budgetRowsHTML = [
    ...c.budgets.map((x) => `<div class="row"><span class="row-icon" style="--tint:${x.status === 'over' ? 'var(--neg)' : 'var(--warn)'}">${icon(catIcon(x.id), { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(x.label)}</span><span class="row-sub">${x.status === 'over' ? 'Over its limit' : `At ${Math.floor(x.ratio * 100)}% of its limit`}</span></span><b class="num ${x.status === 'over' ? 'nw-neg' : ''}">${x.left >= 0 ? `${fmt(x.left, { whole: true })} left` : `${fmt(-x.left, { whole: true })} over`}</b></div>`),
  ].join('');
  return `<div class="wk-hero"><span>${esc(range(s.week))}</span><b class="num">${aed(s.spent)}</b>${s.refunds > 0 ? `<small>spent before refunds (${aed(s.refunds)} refunded)</small>` : ''}<small>${esc(vsText)}</small></div>
    ${pace ? `<p class="wk-pace">${icon('warn', { size: 16 })}<span>${esc(pace.text)}</span></p>` : ''}
    <div class="group-head"><h3 class="group-title">Top categories</h3></div>
    <section class="group">${top || '<div class="empty"><p>Nothing last week.</p></div>'}</section>
    ${big ? `<div class="group-head"><h3 class="group-title">Biggest payment</h3></div>
    <section class="group"><div class="row"><span class="row-icon" style="--tint:${catTint(big.category)}">${icon(catIcon(big.category), { size: 20 })}</span>
      <span class="row-main"><span class="row-title">${esc(big.merchant || categoryLabel(big.category))}</span><span class="row-sub">${esc(categoryLabel(big.category))} · ${shortDay(big.day)}</span></span><b class="num">${fmt(big.amount, { whole: true })}</b></div></section>` : ''}
    <div class="group-head"><h3 class="group-title">Coming up this week</h3></div>
    <section class="group">${comingRows || '<div class="empty"><p>Nothing due this week.</p></div>'}</section>
    ${budgetRowsHTML ? `<div class="group-head"><h3 class="group-title">Budgets this cycle</h3></div>
    <section class="group">${budgetRowsHTML}</section>` : ''}`;
}

/** Open "Your week". Marks the week as seen (quietly: not an Undo step). The pace line uses Home's own numbers. */
export function openWeek(now = new Date()) {
  const s = currentSummary(now);
  const pace = paceAlert(homeNow(now).pace, now);
  if (summaryDue(now, seen(), s.week)) saveWeekly({ seen: s.week.key }, 'Opened Your week');
  openSheet({
    label: 'Your week',
    html: `<header class="sheet-head"><span class="icon-btn-spacer"></span><h2 class="sheet-title">Your week</h2><button class="text-btn strong" data-wk-act="done" type="button">Done</button></header>
      <div class="sheet-scroll wk-sheet">${sheetBody(s, pace)}</div>`,
    onMount(sheet, close) {
      sheet.addEventListener('click', (ev) => { if (ev.target.closest('[data-wk-act="done"]')) close(); });
    },
  });
}

/** Taps on the Home lines and the Insights card. Returns true when handled. The pace alert is marked seen here and
    returns false, so main.js's data-go handler still opens Insights at the pace card. */
export function weeklyClick(t) {
  const paceBtn = t.closest('[data-pace-seen]');
  if (paceBtn) {
    const [cycle, outDay] = paceBtn.dataset.paceSeen.split('|');
    saveWeekly({ pace: { cycle, outDay } }, 'Saw the allowance pace alert');
    return false;
  }
  if (!t.closest('[data-weekly]')) return false;
  haptic();
  openWeek();
  return true;
}

/* ───── Insights ───── */

/** "Last week" card for the current cycle: spent against the usual, the top categories, and a way into the sheet. */
export function weeklyCard() {
  const s = currentSummary();
  if (!s.hasData) return '';
  const max = Math.max(1, ...s.top.map((c) => c.amount));
  return `<section class="panel wk-card">
    <h3 class="panel-title">Last week</h3>
    <p class="panel-sub">${esc(range(s.week))} · <b>${esc(summaryLine(s.spent, s.vs, aed, s.refunds).replace('Last week you spent ', 'You spent '))}</b>${s.vs && s.vs.tone !== 'same' ? ` (usual ${aed(s.vs.usual)})` : ''}</p>
    <div class="tm-list">${s.top.map((c) => `<div class="tm-row">
        <span class="tm-name"><b>${esc(c.label)}</b></span>
        <span class="hb-track"><i style="--w:${(c.amount / max) * 100}%; --tint:${catTint(c.id)}"></i></span>
        <span class="hb-val num">${fmt(c.amount, { whole: true })}</span></div>`).join('')}</div>
    <button type="button" class="btn-plain wk-open" data-weekly="open">See your week${icon('chevR', { size: 14, cls: 'chev' })}</button>
  </section>`;
}
