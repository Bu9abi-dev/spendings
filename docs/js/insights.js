// Insights tab: where the money went, allowance pace, accounts, income and the last six cycles.
import {
  ACCOUNTS, SPEND_CATEGORIES, allCategories, categoryMeta, seriesColor, cycleOf, shiftCycle, cycleName, cycleRange, cycleLength, cycleBounds, summarize, fmt, dayKey, toAED,
  homeNumbers, isPerson,
} from './model.js';
import { state, getExtra, saveExtra } from './store.js';
import { esc } from './ui.js';
import { icon } from './icons.js';
import { donut, paceLine, inOutBars, spendBars, sparkBars } from './charts.js';
import { dailySpend, weeklySpend, topMerchants, categoryTrends } from './trends.js';
import { largeTitle, demoBanner } from './views.js';
import { goalsCard, netWorthCard } from './goals-ui.js';
import { bnplInsightsPanel } from './bnpl-ui.js';
import { detectRecurring, monthlyTotal, daysUntil } from './recurring.js';
import { budgetRows, budgetsCard } from './budgets.js';
import { currentLimits } from './budgets-settings.js';
import { weeklyCard } from './weekly-ui.js';

let insightsCycle = null;

/* ───── Subscriptions ───── */
const ignoredSubs = () => getExtra('recurring', { v: 1, ignored: [] }).ignored || [];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MON_SHORT[m - 1]}`; };

/** The "Subscriptions" card: payments that repeat, with what they cost per month. */
function subscriptionsCard() {
  if (insightsCycle && insightsCycle !== currentCycle()) return ''; // only for the cycle we're in
  const ignored = ignoredSubs();
  const subs = detectRecurring(state.entries, state.settings, { ignored });
  if (!subs.length && !ignored.length) return '';
  const row = (s) => {
    const left = -daysUntil(s.next); // days since the expected date
    const when = s.isLate ? `No charge since ${niceDay(s.last)}, maybe cancelled`
      : `${s.cadenceLabel} · ${left > 0 ? `was due ${niceDay(s.next)}` : `expected ${niceDay(s.next)}`}`;
    return `<details class="sub-row${s.isLate ? ' late' : ''}">
      <summary>
        <span class="lg-icon" style="--tint:var(--series-other)">${icon('calendar', { size: 16 })}</span>
        <span class="tr-name"><b>${esc(s.name)}</b><small>${esc(when)}</small></span>
        <span class="sub-amt num"><b>${fmt(s.amount)}</b><small>${s.cadence === 'monthly' ? 'a month' : s.cadence === 'weekly' ? 'a week' : 'a year'}</small></span>
      </summary>
      <div class="sub-more">
        ${s.isNew ? '<span class="sub-flag">New this month</span>' : ''}
        ${s.was ? `<span class="sub-flag">Price changed: AED ${fmt(s.was)} to ${fmt(s.amount)}</span>` : ''}
        <p>${s.count} payments so far · about AED ${fmt(s.monthly, { whole: true })} a month</p>
        <button type="button" class="btn-plain" data-sub-ignore="${esc(s.key)}">Not a subscription</button>
      </div></details>`;
  };
  return `<section class="panel" id="subs">
      <h3 class="panel-title">Subscriptions</h3>
      ${subs.length ? `<p class="panel-sub"><b>About AED ${fmt(monthlyTotal(subs), { whole: true })} a month</b> across ${subs.filter((s) => !s.isLate).length} repeating ${subs.filter((s) => !s.isLate).length === 1 ? 'payment' : 'payments'}. Tap one for details.</p>
        <div class="sub-list">${subs.map(row).join('')}</div>` : '<p class="muted center">Nothing repeating right now.</p>'}
      ${ignored.length ? `<button type="button" class="btn-plain sub-restore" data-sub-restore="1">${ignored.length} hidden · Show again</button>` : ''}
    </section>`;
}

/** Taps inside the Subscriptions card. Returns true when it handled the tap. */
export function subsClick(t) {
  const hide = t.closest('[data-sub-ignore]');
  if (hide) { saveExtra('recurring', { v: 1, ignored: [...new Set([...ignoredSubs(), hide.dataset.subIgnore])] }, `Hid ${hide.closest('.sub-row').querySelector('b').textContent} from Subscriptions`); return true; }
  if (t.closest('[data-sub-restore]')) { saveExtra('recurring', { v: 1, ignored: [] }, 'Showed hidden subscriptions again'); return true; }
  return false;
}
const currentCycle = () => cycleOf(new Date(), state.settings.cycleStart);

/** Back to the cycle we're in (the Home subscription line leads to a card that only shows there). */
export const showCurrentInsights = () => { insightsCycle = null; };

/** The cycle Insights is showing (the monthly report opens on it). */
export const insightsShown = () => insightsCycle || currentCycle();

/** Step the cycle shown by -1 or +1; never past the current one. */
export function shiftInsights(delta) {
  insightsCycle = shiftCycle(insightsCycle || currentCycle(), delta);
  if (insightsCycle >= currentCycle()) insightsCycle = null;
}

/** Back to the current cycle (Home's limit notice opens Insights on it, not on whatever cycle was last browsed). */
export function resetInsights() { insightsCycle = null; }

export function renderInsights() {
  const s = state.settings;
  const cyc = insightsCycle || currentCycle();
  const isCurrent = cyc === currentCycle();
  // the cycle we're in uses Home's own numbers (the same summary, adjusted for spending before tracking began, and the
  // same pace from allowancePace), so the pace card can never disagree with Home or its "runs out" alert
  const home = isCurrent ? homeNumbers(state.entries, state.plan, s, new Date(), state.dismissed) : null;
  const sum = home ? home.sum : summarize(state.entries, cyc, s, state.plan);

  const main = allCategories('Spend').filter((c) => c.slot); // hidden built-ins keep their colour, so the donut matches the legend
  // everything without its own colour: Family, Other, your own and hidden categories, and Needs category
  const otherTotal = [...sum.byCategory].filter(([k]) => !main.some((c) => c.id === k)).reduce((a, [, v]) => a + v, 0);
  const slices = [...main.map((c) => ({ label: c.short, value: sum.byCategory.get(c.id) || 0, color: seriesColor(c.slot) })), { label: 'Other', value: otherTotal, color: 'var(--series-other)' }];

  const legendRows = [...allCategories('Spend'), { id: 'Uncategorised', short: 'Needs category', icon: 'tray', slot: 0 }]
    .map((c) => ({ c, v: sum.byCategory.get(c.id) || 0 }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v);

  // allowance pace
  const len = cycleLength(cyc, s.cycleStart);
  const { start } = cycleBounds(cyc, s.cycleStart);
  const today = isCurrent ? Math.min(len - 1, Math.floor((Date.now() - start) / 864e5)) : len - 1;
  const perDay = new Array(len).fill(0);
  if (sum.spentBefore) perDay[0] += sum.spentBefore; // spent before tracking began counts from day one, as on Home
  for (const e of sum.entries) {
    // a refund into the allowance account gives that money back on the day it lands; lending from it uses allowance
    const refund = e.type === 'Income' && e.category === 'Refund';
    const lent = e.type === 'Transfer' && isPerson(e.toAccount);
    if ((e.type !== 'Spend' && !refund && !lent) || e.account !== s.allowanceAccount) continue;
    const i = Math.min(len - 1, Math.max(0, Math.floor((new Date(e.date) - start) / 864e5)));
    perDay[i] += refund ? -toAED(e, s) : toAED(e, s);
  }
  let run = 0;
  const cumulative = perDay.map((v, i) => (i > today ? null : (run += v)));
  const pace = perDay.map((_, i) => (sum.allowancePot * (i + 1)) / len);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const labels = perDay.map((_, i) => { const [y, m, d] = dayKey(new Date(start.getTime() + i * 864e5 + 6 * 3600e3)).split('-').map(Number); return `${d} ${MON[m - 1]}`; });
  const pc = home?.pace; // on track / over pace: the shared definition (model.js allowancePace)

  // six cycles
  const six = Array.from({ length: 6 }, (_, i) => shiftCycle(cyc, i - 5)).map((c) => {
    const x = summarize(state.entries, c, s, state.plan);
    return { label: cycleName(c, false).split(' ')[0], income: x.income, spent: x.spent, current: c === cyc };
  });

  // spending by day and week (every account, transfers left out)
  const daily = dailySpend(state.entries, cyc, s);
  const elapsed = today + 1;
  const avgDay = daily.slice(0, elapsed).reduce((a, v) => a + v, 0) / elapsed;
  // a day still to come is drawn empty, unless something is already dated on it (then it's shown, so days add up to weeks)
  const barDays = daily.map((v, i) => ({ label: labels[i], value: v, future: i > today && !v, today: isCurrent && i === today }));
  const barWeeks = weeklySpend(daily).map((w) => ({
    label: labels[w.from],
    range: w.from === w.to ? labels[w.from] : `${labels[w.from]} – ${labels[w.to]}`,
    value: w.total,
    future: w.from > today && !w.total,
    note: w.to - w.from < 6 ? `${w.to - w.from + 1} ${w.to === w.from ? 'day' : 'days'}` : '', // short last week
  }));

  const merchants = topMerchants(state.entries, cyc, s, 5);
  const merchMax = Math.max(1, ...merchants.map((m) => m.total));
  // spending not in the top five (smaller places, and payments with no place name), so the card adds up to "Spent"
  const restOfSpend = sum.spent - merchants.reduce((a, m) => a + m.total, 0);

  const trends = categoryTrends(state.entries, cyc, s, 6);
  const catOf = (id) => categoryMeta(id)
    || (id === 'Uncategorised' ? { id, short: 'Needs category', icon: 'tray', slot: 0, warn: true } : { id, icon: 'dots', slot: 0 });
  const trendNote = (t) => (t.usual == null ? 'Nothing before this' : `Usual AED ${fmt(t.usual, { whole: true })}`);

  const accMax = Math.max(1, ...ACCOUNTS.map((a) => sum.byAccount.get(a.id)?.spent || 0));

  return `
    ${largeTitle('Insights', '', '')}
    ${demoBanner()}
    <div class="cycle-switch glass">
      <button type="button" class="icon-btn" data-cyc="-1" aria-label="Previous cycle">${icon('chevL', { size: 20 })}</button>
      <div class="cs-label"><b>${cycleName(cyc, false)}</b><span>${cycleRange(cyc, s.cycleStart)}</span></div>
      <button type="button" class="icon-btn" data-cyc="1" aria-label="Next cycle" ${isCurrent ? 'disabled' : ''}>${icon('chevR', { size: 20 })}</button>
    </div>

    <section class="group report-link">
      <button type="button" class="row link-row" data-act="report"><span class="row-icon" style="--tint:var(--tint-text)">${icon('note', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${cycleName(cyc, true)} report</span><span class="row-sub">Save it as a PDF or CSV</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>
    </section>

    ${netWorthCard()}
    ${goalsCard()}

    <section class="panel">
      <h3 class="panel-title">Where it went</h3>
      ${donut(slices, { total: sum.spent, centerLabel: 'Spent' })}
      <div class="legend">
        ${legendRows.length ? legendRows.map(({ c, v }) => `<div class="lg-row">
          <span class="lg-icon" style="--tint:${c.id === 'Uncategorised' ? 'var(--warn)' : seriesColor(c.slot)}">${icon(c.icon, { size: 16 })}</span>
          <span class="lg-name">${c.id === 'Uncategorised' ? 'Needs category' : esc(c.label || c.id)}</span>
          <span class="lg-bar"><i style="--w:${(v / Math.max(1, sum.spent)) * 100}%; --tint:${c.id === 'Uncategorised' ? 'var(--warn)' : seriesColor(c.slot)}"></i></span>
          <span class="lg-val num">${fmt(v, { whole: true })}</span>
          <span class="lg-pct num">${Math.round((v / Math.max(1, sum.spent)) * 100)}%</span>
        </div>`).join('') : '<p class="muted center">No spending in this cycle.</p>'}
      </div>
    </section>

    ${budgetsCard(budgetRows(sum.byCategory, currentLimits()), { isCurrent })}

    ${isCurrent ? weeklyCard() : ''}

    <section class="panel">
      <h3 class="panel-title">Day by day</h3>
      <p class="panel-sub">Spending from every account. Moving money between your accounts isn’t spending, so it’s left out.</p>
      ${sum.spent ? spendBars({ days: barDays, weeks: barWeeks, avg: avgDay, soFar: isCurrent }) : '<p class="muted center">No spending in this cycle.</p>'}
    </section>

    <section class="panel">
      <h3 class="panel-title">Top places</h3>
      ${merchants.length ? `<div class="tm-list">${merchants.map((m) => `<div class="tm-row">
          <span class="tm-name"><b>${esc(m.name)}</b><small>${m.count} ${m.count === 1 ? 'payment' : 'payments'}</small></span>
          <span class="hb-track"><i style="--w:${(m.total / merchMax) * 100}%"></i></span>
          <span class="hb-val num">${fmt(m.total, { whole: true })}</span></div>`).join('')}
          ${restOfSpend >= 0.5 ? `<div class="tm-row tm-rest"><span class="tm-name"><b>Everything else</b></span><span></span><span class="hb-val num">${fmt(restOfSpend, { whole: true })}</span></div>` : ''}</div>` : '<p class="muted center">No places logged in this cycle.</p>'}
    </section>

    ${subscriptionsCard()}

    <section class="panel" id="pace">
      <h3 class="panel-title">Allowance pace</h3>
      <p class="panel-sub">${esc(s.allowanceAccount)} spending, day by day, against an even spread of AED ${fmt(sum.allowancePot, { whole: true })}.
        ${pc ? `<b class="${pc.state === 'spent' || pc.state === 'over' ? 'pace-bad' : 'pace-good'}">${pc.state === 'spent' ? `AED ${fmt(-sum.allowanceLeft, { whole: true })} over the allowance`
          : pc.state === 'over' ? `AED ${fmt(pc.delta, { whole: true })} over pace` : pc.state === 'under' ? `On track · AED ${fmt(-pc.delta, { whole: true })} under pace` : 'On track'}</b>` : ''}</p>
      <div class="series-legend"><span><i class="sw spend"></i>Spent so far</span><span><i class="sw pace"></i>Even pace</span></div>
      ${paceLine({ days: len, cumulative, pace, todayIndex: today, labels })}
    </section>

    ${bnplInsightsPanel(cyc, isCurrent)}

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
    </section>

    <section class="panel">
      <h3 class="panel-title">Categories over six cycles</h3>
      <p class="panel-sub">Each row shows six cycles, oldest on the left. The solid bar and the number are ${isCurrent ? 'this cycle so far' : cycleName(cyc, false)}. “Usual” is the average of the cycles before it.</p>
      ${trends.length ? `<div class="tr-list">${trends.map((t) => { const c = catOf(t.id); const color = c.warn ? 'var(--warn)' : seriesColor(c.slot); return `<div class="tr-row">
          <span class="lg-icon" style="--tint:${color}">${icon(c.icon, { size: 16 })}</span>
          <span class="tr-name"><b>${esc(c.short || t.id)}</b><small>${trendNote(t)}</small></span>
          ${sparkBars(t.values, color)}
          <span class="tr-val num">${fmt(t.values[t.values.length - 1], { whole: true })}</span></div>`; }).join('')}</div>` : '<p class="muted center">No spending in the last six cycles.</p>'}
    </section>`;
}
