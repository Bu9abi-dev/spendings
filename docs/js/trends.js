// Spending trends for the Insights charts: day-by-day and week-by-week spend, top merchants,
// and each category over the last six cycles. Pure functions (no DOM, no store), so tests can run them.
//
// "Spending" here means exactly what the rest of Insights counts (model.js cycleSpend / isPersonalSpend):
// Spend entries by their date's cycle, less refunds. Transfers, bank checks, income, Investing and anything
// marked "Not my spending" are left out.
import { cycleBounds, cycleLength, shiftCycle, toAED, cycleSpend, isPersonalSpend, isRefund, entryCycle } from './model.js';
import { merchantKey } from './categorize.js';

const DAY = 864e5;

/**
 * Index of the cycle day an entry falls on (0 = first day). Cycle start is Dubai midnight (model.js),
 * and Dubai has no daylight saving, so whole days of 24h are exact.
 * Entries are already filtered by their cycle, so the clamp only matters for an entry whose cycle and
 * date disagree; it keeps that money on an edge bar so the bars still add up to "Spent".
 */
function dayIndex(e, start, len) {
  return Math.min(len - 1, Math.max(0, Math.floor((new Date(e.date) - start) / DAY)));
}

/** Spend per day of the cycle, in AED (less refunds, on the day they landed). One number per day; adds up to Spent. */
export function dailySpend(entries, cycle, settings) {
  const len = cycleLength(cycle, settings.cycleStart);
  const { start } = cycleBounds(cycle, settings.cycleStart);
  const days = new Array(len).fill(0);
  for (const [key, v] of cycleSpend(entries, cycle, settings).daily) {
    days[dayIndex({ date: `${key}T12:00:00+04:00` }, start, len)] += v;
  }
  return days;
}

/**
 * Split the cycle's days into weeks of seven, counted from the cycle's first day
 * (the last week can be shorter). Returns [{ from, to, total }] with day indexes.
 */
export function weeklySpend(daily) {
  const weeks = [];
  for (let i = 0; i < daily.length; i += 7) {
    const part = daily.slice(i, i + 7);
    weeks.push({ from: i, to: i + part.length - 1, total: part.reduce((a, v) => a + v, 0) });
  }
  return weeks;
}

// One key per merchant: the shared shop key (categorize.js), so "Carrefour", "CARREFOUR" and the bank's
// "CARREFOUR MCC 5411 ABU DHABI AE" count together, and match what Activity filters on when you tap the row.
export { merchantKey };

/**
 * The merchants that took the most money this cycle.
 * Returns [{ name, total, count }] biggest first; name is the spelling used most often.
 * Entries without a merchant are skipped.
 */
export function topMerchants(entries, cycle, settings, limit = 5) {
  const groups = new Map(), back = new Map();
  for (const e of entries) {
    if (!isPersonalSpend(e) && !isRefund(e)) continue;
    if (entryCycle(e, settings) !== cycle) continue;
    const key = merchantKey(e.merchant);
    // a refund from a shop comes off that shop's total
    if (isRefund(e)) { if (key) back.set(key, (back.get(key) || 0) + toAED(e, settings)); continue; }
    if (!key) continue; // no merchant name: counted in "Everything else" on the card
    const g = groups.get(key) || { total: 0, count: 0, spellings: new Map() };
    g.total += toAED(e, settings);
    g.count++;
    const name = String(e.merchant).trim().replace(/\s+/g, ' ');
    g.spellings.set(name, (g.spellings.get(name) || 0) + 1);
    groups.set(key, g);
  }
  return [...groups].map(([key, g]) => ({ name: [...g.spellings].sort((a, b) => b[1] - a[1])[0][0], total: Math.max(0, g.total - (back.get(key) || 0)), count: g.count }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Each spending category over the `count` cycles ending with `cycle` (oldest first).
 * Returns [{ id, values, total, usual }] for categories with any spend in that window, biggest first.
 * `usual` is the average of the earlier cycles in the window. Cycles before the first entry don't count
 * (the app wasn't used yet), and nor does the very first cycle once there's a later one to use, because
 * logging usually starts part-way through it. null when no earlier cycle counts, or the category
 * had nothing in any of them (so it's new, not "usually 0").
 */
export function categoryTrends(entries, cycle, settings, count = 6) {
  const cycles = Array.from({ length: count }, (_, i) => shiftCycle(cycle, i - (count - 1)));
  const pos = new Map(cycles.map((c, i) => [c, i]));
  const firstCycle = entries.reduce((m, e) => { const c = e.date ? entryCycle(e, settings) : ''; return c && (!m || c < m) ? c : m; }, '');
  const rows = new Map();
  // each cycle's category totals, exactly as the donut shows them (refunds taken off, excluded money left out);
  // categories not in the list (old names) keep their own name; blank = needs a category
  for (const c of cycles) {
    for (const [id, v] of cycleSpend(entries, c, settings).byCategory) {
      const row = rows.get(id) || { id, values: new Array(count).fill(0) };
      row.values[pos.get(c)] += v;
      rows.set(id, row);
    }
  }
  return [...rows.values()].map((r) => {
    // cycle ids are "YYYY-MM", so comparing them as text compares them by date
    let earlier = r.values.slice(0, -1).map((v, i) => [cycles[i], v]).filter(([c]) => c >= firstCycle);
    if (earlier.length > 1) earlier = earlier.filter(([c]) => c !== firstCycle);
    const sum = earlier.reduce((a, [, v]) => a + v, 0);
    const usual = earlier.length && sum > 0 ? sum / earlier.length : null;
    return { ...r, total: r.values.reduce((a, v) => a + v, 0), usual };
  }).sort((a, b) => b.total - a.total);
}
