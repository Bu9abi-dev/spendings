// Insights tab: where the money went, allowance pace, accounts, income and the last six cycles.
import {
  ACCOUNTS, SPEND_CATEGORIES, seriesColor, cycleOf, shiftCycle, cycleName, cycleRange, cycleLength, cycleBounds, summarize, fmt, dayKey, toAED,
} from './model.js';
import { state } from './store.js';
import { esc } from './ui.js';
import { icon } from './icons.js';
import { donut, paceLine, inOutBars, spendBars, sparkBars } from './charts.js';
import { dailySpend, weeklySpend, topMerchants, categoryTrends } from './trends.js';
import { largeTitle, demoBanner } from './views.js';

let insightsCycle = null;
const currentCycle = () => cycleOf(new Date(), state.settings.cycleStart);

/** The cycle Insights is showing (the monthly report opens on it). */
export const insightsShown = () => insightsCycle || currentCycle();

/** Step the cycle shown by -1 or +1; never past the current one. */
export function shiftInsights(delta) {
  insightsCycle = shiftCycle(insightsCycle || currentCycle(), delta);
  if (insightsCycle >= currentCycle()) insightsCycle = null;
}

export function renderInsights() {
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
  const catOf = (id) => SPEND_CATEGORIES.find((c) => c.id === id)
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
