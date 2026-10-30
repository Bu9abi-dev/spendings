// Hand-drawn SVG charts. Thin marks, 2px surface gaps, recessive axes, a hover/tap layer on each.
import { fmt } from './model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Donut. slices: [{label, value, color}] in fixed category order. Center shows total or the tapped slice. */
export function donut(slices, { total, centerLabel = 'Spent', size = 220 } = {}) {
  const r = 86, w = 22, cx = 110, cy = 110;
  const sum = slices.reduce((a, s) => a + s.value, 0);
  if (!sum) {
    return `<div class="donut empty"><svg viewBox="0 0 220 220" width="${size}" height="${size}" aria-hidden="true"><circle cx="110" cy="110" r="${r}" fill="none" stroke="var(--fill-3)" stroke-width="${w}"/></svg>
      <div class="donut-center"><span class="dc-label">Nothing spent yet</span></div></div>`;
  }
  let a0 = -Math.PI / 2;
  const gap = slices.length > 1 ? 2 / r : 0; // 2px surface gap
  const paths = slices.filter((s) => s.value > 0).map((s, i) => {
    const sweep = (s.value / sum) * Math.PI * 2;
    const a1 = a0 + sweep;
    const s0 = a0 + gap / 2, s1 = Math.max(s0 + 0.001, a1 - gap / 2);
    const large = s1 - s0 > Math.PI ? 1 : 0;
    const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    const d = sweep >= Math.PI * 2 - 0.0001
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
      : `M ${p(s0)} A ${r} ${r} 0 ${large} 1 ${p(s1)}`;
    a0 = a1;
    const pct = Math.round((s.value / sum) * 100);
    return `<path class="slice" d="${d}" stroke="${s.color}" stroke-width="${w}" fill="none" tabindex="0" role="button"
      data-label="${esc(s.label)}" data-value="${s.value}" data-pct="${pct}" style="--i:${i}"
      aria-label="${esc(s.label)}: AED ${fmt(s.value)}, ${pct}%"/>`;
  }).join('');
  return `<div class="donut" data-total="${total ?? sum}" data-center="${esc(centerLabel)}">
    <svg viewBox="0 0 220 220" width="${size}" height="${size}">${paths}</svg>
    <div class="donut-center" aria-live="polite"><span class="dc-label">${esc(centerLabel)}</span><span class="dc-value num">AED ${fmt(total ?? sum, { whole: true })}</span></div>
  </div>`;
}

export function bindDonut(root) {
  root.querySelectorAll('.donut').forEach((d) => {
    const label = d.querySelector('.dc-label'), value = d.querySelector('.dc-value');
    if (!value) return;
    const reset = () => {
      d.querySelectorAll('.slice').forEach((s) => s.classList.remove('dim', 'on'));
      label.textContent = d.dataset.center; value.textContent = `AED ${fmt(+d.dataset.total, { whole: true })}`;
    };
    let current = null;
    d.querySelectorAll('.slice').forEach((s) => {
      const show = () => {
        if (current === s) { current = null; reset(); return; }
        current = s;
        d.querySelectorAll('.slice').forEach((o) => { o.classList.toggle('dim', o !== s); o.classList.toggle('on', o === s); });
        label.textContent = `${s.dataset.label} · ${s.dataset.pct}%`;
        value.textContent = `AED ${fmt(+s.dataset.value, { whole: true })}`;
      };
      s.addEventListener('click', show);
      s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
    });
  });
}

/** Cumulative spend line vs an even allowance pace line. One axis (AED). */
export function paceLine({ days, cumulative, pace, todayIndex, labels }) {
  const W = 340, H = 170, L = 8, R = 8, T = 14, B = 22;
  const max = Math.max(1, ...cumulative.filter((v) => v != null), ...pace) * 1.08;
  const x = (i) => L + (i / Math.max(1, days - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const line = (arr) => arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const pts = cumulative.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  const area = pts.length ? `M ${pts[0][0]} ${y(0)} L ${pts.map((p) => p.join(' ')).join(' L ')} L ${pts[pts.length - 1][0]} ${y(0)} Z` : '';
  const grid = [0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max / 1.08 * f)}" y2="${y(max / 1.08 * f)}" class="grid"/>
    <text x="${W - R}" y="${y(max / 1.08 * f) - 4}" class="axis" text-anchor="end">${fmt(max / 1.08 * f, { whole: true })}</text>`).join('');
  const ticks = [0, Math.floor((days - 1) / 2), days - 1].map((i) => `<text x="${x(i)}" y="${H - 6}" class="axis" text-anchor="${i === 0 ? 'start' : i === days - 1 ? 'end' : 'middle'}">${labels[i]}</text>`).join('');
  const last = pts[pts.length - 1];
  return `<div class="pace-chart" data-days="${days}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pace-svg" role="img" aria-label="Cumulative spending against the allowance pace">
      ${grid}
      <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="base"/>
      <polyline points="${line(pace)}" class="pace-line"/>
      ${area ? `<path d="${area}" class="spend-area"/>` : ''}
      <polyline points="${line(cumulative)}" class="spend-line"/>
      ${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="4.5" class="spend-dot"/>` : ''}
      <line class="xhair" x1="0" x2="0" y1="${T}" y2="${y(0)}" visibility="hidden"/>
      ${ticks}
    </svg>
    <div class="tip" hidden></div>
    <script type="application/json">${JSON.stringify({ cumulative, pace, labels, todayIndex })}</script>
  </div>`;
}

export function bindPace(root) {
  root.querySelectorAll(".pace-chart").forEach((el) => {
    const data = JSON.parse(el.querySelector('script').textContent);
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xhair');
    const days = +el.dataset.days;
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left - (8 / 340) * r.width) / (r.width * (324 / 340))));
      const i = Math.round(fx * (days - 1));
      const vx = 8 + (i / Math.max(1, days - 1)) * 324;
      xh.setAttribute('x1', vx); xh.setAttribute('x2', vx); xh.setAttribute('visibility', 'visible');
      const spent = data.cumulative[i];
      tip.hidden = false;
      tip.innerHTML = `<b>${data.labels[i]}</b><span><i class="sw spend"></i>Spent ${spent == null ? 'not yet' : 'AED ' + fmt(spent, { whole: true })}</span><span><i class="sw pace"></i>Even pace AED ${fmt(data.pace[i], { whole: true })}</span>`;
      const px = (vx / 340) * r.width;
      tip.style.transform = `translateX(${Math.min(r.width - tip.offsetWidth, Math.max(0, px - tip.offsetWidth / 2))}px)`;
    };
    const leave = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('pointerdown', (e) => { move(e); });
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('pointercancel', leave);
  });
}

/** Paired bars per cycle: money in vs money out. */
const k = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : fmt(v, { whole: true }));
export function inOutBars(rows) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.spent]));
  return `<div class="inout" role="table" aria-label="Money in and out per cycle">
    ${rows.map((r) => `<div class="io-col${r.current ? ' current' : ''}" role="row">
      <div class="io-bars" role="cell" aria-label="${r.label}: in AED ${fmt(r.income, { whole: true })}, out AED ${fmt(r.spent, { whole: true })}">
        <span class="io-bar in" style="--h:${(r.income / max) * 100}%"><em>${k(r.income)}</em></span>
        <span class="io-bar out" style="--h:${(r.spent / max) * 100}%"><em>${k(r.spent)}</em></span>
      </div>
      <span class="io-label">${r.label}</span>
    </div>`).join('')}
  </div>`;
}

/* ───── Spend by day / by week ───── */

// Which view the spending bars show. Kept for the session so a re-render (sync, undo) doesn't flip it back.
let barsView = 'day';

/**
 * Bars of spending per day of the cycle, with a Week toggle.
 * days: [{ label, value, future, today }]; weeks: [{ label, range, value, note }]; avg = average per elapsed day,
 * soFar = the cycle is still running. A week's note (e.g. "2 days") marks a short last week.
 * Tapping a bar shows its day and amount in the readout line above the bars.
 */
export function spendBars({ days, weeks, avg, soFar }) {
  const dayMax = Math.max(1, ...days.map((d) => d.value));
  const weekMax = Math.max(1, ...weeks.map((w) => w.value));
  const bar = (b, max, cls) => `<button type="button" class="sb-bar ${cls}${b.future ? ' future' : ''}${b.today ? ' today' : ''}"
      style="--h:${(b.value / max) * 100}%" data-label="${esc(b.range || b.label)}" data-value="${b.value}"
      aria-label="${esc(b.range || b.label)}: AED ${fmt(b.value, { whole: true })}"${b.future ? ' disabled' : ''}>${cls === 'wk' ? `<em class="num">${k(b.value)}</em>` : ''}</button>`;
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1]
    .map((i) => `<span style="--x:${((i + 0.5) / days.length) * 100}%">${esc(days[i].label)}</span>`).join('');
  const avgLine = avg > 0 ? `<i class="sb-avg" style="--y:${(avg / dayMax) * 100}%"></i>` : '';
  // what the readout line says when no bar is picked, one per view
  const defaults = {
    day: `<i class="sw avg"></i> Average <b class="num">AED ${fmt(avg, { whole: true })}</b> a day${soFar ? ' so far' : ''}`,
    week: 'Weeks count from the cycle’s first day. Tap one to see it.',
  };
  return `<div class="spend-bars" data-view="${barsView}">
    <template class="sb-default" data-for="day">${defaults.day}</template>
    <template class="sb-default" data-for="week">${defaults.week}</template>
    <div class="chart-seg" role="radiogroup" aria-label="Show spending by">
      <button type="button" role="radio" data-bars="day" aria-checked="${barsView === 'day'}">Day</button>
      <button type="button" role="radio" data-bars="week" aria-checked="${barsView === 'week'}">Week</button>
    </div>
    <p class="sb-readout" aria-live="polite">${defaults[barsView]}</p>
    <div class="sb-plot sb-days">${avgLine}${days.map((d) => bar(d, dayMax, 'dy')).join('')}</div>
    <div class="sb-ticks sb-days">${ticks}</div>
    <div class="sb-plot sb-weeks">${weeks.map((w) => bar(w, weekMax, 'wk')).join('')}</div>
    <div class="sb-wlabels sb-weeks">${weeks.map((w) => `<span>${esc(w.label)}${w.note ? `<small>${esc(w.note)}</small>` : ''}</span>`).join('')}</div>
  </div>`;
}

export function bindBars(root) {
  root.querySelectorAll('.spend-bars').forEach((el) => {
    const readout = el.querySelector('.sb-readout');
    const reset = () => {
      el.querySelectorAll('.sb-bar.on').forEach((b) => b.classList.remove('on'));
      el.classList.remove('picked');
      readout.innerHTML = el.querySelector(`.sb-default[data-for="${el.dataset.view}"]`).innerHTML;
    };
    const pick = (b) => {
      if (!b || b.disabled || b.classList.contains('on')) return;
      el.querySelectorAll('.sb-bar.on').forEach((o) => o.classList.remove('on'));
      b.classList.add('on');
      el.classList.add('picked');
      readout.innerHTML = `${esc(b.dataset.label)} · <b class="num">AED ${fmt(+b.dataset.value, { whole: true })}</b>`;
    };
    // Day bars are thin on a phone, so a finger picks the nearest bar and can slide along to scrub.
    // A tap on the bar that's already picked clears it.
    const nearest = (plot, x) => {
      let best = null, gap = Infinity;
      plot.querySelectorAll('.sb-bar:not([disabled])').forEach((b) => {
        const r = b.getBoundingClientRect();
        const d = Math.abs(x - (r.left + r.width / 2));
        if (d < gap) { gap = d; best = b; }
      });
      return best;
    };
    el.querySelectorAll('.sb-plot').forEach((plot) => {
      let down = false;
      plot.addEventListener('pointerdown', (ev) => {
        down = true;
        const b = nearest(plot, ev.clientX);
        if (b?.classList.contains('on')) { down = false; return reset(); }
        pick(b);
      });
      plot.addEventListener('pointermove', (ev) => { if (down) pick(nearest(plot, ev.clientX)); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => plot.addEventListener(t, () => { down = false; }));
    });
    el.addEventListener('click', (ev) => {
      const seg = ev.target.closest('[data-bars]');
      if (seg) {
        barsView = el.dataset.view = seg.dataset.bars;
        el.querySelectorAll('[data-bars]').forEach((b) => b.setAttribute('aria-checked', b === seg));
        return reset();
      }
      // keyboard (Enter/Space on a bar) arrives as a click with no pointer; pointer taps are handled above
      const b = ev.target.closest('.sb-bar');
      if (b && ev.detail === 0) { if (b.classList.contains('on')) reset(); else pick(b); }
    });
  });
}

/** Six small bars for one category's trend. The last (shown) cycle is solid, earlier ones faded. */
export function sparkBars(values, color) {
  const max = Math.max(1, ...values);
  return `<span class="spark" aria-hidden="true">${values.map((v, i) => `<i class="${i === values.length - 1 ? 'now' : ''}" style="--h:${(v / max) * 100}%; --tint:${color}"></i>`).join('')}</span>`;
}
