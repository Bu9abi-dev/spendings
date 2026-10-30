// Insights tab: where the money went, allowance pace, accounts, income and the last six cycles.
import {
  ACCOUNTS, SPEND_CATEGORIES, allCategories, categoryMeta, seriesColor, cycleOf, shiftCycle, cycleName, cycleRange, cycleLength, cycleBounds, summarize, fmt, dayKey, toAED,
  homeNumbers, isPerson, amtAED, shortDay,
} from './model.js';
import { t } from './i18n.js';
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
import { merchantKey } from './categorize.js';
import { weeklyCard } from './weekly-ui.js';

let insightsCycle = null;

/* ───── Subscriptions ───── */
const ignoredSubs = () => getExtra('recurring', { v: 1, ignored: [] }).ignored || [];
const niceDay = shortDay; // "12 Oct", in the current language

/** The "Subscriptions" card: payments that repeat, with what they cost per month. */
function subscriptionsCard() {
  if (insightsCycle && insightsCycle !== currentCycle()) return ''; // only for the cycle we're in
  const ignored = ignoredSubs();
  const subs = detectRecurring(state.entries, state.settings, { ignored });
  if (!subs.length && !ignored.length) return '';
  const row = (s) => {
    const left = -daysUntil(s.next); // days since the expected date
    const when = s.isLate ? t('ins.noCharge', { date: niceDay(s.last) })
      : `${t(`cadence.${s.cadence}`)} · ${left > 0 ? t('ins.wasDue', { date: niceDay(s.next) }) : t('ins.expected', { date: niceDay(s.next) })}`;
    return `<details class="sub-row${s.isLate ? ' late' : ''}">
      <summary>
        <span class="lg-icon" style="--tint:var(--series-other)">${icon('calendar', { size: 16 })}</span>
        <span class="tr-name"><b>${esc(s.name)}</b><small>${esc(when)}</small></span>
        <span class="sub-amt num"><b>${fmt(s.amount)}</b><small>${t(s.cadence === 'monthly' ? 'ins.aMonth' : s.cadence === 'weekly' ? 'ins.aWeek' : 'ins.aYear')}</small></span>
      </summary>
      <div class="sub-more">
        ${s.isNew ? `<span class="sub-flag">${t('ins.newMonth')}</span>` : ''}
        ${s.was ? `<span class="sub-flag">${t('ins.priceChanged', { a: amtAED(fmt(s.was)), b: fmt(s.amount) })}</span>` : ''}
        <p>${t('ins.soFar', { n: s.count, amt: amtAED(fmt(s.monthly, { whole: true })) })}</p>
        <button type="button" class="btn-plain" data-sub-ignore="${esc(s.key)}">${t('ins.notSub')}</button>
      </div></details>`;
  };
  return `<section class="panel" id="subs">
      <h3 class="panel-title">${t('ins.subs')}</h3>
      ${subs.length ? `<p class="panel-sub">${t('ins.subsSub', { amt: amtAED(fmt(monthlyTotal(subs), { whole: true })), n: subs.filter((s) => !s.isLate).length })}</p>
        <div class="sub-list">${subs.map(row).join('')}</div>` : `<p class="muted center">${t('ins.nothingRep')}</p>`}
      ${ignored.length ? `<button type="button" class="btn-plain sub-restore" data-sub-restore="1">${t('ins.hiddenShow', { n: ignored.length })}</button>` : ''}
    </section>`;
}

/** Taps inside the Subscriptions card. Returns true when it handled the tap. */
export function subsClick(tg) {
  const hide = tg.closest('[data-sub-ignore]');
  if (hide) { saveExtra('recurring', { v: 1, ignored: [...new Set([...ignoredSubs(), hide.dataset.subIgnore])] }, t('ins.hid', { name: hide.closest('.sub-row').querySelector('b').textContent })); return true; }
  if (tg.closest('[data-sub-restore]')) { saveExtra('recurring', { v: 1, ignored: [] }, t('ins.showedHidden')); return true; }
  return false;
}
/** A tap on a Top places row: the shop key, its name and the cycle it was shown for. Null when it isn't one. */
export function placeTap(tg) {
  const r = tg.closest('[data-shop]');
  return r ? { shop: r.dataset.shop, name: r.dataset.shopName, cycle: r.dataset.shopCycle } : null;
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
  const slices = [...main.map((c) => ({ label: c.short, value: sum.byCategory.get(c.id) || 0, color: seriesColor(c.slot) })), { label: t('cat.Other'), value: otherTotal, color: 'var(--series-other)' }];

  const legendRows = [...allCategories('Spend'), { id: 'Uncategorised', short: t('row.needsCat'), icon: 'tray', slot: 0 }]
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
  const labels = perDay.map((_, i) => shortDay(dayKey(new Date(start.getTime() + i * 864e5 + 6 * 3600e3))));
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
  // a plain estimate: spending so far (every account, as the bars) at the average daily rate for the whole cycle. Hidden until day 3
  const onPace = isCurrent && elapsed >= 3 && elapsed < len ? Math.round((avgDay * len) / 10) * 10 : 0;
  // a day still to come is drawn empty, unless something is already dated on it (then it's shown, so days add up to weeks)
  const barDays = daily.map((v, i) => ({ label: labels[i], value: v, future: i > today && !v, today: isCurrent && i === today }));
  const barWeeks = weeklySpend(daily).map((w) => ({
    label: labels[w.from],
    range: w.from === w.to ? labels[w.from] : `${labels[w.from]} – ${labels[w.to]}`,
    value: w.total,
    future: w.from > today && !w.total,
    note: w.to - w.from < 6 ? t('ins.days', { n: w.to - w.from + 1 }) : '', // short last week
  }));

  const merchants = topMerchants(state.entries, cyc, s, 5);
  const merchMax = Math.max(1, ...merchants.map((m) => m.total));
  // spending not in the top five (smaller places, and payments with no place name), so the card adds up to "Spent"
  const restOfSpend = sum.spent - merchants.reduce((a, m) => a + m.total, 0);

  const trends = categoryTrends(state.entries, cyc, s, 6);
  const catOf = (id) => categoryMeta(id)
    || (id === 'Uncategorised' ? { id, short: t('row.needsCat'), icon: 'tray', slot: 0, warn: true } : { id, icon: 'dots', slot: 0 });
  const trendNote = (tr) => (tr.usual == null ? t('ins.nothingBefore') : t('ins.usual', { amt: amtAED(fmt(tr.usual, { whole: true })) }));

  const accMax = Math.max(1, ...ACCOUNTS.map((a) => sum.byAccount.get(a.id)?.spent || 0));

  return `
    ${largeTitle(t('ins.title'), '', '')}
    ${demoBanner()}
    <div class="cycle-switch glass">
      <button type="button" class="icon-btn" data-cyc="-1" aria-label="${t('ins.prev')}">${icon('chevL', { size: 20 })}</button>
      <div class="cs-label"><b>${cycleName(cyc, false)}</b><span>${cycleRange(cyc, s.cycleStart)}</span></div>
      <button type="button" class="icon-btn" data-cyc="1" aria-label="${t('ins.next')}" ${isCurrent ? 'disabled' : ''}>${icon('chevR', { size: 20 })}</button>
    </div>

    <section class="group report-link">
      <button type="button" class="row link-row" data-act="report"><span class="row-icon" style="--tint:var(--tint-text)">${icon('note', { size: 20 })}</span>
        <span class="row-main"><span class="row-title">${t('ins.report', { month: cycleName(cyc, true) })}</span><span class="row-sub">${t('ins.saveAs')}</span></span>${icon('chevR', { size: 16, cls: 'chev' })}</button>
    </section>

    ${netWorthCard()}
    ${goalsCard()}

    <section class="panel">
      <h3 class="panel-title">${t('ins.whereWent')}</h3>
      ${donut(slices, { total: sum.spent, centerLabel: t('act.spent') })}
      <div class="legend">
        ${legendRows.length ? legendRows.map(({ c, v }) => `<div class="lg-row">
          <span class="lg-icon" style="--tint:${c.id === 'Uncategorised' ? 'var(--warn)' : seriesColor(c.slot)}">${icon(c.icon, { size: 16 })}</span>
          <span class="lg-name">${c.id === 'Uncategorised' ? t('row.needsCat') : esc(c.label || c.id)}</span>
          <span class="lg-bar"><i style="--w:${(v / Math.max(1, sum.spent)) * 100}%; --tint:${c.id === 'Uncategorised' ? 'var(--warn)' : seriesColor(c.slot)}"></i></span>
          <span class="lg-val num">${fmt(v, { whole: true })}</span>
          <span class="lg-pct num">${Math.round((v / Math.max(1, sum.spent)) * 100)}%</span>
        </div>`).join('') : `<p class="muted center">${t('ins.noSpend')}</p>`}
      </div>
    </section>

    ${budgetsCard(budgetRows(sum.byCategory, currentLimits()), { isCurrent })}

    ${isCurrent ? weeklyCard() : ''}

    <section class="panel">
      <h3 class="panel-title">${t('ins.dayByDay')}</h3>
      <p class="panel-sub">${t('ins.dayByDaySub')}</p>
      ${sum.spent && onPace ? `<p class="on-pace" id="on-pace">${t('ins.onPace', { amt: amtAED(fmt(onPace, { whole: true })) })}</p>` : ''}
      ${sum.spent ? spendBars({ days: barDays, weeks: barWeeks, avg: avgDay, soFar: isCurrent }) : `<p class="muted center">${t('ins.noSpend')}</p>`}
    </section>

    <section class="panel">
      <h3 class="panel-title">${t('ins.topPlaces')}</h3>
      ${merchants.length ? `<div class="tm-list">${merchants.map((m) => `<button type="button" class="tm-row tm-tap" data-shop="${esc(merchantKey(m.name))}" data-shop-name="${esc(m.name)}" data-shop-cycle="${cyc}" aria-label="${esc(t('ins.showPlace', { name: m.name }))}">
          <span class="tm-name"><b>${esc(m.name)}</b><small>${t('act.payments', { n: m.count })}</small></span>
          <span class="hb-track"><i style="--w:${(m.total / merchMax) * 100}%"></i></span>
          <span class="hb-val num">${fmt(m.total, { whole: true })}</span></button>`).join('')}
          ${restOfSpend >= 0.5 ? `<div class="tm-row tm-rest"><span class="tm-name"><b>${t('ins.everythingElse')}</b></span><span></span><span class="hb-val num">${fmt(restOfSpend, { whole: true })}</span></div>` : ''}</div>` : `<p class="muted center">${t('ins.noPlaces')}</p>`}
    </section>

    ${subscriptionsCard()}

    <section class="panel" id="pace">
      <h3 class="panel-title">${t('ins.pace')}</h3>
      <p class="panel-sub">${t('ins.paceSub', { acc: esc(s.allowanceAccount), amt: amtAED(fmt(sum.allowancePot, { whole: true })) })}
        ${pc ? `<b class="${pc.state === 'spent' || pc.state === 'over' ? 'pace-bad' : 'pace-good'}">${pc.state === 'spent' ? t('home.overAllowance', { n: amtAED(fmt(-sum.allowanceLeft, { whole: true })) })
          : pc.state === 'over' ? t('home.overPace', { n: amtAED(fmt(pc.delta, { whole: true })) }) : pc.state === 'under' ? t('home.underPace', { n: amtAED(fmt(-pc.delta, { whole: true })) }) : t('home.onTrack')}</b>` : ''}</p>
      <div class="series-legend"><span><i class="sw spend"></i>${t('ins.spentSoFar')}</span><span><i class="sw pace"></i>${t('ins.evenPace')}</span></div>
      ${paceLine({ days: len, cumulative, pace, todayIndex: today, labels })}
    </section>

    ${bnplInsightsPanel(cyc, isCurrent)}

    <section class="panel">
      <h3 class="panel-title">${t('ins.byAccount')}</h3>
      <div class="hbars">
        ${ACCOUNTS.map((a) => { const v = sum.byAccount.get(a.id)?.spent || 0; return `<div class="hb-row">
          <span class="hb-name">${a.name}</span>
          <span class="hb-track"><i style="--w:${(v / accMax) * 100}%; --tint:${a.color}"></i></span>
          <span class="hb-val num">${fmt(v, { whole: true })}</span></div>`; }).join('')}
      </div>
    </section>

    <section class="panel">
      <h3 class="panel-title">${t('ins.moneyIn')}</h3>
      ${sum.byIncome.size ? `<div class="hbars">${[...sum.byIncome].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hb-row">
          <span class="hb-name">${esc(categoryMeta(k, 'Income')?.label || k)}</span>
          <span class="hb-track"><i style="--w:${(v / Math.max(1, sum.income)) * 100}%; --tint:var(--good)"></i></span>
          <span class="hb-val num">${fmt(v, { whole: true })}</span></div>`).join('')}</div>` : `<p class="muted">${t('ins.noIncome')}</p>`}
    </section>

    <section class="panel">
      <h3 class="panel-title">${t('ins.lastSix')}</h3>
      <div class="series-legend"><span><i class="sw in"></i>${t('ins.moneyIn')}</span><span><i class="sw out"></i>${t('ins.moneyOut')}</span></div>
      ${inOutBars(six)}
    </section>

    <section class="panel">
      <h3 class="panel-title">${t('ins.catsSix')}</h3>
      <p class="panel-sub">${t('ins.catsSixSub', { which: isCurrent ? t('ins.thisSoFar') : cycleName(cyc, false) })}</p>
      ${trends.length ? `<div class="tr-list">${trends.map((tr) => { const c = catOf(tr.id); const color = c.warn ? 'var(--warn)' : seriesColor(c.slot); return `<div class="tr-row">
          <span class="lg-icon" style="--tint:${color}">${icon(c.icon, { size: 16 })}</span>
          <span class="tr-name"><b>${esc(c.short || tr.id)}</b><small>${trendNote(tr)}</small></span>
          ${sparkBars(tr.values, color)}
          <span class="tr-val num">${fmt(tr.values[tr.values.length - 1], { whole: true })}</span></div>`; }).join('')}</div>` : `<p class="muted center">${t('ins.noSix')}</p>`}
    </section>`;
}
