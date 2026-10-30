// Insights tab: where the money went, allowance pace, accounts, income and the last six cycles.
import {
  ACCOUNTS, SPEND_CATEGORIES, seriesColor, cycleOf, shiftCycle, cycleName, cycleRange, cycleLength, cycleBounds, summarize, fmt, dayKey, toAED,
} from './model.js';
import { state } from './store.js';
import { esc } from './ui.js';
import { icon } from './icons.js';
import { donut, paceLine, inOutBars } from './charts.js';
import { largeTitle, demoBanner } from './views.js';

let insightsCycle = null;
const currentCycle = () => cycleOf(new Date(), state.settings.cycleStart);

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
